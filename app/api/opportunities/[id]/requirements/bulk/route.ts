import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getTemplate } from '@/lib/requirements/templates'
import { bulkProvisionRequirements } from '@/lib/requirements/bulk'

interface BulkBody {
  subcontractorId: string
  templateKeys: string[]
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: opportunityId } = await params

  let body: BulkBody
  try {
    body = await req.json() as BulkBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { subcontractorId, templateKeys } = body
  if (!subcontractorId || !Array.isArray(templateKeys) || templateKeys.length === 0) {
    return NextResponse.json(
      { error: 'subcontractorId and non-empty templateKeys[] are required' },
      { status: 400 },
    )
  }

  // Validate every template key up front so we fail fast on typos.
  const unknown = templateKeys.filter(k => !getTemplate(k))
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown template key(s): ${unknown.join(', ')}` },
      { status: 400 },
    )
  }

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true },
  })
  if (!opportunity) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })

  try {
    const { provisioned, skipped } = await bulkProvisionRequirements({
      opportunityId,
      subcontractorId,
      templateKeys,
    })
    return NextResponse.json({
      success: true,
      provisioned: provisioned.map(p => ({
        requirementId: p.requirementId,
        templateKey: p.templateKey,
        submittalGroup: p.submittalGroup,
        token: p.token,
        url: p.url,
      })),
      skipped,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bulk provision failed'
    const status =
      message.includes('not found') ? 404 :
      message.includes('does not belong') || message.includes('no email') ? 400 :
      500
    return NextResponse.json({ error: message }, { status })
  }
}
