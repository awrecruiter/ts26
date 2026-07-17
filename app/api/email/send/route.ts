import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendEmail, type EmailAttachment } from '@/lib/email'
import { extractAttachmentsFromRawData } from '@/lib/samgov'
import { bulkProvisionRequirements, renderPreworkLinksBlock } from '@/lib/requirements/bulk'

/**
 * Convert the plain-text email body into an HTML alternative so mail clients
 * render the portal links as real clickable anchors instead of relying on
 * their own autolinker, which frequently clips URLs at the first `?`, `&`, or
 * near the end. We escape everything, wrap URL matches in `<a href="…">`, and
 * preserve line breaks. Trailing punctuation is peeled off the link so a
 * sentence-ending `.` or `)` doesn't get swallowed into the href.
 */
function plainToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  const urlRe = /https?:\/\/[^\s<>"']+/g
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(text)) !== null) {
    parts.push(escape(text.slice(last, m.index)))
    let url = m[0]
    let trailing = ''
    while (url.length > 0 && /[.,;:!?)\]]/.test(url[url.length - 1])) {
      trailing = url[url.length - 1] + trailing
      url = url.slice(0, -1)
    }
    parts.push(`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a>${escape(trailing)}`)
    last = m.index + m[0].length
  }
  parts.push(escape(text.slice(last)))

  const escaped = parts.join('').replace(/\r\n|\r|\n/g, '<br>')
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#1c1917;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${escaped}</div>`
}

interface SendRequestBody {
  to: string
  subject: string
  body: string
  /** Opportunity context — used to fetch attachments + log the communication. */
  opportunityId?: string
  /** Subcontractor id — used to log the communication against the right vendor. */
  subcontractorId?: string
  /** Attachment IDs to bundle from the opportunity's SAM.gov rawData. */
  attachmentIds?: string[]
  /** Optional list of prework requirement template keys — when set with a
   *  subcontractorId, each is provisioned and appended to the email body as
   *  a magic-link portal URL. Silently ignored if no subcontractorId. */
  attachPreworkTemplates?: string[]
}

/** Fetch one SAM.gov attachment server-side and return it as an EmailAttachment.
 *  Mirrors the logic in app/api/opportunities/[id]/attachments/[attachmentId]/proxy. */
async function fetchAttachment(
  attachment: { id: string; url: string; name: string }
): Promise<EmailAttachment | null> {
  try {
    let fetchUrl = attachment.url
    if (fetchUrl.includes('sam.gov/api') && process.env.SAM_GOV_API_KEY) {
      const u = new URL(fetchUrl)
      if (!u.searchParams.has('api_key')) u.searchParams.set('api_key', process.env.SAM_GOV_API_KEY)
      fetchUrl = u.toString()
    }
    const res = await fetch(fetchUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'USHER/1.0', 'Accept': '*/*' },
    })
    if (!res.ok) return null

    const upstreamDisposition = res.headers.get('content-disposition') || ''
    let resolvedFilename: string | null = null
    const star = upstreamDisposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
    if (star) {
      try { resolvedFilename = decodeURIComponent(star[1].replace(/^"|"$/g, '')) } catch {}
    }
    if (!resolvedFilename) {
      const plain = upstreamDisposition.match(/filename="?([^";]+)"?/i)
      if (plain) {
        try { resolvedFilename = decodeURIComponent(plain[1].replace(/\+/g, ' ')) } catch { resolvedFilename = plain[1] }
      }
    }
    const filename = (resolvedFilename && resolvedFilename.includes('.')) ? resolvedFilename : attachment.name
    const safeFilename = filename.replace(/[^\w.\-\s]/g, '_')

    const remoteType = res.headers.get('content-type') || 'application/octet-stream'
    const ext = filename.split('.').pop()?.toLowerCase().split('?')[0] ?? ''
    const MIME_MAP: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls: 'application/vnd.ms-excel',
      txt: 'text/plain',
    }
    const contentType = (remoteType === 'application/octet-stream' && MIME_MAP[ext]) ? MIME_MAP[ext] : remoteType

    const buf = Buffer.from(await res.arrayBuffer())
    return { filename: safeFilename, content: buf, contentType }
  } catch (e) {
    console.warn(`[email/send] Failed to fetch attachment ${attachment.id}:`, e)
    return null
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json()) as SendRequestBody
    const {
      to,
      subject,
      attachmentIds = [],
      opportunityId,
      subcontractorId,
      attachPreworkTemplates = [],
    } = body

    // Substitute the literal "[Your Name]" placeholder with the sender's identity
    // so signatures don't go out reading "Thanks,\n[Your Name]". Prefer display
    // name, then organization, then the email prefix.
    const senderName =
      session.user.name ||
      session.user.organization ||
      session.user.email?.split('@')[0] ||
      ''
    const senderLines = [senderName, session.user.title, session.user.organization]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join('\n')
    let bodyText = (body.body || '').replace(/\[Your Name\]/g, senderLines || senderName)

    // ── Prework provisioning ────────────────────────────────────────────────
    // When the caller wants us to attach prework portal links, provision the
    // requirements and append a formatted block BEFORE sending. Any failure
    // is logged but never blocks the outbound email. We echo the outcome back
    // in the response so the UI can show the exact URLs that went out and
    // surface a diagnostic when the flag was set but couldn't be honored.
    let preworkProvisioned: Array<{ templateKey: string; url: string; templateDisplayName: string }> = []
    let preworkDiagnostic: string | null = null
    const preworkRequested = Array.isArray(attachPreworkTemplates) && attachPreworkTemplates.length > 0
    if (preworkRequested) {
      if (!opportunityId || !subcontractorId) {
        preworkDiagnostic =
          'Prework links skipped — no subcontractor selected. Open the Email panel by clicking Request Quote on a sub card so the link can be scoped to them.'
      } else {
        try {
          const { provisioned, skipped } = await bulkProvisionRequirements({
            opportunityId,
            subcontractorId,
            templateKeys: attachPreworkTemplates ?? [],
          })
          if (skipped.length > 0) {
            console.warn('[email/send] Some prework templates skipped:', skipped)
          }
          const block = renderPreworkLinksBlock(provisioned)
          if (block) {
            bodyText = `${bodyText.trimEnd()}\n\n${block}\n`
          }
          preworkProvisioned = provisioned.map(p => ({
            templateKey: p.templateKey,
            url: p.url,
            templateDisplayName: p.templateDisplayName,
          }))
          if (provisioned.length === 0 && skipped.length > 0) {
            preworkDiagnostic = `Prework links skipped: ${skipped.map(s => `${s.templateKey} (${s.reason})`).join(', ')}`
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error('[email/send] Prework provisioning failed — continuing with send:', e)
          preworkDiagnostic = `Prework provisioning failed — email sent without portal links. ${msg}`
        }
      }
    }

    if (!to || !subject || !bodyText) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: to, subject, body' },
        { status: 400 }
      )
    }
    if (!process.env.EMAIL_PROVIDER) {
      return NextResponse.json(
        { success: false, error: 'EMAIL_PROVIDER is not configured on the server.' },
        { status: 503 }
      )
    }

    // Resolve attachments from the opportunity's SAM.gov data.
    let resolvedAttachments: EmailAttachment[] = []
    let attachmentFailures: string[] = []
    if (opportunityId && attachmentIds.length > 0) {
      const opp = await prisma.opportunity.findUnique({
        where: { id: opportunityId },
        select: { rawData: true },
      })
      const samAttachments = opp ? extractAttachmentsFromRawData(opp.rawData) : []
      const byId = new Map(samAttachments.map(a => [a.id, a]))
      const fetched = await Promise.all(
        attachmentIds.map(async id => {
          const meta = byId.get(id)
          if (!meta) return { id, result: null as EmailAttachment | null }
          return { id, result: await fetchAttachment({ id: meta.id, url: meta.url, name: meta.name }) }
        })
      )
      for (const { id, result } of fetched) {
        if (result) resolvedAttachments.push(result)
        else attachmentFailures.push(id)
      }
    }

    // When EMAIL_PROVIDER=gmail, sendEmail() needs the user's Google OAuth tokens.
    // These are captured at sign-in by NextAuth and exposed on the session.
    const provider = process.env.EMAIL_PROVIDER?.toLowerCase()
    if (provider === 'gmail' && !session.googleAccessToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'Sign in with Google to enable Gmail send — your Google account is not linked.',
        },
        { status: 401 }
      )
    }

    const result = await sendEmail({
      to,
      subject,
      body: bodyText,
      html: plainToHtml(bodyText),
      replyTo: session.user.email,
      attachments: resolvedAttachments,
      googleAccessToken: session.googleAccessToken,
      googleRefreshToken: session.googleRefreshToken,
    })

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Email send failed.',
          attachmentFailures: attachmentFailures.length ? attachmentFailures : undefined,
        },
        { status: 502 }
      )
    }

    // Stamp the subcontractor as "quote requested" whenever a send goes out
    // against a subcontractor id. Wrapped in try/catch so a failed stamp never
    // fails the user's email.
    if (subcontractorId) {
      try {
        await prisma.subcontractor.update({
          where: { id: subcontractorId },
          data: { sowSentAt: new Date() },
        })
      } catch (e) {
        console.error('[email/send] sowSentAt stamp failed:', e)
      }
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      attachmentsAttached: resolvedAttachments.length,
      attachmentFailures: attachmentFailures.length ? attachmentFailures : undefined,
      preworkProvisioned: preworkProvisioned.length ? preworkProvisioned : undefined,
      preworkDiagnostic: preworkDiagnostic ?? undefined,
    })
  } catch (error) {
    console.error('[email/send] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown send error' },
      { status: 500 }
    )
  }
}
