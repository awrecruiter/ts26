'use client'

import { useCallback, useEffect, useState } from 'react'

interface SubNetRecord {
  id: string
  sourceKey: string
  title: string
  primeName: string | null
  description: string | null
  state: string | null
  naicsCode: string | null
  naicsTitle: string | null
  contactEmail: string | null
  contactRaw: string | null
  closingDate: string | null
  performanceStartDate: string | null
  sourceUrl: string | null
  firstSeenAt: string
  lastSeenAt: string
  removedAt: string | null
}

interface ApiResponse {
  records: SubNetRecord[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  lastScrapedAt: string | null
  lastScrapeSummary: string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  const now = Date.now()
  const hours = Math.round((now - then) / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export default function SubNetPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [naics, setNaics] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (state) params.set('state', state)
      if (naics) params.set('naics', naics)
      params.set('page', String(page))
      const res = await fetch(`/api/subnet?${params.toString()}`)
      if (!res.ok) {
        setError(res.status === 401 ? 'Sign in to view SubNet listings.' : 'Failed to load SubNet data')
        setData(null)
        return
      }
      setData(await res.json())
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }, [search, state, naics, page])

  useEffect(() => { load() }, [load])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    load()
  }

  const clear = () => {
    setSearch(''); setState(''); setNaics(''); setPage(1)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900">SubNet — Primes seeking subs</h1>
        <p className="mt-1 text-sm text-stone-600">
          Scraped nightly from SBA's Subcontracting Network. Prime contractors post here
          when they need subcontractors on a federal contract they've won.{' '}
          <span className="text-stone-500">
            Last refresh: {fmtRelative(data?.lastScrapedAt ?? null)}
            {data?.pagination.total !== undefined && ` · ${data.pagination.total} listings live`}
          </span>
        </p>
      </div>

      <form onSubmit={submit} className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label className="block text-xs font-medium text-stone-600">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title, prime name, or description"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600">State</label>
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="e.g. California"
            className="mt-1 w-40 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600">NAICS</label>
          <input
            value={naics}
            onChange={(e) => setNaics(e.target.value)}
            placeholder="237310 or 2373"
            className="mt-1 w-32 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          Search
        </button>
        {(search || state || naics) && (
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data && <p className="text-sm text-stone-500">Loading…</p>}

      {data && (
        <>
          {data.records.length === 0 ? (
            <div className="rounded-md border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">
              No matching SubNet listings.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Listing</th>
                    <th className="px-4 py-3">Prime</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">NAICS</th>
                    <th className="px-4 py-3">Closes</th>
                    <th className="px-4 py-3">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.records.map((r) => (
                    <tr key={r.id} className="hover:bg-stone-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-stone-900">
                          {r.sourceUrl ? (
                            <a
                              href={r.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-stone-900 hover:text-stone-600 hover:underline"
                            >
                              {r.title}
                            </a>
                          ) : (
                            r.title
                          )}
                        </div>
                        {r.description && (
                          <div className="mt-1 line-clamp-2 text-xs text-stone-600">{r.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-stone-700">{r.primeName || '—'}</td>
                      <td className="px-4 py-3 align-top text-stone-700">{r.state || '—'}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-stone-900">{r.naicsCode || '—'}</div>
                        {r.naicsTitle && <div className="text-xs text-stone-500">{r.naicsTitle}</div>}
                      </td>
                      <td className="px-4 py-3 align-top text-stone-700">{fmtDate(r.closingDate)}</td>
                      <td className="px-4 py-3 align-top">
                        {r.contactEmail ? (
                          <a
                            href={`mailto:${r.contactEmail}`}
                            className="text-stone-900 hover:text-stone-600 hover:underline"
                          >
                            {r.contactEmail}
                          </a>
                        ) : r.contactRaw ? (
                          <span className="text-xs text-stone-600">{r.contactRaw}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.pagination.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-600 disabled:opacity-40 hover:bg-stone-50"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-stone-600">
                Page {data.pagination.page} of {data.pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                disabled={page >= data.pagination.totalPages}
                className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-600 disabled:opacity-40 hover:bg-stone-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
