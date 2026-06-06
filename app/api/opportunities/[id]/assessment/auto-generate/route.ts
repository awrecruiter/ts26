import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getComparablesForOpportunity } from '@/lib/comparables'

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

    const summary = await getComparablesForOpportunity({
      id: opportunity.id,
      naicsCode: opportunity.naicsCode,
      pscCode: opportunity.pscCode,
      agency: opportunity.agency,
      title: opportunity.title,
      solicitationNumber: opportunity.solicitationNumber,
      rawData: opportunity.rawData,
    })

    if (summary.confidence === 'insufficient' || summary.median <= 0) {
      return NextResponse.json(
        {
          error: 'no_historical_data',
          message: `No historical contracts found on USASpending.gov for NAICS ${opportunity.naicsCode ?? 'unknown'}${opportunity.agency ? ` / ${opportunity.agency}` : ''}. Enter your own estimated value and cost to create an assessment.`,
          dataSource: `USASpending.gov · n=${summary.count} · ${summary.confidence} confidence`,
        },
        { status: 422 }
      )
    }

    const recommendedPrice = summary.median

    let strategicValue: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
    if (recommendedPrice >= 10_000_000) strategicValue = 'HIGH'
    else if (recommendedPrice < 100_000) strategicValue = 'LOW'

    let riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
    if (summary.confidence === 'high' || summary.confidence === 'medium') riskLevel = 'LOW'
    else if (summary.confidence === 'low') riskLevel = 'HIGH'

    const sourceNote = `USASpending.gov · n=${summary.count} · tier=${summary.matchTier} · range $${Math.round(summary.p25).toLocaleString()}–$${Math.round(summary.p75).toLocaleString()} · median $${Math.round(summary.median).toLocaleString()} · ${summary.confidence}. Value shown is median of comparable historical awards — enter your own cost estimate to calculate margin.`

    // Keep historicalData populated for the panel's legacy display (top 10 awards):
    const historicalData = summary.awards.slice(0, 10).map((a) => ({
      award_id: a.awardId,
      award_amount: a.awardAmount,
      awarding_agency_name: a.awardingAgency ?? null,
      recipient_name: a.recipientName,
      description: a.description ?? null,
      period_of_performance_start_date: a.popStart?.toISOString() ?? null,
      period_of_performance_current_end_date: a.popEnd?.toISOString() ?? null,
      naics_code: a.naicsCode ?? null,
    }))

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
        historicalData: historicalData as any,
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
