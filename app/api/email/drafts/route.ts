import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * Per-user, per-(opportunity, subcontractor, templateType) email draft
 * persistence. The panel auto-saves body/subject as the user types so a
 * page refresh doesn't reset to the hardcoded template.
 *
 * All three scope params are required — drafts without a specific recipient
 * are ephemeral and don't need durable storage.
 */

const VALID_TEMPLATES = new Set(['quote_request', 'follow_up', 'custom'])

interface UpsertBody {
  opportunityId?: string
  subcontractorId?: string
  templateType?: string
  subject?: string
  body?: string
}

function parseScope(url: URL) {
  const opportunityId = url.searchParams.get('opportunityId') ?? ''
  const subcontractorId = url.searchParams.get('subcontractorId') ?? ''
  const templateType = url.searchParams.get('templateType') ?? ''
  if (!opportunityId || !subcontractorId || !templateType) return null
  if (!VALID_TEMPLATES.has(templateType)) return null
  return { opportunityId, subcontractorId, templateType }
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = parseScope(new URL(req.url))
  if (!scope) {
    return NextResponse.json({ error: 'opportunityId, subcontractorId, and templateType are required' }, { status: 400 })
  }

  const draft = await prisma.emailDraft.findUnique({
    where: {
      one_draft_per_scope: {
        userId: session.user.id,
        opportunityId: scope.opportunityId,
        subcontractorId: scope.subcontractorId,
        templateType: scope.templateType,
      },
    },
    select: { subject: true, body: true, updatedAt: true },
  })

  return NextResponse.json({ success: true, draft })
}

export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: UpsertBody
  try { body = (await req.json()) as UpsertBody } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.opportunityId || !body.subcontractorId || !body.templateType) {
    return NextResponse.json({ error: 'opportunityId, subcontractorId, and templateType are required' }, { status: 400 })
  }
  if (!VALID_TEMPLATES.has(body.templateType)) {
    return NextResponse.json({ error: 'Invalid templateType' }, { status: 400 })
  }

  const subject = (body.subject ?? '').slice(0, 500)
  const draftBody = (body.body ?? '').slice(0, 50_000)

  const draft = await prisma.emailDraft.upsert({
    where: {
      one_draft_per_scope: {
        userId: session.user.id,
        opportunityId: body.opportunityId,
        subcontractorId: body.subcontractorId,
        templateType: body.templateType,
      },
    },
    create: {
      userId: session.user.id,
      opportunityId: body.opportunityId,
      subcontractorId: body.subcontractorId,
      templateType: body.templateType,
      subject,
      body: draftBody,
    },
    update: { subject, body: draftBody },
    select: { updatedAt: true },
  })

  return NextResponse.json({ success: true, updatedAt: draft.updatedAt })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = parseScope(new URL(req.url))
  if (!scope) {
    return NextResponse.json({ error: 'opportunityId, subcontractorId, and templateType are required' }, { status: 400 })
  }

  await prisma.emailDraft.deleteMany({
    where: {
      userId: session.user.id,
      opportunityId: scope.opportunityId,
      subcontractorId: scope.subcontractorId,
      templateType: scope.templateType,
    },
  })

  return NextResponse.json({ success: true })
}
