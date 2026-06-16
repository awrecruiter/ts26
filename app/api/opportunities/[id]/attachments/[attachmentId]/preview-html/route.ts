import { NextResponse } from 'next/server'
import mammoth from 'mammoth'
import { prisma } from '@/lib/db'
import { extractAttachmentsFromRawData } from '@/lib/samgov'

/**
 * GET /api/opportunities/[id]/attachments/[attachmentId]/preview-html
 *
 * Renders attachment types the browser cannot display natively as a small
 * sanitized HTML document, served with a strict CSP so it can safely load
 * inside an `<iframe>` in the attachment preview modal.
 *
 * Supported:
 *   - DOCX → mammoth.convertToHtml
 *   - CSV  → inline parser + HTML table
 *
 * Anything else returns 415. This route deliberately does not stream binaries;
 * use the sibling `/proxy` route for PDFs, images, and plain text.
 */

const SHELL_CSS = `
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1917; max-width: 800px; margin: 0 auto; padding: 32px 24px; background: #fff; }
  h1,h2,h3,h4,h5,h6 { color: #1c1917; margin-top: 1.6em; }
  p { margin: 0.6em 0; }
  table { border-collapse: collapse; margin: 1em 0; }
  th,td { border: 1px solid #e7e5e4; padding: 6px 10px; }
  th { background: #f5f5f4; }
  img { max-width: 100%; height: auto; }
`

function renderShell(bodyHtml: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head><body>${bodyHtml}</body></html>`
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Parse CSV text into a 2D array of strings.
 * Handles quoted fields, embedded commas, embedded newlines, and
 * the `""` escape for literal double-quotes inside a quoted field.
 */
function parseCsv(text: string): string[][] {
  // Strip a leading BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let inQuotes = false

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      // Treat CRLF or lone CR as a row terminator.
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      if (text[i] === '\n') i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }

    field += ch
    i++
  }

  // Flush whatever is left. Skip a truly empty trailing row (no fields, no
  // partial content) that comes from a file ending in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

function renderCsvTable(rows: string[][]): string {
  if (rows.length === 0) return '<p>Empty file.</p>'

  const [header, ...body] = rows
  const headerHtml = header.map(cell => `<th>${escapeHtml(cell)}</th>`).join('')
  const bodyHtml = body
    .map(r => `<tr>${r.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const { id, attachmentId } = await params

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: { rawData: true },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const attachments = extractAttachmentsFromRawData(opportunity.rawData)
    const attachment = attachments.find(a => a.id === attachmentId)

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    // SAM.gov resource URLs require the API key on the redirect-initiating
    // request, or the redirect chain breaks and we get an HTML auth page.
    let fetchUrl = attachment.url
    if (fetchUrl.includes('sam.gov/api') && process.env.SAM_GOV_API_KEY) {
      const u = new URL(fetchUrl)
      if (!u.searchParams.has('api_key')) u.searchParams.set('api_key', process.env.SAM_GOV_API_KEY)
      fetchUrl = u.toString()
    }

    const response = await fetch(fetchUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'USHER/1.0',
        'Accept': '*/*',
      },
    })

    if (!response.ok) {
      return new NextResponse('Failed to render preview', { status: 500 })
    }

    // Resolve the real filename from S3's Content-Disposition (SAM.gov gives
    // us "Attachment 1" with no extension, which can't be type-classified).
    const upstreamDisposition = response.headers.get('content-disposition') || ''
    let resolvedFilename: string | null = null
    const star = upstreamDisposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
    if (star) {
      try { resolvedFilename = decodeURIComponent(star[1].replace(/^"|"$/g, '')) } catch {}
    }
    if (!resolvedFilename) {
      const plain = upstreamDisposition.match(/filename="?([^";]+)"?/i)
      if (plain) {
        try {
          resolvedFilename = decodeURIComponent(plain[1].replace(/\+/g, ' '))
        } catch {
          resolvedFilename = plain[1].replace(/\+/g, ' ')
        }
      }
    }
    const filename = (resolvedFilename && resolvedFilename.includes('.'))
      ? resolvedFilename
      : attachment.name

    const ext = filename.split('.').pop()?.toLowerCase().split('?')[0] ?? ''
    const arrayBuffer = await response.arrayBuffer()

    let html: string

    if (ext === 'docx') {
      const buffer = Buffer.from(arrayBuffer)
      const result = await mammoth.convertToHtml({ buffer })
      html = renderShell(result.value)
    } else if (ext === 'csv') {
      const text = Buffer.from(arrayBuffer).toString('utf-8')
      const rows = parseCsv(text)
      html = renderShell(renderCsvTable(rows))
    } else {
      return new NextResponse('Unsupported preview format', { status: 415 })
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        'Cache-Control': 'private, max-age=3600',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    })
  } catch (error) {
    console.error('Attachment preview-html error:', error)
    return new NextResponse('Failed to render preview', { status: 500 })
  }
}
