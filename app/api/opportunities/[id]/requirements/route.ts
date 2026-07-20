import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getTemplate } from '@/lib/requirements/templates'
import { issueMagicToken } from '@/lib/requirements/tokens'
import { sendRequirementInvite } from '@/lib/requirements/mailer'

interface CreateBody {
  subcontractorId: string
  templateKey: string
  assignedEmail?: string
  assignedName?: string
  dueAt?: string
  sendInvite?: boolean
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const requirements = await prisma.requirementInstance.findMany({
    where: { opportunityId: id },
    orderBy: [{ submittalGroup: 'asc' }, { createdAt: 'asc' }],
    include: {
      subcontractor: {
        select: { id: true, name: true, contactName: true, email: true, resourceLineId: true },
      },
      tokens: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { token: true, sentToEmail: true, expiresAt: true, consumedAt: true, createdAt: true },
      },
    },
  })

  return NextResponse.json({ success: true, requirements })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: opportunityId } = await params
  let body: CreateBody
  try {
    body = await req.json() as CreateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { subcontractorId, templateKey } = body
  if (!subcontractorId || !templateKey) {
    return NextResponse.json({ error: 'subcontractorId and templateKey are required' }, { status: 400 })
  }

  const template = getTemplate(templateKey)
  if (!template) {
    return NextResponse.json({ error: `Unknown template: ${templateKey}` }, { status: 400 })
  }

  // payment_package tasks are cycle-scoped and get spawned by the
  // payment-cycles route, not by this generic requirements endpoint.
  if (template.submittalGroup === 'payment_package') {
    return NextResponse.json({
      error: 'payment_package_via_cycle',
      message: 'Payment tasks are spawned by opening a PaymentCycle. POST /api/opportunities/[id]/subcontractors/[subId]/payment-cycles instead.',
    }, { status: 400 })
  }

  const [opportunity, subcontractor, userProfile] = await Promise.all([
    prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true, title: true, solicitationNumber: true, agency: true },
    }),
    prisma.subcontractor.findUnique({
      where: { id: subcontractorId },
      select: { id: true, name: true, contactName: true, email: true, contactEmail: true, opportunityId: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, organization: true },
    }),
  ])

  if (!opportunity) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
  if (!subcontractor) return NextResponse.json({ error: 'Subcontractor not found' }, { status: 404 })
  if (subcontractor.opportunityId !== opportunityId) {
    return NextResponse.json({ error: 'Subcontractor does not belong to this opportunity' }, { status: 400 })
  }

  const assignedEmail = (body.assignedEmail ?? subcontractor.contactEmail ?? subcontractor.email ?? '').trim()
  if (!assignedEmail) {
    return NextResponse.json({ error: 'assignedEmail is required (subcontractor has no email on file)' }, { status: 400 })
  }
  const assignedName = body.assignedName ?? subcontractor.contactName ?? null

  const dueAt = body.dueAt
    ? new Date(body.dueAt)
    : new Date(Date.now() + (template.defaultDueDays ?? 14) * 24 * 60 * 60 * 1000)

  // Non-cycle templates are one-per-(opp, sub, template). Find-then-update
  // avoids relying on a Prisma composite unique that no longer exists (the
  // DB constraint now includes paymentCycleId and enforces NULLS NOT
  // DISTINCT for the non-cycle case).
  const existing = await prisma.requirementInstance.findFirst({
    where: { opportunityId, subcontractorId, templateKey, paymentCycleId: null },
  })
  const requirement = existing
    ? await prisma.requirementInstance.update({
        where: { id: existing.id },
        data: { assignedEmail, assignedName, dueAt },
      })
    : await prisma.requirementInstance.create({
        data: {
          opportunityId,
          subcontractorId,
          templateKey,
          submittalGroup: template.submittalGroup,
          assignedEmail,
          assignedName,
          dueAt,
        },
      })

  // Mint magic-link token
  const { token } = await issueMagicToken({
    requirementInstanceId: requirement.id,
    sentToEmail: assignedEmail,
  })

  let emailResult: { success: boolean; error?: string } = { success: true }
  if (body.sendInvite !== false) {
    emailResult = await sendRequirementInvite({
      toEmail: assignedEmail,
      toName: assignedName,
      token,
      opportunityTitle: opportunity.title,
      solicitationNumber: opportunity.solicitationNumber,
      agency: opportunity.agency,
      companyName: subcontractor.name,
      templateKey,
      dueAt,
      primeName: userProfile?.name || null,
      primeOrganization: userProfile?.organization || null,
      primeReplyTo: userProfile?.email || null,
    })
  }

  return NextResponse.json({
    success: true,
    requirement,
    token,
    email: emailResult,
  })
}
