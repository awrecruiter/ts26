import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateResourcePlan } from '@/lib/openai'
import { computePricingSheet } from '@/lib/pricing'
import type {
  ResourceLine,
  ResourcePlan,
  PricingSheet,
  MarginBands,
  ContractType,
} from '@/lib/types/resource-plan'
import { DEFAULT_MARGIN_BANDS } from '@/lib/types/resource-plan'
import type { OpportunityArtifacts } from '@/lib/openai'
import type { OpportunityBrief } from '@/lib/openai'

type ParsedAttachmentsShape = {
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
} | null

/**
 * POST — Generate a fresh resource plan and pricing sheet.
 * Persists both onto the opportunity. Existing user margin overrides are NOT
 * preserved here (this is a fresh plan). PATCH preserves them.
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
        { error: 'Resource plan generation requires OPENAI_API_KEY.' },
        { status: 503 }
      )
    }

    const rawData = opportunity.rawData as Record<string, unknown> | null
    const setAside =
      (rawData?.typeOfSetAsideDescription as string) ||
      (rawData?.typeOfSetAside as string) ||
      (rawData?.setAside as string) ||
      null

    const artifacts = opportunity.aiArtifacts as OpportunityArtifacts | null
    const brief =
      (artifacts?.brief as OpportunityBrief | undefined) ??
      (opportunity.opportunityBrief as OpportunityBrief | null) ??
      null

    const plan = await generateResourcePlan({
      title: opportunity.title,
      agency: opportunity.agency || 'Unknown Agency',
      solicitationNumber: opportunity.solicitationNumber,
      contractType: (opportunity.contractType as ContractType) || 'SERVICES',
      naicsCode: opportunity.naicsCode,
      setAside,
      description: opportunity.description,
      rawData,
      parsedAttachments: opportunity.parsedAttachments as ParsedAttachmentsShape,
      brief,
    })

    const sheet = computePricingSheet(plan, DEFAULT_MARGIN_BANDS, null)

    await prisma.opportunity.update({
      where: { id },
      data: {
        resourcePlan: plan as object,
        pricingSheet: sheet as object,
      },
    })

    console.log(`[ResourcePlan] Generated for ${id}: ${plan.lines.length} lines`)

    return NextResponse.json({ resourcePlan: plan, pricingSheet: sheet })
  } catch (error) {
    console.error('[ResourcePlan] Generation error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to generate resource plan'
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

interface ResourcePlanPatchBody {
  lines?: ResourceLine[]
  primeCoordinationHours?: number | null
  bondingRequired?: boolean
  insuranceMinimums?: string[]
}

/**
 * PATCH — Edit the existing resource plan. Merges scalar fields; replaces the
 * whole `lines` array when provided. Recomputes the pricing sheet while
 * preserving the user's margin band edits and slider override.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = (await req.json()) as ResourcePlanPatchBody

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, resourcePlan: true, pricingSheet: true },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const existingPlan = opportunity.resourcePlan as ResourcePlan | null
    if (!existingPlan) {
      return NextResponse.json(
        { error: 'No resource plan exists yet — generate one first' },
        { status: 400 }
      )
    }

    const mergedPlan: ResourcePlan = {
      lines: Array.isArray(body.lines) ? body.lines : existingPlan.lines,
      primeCoordinationHours:
        body.primeCoordinationHours !== undefined
          ? body.primeCoordinationHours
          : existingPlan.primeCoordinationHours ?? null,
      bondingRequired:
        typeof body.bondingRequired === 'boolean'
          ? body.bondingRequired
          : existingPlan.bondingRequired,
      insuranceMinimums: Array.isArray(body.insuranceMinimums)
        ? body.insuranceMinimums
        : existingPlan.insuranceMinimums,
      generatedAt: existingPlan.generatedAt,
      modelVersion: existingPlan.modelVersion,
    }

    const existingSheet = opportunity.pricingSheet as PricingSheet | null
    const bands: MarginBands = existingSheet?.marginBands ?? DEFAULT_MARGIN_BANDS
    const override: number | null = existingSheet?.userOverrideMarginPct ?? null

    const sheet = computePricingSheet(mergedPlan, bands, override)

    await prisma.opportunity.update({
      where: { id },
      data: {
        resourcePlan: mergedPlan as object,
        pricingSheet: sheet as object,
      },
    })

    return NextResponse.json({ resourcePlan: mergedPlan, pricingSheet: sheet })
  } catch (error) {
    console.error('[ResourcePlan] Patch error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to update resource plan'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
