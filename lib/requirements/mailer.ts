import { sendEmail } from '@/lib/email'
import { getTemplate, SUBMITTAL_GROUPS } from './templates'
import type { RequirementTemplate } from './types'

interface InviteInput {
  toEmail: string
  toName?: string | null
  token: string
  opportunityTitle: string
  solicitationNumber?: string | null
  agency?: string | null
  companyName: string
  templateKey: string
  dueAt?: Date | null
  primeName?: string | null
  primeOrganization?: string | null
  primeReplyTo?: string | null
}

function baseUrl(): string {
  const raw =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  return raw.replace(/\s+/g, '').replace(/\/$/, '')
}

function fmtDate(d?: Date | null): string {
  if (!d) return 'as soon as possible'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export async function sendRequirementInvite(input: InviteInput) {
  const template = getTemplate(input.templateKey)
  if (!template) {
    return { success: false, error: `Unknown requirement template: ${input.templateKey}` }
  }
  const group = SUBMITTAL_GROUPS[template.submittalGroup]
  const link = `${baseUrl()}/req/${input.token}`
  const dueLabel = fmtDate(input.dueAt)
  const primeLabel = input.primeOrganization || input.primeName || 'the prime contractor'

  const subject = `Action needed — ${template.displayName} (${input.opportunityTitle})`

  const body = renderText({
    template,
    link,
    dueLabel,
    primeLabel,
    input,
    groupName: group.displayName,
  })

  const html = renderHtml({
    template,
    link,
    dueLabel,
    primeLabel,
    input,
    groupName: group.displayName,
  })

  return sendEmail({
    to: input.toEmail,
    subject,
    body,
    html,
    replyTo: input.primeReplyTo || undefined,
  })
}

interface RenderInput {
  template: RequirementTemplate
  link: string
  dueLabel: string
  primeLabel: string
  input: InviteInput
  groupName: string
}

function renderText({ template, link, dueLabel, primeLabel, input, groupName }: RenderInput): string {
  return `Hello${input.toName ? ` ${input.toName}` : ''},

${primeLabel} is preparing the bid package for "${input.opportunityTitle}"${
    input.solicitationNumber ? ` (Solicitation ${input.solicitationNumber})` : ''
  }${input.agency ? ` — ${input.agency}` : ''}.

They need one piece of information from ${input.companyName} to complete the ${groupName} submittal:

  ${template.displayName}

Purpose: ${template.purpose}

To respond, open this secure link (no login required):
${link}

Due by: ${dueLabel}

The link takes you straight to a short form. You can attach files, save partial progress is not supported yet — please finish in one sitting or leave the tab open.

Thanks,
${primeLabel}
https://www.1stdirectionco.com/
`
}

function renderHtml({ template, link, dueLabel, primeLabel, input, groupName }: RenderInput): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, system-ui, sans-serif; color: #292524; max-width: 560px; margin: 0 auto; padding: 24px; background: #fafaf9;">
  <div style="background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 24px;">
    <p style="color: #78716c; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px;">
      ${esc(groupName)}
    </p>
    <h1 style="font-size: 20px; margin: 0 0 16px; color: #1c1917;">
      ${esc(template.displayName)}
    </h1>
    <p style="margin: 0 0 16px; line-height: 1.5;">
      Hello${input.toName ? ` ${esc(input.toName)}` : ''},
    </p>
    <p style="margin: 0 0 16px; line-height: 1.5;">
      <strong>${esc(primeLabel)}</strong> is preparing the bid package for
      <em>${esc(input.opportunityTitle)}</em>${
        input.solicitationNumber ? ` (Solicitation ${esc(input.solicitationNumber)})` : ''
      }${input.agency ? ` — ${esc(input.agency)}` : ''}.
    </p>
    <p style="margin: 0 0 16px; line-height: 1.5;">
      They need one piece of information from <strong>${esc(input.companyName)}</strong> to complete the ${esc(groupName)} submittal:
    </p>
    <div style="background: #f5f5f4; border-left: 3px solid #78716c; padding: 12px 16px; margin: 0 0 20px;">
      <p style="margin: 0; font-size: 14px; color: #57534e;">${esc(template.purpose)}</p>
    </div>
    <p style="margin: 0 0 20px;">
      <a href="${link}" style="background: #292524; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; font-weight: 500;">
        Open secure form
      </a>
    </p>
    <p style="margin: 0 0 4px; font-size: 13px; color: #78716c;">
      Due by <strong>${esc(dueLabel)}</strong>
    </p>
    <p style="margin: 0 0 20px; font-size: 12px; color: #a8a29e; word-break: break-all;">
      Or copy this link: <a href="${link}" style="color: #a8a29e;">${esc(link)}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 20px 0;" />
    <p style="margin: 0 0 8px; font-size: 13px; color: #57534e;">
      Thanks,<br />${esc(primeLabel)}<br />
      <a href="https://www.1stdirectionco.com/" style="color: #57534e;">https://www.1stdirectionco.com/</a>
    </p>
    <p style="margin: 12px 0 0; font-size: 12px; color: #a8a29e;">
      This is a one-time secure link tied to your submission. No login required.
    </p>
  </div>
</body>
</html>`
}
