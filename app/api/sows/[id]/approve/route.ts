import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canApproveSQW, getStatusAfterApproval, getActivityTypeFromAction } from '@/lib/sow-utils'
import { ApprovalAction } from '@prisma/client'

/**
 * POST /api/sows/[id]/approve
 * Approve, reject, or request changes for a SOW
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params
    const body = await req.json()
    const { action, comments } = body

    // Validate action
    const validActions: ApprovalAction[] = ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SUBMITTED']
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: 'Valid action is required (APPROVED, REJECTED, CHANGES_REQUESTED, or SUBMITTED)' },
        { status: 400 }
      )
    }

    // Fetch SOW
    const sow = await prisma.sOW.findUnique({
      where: { id },
      include: {
        opportunity: {
          select: {
            title: true,
            solicitationNumber: true,
          },
        },
      },
    })

    if (!sow) {
      return NextResponse.json(
        { error: 'SOW not found' },
        { status: 404 }
      )
    }

    // Check permissions for approval actions
    if (action !== 'SUBMITTED') {
      const hasPermission = canApproveSQW(
        session.user.id,
        sow.currentApproverId,
        session.user.role as 'AGENT' | 'ADMIN' | 'VIEWER'
      )

      if (!hasPermission) {
        return NextResponse.json(
          { error: 'Forbidden - You do not have permission to approve this SOW' },
          { status: 403 }
        )
      }
    }

    // For SUBMITTED action, user must be the creator
    if (action === 'SUBMITTED' && sow.generatedById !== session.user.id) {
      return NextResponse.json(
        { error: 'Forbidden - Only the creator can submit for approval' },
        { status: 403 }
      )
    }

    // Get new status based on action
    const newStatus = getStatusAfterApproval(action)

    // Create approval record
    const approval = await prisma.sOWApproval.create({
      data: {
        sowId: id,
        approverId: session.user.id,
        action,
        comments: comments || null,
      },
      include: {
        approver: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    // Update SOW status
    const updatedSow = await prisma.sOW.update({
      where: { id },
      data: {
        status: newStatus,
      },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            solicitationNumber: true,
          },
        },
        generatedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        currentApprover: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    // Create activity record
    const activityType = getActivityTypeFromAction(action)
    let description = ''
    switch (action) {
      case 'APPROVED':
        description = `SOW approved by ${session.user.name || session.user.email}`
        break
      case 'REJECTED':
        description = `SOW rejected by ${session.user.name || session.user.email}${comments ? `: ${comments}` : ''}`
        break
      case 'CHANGES_REQUESTED':
        description = `Changes requested by ${session.user.name || session.user.email}${comments ? `: ${comments}` : ''}`
        break
      case 'SUBMITTED':
        description = `SOW submitted for approval by ${session.user.name || session.user.email}`
        break
      default:
        description = `SOW status updated to ${newStatus}`
    }

    await prisma.sOWActivity.create({
      data: {
        sowId: id,
        type: activityType,
        description,
        userId: session.user.id,
        metadata: {
          action,
          previousStatus: sow.status,
          newStatus,
          comments: comments || null,
        },
      },
    })

    return NextResponse.json({
      success: true,
      sow: updatedSow,
      approval,
      message: `SOW ${action.toLowerCase()} successfully`,
    })
  } catch (error) {
    console.error('Error processing approval:', error)

    // Log error
    try {
      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          message: 'SOW approval failed',
          context: {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          },
        },
      })
    } catch (logError) {
      console.error('Failed to log error:', logError)
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
