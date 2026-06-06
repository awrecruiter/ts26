import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getComparablesForOpportunity } from '@/lib/comparables'

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
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const summary = await getComparablesForOpportunity(opportunity, {
      forceRefresh: true,
    })

    return NextResponse.json({ summary })
  } catch (error) {
    console.error('Error refreshing comparables:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
