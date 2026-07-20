import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolvePortalToken } from '@/lib/requirements/portal-tokens'
import { getTemplate } from '@/lib/requirements/templates'

interface SubmitBody {
  responses?: Record<string, string | number | string[] | null>
  attachmentUrls?: string[]
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string; reqId: string }> },
) {
  const { token, reqId } = await params
  const result = await resolvePortalToken(token)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 410 })

  const target = result.record.cycle.requirements.find(r => r.id === reqId)
  if (!target) return NextResponse.json({ error: 'task_not_in_cycle' }, { status: 404 })

  let body: SubmitBody
  try {
    body = (await req.json()) as SubmitBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const template = getTemplate(target.templateKey)
  if (!template) return NextResponse.json({ error: 'template_missing' }, { status: 500 })

  const responses = body.responses ?? {}
  const attachmentUrls = body.attachmentUrls ?? target.attachmentUrls
  const missing: string[] = []
  for (const section of template.formSchema) {
    for (const field of section.fields) {
      if (!field.required) continue
      const v = responses[field.key]
      if (field.type === 'file') {
        if (attachmentUrls.length === 0) missing.push(field.label)
      } else if (v === null || v === undefined || v === '') {
        missing.push(field.label)
      }
    }
  }
  if (missing.length > 0) {
    return NextResponse.json({
      error: 'validation',
      missing,
      message: `Missing required fields: ${missing.join(', ')}`,
    }, { status: 400 })
  }

  const now = new Date()
  const updated = await prisma.requirementInstance.update({
    where: { id: target.id },
    data: {
      responses: responses as unknown as object,
      attachmentUrls,
      status: 'SUBMITTED',
      submittedAt: now,
    },
  })

  return NextResponse.json({ success: true, requirement: updated })
}
