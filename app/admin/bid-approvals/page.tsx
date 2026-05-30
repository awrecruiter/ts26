'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'

interface ApprovalRequest {
  id: string
  status: string
  agentNote: string | null
  createdAt: string
  reviewedAt: string | null
  opportunity: {
    id: string
    title: string
    agency: string | null
    responseDeadline: string | null
  }
  bid: {
    recommendedPrice: number
  }
  submittedBy: {
    name: string | null
    email: string
  }
}

export default function BidApprovalsPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
    else if (status === 'authenticated' && session?.user?.role !== 'ADMIN') router.push('/dashboard')
  }, [status, session, router])

  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/admin/bid-approvals')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.requests) setRequests(data.requests) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [status])

  const pending = requests.filter((r) => r.status === 'PENDING')
  const reviewed = requests.filter((r) => r.status !== 'PENDING')

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-stone-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/admin"
            className="text-sm text-stone-400 hover:text-stone-700 transition-colors"
          >
            ← Admin
          </Link>
          <h1 className="text-2xl font-bold text-stone-900">Bid Reviews</h1>
        </div>

        {/* Pending */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">
            Pending Review {pending.length > 0 && `(${pending.length})`}
          </h2>
          {pending.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-xl p-8 text-center">
              <p className="text-stone-400 text-sm">No pending reviews</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((req) => (
                <div key={req.id} className="bg-white border border-stone-200 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-stone-900 truncate">{req.opportunity.title}</p>
                      {req.opportunity.agency && (
                        <p className="text-sm text-stone-500 mt-0.5">{req.opportunity.agency}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        <span className="text-xs text-stone-500">
                          Submitted by{' '}
                          <span className="font-medium text-stone-700">
                            {req.submittedBy.name || req.submittedBy.email}
                          </span>
                        </span>
                        <span className="text-xs text-stone-400">
                          {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                        </span>
                        <span className="text-xs font-medium text-stone-600">
                          ${req.bid.recommendedPrice.toLocaleString()}
                        </span>
                        {req.opportunity.responseDeadline && (
                          <span className="text-xs text-stone-400">
                            Due {format(new Date(req.opportunity.responseDeadline), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                      {req.agentNote && (
                        <p className="mt-2 text-sm text-stone-600 italic">
                          &ldquo;{req.agentNote}&rdquo;
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/admin/bid-approvals/${req.id}`}
                      className="shrink-0 px-4 py-2 text-sm font-semibold text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors whitespace-nowrap"
                    >
                      Review Package
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recently reviewed */}
        {reviewed.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">
              Recently Reviewed
            </h2>
            <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100 overflow-hidden">
              {reviewed.map((req) => (
                <Link
                  key={req.id}
                  href={`/admin/bid-approvals/${req.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-stone-50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{req.opportunity.title}</p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {req.submittedBy.name || req.submittedBy.email}
                      {req.reviewedAt && ` · ${format(new Date(req.reviewedAt), 'MMM d, yyyy')}`}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${
                    req.status === 'APPROVED'
                      ? 'bg-stone-100 text-stone-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {req.status === 'APPROVED' ? 'Approved' : 'Rejected'}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
