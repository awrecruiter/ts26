import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * Per-plan admin overrides + checkbox state.
 *
 * Shape stored in `opportunity.planOverrides`:
 *   {
 *     app: { overrides: { [fieldId]: string }, checks: { [key]: boolean } },
 *     ...
 *   }
 *
 * PATCH merges: fields not sent are preserved. Sending an empty string
 * removes an override; sending null on a check removes it. Callers save
 * on blur / toggle so writes are frequent — merge semantics keep them
 * cheap and race-safe.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const planKey = typeof body?.planKey === 'string' ? body.planKey : null
  if (!planKey) {
    return NextResponse.json({ error: 'planKey is required' }, { status: 400 })
  }

  const patchOverrides = (body.overrides ?? {}) as Record<string, string | null>
  const patchChecks = (body.checks ?? {}) as Record<string, boolean | null>

  const existing = await prisma.opportunity.findUnique({
    where: { id },
    select: { id: true, planOverrides: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const current = (existing.planOverrides as Record<string, unknown>) ?? {}
  const currentPlan = (current[planKey] as { overrides?: Record<string, string>; checks?: Record<string, boolean> }) ?? {}
  const nextOverrides = { ...(currentPlan.overrides ?? {}) }
  const nextChecks = { ...(currentPlan.checks ?? {}) }

  for (const [k, v] of Object.entries(patchOverrides)) {
    if (v == null || v === '') delete nextOverrides[k]
    else nextOverrides[k] = String(v)
  }
  for (const [k, v] of Object.entries(patchChecks)) {
    if (v == null) delete nextChecks[k]
    else nextChecks[k] = !!v
  }

  const nextPlanData = {
    ...current,
    [planKey]: { overrides: nextOverrides, checks: nextChecks },
  }

  const updated = await prisma.opportunity.update({
    where: { id },
    data: { planOverrides: nextPlanData },
    select: { id: true, planOverrides: true },
  })

  return NextResponse.json(updated)
}
