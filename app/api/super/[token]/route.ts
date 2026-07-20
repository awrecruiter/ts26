import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveSuperToken } from '@/lib/requirements/super-tokens'

// Public — auth is the persistent super token in the URL.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await resolveSuperToken(token)

  if (!result.ok) {
    return NextResponse.json({
      error: result.reason,
      message: result.reason === 'not_found'
        ? 'This portal link is not valid.'
        : 'This link has been rotated. Ask the prime contractor for the new one.',
    }, { status: 410 })
  }

  await prisma.superPortalToken.update({
    where: { id: result.record.id },
    data: { lastUsedAt: new Date() },
  })

  const { opportunity, subcontractor } = result.record

  // Load last 60 days of reports so the calendar has something to render.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  const reports = await prisma.dailyReport.findMany({
    where: {
      opportunityId: opportunity.id,
      subcontractorId: subcontractor.id,
      reportDate: { gte: sixtyDaysAgo },
    },
    orderBy: { reportDate: 'desc' },
  })

  return NextResponse.json({
    success: true,
    token,
    opportunity,
    subcontractor,
    reports,
  })
}
