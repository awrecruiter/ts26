/**
 * Per-opportunity historical comparables.
 *
 * Replaces the (NAICS, agency) in-process cache that produced identical inflated
 * medians for unrelated procurements. Each opportunity gets its own scoped set
 * of USASpending awards, persisted in the OpportunityComparable table.
 */

import type { Opportunity, OpportunityComparable } from '@prisma/client'
import { prisma } from '@/lib/db'

const USASPENDING_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'
const FETCH_TIMEOUT_MS = 5000
const DEFAULT_MAX_AGE_HOURS = 168 // 7 days
const MIN_RESULTS = 3
const MAX_AWARDS = 50
const TOP_AWARDS_FOR_SUMMARY = 20

export type MatchTier =
  | 'naics+agency+keywords'
  | 'naics+keywords'
  | 'naics+agency'
  | 'naics'
export type Confidence = 'high' | 'medium' | 'low' | 'insufficient'

export interface ComparableSummary {
  count: number
  p25: number
  median: number
  p75: number
  min: number
  max: number
  confidence: Confidence
  matchTier: MatchTier | null
  fetchedAt: Date
  topIncumbent: { name: string; amount: number; popStart: Date | null } | null
  currentIncumbent: { name: string; popEnd: Date | null } | null
  awards: OpportunityComparable[]
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'and', 'to', 'in', 'on', 'at', 'with',
  'services', 'service', 'contract', 'contracts', 'solicitation', 'request',
  'proposal', 'proposals', 'federal', 'government', 'department', 'agency',
  'support', 'program', 'project', 'system', 'systems',
])

// SAM.gov dotted fullParentPathName → USASpending toptier name.
function toTopTierAgency(agency: string | null | undefined): string | null {
  if (!agency) return null
  const first = agency.split('.')[0]?.trim()
  if (!first) return null
  const upper = first.toUpperCase()
  if (upper.startsWith('DEPT OF DEFENSE') || upper === 'DOD') return 'Department of Defense'
  if (upper.startsWith('DEPT OF VETERANS') || upper.includes('VETERANS AFFAIRS')) return 'Department of Veterans Affairs'
  if (upper.startsWith('DEPT OF HOMELAND')) return 'Department of Homeland Security'
  if (upper.startsWith('DEPT OF HEALTH')) return 'Department of Health and Human Services'
  if (upper.startsWith('DEPT OF ')) {
    const rest = first.slice(8).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    return `Department of ${rest}`
  }
  return first
}

function extractKeywords(title: string): string[] {
  if (!title) return []
  const tokens = title
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 3 && !STOPWORDS.has(t))
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t)
      ordered.push(t)
    }
    if (ordered.length >= 3) break
  }
  return ordered
}

interface RawAward {
  award_id?: string
  recipient_name?: string
  award_amount?: number
  awarding_agency?: string
  awarding_sub_agency?: string
  description?: string
  pop_start?: string
  pop_end?: string
  naics_code?: string
  psc_code?: string
  solicitation_id?: string
}

async function fetchTier(opts: {
  naicsCode: string
  agency: string | null
  keywords: string[]
  pscCode: string | null
}): Promise<RawAward[]> {
  const fiveYearsAgo = new Date()
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)

  const filters: Record<string, unknown> = {
    award_type_codes: ['C', 'D'],
    time_period: [
      {
        start_date: fiveYearsAgo.toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        date_type: 'action_date',
      },
    ],
    naics_codes: { require: [opts.naicsCode] },
  }
  if (opts.agency) {
    filters.agencies = [{ name: opts.agency, tier: 'toptier' }]
  }
  if (opts.keywords.length > 0) {
    filters.keywords = opts.keywords
  }
  if (opts.pscCode) {
    filters.psc_codes = { require: [opts.pscCode] }
  }

  const body = {
    filters,
    fields: [
      'Award ID',
      'Award Amount',
      'Awarding Agency',
      'Awarding Sub Agency',
      'Recipient Name',
      'Description',
      'Start Date',
      'End Date',
      'NAICS Code',
      'PSC Code',
      'Solicitation Identifier',
    ],
    page: 1,
    limit: MAX_AWARDS,
    sort: 'Start Date',
    order: 'desc',
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(USASPENDING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) return []
    const data = (await response.json()) as { results?: unknown[] }
    return (data.results || []).map((r) => {
      const row = r as Record<string, unknown>
      return {
        award_id: pickString(row, ['Award ID', 'Award_ID', 'generated_internal_id']),
        recipient_name: pickString(row, ['Recipient Name', 'Recipient_Name']),
        award_amount: pickNumber(row, ['Award Amount', 'Award_Amount']),
        awarding_agency: pickString(row, ['Awarding Agency', 'Awarding_Agency']),
        awarding_sub_agency: pickString(row, ['Awarding Sub Agency', 'Awarding_Sub_Agency']),
        description: pickString(row, ['Description']),
        pop_start: pickString(row, ['Start Date', 'Start_Date']),
        pop_end: pickString(row, ['End Date', 'End_Date']),
        naics_code: pickString(row, ['NAICS Code', 'NAICS_Code']),
        psc_code: pickString(row, ['PSC Code', 'PSC_Code']),
        solicitation_id: pickString(row, ['Solicitation Identifier', 'Solicitation_Identifier']),
      }
    })
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function pickString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'number') return v
    if (typeof v === 'string' && v.length > 0) {
      const n = parseFloat(v)
      if (!Number.isNaN(n)) return n
    }
  }
  return undefined
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

// Linear-interpolation quantile on a sorted ascending array.
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  const frac = pos - lo
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

export function summarizeComparables(
  awards: OpportunityComparable[],
  matchTier: MatchTier | null,
  fetchedAt: Date
): ComparableSummary {
  const count = awards.length

  if (count < MIN_RESULTS) {
    return {
      count,
      p25: 0,
      median: 0,
      p75: 0,
      min: 0,
      max: 0,
      confidence: 'insufficient',
      matchTier,
      fetchedAt,
      topIncumbent: null,
      currentIncumbent: null,
      awards: [],
    }
  }

  const sorted = [...awards].map((a) => a.awardAmount).sort((a, b) => a - b)
  const p25 = quantile(sorted, 0.25)
  const median = quantile(sorted, 0.5)
  const p75 = quantile(sorted, 0.75)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  const byAmount = [...awards].sort((a, b) => b.awardAmount - a.awardAmount)
  const top = byAmount[0]
  const topIncumbent = top
    ? { name: top.recipientName, amount: top.awardAmount, popStart: top.popStart }
    : null

  const incumbent = awards.find((a) => a.isCurrentIncumbent) || null
  const currentIncumbent = incumbent
    ? { name: incumbent.recipientName, popEnd: incumbent.popEnd }
    : null

  let confidence: Confidence
  const tier = matchTier
  if ((tier === 'naics+agency+keywords' || tier === 'naics+keywords') && count >= 10) {
    confidence = 'high'
  } else if (
    (tier === 'naics+agency+keywords' || tier === 'naics+keywords') &&
    count >= MIN_RESULTS
  ) {
    confidence = 'medium'
  } else if (tier === 'naics+agency' && count >= 10) {
    confidence = 'medium'
  } else if (tier === 'naics+agency' && count >= MIN_RESULTS) {
    confidence = 'low'
  } else if (tier === 'naics') {
    confidence = 'low'
  } else {
    confidence = 'low'
  }

  return {
    count,
    p25,
    median,
    p75,
    min,
    max,
    confidence,
    matchTier: tier,
    fetchedAt,
    topIncumbent,
    currentIncumbent,
    awards: byAmount.slice(0, TOP_AWARDS_FOR_SUMMARY),
  }
}

interface TierAttempt {
  tier: MatchTier
  agency: string | null
  keywords: string[]
}

async function tryTiers(
  naicsCode: string,
  agency: string | null,
  keywords: string[],
  pscCode: string | null
): Promise<{ raw: RawAward[]; tier: MatchTier } | null> {
  const attempts: TierAttempt[] = []
  if (agency && keywords.length > 0) {
    attempts.push({ tier: 'naics+agency+keywords', agency, keywords })
  }
  if (keywords.length > 0) {
    attempts.push({ tier: 'naics+keywords', agency: null, keywords })
  }
  if (agency) {
    attempts.push({ tier: 'naics+agency', agency, keywords: [] })
  }
  attempts.push({ tier: 'naics', agency: null, keywords: [] })

  for (const a of attempts) {
    const raw = await fetchTier({
      naicsCode,
      agency: a.agency,
      keywords: a.keywords,
      pscCode,
    })
    if (raw.length >= MIN_RESULTS) {
      return { raw, tier: a.tier }
    }
  }
  return null
}

export async function getComparablesForOpportunity(
  opportunity: Pick<
    Opportunity,
    'id' | 'naicsCode' | 'pscCode' | 'agency' | 'title' | 'solicitationNumber' | 'rawData'
  >,
  opts?: { maxAgeHours?: number; forceRefresh?: boolean }
): Promise<ComparableSummary> {
  const maxAgeHours = opts?.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS
  const forceRefresh = opts?.forceRefresh ?? false

  const existing = await prisma.opportunityComparable.findMany({
    where: { opportunityId: opportunity.id },
    orderBy: { awardAmount: 'desc' },
  })

  if (!forceRefresh && existing.length > 0) {
    const newest = existing.reduce<Date>(
      (acc, c) => (c.fetchedAt > acc ? c.fetchedAt : acc),
      existing[0].fetchedAt
    )
    const ageMs = Date.now() - newest.getTime()
    if (ageMs < maxAgeHours * 60 * 60 * 1000) {
      const tier = (existing[0].matchTier as MatchTier) || null
      return summarizeComparables(existing, tier, newest)
    }
  }

  if (!opportunity.naicsCode) {
    return summarizeComparables([], null, new Date())
  }

  const agency = toTopTierAgency(opportunity.agency)
  const keywords = extractKeywords(opportunity.title || '')
  const pscCode = opportunity.pscCode || null

  const result = await tryTiers(opportunity.naicsCode, agency, keywords, pscCode)
  const fetchedAt = new Date()

  await prisma.opportunityComparable.deleteMany({
    where: { opportunityId: opportunity.id },
  })

  if (!result) {
    return summarizeComparables([], null, fetchedAt)
  }

  const now = Date.now()
  const created: OpportunityComparable[] = []
  for (const r of result.raw) {
    const amount = r.award_amount
    if (!amount || amount <= 0) continue
    if (!r.award_id) continue
    const popStart = parseDate(r.pop_start)
    const popEnd = parseDate(r.pop_end)
    const isRecompete =
      !!r.solicitation_id &&
      !!opportunity.solicitationNumber &&
      r.solicitation_id === opportunity.solicitationNumber
    const isCurrentIncumbent = isRecompete && !!popEnd && popEnd.getTime() > now

    try {
      const row = await prisma.opportunityComparable.create({
        data: {
          opportunityId: opportunity.id,
          awardId: r.award_id,
          recipientName: r.recipient_name || 'Unknown',
          awardAmount: amount,
          awardingAgency: r.awarding_agency || null,
          awardingOffice: r.awarding_sub_agency || null,
          description: r.description || null,
          popStart,
          popEnd,
          naicsCode: r.naics_code || null,
          pscCode: r.psc_code || null,
          solicitationId: r.solicitation_id || null,
          isRecompete,
          isCurrentIncumbent,
          fetchedAt,
          matchTier: result.tier,
        },
      })
      created.push(row)
    } catch {
      // Duplicate awardId for this opportunity — skip.
    }
    if (created.length >= MAX_AWARDS) break
  }

  return summarizeComparables(created, result.tier, fetchedAt)
}
