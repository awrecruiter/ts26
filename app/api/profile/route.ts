import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, organization: true, title: true, phone: true, role: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ user })
}

export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const { name, organization, title, phone } = body as Record<string, unknown>

  const clean = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const trimmed = v.trim()
    return trimmed.length > 0 ? trimmed.slice(0, 200) : null
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: clean(name),
      organization: clean(organization),
      title: clean(title),
      phone: clean(phone),
    },
    select: { id: true, email: true, name: true, organization: true, title: true, phone: true, role: true },
  })

  return NextResponse.json({ user })
}
