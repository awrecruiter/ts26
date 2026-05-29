'use client'

import { useState } from 'react'

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
  assessedBy?: {
    name: string
    email: string
  }
  assessedAt?: string
}

interface MarginCalculatorProps {
  opportunityId: string
  existingAssessment?: Assessment | null
  /** Pre-seed the value field from SAM.gov rawData (awardCeiling / estimatedTotalValue) */
  opportunityValue?: number | null
  /** Source label shown beneath the pre-seeded value */
  opportunityValueSource?: string
  onSave: (assessment: Assessment) => Promise<void>
}

/**
 * Extract the best available contract value from SAM.gov rawData.
 * SAM.gov v2 API stores monetary values inside an `award` object or at the top level.
 * Tries the most-specific field first and falls back down the chain.
 */
export function extractOpportunityValue(rawData: unknown): { value: number | null; source: string } {
  if (!rawData || typeof rawData !== 'object') return { value: null, source: '' }
  const raw = rawData as Record<string, unknown>

  // SAM.gov v2 — award object
  const award = raw.award && typeof raw.award === 'object' ? raw.award as Record<string, unknown> : null
  if (award) {
    const ceiling = Number(award.ceiling ?? award.base_and_all_options_value ?? award.awardCeiling)
    if (ceiling > 0) return { value: ceiling, source: 'SAM.gov award ceiling' }
    const amount = Number(award.amount ?? award.base_and_exercised_options_value)
    if (amount > 0) return { value: amount, source: 'SAM.gov award amount' }
  }

  // Top-level fields used by older SAM.gov API versions
  const topLevel = Number(
    raw.estimatedTotalValue ??
    raw.awardCeiling ??
    raw.baseAndAllOptionsValue ??
    raw.totalContractValue
  )
  if (topLevel > 0) return { value: topLevel, source: 'SAM.gov estimated value' }

  return { value: null, source: '' }
}

export default function MarginCalculator({
  opportunityId: _opportunityId,
  existingAssessment,
  opportunityValue,
  opportunityValueSource,
  onSave,
}: MarginCalculatorProps) {
  // Seed estimatedValue: existing assessment > SAM.gov value > blank
  const seedValue =
    existingAssessment?.estimatedValue?.toString() ||
    (opportunityValue && opportunityValue > 0 ? opportunityValue.toString() : '')

  const [estimatedValue, setEstimatedValue] = useState<string>(seedValue)
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(
    existingAssessment?.assessedAt ? new Date(existingAssessment.assessedAt) : null
  )

  // Calculate margins
  const value = parseFloat(estimatedValue) || 0
  const cost = parseFloat(estimatedCost) || 0
  const profitDollar = value - cost
  const profitPercent = value > 0 ? (profitDollar / value) * 100 : 0

  // Distinct visual tiers: good (≥20%) / marginal (10–20%) / low (<10%)
  const marginTier: 'none' | 'good' | 'marginal' | 'low' =
    value === 0 && cost === 0 ? 'none'
    : profitPercent >= 20 ? 'good'
    : profitPercent >= 10 ? 'marginal'
    : 'low'

  const marginBg: Record<string, string> = {
    none:     'bg-stone-50 border-stone-200',
    good:     'bg-stone-50 border-stone-300',
    marginal: 'bg-stone-100 border-stone-300',
    low:      'bg-stone-200 border-stone-400',
  }

  const marginValueColor: Record<string, string> = {
    none:     'text-stone-500',
    good:     'text-stone-800',
    marginal: 'text-stone-700',
    low:      'text-stone-600',
  }

  const recommendationStyle: Record<string, { text: string; bg: string; color: string }> = {
    good:     { text: 'GO',     bg: 'bg-stone-800', color: 'text-white' },
    marginal: { text: 'REVIEW', bg: 'bg-stone-300', color: 'text-stone-800' },
    low:      { text: 'NO GO',  bg: 'bg-stone-200', color: 'text-stone-700' },
    none:     { text: '—',      bg: 'bg-stone-100', color: 'text-stone-400' },
  }

  const rec = recommendationStyle[marginTier]

  // Whether the value field was auto-seeded from SAM.gov (not yet manually confirmed)
  const valueWasSeeded =
    !existingAssessment?.estimatedValue &&
    !!opportunityValue &&
    opportunityValue > 0 &&
    estimatedValue === opportunityValue.toString()

  const isDirty =
    estimatedValue !== seedValue ||
    estimatedCost !== (existingAssessment?.estimatedCost && existingAssessment.estimatedCost > 0
      ? existingAssessment.estimatedCost.toString()
      : '') ||
    strategicValue !== (existingAssessment?.strategicValue || 'MEDIUM') ||
    riskLevel !== (existingAssessment?.riskLevel || 'MEDIUM') ||
    notes !== (existingAssessment?.notes || '')

  const handleSave = async () => {
    const parsedValue = parseFloat(estimatedValue)
    const parsedCost = parseFloat(estimatedCost)

    if (!estimatedValue || isNaN(parsedValue) || parsedValue <= 0) {
      setSaveError('Enter a contract value greater than zero')
      return
    }
    if (estimatedCost !== '' && (isNaN(parsedCost) || parsedCost < 0)) {
      setSaveError('Cost must be zero or greater')
      return
    }

    setSaveError(null)
    setSaving(true)
    try {
      await onSave({
        estimatedValue: parsedValue,
        estimatedCost: isNaN(parsedCost) ? 0 : parsedCost,
        strategicValue: strategicValue as 'HIGH' | 'MEDIUM' | 'LOW',
        riskLevel: riskLevel as 'HIGH' | 'MEDIUM' | 'LOW',
        notes,
      })
      setSavedAt(new Date())
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-800">Margin Assessment</h3>
        {savedAt && !isDirty && (
          <span className="text-[10px] text-stone-400">
            Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {isDirty && (
          <span className="text-[10px] text-stone-400 italic">Unsaved changes</span>
        )}
      </div>

      <div className="p-5">
        {/* Calculator Inputs */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              Contract Value
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-stone-400 text-sm">$</span>
              <input
                type="number"
                min="0"
                step="any"
                value={estimatedValue}
                onChange={(e) => { setEstimatedValue(e.target.value); setSaveError(null) }}
                placeholder="0"
                className="w-full pl-7 pr-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-transparent"
              />
            </div>
            {valueWasSeeded ? (
              <p className="text-[10px] text-stone-500 mt-1">
                Pre-filled from {opportunityValueSource || 'SAM.gov'} — confirm or adjust
              </p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-1">Total award ceiling from solicitation</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              Your Estimated Cost
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-stone-400 text-sm">$</span>
              <input
                type="number"
                min="0"
                step="any"
                value={estimatedCost}
                onChange={(e) => { setEstimatedCost(e.target.value); setSaveError(null) }}
                placeholder="0"
                className="w-full pl-7 pr-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-transparent"
              />
            </div>
            <p className="text-[10px] text-stone-400 mt-1">Labor + materials + subs + overhead</p>
          </div>
        </div>

        {/* Live margin result — only show once at least one value is entered */}
        {(value > 0 || cost > 0) && (
          <div className={`rounded-lg border-2 p-4 mb-5 ${marginBg[marginTier]}`}>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Profit ($)</p>
                <p className={`text-2xl font-bold ${marginValueColor[marginTier]}`}>
                  ${profitDollar.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Margin (%)</p>
                <p className={`text-2xl font-bold ${marginValueColor[marginTier]}`}>
                  {value > 0 ? `${profitPercent.toFixed(1)}%` : '—'}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Decision</p>
                <span className={`inline-block px-3 py-1 rounded text-xs font-bold ${rec.bg} ${rec.color}`}>
                  {rec.text}
                </span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-stone-200 flex items-center gap-4 text-[10px] text-stone-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-stone-800 inline-block" />
                GO: ≥20%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-stone-400 inline-block" />
                REVIEW: 10–20%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-stone-300 inline-block" />
                NO GO: &lt;10%
              </span>
            </div>
          </div>
        )}

        {/* Additional Factors */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              Strategic Value
            </label>
            <select
              value={strategicValue}
              onChange={(e) => setStrategicValue(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-transparent"
            >
              <option value="HIGH">High — key opportunity</option>
              <option value="MEDIUM">Medium — standard opportunity</option>
              <option value="LOW">Low — limited strategic value</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              Risk Level
            </label>
            <select
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-transparent"
            >
              <option value="LOW">Low — confident we can deliver</option>
              <option value="MEDIUM">Medium — some concerns</option>
              <option value="HIGH">High — significant challenges</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">
            Notes <span className="font-normal text-stone-400">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Key assumptions, data sources, concerns…"
            className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-transparent resize-none"
          />
        </div>

        {/* Validation error */}
        {saveError && (
          <p className="text-xs text-stone-600 bg-stone-100 border border-stone-300 rounded px-3 py-2 mb-3">
            {saveError}
          </p>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full px-4 py-2.5 bg-stone-800 text-white text-sm rounded-lg font-semibold hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Saving…
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {existingAssessment ? 'Update Assessment' : 'Save Assessment'}
            </>
          )}
        </button>

        {/* Last-saved attribution */}
        {existingAssessment?.assessedAt && !isDirty && (
          <p className="text-[10px] text-stone-400 text-center mt-2">
            Last saved {new Date(existingAssessment.assessedAt).toLocaleString()}
            {existingAssessment.assessedBy ? ` by ${existingAssessment.assessedBy.name}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}
