import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { classifyContractType } from '@/lib/opportunity-classification'

export const maxDuration = 300

// Preset NAICS codes the nightly SAM fetch pulls into the library.
// Approved by ashleymariecwhite-1657, 2026-09-02.
const NIGHTLY_NAICS: string[] = [
  '237310', // Highway/Street/Bridge Construction
  '236220', // Commercial Building Construction
  '237110', // Water & Sewer Line
  '237990', // Other Heavy & Civil
  '238210', // Electrical Contractors
]

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search'
// SAM.gov's `offset` parameter is broken when limit=50 — pages past 0 return
// empty. Its max limit is 1000, and 1000 works. Bridge/highway (237310) has
// ~215 records/year; no construction NAICS breaks 1000, so a single call
// per NAICS covers everything without touching pagination.
const SAM_MAX_LIMIT = 1000

function fmt(d: Date): string {
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

async function fetchSamNaics(apiKey: string, naics: string): Promise<any[]> {
  const postedFrom = new Date()
  postedFrom.setDate(postedFrom.getDate() - 364)

  const url = new URL(SAM_API_BASE)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('postedFrom', fmt(postedFrom))
  url.searchParams.set('postedTo', fmt(new Date()))
  url.searchParams.set('limit', String(SAM_MAX_LIMIT))
  url.searchParams.set('offset', '0')
  // ptype=s (Special Notice) is included so primes-seeking-subs postings
  // on SAM.gov come through alongside government solicitations.
  url.searchParams.set('ptype', 'o,p,k,s')
  url.searchParams.set('ncode', naics)

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    console.error(`[nightly-maintenance] SAM ${res.status} for ${naics}`)
    return []
  }
  const data = await res.json()
  const opps = (data.opportunitiesData || []) as any[]
  if (data.totalRecords > SAM_MAX_LIMIT) {
    console.warn(`[nightly-maintenance] ${naics} has ${data.totalRecords} records — exceeds SAM_MAX_LIMIT ${SAM_MAX_LIMIT}, truncating`)
  }
  return opps
}

async function upsertOpportunity(opp: any): Promise<'created' | 'updated' | 'skipped'> {
  const solNum = opp.solicitationNumber || opp.noticeId
  if (!solNum) return 'skipped'

  let postedDate: Date | null = null
  if (opp.postedDate) {
    try { postedDate = new Date(opp.postedDate) } catch {}
  }
  let responseDeadline: Date | null = null
  if (opp.responseDeadLine) {
    try { responseDeadline = new Date(opp.responseDeadLine) } catch {}
  }

  const description = opp.description?.body || opp.description || opp.additionalInfoLink || ''
  const popState =
    opp.placeOfPerformance?.state?.code ||
    opp.placeOfPerformance?.state?.name ||
    opp.officeAddress?.state ||
    null
  const naicsCode = opp.naicsCode || opp.classificationCode || null
  const pscCode = opp.classificationCode || null
  const descStr = typeof description === 'string'
    ? description.substring(0, 10000)
    : JSON.stringify(description).substring(0, 10000)
  const classification = classifyContractType({
    pscCode,
    naicsCode,
    title: opp.title,
    description: descStr,
  })
  const common = {
    title: opp.title || 'Untitled',
    description: descStr,
    naicsCode,
    pscCode,
    agency: opp.fullParentPathName || opp.organizationName || opp.department || null,
    department: opp.department || opp.fullParentPathName?.split('.')[0] || null,
    state: popState,
    postedDate,
    responseDeadline,
    lastFetched: new Date(),
    status: 'ACTIVE' as const,
    rawData: opp,
  }

  const existing = await prisma.opportunity.findUnique({
    where: { solicitationNumber: solNum },
    select: { id: true, contractTypeOverride: true },
  })
  const classificationUpdate = existing?.contractTypeOverride
    ? {}
    : {
        contractType: classification.contractType,
        contractTypeSource: classification.source,
      }

  if (existing) {
    await prisma.opportunity.update({
      where: { id: existing.id },
      data: { ...common, ...classificationUpdate },
    })
    return 'updated'
  }
  await prisma.opportunity.create({
    data: {
      solicitationNumber: solNum,
      ...common,
      contractType: classification.contractType,
      contractTypeSource: classification.source,
    },
  })
  return 'created'
}

export async function GET(req: Request) {
  // Vercel Cron sends the CRON_SECRET as a bearer token. Manual invocations
  // (curl for smoke testing) must set the same header.
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const now = new Date()
  const apiKey = process.env.SAM_GOV_API_KEY
  const perNaics: Record<string, { fetched: number; skippedExpired: number; created: number; updated: number }> = {}

  // Step 1 — nightly SAM fetch across approved NAICS codes.
  // Skip records already past their responseDeadLine — user policy: don't
  // pull irrelevant posts into the DB in the first place. Records with no
  // responseDeadLine at all are still kept (sources-sought, awards).
  if (!apiKey) {
    console.warn('[nightly-maintenance] SAM_GOV_API_KEY missing — skipping SAM fetch')
  } else {
    for (const naics of NIGHTLY_NAICS) {
      const raw = await fetchSamNaics(apiKey, naics)
      const stillOpen = raw.filter((opp: any) => {
        if (!opp.responseDeadLine) return true
        const d = new Date(opp.responseDeadLine)
        if (isNaN(d.getTime())) return true
        return d >= now
      })
      let created = 0
      let updated = 0
      for (const opp of stillOpen) {
        try {
          const result = await upsertOpportunity(opp)
          if (result === 'created') created++
          else if (result === 'updated') updated++
        } catch (e) {
          console.error(`[nightly-maintenance] upsert failed for ${naics}:`, e)
        }
      }
      perNaics[naics] = {
        fetched: raw.length,
        skippedExpired: raw.length - stillOpen.length,
        created,
        updated,
      }
    }
  }

  // Step 2 — delete expired records that have no user work attached.
  // "User work" = SOW, Bid, Assessment, or manually-added Subcontractor.
  // Anything user-touched keeps its row (status flips to EXPIRED so it
  // drops off the default list but stays queryable in history).
  const expiredIds = await prisma.opportunity.findMany({
    where: {
      responseDeadline: { lt: now, not: null },
    },
    select: {
      id: true,
      _count: { select: { sows: true, bids: true, subcontractors: true } },
      assessment: { select: { id: true } },
    },
  })

  const deletable = expiredIds
    .filter((o) =>
      o._count.sows === 0 &&
      o._count.bids === 0 &&
      o._count.subcontractors === 0 &&
      !o.assessment
    )
    .map((o) => o.id)

  const preservable = expiredIds
    .filter((o) => !deletable.includes(o.id))
    .map((o) => o.id)

  let deletedCount = 0
  let preservedCount = 0
  if (deletable.length > 0) {
    // Chunk deletes to keep the pool happy on a big backfill run.
    const CHUNK = 100
    for (let i = 0; i < deletable.length; i += CHUNK) {
      const chunk = deletable.slice(i, i + CHUNK)
      const res = await prisma.opportunity.deleteMany({ where: { id: { in: chunk } } })
      deletedCount += res.count
    }
  }
  if (preservable.length > 0) {
    const preserved = await prisma.opportunity.updateMany({
      where: { id: { in: preservable }, status: { not: 'EXPIRED' } },
      data: { status: 'EXPIRED' },
    })
    preservedCount = preserved.count
  }

  const durationMs = Date.now() - started

  await prisma.systemLog.create({
    data: {
      level: 'INFO',
      message: `Nightly maintenance — ${Object.keys(perNaics).length} NAICS fetched, ${deletedCount} expired deleted, ${preservedCount} kept (had work attached)`,
      context: { perNaics, deletedCount, preservedCount, durationMs },
    },
  })

  return NextResponse.json({
    ok: true,
    durationMs,
    perNaics,
    expiredDeleted: deletedCount,
    expiredKeptWithWork: preservedCount,
  })
}
