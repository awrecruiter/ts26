import { NextResponse } from 'next/server'
import { resolveMagicToken } from '@/lib/requirements/tokens'
import { getTemplate, SUBMITTAL_GROUPS } from '@/lib/requirements/templates'

// Public endpoint — no session auth. Bearer is the magic token in the URL.

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await resolveMagicToken(token)

  if (!result.ok) {
    return NextResponse.json({
      error: result.reason,
      message: result.reason === 'not_found'
        ? 'This link is not valid.'
        : result.reason === 'expired'
          ? 'This link has expired. Ask the prime contractor to resend it.'
          : 'This link has already been used.',
    }, { status: 410 })
  }

  const { record } = result
  const req_ = record.requirement
  const template = getTemplate(req_.templateKey)
  if (!template) {
    return NextResponse.json({ error: 'template_missing' }, { status: 500 })
  }
  const group = SUBMITTAL_GROUPS[template.submittalGroup]

  return NextResponse.json({
    success: true,
    requirement: {
      id: req_.id,
      status: req_.status,
      responses: req_.responses,
      attachmentUrls: req_.attachmentUrls,
      submittedAt: req_.submittedAt,
      dueAt: req_.dueAt,
      assignedName: req_.assignedName,
      assignedEmail: req_.assignedEmail,
    },
    opportunity: req_.opportunity,
    subcontractor: req_.subcontractor,
    template,
    submittalGroup: group,
    token,
  })
}
