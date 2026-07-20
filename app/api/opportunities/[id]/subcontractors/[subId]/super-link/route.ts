import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { issueOrRotateSuperToken } from '@/lib/requirements/super-tokens'
import { sendSuperPortalInvite } from '@/lib/requirements/mailer'

interface Body {
  toEmail?: string
  toName?: string
  sendInvite?: boolean
  /** Rotate even if a live token exists. Defaults to true — this endpoint's
   *  purpose is to hand the super a fresh URL. */
  rotate?: boolean
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: opportunityId, subId: subcontractorId } = await params

  const active = await prisma.superPortalToken.findFirst({
    where: { opportunityId, subcontractorId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { token: true, createdAt: true, lastUsedAt: true, sentToEmail: true, sentToName: true },
  })

  return NextResponse.json({ success: true, token: active })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: opportunityId, subId: subcontractorId } = await params

  let body: Body = {}
  try { body = (await req.json()) as Body } catch { /* empty ok */ }

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

  const toEmail = (body.toEmail ?? subcontractor.contactEmail ?? subcontractor.email ?? '').trim()
  const toName = body.toName ?? subcontractor.contactName ?? null

  const { token, rotated } = await issueOrRotateSuperToken({
    opportunityId,
    subcontractorId,
    sentToEmail: toEmail || null,
    sentToName: toName,
  })

  let emailResult: { success: boolean; error?: string } = { success: true }
  if (body.sendInvite !== false && toEmail) {
    emailResult = await sendSuperPortalInvite({
      toEmail,
      toName,
      token,
      opportunityTitle: opportunity.title,
      solicitationNumber: opportunity.solicitationNumber,
      agency: opportunity.agency,
      companyName: subcontractor.name,
      rotated,
      primeName: userProfile?.name || null,
      primeOrganization: userProfile?.organization || null,
      primeReplyTo: userProfile?.email || null,
    })
  }

  return NextResponse.json({
    success: true,
    token,
    rotated,
    email: emailResult,
  })
}
