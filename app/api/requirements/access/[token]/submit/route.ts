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

    // Mirror the consolidated quote form back onto the Subcontractor row so
    // the prime's internal list is populated automatically — the whole point
    // of the sub_quote template is "onboarding begins at quote submission."
    if (template.key === 'sub_quote') {
      const str = (k: string) => {
        const v = responses[k]
        return typeof v === 'string' && v.trim() ? v.trim() : undefined
      }
      const num = (k: string) => {
        const v = responses[k]
        if (typeof v === 'number' && Number.isFinite(v)) return v
        if (typeof v === 'string' && v.trim()) {
          const n = Number(v.replace(/[$,\s]/g, ''))
          return Number.isFinite(n) ? n : undefined
        }
        return undefined
      }
      const grandTotal = num('grand_total')
      const patch: Record<string, unknown> = {
        name: str('company_name'),
        address: str('address'),
        contactName: str('contact_name'),
        contactEmail: str('contact_email'),
        contactPhone: str('contact_phone'),
        // If the sub only gave a company email/phone, populate the top-level
        // email/phone too so search & callbacks work off either field.
        email: str('contact_email'),
        phone: str('contact_phone'),
        quoteNotes: str('notes'),
      }
      if (grandTotal !== undefined) {
        patch.quotedAmount = grandTotal
        patch.isActualQuote = true
        patch.quoteReceivedAt = now
      }
      // Drop undefined so we don't stomp existing values with nulls.
      for (const k of Object.keys(patch)) {
        if (patch[k] === undefined) delete patch[k]
      }
      if (Object.keys(patch).length > 0) {
        await tx.subcontractor.update({
          where: { id: record.requirement.subcontractorId },
          data: patch,
        })
      }
    }

    return requirement
  })

  return NextResponse.json({ success: true, requirement: updated })
}
