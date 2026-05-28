import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

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
      return NextResponse.json({ error: 'SAM_GOV_API_KEY not configured' }, { status: 503 })
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
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`SAM.gov error ${response.status}: ${text}`)
      return NextResponse.json(
        { error: `SAM.gov returned ${response.status}`, details: text },
        { status: 502 }
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

    // Upsert into database
    const saved = []
    const errors = []

    for (const opp of filtered) {
      try {
        const solNum = opp.solicitationNumber || opp.noticeId
        if (!solNum) continue

        let postedDate = null
        if (opp.postedDate) {
          try { postedDate = new Date(opp.postedDate) } catch {}
        }

        let responseDeadline = null
        if (opp.responseDeadLine) {
          try { responseDeadline = new Date(opp.responseDeadLine) } catch {}
        }

        // Extract description from various SAM.gov fields
        const description = opp.description?.body || opp.description || opp.additionalInfoLink || ''

        // Extract place of performance state
        const popState = opp.placeOfPerformance?.state?.code
          || opp.placeOfPerformance?.state?.name
          || opp.officeAddress?.state
          || null

        // Extract NAICS codes - SAM.gov can return them in different formats
        let naicsCode = null
        if (opp.naicsCode) {
          naicsCode = opp.naicsCode
        } else if (opp.classificationCode) {
          naicsCode = opp.classificationCode
        }

        const record = await prisma.opportunity.upsert({
          where: { solicitationNumber: solNum },
          update: {
            title: opp.title || 'Untitled',
            description: typeof description === 'string' ? description.substring(0, 10000) : JSON.stringify(description).substring(0, 10000),
            naicsCode,
            agency: opp.fullParentPathName || opp.organizationName || opp.department || null,
            department: opp.department || opp.fullParentPathName?.split('.')[0] || null,
            state: popState,
            postedDate,
            responseDeadline,
            lastFetched: new Date(),
            status: 'ACTIVE',
            rawData: opp,
          },
          create: {
            solicitationNumber: solNum,
            title: opp.title || 'Untitled',
            description: typeof description === 'string' ? description.substring(0, 10000) : JSON.stringify(description).substring(0, 10000),
            naicsCode,
            agency: opp.fullParentPathName || opp.organizationName || opp.department || null,
            department: opp.department || opp.fullParentPathName?.split('.')[0] || null,
            state: popState,
            postedDate,
            responseDeadline,
            lastFetched: new Date(),
            status: 'ACTIVE',
            rawData: opp,
          },
        })

        saved.push(record)
      } catch (error) {
        errors.push({
          solicitation: opp.solicitationNumber,
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
    }

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
