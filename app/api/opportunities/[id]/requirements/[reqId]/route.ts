import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { RequirementStatus } from '@prisma/client'

interface PatchBody {
  status?: RequirementStatus
  reviewNotes?: string
  rejectionReason?: string
  dueAt?: string | null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; reqId: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, reqId } = await params
  const requirement = await prisma.requirementInstance.findUnique({
    where: { id: reqId },
    include: {
      subcontractor: { select: { id: true, name: true, contactName: true, email: true } },
      tokens: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!requirement || requirement.opportunityId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true, requirement })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; reqId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, reqId } = await params
  let body: PatchBody
  try {
    body = await req.json() as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const existing = await prisma.requirementInstance.findUnique({ where: { id: reqId } })
  if (!existing || existing.opportunityId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await prisma.requirementInstance.update({
    where: { id: reqId },
    data: {
      ...(body.status ? {
        status: body.status,
        reviewedById: session.user.id,
        reviewedAt: new Date(),
      } : {}),
      ...(body.reviewNotes !== undefined ? { reviewNotes: body.reviewNotes } : {}),
      ...(body.rejectionReason !== undefined ? { rejectionReason: body.rejectionReason } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
    },
  })

  return NextResponse.json({ success: true, requirement: updated })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; reqId: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, reqId } = await params
  const existing = await prisma.requirementInstance.findUnique({ where: { id: reqId } })
  if (!existing || existing.opportunityId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.requirementInstance.delete({ where: { id: reqId } })
  return NextResponse.json({ success: true })
}
