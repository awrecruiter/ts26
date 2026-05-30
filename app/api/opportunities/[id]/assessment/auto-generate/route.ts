import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getPricingRecommendation } from '@/lib/usaspending'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Check if assessment already exists
    const existingAssessment = await prisma.opportunityAssessment.findUnique({
      where: { opportunityId: id },
    })

    if (existingAssessment) {
      return NextResponse.json({ assessment: existingAssessment })
    }

    // Get opportunity
    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Get pricing recommendation from USASpending
    const pricingAnalysis = await getPricingRecommendation({
      naicsCode: opportunity.naicsCode,
      title: opportunity.title,
      agency: opportunity.agency,
    })

    // If no historical data found, don't create an assessment with invented numbers
    if (pricingAnalysis.confidence === 'no_data' || pricingAnalysis.recommendedBidPrice === 0) {
      return NextResponse.json(
        {
          error: 'no_historical_data',
          message: `No historical contracts found on USASpending.gov for NAICS ${opportunity.naicsCode ?? 'unknown'}${opportunity.agency ? ` / ${opportunity.agency}` : ''}. Enter your own estimated value and cost to create an assessment.`,
          dataSource: pricingAnalysis.dataSource,
        },
        { status: 422 }
      )
    }

    // Historical median is the estimated contract value
    const recommendedPrice = pricingAnalysis.recommendedBidPrice

    // Determine opportunity size and strategic value based on historical data
    let strategicValue: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
    if (recommendedPrice >= 10000000) {
      strategicValue = 'HIGH'
    } else if (recommendedPrice < 100000) {
      strategicValue = 'LOW'
    }

    // Determine risk level based on data confidence
    let riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
    if (pricingAnalysis.confidence === 'high' || pricingAnalysis.confidence === 'medium') {
      riskLevel = 'LOW'
    } else if (pricingAnalysis.confidence === 'very_low') {
      riskLevel = 'HIGH'
    }

    const sourceNote = `${pricingAnalysis.dataSource}. Value shown is median of historical awards — enter your own cost estimate to calculate margin.`

    // Create assessment with value from historical data; cost left blank for user to fill
    const assessment = await prisma.opportunityAssessment.create({
      data: {
        opportunityId: id,
        estimatedValue: recommendedPrice,
        estimatedCost: 0,
        profitMarginDollar: 0,
        profitMarginPercent: 0,
        meetsMarginTarget: false,
        strategicValue,
        riskLevel,
        recommendation: 'REVIEW',
        notes: sourceNote,
        assessedById: session.user.id,
        historicalData: pricingAnalysis.historicalContracts as any,
      },
      include: {
        assessedBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    })

    // Update progress
    await prisma.opportunityProgress.upsert({
      where: { opportunityId: id },
      create: {
        opportunityId: id,
        currentStage: 'ASSESSMENT',
        completionPct: 25,
      },
      update: {
        currentStage: 'ASSESSMENT',
        completionPct: 25,
      },
    })

    return NextResponse.json({ assessment })
  } catch (error) {
    console.error('Error auto-generating assessment:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
