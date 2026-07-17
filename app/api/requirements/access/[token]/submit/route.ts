import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveMagicToken } from '@/lib/requirements/tokens'
import { getTemplate } from '@/lib/requirements/templates'

interface SubmitBody {
  responses?: Record<string, string | number | string[] | null>
  attachmentUrls?: string[]
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await resolveMagicToken(token)
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 410 })
  }

  let body: SubmitBody
  try {
    body = await req.json() as SubmitBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { record } = result
  const template = getTemplate(record.requirement.templateKey)
  if (!template) {
    return NextResponse.json({ error: 'template_missing' }, { status: 500 })
  }

  // Validate required fields
  const responses = body.responses ?? {}
  const missing: string[] = []
  const attachmentUrls = body.attachmentUrls ?? record.requirement.attachmentUrls
  for (const section of template.formSchema) {
    for (const field of section.fields) {
      if (!field.required) continue
      const v = responses[field.key]
      if (field.type === 'file') {
        // Files are validated via attachmentUrls (any upload with the field's
        // key stored in responses counts). Simpler: any file field marked
        // required must have at least one attachment on the requirement.
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
  const updated = await prisma.$transaction(async (tx) => {
    const requirement = await tx.requirementInstance.update({
      where: { id: record.requirementInstanceId },
      data: {
        responses: responses as unknown as object,
        attachmentUrls,
        status: 'SUBMITTED',
        submittedAt: now,
      },
    })
    await tx.requirementMagicToken.update({
      where: { id: record.id },
      data: { consumedAt: now },
    })
    return requirement
  })

  return NextResponse.json({ success: true, requirement: updated })
}
