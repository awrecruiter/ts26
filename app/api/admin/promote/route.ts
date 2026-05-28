import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(req: Request) {
  if (req.headers.get('authorization') !== 'Bearer usher-promote-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { email } = await req.json()
  try {
    const user = await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN' },
      select: { email: true, role: true },
    })
    return NextResponse.json({ success: true, user })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
