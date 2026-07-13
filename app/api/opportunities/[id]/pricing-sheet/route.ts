import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { computePricingSheet } from '@/lib/pricing'
import type {
  ResourcePlan,
  PricingSheet,
  MarginBands,
} from '@/lib/types/resource-plan'
import { DEFAULT_MARGIN_BANDS } from '@/lib/types/resource-plan'

interface PricingSheetPatchBody {
  userOverrideMarginPct?: number | null
  marginBands?: MarginBands
}

/**
 * PATCH — Update the user's margin slider override or the margin bands.
 * Recomputes and persists the pricing sheet. `undefined` keys are left alone;
 * an explicit `null` for `userOverrideMarginPct` resets the override.
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
    const body = (await req.json()) as PricingSheetPatchBody

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, resourcePlan: true, pricingSheet: true },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const plan = opportunity.resourcePlan as ResourcePlan | null
    if (!plan) {
      return NextResponse.json(
        { error: 'Generate a resource plan first' },
        { status: 400 }
      )
    }

    const existingSheet = opportunity.pricingSheet as PricingSheet | null

    const bands: MarginBands = body.marginBands
      ? {
          low: body.marginBands.low,
          medium: body.marginBands.medium,
          high: body.marginBands.high,
        }
      : existingSheet?.marginBands ?? DEFAULT_MARGIN_BANDS

    // Distinguish undefined (key omitted → keep existing) from null (explicit reset)
    const hasOverrideKey = Object.prototype.hasOwnProperty.call(body, 'userOverrideMarginPct')
    const override: number | null = hasOverrideKey
      ? body.userOverrideMarginPct ?? null
      : existingSheet?.userOverrideMarginPct ?? null

    const sheet = computePricingSheet(plan, bands, override)

    await prisma.opportunity.update({
      where: { id },
      data: { pricingSheet: sheet as object },
    })

    return NextResponse.json({ pricingSheet: sheet })
  } catch (error) {
    console.error('[PricingSheet] Patch error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to update pricing sheet'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
