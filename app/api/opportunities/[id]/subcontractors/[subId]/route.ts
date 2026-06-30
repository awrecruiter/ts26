import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

// PATCH - Update a subcontractor (call status, email, etc.)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: opportunityId, subId } = await params
    const body = await request.json()

    // Verify subcontractor exists and belongs to this opportunity
    const existing = await prisma.subcontractor.findFirst({
      where: { id: subId, opportunityId },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Subcontractor not found' },
        { status: 404 }
      )
    }

    const updateData: Record<string, any> = {}

    // Call completed toggle
    if (body.callCompleted !== undefined) {
      updateData.callCompleted = body.callCompleted
      updateData.callCompletedAt = body.callCompleted ? new Date() : null
    }

    // Email entry (only after call completed)
    if (body.email !== undefined) {
      updateData.email = body.email
    }

    // Contact email
    if (body.contactEmail !== undefined) {
      updateData.contactEmail = body.contactEmail
    }

    // Persistent per-vendor checklist + deliverable check state
    if (body.checklistState !== undefined) {
      updateData.checklistState = body.checklistState
    }

    if (body.deliverableChecks !== undefined) {
      updateData.deliverableChecks = body.deliverableChecks
    }

    // Agent explicitly marks the per-vendor workflow done (Step 3 trigger).
    // Pass true to stamp now, false to clear (puts the card back in Active).
    if (body.workflowCompleted !== undefined) {
      updateData.workflowCompletedAt = body.workflowCompleted ? new Date() : null
    }

    // Manual indication that an SOW was sent off-platform (lets the user
    // qualify an opportunity for the dashboard without going through the
    // on-platform send flow). Pass true to stamp now, false to clear.
    if (body.sowSent !== undefined) {
      updateData.sowSentAt = body.sowSent ? new Date() : null
    }

    const subcontractor = await prisma.subcontractor.update({
      where: { id: subId },
      data: updateData,
    })

    return NextResponse.json({ subcontractor })
  } catch (error) {
    console.error('Update subcontractor error:', error)
    return NextResponse.json(
      { error: 'Failed to update subcontractor' },
      { status: 500 }
    )
  }
}

// DELETE - Permanently remove a subcontractor from an opportunity
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: opportunityId, subId } = await params

    // Verify subcontractor exists and belongs to this opportunity
    const existing = await prisma.subcontractor.findFirst({
      where: { id: subId, opportunityId },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Subcontractor not found' },
        { status: 404 }
      )
    }

    await prisma.subcontractor.delete({
      where: { id: subId },
    })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error('Delete subcontractor error:', error)
    return NextResponse.json(
      { error: 'Failed to delete subcontractor' },
      { status: 500 }
    )
  }
}
