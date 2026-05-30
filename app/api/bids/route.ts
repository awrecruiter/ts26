import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getPricingRecommendation } from '@/lib/usaspending'

export async function POST(req: Request) {
  try {
    // Check authentication
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const { opportunityId } = body

    if (!opportunityId) {
      return NextResponse.json(
        { error: 'Opportunity ID is required' },
        { status: 400 }
      )
    }

    // Check if opportunity exists and get assessment with subcontractors
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: {
        assessment: true,
        subcontractors: true,
      },
    })

    if (!opportunity) {
      return NextResponse.json(
        { error: 'Opportunity not found' },
        { status: 404 }
      )
    }

    // Get historical pricing data from USASpending API
    const estimatedCost = opportunity.assessment?.estimatedCost || undefined
    const pricingAnalysis = await getPricingRecommendation(
      {
        naicsCode: opportunity.naicsCode,
        title: opportunity.title,
        agency: opportunity.agency,
      },
      estimatedCost
    )

    // Calculate profit analysis based on recommended price
    const recommendedPrice = pricingAnalysis.recommendedBidPrice
    const costBasis = estimatedCost || (recommendedPrice > 0 ? recommendedPrice * 0.75 : 0)
    const potentialProfit = recommendedPrice > 0 ? recommendedPrice - costBasis : 0
    const marginPercent = recommendedPrice > 0
      ? (potentialProfit / recommendedPrice) * 100
      : 0
    const grossMargin = marginPercent.toFixed(2)

    // Determine profitability rating
    let profitabilityRating = 'Low'
    if (marginPercent >= 30) profitabilityRating = 'Excellent'
    else if (marginPercent >= 20) profitabilityRating = 'Good'
    else if (marginPercent >= 10) profitabilityRating = 'Moderate'
    else if (marginPercent >= 5) profitabilityRating = 'Marginal'

    // Determine opportunity size
    let opportunitySize = 'Small'
    if (recommendedPrice >= 10000000) opportunitySize = 'Large'
    else if (recommendedPrice >= 1000000) opportunitySize = 'Medium'
    else if (recommendedPrice >= 100000) opportunitySize = 'Small'
    else opportunitySize = 'Micro'

    // Build subcontractor estimates for bid content
    const subcontractorEstimates = opportunity.subcontractors.map((sub) => ({
      name: sub.name,
      service: sub.service || 'General Services',
      estimated_cost: sub.quotedAmount || 0,
      is_actual_quote: sub.isActualQuote,
    }))

    // Create initial bid document content
    const bidContent = {
      header: {
        title: 'BID PROPOSAL',
        date: new Date().toLocaleDateString(),
        bid_id: `BID-${Date.now().toString(36).toUpperCase()}`,
        prepared_for: opportunity.agency || 'Government Agency',
        prepared_by: session.user.name || 'USHER Team',
      },
      opportunity: {
        title: opportunity.title,
        solicitation_number: opportunity.solicitationNumber,
        agency: opportunity.agency || '',
        naics_code: opportunity.naicsCode || '',
      },
      pricing: {
        recommended_price: recommendedPrice,
        cost_basis: costBasis,
        gross_margin: parseFloat(grossMargin),
        confidence: pricingAnalysis.confidence,
        source: pricingAnalysis.totalContracts > 0
          ? 'usaspending_api'
          : estimatedCost
            ? 'cost_based'
            : 'default_fallback',
      },
      sections: [
        {
          title: 'Executive Summary',
          content: 'This proposal outlines our comprehensive approach to fulfilling the requirements specified in the solicitation.',
        },
        {
          title: 'Technical Approach',
          content: 'Our technical approach leverages industry best practices and innovative solutions.',
        },
        {
          title: 'Past Performance',
          content: 'Our organization has a demonstrated track record of successfully delivering similar projects.',
        },
      ],
      subcontractor_estimates: subcontractorEstimates,
    }

    // Create bid with USASpending data
    const bid = await prisma.bid.create({
      data: {
        opportunityId,
        userId: session.user.id,
        recommendedPrice,
        costBasis,
        potentialProfit,
        grossMargin: parseFloat(grossMargin),
        profitabilityRating,
        opportunitySize,
        confidence: pricingAnalysis.confidence,
        source: pricingAnalysis.totalContracts > 0
          ? 'usaspending_api'
          : estimatedCost
            ? 'cost_based'
            : 'default_fallback',
        historicalData: {
          totalContracts: pricingAnalysis.totalContracts,
          averageValue: pricingAnalysis.averageContractValue,
          medianValue: pricingAnalysis.medianContractValue,
          minValue: pricingAnalysis.minContractValue,
          maxValue: pricingAnalysis.maxContractValue,
          contracts: pricingAnalysis.historicalContracts as any,
        },
        content: bidContent,
        notes: `Bid pricing based on ${pricingAnalysis.totalContracts} historical contracts from USASpending API. Confidence: ${pricingAnalysis.confidence}.`,
        status: 'DRAFT',
      },
    })

    // Auto-create assessment only if none exists — never overwrite a user's manual assessment
    if (!opportunity.assessment && recommendedPrice > 0) {
      const autoMarginPercent = parseFloat(grossMargin)
      const meetsMarginTarget = autoMarginPercent >= 10

      let recommendation = 'NO_GO'
      if (autoMarginPercent >= 20) recommendation = 'GO'
      else if (autoMarginPercent >= 10) recommendation = 'REVIEW'

      let strategicValue: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
      if (opportunitySize === 'Large') strategicValue = 'HIGH'
      else if (opportunitySize === 'Micro') strategicValue = 'LOW'

      let riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
      if (pricingAnalysis.confidence === 'high' || pricingAnalysis.confidence === 'medium') {
        riskLevel = 'LOW'
      } else if (pricingAnalysis.confidence === 'very_low') {
        riskLevel = 'HIGH'
      }

      await prisma.opportunityAssessment.create({
        data: {
          opportunityId,
          estimatedValue: recommendedPrice,
          estimatedCost: costBasis,
          profitMarginDollar: potentialProfit,
          profitMarginPercent: autoMarginPercent,
          meetsMarginTarget,
          strategicValue,
          riskLevel,
          recommendation,
          notes: `Auto-generated from bid analysis. ${pricingAnalysis.totalContracts} historical contracts analyzed.`,
          assessedById: session.user.id,
        },
      })
    }

    // Update progress to ASSESSMENT stage if not already past it
    await prisma.opportunityProgress.upsert({
      where: { opportunityId },
      create: {
        opportunityId,
        currentStage: 'ASSESSMENT',
        completionPct: 25,
      },
      update: {
        currentStage: 'ASSESSMENT',
        completionPct: 25,
      },
    })

    return NextResponse.json({
      success: true,
      bid,
      pricingAnalysis,
    })

  } catch (error) {
    console.error('Error creating bid:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    // Check authentication
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const opportunityId = searchParams.get('opportunityId')
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const skip = (page - 1) * limit

    const where: any = {}

    if (opportunityId) {
      where.opportunityId = opportunityId
    }

    if (status) {
      where.status = status
    }

    // Search by opportunity title or solicitation number
    if (search) {
      where.opportunity = {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { solicitationNumber: { contains: search, mode: 'insensitive' } },
        ],
      }
    }

    // Get total count for pagination
    const total = await prisma.bid.count({ where })

    const bids = await prisma.bid.findMany({
      where,
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            solicitationNumber: true,
            agency: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    })

    return NextResponse.json({
      success: true,
      bids,
      count: bids.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })

  } catch (error) {
    console.error('Error fetching bids:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
