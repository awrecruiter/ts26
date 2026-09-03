import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scrapeSubNet } from '@/lib/subnet'

export const maxDuration = 300

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  let scraped: number
  let records: Awaited<ReturnType<typeof scrapeSubNet>>
  try {
    records = await scrapeSubNet()
    scraped = records.length
  } catch (e) {
    console.error('[scrape-subnet] fetch failed:', e)
    await prisma.systemLog.create({
      data: {
        level: 'ERROR',
        message: 'SubNet scrape failed',
        context: { error: e instanceof Error ? e.message : String(e) },
      },
    })
    return NextResponse.json(
      { ok: false, error: 'SubNet fetch failed — page structure may have changed' },
      { status: 502 }
    )
  }

  const now = new Date()
  let created = 0
  let updated = 0
  const freshKeys = new Set<string>()

  for (const rec of records) {
    freshKeys.add(rec.sourceKey)
    const existing = await prisma.subNetOpportunity.findUnique({
      where: { sourceKey: rec.sourceKey },
      select: { id: true },
    })
    if (existing) {
      await prisma.subNetOpportunity.update({
        where: { id: existing.id },
        data: { ...rec, lastSeenAt: now, removedAt: null },
      })
      updated++
    } else {
      await prisma.subNetOpportunity.create({
        data: { ...rec, firstSeenAt: now, lastSeenAt: now },
      })
      created++
    }
  }

  // Soft-delete anything not in this fresh pull. Keeps history queryable.
  const removed = await prisma.subNetOpportunity.updateMany({
    where: {
      sourceKey: { notIn: Array.from(freshKeys) },
      removedAt: null,
    },
    data: { removedAt: now },
  })

  const durationMs = Date.now() - started

  await prisma.systemLog.create({
    data: {
      level: 'INFO',
      message: `SubNet scrape — ${scraped} live listings (${created} new, ${updated} refreshed, ${removed.count} removed)`,
      context: { scraped, created, updated, removed: removed.count, durationMs },
    },
  })

  return NextResponse.json({
    ok: true,
    durationMs,
    scraped,
    created,
    updated,
    removed: removed.count,
  })
}
