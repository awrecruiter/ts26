'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiStatusResult {
  name: string
  status: 'ok' | 'error' | 'unconfigured'
  latencyMs?: number
  error?: string
}

interface ApiStatusResponse {
  results: ApiStatusResult[]
  checkedAt: string
}

interface CalcDrift {
  recordId: string
  recordType: 'OpportunityAssessment' | 'Bid'
  field: string
  storedValue: number
  expectedValue: number
  drift: number
}

interface CalcAuditResponse {
  drifts: CalcDrift[]
  sampledAssessments: number
  sampledBids: number
  auditedAt: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'ok' | 'error' | 'unconfigured' }) {
  if (status === 'ok') {
    return (
      <span className="inline-block w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-block w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
    )
  }
  return (
    <span className="inline-block w-3 h-3 rounded-full bg-stone-300 flex-shrink-0" />
  )
}

function statusLabel(status: 'ok' | 'error' | 'unconfigured'): string {
  if (status === 'ok') return 'OK'
  if (status === 'error') return 'Error'
  return 'Not configured'
}

function statusTextColor(status: 'ok' | 'error' | 'unconfigured'): string {
  if (status === 'ok') return 'text-green-700'
  if (status === 'error') return 'text-red-700'
  return 'text-stone-500'
}

function formatLatency(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatFieldName(field: string): string {
  const map: Record<string, string> = {
    profitMarginDollar: 'Profit Margin ($)',
    profitMarginPercent: 'Profit Margin (%)',
    meetsMarginTarget: 'Meets Margin Target',
    grossMargin: 'Gross Margin (%)',
  }
  return map[field] ?? field
}

function formatValue(field: string, value: number): string {
  if (field === 'meetsMarginTarget') return value === 1 ? 'true' : 'false'
  if (field === 'profitMarginDollar') {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `${value.toFixed(4)}`
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ApiStatusPage() {
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()

  const [apiStatus, setApiStatus] = useState<ApiStatusResponse | null>(null)
  const [calcAudit, setCalcAudit] = useState<CalcAuditResponse | null>(null)
  const [apiLoading, setApiLoading] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/login')
    } else if (
      sessionStatus === 'authenticated' &&
      session?.user?.role !== 'ADMIN'
    ) {
      router.push('/dashboard')
    }
  }, [sessionStatus, session, router])

  const fetchApiStatus = useCallback(async () => {
    setApiLoading(true)
    setApiError(null)
    try {
      const res = await fetch('/api/admin/api-status')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      const data: ApiStatusResponse = await res.json()
      setApiStatus(data)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to fetch API status')
    } finally {
      setApiLoading(false)
    }
  }, [])

  const fetchCalcAudit = useCallback(async () => {
    setAuditLoading(true)
    setAuditError(null)
    try {
      const res = await fetch('/api/admin/calc-audit')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      const data: CalcAuditResponse = await res.json()
      setCalcAudit(data)
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to fetch audit')
    } finally {
      setAuditLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchApiStatus(), fetchCalcAudit()])
    setLastRefreshed(new Date())
  }, [fetchApiStatus, fetchCalcAudit])

  // Initial load
  useEffect(() => {
    if (sessionStatus === 'authenticated' && session?.user?.role === 'ADMIN') {
      refreshAll()
    }
  }, [sessionStatus, session, refreshAll])

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (sessionStatus !== 'authenticated' || session?.user?.role !== 'ADMIN') return
    const interval = setInterval(refreshAll, 60_000)
    return () => clearInterval(interval)
  }, [sessionStatus, session, refreshAll])

  if (sessionStatus === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-stone-600" />
          <p className="mt-4 text-stone-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (sessionStatus === 'authenticated' && session?.user?.role !== 'ADMIN') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-stone-900 mb-2">Access Denied</h1>
          <p className="text-stone-600 mb-4">You must be an administrator to view this page.</p>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  const isRefreshing = apiLoading || auditLoading

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Link
                  href="/admin"
                  className="text-sm text-stone-500 hover:text-stone-700"
                >
                  Admin
                </Link>
                <span className="text-stone-300">/</span>
                <span className="text-sm text-stone-700">API Status</span>
              </div>
              <h1 className="text-2xl font-bold text-stone-900">API Status Viewer</h1>
              <p className="mt-1 text-sm text-stone-500">
                Live health checks for all external integrations and calculation audit.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={refreshAll}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded-md hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {isRefreshing ? 'Checking...' : 'Refresh now'}
              </button>
              {lastRefreshed && (
                <p className="text-xs text-stone-400">
                  Last refreshed: {lastRefreshed.toLocaleTimeString()} · auto every 60s
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* ── API Health Cards ─────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-stone-900">External API Health</h2>
            {apiStatus?.checkedAt && (
              <span className="text-xs text-stone-400">
                Checked at {new Date(apiStatus.checkedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {apiError && (
            <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {apiError}
            </div>
          )}

          {apiLoading && !apiStatus && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white border border-stone-200 rounded-lg p-4 animate-pulse"
                >
                  <div className="h-4 bg-stone-100 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-stone-100 rounded w-1/3" />
                </div>
              ))}
            </div>
          )}

          {apiStatus && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {apiStatus.results.map((api) => (
                <div
                  key={api.name}
                  className="bg-white border border-stone-200 rounded-lg p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <StatusDot status={api.status} />
                    <span className="font-medium text-stone-900 text-sm">{api.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${statusTextColor(api.status)}`}>
                      {statusLabel(api.status)}
                    </span>
                    {api.latencyMs != null && (
                      <span className="text-xs text-stone-400">{formatLatency(api.latencyMs)}</span>
                    )}
                  </div>
                  {api.error && (
                    <p className="mt-2 text-xs text-stone-500 break-words">{api.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Calculation Audit ─────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Calculation Audit</h2>
              {calcAudit && (
                <p className="text-xs text-stone-500 mt-0.5">
                  Sampled {calcAudit.sampledAssessments} assessments and{' '}
                  {calcAudit.sampledBids} bids — flagging drift &gt; 0.01
                </p>
              )}
            </div>
            {calcAudit?.auditedAt && (
              <span className="text-xs text-stone-400">
                Audited at {new Date(calcAudit.auditedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {auditError && (
            <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {auditError}
            </div>
          )}

          {auditLoading && !calcAudit && (
            <div className="bg-white border border-stone-200 rounded-lg p-6 animate-pulse">
              <div className="h-4 bg-stone-100 rounded w-1/3 mb-4" />
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-3 bg-stone-100 rounded" />
                ))}
              </div>
            </div>
          )}

          {calcAudit && calcAudit.drifts.length === 0 && (
            <div className="bg-white border border-stone-200 rounded-lg p-6 flex items-center gap-3">
              <span className="inline-block w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
              <p className="text-sm text-stone-700">
                No calculation drift detected across {calcAudit.sampledAssessments} assessments
                and {calcAudit.sampledBids} bids.
              </p>
            </div>
          )}

          {calcAudit && calcAudit.drifts.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
                <span className="text-sm font-medium text-stone-800">
                  {calcAudit.drifts.length} drift{calcAudit.drifts.length !== 1 ? 's' : ''} detected
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100">
                      <th className="text-left px-4 py-3 font-medium text-stone-500 text-xs uppercase tracking-wide">
                        Record ID
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-stone-500 text-xs uppercase tracking-wide">
                        Type
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-stone-500 text-xs uppercase tracking-wide">
                        Field
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-stone-500 text-xs uppercase tracking-wide">
                        Stored
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-stone-500 text-xs uppercase tracking-wide">
                        Expected
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-stone-500 text-xs uppercase tracking-wide">
                        Drift
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcAudit.drifts.map((d, i) => (
                      <tr
                        key={`${d.recordId}-${d.field}`}
                        className={`border-b border-stone-50 ${i % 2 === 0 ? '' : 'bg-stone-50'}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-stone-500 max-w-[120px] truncate">
                          {d.recordId}
                        </td>
                        <td className="px-4 py-3 text-stone-700">
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-600">
                            {d.recordType === 'OpportunityAssessment' ? 'Assessment' : 'Bid'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-stone-800">{formatFieldName(d.field)}</td>
                        <td className="px-4 py-3 text-right font-mono text-stone-700">
                          {formatValue(d.field, d.storedValue)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-stone-700">
                          {formatValue(d.field, d.expectedValue)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-red-600 text-xs">
                            {d.field === 'meetsMarginTarget'
                              ? 'boolean mismatch'
                              : `+${d.drift.toFixed(4)}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* ── Legend ──────────────────────────────────────────────────────── */}
        <section className="bg-stone-50 border border-stone-200 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">
            Legend
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-stone-600">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
              <span>OK — API is reachable and responding normally</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
              <span>Error — API returned a non-2xx response or timed out</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-stone-300" />
              <span>Not configured — env var missing or placeholder</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-stone-500">
            OpenAI, Google Places, Vercel Blob, and SMTP checks are env-var only (no live
            network call). SAM.gov and USASpending perform a real lightweight probe.
            Latency is shown only for live network calls.
          </p>
        </section>

      </div>
    </div>
  )
}
