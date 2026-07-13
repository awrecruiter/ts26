import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  generateOpportunityBrief,
  generateResourcePlan,
  generateAttachmentRelevance,
} from '@/lib/openai'
import type {
  OpportunityArtifacts,
  OpportunityBrief,
  AttachmentRelevanceMap,
} from '@/lib/openai'
import {
  extractAttachmentsFromRawData,
  type SamAttachment,
} from '@/lib/samgov'
import {
  parseAllAttachments,
  mergeStructuredContent,
  type ParsedAttachment,
} from '@/lib/attachment-parser'
import { computePricingSheet } from '@/lib/pricing'
import type { ResourcePlan, PricingSheet, ContractType } from '@/lib/types/resource-plan'
import { DEFAULT_MARGIN_BANDS } from '@/lib/types/resource-plan'

type ParsedAttachmentsCache = {
  parsed?: Array<{ name: string; textLength?: number; pageCount?: number; preview?: string; fullText?: string; error?: string }>
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
  totalAttachments?: number
  parsedCount?: number
  parsedAt?: string
} | null

type PassStatus = 'ok' | 'skipped' | string // "error: <msg>" also allowed

/**
 * POST — Orchestrate the four AI passes that "process" an opportunity:
 *   1. Parse solicitation attachments (only if not yet cached)
 *   2. Generate the Opportunity Brief
 *   3. Generate the Resource Plan (which drives the Pricing Sheet)
 *   4. Classify attachment relevance for the master subcontractor email
 *
 * Each pass is independent — failures do not cascade. Whatever succeeds is
 * persisted in a single Prisma update. The response includes per-pass status
 * so the UI can show partial success.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        agency: true,
        solicitationNumber: true,
        naicsCode: true,
        description: true,
        rawData: true,
        parsedAttachments: true,
        opportunityBrief: true,
        aiArtifacts: true,
        contractType: true,
      },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'Processing requires OPENAI_API_KEY.' },
        { status: 503 }
      )
    }

    const rawData = opportunity.rawData as Record<string, unknown> | null
    const setAside =
      (rawData?.typeOfSetAsideDescription as string) ||
      (rawData?.typeOfSetAside as string) ||
      (rawData?.setAside as string) ||
      null

    const existingArtifacts = opportunity.aiArtifacts as OpportunityArtifacts | null
    const existingBrief =
      (existingArtifacts?.brief as OpportunityBrief | undefined) ??
      (opportunity.opportunityBrief as OpportunityBrief | null) ??
      null

    // ─── Pass 1: attachment parsing ─────────────────────────────────────────
    // Only runs when the opportunity has no cached parsedAttachments AND the
    // rawData contains extractable attachments. Otherwise resolves to null.
    const existingParsed = opportunity.parsedAttachments as ParsedAttachmentsCache
    const samAttachments: SamAttachment[] = rawData ? extractAttachmentsFromRawData(rawData) : []
    const shouldParse = !existingParsed && samAttachments.length > 0

    const parsePromise: Promise<ParsedAttachmentsCache> = shouldParse
      ? (async () => {
          const parsed: ParsedAttachment[] = await parseAllAttachments(samAttachments)
          const structured = mergeStructuredContent(parsed)
          const payload: ParsedAttachmentsCache = {
            parsed: parsed.map((p) => ({
              name: p.name,
              textLength: p.text.length,
              pageCount: p.pageCount,
              preview: p.text.substring(0, 500),
              fullText: p.text,
              error: p.error,
            })),
            structured,
            totalAttachments: samAttachments.length,
            parsedCount: parsed.filter((p) => p.text.length > 0).length,
            parsedAt: new Date().toISOString(),
          }
          return payload
        })()
      : Promise.resolve(null)

    // Wait for parsing first (or resolve immediately) so downstream AI passes
    // can consume the freshly-parsed structured content when available.
    const parseSettled = await parseFinally(parsePromise)
    const freshParsed = parseSettled.value ?? null
    const effectiveParsedAttachments =
      freshParsed ??
      (existingParsed && {
        structured: existingParsed.structured,
      })

    // ─── Passes 2, 3, 4 in parallel ─────────────────────────────────────────
    const briefPromise = generateOpportunityBrief({
      title: opportunity.title,
      agency: opportunity.agency || 'Unknown Agency',
      solicitationNumber: opportunity.solicitationNumber,
      naicsCode: opportunity.naicsCode,
      setAside,
      description: opportunity.description,
      rawData,
      parsedAttachments: effectiveParsedAttachments ?? null,
    })

    const planPromise = generateResourcePlan({
      title: opportunity.title,
      agency: opportunity.agency || 'Unknown Agency',
      solicitationNumber: opportunity.solicitationNumber,
      contractType: (opportunity.contractType as ContractType) || 'SERVICES',
      naicsCode: opportunity.naicsCode,
      setAside,
      description: opportunity.description,
      rawData,
      parsedAttachments: effectiveParsedAttachments ?? null,
      brief: existingBrief,
    })

    // Attachment relevance requires the attachment list (id + name + optional
    // parsed excerpt). Skipped when there are no attachments at all.
    const overrides = await prisma.attachmentOverride.findMany({
      where: { opportunityId: id },
      select: { attachmentId: true, currentName: true },
    })
    const overrideMap = new Map(overrides.map((o) => [o.attachmentId, o.currentName]))
    const parsedList =
      freshParsed?.parsed ?? existingParsed?.parsed ?? []
    const parsedByName = new Map(
      parsedList.map((p) => [p.name, p.fullText || (p as { text?: string }).text || ''])
    )
    const attachmentsForAI = samAttachments.map((a) => ({
      id: a.id,
      originalName: a.name,
      currentName: overrideMap.get(a.id),
      textContent: parsedByName.get(a.name) || undefined,
    }))
    const relevancePromise: Promise<AttachmentRelevanceMap | null> =
      attachmentsForAI.length > 0
        ? generateAttachmentRelevance({
            attachments: attachmentsForAI,
            title: opportunity.title,
            agency: opportunity.agency || 'Unknown Agency',
          })
        : Promise.resolve(null)

    const [briefSettled, planSettled, relevanceSettled] = await Promise.allSettled([
      briefPromise,
      planPromise,
      relevancePromise,
    ])

    // ─── Reduce settled results ─────────────────────────────────────────────
    const status: {
      parsedAttachments: PassStatus
      brief: PassStatus
      resourcePlan: PassStatus
      pricingSheet: PassStatus
      attachmentRelevance: PassStatus
    } = {
      parsedAttachments: 'skipped',
      brief: 'skipped',
      resourcePlan: 'skipped',
      pricingSheet: 'skipped',
      attachmentRelevance: 'skipped',
    }

    if (shouldParse) {
      if (parseSettled.error) status.parsedAttachments = `error: ${parseSettled.error}`
      else if (freshParsed) status.parsedAttachments = 'ok'
    }

    let newBrief: OpportunityBrief | null = null
    if (briefSettled.status === 'fulfilled') {
      newBrief = briefSettled.value
      status.brief = 'ok'
    } else {
      status.brief = `error: ${errorMessage(briefSettled.reason)}`
    }

    let newPlan: ResourcePlan | null = null
    let newSheet: PricingSheet | null = null
    if (planSettled.status === 'fulfilled') {
      newPlan = planSettled.value
      newSheet = computePricingSheet(newPlan, DEFAULT_MARGIN_BANDS, null)
      status.resourcePlan = 'ok'
      status.pricingSheet = 'ok'
    } else {
      const msg = errorMessage(planSettled.reason)
      status.resourcePlan = `error: ${msg}`
      status.pricingSheet = `error: ${msg}`
    }

    let newRelevance: AttachmentRelevanceMap | null = null
    if (attachmentsForAI.length === 0) {
      status.attachmentRelevance = 'skipped'
    } else if (relevanceSettled.status === 'fulfilled' && relevanceSettled.value) {
      newRelevance = relevanceSettled.value
      status.attachmentRelevance = 'ok'
    } else if (relevanceSettled.status === 'rejected') {
      status.attachmentRelevance = `error: ${errorMessage(relevanceSettled.reason)}`
    }

    // ─── Persist whatever succeeded ─────────────────────────────────────────
    const updateData: Record<string, unknown> = {}

    if (freshParsed) {
      updateData.parsedAttachments = JSON.parse(JSON.stringify(freshParsed))
    }

    // Merge aiArtifacts: keep existing keys, layer new brief + relevance.
    const mergedArtifacts: OpportunityArtifacts = {
      ...(existingArtifacts ?? { generatedAt: new Date().toISOString() }),
      ...(newBrief ? { brief: newBrief } : {}),
      ...(newRelevance ? { attachmentRelevance: newRelevance } : {}),
      generatedAt: new Date().toISOString(),
    }
    if (newBrief || newRelevance) {
      updateData.aiArtifacts = mergedArtifacts as object
    }
    if (newBrief) {
      updateData.opportunityBrief = newBrief as object
    }
    if (newPlan && newSheet) {
      updateData.resourcePlan = newPlan as object
      updateData.pricingSheet = newSheet as object
    }

    let updated = opportunity
    if (Object.keys(updateData).length > 0) {
      updated = await prisma.opportunity.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          title: true,
          agency: true,
          solicitationNumber: true,
          naicsCode: true,
          description: true,
          rawData: true,
          parsedAttachments: true,
          opportunityBrief: true,
          aiArtifacts: true,
          contractType: true,
        },
      }) as typeof opportunity
    }

    console.log(
      `[Process] Opportunity ${id}: brief=${status.brief} plan=${status.resourcePlan} rel=${status.attachmentRelevance} parsed=${status.parsedAttachments}`
    )

    return NextResponse.json({ status, opportunity: updated })
  } catch (error) {
    console.error('[Process] Orchestration error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to process opportunity'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

async function parseFinally<T>(
  p: Promise<T>
): Promise<{ value: T | null; error: string | null }> {
  try {
    const value = await p
    return { value, error: null }
  } catch (err) {
    return { value: null, error: errorMessage(err) }
  }
}
