import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/db'
import { resolveSuperToken } from '@/lib/requirements/super-tokens'
import { rollupDailyReportsToCycle } from '@/lib/requirements/daily-log-rollup'

export const runtime = 'nodejs'

// kind=photo → photoUrls, kind=file → attachmentUrls. Defaults to photo when
// the client sends an image.
type UploadKind = 'photo' | 'file'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string; reportId: string }> },
) {
  const { token, reportId } = await params
  const result = await resolveSuperToken(token)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 410 })

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({
      error: 'blob_not_configured',
      message: 'File uploads are not configured on this deployment. Contact the prime.',
    }, { status: 503 })
  }

  const report = await prisma.dailyReport.findUnique({ where: { id: reportId } })
  if (!report ||
      report.opportunityId !== result.record.opportunityId ||
      report.subcontractorId !== result.record.subcontractorId) {
    return NextResponse.json({ error: 'report_not_found' }, { status: 404 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 })
  }

  const kindParam = (form.get('kind') as string | null)?.toLowerCase()
  const kind: UploadKind =
    kindParam === 'file' ? 'file'
    : kindParam === 'photo' ? 'photo'
    : file.type.startsWith('image/') ? 'photo' : 'file'

  const MAX_BYTES = 20 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 413 })
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'upload'
  const dateKey = report.reportDate.toISOString().slice(0, 10)
  const key = `daily-reports/${report.opportunityId}/${report.subcontractorId}/${dateKey}/${Date.now()}-${safeName}`

  const blob = await put(key, file, {
    access: 'public',
    contentType: file.type || 'application/octet-stream',
  })

  const nextPhotos = kind === 'photo' ? [...report.photoUrls, blob.url] : report.photoUrls
  const nextFiles = kind === 'file' ? [...report.attachmentUrls, blob.url] : report.attachmentUrls

  await prisma.dailyReport.update({
    where: { id: report.id },
    data: { photoUrls: nextPhotos, attachmentUrls: nextFiles },
  })

  // Keep the payment-cycle rollup fresh so newly-attached photos/docs show
  // up in the sub's monthly pay app without waiting for the next save.
  await rollupDailyReportsToCycle({
    opportunityId: report.opportunityId,
    subcontractorId: report.subcontractorId,
    reportDate: report.reportDate,
  })

  return NextResponse.json({
    success: true,
    url: blob.url,
    filename: safeName,
    contentType: file.type,
    size: file.size,
    kind,
  })
}
