'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import WIPProgressTracker from '@/components/progress/WIPProgressTracker'
import BidDocumentEditor from '@/components/bids/BidDocumentEditor'
import DeadlineIndicator from '@/components/shared/DeadlineIndicator'
import NextActionBanner from '@/components/shared/NextActionBanner'
import type { Stage } from '@/components/progress/WIPProgressTracker'

function DataSourceBadge({ source, confidence }: { source: string | null; confidence?: string }) {
  if (!source) return null

  const config: Record<string, { label: string; className: string; icon: string }> = {
    usaspending_api: {
      label: 'Historical Data',
      className: 'bg-stone-100 text-stone-700 border-stone-300',
      icon: '📊',
    },
    subcontractor_quotes: {
      label: 'Quotes Received',
      className: 'bg-stone-100 text-stone-700 border-stone-300',
      icon: '📝',
    },
    cost_based: {
      label: 'Cost Based',
      className: 'bg-stone-100 text-stone-700 border-stone-300',
      icon: '💰',
    },
    industry_average: {
      label: 'Industry Avg',
      className: 'bg-stone-200 text-stone-700 border-stone-300',
      icon: '📈',
    },
    default_fallback: {
      label: 'Estimated',
      className: 'bg-stone-200 text-stone-700 border-stone-300',
      icon: '⚡',
    },
  }

  const { label, className, icon } = config[source] || {
    label: source,
    className: 'bg-stone-100 text-stone-700 border-stone-300',
    icon: '📋',
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full border ${className}`}>
        <span>{icon}</span>
        {label}
      </span>
      {confidence && (
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
          confidence === 'high' ? 'bg-stone-100 text-stone-600' :
          confidence === 'medium' ? 'bg-stone-200 text-stone-600' :
          'bg-stone-100 text-stone-500'
        }`}>
          {confidence} confidence
        </span>
      )}
    </div>
  )
}

function determineBidNextAction(bid: any, progress: any) {
  const status = bid?.status || 'DRAFT'
  const hasDocument = !!bid?.content

  if (status === 'SUBMITTED') {
    return {
      action: 'Bid submitted - awaiting response',
      description: 'Monitor for updates from the contracting agency',
      variant: 'success' as const,
    }
  }

  if (status === 'AWARDED') {
    return {
      action: 'Congratulations! Bid was awarded',
      description: 'Proceed to contract execution',
      variant: 'success' as const,
    }
  }

  if (status === 'REJECTED') {
    return {
      action: 'Bid was not selected',
      description: 'Review feedback for future opportunities',
      variant: 'warning' as const,
    }
  }

  if (!hasDocument) {
    return {
      action: 'Customize your bid document',
      description: 'Review and edit the auto-generated proposal',
      actionLabel: 'Edit Document',
      step: 'edit-document',
      variant: 'primary' as const,
    }
  }

  if (status === 'DRAFT') {
    return {
      action: 'Review and submit your bid',
      description: 'Final review before submission',
      actionLabel: 'Mark as Reviewed',
      step: 'review',
      variant: 'primary' as const,
    }
  }

  if (status === 'REVIEWED') {
    return {
      action: 'Submit your bid',
      description: 'Ready to submit to the contracting agency',
      actionLabel: 'Submit Bid',
      step: 'submit',
      variant: 'success' as const,
    }
  }

  return {
    action: 'Continue working on bid',
    description: 'Review details below',
    variant: 'primary' as const,
  }
}

export default function BidDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [bid, setBid] = useState<any>(null)
  const [progress, setProgress] = useState<any>(null)
  const [bidDocument, setBidDocument] = useState<any>(null)
  const [showDocumentEditor, setShowDocumentEditor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    fetchBid()
  }, [params.id])

  const fetchBid = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/bids/${params.id}`)
      if (!response.ok) throw new Error('Failed to fetch bid')
      const data = await response.json()
      setBid(data.bid)

      if (data.bid?.opportunityId) {
        const progressResponse = await fetch(`/api/opportunities/${data.bid.opportunityId}/progress`)
        if (progressResponse.ok) {
          const progressData = await progressResponse.json()
          setProgress(progressData)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateStage = async (newStage: Stage) => {
    if (!bid?.opportunityId) return
    try {
      const response = await fetch(`/api/opportunities/${bid.opportunityId}/progress`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStage: newStage }),
      })
      if (!response.ok) throw new Error('Failed to update progress')
      const data = await response.json()
      setProgress(data)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update progress')
    }
  }

  const handleUpdateBidStatus = async (newStatus: string) => {
    setUpdating(true)
    try {
      const response = await fetch(`/api/bids/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!response.ok) throw new Error('Failed to update bid status')
      await fetchBid()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update bid')
    } finally {
      setUpdating(false)
    }
  }

  const openDocumentEditor = async () => {
    try {
      const res = await fetch(`/api/bids/${params.id}/document`)
      const data = await res.json()
      setBidDocument(data.content)
      setShowDocumentEditor(true)
    } catch (err) {
      console.error('Error fetching document:', err)
      alert('Failed to load document')
    }
  }

  const handleNextAction = () => {
    const nextAction = determineBidNextAction(bid, progress)
    switch (nextAction.step) {
      case 'edit-document':
        openDocumentEditor()
        break
      case 'review':
        handleUpdateBidStatus('REVIEWED')
        break
      case 'submit':
        handleUpdateBidStatus('SUBMITTED')
        break
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-600">Loading bid details...</p>
        </div>
      </div>
    )
  }

  if (error || !bid) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-stone-600 text-lg">{error || 'Bid not found'}</p>
          <button
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  const deadline = bid.opportunity?.responseDeadline ? new Date(bid.opportunity.responseDeadline) : null
  const nextAction = determineBidNextAction(bid, progress)

  const marginHealth =
    (bid.grossMargin || 0) >= 25 ? { label: 'Excellent', color: 'text-stone-700', bg: 'bg-stone-50' } :
    (bid.grossMargin || 0) >= 20 ? { label: 'Good', color: 'text-stone-700', bg: 'bg-stone-50' } :
    (bid.grossMargin || 0) >= 15 ? { label: 'Moderate', color: 'text-stone-600', bg: 'bg-stone-100' } :
    (bid.grossMargin || 0) >= 10 ? { label: 'Low', color: 'text-stone-600', bg: 'bg-stone-200' } :
    { label: 'Marginal', color: 'text-stone-500', bg: 'bg-stone-100' }

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Sticky Header with Deadline */}
      <div className="sticky top-0 z-40 bg-white border-b-2 border-stone-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => router.back()}
                className="text-stone-600 hover:text-stone-900 font-medium flex items-center gap-1"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              {deadline && <DeadlineIndicator deadline={deadline} size="lg" />}
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-stone-500 mb-1">Bid Proposal</p>
                <h1 className="text-2xl font-bold text-stone-900 truncate">
                  {bid.opportunity?.title || 'Bid Details'}
                </h1>
                {bid.opportunity && (
                  <p className="text-sm text-stone-500 mt-1">
                    {bid.opportunity.solicitationNumber} • {bid.opportunity.agency}
                  </p>
                )}
              </div>
              <span className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold ${
                bid.status === 'SUBMITTED' ? 'bg-stone-800 text-white' :
                bid.status === 'AWARDED' ? 'bg-stone-100 text-stone-700' :
                bid.status === 'REJECTED' ? 'bg-stone-100 text-stone-600' :
                bid.status === 'REVIEWED' ? 'bg-stone-200 text-stone-700' :
                'bg-stone-100 text-stone-600'
              }`}>
                {bid.status}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* SECTION 1: Next Action Banner */}
          {nextAction.actionLabel && (
            <NextActionBanner
              action={nextAction.action}
              description={nextAction.description}
              actionLabel={nextAction.actionLabel}
              onAction={handleNextAction}
              loading={updating}
              variant={nextAction.variant}
            />
          )}

          {/* Status-only banner (no action) */}
          {!nextAction.actionLabel && (
            <div className={`rounded-xl p-6 ${
              nextAction.variant === 'success' ? 'bg-stone-50 border-2 border-stone-200' :
              nextAction.variant === 'warning' ? 'bg-stone-50 border-2 border-stone-300' :
              'bg-stone-50 border-2 border-stone-200'
            }`}>
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 p-3 rounded-full bg-stone-100">
                  {nextAction.variant === 'success' ? (
                    <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-6 w-6 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="font-bold text-stone-900">{nextAction.action}</p>
                  <p className="text-sm text-stone-600">{nextAction.description}</p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: Pricing Summary */}
          <div className="bg-white rounded-xl border-2 border-stone-200 overflow-hidden">
            <div className="bg-stone-900 px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Your Bid</h2>
                <DataSourceBadge source={bid.source} confidence={bid.confidence} />
              </div>
            </div>

            <div className="p-6">
              <div className="text-center mb-8">
                <p className="text-sm text-stone-500 uppercase tracking-wide mb-2">Recommended Price</p>
                <p className="text-5xl font-bold text-stone-800">
                  ${bid.recommendedPrice?.toLocaleString() || '0'}
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-stone-50 rounded-xl">
                  <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Cost Basis</p>
                  <p className="text-xl font-bold text-stone-900">
                    ${bid.costBasis?.toLocaleString() || 'N/A'}
                  </p>
                </div>
                <div className="text-center p-4 bg-stone-50 rounded-xl">
                  <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Potential Profit</p>
                  <p className="text-xl font-bold text-stone-700">
                    ${bid.potentialProfit?.toLocaleString() || 'N/A'}
                  </p>
                </div>
                <div className={`text-center p-4 rounded-xl ${marginHealth.bg}`}>
                  <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Gross Margin</p>
                  <p className={`text-xl font-bold ${marginHealth.color}`}>
                    {bid.grossMargin || 0}%
                  </p>
                  <p className={`text-xs ${marginHealth.color}`}>{marginHealth.label}</p>
                </div>
                <div className="text-center p-4 bg-stone-50 rounded-xl">
                  <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Size</p>
                  <p className="text-xl font-bold text-stone-900">
                    {bid.opportunitySize || 'N/A'}
                  </p>
                </div>
              </div>

              {/* Margin visualization bar */}
              <div className="mt-6">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-stone-600">Margin Health</span>
                  <span className={`font-medium ${marginHealth.color}`}>
                    {bid.grossMargin || 0}% - {marginHealth.label}
                  </span>
                </div>
                <div className="h-3 bg-stone-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      (bid.grossMargin || 0) >= 20 ? 'bg-stone-700' :
                      (bid.grossMargin || 0) >= 15 ? 'bg-stone-500' :
                      (bid.grossMargin || 0) >= 10 ? 'bg-stone-400' :
                      'bg-stone-300'
                    }`}
                    style={{ width: `${Math.min((bid.grossMargin || 0) * 2, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-stone-400 mt-1">
                  <span>0%</span>
                  <span>10%</span>
                  <span>20%</span>
                  <span>30%</span>
                  <span>50%+</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: Progress Tracker */}
          {progress && (
            <WIPProgressTracker
              opportunityId={bid.opportunityId}
              progress={progress}
              onUpdateStage={handleUpdateStage}
              compact={false}
            />
          )}

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left column: Document & History */}
            <div className="lg:col-span-2 space-y-6">
              {/* Bid Document Card */}
              <div className="bg-white rounded-xl border-2 border-stone-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-stone-900">Bid Document</h3>
                    <p className="text-sm text-stone-500">
                      {bid.content
                        ? `${(bid.content as any).sections?.length || 0} sections ready`
                        : 'Auto-generated from opportunity data'}
                    </p>
                  </div>
                  <button
                    onClick={openDocumentEditor}
                    className="px-4 py-2 bg-stone-800 text-white font-semibold rounded-lg hover:bg-stone-700 transition-colors flex items-center gap-2"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit Document
                  </button>
                </div>

                <div className="p-6 bg-stone-50">
                  <div className="bg-white border border-stone-200 rounded-lg p-6 shadow-sm">
                    <div className="text-center border-b border-stone-200 pb-4 mb-4">
                      <h4 className="text-lg font-bold text-stone-900">
                        {(bid.content as any)?.header?.title || `Bid Proposal - ${bid.opportunity?.title}`}
                      </h4>
                      <p className="text-sm text-stone-500 mt-1">
                        {bid.opportunity?.solicitationNumber}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-stone-500">Agency:</span>
                        <p className="font-medium">{bid.opportunity?.agency}</p>
                      </div>
                      <div>
                        <span className="text-stone-500">Bid Amount:</span>
                        <p className="font-medium text-stone-800">
                          ${bid.recommendedPrice?.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-stone-200 text-center">
                      <button
                        onClick={openDocumentEditor}
                        className="text-stone-600 hover:text-stone-900 text-sm font-medium"
                      >
                        Click to view full document →
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Historical Data (if available) */}
              {bid.historicalData && bid.historicalData.totalContracts > 0 && (
                <div className="bg-white rounded-xl border border-stone-200 p-6">
                  <h3 className="text-lg font-bold text-stone-900 mb-4">
                    Historical Contract Data
                  </h3>
                  <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-stone-700">
                      Analysis based on <strong>{bid.historicalData.totalContracts}</strong> similar
                      contracts from USASpending API
                    </p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <p className="text-xs text-stone-500 mb-1">Average</p>
                      <p className="font-bold text-stone-900">
                        ${(bid.historicalData.averageValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-stone-500 mb-1">Median</p>
                      <p className="font-bold text-stone-900">
                        ${(bid.historicalData.medianValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-stone-500 mb-1">Min</p>
                      <p className="font-bold text-stone-900">
                        ${(bid.historicalData.minValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-stone-500 mb-1">Max</p>
                      <p className="font-bold text-stone-900">
                        ${(bid.historicalData.maxValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              {bid.notes && (
                <div className="bg-white rounded-xl border border-stone-200 p-6">
                  <h3 className="text-lg font-bold text-stone-900 mb-4">Notes</h3>
                  <div className="bg-stone-50 border-l-4 border-stone-400 p-4">
                    <p className="text-stone-700">{bid.notes}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right sidebar */}
            <div className="space-y-6">
              {/* Quick Actions */}
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <h3 className="text-lg font-bold text-stone-900 mb-4">Actions</h3>
                <div className="space-y-3">
                  <button
                    onClick={openDocumentEditor}
                    className="w-full px-4 py-3 bg-stone-800 text-white font-semibold rounded-lg hover:bg-stone-700 transition-colors"
                  >
                    Edit Document
                  </button>

                  {bid.status === 'DRAFT' && (
                    <button
                      onClick={() => handleUpdateBidStatus('REVIEWED')}
                      disabled={updating}
                      className="w-full px-4 py-3 bg-stone-600 text-white font-semibold rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
                    >
                      {updating ? 'Updating...' : 'Mark as Reviewed'}
                    </button>
                  )}

                  {bid.status === 'REVIEWED' && (
                    <button
                      onClick={() => handleUpdateBidStatus('SUBMITTED')}
                      disabled={updating}
                      className="w-full px-4 py-3 bg-stone-800 text-white font-semibold rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
                    >
                      {updating ? 'Submitting...' : 'Submit Bid'}
                    </button>
                  )}

                  <Link
                    href={`/opportunities/${bid.opportunityId}`}
                    className="block w-full px-4 py-3 bg-white border-2 border-stone-300 text-stone-700 font-semibold rounded-lg hover:bg-stone-50 transition-colors text-center"
                  >
                    View Opportunity
                  </Link>
                </div>
              </div>

              {/* Bid Details */}
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <h3 className="text-lg font-bold text-stone-900 mb-4">Details</h3>
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide">Created</p>
                    <p className="font-medium text-stone-900 mt-1">
                      {format(new Date(bid.createdAt), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide">Last Updated</p>
                    <p className="font-medium text-stone-900 mt-1">
                      {format(new Date(bid.updatedAt), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide">Profitability</p>
                    <p className="font-medium text-stone-900 mt-1">
                      {bid.profitabilityRating || 'Not rated'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide">Within Capabilities</p>
                    <p className="font-medium text-stone-900 mt-1">
                      {bid.withinCapabilities ? 'Yes' : 'Not assessed'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Subcontractor Quotes Summary */}
              {bid.subcontractorQuotes && bid.quotesCount > 0 && (
                <div className="bg-white rounded-xl border border-stone-200 p-6">
                  <h3 className="text-lg font-bold text-stone-900 mb-4">
                    Subcontractor Quotes
                  </h3>
                  <div className="text-center p-4 bg-stone-50 rounded-lg">
                    <p className="text-3xl font-bold text-stone-800">{bid.quotesCount}</p>
                    <p className="text-sm text-stone-600">quotes received</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Document Editor Modal */}
      {showDocumentEditor && bidDocument && (
        <div className="fixed inset-0 z-50 bg-stone-900/50">
          <BidDocumentEditor
            content={bidDocument}
            onSave={async (updatedContent) => {
              await fetch(`/api/bids/${params.id}/document`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: updatedContent }),
              })
              setShowDocumentEditor(false)
              fetchBid()
            }}
            onCancel={() => setShowDocumentEditor(false)}
          />
        </div>
      )}
    </div>
  )
}
