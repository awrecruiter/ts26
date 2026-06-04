import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  generateOpportunityArtifacts,
  type ArtifactKey,
  type OpportunityArtifacts,
} from '@/lib/openai'
import { extractAttachmentsFromRawData } from '@/lib/samgov'
import type { ParsedAttachment } from '@/lib/attachment-parser'
import { format, addDays } from 'date-fns'

const VALID_ARTIFACTS: ArtifactKey[] = ['brief', 'callChecklist', 'scopeOverview', 'agentBriefing', 'attachmentRelevance']

/**
 * Compute the quote-to-prime deadline for context (matches sows/route.ts policy:
 * target = today+5, floor = today+2, buffer = federalDeadline-5).
 */
function computeQuoteDeadline(responseDeadline: Date | null): Date {
  const today = new Date()
  const target = addDays(today, 5)
  const floor = addDays(today, 2)
  if (!responseDeadline) return target
  const buffered = addDays(responseDeadline, -5)
  const earliest = buffered < target ? buffered : target
  return earliest < floor ? floor : earliest
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const url = new URL(req.url)
    const artifactParam = url.searchParams.get('artifact')
    let only: ArtifactKey[] | undefined
    if (artifactParam && artifactParam !== 'all') {
      const keys = artifactParam.split(',').map(s => s.trim()).filter(Boolean) as ArtifactKey[]
      const invalid = keys.find(k => !VALID_ARTIFACTS.includes(k))
      if (invalid) {
        return NextResponse.json(
          { error: `Invalid artifact key: ${invalid}. Valid: ${VALID_ARTIFACTS.join(', ')}` },
          { status: 400 }
        )
      }
      only = keys
    }

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        agency: true,
        solicitationNumber: true,
        naicsCode: true,
        description: true,
        responseDeadline: true,
        state: true,
        rawData: true,
        parsedAttachments: true,
        aiArtifacts: true,
      },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'Artifact generation requires OPENAI_API_KEY.' },
        { status: 503 }
      )
    }

    const rawData = opportunity.rawData as Record<string, unknown> | null
    const setAside =
      (rawData?.typeOfSetAsideDescription as string) ||
      (rawData?.typeOfSetAside as string) ||
      (rawData?.setAside as string) ||
      null

    const pop = rawData?.placeOfPerformance as
      | { city?: { name?: string }; state?: { name?: string; code?: string }; country?: { name?: string } }
      | undefined
    const popText = pop
      ? [pop.city?.name, pop.state?.name || pop.state?.code, pop.country?.name].filter(Boolean).join(', ')
      : opportunity.state || null

    const quoteDeadline = format(
      computeQuoteDeadline(opportunity.responseDeadline ? new Date(opportunity.responseDeadline) : null),
      'MMMM d, yyyy'
    )

    const existing = opportunity.aiArtifacts as OpportunityArtifacts | null

    // Assemble attachments + their parsed text excerpts (when cached) for the
    // attachmentRelevance classifier. Names use the user's override if any.
    const samAttachments = rawData ? extractAttachmentsFromRawData(rawData) : []
    const overrides = await prisma.attachmentOverride.findMany({
      where: { opportunityId: id },
      select: { attachmentId: true, currentName: true },
    })
    const overrideMap = new Map(overrides.map(o => [o.attachmentId, o.currentName]))
    const parsedList = ((opportunity.parsedAttachments as { parsed?: ParsedAttachment[] } | null)?.parsed) ?? []
    const parsedByName = new Map(parsedList.map(p => [p.name, p.text || '']))
    const attachmentsForAI = samAttachments.map(a => ({
      id: a.id,
      originalName: a.name,
      currentName: overrideMap.get(a.id),
      textContent: parsedByName.get(a.name) || undefined,
    }))

    const artifacts = await generateOpportunityArtifacts(
      {
        title: opportunity.title,
        agency: opportunity.agency || 'Unknown Agency',
        solicitationNumber: opportunity.solicitationNumber,
        naicsCode: opportunity.naicsCode,
        setAside,
        quoteDeadline,
        placeOfPerformance: popText,
        description: opportunity.description,
        rawData,
        parsedAttachments: opportunity.parsedAttachments as {
          structured?: {
            scope?: string[]
            deliverables?: string[]
            compliance?: string[]
            periodOfPerformance?: string[]
            qualifications?: string[]
            placeOfPerformance?: string
            keyFacts?: {
              clearances?: string[]
              certifications?: string[]
              farClauses?: string[]
              locations?: string[]
              contractTypes?: string[]
            }
          }
        } | null,
        attachments: attachmentsForAI,
      },
      { only, existing }
    )

    // Persist. Also mirror brief + agentBriefing into their legacy columns so
    // existing UI that reads opportunity.opportunityBrief / .agentBriefing
    // keeps working until we migrate those readers.
    await prisma.opportunity.update({
      where: { id },
      data: {
        aiArtifacts: artifacts as object,
        ...(artifacts.brief ? { opportunityBrief: artifacts.brief as object } : {}),
        ...(artifacts.agentBriefing ? { agentBriefing: artifacts.agentBriefing as object } : {}),
      },
    })

    return NextResponse.json({ artifacts })
  } catch (error) {
    console.error('Artifacts generation error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to generate artifacts'
    const status = (error as { status?: number })?.status
    if (status === 429 || /quota|rate limit|insufficient_quota/i.test(msg)) {
      return NextResponse.json(
        { error: 'OpenAI quota exceeded — add credits at platform.openai.com/billing, then retry.' },
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
