"use client"

import { useState, useEffect } from 'react'

interface WinRateData {
  summary: {
    totalBids: number
    submittedBids: number
    awardedBids: number
    rejectedBids: number
    winRate: number
    pendingBids: number
  }
  byQuarter: Array<{
    quarter: string
    submitted: number
    awarded: number
    rejected: number
    winRate: number
  }>
  bySize: Array<{
    size: string
    submitted: number
    awarded: number
    rejected: number
    winRate: number
    totalValue: number
  }>
  bySource: Array<{
    source: string
    submitted: number
    awarded: number
    winRate: number
  }>
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`
  } else if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(0)}K`
  }
  return `$${amount.toFixed(0)}`
}

export default function WinRateReportPage() {
  const [data, setData] = useState<WinRateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchWinRateData()
  }, [])

  const fetchWinRateData = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/reports/win-rate')
      if (!response.ok) throw new Error('Failed to fetch win rate data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-3xl font-bold text-stone-900">Win Rate Analysis</h1>
            <p className="mt-2 text-sm text-stone-600">
              Bid success rates and performance metrics
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
            <p className="mt-4 text-stone-600">Loading win rate data...</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-stone-100 border border-stone-400 rounded-md">
            <p className="text-stone-900">{error}</p>
            <button
              onClick={() => { setError(''); fetchWinRateData(); }}
              className="mt-2 text-sm text-stone-900 underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6 mb-8">
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                  Total Bids
                </h3>
                <p className="text-3xl font-bold text-stone-900 mt-2">
                  {data.summary.totalBids}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                  Submitted
                </h3>
                <p className="text-3xl font-bold text-stone-900 mt-2">
                  {data.summary.submittedBids}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                  Awarded
                </h3>
                <p className="text-3xl font-bold text-stone-900 mt-2">
                  {data.summary.awardedBids}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                  Rejected
                </h3>
                <p className="text-3xl font-bold text-stone-900 mt-2">
                  {data.summary.rejectedBids}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6 bg-stone-50">
                <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                  Win Rate
                </h3>
                <p className="text-3xl font-bold text-stone-900 mt-2">
                  {data.summary.winRate.toFixed(1)}%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Win Rate by Quarter */}
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-stone-200">
                  <h2 className="text-lg font-semibold text-stone-900">Win Rate by Quarter</h2>
                </div>
                {data.byQuarter.length > 0 ? (
                  <div className="p-6">
                    <table className="min-w-full">
                      <thead>
                        <tr className="text-xs text-stone-500 uppercase tracking-wider">
                          <th className="text-left pb-3">Quarter</th>
                          <th className="text-center pb-3">Submitted</th>
                          <th className="text-center pb-3">Won</th>
                          <th className="text-center pb-3">Lost</th>
                          <th className="text-right pb-3">Win Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {data.byQuarter.map((q) => (
                          <tr key={q.quarter}>
                            <td className="py-3 text-sm font-medium text-stone-900">
                              {q.quarter}
                            </td>
                            <td className="py-3 text-sm text-stone-600 text-center">
                              {q.submitted}
                            </td>
                            <td className="py-3 text-sm text-stone-900 text-center">
                              {q.awarded}
                            </td>
                            <td className="py-3 text-sm text-stone-900 text-center">
                              {q.rejected}
                            </td>
                            <td className="py-3 text-sm font-medium text-stone-900 text-right">
                              {q.winRate.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-stone-500">
                    No quarterly data available
                  </div>
                )}
              </div>

              {/* Win Rate by Opportunity Size */}
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-stone-200">
                  <h2 className="text-lg font-semibold text-stone-900">Win Rate by Size</h2>
                </div>
                {data.bySize.length > 0 ? (
                  <div className="p-6">
                    <table className="min-w-full">
                      <thead>
                        <tr className="text-xs text-stone-500 uppercase tracking-wider">
                          <th className="text-left pb-3">Size</th>
                          <th className="text-center pb-3">Submitted</th>
                          <th className="text-center pb-3">Won</th>
                          <th className="text-right pb-3">Win Rate</th>
                          <th className="text-right pb-3">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {data.bySize.map((s) => (
                          <tr key={s.size}>
                            <td className="py-3 text-sm font-medium text-stone-900">
                              {s.size}
                            </td>
                            <td className="py-3 text-sm text-stone-600 text-center">
                              {s.submitted}
                            </td>
                            <td className="py-3 text-sm text-stone-900 text-center">
                              {s.awarded}
                            </td>
                            <td className="py-3 text-sm font-medium text-stone-900 text-right">
                              {s.winRate.toFixed(1)}%
                            </td>
                            <td className="py-3 text-sm text-stone-600 text-right">
                              {formatCurrency(s.totalValue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-stone-500">
                    No size data available
                  </div>
                )}
              </div>
            </div>

            {/* Win Rate by Data Source */}
            <div className="mt-8 bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-stone-200">
                <h2 className="text-lg font-semibold text-stone-900">Win Rate by Pricing Source</h2>
                <p className="text-sm text-stone-500">
                  Compare success rates based on how pricing was determined
                </p>
              </div>
              {data.bySource.length > 0 ? (
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {data.bySource.map((s) => (
                      <div
                        key={s.source}
                        className="border border-stone-200 rounded-lg p-4"
                      >
                        <h3 className="text-sm font-medium text-stone-900">
                          {s.source === 'usaspending_api'
                            ? 'Historical Data'
                            : s.source === 'subcontractor_quotes'
                            ? 'Subcontractor Quotes'
                            : s.source === 'cost_based'
                            ? 'Cost Based'
                            : 'Estimated'}
                        </h3>
                        <div className="mt-4 flex justify-between items-end">
                          <div>
                            <p className="text-2xl font-bold text-stone-900">
                              {s.winRate.toFixed(1)}%
                            </p>
                            <p className="text-xs text-stone-500">Win Rate</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-stone-600">
                              {s.awarded} / {s.submitted}
                            </p>
                            <p className="text-xs text-stone-500">Won / Submitted</p>
                          </div>
                        </div>
                        <div className="mt-3">
                          <div className="h-2 bg-stone-200 rounded-full">
                            <div
                              className="h-2 bg-stone-600 rounded-full"
                              style={{ width: `${s.winRate}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-stone-500">
                  No source data available
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
