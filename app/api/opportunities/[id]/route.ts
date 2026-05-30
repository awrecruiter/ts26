import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check authentication
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Await params in Next.js 15+
    const { id } = await params

    // Get opportunity with related data
    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      include: {
        bids: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            approvalRequests: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                reviewerNote: true,
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        subcontractors: {
          orderBy: { createdAt: 'desc' },
        },
        watchers: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        sows: {
          orderBy: { createdAt: 'desc' },
          include: {
            generatedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    })

    if (!opportunity) {
      return NextResponse.json(
        { error: 'Opportunity not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      opportunity,
    })

  } catch (error) {
    console.error('Error fetching opportunity:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
