import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const requests = await prisma.bidApprovalRequest.findMany({
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            agency: true,
            responseDeadline: true,
          },
        },
        bid: {
          select: {
            id: true,
            recommendedPrice: true,
            costBasis: true,
            grossMargin: true,
            status: true,
            content: true,
          },
        },
        submittedBy: {
          select: { id: true, name: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ requests })
  } catch (error) {
    console.error('bid-approvals GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
