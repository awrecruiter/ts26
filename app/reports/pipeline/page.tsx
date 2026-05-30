"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface StageData {
  stage: string
  count: number
  totalValue: number
  opportunities: Array<{
    id: string
    title: string
    solicitationNumber: string
    estimatedValue: number | null
  }>
}

interface PipelineData {
  stages: StageData[]
  totalOpportunities: number
  totalPipelineValue: number
}

const STAGE_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery',
  ASSESSMENT: 'Assessment',
  SOW_CREATION: 'SOW Creation',
  SOW_REVIEW: 'SOW Review',
  BID_ASSEMBLY: 'Bid Assembly',
  READY: 'Ready to Submit',
  SUBMITTED: 'Submitted',
}

const STAGE_COLORS: Record<string, string> = {
  DISCOVERY: 'bg-stone-100 border-stone-300',
  ASSESSMENT: 'bg-stone-100 border-stone-300',
  SOW_CREATION: 'bg-stone-200 border-stone-400',
  SOW_REVIEW: 'bg-stone-100 border-stone-300',
  BID_ASSEMBLY: 'bg-stone-200 border-stone-400',
  READY: 'bg-stone-300 border-stone-500',
  SUBMITTED: 'bg-stone-800 border-stone-900',
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`
  } else if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(0)}K`
  }
  return `$${amount.toFixed(0)}`
}

export default function PipelineReportPage() {
  const router = useRouter()
  const [data, setData] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedStage, setExpandedStage] = useState<string | null>(null)

  useEffect(() => {
    fetchPipelineData()
  }, [])

  const fetchPipelineData = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/reports/pipeline')
      if (!response.ok) throw new Error('Failed to fetch pipeline data')
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
            <h1 className="text-3xl font-bold text-stone-900">Pipeline Report</h1>
            <p className="mt-2 text-sm text-stone-600">
              Opportunities by stage in the bid pipeline
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
            <p className="mt-4 text-stone-600">Loading pipeline data...</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-stone-50 border border-stone-200 rounded-md">
            <p className="text-stone-700">{error}</p>
            <button
              onClick={() => { setError(''); fetchPipelineData(); }}
              className="mt-2 text-sm text-stone-600 underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                  Total Opportunities
                </h3>
                <p className="text-3xl font-bold text-stone-900 mt-2">
                  {data.totalOpportunities}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                  Total Pipeline Value
                </h3>
                <p className="text-3xl font-bold text-stone-900 mt-2">
                  {formatCurrency(data.totalPipelineValue)}
                </p>
              </div>
            </div>

            {/* Pipeline Stages */}
            <div className="space-y-4">
              {data.stages.map((stageData) => (
                <div
                  key={stageData.stage}
                  className={`bg-white rounded-lg shadow-sm border-l-4 ${
                    STAGE_COLORS[stageData.stage] || 'border-stone-300'
                  }`}
                >
                  <div
                    className="p-6 cursor-pointer"
                    onClick={() =>
                      setExpandedStage(
                        expandedStage === stageData.stage ? null : stageData.stage
                      )
                    }
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        <div>
                          <h3 className="text-lg font-semibold text-stone-900">
                            {STAGE_LABELS[stageData.stage] || stageData.stage}
                          </h3>
                          <p className="text-sm text-stone-500">
                            {stageData.count} opportunit{stageData.count === 1 ? 'y' : 'ies'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-lg font-semibold text-stone-900">
                            {formatCurrency(stageData.totalValue)}
                          </p>
                          <p className="text-sm text-stone-500">Total Value</p>
                        </div>
                        <svg
                          className={`h-5 w-5 text-stone-400 transition-transform ${
                            expandedStage === stageData.stage ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </div>
                    </div>

                    {/* Progress bar showing percentage of total */}
                    <div className="mt-4">
                      <div className="h-2 bg-stone-200 rounded-full">
                        <div
                          className="h-2 bg-stone-600 rounded-full transition-all"
                          style={{
                            width: `${
                              data.totalOpportunities > 0
                                ? (stageData.count / data.totalOpportunities) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expanded opportunity list */}
                  {expandedStage === stageData.stage && stageData.opportunities.length > 0 && (
                    <div className="border-t border-stone-200 px-6 py-4">
                      <table className="min-w-full">
                        <thead>
                          <tr className="text-xs text-stone-500 uppercase tracking-wider">
                            <th className="text-left pb-2">Opportunity</th>
                            <th className="text-left pb-2">Solicitation #</th>
                            <th className="text-right pb-2">Est. Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {stageData.opportunities.map((opp) => (
                            <tr
                              key={opp.id}
                              className="hover:bg-stone-50 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/opportunities/${opp.id}`)
                              }}
                            >
                              <td className="py-2 text-sm text-stone-900">
                                {opp.title}
                              </td>
                              <td className="py-2 text-sm text-stone-500">
                                {opp.solicitationNumber}
                              </td>
                              <td className="py-2 text-sm text-stone-900 text-right">
                                {opp.estimatedValue
                                  ? formatCurrency(opp.estimatedValue)
                                  : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
