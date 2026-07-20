import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/db'
import { resolvePortalToken } from '@/lib/requirements/portal-tokens'

export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string; reqId: string }> },
) {
  const { token, reqId } = await params
  const result = await resolvePortalToken(token)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 410 })

  const target = result.record.cycle.requirements.find(r => r.id === reqId)
  if (!target) return NextResponse.json({ error: 'task_not_in_cycle' }, { status: 404 })

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

  const MAX_BYTES = 20 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 413 })
  }

  const cycle = result.record.cycle
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'upload'
  const key = `payment-cycles/${cycle.opportunityId}/${cycle.subcontractorId}/${cycle.id}/${target.id}/${Date.now()}-${safeName}`

  const blob = await put(key, file, {
    access: 'public',
    contentType: file.type || 'application/octet-stream',
  })

  const nextUrls = [...target.attachmentUrls, blob.url]
  await prisma.requirementInstance.update({
    where: { id: target.id },
    data: {
      attachmentUrls: nextUrls,
      status: target.status === 'TODO' ? 'IN_PROGRESS' : target.status,
    },
  })

  return NextResponse.json({
    success: true,
    url: blob.url,
    filename: safeName,
    contentType: file.type,
    size: file.size,
  })
}
