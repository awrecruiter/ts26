import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export interface CalcDrift {
  recordId: string
  recordType: 'OpportunityAssessment' | 'Bid'
  field: string
  storedValue: number
  expectedValue: number
  drift: number
}

const DRIFT_THRESHOLD = 0.01

function roundTo(value: number, decimals: number = 4): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)
}

export async function GET(): Promise<NextResponse> {
  const session = await auth()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const drifts: CalcDrift[] = []

  // ── OpportunityAssessment audit ─────────────────────────────────────────────
  const assessments = await prisma.opportunityAssessment.findMany({
    take: 20,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      estimatedValue: true,
      estimatedCost: true,
      profitMarginDollar: true,
      profitMarginPercent: true,
      meetsMarginTarget: true,
    },
  })

  for (const a of assessments) {
    const val = a.estimatedValue
    const cost = a.estimatedCost

    if (val == null || cost == null) continue

    // profitMarginDollar = estimatedValue - estimatedCost
    const expectedDollar = roundTo(val - cost)
    if (a.profitMarginDollar != null) {
      const storedDollar = roundTo(a.profitMarginDollar)
      const drift = Math.abs(storedDollar - expectedDollar)
      if (drift > DRIFT_THRESHOLD) {
        drifts.push({
          recordId: a.id,
          recordType: 'OpportunityAssessment',
          field: 'profitMarginDollar',
          storedValue: storedDollar,
          expectedValue: expectedDollar,
          drift: roundTo(drift),
        })
      }
    }

    // profitMarginPercent = (profitMarginDollar / estimatedValue) * 100
    if (val !== 0 && a.profitMarginPercent != null) {
      const expectedPct = roundTo(((val - cost) / val) * 100)
      const storedPct = roundTo(a.profitMarginPercent)
      const drift = Math.abs(storedPct - expectedPct)
      if (drift > DRIFT_THRESHOLD) {
        drifts.push({
          recordId: a.id,
          recordType: 'OpportunityAssessment',
          field: 'profitMarginPercent',
          storedValue: storedPct,
          expectedValue: expectedPct,
          drift: roundTo(drift),
        })
      }
    }

    // meetsMarginTarget = profitMarginPercent >= 10
    if (val !== 0) {
      const computedPct = ((val - cost) / val) * 100
      const expectedMeets = computedPct >= 10
      if (a.meetsMarginTarget !== expectedMeets) {
        drifts.push({
          recordId: a.id,
          recordType: 'OpportunityAssessment',
          field: 'meetsMarginTarget',
          storedValue: a.meetsMarginTarget ? 1 : 0,
          expectedValue: expectedMeets ? 1 : 0,
          drift: 1,
        })
      }
    }
  }

  // ── Bid audit ────────────────────────────────────────────────────────────────
  const bids = await prisma.bid.findMany({
    take: 20,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      recommendedPrice: true,
      costBasis: true,
      grossMargin: true,
    },
  })

  for (const b of bids) {
    const price = b.recommendedPrice
    const cost = b.costBasis

    if (cost == null || price == null || price === 0) continue

    // grossMargin = ((recommendedPrice - costBasis) / recommendedPrice) * 100
    if (b.grossMargin != null) {
      const expectedMargin = roundTo(((price - cost) / price) * 100)
      const storedMargin = roundTo(b.grossMargin)
      const drift = Math.abs(storedMargin - expectedMargin)
      if (drift > DRIFT_THRESHOLD) {
        drifts.push({
          recordId: b.id,
          recordType: 'Bid',
          field: 'grossMargin',
          storedValue: storedMargin,
          expectedValue: expectedMargin,
          drift: roundTo(drift),
        })
      }
    }
  }

  return NextResponse.json({
    drifts,
    sampledAssessments: assessments.length,
    sampledBids: bids.length,
    auditedAt: new Date().toISOString(),
  })
}
