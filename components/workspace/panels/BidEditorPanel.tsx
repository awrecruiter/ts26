'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'

interface ApprovalRequest {
  id: string
  status: string
  createdAt: string
  reviewerNote?: string | null
}

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
    approvalRequests?: ApprovalRequest[]
  }
  opportunity: {
    id: string
    title: string
    solicitationNumber: string
    agency?: string
  }
  userRole?: string
  onSave?: (bidAmount: number) => Promise<void>
  onStatusChange?: (status: string) => Promise<void>
}

export default function BidEditorPanel({
  bid,
  opportunity,
  userRole,
  onSave,
  onStatusChange,
}: BidEditorPanelProps) {
  if (process.env.NODE_ENV !== 'production') {
    if (bid.status === 'REVIEWED' && !onStatusChange) {
      console.warn('[BidEditorPanel] Reviewed bid rendered without onStatusChange handler — submit button will no-op')
    }
    if (!onSave) {
      console.warn('[BidEditorPanel] Rendered without onSave handler — save button will no-op')
    }
  }

  const [bidAmount, setBidAmount] = useState(bid.recommendedPrice.toString())
  const [margin, setMargin] = useState(bid.grossMargin || 0)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Complete / submit state
  const [agentNote, setAgentNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(
    bid.approvalRequests?.find((r) => r.status === 'PENDING') ?? null
  )
  const [latestRejection, setLatestRejection] = useState<ApprovalRequest | null>(
    bid.approvalRequests?.find((r) => r.status === 'REJECTED') ?? null
  )

  useEffect(() => {
    // Update approval state when bid prop changes
    const pending = bid.approvalRequests?.find((r) => r.status === 'PENDING') ?? null
    const rejected = bid.approvalRequests?.find((r) => r.status === 'REJECTED') ?? null
    setPendingApproval(pending)
    setLatestRejection(rejected)
  }, [bid.approvalRequests])

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

  const handleComplete = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/bid-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidId: bid.id, agentNote: agentNote.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setPendingApproval(data.request)
      setLatestRejection(null)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  const isAgent = userRole === 'AGENT' || userRole === 'VIEWER'

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

        {/* Main input */}
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
        <div className="grid grid-cols-2 gap-4">
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

        {/* Standard admin/review actions */}
        {!isAgent && (
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
        )}

        {/* Agent: save changes */}
        {isAgent && hasChanges && onSave && (
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-3 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        )}

        {/* Agent: Complete section */}
        {isAgent && bid.status === 'DRAFT' && (
          <div className="border border-stone-200 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-stone-800">Ready to complete this bid package?</h3>
              <p className="text-xs text-stone-500 mt-1">
                This will send your bid to an admin for final review before it goes to the government.
              </p>
            </div>

            {/* Pending state */}
            {pendingApproval && (
              <div className="flex items-center gap-2 py-3 px-4 bg-stone-50 border border-stone-200 rounded-lg">
                <svg className="h-4 w-4 text-stone-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-stone-600">
                  Awaiting admin review — submitted{' '}
                  {format(new Date(pendingApproval.createdAt), 'MMM d, yyyy')}
                </p>
              </div>
            )}

            {/* Rejection callout */}
            {!pendingApproval && latestRejection && latestRejection.reviewerNote && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-800">Revision requested</p>
                <p className="text-sm text-amber-700 mt-1">
                  &ldquo;{latestRejection.reviewerNote}&rdquo;
                </p>
              </div>
            )}

            {!pendingApproval && (
              <>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">
                    Note to admin <span className="text-stone-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={agentNote}
                    onChange={(e) => setAgentNote(e.target.value)}
                    rows={3}
                    placeholder='e.g. "All three quotes received. SDVOSB sub confirmed. SOW sent 5/28."'
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none resize-none bg-white"
                  />
                </div>

                {submitError && (
                  <p className="text-xs text-red-500">{submitError}</p>
                )}

                <button
                  onClick={handleComplete}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
                >
                  {submitting ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Submitting...
                    </>
                  ) : (
                    <>
                      Complete
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
