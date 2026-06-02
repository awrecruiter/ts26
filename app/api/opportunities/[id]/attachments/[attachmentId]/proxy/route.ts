import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { extractAttachmentsFromRawData } from '@/lib/samgov'

/**
 * GET /api/opportunities/[id]/attachments/[attachmentId]/proxy
 * Proxies SAM.gov attachment downloads server-side to avoid CORS/redirect issues.
 *
 * Query params:
 *   ?download=1  — force Content-Disposition: attachment (triggers browser save dialog)
 *                  Default (no param) is inline so PDFs and images render in the viewer.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const { id, attachmentId } = await params
    const { searchParams } = new URL(request.url)
    const forceDownload = searchParams.get('download') === '1'

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

    // Fetch the file server-side, following redirects
    try {
      const response = await fetch(fetchUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'USHER/1.0',
          'Accept': '*/*',
        },
      })

      if (!response.ok) {
        return NextResponse.redirect(attachment.url)
      }

      // The real filename only shows up in S3's Content-Disposition after
      // the redirect — SAM.gov gives us "Attachment 1" with no extension,
      // which makes the browser treat the response as opaque binary.
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
      // Prefer the upstream filename when it has an extension; otherwise keep
      // the stored attachment name (which may be a user-edited rename).
      const filename = (resolvedFilename && resolvedFilename.includes('.'))
        ? resolvedFilename
        : attachment.name

      // Infer MIME type from the resolved extension when S3 returns the
      // generic octet-stream that triggers browser downloads.
      const remoteType = response.headers.get('content-type') || 'application/octet-stream'
      const ext = filename.split('.').pop()?.toLowerCase().split('?')[0] ?? ''
      const MIME_MAP: Record<string, string> = {
        pdf:  'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc:  'application/msword',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xls:  'application/vnd.ms-excel',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        txt:  'text/plain',
        png:  'image/png',
        jpg:  'image/jpeg',
        jpeg: 'image/jpeg',
        gif:  'image/gif',
        webp: 'image/webp',
        svg:  'image/svg+xml',
      }
      const contentType = (remoteType === 'application/octet-stream' && MIME_MAP[ext])
        ? MIME_MAP[ext]
        : remoteType

      const data = await response.arrayBuffer()

      const safeFilename = filename.replace(/[^\w.\-\s]/g, '_')

      const disposition = forceDownload
        ? `attachment; filename="${safeFilename}"`
        : `inline; filename="${safeFilename}"`

      return new NextResponse(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': disposition,
          'Content-Length': data.byteLength.toString(),
          'Cache-Control': 'private, max-age=3600',
        },
      })
    } catch (fetchError) {
      console.warn(`Proxy fetch failed for attachment ${attachmentId}, redirecting to original URL`)
      return NextResponse.redirect(attachment.url)
    }
  } catch (error) {
    console.error('Attachment proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to proxy attachment' },
      { status: 500 }
    )
  }
}
