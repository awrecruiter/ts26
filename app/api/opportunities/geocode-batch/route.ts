import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { geocodeAddress, addressFromOpportunity } from '@/lib/geocode'

export const maxDuration = 60

// Concurrency cap for Google Geocoding API calls — free tier allows 50 QPS,
// but we don't want to burn quota on a single request. 5 in-flight is plenty
// for a map page that only requests missing points.
const CONCURRENCY = 5

interface Body {
  ids?: string[]
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body: Body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body.ids) ? body.ids.filter((i) => typeof i === 'string') : []
  if (ids.length === 0) {
    return NextResponse.json({ geocoded: {}, skipped: 0, requested: 0 })
  }

  // Only work on opportunities that are still missing coordinates. Anything
  // already geocoded is short-circuited.
  const missing = await prisma.opportunity.findMany({
    where: {
      id: { in: ids },
      latitude: null,
    },
    select: { id: true, state: true, rawData: true },
  })

  const results: Record<string, { lat: number; lng: number }> = {}
  const queue = [...missing]

  async function worker() {
    while (queue.length > 0) {
      const opp = queue.shift()
      if (!opp) return
      const address = addressFromOpportunity(opp)
      if (!address) continue
      try {
        const point = await geocodeAddress(address)
        if (!point) continue
        await prisma.opportunity.update({
          where: { id: opp.id },
          data: {
            latitude: point.lat,
            longitude: point.lng,
            geocodedAt: new Date(),
          },
        })
        results[opp.id] = { lat: point.lat, lng: point.lng }
      } catch {
        // Skip on individual failure — next map load will retry.
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return NextResponse.json({
    geocoded: results,
    requested: ids.length,
    attempted: missing.length,
    saved: Object.keys(results).length,
  })
}
