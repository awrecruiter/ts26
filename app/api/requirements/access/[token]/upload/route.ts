import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/db'
import { resolveMagicToken } from '@/lib/requirements/tokens'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
  require('pdf-parse/lib/pdf-parse')

/**
 * Best-effort extraction of common quote signals from a subcontractor's
 * uploaded PDF. Returns candidate values the client can drop into empty form
 * fields — never a replacement for what the sub already typed. Kept
 * deliberately conservative: if we can't find a labeled "grand total" we
 * fall back to the largest currency figure in the document.
 */
function extractQuoteFieldsFromPdfText(text: string): {
  grand_total?: number
  quote_valid_days?: number
} {
  const out: { grand_total?: number; quote_valid_days?: number } = {}
  const clean = text.replace(/\s+/g, ' ')

  const labelled = clean.match(
    /(?:grand\s+total|total\s+(?:price|amount|due|bid|proposal|contract))[^\d\-$]{0,20}\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
  )
  if (labelled) {
    const n = Number(labelled[1].replace(/,/g, ''))
    if (Number.isFinite(n) && n > 0) out.grand_total = n
  } else {
    // Fallback: pick the largest currency figure. Filters out per-unit prices
    // by ignoring anything under $1,000 unless it's the only match.
    const dollarRe = /\$\s*([\d,]+(?:\.\d{1,2})?)/g
    let m: RegExpExecArray | null
    const values: number[] = []
    while ((m = dollarRe.exec(clean)) !== null) {
      const n = Number(m[1].replace(/,/g, ''))
      if (Number.isFinite(n)) values.push(n)
    }
    if (values.length > 0) {
      const filtered = values.filter(v => v >= 1000)
      const pool = filtered.length > 0 ? filtered : values
      out.grand_total = Math.max(...pool)
    }
  }

  const validity = clean.match(/valid(?:\s+(?:for|through|until))?\s*(\d{1,3})\s*(?:calendar\s*)?days?/i)
  if (validity) {
    const n = Number(validity[1])
    if (Number.isFinite(n) && n > 0) out.quote_valid_days = n
  }

  return out
}

// Accepts multipart/form-data with a `file` field. Streams to Vercel Blob and
// appends the resulting public URL to RequirementInstance.attachmentUrls.

export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await resolveMagicToken(token)
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 410 })
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({
      error: 'blob_not_configured',
      message: 'File uploads are not configured on this deployment. Contact the prime.',
    }, { status: 503 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 })
  }

  const MAX_BYTES = 20 * 1024 * 1024 // 20 MB
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 413 })
  }

  const { record } = result
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'upload'
  const key = `requirements/${record.requirement.opportunityId}/${record.requirement.subcontractorId}/${record.requirement.id}/${Date.now()}-${safeName}`

  const blob = await put(key, file, {
    access: 'public',
    contentType: file.type || 'application/octet-stream',
  })

  const nextUrls = [...record.requirement.attachmentUrls, blob.url]
  await prisma.requirementInstance.update({
    where: { id: record.requirementInstanceId },
    data: { attachmentUrls: nextUrls, status: 'IN_PROGRESS' },
  })

  // Best-effort PDF extraction — never fails the upload. The client will only
  // apply extracted values to fields the sub hasn't filled in yet.
  let extracted: { grand_total?: number; quote_valid_days?: number } | undefined
  if ((file.type === 'application/pdf' || safeName.toLowerCase().endsWith('.pdf'))) {
    try {
      const buf = Buffer.from(await file.arrayBuffer())
      const parsed = await pdfParse(buf)
      const guess = extractQuoteFieldsFromPdfText(parsed.text || '')
      if (Object.keys(guess).length > 0) extracted = guess
    } catch (e) {
      console.warn('[requirements/upload] PDF parse failed — skipping auto-fill:', e)
    }
  }

  return NextResponse.json({
    success: true,
    url: blob.url,
    filename: safeName,
    contentType: file.type,
    size: file.size,
    extracted,
  })
}
