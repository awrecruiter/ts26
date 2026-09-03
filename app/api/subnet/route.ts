import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim() || null
  const state = searchParams.get('state')?.trim() || null
  const naics = searchParams.get('naics')?.trim() || null
  const includeRemoved = searchParams.get('includeRemoved') === 'true'
  const page = parseInt(searchParams.get('page') || '1')
  const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 200)

  const where: any = {}
  if (!includeRemoved) where.removedAt = null
  if (state) where.state = { equals: state, mode: 'insensitive' }
  if (naics) where.naicsCode = { startsWith: naics }
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { primeName: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, records, lastLog] = await Promise.all([
    prisma.subNetOpportunity.count({ where }),
    prisma.subNetOpportunity.findMany({
      where,
      orderBy: [{ closingDate: 'asc' }, { lastSeenAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.systemLog.findFirst({
      where: { message: { startsWith: 'SubNet scrape' } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, message: true },
    }),
  ])

  return NextResponse.json({
    records,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    lastScrapedAt: lastLog?.createdAt || null,
    lastScrapeSummary: lastLog?.message || null,
  })
}
