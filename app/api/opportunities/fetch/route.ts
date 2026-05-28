import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const maxDuration = 60

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search'

export async function POST(req: Request) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { limit = 100, posted_days_ago = 90, naics_codes } = body

    const apiKey = process.env.SAM_GOV_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'SAM_GOV_API_KEY not configured' }, { status: 500 })
    }

    // Calculate date range
    const postedFrom = new Date()
    postedFrom.setDate(postedFrom.getDate() - posted_days_ago)
    const postedFromStr = postedFrom.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })

    const todayStr = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })

    // Build SAM.gov search URL
    const url = new URL(SAM_API_BASE)
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('postedFrom', postedFromStr)
    url.searchParams.set('postedTo', todayStr)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', '0')
    // Only active/presolicitation opportunities
    url.searchParams.set('ptype', 'o,p,k')
    // Sort by posted date descending
    url.searchParams.set('sortBy', '-modifiedOn')

    if (naics_codes) {
      url.searchParams.set('ncode', naics_codes)
    }

    console.log(`Fetching from SAM.gov: ${url.toString().replace(apiKey, '***')}`)

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`SAM.gov error ${response.status}: ${text}`)
      const msg = response.status === 429
        ? 'SAM.gov rate limit exceeded — wait a few minutes and try again'
        : `SAM.gov returned ${response.status}`
      return NextResponse.json(
        { error: msg, details: text.substring(0, 500) },
        { status: response.status === 429 ? 429 : 400 }
      )
    }

    const data = await response.json()
    const opportunities = data.opportunitiesData || []

    console.log(`SAM.gov returned ${opportunities.length} opportunities (total: ${data.totalRecords})`)

    // Filter: only keep opportunities with ≥14 days until closing
    const minDeadlineDate = new Date()
    minDeadlineDate.setDate(minDeadlineDate.getDate() + 14)

    const filtered = opportunities.filter((opp: any) => {
      if (!opp.responseDeadLine) return false
      const deadline = new Date(opp.responseDeadLine)
      return deadline >= minDeadlineDate
    })

    console.log(`${filtered.length} opportunities with ≥14 days until closing`)

    // Upsert into database — parallel to minimize wall-clock time
    const results = await Promise.all(
      filtered.map(async (opp: any) => {
        const solNum = opp.solicitationNumber || opp.noticeId
        if (!solNum) return { ok: false }

        let postedDate = null
        if (opp.postedDate) {
          try { postedDate = new Date(opp.postedDate) } catch {}
        }
        let responseDeadline = null
        if (opp.responseDeadLine) {
          try { responseDeadline = new Date(opp.responseDeadLine) } catch {}
        }

        const description = opp.description?.body || opp.description || opp.additionalInfoLink || ''
        const popState = opp.placeOfPerformance?.state?.code
          || opp.placeOfPerformance?.state?.name
          || opp.officeAddress?.state
          || null
        const naicsCode = opp.naicsCode || opp.classificationCode || null
        const descStr = typeof description === 'string'
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
          await prisma.opportunity.upsert({
            where: { solicitationNumber: solNum },
            update: common,
            create: { solicitationNumber: solNum, ...common },
          })
          return { ok: true }
        } catch (error) {
          return { ok: false, solicitation: solNum, error: error instanceof Error ? error.message : 'Unknown' }
        }
      })
    )

    const saved = results.filter(r => r.ok)
    const errors = results.filter(r => !r.ok && r.solicitation)

    // Log the operation
    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        message: `Fetched ${opportunities.length} from SAM.gov, ${filtered.length} met deadline filter, ${saved.length} saved`,
        context: {
          user_id: session.user.id,
          total_from_sam: opportunities.length,
          filtered: filtered.length,
          saved: saved.length,
          errors: errors.length,
        },
      },
    })

    return NextResponse.json({
      success: true,
      stats: {
        total_from_sam: data.totalRecords || opportunities.length,
        returned: opportunities.length,
        met_deadline_filter: filtered.length,
        saved_to_db: saved.length,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Fetch error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
