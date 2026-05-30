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

    // Fetch the file server-side, following redirects
    try {
      const response = await fetch(attachment.url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'USHER/1.0',
          'Accept': '*/*',
        },
      })

      if (!response.ok) {
        // Redirect to original URL as fallback
        return NextResponse.redirect(attachment.url)
      }

      // Infer MIME type from file extension when S3 returns generic octet-stream
      const remoteType = response.headers.get('content-type') || 'application/octet-stream'
      const ext = attachment.name.split('.').pop()?.toLowerCase().split('?')[0] ?? ''
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
      }
      const contentType = (remoteType === 'application/octet-stream' && MIME_MAP[ext])
        ? MIME_MAP[ext]
        : remoteType

      const data = await response.arrayBuffer()

      // Sanitize filename for Content-Disposition header
      const safeFilename = attachment.name.replace(/[^\w.\-\s]/g, '_')

      // Use 'attachment' only when the caller explicitly requests a download.
      // Default to 'inline' so browsers render PDFs and images inside the viewer iframe.
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
