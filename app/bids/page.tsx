"use client"

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import BidCard from '@/components/bids/BidCard'

function BidsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status: sessionStatus } = useSession()

  const [bids, setBids] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [status, setStatus] = useState(searchParams.get('status') || '')

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/login')
    } else if (sessionStatus === 'authenticated') {
      fetchBids()
    }
  }, [sessionStatus, searchParams])

  const fetchBids = async () => {
    try {
      setLoading(true)
      setError('')

      const params = new URLSearchParams()
      params.set('page', searchParams.get('page') || '1')
      params.set('limit', '20')

      if (search) params.set('search', search)
      if (status) params.set('status', status)

      const response = await fetch(`/api/bids?${params.toString()}`)

      if (!response.ok) {
        throw new Error('Failed to fetch bids')
      }

      const data = await response.json()
      setBids(data.bids || [])

      if (data.pagination) {
        setPagination(data.pagination)
      } else {
        setPagination({
          page: 1,
          limit: 20,
          total: data.count || data.bids?.length || 0,
          totalPages: 1,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateFilters({ search, status })
  }

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus)
    updateFilters({ search, status: newStatus })
  }

  const updateFilters = (filters: { search?: string; status?: string }) => {
    const params = new URLSearchParams()
    if (filters.search) params.set('search', filters.search)
    if (filters.status) params.set('status', filters.status)
    params.set('page', '1')

    router.push(`/bids?${params.toString()}`)
  }

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', newPage.toString())
    router.push(`/bids?${params.toString()}`)
  }

  const statuses = [
    { value: '', label: 'All Statuses' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'REVIEWED', label: 'Reviewed' },
    { value: 'SUBMITTED', label: 'Submitted' },
    { value: 'AWARDED', label: 'Awarded' },
    { value: 'REJECTED', label: 'Rejected' },
  ]

  if (sessionStatus === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-500">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-stone-900">Bids</h1>
              <p className="mt-2 text-sm text-stone-600">
                Manage and track your bid pricing analysis
              </p>
            </div>
            <button
              onClick={() => router.push('/opportunities')}
              className="px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
            >
              Generate New Bid
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-4">
            <input
              type="text"
              placeholder="Search by opportunity name or solicitation number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            >
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-6 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
            >
              Search
            </button>
          </form>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
            <p className="mt-4 text-stone-600">Loading bids...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-stone-600 text-lg">{error}</p>
            <button
              onClick={() => fetchBids()}
              className="mt-4 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && bids.length === 0 && (
          <div className="text-center py-12">
            <p className="text-stone-600 text-lg">No bids found</p>
            <p className="text-stone-500 mt-2">
              {search || status
                ? 'Try adjusting your filters'
                : 'Generate your first bid from an opportunity'}
            </p>
            <button
              onClick={() => router.push('/opportunities')}
              className="mt-4 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
            >
              View Opportunities
            </button>
          </div>
        )}

        {!loading && !error && bids.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
              {bids.map((bid) => (
                <BidCard key={bid.id} bid={bid} />
              ))}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-8">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-4 py-2 bg-white border border-stone-300 rounded-md hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-stone-600">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="px-4 py-2 bg-white border border-stone-300 rounded-md hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}

            <div className="text-center mt-4 text-sm text-stone-600">
              Showing {bids.length} of {pagination.total} bids
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function BidsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-600">Loading bids...</p>
        </div>
      </div>
    }>
      <BidsPageContent />
    </Suspense>
  )
}
