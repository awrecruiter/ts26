import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/db'
import { resolveMagicToken } from '@/lib/requirements/tokens'

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

  return NextResponse.json({
    success: true,
    url: blob.url,
    filename: safeName,
    contentType: file.type,
    size: file.size,
  })
}
