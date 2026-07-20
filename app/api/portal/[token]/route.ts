import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolvePortalToken } from '@/lib/requirements/portal-tokens'
import { getTemplate } from '@/lib/requirements/templates'

// Public endpoint — auth is the portal token in the URL. Returns the cycle,
// its task instances, and the templates the client needs to render them.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await resolvePortalToken(token)

  if (!result.ok) {
    return NextResponse.json({
      error: result.reason,
      message: result.reason === 'not_found'
        ? 'This portal link is not valid.'
        : 'This portal link has expired. Ask the prime contractor to resend it.',
    }, { status: 410 })
  }

  // Touch lastUsedAt so the prime can see the sub actually opened the portal.
  await prisma.paymentCyclePortalToken.update({
    where: { id: result.record.id },
    data: { lastUsedAt: new Date() },
  })

  const { cycle } = result.record
  const templates = cycle.requirements
    .map(r => getTemplate(r.templateKey))
    .filter((t): t is NonNullable<ReturnType<typeof getTemplate>> => Boolean(t))

  return NextResponse.json({
    success: true,
    token,
    cycle: {
      id: cycle.id,
      periodLabel: cycle.periodLabel,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      status: cycle.status,
    },
    opportunity: cycle.opportunity,
    subcontractor: cycle.subcontractor,
    requirements: cycle.requirements.map(r => ({
      id: r.id,
      templateKey: r.templateKey,
      status: r.status,
      responses: r.responses,
      attachmentUrls: r.attachmentUrls,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      reviewNotes: r.reviewNotes,
      rejectionReason: r.rejectionReason,
      dueAt: r.dueAt,
    })),
    templates,
  })
}
