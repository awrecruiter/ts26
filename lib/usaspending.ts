/**
 * USASpending API Integration
 * Fetches historical contract data to inform competitive bid pricing
 *
 * NOTE: getPricingRecommendation now delegates to lib/comparables.ts so each
 * opportunity gets its own per-opportunity cached comparables (no more global
 * (NAICS, agency) cache that bled identical medians across unrelated procurements).
 * The raw fetch helper searchHistoricalContracts and the deterministic stats
 * helper analyzeHistoricalPricing are still exported for callers that need them.
 */

import { getComparablesForOpportunity } from './comparables'

const USASPENDING_API_BASE = 'https://api.usaspending.gov/api/v2'

export interface HistoricalContract {
  award_id: string
  award_amount: number
  awarding_agency_name: string
  recipient_name: string
  description: string
  period_of_performance_start_date: string
  period_of_performance_current_end_date: string
  naics_code: string
  naics_description: string
}

export interface USASpendingSearchParams {
  naicsCode?: string
  keywords?: string
  agencyName?: string
  limit?: number
}

export interface PricingAnalysis {
  averageContractValue: number
  medianContractValue: number
  minContractValue: number
  maxContractValue: number
  totalContracts: number
  recommendedBidPrice: number
  confidence: 'high' | 'medium' | 'low' | 'very_low' | 'no_data'
  dataSource: string
  historicalContracts: HistoricalContract[]
}

/**
 * Search for historical contracts using USASpending API
 */
export async function searchHistoricalContracts(
  params: USASpendingSearchParams
): Promise<HistoricalContract[]> {
  try {
    const { naicsCode, keywords, agencyName, limit = 50 } = params

    // Build search filters — correct structure per USASpending API v2 docs
    const fiveYearsAgo = new Date()
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)

    const filters: any = {
      // Contracts only (A=BPA, B=Purchase Order, C=Delivery Order, D=Definitive Contract)
      // Excludes grants, loans, and other non-contract award types
      award_type_codes: ['A', 'B', 'C', 'D'],
      time_period: [
        {
          start_date: fiveYearsAgo.toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0],
          date_type: 'action_date',
        },
      ],
    }

    if (naicsCode) {
      // Must be { require: [...] } — not a bare array
      filters.naics_codes = { require: [naicsCode] }
    }

    // Note: keywords filter is very restrictive; omit when NAICS is provided
    // to avoid empty results from keyword mismatch
    if (keywords && !naicsCode) {
      filters.keywords = [keywords]
    }

    // Agency filter is optional — omit if likely to narrow too aggressively
    // (agency name must match USASpending's exact toptier name)
    if (agencyName) {
      filters.agencies = [{ name: agencyName, tier: 'toptier' }]
    }

    const requestBody = {
      filters,
      fields: [
        'Award ID',
        'Award Amount',
        'Awarding Agency',
        'Recipient Name',
        'Description',
        'Start Date',
        'End Date',
        'NAICS Code',
        'NAICS Description',
      ],
      page: 1,
      limit,
      sort: 'Award Amount',
      order: 'desc',
    }

    const response = await fetch(`${USASPENDING_API_BASE}/search/spending_by_award/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      console.error('USASpending API error:', response.status, response.statusText)
      return []
    }

    const data = await response.json()

    // Transform the response to our format
    const contracts: HistoricalContract[] = (data.results || []).map((result: any) => ({
      award_id: result.Award_ID || result['Award ID'] || 'N/A',
      award_amount: parseFloat(result.Award_Amount || result['Award Amount'] || 0),
      awarding_agency_name: result.Awarding_Agency || result['Awarding Agency'] || 'N/A',
      recipient_name: result.Recipient_Name || result['Recipient Name'] || 'N/A',
      description: result.Description || 'N/A',
      period_of_performance_start_date: result.Start_Date || result['Start Date'] || '',
      period_of_performance_current_end_date: result.End_Date || result['End Date'] || '',
      naics_code: result.NAICS_Code || result['NAICS Code'] || '',
      naics_description: result.NAICS_Description || result['NAICS Description'] || '',
    }))

    return contracts
  } catch (error) {
    console.error('Error fetching USASpending data:', error)
    return []
  }
}

// No hardcoded fallback pricing — per data sourcing rules, invented numbers are not permitted.
// When no historical data is found, callers must show "Insufficient data — enter manual estimate".

/**
 * Analyze historical contracts and calculate recommended bid price
 */
export function analyzeHistoricalPricing(
  contracts: HistoricalContract[],
  estimatedCost?: number,
  naicsCode?: string | null
): PricingAnalysis {
  if (contracts.length === 0) {
    const costBasedPrice = estimatedCost && estimatedCost > 0 ? estimatedCost * 1.20 : 0
    return {
      averageContractValue: 0,
      medianContractValue: 0,
      minContractValue: 0,
      maxContractValue: 0,
      totalContracts: 0,
      recommendedBidPrice: costBasedPrice,
      confidence: 'no_data',
      dataSource: costBasedPrice > 0
        ? 'Cost-based estimate (20% markup) — no USASpending.gov historical data found for this NAICS code'
        : 'No historical contracts found on USASpending.gov for this NAICS code and agency',
      historicalContracts: [],
    }
  }

  // Filter out zero or negative values
  const validContracts = contracts.filter((c) => c.award_amount > 0)
  const amounts = validContracts.map((c) => c.award_amount).sort((a, b) => a - b)

  const totalContracts = validContracts.length
  const averageContractValue = amounts.reduce((sum, val) => sum + val, 0) / totalContracts
  const medianContractValue = amounts[Math.floor(totalContracts / 2)] || 0
  const minContractValue = amounts[0] || 0
  const maxContractValue = amounts[totalContracts - 1] || 0

  // Calculate recommended bid price
  // Strategy: Use median for better resistance to outliers, adjusted by market position
  let recommendedBidPrice = medianContractValue

  // If we have cost data, ensure we maintain healthy margin
  if (estimatedCost && estimatedCost > 0) {
    const costBasedPrice = estimatedCost * 1.20 // 20% markup minimum
    recommendedBidPrice = Math.max(recommendedBidPrice, costBasedPrice)
  }

  // Determine confidence level based on data availability
  let confidence: 'high' | 'medium' | 'low' | 'very_low' | 'no_data'
  if (totalContracts >= 20) {
    confidence = 'high'
  } else if (totalContracts >= 10) {
    confidence = 'medium'
  } else if (totalContracts >= 5) {
    confidence = 'low'
  } else {
    confidence = 'very_low'
  }

  const naicsLabel = naicsCode ? ` (NAICS ${naicsCode})` : ''
  const dataSource = `USASpending.gov — ${totalContracts} historical contract${totalContracts !== 1 ? 's' : ''}${naicsLabel}, median $${medianContractValue.toLocaleString()}`

  return {
    averageContractValue,
    medianContractValue,
    minContractValue,
    maxContractValue,
    totalContracts,
    recommendedBidPrice,
    confidence,
    dataSource,
    historicalContracts: validContracts.slice(0, 10), // Top 10 for reference
  }
}

/**
 * Get pricing recommendation for an opportunity.
 *
 * Delegates to the per-opportunity comparables system (lib/comparables.ts) so the
 * underlying USASpending results are scoped per-opportunity rather than shared via
 * a global (NAICS, agency) cache. Returns the same PricingAnalysis shape existing
 * callers (assessment/auto-generate, bids) expect.
 */
export async function getPricingRecommendation(
  opportunity: {
    id: string
    naicsCode?: string | null
    pscCode?: string | null
    title: string
    agency?: string | null
    solicitationNumber: string
    rawData?: unknown
  },
  estimatedCost?: number
): Promise<PricingAnalysis> {
  const summary = await getComparablesForOpportunity({
    id: opportunity.id,
    naicsCode: opportunity.naicsCode ?? null,
    pscCode: opportunity.pscCode ?? null,
    agency: opportunity.agency ?? null,
    title: opportunity.title,
    solicitationNumber: opportunity.solicitationNumber,
    // Prisma's JsonValue type can't be re-narrowed safely here; cast for the call.
    rawData: (opportunity.rawData ?? null) as never,
  })

  const naicsLabel = opportunity.naicsCode ? ` NAICS ${opportunity.naicsCode}` : ''

  if (summary.confidence === 'insufficient') {
    const costBasedPrice = estimatedCost && estimatedCost > 0 ? estimatedCost * 1.20 : 0
    return {
      averageContractValue: 0,
      medianContractValue: 0,
      minContractValue: 0,
      maxContractValue: 0,
      totalContracts: 0,
      recommendedBidPrice: costBasedPrice,
      confidence: 'no_data',
      dataSource: costBasedPrice > 0
        ? `Cost-based estimate (20% markup) — no USASpending.gov comparables found for${naicsLabel}`
        : `No USASpending.gov comparables found for${naicsLabel}`,
      historicalContracts: [],
    }
  }

  const averageContractValue = (summary.p25 + summary.median + summary.p75) / 3
  const medianBased = summary.median
  const costFloor = estimatedCost && estimatedCost > 0 ? estimatedCost * 1.20 : 0
  const recommendedBidPrice = Math.max(medianBased, costFloor)

  const confidence: PricingAnalysis['confidence'] =
    summary.confidence === 'high'
      ? 'high'
      : summary.confidence === 'medium'
        ? 'medium'
        : 'low'

  const fetchedLabel = summary.fetchedAt.toISOString().split('T')[0]
  const dataSource = `USASpending.gov · n=${summary.count} · tier=${summary.matchTier ?? 'none'} · fetched ${fetchedLabel} · ${summary.confidence} confidence`

  const historicalContracts: HistoricalContract[] = summary.awards.slice(0, 10).map((a) => ({
    award_id: a.awardId,
    award_amount: a.awardAmount,
    awarding_agency_name: a.awardingAgency || 'N/A',
    recipient_name: a.recipientName,
    description: a.description || 'N/A',
    period_of_performance_start_date: a.popStart ? a.popStart.toISOString().split('T')[0] : '',
    period_of_performance_current_end_date: a.popEnd ? a.popEnd.toISOString().split('T')[0] : '',
    naics_code: a.naicsCode || '',
    naics_description: '',
  }))

  return {
    averageContractValue,
    medianContractValue: summary.median,
    minContractValue: summary.min,
    maxContractValue: summary.max,
    totalContracts: summary.count,
    recommendedBidPrice,
    confidence,
    dataSource,
    historicalContracts,
  }
}
