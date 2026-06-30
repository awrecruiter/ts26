"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import OpportunityCard from '@/components/opportunities/OpportunityCard'
import ChipInput from '@/components/shared/ChipInput'

const NAICS_PATTERN = /^\d{2,6}$/
const validateNaics = (v: string) => (NAICS_PATTERN.test(v.trim()) ? v.trim() : null)

const SORT_OPTIONS = [
  { label: 'Deadline (soonest)', value: 'deadline_asc' },
  { label: 'Deadline (latest)', value: 'deadline_desc' },
  { label: 'Recently posted', value: 'posted_desc' },
  { label: 'Oldest posted', value: 'posted_asc' },
  { label: 'Title A–Z', value: 'title_asc' },
  { label: 'Title Z–A', value: 'title_desc' },
]

const DEADLINE_OPTIONS = [
  { label: 'Any deadline', value: '' },
  { label: 'Next 7 days', value: '7' },
  { label: 'Next 14 days', value: '14' },
  { label: 'Next 30 days', value: '30' },
  { label: 'Next 60 days', value: '60' },
]

function FilterBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-stone-100 text-stone-700 rounded-full">
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 text-stone-400 hover:text-stone-700"
        aria-label="Remove filter"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}

function OpportunitiesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, status: sessionStatus } = useSession()

  const [opportunities, setOpportunities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState<string | null>(null)
  const [searchingSam, setSearchingSam] = useState(false)
  const [samSearchResult, setSamSearchResult] = useState<string | null>(null)
  const refreshedIdsRef = useRef<Set<string>>(new Set())

  // Basic filters
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [naicsCodes, setNaicsCodes] = useState<string[]>(
    (searchParams.get('naics') || '').split(',').map((s) => s.trim()).filter(Boolean)
  )
  const [agencyFilter, setAgencyFilter] = useState(searchParams.get('agency') || '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'ACTIVE')
  const [sort, setSort] = useState(searchParams.get('sort') || 'deadline_asc')

  // Advanced filters
  const [deadlineDays, setDeadlineDays] = useState(searchParams.get('deadlineDays') || '')
  const [hasSOW, setHasSOW] = useState(searchParams.get('hasSOW') || '')
  const [hasBid, setHasBid] = useState(searchParams.get('hasBid') || '')
  const [recommendation, setRecommendation] = useState(searchParams.get('recommendation') || '')
  const [minMargin, setMinMargin] = useState(searchParams.get('minMargin') || '')
  const [maxMargin, setMaxMargin] = useState(searchParams.get('maxMargin') || '')

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/login')
    } else if (sessionStatus === 'authenticated') {
      fetchOpportunities()
    }
  }, [sessionStatus, searchParams])

  const buildParams = () => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (naicsCodes.length > 0) params.set('naics', naicsCodes.join(','))
    if (agencyFilter) params.set('agency', agencyFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (sort && sort !== 'deadline_asc') params.set('sort', sort)
    if (deadlineDays) params.set('deadlineDays', deadlineDays)
    if (hasSOW) params.set('hasSOW', hasSOW)
    if (hasBid) params.set('hasBid', hasBid)
    if (recommendation) params.set('recommendation', recommendation)
    if (minMargin) params.set('minMargin', minMargin)
    if (maxMargin) params.set('maxMargin', maxMargin)
    return params
  }

  const runSamSearch = async (
    setBusy: (b: boolean) => void,
    setMessage: (m: string | null) => void
  ) => {
    const query = searchParams.get('search') || ''
    const naics = searchParams.get('naics') || ''
    if (!query && !naics) {
      setMessage('Enter a search term or NAICS code first')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/opportunities/search-sam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, naics }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'SAM.gov search failed')
        return
      }
      const found: number = data.found ?? 0
      const created: number = data.created ?? 0
      const eligible: number = data.eligible ?? 0
      const samgovTotal: number = data.samgovTotal ?? 0
      const totalMatches = samgovTotal || found
      if (created > 0) {
        const skipped = Math.max(totalMatches - created, 0)
        const noun = created === 1 ? 'opportunity' : 'opportunities'
        setMessage(
          `Fetched ${created} new ${noun} (${totalMatches} SAM.gov matches, ${skipped} already in library or closing soon)`
        )
        fetchOpportunities()
      } else if (eligible > 0) {
        setMessage(
          `${totalMatches} SAM.gov matches — all ${eligible} eligible records were already in your library`
        )
        fetchOpportunities()
      } else if (found > 0) {
        setMessage(
          `Found ${totalMatches} on SAM.gov, but all were closing within 14 days`
        )
      } else {
        setMessage('No matches on SAM.gov')
      }
    } catch {
      setMessage('Network error — please try again')
    } finally {
      setBusy(false)
    }
  }

  const handleLiveSamSearch = () => runSamSearch(setSearchingSam, setSamSearchResult)
  const handleFetchFromSAM = () => runSamSearch(setFetching, setFetchResult)

  const refreshComparablesInBatches = useCallback(async (ids: string[]) => {
    const POOL_SIZE = 3
    const queue = [...ids]

    async function worker() {
      while (queue.length > 0) {
        const id = queue.shift()
        if (!id) return
        if (refreshedIdsRef.current.has(id)) continue
        refreshedIdsRef.current.add(id)
        try {
          const resp = await fetch(`/api/opportunities/${id}/comparables/refresh`, { method: 'POST' })
          if (!resp.ok) continue
          const json = await resp.json()
          if (!json?.summary) continue
          setOpportunities((prev: any[]) =>
            prev.map((o) =>
              o.id === id
                ? { ...o, comparables: { ...json.summary, isStale: false } }
                : o
            )
          )
        } catch {
          // Swallow — opp stays in refreshedIdsRef so we don't retry on filter change.
          // Card will continue to show "Loading comparables…" until next full reload.
        }
      }
    }

    await Promise.all(Array.from({ length: POOL_SIZE }, () => worker()))
  }, [])

  const fetchOpportunities = async () => {
    try {
      setLoading(true)
      setError('')

      const params = new URLSearchParams(searchParams.toString())
      params.set('page', searchParams.get('page') || '1')

      const response = await fetch(`/api/opportunities?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch opportunities')
      const data = await response.json()

      const opps: any[] = data.opportunities || []
      setOpportunities(opps)
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 })

      const toRefresh = opps.filter(
        (o) => o.comparables == null && o.naicsCode && !refreshedIdsRef.current.has(o.id)
      )
      if (toRefresh.length > 0) {
        void refreshComparablesInBatches(toRefresh.map((o) => o.id))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Optimistic dismiss/restore: when viewing the matching status filter,
  // drop the row immediately; if the API call fails the card surfaces its
  // own alert and we re-fetch to restore truth.
  const handleDismissed = useCallback(
    (id: string) => {
      if (statusFilter !== 'DISMISSED') {
        setOpportunities((prev) => prev.filter((o) => o.id !== id))
      } else {
        // We're already on the dismissed view — refresh to pick up the new entry.
        fetchOpportunities()
      }
    },
    [statusFilter]
  )

  const handleRestored = useCallback(
    (id: string) => {
      if (statusFilter === 'DISMISSED') {
        setOpportunities((prev) => prev.filter((o) => o.id !== id))
      } else {
        fetchOpportunities()
      }
    },
    [statusFilter]
  )

  const applyFilters = () => {
    const params = buildParams()
    params.set('page', '1')
    router.push(`/opportunities?${params.toString()}`)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    applyFilters()
  }

  const handleSortChange = (newSort: string) => {
    setSort(newSort)
    const params = buildParams()
    if (newSort && newSort !== 'deadline_asc') params.set('sort', newSort)
    else params.delete('sort')
    params.set('page', '1')
    router.push(`/opportunities?${params.toString()}`)
  }

  const clearAllFilters = () => {
    setSearch('')
    setNaicsCodes([])
    setAgencyFilter('')
    setStatusFilter('ACTIVE')
    setSort('deadline_asc')
    setDeadlineDays('')
    setHasSOW('')
    setHasBid('')
    setRecommendation('')
    setMinMargin('')
    setMaxMargin('')
    router.push('/opportunities?status=ACTIVE&page=1')
  }

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', newPage.toString())
    router.push(`/opportunities?${params.toString()}`)
  }

  // Active filter badges
  const activeFilters: { label: string; clear: () => void }[] = []
  if (search) activeFilters.push({ label: `"${search}"`, clear: () => { setSearch(''); applyFiltersWithOverride({ search: '' }) } })
  naicsCodes.forEach((code) => {
    activeFilters.push({
      label: `NAICS: ${code}`,
      clear: () => {
        const next = naicsCodes.filter((c) => c !== code)
        setNaicsCodes(next)
        applyFiltersWithOverride({ naics: next.join(',') })
      },
    })
  })
  if (agencyFilter) activeFilters.push({ label: `Agency: ${agencyFilter}`, clear: () => { setAgencyFilter(''); applyFiltersWithOverride({ agency: '' }) } })
  if (deadlineDays) activeFilters.push({ label: `≤ ${deadlineDays} days`, clear: () => { setDeadlineDays(''); applyFiltersWithOverride({ deadlineDays: '' }) } })
  if (hasSOW === 'yes') activeFilters.push({ label: 'Has SOW', clear: () => { setHasSOW(''); applyFiltersWithOverride({ hasSOW: '' }) } })
  if (hasSOW === 'no') activeFilters.push({ label: 'No SOW', clear: () => { setHasSOW(''); applyFiltersWithOverride({ hasSOW: '' }) } })
  if (hasBid === 'yes') activeFilters.push({ label: 'Has Bid', clear: () => { setHasBid(''); applyFiltersWithOverride({ hasBid: '' }) } })
  if (hasBid === 'no') activeFilters.push({ label: 'No Bid', clear: () => { setHasBid(''); applyFiltersWithOverride({ hasBid: '' }) } })
  if (recommendation) activeFilters.push({ label: `${recommendation.replace('_', ' ')}`, clear: () => { setRecommendation(''); applyFiltersWithOverride({ recommendation: '' }) } })
  if (minMargin) activeFilters.push({ label: `Margin ≥ ${minMargin}%`, clear: () => { setMinMargin(''); applyFiltersWithOverride({ minMargin: '' }) } })
  if (maxMargin) activeFilters.push({ label: `Margin ≤ ${maxMargin}%`, clear: () => { setMaxMargin(''); applyFiltersWithOverride({ maxMargin: '' }) } })

  function applyFiltersWithOverride(overrides: Record<string, string>) {
    const params = buildParams()
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) params.set(k, v); else params.delete(k)
    })
    params.set('page', '1')
    router.push(`/opportunities?${params.toString()}`)
  }

  if (sessionStatus === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-500">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 overflow-x-hidden">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-stone-900">Opportunities</h1>
              <p className="mt-0.5 text-sm text-stone-500">
                Browse and track government contracting opportunities
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {sessionStatus === 'authenticated' && session?.user?.role === 'ADMIN' && (
                <button
                  onClick={handleFetchFromSAM}
                  disabled={fetching}
                  className="px-4 py-2 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 disabled:opacity-50 transition-colors"
                >
                  {fetching ? 'Fetching...' : 'Fetch from SAM.gov'}
                </button>
              )}
              <button
                onClick={() => router.push('/dashboard')}
                className="px-4 py-2 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
              >
                Dashboard
              </button>
            </div>
          </div>
          {fetchResult && (
            <p className="mt-2 text-sm text-stone-600">{fetchResult}</p>
          )}
        </div>
      </div>

      {/* Search + Filter Bar */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form onSubmit={handleSearch} autoComplete="off">
            {/* Search row */}
            <div className="flex flex-wrap gap-3 mb-3">
              <div className="relative flex-1 min-w-0">
                <input
                  type="text"
                  placeholder="Search by title, solicitation number, or description..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full px-4 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none pr-8"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); applyFiltersWithOverride({ search: '' }) }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors"
              >
                Search
              </button>
              {/* Sort */}
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => handleSortChange(e.target.value)}
                  className="appearance-none pl-8 pr-8 py-2 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none cursor-pointer"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                </svg>
                <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {/* Filters toggle */}
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center gap-2 ${
                  activeFilters.length > 0
                    ? 'bg-stone-100 border-stone-400 text-stone-800'
                    : 'bg-white border-stone-300 text-stone-600 hover:bg-stone-50'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                {filtersOpen ? 'Hide Filters' : 'Filters'}
                {activeFilters.length > 0 && (
                  <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-stone-800 text-white rounded-full">
                    {activeFilters.length}
                  </span>
                )}
              </button>
            </div>

            {/* Active filter badges */}
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {activeFilters.map((f, i) => (
                  <FilterBadge key={i} label={f.label} onRemove={f.clear} />
                ))}
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-xs text-stone-400 hover:text-stone-700 underline underline-offset-2 ml-1"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Expanded filter panel */}
            {filtersOpen && (
              <div className="border border-stone-200 rounded-lg p-4 bg-stone-50 space-y-4">
                {/* Row 1: Basic filters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">NAICS Codes</label>
                    <ChipInput
                      values={naicsCodes}
                      onChange={(next) => {
                        setNaicsCodes(next)
                        applyFiltersWithOverride({ naics: next.join(',') })
                      }}
                      placeholder="e.g., 334519 (Enter to add)"
                      validate={validateNaics}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Agency</label>
                    <input
                      type="text"
                      placeholder="e.g., Defense"
                      value={agencyFilter}
                      onChange={(e) => setAgencyFilter(e.target.value)}

                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Status</label>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
                    >
                      <option value="">All</option>
                      <option value="ACTIVE">Active</option>
                      <option value="EXPIRED">Expired</option>
                      <option value="AWARDED">Awarded</option>
                      <option value="CANCELLED">Cancelled</option>
                      <option value="DISMISSED">Dismissed</option>
                    </select>
                  </div>
                </div>

                {/* Row 2: Advanced filters */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Deadline Window</label>
                    <select
                      value={deadlineDays}
                      onChange={(e) => setDeadlineDays(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
                    >
                      {DEADLINE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Assessment</label>
                    <select
                      value={recommendation}
                      onChange={(e) => setRecommendation(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
                    >
                      <option value="">Any assessment</option>
                      <option value="GO">GO</option>
                      <option value="REVIEW">REVIEW</option>
                      <option value="NO_GO">NO GO</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Has SOW</label>
                    <select
                      value={hasSOW}
                      onChange={(e) => setHasSOW(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
                    >
                      <option value="">Any</option>
                      <option value="yes">Has SOW</option>
                      <option value="no">No SOW</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Has Bid</label>
                    <select
                      value={hasBid}
                      onChange={(e) => setHasBid(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
                    >
                      <option value="">Any</option>
                      <option value="yes">Has Bid</option>
                      <option value="no">No Bid</option>
                    </select>
                  </div>
                </div>

                {/* Row 3: Margin range */}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-36">
                    <label className="block text-xs font-medium text-stone-600 mb-1">Min Margin %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="0"
                      value={minMargin}
                      onChange={(e) => setMinMargin(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
                    />
                  </div>
                  <div className="w-36">
                    <label className="block text-xs font-medium text-stone-600 mb-1">Max Margin %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="100"
                      value={maxMargin}
                      onChange={(e) => setMaxMargin(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
                    />
                  </div>
                  <div className="flex gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="px-4 py-2 text-sm font-medium text-stone-600 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
                    >
                      Reset
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors"
                    >
                      Apply Filters
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="bg-stone-50 border border-stone-300 text-stone-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-stone-600"></div>
            <p className="mt-4 text-stone-500">Loading opportunities...</p>
          </div>
        ) : opportunities.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-stone-500 text-lg">No opportunities found in your library</p>
            <p className="text-stone-400 mt-2 text-sm">Try adjusting your filters or search SAM.gov directly</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {(searchParams.get('search') || searchParams.get('naics')) && (
                <button
                  onClick={handleLiveSamSearch}
                  disabled={searchingSam}
                  className="px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
                >
                  {searchingSam ? (
                    <>
                      <span className="inline-block animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></span>
                      Searching SAM.gov...
                    </>
                  ) : (
                    <>Search SAM.gov live for &ldquo;{searchParams.get('search') || `NAICS ${searchParams.get('naics')}`}&rdquo;</>
                  )}
                </button>
              )}
              {activeFilters.length > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="px-4 py-2 text-sm font-medium text-stone-600 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
                >
                  Clear all filters
                </button>
              )}
            </div>
            {samSearchResult && (
              <p className="mt-4 text-sm text-stone-600">{samSearchResult}</p>
            )}
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm text-stone-500">
                Showing <span className="font-medium text-stone-800">{opportunities.length}</span> of{' '}
                <span className="font-medium text-stone-800">{pagination.total}</span> opportunities
              </p>
            </div>

            <div className="grid gap-5">
              {opportunities.map((opp) => (
                <OpportunityCard
                  key={opp.id}
                  opportunity={opp}
                  onDismissed={handleDismissed}
                  onRestored={handleRestored}
                />
              ))}
            </div>

            {pagination.totalPages > 1 && (
              <div className="mt-8 flex justify-center items-center gap-2">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-4 py-2 text-sm font-medium text-stone-600 border border-stone-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-50 transition-colors"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-sm text-stone-600">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="px-4 py-2 text-sm font-medium text-stone-600 border border-stone-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-50 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-500">Loading...</p>
        </div>
      </div>
    }>
      <OpportunitiesContent />
    </Suspense>
  )
}
