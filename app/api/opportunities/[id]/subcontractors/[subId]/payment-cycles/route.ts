import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { PAYMENT_PACKAGE_TEMPLATE_KEYS, getTemplate } from '@/lib/requirements/templates'
import { issuePortalToken } from '@/lib/requirements/portal-tokens'
import { sendPaymentCycleInvite } from '@/lib/requirements/mailer'

interface OpenCycleBody {
  periodLabel?: string
  periodStart?: string
  periodEnd?: string
  assignedEmail?: string
  assignedName?: string
  sendInvite?: boolean
}

function defaultPeriodForNow(): { periodLabel: string; periodStart: Date; periodEnd: Date } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59))
  const label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { periodLabel: label, periodStart: start, periodEnd: end }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: opportunityId, subId: subcontractorId } = await params

  const cycles = await prisma.paymentCycle.findMany({
    where: { opportunityId, subcontractorId },
    orderBy: { periodStart: 'desc' },
    include: {
      requirements: {
        select: { id: true, templateKey: true, status: true, submittedAt: true, reviewedAt: true },
      },
      tokens: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { token: true, expiresAt: true, sentToEmail: true },
      },
    },
  })
  return NextResponse.json({ success: true, cycles })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: opportunityId, subId: subcontractorId } = await params

  let body: OpenCycleBody = {}
  try {
    body = (await req.json()) as OpenCycleBody
  } catch {
    // empty body → open cycle for current month
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
    return NextResponse.json({ error: 'Subcontractor has no email on file — set contactEmail or pass assignedEmail.' }, { status: 400 })
  }
  const assignedName = body.assignedName ?? subcontractor.contactName ?? null

  const parsedStart = body.periodStart ? new Date(body.periodStart) : null
  const parsedEnd = body.periodEnd ? new Date(body.periodEnd) : null
  const defaults = defaultPeriodForNow()
  const periodStart = parsedStart && !isNaN(parsedStart.getTime()) ? parsedStart : defaults.periodStart
  const periodEnd = parsedEnd && !isNaN(parsedEnd.getTime()) ? parsedEnd : defaults.periodEnd
  const periodLabel = body.periodLabel?.trim() || defaults.periodLabel

  // Idempotent: if a cycle already exists for this (opp, sub, start), return
  // it plus a fresh portal token. Prevents "Select for bid" double-clicks
  // from creating duplicate cycles.
  const existing = await prisma.paymentCycle.findUnique({
    where: {
      opportunityId_subcontractorId_periodStart: {
        opportunityId,
        subcontractorId,
        periodStart,
      },
    },
    include: {
      requirements: { select: { id: true, templateKey: true, status: true } },
    },
  })

  let cycle = existing
  if (!cycle) {
    const cycleDueAt = new Date(periodEnd.getTime() + 14 * 24 * 60 * 60 * 1000)
    cycle = await prisma.paymentCycle.create({
      data: {
        opportunityId,
        subcontractorId,
        periodLabel,
        periodStart,
        periodEnd,
        requirements: {
          create: PAYMENT_PACKAGE_TEMPLATE_KEYS.map(key => {
            const template = getTemplate(key)!
            return {
              opportunityId,
              subcontractorId,
              templateKey: key,
              submittalGroup: template.submittalGroup,
              assignedEmail,
              assignedName,
              dueAt: cycleDueAt,
            }
          }),
        },
      },
      include: {
        requirements: { select: { id: true, templateKey: true, status: true } },
      },
    })
  }

  // Fresh portal token — old ones remain valid until expiry.
  const { token, expiresAt } = await issuePortalToken({
    paymentCycleId: cycle.id,
    sentToEmail: assignedEmail,
  })

  let emailResult: { success: boolean; error?: string } = { success: true }
  if (body.sendInvite !== false) {
    emailResult = await sendPaymentCycleInvite({
      toEmail: assignedEmail,
      toName: assignedName,
      token,
      opportunityTitle: opportunity.title,
      solicitationNumber: opportunity.solicitationNumber,
      agency: opportunity.agency,
      companyName: subcontractor.name,
      periodLabel: cycle.periodLabel,
      dueAt: new Date(cycle.periodEnd.getTime() + 14 * 24 * 60 * 60 * 1000),
      taskCount: PAYMENT_PACKAGE_TEMPLATE_KEYS.length,
      primeName: userProfile?.name || null,
      primeOrganization: userProfile?.organization || null,
      primeReplyTo: userProfile?.email || null,
    })
  }

  return NextResponse.json({
    success: true,
    cycle,
    token,
    expiresAt,
    email: emailResult,
  })
}
