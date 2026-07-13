import type {
  MarginBands,
  PricingSheet,
  ResourceLine,
  ResourcePlan,
  RiskLevel,
} from '@/lib/types/resource-plan'
import { DEFAULT_MARGIN_BANDS } from '@/lib/types/resource-plan'

const RISK_SCORE: Record<RiskLevel, number> = { low: 25, medium: 50, high: 90 }

function lineWeight(line: ResourceLine): number {
  const cost = line.estimatedTotalCost ?? 0
  return cost > 0 ? cost : 1
}

function costBasisTotal(plan: ResourcePlan): number {
  return plan.lines.reduce((sum, line) => sum + (line.estimatedTotalCost ?? 0), 0)
}

function aggregateRiskScore(plan: ResourcePlan): number {
  if (plan.lines.length === 0) return 0
  let numerator = 0
  let denominator = 0
  for (const line of plan.lines) {
    const w = lineWeight(line)
    numerator += w * RISK_SCORE[line.riskLevel]
    denominator += w
  }
  return denominator > 0 ? numerator / denominator : 0
}

function interpolate(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0)
}

function targetMarginFromRisk(riskScore: number, bands: MarginBands): number {
  if (riskScore <= RISK_SCORE.low) return bands.low
  if (riskScore <= RISK_SCORE.medium) {
    return interpolate(riskScore, RISK_SCORE.low, RISK_SCORE.medium, bands.low, bands.medium)
  }
  if (riskScore <= RISK_SCORE.high) {
    return interpolate(riskScore, RISK_SCORE.medium, RISK_SCORE.high, bands.medium, bands.high)
  }
  return bands.high
}

export function computePricingSheet(
  plan: ResourcePlan,
  bands: MarginBands = DEFAULT_MARGIN_BANDS,
  userOverrideMarginPct: number | null = null,
): PricingSheet {
  const cost = costBasisTotal(plan)
  const riskScore = aggregateRiskScore(plan)
  const target = targetMarginFromRisk(riskScore, bands)
  const effective = userOverrideMarginPct ?? target
  const dollar = (cost * effective) / 100
  return {
    costBasisTotal: Math.round(cost),
    riskScore: Math.round(riskScore * 10) / 10,
    marginBands: bands,
    targetMarginPct: Math.round(target * 10) / 10,
    targetMarginDollar: Math.round(dollar),
    recommendedBidPrice: Math.round(cost + dollar),
    userOverrideMarginPct: userOverrideMarginPct ?? null,
    updatedAt: new Date().toISOString(),
  }
}
