import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/opportunities/[id]/progress - Get progress for an opportunity
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Check if opportunity exists and fetch related data for auto-detection
    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      include: {
        bids: { select: { id: true, status: true } },
        assessment: { select: { id: true } },
      },
    })

    if (!opportunity) {
      return NextResponse.json(
        { error: 'Opportunity not found' },
        { status: 404 }
      )
    }

    // Auto-detect completed stages based on related records
    const completedStages = {
      discovered: true, // Always complete if opportunity exists
      assessed: !!opportunity.assessment,
      bidCreated: opportunity.bids.length > 0,
      bidSubmitted: opportunity.bids.some((b) => b.status === 'SUBMITTED' || b.status === 'AWARDED'),
    }

    // Get or create progress record
    let progress = await prisma.opportunityProgress.findUnique({
      where: { opportunityId: id },
    })

    if (!progress) {
      // Create initial progress record
      progress = await prisma.opportunityProgress.create({
        data: {
          opportunityId: id,
          currentStage: 'DISCOVERY',
          completionPct: 0,
          blockers: [],
          nextActions: [
            {
              id: 'assess',
              description: 'Assess profit margin and strategic value',
              priority: 'high',
            },
          ],
        },
      })
    }

    // Return progress with completed stages
    return NextResponse.json({
      ...progress,
      completedStages,
    })
  } catch (error) {
    console.error('Error fetching opportunity progress:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// PATCH /api/opportunities/[id]/progress - Update progress
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
    const body = await req.json()

    const { currentStage, completionPct, blockers, nextActions } = body

    // Validate stage if provided
    const validStages = [
      'DISCOVERY',
      'ASSESSMENT',
      'SOW_CREATION',
      'SOW_REVIEW',
      'BID_ASSEMBLY',
      'READY',
      'SUBMITTED',
    ]

    if (currentStage && !validStages.includes(currentStage)) {
      return NextResponse.json(
        { error: 'Invalid stage value' },
        { status: 400 }
      )
    }

    // Get or create progress record
    let progress = await prisma.opportunityProgress.findUnique({
      where: { opportunityId: id },
    })

    if (!progress) {
      // Create new progress record
      progress = await prisma.opportunityProgress.create({
        data: {
          opportunityId: id,
          currentStage: currentStage || 'DISCOVERY',
          completionPct: completionPct ?? 0,
          blockers: blockers || [],
          nextActions: nextActions || [],
        },
      })
    } else {
      // Update existing progress
      const updateData: any = {}

      if (currentStage !== undefined) {
        updateData.currentStage = currentStage

        // Auto-calculate completion percentage based on stage
        const stageCompletionMap: Record<string, number> = {
          DISCOVERY: 10,
          ASSESSMENT: 25,
          SOW_CREATION: 40,
          SOW_REVIEW: 60,
          BID_ASSEMBLY: 75,
          READY: 90,
          SUBMITTED: 100,
        }

        updateData.completionPct = stageCompletionMap[currentStage] || 0

        // Auto-update next actions based on stage
        const nextActionsMap: Record<string, any[]> = {
          DISCOVERY: [
            {
              id: 'assess',
              description: 'Assess profit margin and strategic value',
              priority: 'high',
            },
          ],
          ASSESSMENT: [
            {
              id: 'create-sow',
              description: 'Generate Statement of Work',
              priority: 'high',
            },
          ],
          SOW_CREATION: [
            {
              id: 'submit-review',
              description: 'Submit SOW for approval',
              priority: 'medium',
            },
          ],
          SOW_REVIEW: [
            {
              id: 'approve-sow',
              description: 'Review and approve SOW',
              priority: 'high',
            },
          ],
          BID_ASSEMBLY: [
            {
              id: 'finalize-bid',
              description: 'Finalize bid package and pricing',
              priority: 'high',
            },
          ],
          READY: [
            {
              id: 'submit-bid',
              description: 'Submit bid to government portal',
              priority: 'high',
            },
          ],
          SUBMITTED: [],
        }

        if (nextActions === undefined) {
          updateData.nextActions = nextActionsMap[currentStage] || []
        }
      }

      if (completionPct !== undefined) {
        updateData.completionPct = Math.min(Math.max(completionPct, 0), 100)
      }

      if (blockers !== undefined) {
        updateData.blockers = blockers
      }

      if (nextActions !== undefined) {
        updateData.nextActions = nextActions
      }

      progress = await prisma.opportunityProgress.update({
        where: { opportunityId: id },
        data: updateData,
      })
    }

    return NextResponse.json(progress)
  } catch (error) {
    console.error('Error updating opportunity progress:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
