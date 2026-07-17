import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { issueMagicToken } from '@/lib/requirements/tokens'
import { sendRequirementInvite } from '@/lib/requirements/mailer'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; reqId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, reqId } = await params
  const requirement = await prisma.requirementInstance.findUnique({
    where: { id: reqId },
    include: {
      opportunity: { select: { title: true, solicitationNumber: true, agency: true } },
      subcontractor: { select: { name: true } },
    },
  })
  if (!requirement || requirement.opportunityId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const userProfile = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, organization: true },
  })

  const { token } = await issueMagicToken({
    requirementInstanceId: requirement.id,
    sentToEmail: requirement.assignedEmail,
  })

  const emailResult = await sendRequirementInvite({
    toEmail: requirement.assignedEmail,
    toName: requirement.assignedName,
    token,
    opportunityTitle: requirement.opportunity.title,
    solicitationNumber: requirement.opportunity.solicitationNumber,
    agency: requirement.opportunity.agency,
    companyName: requirement.subcontractor.name,
    templateKey: requirement.templateKey,
    dueAt: requirement.dueAt,
    primeName: userProfile?.name || null,
    primeOrganization: userProfile?.organization || null,
    primeReplyTo: userProfile?.email || null,
  })

  return NextResponse.json({ success: true, token, email: emailResult })
}
