import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

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
    const VALID_STATUSES = ['ACTIVE', 'EXPIRED', 'AWARDED', 'CANCELLED']
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

    // Legacy params
    const minDaysUntilClose = parseInt(searchParams.get('minDays') || '14')
    const showExpiring = searchParams.get('showExpiring') === 'true'

    const where: any = {}

    // Deadline filter — deadlineDays takes priority over showExpiring/minDays
    if (deadlineDays) {
      const now = new Date()
      const maxDate = new Date()
      maxDate.setDate(maxDate.getDate() + parseInt(deadlineDays))
      where.responseDeadline = { gte: now, lte: maxDate }
    } else if (!showExpiring && minDaysUntilClose > 0) {
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
      where.naicsCode = naicsCode
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
      where.AND = [
        {
          OR: [
            { sows: { some: {} } },
            { bids: { some: {} } },
            { subcontractors: { some: {} } },
            { progress: { isNot: null } },
            { assessment: { isNot: null } },
          ],
        },
      ]
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
            source: true,
            confidence: true,
            historicalData: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    return NextResponse.json({
      success: true,
      opportunities,
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
