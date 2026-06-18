import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * POST /api/opportunities/[id]/dismiss
 *
 * Marks an opportunity as dismissed (user-curated "not interested").
 * Idempotent: re-dismissing an already-dismissed opp is a no-op success.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const existing = await prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, status: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Idempotent: if already dismissed, return as-is.
    if (existing.status === 'DISMISSED') {
      const opportunity = await prisma.opportunity.findUnique({ where: { id } })
      return NextResponse.json({ opportunity })
    }

    const opportunity = await prisma.opportunity.update({
      where: { id },
      data: {
        status: 'DISMISSED',
        dismissedAt: new Date(),
        dismissedById: session.user.id,
      },
    })

    return NextResponse.json({ opportunity })
  } catch (error) {
    console.error('Error dismissing opportunity:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
