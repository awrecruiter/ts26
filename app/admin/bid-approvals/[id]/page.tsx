'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { format } from 'date-fns'

interface ReviewRequest {
  id: string
  status: string
  agentNote: string | null
  createdAt: string
  reviewedAt: string | null
  reviewerNote: string | null
  opportunity: {
    id: string
    title: string
    agency: string | null
    responseDeadline: string | null
  }
  bid: {
    id: string
    recommendedPrice: number
    costBasis: number | null
    grossMargin: number | null
    potentialProfit: number | null
    confidence: string | null
    source: string | null
    status: string
    content: unknown
  }
  submittedBy: {
    id: string
    name: string | null
    email: string
  }
  reviewedBy: {
    id: string
    name: string | null
    email: string
  } | null
}

export default function BidApprovalDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { data: session, status } = useSession()

  const [request, setRequest] = useState<ReviewRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewerNote, setReviewerNote] = useState('')
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
    else if (status === 'authenticated' && session?.user?.role !== 'ADMIN') router.push('/dashboard')
  }, [status, session, router])

  useEffect(() => {
    if (status !== 'authenticated') return
    fetch(`/api/admin/bid-approvals/${params.id}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.request) setRequest(data.request) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [params.id, status])

  const handleAction = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !reviewerNote.trim()) {
      setActionError('Please add a note explaining the revision needed.')
      return
    }
    setActing(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/bid-approvals/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewerNote: reviewerNote.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      setRequest(data.request)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-stone-600" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-500">Review request not found.</p>
      </div>
    )
  }

  const isPending = request.status === 'PENDING'

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-8">
          <Link href="/admin" className="text-stone-400 hover:text-stone-700">Admin</Link>
          <span className="text-stone-300">/</span>
          <Link href="/admin/bid-approvals" className="text-stone-400 hover:text-stone-700">Bid Reviews</Link>
          <span className="text-stone-300">/</span>
          <span className="text-stone-700 font-medium truncate max-w-xs">{request.opportunity.title}</span>
        </div>

        {/* Status banner */}
        {!isPending && (
          <div className={`mb-6 px-5 py-4 rounded-xl border ${
            request.status === 'APPROVED'
              ? 'bg-stone-50 border-stone-200'
              : 'bg-amber-50 border-amber-200'
          }`}>
            <p className={`font-semibold ${request.status === 'APPROVED' ? 'text-stone-800' : 'text-amber-800'}`}>
              {request.status === 'APPROVED' ? 'Approved' : 'Rejected'}
              {request.reviewedAt && ` on ${format(new Date(request.reviewedAt), 'MMMM d, yyyy')}`}
              {request.reviewedBy && ` by ${request.reviewedBy.name || request.reviewedBy.email}`}
            </p>
            {request.reviewerNote && (
              <p className="text-sm mt-1 text-stone-600">&ldquo;{request.reviewerNote}&rdquo;</p>
            )}
          </div>
        )}

        <div className="space-y-6">
          {/* Opportunity summary */}
          <div className="bg-white border border-stone-200 rounded-xl p-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-4">Opportunity</h2>
            <h1 className="text-xl font-bold text-stone-900 mb-1">{request.opportunity.title}</h1>
            {request.opportunity.agency && (
              <p className="text-sm text-stone-500 mb-4">{request.opportunity.agency}</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              {request.opportunity.responseDeadline && (
                <div>
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-0.5">Deadline</p>
                  <p className="text-sm font-medium text-stone-700">
                    {format(new Date(request.opportunity.responseDeadline), 'MMMM d, yyyy')}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-stone-400 uppercase tracking-wide mb-0.5">Submitted by</p>
                <p className="text-sm font-medium text-stone-700">
                  {request.submittedBy.name || request.submittedBy.email}
                </p>
              </div>
              <div>
                <p className="text-xs text-stone-400 uppercase tracking-wide mb-0.5">Submitted</p>
                <p className="text-sm font-medium text-stone-700">
                  {format(new Date(request.createdAt), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
            </div>
          </div>

          {/* Bid pricing */}
          <div className="bg-white border border-stone-200 rounded-xl p-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-4">Bid Pricing</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-stone-400 uppercase tracking-wide mb-0.5">Recommended Price</p>
                <p className="text-lg font-bold text-stone-900">
                  ${request.bid.recommendedPrice.toLocaleString()}
                </p>
              </div>
              {request.bid.costBasis != null && (
                <div>
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-0.5">Cost Basis</p>
                  <p className="text-sm font-medium text-stone-700">${request.bid.costBasis.toLocaleString()}</p>
                </div>
              )}
              {request.bid.grossMargin != null && (
                <div>
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-0.5">Margin</p>
                  <p className="text-sm font-medium text-stone-700">{request.bid.grossMargin.toFixed(1)}%</p>
                </div>
              )}
              {request.bid.potentialProfit != null && (
                <div>
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-0.5">Profit</p>
                  <p className="text-sm font-medium text-stone-700">${request.bid.potentialProfit.toLocaleString()}</p>
                </div>
              )}
            </div>
            {request.bid.confidence && (
              <p className="mt-3 text-xs text-stone-400">
                Confidence: <span className="text-stone-600">{request.bid.confidence}</span>
                {request.bid.source && (
                  <> · Source: <span className="text-stone-600">{request.bid.source.replace(/_/g, ' ')}</span></>
                )}
              </p>
            )}
          </div>

          {/* Agent note */}
          {request.agentNote && (
            <div className="bg-white border border-stone-200 rounded-xl p-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Agent Note</h2>
              <p className="text-sm text-stone-700">&ldquo;{request.agentNote}&rdquo;</p>
            </div>
          )}

          {/* Approve / Reject */}
          {isPending && (
            <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400">Decision</h2>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1.5">
                  Note to agent <span className="text-stone-400 font-normal">(required for rejection)</span>
                </label>
                <textarea
                  value={reviewerNote}
                  onChange={(e) => setReviewerNote(e.target.value)}
                  rows={3}
                  placeholder='e.g. "Please attach the final sub quote from ACME Corp before resubmitting."'
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none resize-none bg-white"
                />
              </div>

              {actionError && <p className="text-xs text-red-500">{actionError}</p>}

              <div className="flex gap-3">
                <button
                  onClick={() => handleAction('APPROVE')}
                  disabled={acting}
                  className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
                >
                  {acting ? 'Processing...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleAction('REJECT')}
                  disabled={acting}
                  className="flex-1 px-4 py-3 text-sm font-semibold text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 disabled:opacity-50 transition-colors"
                >
                  Request Revision
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
