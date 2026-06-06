import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { summarizeComparables, type MatchTier } from '@/lib/comparables'

export async function GET(
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
      select: { id: true },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const awards = await prisma.opportunityComparable.findMany({
      where: { opportunityId: id },
      orderBy: { awardAmount: 'desc' },
      take: 20,
    })

    if (awards.length === 0) {
      const summary = summarizeComparables([], null, new Date())
      return NextResponse.json({ summary, awards: [] })
    }

    const summary = summarizeComparables(
      awards,
      (awards[0].matchTier as MatchTier) || null,
      awards[0].fetchedAt
    )

    return NextResponse.json({ summary, awards })
  } catch (error) {
    console.error('Error fetching comparables:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
