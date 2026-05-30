'use client'

import { useState } from 'react'

interface HistoricalContract {
  award_id: string
  award_amount: number
  awarding_agency_name: string
  recipient_name: string
  description: string
  period_of_performance_start_date: string
  period_of_performance_current_end_date: string
  naics_code: string
  naics_description: string
}

interface Assessment {
  id?: string
  estimatedValue: number | null
  estimatedCost: number | null
  profitMarginDollar?: number | null
  profitMarginPercent?: number | null
  meetsMarginTarget?: boolean
  strategicValue?: 'HIGH' | 'MEDIUM' | 'LOW' | null
  riskLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | null
  recommendation?: string | null
  notes?: string | null
  historicalData?: HistoricalContract[] | null
  assessedBy?: { name: string; email: string }
  assessedAt?: string
}

interface MarginCalculatorProps {
  opportunityId: string
  existingAssessment?: Assessment | null
  onSave: (assessment: Assessment) => Promise<void>
}

function confidenceFromRiskLevel(riskLevel?: string | null): { label: string; color: string } {
  if (riskLevel === 'LOW') return { label: 'High confidence', color: 'text-green-700 bg-green-50 border-green-200' }
  if (riskLevel === 'MEDIUM') return { label: 'Medium confidence', color: 'text-amber-700 bg-amber-50 border-amber-200' }
  return { label: 'Low confidence', color: 'text-stone-600 bg-stone-100 border-stone-200' }
}

function formatAmount(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`
  return `$${amount.toLocaleString()}`
}

function contractDurationMonths(start: string, end: string): string {
  if (!start || !end) return '—'
  const months = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24 * 30.4)
  )
  return months > 0 ? `${months} mo` : '—'
}

export default function MarginCalculator({ opportunityId, existingAssessment, onSave }: MarginCalculatorProps) {
  const [estimatedValue, setEstimatedValue] = useState<string>(
    existingAssessment?.estimatedValue && existingAssessment.estimatedValue > 0
      ? existingAssessment.estimatedValue.toString()
      : ''
  )
  const [estimatedCost, setEstimatedCost] = useState<string>(
    existingAssessment?.estimatedCost && existingAssessment.estimatedCost > 0
      ? existingAssessment.estimatedCost.toString()
      : ''
  )
  const [strategicValue, setStrategicValue] = useState<string>(
    existingAssessment?.strategicValue || 'MEDIUM'
  )
  const [riskLevel, setRiskLevel] = useState<string>(
    existingAssessment?.riskLevel || 'MEDIUM'
  )
  const [notes, setNotes] = useState(existingAssessment?.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const value = parseFloat(estimatedValue) || 0
  const cost = parseFloat(estimatedCost) || 0
  const profitDollar = value - cost
  const profitPercent = value > 0 ? (profitDollar / value) * 100 : 0

  const marginColor = profitPercent >= 20 ? 'text-green-700' : profitPercent >= 10 ? 'text-amber-700' : 'text-red-700'
  const marginBg = profitPercent >= 20 ? 'bg-green-50 border-green-200' : profitPercent >= 10 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
  const recText = profitPercent >= 20 ? 'GO' : profitPercent >= 10 ? 'REVIEW' : 'NO GO'
  const recColor = profitPercent >= 20 ? 'text-green-700 bg-green-100' : profitPercent >= 10 ? 'text-amber-700 bg-amber-100' : 'text-red-700 bg-red-100'

  const dataSourceNote = existingAssessment?.notes || null
  const isFromUSASpending = dataSourceNote?.includes('USASpending')
  const hasValueFromUSASpending = existingAssessment?.estimatedValue && existingAssessment.estimatedValue > 0
  const noDataAvailable = !hasValueFromUSASpending && !estimatedValue

  const confidence = confidenceFromRiskLevel(existingAssessment?.riskLevel)

  const historicalContracts: HistoricalContract[] = Array.isArray(existingAssessment?.historicalData)
    ? (existingAssessment.historicalData as HistoricalContract[])
    : []

  const handleSave = async () => {
    if (!estimatedValue || !estimatedCost) {
      setError('Enter both estimated value and cost to save')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        estimatedValue: parseFloat(estimatedValue),
        estimatedCost: parseFloat(estimatedCost),
        strategicValue: strategicValue as any,
        riskLevel: riskLevel as any,
        notes,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-stone-50 border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">Margin Assessment</h3>
        {existingAssessment?.assessedAt && (
          <span className="text-xs text-stone-400">
            Updated {new Date(existingAssessment.assessedAt).toLocaleDateString()}
            {existingAssessment.assessedBy && ` · ${existingAssessment.assessedBy.name}`}
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">

        {/* Data source attribution banner */}
        {isFromUSASpending && dataSourceNote && (
          <div className="flex items-start gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2.5">
            <svg className="h-3.5 w-3.5 text-stone-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-stone-600 leading-snug">{dataSourceNote.split('.')[0]}.</p>
              <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${confidence.color}`}>
                {confidence.label}
              </span>
            </div>
          </div>
        )}

        {/* Historical contracts toggle */}
        {historicalContracts.length > 0 && (
          <div className="border border-stone-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center justify-between px-3 py-2 bg-stone-50 hover:bg-stone-100 transition-colors text-left"
            >
              <span className="text-xs font-medium text-stone-700">
                Historical contracts ({historicalContracts.length} found)
              </span>
              <svg
                className={`h-3.5 w-3.5 text-stone-400 transition-transform ${showHistory ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showHistory && (
              <div className="overflow-auto max-h-52">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-stone-200 bg-white">
                      <th className="text-left px-3 py-1.5 font-semibold text-stone-500 uppercase tracking-wider">Awardee</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-stone-500 uppercase tracking-wider">Amount</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-stone-500 uppercase tracking-wider">Duration</th>
                      <th className="text-left px-3 py-1.5 font-semibold text-stone-500 uppercase tracking-wider">Agency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historicalContracts.map((c, i) => (
                      <tr key={c.award_id || i} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                        <td className="px-3 py-1.5 text-stone-800 max-w-[140px] truncate" title={c.recipient_name}>
                          {c.recipient_name}
                        </td>
                        <td className="px-3 py-1.5 text-stone-900 font-medium text-right tabular-nums">
                          {formatAmount(c.award_amount)}
                        </td>
                        <td className="px-3 py-1.5 text-stone-500 text-right tabular-nums">
                          {contractDurationMonths(
                            c.period_of_performance_start_date,
                            c.period_of_performance_current_end_date
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-stone-500 max-w-[120px] truncate" title={c.awarding_agency_name}>
                          {c.awarding_agency_name}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* No data state */}
        {noDataAvailable && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <svg className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-xs text-amber-700 leading-snug">
              Insufficient data — no historical contracts found on USASpending.gov for this NAICS code. Enter a manual estimate below.
            </p>
          </div>
        )}

        {/* Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Contract Value
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                placeholder="0"
                className="w-full pl-7 pr-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
              />
            </div>
            {isFromUSASpending && hasValueFromUSASpending && (
              <p className="text-[10px] text-stone-400 mt-1">Pre-filled from USASpending median</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Your Cost
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                placeholder="0"
                className="w-full pl-7 pr-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none bg-white"
              />
            </div>
          </div>
        </div>

        {/* Calculated results */}
        {(value > 0 && cost > 0) && (
          <div className={`rounded-lg border p-3 ${marginBg}`}>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-0.5">Profit ($)</p>
                <p className={`text-xl font-bold ${marginColor}`}>
                  ${profitDollar.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-0.5">Margin (%)</p>
                <p className={`text-xl font-bold ${marginColor}`}>{profitPercent.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-0.5">Decision</p>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${recColor}`}>{recText}</span>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-stone-200">
              <span className="flex items-center gap-1 text-[10px] text-stone-500"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>Good ≥20%</span>
              <span className="flex items-center gap-1 text-[10px] text-stone-500"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>Review 10–20%</span>
              <span className="flex items-center gap-1 text-[10px] text-stone-500"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>Low &lt;10%</span>
            </div>
          </div>
        )}

        {/* Strategic / Risk */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Strategic Value</label>
            <select
              value={strategicValue}
              onChange={(e) => setStrategicValue(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white"
            >
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Risk Level</label>
            <select
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Assessment notes..."
            className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none bg-white resize-none"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : existingAssessment ? 'Update Assessment' : 'Save Assessment'}
        </button>
      </div>
    </div>
  )
}
