import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { summarizeComparables, type MatchTier } from '@/lib/comparables'

export async function GET(req: Request) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search')
    const naicsCode = searchParams.get('naics')
    const agency = searchParams.get('agency')
    const VALID_STATUSES = ['ACTIVE', 'EXPIRED', 'AWARDED', 'CANCELLED', 'DISMISSED']
    const rawStatus = searchParams.get('status')
    const status = rawStatus && VALID_STATUSES.includes(rawStatus) ? rawStatus : (rawStatus ? null : 'ACTIVE')

    // Advanced filter params
    const hasSOW = searchParams.get('hasSOW')           // 'yes' | 'no' | null
    const hasBid = searchParams.get('hasBid')           // 'yes' | 'no' | null
    const recommendation = searchParams.get('recommendation') // 'GO' | 'REVIEW' | 'NO_GO' | null
    const deadlineDays = searchParams.get('deadlineDays')     // '7' | '14' | '30' | '60' | null
    const minMargin = parseFloat(searchParams.get('minMargin') || '')
    const maxMargin = parseFloat(searchParams.get('maxMargin') || '')
    const sort = searchParams.get('sort') || 'deadline_asc'

    const engaged = searchParams.get('engaged') === 'true'

    // Default cutoff: only show opportunities with ≥14 days until closing.
    // Override with deadlineDays (window filter) or showExpiring=true.
    const minDaysUntilClose = parseInt(searchParams.get('minDays') || '14')
    const showExpiring = searchParams.get('showExpiring') === 'true'

    const where: any = {}

    if (deadlineDays) {
      const now = new Date()
      const maxDate = new Date()
      maxDate.setDate(maxDate.getDate() + parseInt(deadlineDays))
      where.responseDeadline = { gte: now, lte: maxDate }
    } else if (!showExpiring && minDaysUntilClose > 0 && status !== 'DISMISSED') {
      // Don't apply the deadline cutoff to the Dismissed view — dismissed
      // opps may have already-passed deadlines and we still want to show them.
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() + minDaysUntilClose)
      where.responseDeadline = { gte: cutoffDate }
    }

    if (status) {
      where.status = status
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { solicitationNumber: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (naicsCode) {
      const codes = naicsCode.split(',').map((c) => c.trim()).filter(Boolean)
      if (codes.length === 1) {
        where.naicsCode = codes[0]
      } else if (codes.length > 1) {
        where.naicsCode = { in: codes }
      }
    }

    if (agency) {
      where.agency = { contains: agency, mode: 'insensitive' }
    }

    // hasSOW filter
    if (hasSOW === 'yes') {
      where.sows = { some: {} }
    } else if (hasSOW === 'no') {
      where.sows = { none: {} }
    }

    // hasBid filter
    if (hasBid === 'yes') {
      where.bids = { some: {} }
    } else if (hasBid === 'no') {
      where.bids = { none: {} }
    }

    // Assessment-based filters (recommendation + margin)
    const assessmentWhere: any = {}
    if (recommendation && recommendation !== 'all') {
      assessmentWhere.recommendation = recommendation
    }
    if (!isNaN(minMargin) || !isNaN(maxMargin)) {
      assessmentWhere.profitMarginPercent = {}
      if (!isNaN(minMargin)) assessmentWhere.profitMarginPercent.gte = minMargin
      if (!isNaN(maxMargin)) assessmentWhere.profitMarginPercent.lte = maxMargin
    }
    if (Object.keys(assessmentWhere).length > 0) {
      where.assessment = assessmentWhere
    }

    if (engaged) {
      // An opportunity is dashboard-eligible only once at least one
      // subcontractor has actually been emailed (on-platform send or manual
      // "Mark sent" by an admin). Pure-discovery records — assessment only,
      // SOW drafted, vendors discovered but not contacted — stay off the
      // dashboard and live in the /opportunities library instead.
      where.subcontractors = { some: { sowSentAt: { not: null } } }
    }

    const total = await prisma.opportunity.count({ where })

    const SORT_MAP: Record<string, object> = {
      deadline_asc:  { responseDeadline: 'asc' },
      deadline_desc: { responseDeadline: 'desc' },
      posted_desc:   { postedDate: 'desc' },
      posted_asc:    { postedDate: 'asc' },
      title_asc:     { title: 'asc' },
      title_desc:    { title: 'desc' },
    }
    const orderBy = SORT_MAP[sort] ?? { responseDeadline: 'asc' }

    const opportunities = await prisma.opportunity.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: {
          select: {
            bids: true,
            subcontractors: true,
            sows: true,
          },
        },
        assessment: {
          select: {
            estimatedValue: true,
            estimatedCost: true,
            profitMarginPercent: true,
            profitMarginDollar: true,
            recommendation: true,
            strategicValue: true,
            riskLevel: true,
          },
        },
        bids: {
          select: {
            id: true,
            source: true,
            confidence: true,
            historicalData: true,
            status: true,
            recommendedPrice: true,
            approvalRequests: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                reviewerNote: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        progress: {
          select: { currentStage: true, completionPct: true, nextActions: true },
        },
      },
    })

    // Batch-load cached comparables for all returned opps (avoid N+1).
    const oppIds = opportunities.map((o) => o.id)
    const allComparables = await prisma.opportunityComparable.findMany({
      where: { opportunityId: { in: oppIds } },
      orderBy: { awardAmount: 'desc' },
    })
    const byOpp = new Map<string, typeof allComparables>()
    for (const c of allComparables) {
      const arr = byOpp.get(c.opportunityId) ?? []
      arr.push(c)
      byOpp.set(c.opportunityId, arr)
    }

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    const enriched = opportunities.map((o) => {
      const awards = byOpp.get(o.id) ?? []
      if (awards.length === 0) {
        return { ...o, comparables: null }
      }
      const fetchedAt = awards[0].fetchedAt
      const isStale = Date.now() - fetchedAt.getTime() > SEVEN_DAYS_MS
      const summary = summarizeComparables(
        awards,
        (awards[0].matchTier as MatchTier) || null,
        fetchedAt
      )
      return {
        ...o,
        comparables: {
          count: summary.count,
          p25: summary.p25,
          median: summary.median,
          p75: summary.p75,
          min: summary.min,
          max: summary.max,
          confidence: summary.confidence,
          matchTier: summary.matchTier,
          fetchedAt: summary.fetchedAt,
          topIncumbent: summary.topIncumbent,
          currentIncumbent: summary.currentIncumbent,
          isStale,
        },
      }
    })

    return NextResponse.json({
      success: true,
      opportunities: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching opportunities:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
