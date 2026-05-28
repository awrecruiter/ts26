'use client'

import { useState } from 'react'
import Link from 'next/link'

interface OpportunityCardProps {
  opportunity: {
    id: string
    solicitationNumber: string
    title: string
    description?: string | null
    agency?: string | null
    naicsCode?: string | null
    responseDeadline?: Date | null
    postedDate?: Date | null
    status: string
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
  const initCost = opportunity.assessment?.estimatedCost
  const [costStr, setCostStr] = useState<string>(initCost && initCost > 0 ? initCost.toString() : '')

  const costVal = parseFloat(costStr) || 0
  const valueVal = opportunity.assessment?.estimatedValue || 0
  const liveProfitDollar = valueVal - costVal
  const liveProfitPercent = valueVal > 0 ? (liveProfitDollar / valueVal) * 100 : 0
  const hasCost = costVal > 0
  const marginColor = liveProfitPercent >= 20 ? 'text-green-700' : liveProfitPercent >= 10 ? 'text-amber-700' : 'text-red-700'

  const deadline = opportunity.responseDeadline ? new Date(opportunity.responseDeadline) : null
  const daysUntilDeadline = deadline
    ? Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <Link href={`/opportunities/${opportunity.id}`}>
      <div className="block bg-white border border-stone-200 rounded-lg hover:border-stone-400 transition-all p-6 cursor-pointer">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-stone-900">
                {opportunity.title}
              </h3>
              {opportunity.assessment?.recommendation && (
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                  opportunity.assessment.recommendation === 'GO' ? 'bg-stone-200 text-stone-800' :
                  opportunity.assessment.recommendation === 'REVIEW' ? 'bg-stone-100 text-stone-600' :
                  'bg-stone-100 text-stone-500'
                }`}>
                  {opportunity.assessment.recommendation.replace('_', ' ')}
                </span>
              )}
            </div>
            <p className="text-sm text-stone-500">
              {opportunity.solicitationNumber}
            </p>
          </div>
          <div className="flex items-center gap-3">
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

        {/* Assessment Metrics */}
        {opportunity.assessment ? (
          <div className="grid grid-cols-4 gap-4 mb-4 p-3 bg-stone-50 rounded-lg border border-stone-100">
            <div>
              <p className="text-xs text-stone-500 mb-1">Contract Value</p>
              <p className="text-base font-bold text-stone-900">
                ${(opportunity.assessment.estimatedValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div onClick={e => e.preventDefault()}>
              <p className="text-xs text-stone-500 mb-1">Your Cost</p>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-xs pointer-events-none">$</span>
                <input
                  type="number"
                  value={costStr}
                  onChange={e => setCostStr(e.target.value)}
                  placeholder="Enter cost"
                  className="w-full pl-5 pr-1 py-1 text-sm font-bold text-stone-900 border border-stone-300 rounded focus:ring-1 focus:ring-stone-400 outline-none bg-white"
                />
              </div>
            </div>
            <div>
              <p className="text-xs text-stone-500 mb-1">Margin</p>
              <p className={`text-base font-bold ${hasCost ? marginColor : 'text-stone-400'}`}>
                {hasCost ? `${liveProfitPercent.toFixed(1)}%` : '—'}
              </p>
              <p className={`text-xs ${hasCost ? marginColor : 'text-stone-400'}`}>
                {hasCost ? `$${liveProfitDollar.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500 mb-1">Risk / Strategic</p>
              <div className="flex gap-1">
                <span className="text-xs px-2 py-0.5 rounded font-medium bg-stone-200 text-stone-700">
                  {opportunity.assessment.riskLevel || '—'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-medium bg-stone-100 text-stone-600">
                  {opportunity.assessment.strategicValue || '—'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-3 bg-stone-50 border border-stone-200 rounded-lg">
            <p className="text-sm text-stone-500">No assessment yet — open to auto-calculate margins</p>
          </div>
        )}

        {/* Meta Information */}
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          {opportunity.agency && (
            <div>
              <span className="text-stone-400">Agency:</span>
              <span className="ml-2 text-stone-700">{opportunity.agency}</span>
            </div>
          )}
          {opportunity.naicsCode && (
            <div>
              <span className="text-stone-400">NAICS:</span>
              <span className="ml-2 text-stone-700">{opportunity.naicsCode}</span>
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
