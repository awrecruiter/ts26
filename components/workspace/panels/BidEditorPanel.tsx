'use client'

import { useState, useEffect } from 'react'

interface BidEditorPanelProps {
  bid: {
    id: string
    recommendedPrice: number
    costBasis?: number
    grossMargin?: number
    potentialProfit?: number
    status: string
    confidence?: string
    source?: string
  }
  opportunity: {
    title: string
    solicitationNumber: string
    agency?: string
  }
  onSave?: (bidAmount: number) => Promise<void>
  onStatusChange?: (status: string) => Promise<void>
}

export default function BidEditorPanel({
  bid,
  opportunity,
  onSave,
  onStatusChange,
}: BidEditorPanelProps) {
  const [bidAmount, setBidAmount] = useState(bid.recommendedPrice.toString())
  const [margin, setMargin] = useState(bid.grossMargin || 0)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Recalculate margin when amount changes
  useEffect(() => {
    const amount = parseFloat(bidAmount) || 0
    const cost = bid.costBasis || 0
    if (amount > 0 && cost > 0) {
      const newMargin = ((amount - cost) / amount) * 100
      setMargin(parseFloat(newMargin.toFixed(1)))
    }
    setHasChanges(amount !== bid.recommendedPrice)
  }, [bidAmount, bid.costBasis, bid.recommendedPrice])

  const handleSave = async () => {
    if (!onSave) return
    const amount = parseFloat(bidAmount)
    if (isNaN(amount) || amount <= 0) return

    setSaving(true)
    try {
      await onSave(amount)
      setHasChanges(false)
    } finally {
      setSaving(false)
    }
  }

  const adjustAmount = (pct: number) => {
    const base = bid.recommendedPrice
    const adjusted = Math.round(base * (1 + pct / 100))
    setBidAmount(adjusted.toString())
  }

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-stone-900">Bid Amount</h1>
            <p className="text-sm text-stone-500 mt-1">{opportunity.title}</p>
          </div>
          <span className={`px-2 py-1 text-xs font-medium rounded ${
            bid.status === 'SUBMITTED' ? 'bg-stone-800 text-white' :
            bid.status === 'REVIEWED' ? 'bg-stone-300 text-stone-700' :
            'bg-stone-100 text-stone-500'
          }`}>
            {bid.status.toLowerCase()}
          </span>
        </div>

        {/* Main input - THE ONLY THING TO FILL */}
        <div className="p-6 bg-white border-2 border-stone-200 rounded-lg">
          <label className="block text-xs text-stone-400 uppercase tracking-wide mb-2">
            Your bid amount
          </label>
          <div className="flex items-center gap-2">
            <span className="text-2xl text-stone-400">$</span>
            <input
              type="text"
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value.replace(/[^0-9]/g, ''))}
              className="flex-1 text-4xl font-semibold text-stone-900 bg-transparent border-none outline-none"
              placeholder="0"
            />
          </div>

          {/* Quick adjustments */}
          <div className="flex gap-2 mt-4 flex-wrap">
            {[-10, -5, 0, 5, 10].map((pct) => (
              <button
                key={pct}
                onClick={() => adjustAmount(pct)}
                className={`px-3 py-2 text-xs font-medium rounded transition-colors min-h-[44px] flex items-center ${
                  pct === 0
                    ? 'bg-stone-800 text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {pct === 0 ? 'Reset' : pct > 0 ? `+${pct}%` : `${pct}%`}
              </button>
            ))}
          </div>
        </div>

        {/* Margin indicator */}
        <div className="p-4 bg-white border border-stone-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-stone-400 uppercase tracking-wide">Margin</span>
            <span className={`text-sm font-medium ${
              margin >= 20 ? 'text-stone-800' :
              margin >= 10 ? 'text-stone-600' :
              'text-stone-400'
            }`}>
              {margin.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-stone-600 transition-all duration-300"
              style={{ width: `${Math.min(margin * 2, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-stone-300 mt-1">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
          </div>
        </div>

        {/* Auto-filled details */}
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-stone-50 border border-stone-200 rounded-lg">
            <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Cost basis</p>
            <p className="text-sm font-medium text-stone-700">
              ${bid.costBasis?.toLocaleString() || '—'}
            </p>
          </div>
          <div className="p-4 bg-stone-50 border border-stone-200 rounded-lg">
            <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Profit</p>
            <p className="text-sm font-medium text-stone-700">
              ${((parseFloat(bidAmount) || 0) - (bid.costBasis || 0)).toLocaleString()}
            </p>
          </div>
          <div className="p-4 bg-stone-50 border border-stone-200 rounded-lg">
            <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Confidence</p>
            <p className="text-sm font-medium text-stone-700">{bid.confidence || '—'}</p>
          </div>
          <div className="p-4 bg-stone-50 border border-stone-200 rounded-lg">
            <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Data source</p>
            <p className="text-sm font-medium text-stone-700">
              {bid.source?.replace(/_/g, ' ') || '—'}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {hasChanges && onSave && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-3 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          )}
          {bid.status === 'DRAFT' && onStatusChange && (
            <button
              onClick={() => onStatusChange('REVIEWED')}
              className="flex-1 px-4 py-3 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
            >
              Mark reviewed
            </button>
          )}
          {bid.status === 'REVIEWED' && onStatusChange && (
            <button
              onClick={() => onStatusChange('SUBMITTED')}
              className="flex-1 px-4 py-3 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors"
            >
              Submit bid
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
