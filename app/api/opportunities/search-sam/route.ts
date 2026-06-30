import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const maxDuration = 60

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search'
const PAGE_SIZE = 50
const MAX_CANDIDATES = 500
const MAX_PAGES_PER_QUERY = 10
const OVERALL_BUDGET_MS = 45_000

// Solicitation numbers are typically alphanumeric with dashes (e.g. "W912DY-25-R-0001")
const SOL_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9-]{4,}$/i

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const query: string = (body.query || '').trim()
    const naicsRaw: string = (body.naics || '').toString().trim()
    const naicsCodes = naicsRaw.split(',').map((c) => c.trim()).filter(Boolean)

    if (!query && naicsCodes.length === 0) {
      return NextResponse.json({ error: 'query or naics required' }, { status: 400 })
    }

    const apiKey = process.env.SAM_GOV_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'SAM_GOV_API_KEY not configured' }, { status: 503 })
    }

    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })

    // Cast a wide net: last 12 months of postings.
    // SAM.gov rejects ranges of exactly 365 days ("Date range must be null year(s) apart"),
    // so cap at 364.
    const postedFrom = new Date()
    postedFrom.setDate(postedFrom.getDate() - 364)

    const looksLikeSolNumber = !!query && SOL_NUMBER_PATTERN.test(query) && /[-]/.test(query)

    const buildUrl = (params: Record<string, string>) => {
      const url = new URL(SAM_API_BASE)
      url.searchParams.set('api_key', apiKey)
      url.searchParams.set('postedFrom', fmt(postedFrom))
      url.searchParams.set('postedTo', fmt(new Date()))
      url.searchParams.set('limit', String(PAGE_SIZE))
      url.searchParams.set('offset', '0')
      url.searchParams.set('ptype', 'o,p,k')
      url.searchParams.set('sortBy', '-modifiedOn')
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      return url.toString()
    }

    const callSam = async (params: Record<string, string>) => {
      const url = buildUrl(params)
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const text = await res.text()
        const msg =
          res.status === 429
            ? 'SAM.gov rate limit exceeded — wait a few minutes and try again'
            : `SAM.gov returned ${res.status}`
        return { ok: false as const, status: res.status, error: msg, details: text.substring(0, 500) }
      }
      const data = await res.json()
      return {
        ok: true as const,
        opportunities: (data.opportunitiesData || []) as any[],
        totalRecords: Number(data.totalRecords) || 0,
      }
    }

    // Search strategy:
    //  - If looks like solicitation number → try `solnum` first
    //  - Otherwise → search by `title` (substring match)
    //  - NAICS: one call per code (SAM.gov returns 0 for comma-separated `ncode`),
    //    union the results, dedupe by noticeId.
    const queryStrategies: Record<string, string>[] = []
    if (looksLikeSolNumber) {
      queryStrategies.push({ solnum: query })
      queryStrategies.push({ title: query }) // fallback if solnum miss
    } else if (query) {
      queryStrategies.push({ title: query })
    }
    if (queryStrategies.length === 0) {
      // NAICS-only search — one empty strategy so the NAICS loop fires
      queryStrategies.push({})
    }

    const fanOut: Record<string, string>[] = []
    for (const base of queryStrategies) {
      if (naicsCodes.length > 0) {
        for (const code of naicsCodes) fanOut.push({ ...base, ncode: code })
      } else {
        fanOut.push(base)
      }
    }

    const startedAt = Date.now()
    const budgetExceeded = () => Date.now() - startedAt > OVERALL_BUDGET_MS

    const seen = new Set<string>()
    const foundOpportunities: any[] = []
    let samgovTotal = 0
    let pagedCount = 0

    outer: for (const params of fanOut) {
      if (budgetExceeded()) break
      if (foundOpportunities.length >= MAX_CANDIDATES) break

      // Paginate only for NAICS queries — solnum is unique, title rarely benefits.
      const shouldPaginate = !!params.ncode
      let offset = 0
      let pagesForThisQuery = 0

      while (pagesForThisQuery < MAX_PAGES_PER_QUERY) {
        if (budgetExceeded()) break outer
        if (foundOpportunities.length >= MAX_CANDIDATES) break outer

        const result = await callSam({ ...params, offset: String(offset) })
        if (!result.ok) {
          return NextResponse.json(
            { error: result.error, details: result.details },
            { status: result.status === 429 ? 429 : 502 }
          )
        }
        pagedCount++
        if (pagesForThisQuery === 0) samgovTotal += result.totalRecords
        pagesForThisQuery++

        for (const opp of result.opportunities) {
          const key = opp.noticeId || opp.solicitationNumber
          if (!key || seen.has(key)) continue
          seen.add(key)
          foundOpportunities.push(opp)
        }

        if (result.opportunities.length < PAGE_SIZE) break
        if (!shouldPaginate) break
        offset += PAGE_SIZE
      }

      // If this is a query-by-title fallback chain (no NAICS), stop on first hit
      if (naicsCodes.length === 0 && foundOpportunities.length > 0) break
    }

    if (foundOpportunities.length === 0) {
      return NextResponse.json({
        success: true,
        saved: 0,
        created: 0,
        found: 0,
        eligible: 0,
        samgovTotal,
        paged: pagedCount,
      })
    }

    // Apply same 14-day default cutoff as local search — exclude expired and
    // anything closing within 14 days.
    const minDeadline = new Date()
    minDeadline.setDate(minDeadline.getDate() + 14)
    const eligible = foundOpportunities.filter((opp: any) => {
      if (!opp.responseDeadLine) return false
      const d = new Date(opp.responseDeadLine)
      return !isNaN(d.getTime()) && d >= minDeadline
    })

    if (eligible.length === 0) {
      return NextResponse.json({
        success: true,
        saved: 0,
        created: 0,
        found: foundOpportunities.length,
        eligible: 0,
        samgovTotal,
        paged: pagedCount,
        filteredOut: foundOpportunities.length,
        reason: 'All matches were expired or closing within 14 days',
      })
    }

    const results = await Promise.all(
      eligible.map(async (opp: any) => {
        const solNum = opp.solicitationNumber || opp.noticeId
        if (!solNum) return { ok: false }

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
        const descStr =
          typeof description === 'string'
            ? description.substring(0, 10000)
            : JSON.stringify(description).substring(0, 10000)
        const common = {
          title: opp.title || 'Untitled',
          description: descStr,
          naicsCode,
          agency: opp.fullParentPathName || opp.organizationName || opp.department || null,
          department: opp.department || opp.fullParentPathName?.split('.')[0] || null,
          state: popState,
          postedDate,
          responseDeadline,
          lastFetched: new Date(),
          status: 'ACTIVE' as const,
          rawData: opp,
        }

        try {
          const existing = await prisma.opportunity.findUnique({
            where: { solicitationNumber: solNum },
            select: { id: true },
          })
          if (existing) {
            await prisma.opportunity.update({ where: { id: existing.id }, data: common })
            return { ok: true as const, id: existing.id, created: false }
          }
          const record = await prisma.opportunity.create({
            data: { solicitationNumber: solNum, ...common },
          })
          return { ok: true as const, id: record.id, created: true }
        } catch (error) {
          return {
            ok: false as const,
            solicitation: solNum,
            error: error instanceof Error ? error.message : 'Unknown',
          }
        }
      })
    )

    const saved = results.filter((r) => r.ok)
    const created = saved.filter((r) => r.created)

    return NextResponse.json({
      success: true,
      found: foundOpportunities.length,
      eligible: eligible.length,
      saved: saved.length,
      created: created.length,
      samgovTotal,
      paged: pagedCount,
    })
  } catch (error) {
    console.error('SAM.gov live search error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
