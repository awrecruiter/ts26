/**
 * Gmail API integration
 *
 * Uses the Google OAuth access token stored in the NextAuth session.
 * Requires the user to have signed in with Google and granted:
 *   - https://www.googleapis.com/auth/gmail.send
 *   - https://www.googleapis.com/auth/gmail.modify
 *
 * Emails sent via this module appear in the user's Gmail Sent folder
 * and are threaded correctly with any replies.
 */

import { google } from 'googleapis'

export interface GmailSendOptions {
  accessToken: string
  refreshToken?: string
  to: string
  subject: string
  body: string      // plain text fallback
  html?: string
  from?: string     // defaults to authenticated user's address
  /** Reply-To address — typically the logged-in user's email so replies land in their inbox */
  replyTo?: string
  threadId?: string // pass to reply in an existing thread
  attachments?: Array<{
    filename: string
    content: string | Buffer
    contentType: string
  }>
}

export interface GmailSendResult {
  success: boolean
  messageId?: string
  threadId?: string
  error?: string
}

export interface GmailMessage {
  id: string
  threadId: string
  subject: string
  from: string
  date: string
  snippet: string
  body: string
}

/**
 * RFC 2047 encode a header value if it contains any non-ASCII characters.
 * Without this, Gmail mis-renders UTF-8 bytes as Latin-1 (e.g. em-dash → "Ã¢Â€Â—").
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

/**
 * Build an RFC 2822 MIME message and base64url-encode it for the Gmail API.
 */
function buildRawMessage(opts: GmailSendOptions, fromAddress: string): string {
  const boundary = `usher_${Date.now()}`
  const hasAttachments = opts.attachments && opts.attachments.length > 0
  const isMultipart = opts.html || hasAttachments

  const headers = [
    `From: ${fromAddress}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    `MIME-Version: 1.0`,
  ]

  if (opts.replyTo) {
    headers.push(`Reply-To: ${opts.replyTo}`)
  }

  if (opts.threadId) {
    // For threading — Gmail uses References/In-Reply-To headers
    // threadId is passed separately in the API call; no header needed
  }

  let body: string

  if (!isMultipart) {
    headers.push('Content-Type: text/plain; charset=UTF-8')
    body = opts.body
  } else if (hasAttachments) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    const innerBoundary = `${boundary}_alt`

    const textPart = `--${innerBoundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${opts.body}`
    const htmlPart = opts.html
      ? `\r\n--${innerBoundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${opts.html}`
      : ''
    const altPart = `--${boundary}\r\nContent-Type: multipart/alternative; boundary="${innerBoundary}"\r\n\r\n${textPart}${htmlPart}\r\n--${innerBoundary}--`

    const attachParts = opts.attachments!.map(att => {
      const attContent = Buffer.isBuffer(att.content)
        ? att.content.toString('base64')
        : Buffer.from(att.content).toString('base64')
      return `\r\n--${boundary}\r\nContent-Type: ${att.contentType}; name="${att.filename}"\r\nContent-Disposition: attachment; filename="${att.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${attContent}`
    }).join('')

    body = `${altPart}${attachParts}\r\n--${boundary}--`
  } else {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    body = `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${opts.body}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${opts.html}\r\n--${boundary}--`
  }

  const raw = `${headers.join('\r\n')}\r\n\r\n${body}`
  return Buffer.from(raw).toString('base64url')
}

/**
 * Send an email via the Gmail API.
 * The sent message appears in the user's Gmail Sent folder.
 */
export async function sendViaGmail(opts: GmailSendOptions): Promise<GmailSendResult> {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    )
    oauth2Client.setCredentials({
      access_token: opts.accessToken,
      refresh_token: opts.refreshToken,
    })

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    // Get the sender's email address
    let fromAddress = opts.from
    if (!fromAddress) {
      const profile = await gmail.users.getProfile({ userId: 'me' })
      fromAddress = profile.data.emailAddress || 'me'
    }

    const raw = buildRawMessage(opts, fromAddress)

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        ...(opts.threadId ? { threadId: opts.threadId } : {}),
      },
    })

    return {
      success: true,
      messageId: response.data.id ?? undefined,
      threadId: response.data.threadId ?? undefined,
    }
  } catch (err: any) {
    const message = err?.response?.data?.error?.message || err?.message || 'Gmail send failed'
    console.error('Gmail API send error:', message)
    return { success: false, error: message }
  }
}

/**
 * Fetch recent messages in a Gmail thread.
 * Use this to sync subcontractor replies back into VendorCommunication records.
 */
export async function getThreadMessages(
  accessToken: string,
  threadId: string,
  refreshToken?: string,
): Promise<GmailMessage[]> {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    )
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken })

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })

    return (thread.data.messages || []).map(msg => {
      const headers = msg.payload?.headers || []
      const get = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

      const bodyData = msg.payload?.parts?.find(p => p.mimeType === 'text/plain')?.body?.data
        ?? msg.payload?.body?.data
        ?? ''

      return {
        id: msg.id!,
        threadId: msg.threadId!,
        subject: get('Subject'),
        from: get('From'),
        date: get('Date'),
        snippet: msg.snippet || '',
        body: bodyData ? Buffer.from(bodyData, 'base64').toString('utf-8') : '',
      }
    })
  } catch (err: any) {
    console.error('Gmail thread fetch error:', err?.message)
    return []
  }
}
