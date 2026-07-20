import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { format } from 'date-fns'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { bidId, agentNote } = body as { bidId: string; agentNote?: string }

    if (!bidId) return NextResponse.json({ error: 'bidId required' }, { status: 400 })

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        agency: true,
        responseDeadline: true,
        bids: {
          where: { id: bidId },
          select: { id: true, recommendedPrice: true },
        },
      },
    })

    if (!opportunity) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    if (!opportunity.bids.length) return NextResponse.json({ error: 'Bid not found' }, { status: 404 })

    const bid = opportunity.bids[0]

    const request = await prisma.bidApprovalRequest.create({
      data: {
        opportunityId: id,
        bidId,
        submittedById: session.user.id,
        agentNote: agentNote || null,
        status: 'PENDING',
      },
      include: {
        submittedBy: { select: { name: true, email: true } },
      },
    })

    // Notify all admins
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { email: true },
    })

    const agentName = session.user.name || session.user.email || 'An agent'
    const deadlineStr = opportunity.responseDeadline
      ? format(new Date(opportunity.responseDeadline), 'MMMM d, yyyy')
      : 'Not specified'
    const priceStr = `$${bid.recommendedPrice.toLocaleString()}`
    const reviewUrl = `${(process.env.NEXTAUTH_URL ?? '').replace(/\s+/g, '').replace(/\/$/, '')}/admin/bid-approvals/${request.id}`

    const emailBody = `${agentName} has submitted a bid package for your review.

Opportunity: ${opportunity.title}${opportunity.agency ? ` — ${opportunity.agency}` : ''}
Deadline: ${deadlineStr}
Recommended Price: ${priceStr}${agentNote ? `\nAgent Note: "${agentNote}"` : ''}

Review Package: ${reviewUrl}`

    await Promise.allSettled(
      admins.map((admin) =>
        sendEmail({
          to: admin.email,
          subject: `[Review Required] Bid Package — ${opportunity.title}`,
          body: emailBody,
        }).catch((err) => console.warn('Admin email failed:', err))
      )
    )

    return NextResponse.json({ request })
  } catch (error) {
    console.error('bid-approval POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit' },
      { status: 500 }
    )
  }
}
