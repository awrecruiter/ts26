import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    const request = await prisma.bidApprovalRequest.findUnique({
      where: { id },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            agency: true,
            responseDeadline: true,
            sows: {
              select: { id: true, status: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        bid: {
          select: {
            id: true,
            recommendedPrice: true,
            costBasis: true,
            grossMargin: true,
            potentialProfit: true,
            confidence: true,
            source: true,
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
    })

    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ request })
  } catch (error) {
    console.error('bid-approval GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const { action, reviewerNote } = body as {
      action: 'APPROVE' | 'REJECT'
      reviewerNote?: string
    }

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json({ error: 'action must be APPROVE or REJECT' }, { status: 400 })
    }

    const existing = await prisma.bidApprovalRequest.findUnique({
      where: { id },
      include: {
        opportunity: { select: { id: true, title: true } },
        submittedBy: { select: { email: true, name: true } },
      },
    })

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const request = await prisma.bidApprovalRequest.update({
      where: { id },
      data: {
        status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reviewedById: session.user.id,
        reviewerNote: reviewerNote || null,
        reviewedAt: new Date(),
      },
      include: {
        opportunity: { select: { id: true, title: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    })

    if (action === 'APPROVE') {
      await prisma.bid.update({
        where: { id: existing.bidId },
        data: { status: 'REVIEWED' },
      })
      await prisma.opportunityProgress.upsert({
        where: { opportunityId: existing.opportunityId },
        update: { currentStage: 'READY' },
        create: {
          opportunityId: existing.opportunityId,
          currentStage: 'READY',
        },
      })
    }

    const agentEmail = existing.submittedBy.email
    const opportunityTitle = existing.opportunity.title
    const workspaceUrl = `${process.env.NEXTAUTH_URL}/opportunities/${existing.opportunityId}?panel=bid`

    if (action === 'APPROVE') {
      await sendEmail({
        to: agentEmail,
        subject: `Bid Package Approved — ${opportunityTitle}`,
        body: `Your bid package for ${opportunityTitle} has been approved.\nThe bid is now ready to submit to the government.\n\nOpen Workspace: ${workspaceUrl}`,
      }).catch((err) => console.warn('Agent approval email failed:', err))
    } else {
      const noteText = reviewerNote ? `\n\nFeedback: "${reviewerNote}"` : ''
      await sendEmail({
        to: agentEmail,
        subject: `Bid Package Needs Revision — ${opportunityTitle}`,
        body: `Admin reviewed your bid package for ${opportunityTitle} and requested revisions.${noteText}\n\nOpen Workspace: ${workspaceUrl}`,
      }).catch((err) => console.warn('Agent rejection email failed:', err))
    }

    return NextResponse.json({ request })
  } catch (error) {
    console.error('bid-approval PATCH error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update' },
      { status: 500 }
    )
  }
}
