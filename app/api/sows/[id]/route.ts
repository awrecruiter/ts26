import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canViewSOW } from '@/lib/sow-utils'

/**
 * GET /api/sows/[id]
 * Get detailed information about a specific SOW
 */
export async function GET(
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

    if (!id) {
      return NextResponse.json(
        { error: 'SOW ID is required' },
        { status: 400 }
      )
    }

    // Fetch SOW with all relations
    const sow = await prisma.sOW.findUnique({
      where: { id },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            solicitationNumber: true,
            agency: true,
            naicsCode: true,
            description: true,
            responseDeadline: true,
          },
        },
        generatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        currentApprover: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        approvals: {
          include: {
            approver: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        versions: {
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            versionNumber: 'desc',
          },
        },
        activities: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 50, // Limit to most recent 50 activities
        },
      },
    })

    if (!sow) {
      return NextResponse.json(
        { error: 'SOW not found' },
        { status: 404 }
      )
    }

    // Check permissions
    const hasPermission = canViewSOW(
      session.user.id,
      sow,
      session.user.role as 'AGENT' | 'ADMIN' | 'VIEWER'
    )

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to view this SOW' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      success: true,
      sow,
    })
  } catch (error) {
    console.error('Error fetching SOW details:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/sows/[id]
 * Update SOW metadata (notes, assignedApprover)
 */
export async function PATCH(
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
    const { notes, currentApproverId, content, status } = body

    // Fetch existing SOW
    const existingSow = await prisma.sOW.findUnique({
      where: { id },
    })

    if (!existingSow) {
      return NextResponse.json(
        { error: 'SOW not found' },
        { status: 404 }
      )
    }

    // Only ADMIN or creator can update
    if (
      session.user.role !== 'ADMIN' &&
      existingSow.generatedById !== session.user.id
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to update this SOW' },
        { status: 403 }
      )
    }

    // Prepare update data
    const updateData: any = {}
    if (notes !== undefined) {
      updateData.notes = notes
    }
    if (content !== undefined) {
      updateData.content = content
    }
    if (status !== undefined) {
      updateData.status = status
    }
    if (currentApproverId !== undefined) {
      // Only ADMIN can assign approvers
      if (session.user.role !== 'ADMIN') {
        return NextResponse.json(
          { error: 'Forbidden - Only admins can assign approvers' },
          { status: 403 }
        )
      }
      updateData.currentApproverId = currentApproverId
    }

    // Update SOW
    const updatedSow = await prisma.sOW.update({
      where: { id },
      data: updateData,
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

    // Create activity
    await prisma.sOWActivity.create({
      data: {
        sowId: id,
        type: 'UPDATED',
        description: 'SOW metadata updated',
        userId: session.user.id,
        metadata: { updates: Object.keys(updateData) },
      },
    })

    return NextResponse.json({
      success: true,
      sow: updatedSow,
    })
  } catch (error) {
    console.error('Error updating SOW:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/sows/[id]
 * Delete a SOW (ADMIN only)
 */
export async function DELETE(
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

    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      )
    }

    const { id } = await params

    // Delete SOW (cascade will handle related records)
    await prisma.sOW.delete({
      where: { id },
    })

    return NextResponse.json({
      success: true,
      message: 'SOW deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting SOW:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
