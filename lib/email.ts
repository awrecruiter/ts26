/**
 * Email integration module
 *
 * Supports multiple providers via environment configuration:
 * - EMAIL_PROVIDER=smtp: Uses Nodemailer with SMTP config
 * - EMAIL_PROVIDER=sendgrid: Uses SendGrid API
 *
 * Required environment variables per provider:
 *
 * SMTP:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 *
 * SendGrid:
 *   SENDGRID_API_KEY, EMAIL_FROM
 */

export interface EmailAttachment {
  filename: string
  content: Buffer | string
  contentType: string
}

interface EmailOptions {
  to: string
  subject: string
  body: string
  html?: string
  from?: string
  /** Reply-To address — typically the logged-in user's email so replies land in their inbox */
  replyTo?: string
  attachments?: EmailAttachment[]
  /** Gmail OAuth tokens — required when EMAIL_PROVIDER=gmail */
  googleAccessToken?: string
  googleRefreshToken?: string
  /** Gmail threadId — pass to reply in an existing thread */
  gmailThreadId?: string
}

interface EmailResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const provider = process.env.EMAIL_PROVIDER

  if (!provider) {
    console.warn('EMAIL_PROVIDER not configured, skipping email send')
    return {
      success: false,
      error: 'Email provider not configured',
    }
  }

  switch (provider.toLowerCase()) {
    case 'gmail':
      return sendViaGmailProvider(options)
    case 'smtp':
      return sendViaSMTP(options)
    case 'sendgrid':
      return sendViaSendGrid(options)
    default:
      return {
        success: false,
        error: `Unknown email provider: ${provider}`,
      }
  }
}

async function sendViaSMTP(options: EmailOptions): Promise<EmailResult> {
  try {
    // Dynamic import to avoid requiring nodemailer when not used
    const nodemailer = await import('nodemailer')

    const host = process.env.SMTP_HOST
    const port = parseInt(process.env.SMTP_PORT || '587')
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    const from = options.from || process.env.EMAIL_FROM

    if (!host || !user || !pass) {
      return {
        success: false,
        error: 'SMTP configuration incomplete (SMTP_HOST, SMTP_USER, SMTP_PASS required)',
      }
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })

    const result = await transporter.sendMail({
      from: from || user,
      to: options.to,
      subject: options.subject,
      text: options.body,
      html: options.html,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      attachments: options.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    })

    return {
      success: true,
      messageId: result.messageId,
    }
  } catch (error) {
    console.error('SMTP send failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SMTP send failed',
    }
  }
}

async function sendViaSendGrid(options: EmailOptions): Promise<EmailResult> {
  try {
    const apiKey = process.env.SENDGRID_API_KEY
    const from = options.from || process.env.EMAIL_FROM

    if (!apiKey) {
      return {
        success: false,
        error: 'SENDGRID_API_KEY not configured',
      }
    }

    if (!from) {
      return {
        success: false,
        error: 'EMAIL_FROM not configured',
      }
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: options.to }],
          },
        ],
        from: { email: from },
        ...(options.replyTo ? { reply_to: { email: options.replyTo } } : {}),
        subject: options.subject,
        content: [
          {
            type: options.html ? 'text/html' : 'text/plain',
            value: options.html || options.body,
          },
        ],
        ...(options.attachments?.length ? {
          attachments: options.attachments.map(a => ({
            content: Buffer.isBuffer(a.content)
              ? a.content.toString('base64')
              : Buffer.from(a.content).toString('base64'),
            filename: a.filename,
            type: a.contentType,
            disposition: 'attachment',
          })),
        } : {}),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `SendGrid API error: ${response.status} - ${errorText}`,
      }
    }

    return {
      success: true,
      messageId: response.headers.get('x-message-id') || undefined,
    }
  } catch (error) {
    console.error('SendGrid send failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SendGrid send failed',
    }
  }
}

async function sendViaGmailProvider(options: EmailOptions): Promise<EmailResult> {
  if (!options.googleAccessToken) {
    return {
      success: false,
      error: 'Gmail send requires a Google OAuth access token. Sign in with Google to enable email.',
    }
  }

  const { sendViaGmail } = await import('@/lib/gmail')
  const result = await sendViaGmail({
    accessToken: options.googleAccessToken,
    refreshToken: options.googleRefreshToken,
    to: options.to,
    subject: options.subject,
    body: options.body,
    html: options.html,
    from: options.from,
    replyTo: options.replyTo,
    threadId: options.gmailThreadId,
    attachments: options.attachments,
  })

  return {
    success: result.success,
    messageId: result.messageId,
    error: result.error,
  }
}
