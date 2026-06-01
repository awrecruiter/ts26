import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getOpportunityAttachments } from '@/lib/samgov'
import { analyzeAttachments } from '@/lib/openai'
import { parseAllAttachments, mergeStructuredContent } from '@/lib/attachment-parser'

/**
 * POST /api/opportunities/[id]/attachments/analyze
 *
 * Analyzes all attachments for this opportunity using GPT-4o:
 * - Suggests human-readable names with confidence levels
 * - Detects standard government forms (SF-1449, DD-254, etc.)
 *
 * Skips attachments that have already been analyzed OR have a manual rename.
 * Upserts AttachmentFormData records.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const url = new URL(request.url)
    const force = url.searchParams.get('force') === 'true'

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        solicitationNumber: true,
        rawData: true,
        parsedAttachments: true,
        attachmentOverrides: {
          select: { attachmentId: true, originalName: true, currentName: true },
        },
        attachmentFormData: {
          // Treat null suggestedName as "needs retry" — previous attempt failed.
          select: { attachmentId: true, aiSuggestedName: true },
        },
      },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Fetch raw attachment list from SAM.gov
    const rawAttachments = await getOpportunityAttachments(
      opportunity.solicitationNumber,
      opportunity.rawData
    )

    if (!rawAttachments.length) {
      return NextResponse.json({ analyzed: 0, skipped: 0 })
    }

    // Build sets for fast lookup — only treat as "analyzed" when the prior
    // attempt actually produced a name. Null suggestedName means the prior
    // analysis failed (OpenAI down, etc.) and should be retried.
    const alreadyAnalyzed = new Set(
      opportunity.attachmentFormData
        .filter((f) => !!f.aiSuggestedName)
        .map((f) => f.attachmentId)
    )
    const manualRenames = new Set(
      opportunity.attachmentOverrides
        .filter((o) => o.currentName !== o.originalName)
        .map((o) => o.attachmentId)
    )

    // Extract parsed text per attachment — keyed by filename (parsedAttachments stores by name, not id)
    let parsedData = opportunity.parsedAttachments as any
    let parsedTexts: Record<string, string> = {}
    const collectParsedTexts = () => {
      const out: Record<string, string> = {}
      if (parsedData?.parsed && Array.isArray(parsedData.parsed)) {
        for (const file of parsedData.parsed) {
          if (file.name && (file.fullText || file.preview)) {
            out[file.name] = (file.fullText || file.preview) as string
          }
        }
      }
      return out
    }
    parsedTexts = collectParsedTexts()

    // If no parsed content exists, parse now so the AI has document text to
    // name from. Without this, the AI either invents names (bad) or returns
    // null for everything (also bad).
    if (Object.keys(parsedTexts).length === 0) {
      try {
        const parsed = await parseAllAttachments(rawAttachments)
        const structured = mergeStructuredContent(parsed)
        const parseResult = {
          parsed: parsed.map((p) => ({
            name: p.name,
            textLength: p.text.length,
            pageCount: p.pageCount,
            preview: p.text.substring(0, 500),
            fullText: p.text,
            error: p.error,
          })),
          structured,
          totalAttachments: rawAttachments.length,
          parsedCount: parsed.filter((p) => p.text.length > 0).length,
          parsedAt: new Date().toISOString(),
        }
        await prisma.opportunity.update({
          where: { id },
          data: { parsedAttachments: JSON.parse(JSON.stringify(parseResult)) },
        })
        parsedData = parseResult
        parsedTexts = collectParsedTexts()
      } catch (parseErr) {
        console.warn('[analyze] Attachment parsing failed, continuing with filename-only:', parseErr)
      }
    }

    // Filter: skip manually-renamed; skip already-analyzed unless force=true
    const toAnalyze = rawAttachments.filter(
      (att) => !manualRenames.has(att.id) && (force || !alreadyAnalyzed.has(att.id))
    )

    const skipped = rawAttachments.length - toAnalyze.length

    if (!toAnalyze.length) {
      return NextResponse.json({ analyzed: 0, skipped })
    }

    // Call GPT-4o — pass up to 3000 chars so the AI sees past common
    // boilerplate headers (SF-30, SF-1449) into the actual subject matter.
    const analysisInputs = toAnalyze.map((att) => ({
      id: att.id,
      originalName: att.name,
      textContent: parsedTexts[att.name]?.slice(0, 3000),
    }))

    const results = await analyzeAttachments(analysisInputs)

    // Upsert AttachmentFormData for each result
    await Promise.all(
      results.map((r) =>
        prisma.attachmentFormData.upsert({
          where: { opportunityId_attachmentId: { opportunityId: id, attachmentId: r.id } },
          create: {
            opportunityId: id,
            attachmentId: r.id,
            aiSuggestedName: r.suggestedName,
            aiConfidence: r.confidence,
            isForm: r.isForm,
            formType: r.formType,
          },
          update: {
            aiSuggestedName: r.suggestedName,
            aiConfidence: r.confidence,
            isForm: r.isForm,
            formType: r.formType,
          },
        })
      )
    )

    return NextResponse.json({ analyzed: results.length, skipped })
  } catch (error) {
    console.error('Attachment analyze error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to analyze attachments'
    const status = (error as { status?: number })?.status
    if (status === 429 || /quota|rate limit|insufficient_quota/i.test(msg)) {
      return NextResponse.json(
        { error: 'OpenAI quota exceeded — content-based attachment names need GPT-4o. Add credits at platform.openai.com/billing and retry.' },
        { status: 503 }
      )
    }
    if (status === 401 || /invalid_api_key|incorrect api key/i.test(msg)) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is invalid — check the key in .env.local / Vercel.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
