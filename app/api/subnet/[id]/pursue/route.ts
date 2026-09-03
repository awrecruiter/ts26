import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { classifyContractType } from '@/lib/opportunity-classification'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const subnet = await prisma.subNetOpportunity.findUnique({ where: { id } })
  if (!subnet) {
    return NextResponse.json({ error: 'SubNet listing not found' }, { status: 404 })
  }

  // Idempotent: if already pursued, just return the existing Opportunity.
  if (subnet.opportunityId) {
    const existing = await prisma.opportunity.findUnique({
      where: { id: subnet.opportunityId },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ opportunityId: existing.id, alreadyPursued: true })
    }
    // Existing link is stale (opp was deleted) — fall through and re-create.
  }

  const solicitationNumber = `SUBNET-${subnet.sourceKey}`
  const description = [subnet.description, subnet.contactRaw ? `\nContact: ${subnet.contactRaw}` : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 10000)

  const classification = classifyContractType({
    pscCode: null,
    naicsCode: subnet.naicsCode,
    title: subnet.title,
    description,
  })

  // Some SubNet listings share (primeName, title, closingDate) — a naive
  // synthetic solicitationNumber can collide. If the row already exists
  // from a prior pursue, adopt it.
  const preexisting = await prisma.opportunity.findUnique({
    where: { solicitationNumber },
    select: { id: true },
  })
  let opportunityId: string
  if (preexisting) {
    opportunityId = preexisting.id
  } else {
    const created = await prisma.opportunity.create({
      data: {
        solicitationNumber,
        title: subnet.title,
        description,
        naicsCode: subnet.naicsCode,
        agency: subnet.primeName || 'SBA SubNet',
        state: subnet.state,
        responseDeadline: subnet.closingDate,
        postedDate: subnet.firstSeenAt,
        status: 'ACTIVE',
        contractType: classification.contractType,
        contractTypeSource: classification.source,
        rawData: {
          source: 'subnet',
          subNetOpportunityId: subnet.id,
          sourceKey: subnet.sourceKey,
          primeName: subnet.primeName,
          contactEmail: subnet.contactEmail,
          contactRaw: subnet.contactRaw,
          sourceUrl: subnet.sourceUrl,
          performanceStartDate: subnet.performanceStartDate?.toISOString() || null,
        },
      },
      select: { id: true },
    })
    opportunityId = created.id
  }

  await prisma.subNetOpportunity.update({
    where: { id: subnet.id },
    data: { opportunityId, pursuedAt: new Date() },
  })

  return NextResponse.json({ opportunityId, alreadyPursued: false })
}
