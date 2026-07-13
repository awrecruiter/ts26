'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'

interface ComparableAward {
  id: string
  awardId: string
  recipientName: string
  awardAmount: number
  popStart: string | null
  popEnd: string | null
  awardingAgency: string | null
  isRecompete: boolean
  isCurrentIncumbent: boolean
}

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

interface OpportunityCardProgress {
  currentStage: string | null
  completionPct: number | null
  nextActions: unknown
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
    dismissedAt?: string | Date | null
    rawData?: unknown
    comparables?: ComparablesData | null
    progress?: OpportunityCardProgress | null
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
  onDismissed?: (id: string) => void
  onRestored?: (id: string) => void
}

const STAGE_LABELS: Record<string, string> = {
  DISCOVERY:    'Discovery',
  ASSESSMENT:   'Assessment',
  SOW_CREATION: 'SOW Draft',
  SOW_REVIEW:   'SOW Review',
  BID_ASSEMBLY: 'Bid Assembly',
  READY:        'Ready',
  SUBMITTED:    'Submitted',
}

function firstNextAction(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object' && 'label' in first) {
      const label = (first as Record<string, unknown>).label
      if (typeof label === 'string') return label
    }
  }
  if (typeof raw === 'object' && raw !== null && 'label' in raw) {
    const label = (raw as Record<string, unknown>).label
    if (typeof label === 'string') return label
  }
  return null
}

function WIPStatusTile({ progress }: { progress?: OpportunityCardProgress | null }) {
  if (!progress || !progress.currentStage) {
    return (
      <div>
        <p className="text-xs text-stone-500 mb-1">WIP Status</p>
        <p className="text-xs text-stone-400 italic">No progress recorded yet</p>
      </div>
    )
  }
  const label = STAGE_LABELS[progress.currentStage] ?? progress.currentStage
  const pct = Math.max(0, Math.min(100, progress.completionPct ?? 0))
  const next = firstNextAction(progress.nextActions)
  return (
    <div>
      <p className="text-xs text-stone-500 mb-1">WIP Status</p>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="px-2 py-0.5 text-xs font-medium rounded bg-stone-200 text-stone-800">
          {label}
        </span>
        <span className="text-xs font-semibold text-stone-700 tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-stone-800 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {next ? (
        <p className="text-xs text-stone-600 mt-1 line-clamp-2">{next}</p>
      ) : (
        <p className="text-xs text-stone-400 mt-1 italic">Awaiting next step</p>
      )}
    </div>
  )
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

export default function OpportunityCard({
  opportunity,
  onDismissed,
  onRestored,
}: OpportunityCardProps) {
  const assessment = opportunity.assessment
  const comparables = opportunity.comparables
  const isDismissed = opportunity.status === 'DISMISSED'

  const [expanded, setExpanded] = useState(false)
  const [awards, setAwards] = useState<ComparableAward[] | null>(null)
  const [loadingAwards, setLoadingAwards] = useState(false)
  const [awardsError, setAwardsError] = useState<string | null>(null)
  const [dismissPending, setDismissPending] = useState(false)

  const handleDismiss = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dismissPending) return
    setDismissPending(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/dismiss`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onDismissed?.(opportunity.id)
    } catch {
      // Surface a minimal alert so the user knows it failed; parent will revert.
      alert('Could not dismiss this opportunity. Please try again.')
    } finally {
      setDismissPending(false)
    }
  }

  const handleRestore = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dismissPending) return
    setDismissPending(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/restore`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onRestored?.(opportunity.id)
    } catch {
      alert('Could not restore this opportunity. Please try again.')
    } finally {
      setDismissPending(false)
    }
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!expanded && awards === null && !loadingAwards) {
      setLoadingAwards(true)
      setAwardsError(null)
      fetch(`/api/opportunities/${opportunity.id}/comparables`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => setAwards(Array.isArray(d.awards) ? d.awards : []))
        .catch(() => setAwardsError('Could not load awards'))
        .finally(() => setLoadingAwards(false))
    }
    setExpanded((s) => !s)
  }

  const swallow = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const showAwardsTrigger =
    !!comparables &&
    comparables.confidence !== 'insufficient' &&
    comparables.count >= 3

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

  const oppHref = `/opportunities/${opportunity.id}`
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-0">
    <Link href={oppHref} className="flex-1 min-w-0">
      <div className="block bg-white border border-stone-200 rounded-lg sm:rounded-r-none sm:border-r-0 hover:border-stone-400 transition-all p-6 cursor-pointer h-full">
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
            {isDismissed ? (
              <button
                type="button"
                onClick={handleRestore}
                disabled={dismissPending}
                aria-label="Restore opportunity"
                title="Restore"
                className="text-xs font-medium text-stone-400 hover:text-stone-700 px-2 py-1 rounded disabled:opacity-50"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDismiss}
                disabled={dismissPending}
                aria-label="Dismiss opportunity"
                title="Dismiss"
                className="text-stone-400 hover:text-stone-700 p-1 rounded disabled:opacity-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Description */}
        {opportunity.description && (
          <p className="text-sm text-stone-600 mb-4 line-clamp-2">
            {opportunity.description}
          </p>
        )}

        {/* WIP status bar — full-width so the workflow state is the primary
            scan target on the card. Margin / cost / risk moved to the aside
            with comparables so financial metrics live together. */}
        <div className="mb-4 p-3 bg-stone-50 rounded-lg border border-stone-100">
          <WIPStatusTile progress={opportunity.progress} />
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
        {isDismissed && opportunity.dismissedAt && (
          <p className="text-[10px] text-stone-400 mt-2">
            Dismissed {format(new Date(opportunity.dismissedAt), 'MMM d, yyyy')}
          </p>
        )}
      </div>
    </Link>
    <Link href={oppHref} className="w-full sm:w-72 flex-shrink-0">
      <div className="block bg-white border border-stone-200 rounded-lg sm:rounded-l-none hover:border-stone-400 transition-all cursor-pointer h-full p-3">
        {/* Grouped panel — financials + past-award comparables share the
            same stone-50 surface with divider lines so the whole aside
            reads as one scannable module. */}
        <div className="bg-stone-50 rounded-lg border border-stone-100 divide-y divide-stone-200/70">
          {/* Financials — Cost / Margin / Risk */}
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
              Financials
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-stone-500 mb-0.5">Cost</p>
                <p className="text-sm font-bold text-stone-900 tabular-nums">
                  {costVal > 0 ? `$${costVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                </p>
                {costVal === 0 && (
                  <p className="text-[10px] text-stone-400 mt-0.5">Open to estimate</p>
                )}
              </div>
              <div>
                <p className="text-xs text-stone-500 mb-0.5">Margin</p>
                <p className={`text-sm font-bold tabular-nums ${hasMargin ? marginColor : 'text-stone-400'}`}>
                  {hasMargin ? `${marginPercent!.toFixed(1)}%` : '—'}
                </p>
                <p className={`text-[11px] tabular-nums ${hasMargin ? marginColor : 'text-stone-400'}`}>
                  {hasMargin && marginDollar !== null
                    ? `$${marginDollar.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : 'Run assessment'}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-stone-500 mb-1">Risk / Strategic</p>
              <div className="flex gap-1 flex-wrap">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-stone-200 text-stone-700">
                  {assessment?.riskLevel || '—'}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-stone-100 text-stone-600">
                  {assessment?.strategicValue || '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Past awards — comparables + expand + saved estimate */}
          <div className="p-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
              Comparable awards · last 5 yrs
            </p>
            {comparablesTile}
            {showAwardsTrigger && (
              <button
                type="button"
                onClick={handleToggle}
                aria-expanded={expanded}
                aria-controls={`awards-${opportunity.id}`}
                className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700"
              >
                <span>
                  {expanded ? 'Hide list' : `Show all ${comparables!.count} awards`}
                </span>
                <svg
                  className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
            {expanded && (
              <div
                id={`awards-${opportunity.id}`}
                role="region"
                onClick={swallow}
                className="border-t border-stone-200 pt-2 max-h-[170px] overflow-y-auto"
              >
                {loadingAwards && (
                  <p className="text-xs italic text-stone-400 px-2 py-1">Loading…</p>
                )}
                {awardsError && (
                  <p className="text-xs text-stone-500 px-2 py-1">{awardsError}</p>
                )}
                {!loadingAwards && !awardsError && awards && awards.length === 0 && (
                  <p className="text-xs text-stone-400 px-2 py-1">No awards to show</p>
                )}
                {!loadingAwards && !awardsError && awards && awards.length > 0 && (
                  <ul className="divide-y divide-stone-100">
                    {awards.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="truncate text-stone-800">{a.recipientName}</span>
                          {a.isRecompete && (
                            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                              Recompete
                            </span>
                          )}
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-3 tabular-nums">
                          <span className="font-semibold text-stone-900">
                            {formatCompact(a.awardAmount)}
                          </span>
                          <span className="text-stone-500 w-16 text-right">
                            {formatMonYear(a.popStart)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {savedEstimate !== null && (
              <p className="text-[10px] text-stone-500 pt-1">
                Saved estimate: {formatCompact(savedEstimate)}
              </p>
            )}
          </div>
        </div>
      </div>
    </Link>
    </div>
  )
}
