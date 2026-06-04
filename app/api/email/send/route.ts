import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendEmail, type EmailAttachment } from '@/lib/email'
import { extractAttachmentsFromRawData } from '@/lib/samgov'

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
    const { to, subject, attachmentIds = [], opportunityId, subcontractorId } = body
    const bodyText = body.body

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

    // (VendorCommunication logging skipped — no direct Subcontractor → Vendor
    //  link in schema today. Add when that relation lands.)
    void subcontractorId

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      attachmentsAttached: resolvedAttachments.length,
      attachmentFailures: attachmentFailures.length ? attachmentFailures : undefined,
    })
  } catch (error) {
    console.error('[email/send] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown send error' },
      { status: 500 }
    )
  }
}
