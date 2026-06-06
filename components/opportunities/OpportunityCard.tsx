'use client'

import Link from 'next/link'
import { format } from 'date-fns'

interface ComparablesData {
  count: number
  p25: number
  median: number
  p75: number
  min: number
  max: number
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  matchTier:
    | 'naics+agency+keywords'
    | 'naics+keywords'
    | 'naics+agency'
    | 'naics'
    | null
  fetchedAt: string
  topIncumbent: { name: string; amount: number; popStart: string | null } | null
  currentIncumbent: { name: string; popEnd: string | null } | null
  isStale: boolean
}

interface OpportunityCardProps {
  opportunity: {
    id: string
    solicitationNumber: string
    title: string
    description?: string | null
    agency?: string | null
    naicsCode?: string | null
    pscCode?: string | null
    responseDeadline?: Date | null
    postedDate?: Date | null
    status: string
    rawData?: unknown
    comparables?: ComparablesData | null
    _count?: {
      bids: number
      subcontractors: number
    }
    assessment?: {
      estimatedValue: number | null
      estimatedCost: number | null
      profitMarginPercent: number | null
      profitMarginDollar: number | null
      recommendation: string | null
      strategicValue: string | null
      riskLevel: string | null
    } | null
    bids?: Array<{
      source: string | null
      confidence: string | null
      historicalData?: {
        totalContracts?: number
      } | null
    }>
  }
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${Math.round(n)}`
}

function formatMonYear(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return format(d, 'MMM yyyy')
}

function DataSourceIndicator({ bids }: { bids?: OpportunityCardProps['opportunity']['bids'] }) {
  if (!bids || bids.length === 0) return null

  const latestBid = bids[0]
  if (!latestBid?.source) return null

  const config: Record<string, { label: string; description: string }> = {
    usaspending_api: {
      label: 'Historical Data',
      description: `${latestBid.historicalData?.totalContracts || 0} contracts analyzed`,
    },
    subcontractor_quotes: {
      label: 'Quotes',
      description: 'Based on actual quotes',
    },
    cost_based: {
      label: 'Cost Based',
      description: 'Based on cost analysis',
    },
    industry_average: {
      label: 'Estimated',
      description: 'Industry average estimate',
    },
    default_fallback: {
      label: 'Estimated',
      description: 'Default pricing estimate',
    },
  }

  const { label } = config[latestBid.source] || { label: 'Unknown' }

  return (
    <div className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border border-stone-200 bg-stone-50 text-stone-600">
      <span>{label}</span>
      {latestBid.confidence && (
        <span className="opacity-70">({latestBid.confidence})</span>
      )}
    </div>
  )
}

export default function OpportunityCard({ opportunity }: OpportunityCardProps) {
  const assessment = opportunity.assessment
  const comparables = opportunity.comparables

  const costVal = assessment?.estimatedCost ?? 0
  const marginPercent = assessment?.profitMarginPercent ?? null
  const marginDollar = assessment?.profitMarginDollar ?? null
  const hasMargin = marginPercent !== null && marginPercent !== 0
  const marginColor = marginPercent !== null && marginPercent >= 20 ? 'text-green-700'
    : marginPercent !== null && marginPercent >= 10 ? 'text-amber-700'
    : 'text-red-700'

  const deadline = opportunity.responseDeadline ? new Date(opportunity.responseDeadline) : null
  const daysUntilDeadline = deadline
    ? Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  const savedEstimate =
    assessment?.estimatedValue && assessment.estimatedValue > 0
      ? assessment.estimatedValue
      : null

  // Comparables tile content
  let comparablesTile: React.ReactNode
  if (comparables === null || comparables === undefined) {
    comparablesTile = (
      <p className="text-xs italic text-stone-400">Loading comparables…</p>
    )
  } else if (comparables.confidence === 'insufficient' || comparables.count < 3) {
    comparablesTile = (
      <p className="text-xs text-stone-400">
        Insufficient data — enter manual estimate
      </p>
    )
  } else {
    const metaParts: string[] = [`n=${comparables.count}`]
    metaParts.push(opportunity.naicsCode ? `NAICS ${opportunity.naicsCode}` : 'NAICS —')
    if (opportunity.pscCode) metaParts.push(`PSC ${opportunity.pscCode}`)
    if (comparables.matchTier) metaParts.push(comparables.matchTier)
    metaParts.push(comparables.confidence)
    if (comparables.isStale) metaParts.push('stale')

    comparablesTile = (
      <>
        <p className="text-base font-semibold text-stone-900 tabular-nums">
          {formatCompact(comparables.min)} – {formatCompact(comparables.max)}
          {' '}· median {formatCompact(comparables.median)}
        </p>
        <p className="text-[10px] text-stone-400 mt-0.5">
          {metaParts.join(' · ')}
        </p>
        {comparables.topIncumbent && (
          <p className="text-xs text-stone-600 mt-1">
            Top winner: {comparables.topIncumbent.name} (
            {formatCompact(comparables.topIncumbent.amount)},{' '}
            {formatMonYear(comparables.topIncumbent.popStart)})
          </p>
        )}
        {comparables.currentIncumbent && (
          <p className="text-xs text-amber-700 font-medium mt-0.5">
            Recompete · current contract expires{' '}
            {formatMonYear(comparables.currentIncumbent.popEnd)}
          </p>
        )}
      </>
    )
  }

  return (
    <Link href={`/opportunities/${opportunity.id}`}>
      <div className="block bg-white border border-stone-200 rounded-lg hover:border-stone-400 transition-all p-6 cursor-pointer">
        {/* Header */}
        <div className="flex justify-between items-start mb-4 gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base sm:text-lg font-semibold text-stone-900">
                {opportunity.title}
              </h3>
              {opportunity.assessment?.recommendation && (
                <span className={`px-2 py-0.5 text-xs font-medium rounded flex-shrink-0 ${
                  opportunity.assessment.recommendation === 'GO' ? 'bg-stone-200 text-stone-800' :
                  opportunity.assessment.recommendation === 'REVIEW' ? 'bg-stone-100 text-stone-600' :
                  'bg-stone-100 text-stone-500'
                }`}>
                  {opportunity.assessment.recommendation.replace('_', ' ')}
                </span>
              )}
            </div>
            <p className="text-sm text-stone-500 truncate">
              {opportunity.solicitationNumber}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="px-2.5 py-1 rounded text-xs font-medium bg-stone-100 text-stone-600">
              {opportunity.status}
            </span>
            {deadline && daysUntilDeadline !== null && (
              <div className={`text-sm font-semibold ${
                daysUntilDeadline <= 7 ? 'text-stone-900' :
                daysUntilDeadline <= 14 ? 'text-stone-600' :
                'text-stone-500'
              }`}>
                {daysUntilDeadline > 0 ? `${daysUntilDeadline}d` : daysUntilDeadline === 0 ? 'Today' : 'Expired'}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        {opportunity.description && (
          <p className="text-sm text-stone-600 mb-4 line-clamp-2">
            {opportunity.description}
          </p>
        )}

        {/* Assessment Metrics — comparables lead; saved assessment + cost/margin follow */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4 p-3 bg-stone-50 rounded-lg border border-stone-100">
          <div className="col-span-2 sm:col-span-2">
            <p className="text-xs text-stone-500 mb-1">Comparable awards (last 5 yrs)</p>
            {comparablesTile}
            {savedEstimate !== null && (
              <p className="text-[10px] text-stone-500 mt-1">
                Saved estimate: {formatCompact(savedEstimate)}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-stone-500 mb-1">Cost</p>
            <p className="text-base font-bold text-stone-900">
              {costVal > 0 ? `$${costVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            </p>
            {costVal === 0 && (
              <p className="text-[10px] text-stone-400 mt-0.5">Open to estimate</p>
            )}
          </div>
          <div>
            <p className="text-xs text-stone-500 mb-1">Margin</p>
            <p className={`text-base font-bold ${hasMargin ? marginColor : 'text-stone-400'}`}>
              {hasMargin ? `${marginPercent!.toFixed(1)}%` : '—'}
            </p>
            <p className={`text-xs ${hasMargin ? marginColor : 'text-stone-400'}`}>
              {hasMargin && marginDollar !== null
                ? `$${marginDollar.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : 'Run assessment'}
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500 mb-1">Risk / Strategic</p>
            <div className="flex gap-1 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded font-medium bg-stone-200 text-stone-700">
                {assessment?.riskLevel || '—'}
              </span>
              <span className="text-xs px-2 py-0.5 rounded font-medium bg-stone-100 text-stone-600">
                {assessment?.strategicValue || '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Meta Information */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 mb-4 text-sm">
          {opportunity.agency && (
            <div>
              <span className="text-stone-400">Agency:</span>
              <span className="ml-2 text-stone-700">{opportunity.agency}</span>
            </div>
          )}
          {(opportunity.naicsCode || opportunity.pscCode) && (
            <div>
              {opportunity.naicsCode && (
                <>
                  <span className="text-stone-400">NAICS:</span>
                  <span className="ml-2 text-stone-700">{opportunity.naicsCode}</span>
                </>
              )}
              {opportunity.naicsCode && opportunity.pscCode && (
                <span className="mx-2 text-stone-300">·</span>
              )}
              {opportunity.pscCode && (
                <>
                  <span className="text-stone-400">PSC:</span>
                  <span className="ml-2 text-stone-700">{opportunity.pscCode}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-4 border-t border-stone-100">
          <div className="flex gap-4 text-sm items-center">
            {opportunity._count && opportunity._count.bids > 0 && (
              <span className="text-stone-600">
                {opportunity._count.bids} {opportunity._count.bids === 1 ? 'Bid' : 'Bids'}
              </span>
            )}
            {opportunity._count && opportunity._count.subcontractors > 0 && (
              <span className="text-stone-600">
                {opportunity._count.subcontractors}{' '}
                {opportunity._count.subcontractors === 1 ? 'Sub' : 'Subs'}
              </span>
            )}
            {!opportunity._count?.bids && !opportunity._count?.subcontractors && (
              <span className="text-stone-400 text-xs">Open to view</span>
            )}
          </div>
          <DataSourceIndicator bids={opportunity.bids} />
        </div>
      </div>
    </Link>
  )
}
