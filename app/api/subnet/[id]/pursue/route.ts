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

  // Build the canonical Opportunity payload from the current SubNet row.
  // Recomputed on every pursue so re-clicking Pursue heals older records
  // that were created before we mapped POC into rawData.pointOfContact.
  const rawData = {
    source: 'subnet',
    subNetOpportunityId: subnet.id,
    sourceKey: subnet.sourceKey,
    primeName: subnet.primeName,
    contactEmail: subnet.contactEmail,
    contactRaw: subnet.contactRaw,
    sourceUrl: subnet.sourceUrl,
    performanceStartDate: subnet.performanceStartDate?.toISOString() || null,
    // Map SubNet contact into the SAM.gov pointOfContact shape so the
    // workspace sidebar (which reads rawData.pointOfContact) renders it
    // without any special-casing.
    pointOfContact: [
      {
        fullName: subnet.primeName || 'SubNet Prime Contractor',
        title: 'Prime Contractor (SubNet listing)',
        email: subnet.contactEmail || undefined,
        phone: subnet.contactRaw && !subnet.contactEmail
          ? subnet.contactRaw.slice(0, 200)
          : undefined,
      },
    ],
  }

  const opportunityData = {
    title: subnet.title,
    description,
    naicsCode: subnet.naicsCode,
    agency: subnet.primeName || 'SBA SubNet',
    state: subnet.state,
    responseDeadline: subnet.closingDate,
    postedDate: subnet.firstSeenAt,
    status: 'ACTIVE' as const,
    rawData,
  }

  // Locate the existing Opportunity, if any — either via the back-link or via
  // the synthetic solicitationNumber (in case a prior pursue created it and
  // the back-link is stale).
  let existingId: string | null = null
  if (subnet.opportunityId) {
    const byBackLink = await prisma.opportunity.findUnique({
      where: { id: subnet.opportunityId },
      select: { id: true },
    })
    if (byBackLink) existingId = byBackLink.id
  }
  if (!existingId) {
    const bySolNum = await prisma.opportunity.findUnique({
      where: { solicitationNumber },
      select: { id: true },
    })
    if (bySolNum) existingId = bySolNum.id
  }

  let opportunityId: string
  let alreadyPursued: boolean
  if (existingId) {
    // Refresh rawData + core fields so the workspace picks up SBA updates
    // (contact changes, closing-date edits) and any schema improvements
    // we've made since the record was first created.
    await prisma.opportunity.update({
      where: { id: existingId },
      data: opportunityData,
    })
    opportunityId = existingId
    alreadyPursued = true
  } else {
    const created = await prisma.opportunity.create({
      data: {
        solicitationNumber,
        ...opportunityData,
        contractType: classification.contractType,
        contractTypeSource: classification.source,
      },
      select: { id: true },
    })
    opportunityId = created.id
    alreadyPursued = false
  }

  await prisma.subNetOpportunity.update({
    where: { id: subnet.id },
    data: { opportunityId, pursuedAt: subnet.pursuedAt || new Date() },
  })

  return NextResponse.json({ opportunityId, alreadyPursued })
}
