import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateSOWFileName } from '@/lib/sow-utils'
import { extractAttachmentsFromRawData } from '@/lib/samgov'
import { parseAllAttachments, mergeStructuredContent } from '@/lib/attachment-parser'
import { format, addDays, differenceInCalendarDays } from 'date-fns'
import type { StructuredContent } from '@/lib/attachment-parser'
import { generateSOWSections } from '@/lib/openai'

/**
 * Compute the deadline by which a subcontractor must return their quote
 * to the prime. This is NOT the federal response deadline — it's an internal
 * deadline that gives the prime time to compare quotes and assemble the bid.
 *
 *   ≥ 21 days to federal deadline → quote due 7 days before federal deadline
 *   8–20 days                     → quote due 3 days before federal deadline
 *   ≤ 7 days                      → quote due 2 days from today (floor)
 *   no federal deadline known     → quote due 7 days from today
 */
function computeQuoteDeadline(responseDeadline: Date | null): Date {
  const today = new Date()
  if (!responseDeadline) return addDays(today, 7)
  const days = differenceInCalendarDays(responseDeadline, today)
  if (days >= 21) return addDays(responseDeadline, -7)
  if (days >= 8) return addDays(responseDeadline, -3)
  // Tight federal window: floor at today+2 so the sub gets at least a couple days
  return addDays(today, 2)
}

/**
 * Generate structured SOW content from real opportunity data.
 * Uses OpenAI for section copy; data-driven sections (attachments, FAR, eval) are appended.
 */
async function generateSOWContent(
  opportunity: any,
  subcontractor: any,
  selectedAttachments?: string[],
  primeCompany?: string
) {
  const raw = opportunity.rawData || {}
  const responseDeadlineDate = opportunity.responseDeadline ? new Date(opportunity.responseDeadline) : null
  // Internal deadline by which sub must return quote to the prime.
  // Federal deadline is intentionally NOT surfaced to the subcontractor.
  const quoteDeadlineDate = computeQuoteDeadline(responseDeadlineDate)
  const quoteDeadline = format(quoteDeadlineDate, 'MMMM d, yyyy')

  // Extract set-aside info
  const setAside = raw.typeOfSetAsideDescription || raw.typeOfSetAside || null

  // Extract place of performance
  const pop = raw.placeOfPerformance
  const popText = pop
    ? [pop.city?.name, pop.state?.name || pop.state?.code, pop.country?.name].filter(Boolean).join(', ')
    : opportunity.state || 'Per solicitation'

  // Get attachments list
  const allAttachments = extractAttachmentsFromRawData(raw)

  // Filter attachments based on selection
  let attachments = allAttachments
  if (selectedAttachments !== undefined) {
    if (selectedAttachments.length === 0) {
      attachments = []
    } else {
      attachments = allAttachments.filter(
        a => selectedAttachments.includes(a.id) || selectedAttachments.includes(a.name)
      )
    }
  }

  // Check for parsed attachment content (rich solicitation data)
  const parsed = opportunity.parsedAttachments as {
    structured?: StructuredContent
    parsed?: Array<{ fullText?: string; textLength?: number }>
  } | null
  const structured = parsed?.structured || null
  const hasParsedContent = !!(structured && (
    structured.scope.length > 0 ||
    structured.deliverables.length > 0 ||
    structured.compliance.length > 0
  ))

  // Extract FAR clause references from description + parsed content
  const farClauses = extractFARClauses(opportunity.description, structured)

  // Pre-flight evidence gate: if we have NO parsed solicitation content and
  // only a thin description (< 500 chars, typical SAM.gov v2 stub), skip the
  // OpenAI call entirely. The AI would just hallucinate plausible-sounding
  // bullets (MIL-STD-498, ISO 9001, etc) to fill space. Instead, build a stub
  // SOW with explicit [NEEDS DETAIL: ...] markers so the user sees the gaps
  // and either parses the attachments or fills them in manually.
  const descLength = (opportunity.description || '').trim().length
  const tooThinForAI = !hasParsedContent && descLength < 500
  let aiSections
  if (tooThinForAI) {
    console.warn('[SOW] Input too thin for AI generation (no parsed content, description < 500 chars). Using rule-based stub with [NEEDS DETAIL] markers.')
    aiSections = [
      buildBackgroundSection(opportunity),
      buildScopeSection(opportunity, hasParsedContent, structured),
      buildPlaceOfPerformanceSection(popText),
      buildQuoteSubmissionSection(quoteDeadline, primeCompany),
      buildDeliverablesSection(opportunity, hasParsedContent, structured),
      buildComplianceSection(opportunity, raw, hasParsedContent, structured),
    ]
  } else {
    try {
      aiSections = await generateSOWSections({
        title: opportunity.title,
        solicitationNumber: opportunity.solicitationNumber,
        agency: opportunity.agency || raw.fullParentPathName || 'Federal Government',
        naicsCode: opportunity.naicsCode || raw.naicsCode || null,
        setAside,
        quoteDeadline,
        placeOfPerformance: popText,
        description: opportunity.description || null,
        parsedScope: structured?.scope,
        parsedDeliverables: structured?.deliverables,
        parsedCompliance: structured?.compliance,
        parsedPeriodOfPerformance: structured?.periodOfPerformance,
        subcontractorName: subcontractor?.name || null,
        primeCompany: primeCompany || null,
      })
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : String(aiError)
      console.warn('[SOW] OpenAI generation failed, falling back to rule-based sections:', msg)
      // Persist a system log so we can diagnose silent fallbacks. The visible
      // symptom is "rule-based output dumps raw parsed-PDF text as bullets";
      // without this log it's impossible to tell from a SOW alone whether the
      // AI ran successfully or threw.
      try {
        await prisma.systemLog.create({
          data: {
            level: 'WARNING',
            message: 'SOW OpenAI generation failed — used rule-based fallback',
            context: {
              opportunityId: opportunity.id,
              solicitationNumber: opportunity.solicitationNumber,
              error: msg,
              hasParsedContent,
              descLength,
            },
          },
        })
      } catch {}
      aiSections = [
        buildBackgroundSection(opportunity),
        buildScopeSection(opportunity, hasParsedContent, structured),
        buildPlaceOfPerformanceSection(popText),
        buildQuoteSubmissionSection(quoteDeadline, primeCompany),
        buildDeliverablesSection(opportunity, hasParsedContent, structured),
        buildComplianceSection(opportunity, raw, hasParsedContent, structured),
      ]
    }
  }

  // Append data-driven sections — only when they'd carry genuine, condensed
  // value for the sub. Previously these were generated from raw parsed-PDF
  // text and bloated the SOW from 6 useful sections to 10 noisy ones.
  //
  // Evaluation, Qualifications, and FAR Quick Reference are PRIME-bid concerns,
  // not sub-quote concerns. A sub does not care how the federal government
  // will evaluate the prime's proposal. Drop them from the sub-facing SOW.
  // FAR clauses still flow down to the sub through Compliance Pass-Through.
  const dataSections = [
    buildResponseRequirementsSection(aiSections.length + 1, quoteDeadline, primeCompany),
  ]
  // Silence unused-fn warnings; kept for future internal-use SOW variants.
  void buildEvaluationSection
  void buildQualificationsSection
  void buildFARSection
  void farClauses

  const content = {
    opportunity: {
      title: opportunity.title,
      solicitationNumber: opportunity.solicitationNumber,
      agency: opportunity.agency || raw.fullParentPathName || 'Federal Government',
      naicsCode: opportunity.naicsCode || raw.naicsCode || null,
      naicsCodes: raw.naicsCodes || [],
      type: raw.type || raw.baseType || null,
      setAside,
      classificationCode: raw.classificationCode || null,
      // Internal quote-to-prime deadline (not the federal response deadline).
      // Surfaced to the sub as "Quote due" in the SOW header.
      quoteDeadline,
      placeOfPerformance: popText,
      primeCompany: primeCompany || null,
    },
    scope: {
      overview: hasParsedContent && structured!.scope.length > 0
        ? structured!.scope.join('\n\n')
        : opportunity.description || 'Refer to solicitation attachments for full scope.',
    },
    subcontractor: subcontractor ? {
      name: subcontractor.name,
      address: subcontractor.address || null,
      phone: subcontractor.phone || null,
      email: subcontractor.email || null,
      service: subcontractor.service || null,
    } : null,
    sections: [...aiSections, ...dataSections],
    attachments: attachments.map(a => ({ name: a.name, url: a.url })),
    sourceEnhanced: !!hasParsedContent,
    generatedAt: new Date().toISOString(),
  }

  return content
}

// === Section Builders (return structured format: summary + bullets + details) ===

function buildBackgroundSection(opportunity: any) {
  const desc = opportunity.description || 'Background details to be added.'
  return {
    title: '1.0 WHAT WE NEED',
    summary: `What the prime needs the sub to supply for "${opportunity.title}".`,
    bullets: [
      `Item / service: ${opportunity.title}`,
      `End customer: ${opportunity.agency || 'Federal Government'}`,
      ...(opportunity.naicsCode ? [`NAICS reference: ${opportunity.naicsCode}`] : []),
    ],
    details: desc,
  }
}

// Placeholder we surface to the user when source data is missing. Better than
// inventing plausible-sounding filler that the user can't tell is wrong.
const NEEDS_DETAIL = (what: string) => `[NEEDS DETAIL: ${what}]`

/**
 * Condense a raw parsed-PDF text fragment into a single short bullet.
 * The parser yields paragraph fragments straight from PDFs — long, often
 * mid-sentence, sometimes containing newlines and page-break artifacts.
 * Without this, scope/deliverables bullets look like raw OCR dumps.
 */
function condenseToBullet(raw: string, maxChars = 100): string | null {
  if (!raw) return null
  // Strip newlines + collapse whitespace
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (cleaned.length < 10) return null
  // Skip obvious page artifacts: "UNCLASSIFIED", page numbers, section markers
  if (/^(UNCLASSIFIED|CLASSIFIED|DRAFT|DoDI|Table \d|Figure \d|Appendix [A-Z]|^\(\d+\)|^[a-z]\)|Block \d|Column \(\d+\))/i.test(cleaned)) return null
  // Take just the first sentence; if too long, truncate at word boundary
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]
  const candidate = firstSentence.length > maxChars
    ? firstSentence.slice(0, maxChars).replace(/\s+\S*$/, '') + '…'
    : firstSentence
  if (candidate.length < 10) return null
  return candidate
}

function condenseScopeItems(items: string[], max = 4): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const c = condenseToBullet(item)
    if (!c) continue
    const key = c.toLowerCase().slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
    if (out.length >= max) break
  }
  return out
}

function buildScopeSection(opportunity: any, hasParsed: boolean, structured: StructuredContent | null) {
  if (hasParsed && structured!.scope.length > 0) {
    const bullets = condenseScopeItems(structured!.scope, 4)
    if (bullets.length > 0) {
      return {
        title: '2.0 SCOPE OF SERVICES',
        summary: 'Requirements from the solicitation.',
        bullets,
      }
    }
  }

  const desc = opportunity.description || ''
  if (desc.length > 100) {
    const bullets = extractBulletsFromText(desc).slice(0, 4)
    if (bullets.length > 0) {
      return {
        title: '2.0 SCOPE OF SERVICES',
        summary: 'Derived from the opportunity description.',
        bullets,
      }
    }
  }

  return {
    title: '2.0 SCOPE OF SERVICES',
    summary: 'Needs detail from the solicitation.',
    bullets: [
      NEEDS_DETAIL('what the sub will perform — parse the solicitation or add manually'),
    ],
  }
}

function buildPlaceOfPerformanceSection(popText: string) {
  const isVague = !popText || popText === 'Per solicitation' || popText.trim() === ''
  return {
    title: '3.0 PLACE OF PERFORMANCE',
    summary: isVague ? 'Needs detail from the solicitation.' : `Work location: ${popText}`,
    bullets: isVague
      ? [NEEDS_DETAIL('delivery address or work site — parse the solicitation or add manually')]
      : [`Primary location: ${popText}`],
  }
}

function buildQuoteSubmissionSection(quoteDeadline: string, primeCompany?: string) {
  const prime = primeCompany || 'the prime contractor'
  return {
    title: '4.0 QUOTE SUBMISSION',
    summary: `Return your quote to ${prime} by ${quoteDeadline}.`,
    bullets: [
      `Quote due to ${prime}: ${quoteDeadline}`,
      `Submit by email to your prime point of contact`,
      `Include firm fixed-price total (materials, labor, shipping, taxes, fees)`,
      `State lead time / delivery schedule from receipt of order`,
      `Flag any exceptions, assumptions, or clarifying questions`,
    ],
    details: `Send your quote to ${prime} by ${quoteDeadline} so we have time to compare quotes and finalize our bid. This deadline is internal to ${prime} — you do not submit anything to the end customer.`,
  }
}

function buildDeliverablesSection(opportunity: any, hasParsed: boolean, structured: StructuredContent | null) {
  if (hasParsed && structured!.deliverables.length > 0) {
    const bullets = condenseScopeItems(structured!.deliverables, 4)
    if (bullets.length > 0) {
      return {
        title: '5.0 DELIVERABLES',
        summary: 'Deliverables from the solicitation.',
        bullets,
      }
    }
  }

  // Keyword scan of the description gives us grounded hints (the verb actually
  // appeared in the opportunity text). Anything beyond that is invention.
  const desc = (opportunity.description || '').toLowerCase()
  const deliverables: string[] = []

  if (desc.includes('report')) deliverables.push('Progress and final reports as specified in the solicitation')
  if (desc.includes('install')) deliverables.push('Completed installation per solicitation specifications')
  if (desc.includes('repair')) deliverables.push('Completed repairs verified and documented')
  if (desc.includes('maintenance') || desc.includes('service')) deliverables.push('Maintenance/service completion documentation')
  if (desc.includes('train')) deliverables.push('Training materials and completion records')
  if (desc.includes('design')) deliverables.push('Design documents and drawings')
  if (desc.includes('construct')) deliverables.push('Construction completion per plans and specifications')
  if (desc.includes('deliver')) deliverables.push('Items delivered per solicitation schedule')
  if (desc.includes('test') || desc.includes('inspect')) deliverables.push('Test/inspection reports and certifications')

  if (deliverables.length === 0) {
    return {
      title: '5.0 DELIVERABLES',
      summary: 'Needs detail from the solicitation.',
      bullets: [
        NEEDS_DETAIL('specific deliverables, formats, and frequencies — parse the solicitation attachments or add manually'),
      ],
    }
  }

  return {
    title: '5.0 DELIVERABLES',
    summary: `${deliverables.length} deliverable(s) inferred from the opportunity description.`,
    bullets: deliverables,
  }
}

function buildComplianceSection(
  opportunity: any,
  raw: any,
  hasParsed: boolean,
  structured: StructuredContent | null
) {
  const bullets: string[] = []

  if (raw.typeOfSetAside || raw.typeOfSetAsideDescription) {
    bullets.push(`Set-Aside: ${raw.typeOfSetAsideDescription || raw.typeOfSetAside}`)
  }
  if (opportunity.naicsCode) {
    const sizeStandard = getNaicsSizeStandard(opportunity.naicsCode)
    bullets.push(
      sizeStandard
        ? `NAICS ${opportunity.naicsCode} — size standard ${sizeStandard}`
        : `NAICS Code: ${opportunity.naicsCode}`
    )
  }
  if (raw.classificationCode) {
    bullets.push(`Product/Service Classification (PSC): ${raw.classificationCode}`)
  }

  // Compliance is the worst-hit by raw parser output — agency docs contain
  // hundreds of compliance-shaped sentences. Apply the same condensation as
  // scope/deliverables: strip artifacts, first-sentence, ≤100 chars, cap at 3.
  // Combined with the rule-based set-aside / NAICS / PSC, total stays ≤6.
  if (hasParsed && structured!.compliance.length > 0) {
    const seen = new Set(bullets.map((b) => b.toLowerCase().slice(0, 40)))
    const condensed = condenseScopeItems(structured!.compliance, 6)
    for (const c of condensed) {
      const key = c.toLowerCase().slice(0, 40)
      if (seen.has(key)) continue
      seen.add(key)
      bullets.push(c)
      if (bullets.length >= 6) break
    }
  }

  if (bullets.length === 0) {
    bullets.push(NEEDS_DETAIL('compliance pass-through items — parse the solicitation or add manually'))
  }

  return {
    title: '6.0 COMPLIANCE REQUIREMENTS',
    summary: bullets.length === 1 && bullets[0].startsWith('[NEEDS DETAIL')
      ? 'Needs detail from the solicitation.'
      : 'Regulatory items that flow down to the sub.',
    bullets,
  }
}

// Minimal NAICS size standard lookup for common contracting codes — used only
// to enrich the compliance bullet when the NAICS is recognized.
function getNaicsSizeStandard(naics: string): string | null {
  const sizes: Record<string, string> = {
    '541330': '$25.5M', '541511': '$34M', '541512': '$34M', '541519': '$34M',
    '541611': '$25.5M', '541614': '$22M', '541618': '$24.5M', '541690': '$22M',
    '541713': '1,000 employees', '541714': '1,000 employees', '541715': '1,000 employees',
    '561210': '$47M', '561612': '$25M', '561621': '$22M',
    '236220': '$45M', '237310': '$45M', '238910': '$19M',
    '334111': '1,250 employees', '334118': '1,250 employees', '334413': '1,250 employees',
  }
  return sizes[naics] || null
}

// buildAttachmentsSection intentionally removed — solicitation attachments
// travel as a separate bundle alongside the SOW in the email panel and are
// not embedded as a section within the SOW document itself.

function buildEvaluationSection(structured: StructuredContent) {
  return {
    title: '7.0 EVALUATION CRITERIA',
    summary: 'How proposals will be evaluated.',
    bullets: structured.evaluation.map(e => e.length > 200 ? e.substring(0, 200) + '...' : e),
  }
}

function buildQualificationsSection(structured: StructuredContent, hasEvaluation: boolean) {
  const num = hasEvaluation ? 8 : 7
  return {
    title: `${num}.0 QUALIFICATIONS & PERSONNEL`,
    summary: 'Required qualifications and personnel requirements.',
    bullets: structured.qualifications.map(q => q.length > 200 ? q.substring(0, 200) + '...' : q),
  }
}

function buildFARSection(farClauses: string[], hasEvaluation: boolean, hasQualifications: boolean) {
  let num = 7
  if (hasEvaluation) num++
  if (hasQualifications) num++
  return {
    title: `${num}.0 FAR QUICK REFERENCE`,
    summary: `${farClauses.length} FAR clause(s) referenced in this solicitation.`,
    bullets: farClauses,
  }
}

/**
 * Always-appended section: tells the subcontractor exactly what to send back to the prime.
 * Includes a capability statement request so the prime can evaluate fit before forwarding.
 */
function buildResponseRequirementsSection(sectionNumber: number, quoteDeadline: string, primeCompany?: string) {
  const prime = primeCompany || 'the prime'
  return {
    title: `${sectionNumber}.0 WHAT TO SEND BACK`,
    summary: `What ${prime} needs from you, and by when.`,
    overview: `Email everything below to ${prime} by ${quoteDeadline}. ${prime} uses your capability statement to confirm fit before working your quote into the federal bid — include past performance on similar work and any certifications relevant to this scope. Quotes returned after the deadline may not make it into the prime's submission.`,
    bullets: [
      `Capability statement — 1–2 pages, past performance + competencies + certifications + key personnel`,
      `Firm fixed-price quote — all-inclusive (materials, labor, shipping, taxes, fees)`,
      `Lead time and delivery schedule from receipt of order`,
      `Any exceptions, assumptions, or clarifying questions`,
      `Your point of contact (name, title, email, direct phone)`,
    ],
  }
}

// === Utility Functions ===

/**
 * Extract FAR clause references (e.g., "FAR 52.212-1") from text.
 */
function extractFARClauses(description: string | null, structured: StructuredContent | null): string[] {
  const text = [
    description || '',
    ...(structured?.compliance || []),
    ...(structured?.scope || []),
  ].join(' ')

  const farPattern = /(?:FAR|DFARS?|AFARS?|VAAR)\s*(?:\d{1,2}\.\d{3}(?:-\d+)?)/gi
  const matches = text.match(farPattern) || []

  // Deduplicate
  const unique = [...new Set(matches.map(m => m.toUpperCase().replace(/\s+/g, ' ')))]
  return unique
}

/**
 * Extract bullet-like items from a block of text.
 */
function extractBulletsFromText(text: string): string[] {
  const bullets: string[] = []

  // Look for numbered items, dash items, or sentences that read like requirements
  const lines = text.split(/\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Numbered or bulleted lines
    if (/^[\d]+[.)]\s/.test(trimmed) || /^[-•*]\s/.test(trimmed)) {
      const clean = trimmed.replace(/^[\d]+[.)]\s*/, '').replace(/^[-•*]\s*/, '')
      if (clean.length > 10 && clean.length < 300) {
        bullets.push(clean)
      }
    }
  }

  // If no structured bullets found, split long text into sentence-based bullets
  if (bullets.length === 0) {
    const sentences = text.split(/[.]\s+/).filter(s => s.trim().length > 20)
    for (const s of sentences.slice(0, 8)) {
      const clean = s.trim()
      if (clean.length > 10 && clean.length < 300) {
        bullets.push(clean.endsWith('.') ? clean : clean + '.')
      }
    }
  }

  return bullets.slice(0, 10)
}

/**
 * POST /api/sows — Generate a new SOW from real opportunity data
 */
export async function POST(req: Request) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { opportunityId, subcontractorId, notes, selectedAttachments } = body

    if (!opportunityId) {
      return NextResponse.json({ error: 'Opportunity ID is required' }, { status: 400 })
    }

    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: {
        subcontractors: subcontractorId
          ? { where: { id: subcontractorId } }
          : { take: 1 },
      },
    }) as any // Cast to any since parsedAttachments is used dynamically

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const subcontractor = subcontractorId
      ? await prisma.subcontractor.findUnique({ where: { id: subcontractorId } })
      : opportunity.subcontractors[0] || null

    // Auto-parse attachments if not already parsed — this ensures SOW
    // always has real solicitation content instead of generic placeholders
    if (!opportunity.parsedAttachments) {
      const rawAttachments = extractAttachmentsFromRawData(opportunity.rawData)
      if (rawAttachments.length > 0) {
        try {
          console.log(`[SOW] Auto-parsing ${rawAttachments.length} attachments before SOW generation`)
          const parsed = await parseAllAttachments(rawAttachments)
          const successCount = parsed.filter(p => p.text.length > 0).length

          if (successCount > 0) {
            const structured = mergeStructuredContent(parsed)
            const parsedResult = {
              parsed: parsed.map(p => ({
                name: p.name,
                textLength: p.text.length,
                pageCount: p.pageCount,
                preview: p.text.substring(0, 500),
                fullText: p.text,
                error: p.error,
              })),
              structured,
              totalAttachments: rawAttachments.length,
              parsedCount: successCount,
              parsedAt: new Date().toISOString(),
            }

            // Cache in DB
            await prisma.opportunity.update({
              where: { id: opportunityId },
              data: { parsedAttachments: JSON.parse(JSON.stringify(parsedResult)) },
            })

            // Update the in-memory opportunity object so generateSOWContent uses it
            ;(opportunity as any).parsedAttachments = parsedResult
            console.log(`[SOW] Parsed ${successCount}/${rawAttachments.length} attachments successfully`)
          }
        } catch (parseError) {
          console.warn('[SOW] Attachment auto-parse failed, proceeding with available data:', parseError)
        }
      }
    }

    // Prime company name — prefer authenticated user's organization, fall back to user name.
    // This is what the sub sees as "Quote due to ___".
    const primeCompany =
      (session.user as { organization?: string; name?: string }).organization ||
      session.user.name ||
      undefined

    // Generate structured SOW content (OpenAI for copy, rule-based for data sections)
    const content = await generateSOWContent(opportunity, subcontractor, selectedAttachments, primeCompany)

    const fileName = generateSOWFileName(opportunity.solicitationNumber, 1)

    // Create SOW record — content stored as structured JSON, no PDF dependency
    const sow = await prisma.sOW.create({
      data: {
        opportunityId,
        fileName,
        content: JSON.parse(JSON.stringify(content)),
        status: 'DRAFT',
        generatedById: session.user.id,
        notes,
        version: 1,
        metadata: {
          subcontractorId: subcontractor?.id,
          subcontractorName: subcontractor?.name,
          generatedAt: new Date().toISOString(),
        },
      },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            solicitationNumber: true,
            agency: true,
          },
        },
        generatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    // Create activity record
    await prisma.sOWActivity.create({
      data: {
        sowId: sow.id,
        type: 'CREATED',
        description: `SOW created for ${opportunity.title}`,
        userId: session.user.id,
        metadata: {
          opportunityId: opportunity.id,
          solicitationNumber: opportunity.solicitationNumber,
        },
      },
    })

    // Update progress
    await prisma.opportunityProgress.upsert({
      where: { opportunityId },
      create: {
        opportunityId,
        currentStage: 'SOW_CREATION',
        completionPct: 40,
      },
      update: {
        currentStage: 'SOW_CREATION',
        completionPct: 40,
      },
    })

    return NextResponse.json({ success: true, sow })
  } catch (error) {
    console.error('Error generating SOW:', error)

    try {
      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          message: 'SOW generation failed',
          context: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      })
    } catch {}

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/sows — List SOWs
 */
export async function GET(req: Request) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const opportunityId = searchParams.get('opportunityId')
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    const where: any = {}

    if (opportunityId) where.opportunityId = opportunityId
    if (status) where.status = status

    if (search) {
      where.OR = [
        { fileName: { contains: search, mode: 'insensitive' } },
        { opportunity: { title: { contains: search, mode: 'insensitive' } } },
        { opportunity: { solicitationNumber: { contains: search, mode: 'insensitive' } } },
      ]
    }

    if (session.user.role !== 'ADMIN') {
      // Use AND to combine with search OR if present
      const roleFilter = {
        OR: [
          { generatedById: session.user.id },
          { currentApproverId: session.user.id },
        ],
      }
      if (where.OR) {
        // Both search and role filter need OR — use AND to combine them
        const searchFilter = { OR: where.OR }
        delete where.OR
        where.AND = [searchFilter, roleFilter]
      } else {
        where.OR = roleFilter.OR
      }
    }

    const total = await prisma.sOW.count({ where })

    const sows = await prisma.sOW.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            solicitationNumber: true,
            agency: true,
          },
        },
        generatedBy: {
          select: { id: true, name: true, email: true },
        },
        currentApprover: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { approvals: true, versions: true, activities: true },
        },
      },
    })

    return NextResponse.json({
      success: true,
      sows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching SOWs:', error)

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
