'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MarginBands, PricingSheet, ResourcePlan } from '@/lib/types/resource-plan'
import { DEFAULT_MARGIN_BANDS } from '@/lib/types/resource-plan'
import { computePricingSheet } from '@/lib/pricing'

interface PricingSheetCardProps {
  sheet: PricingSheet | null
  plan: ResourcePlan | null
  onUpdate: (patch: { userOverrideMarginPct?: number | null; marginBands?: MarginBands }) => void
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function formatCurrency(value: number): string {
  return currencyFormatter.format(value)
}

function riskDotClass(riskScore: number): string {
  if (riskScore <= 33) return 'bg-stone-500'
  if (riskScore <= 66) return 'bg-amber-500'
  return 'bg-stone-800'
}

export default function PricingSheetCard({ sheet, plan, onUpdate }: PricingSheetCardProps) {
  const hasData = sheet !== null && plan !== null

  const initialSliderValue = sheet?.userOverrideMarginPct ?? sheet?.targetMarginPct ?? 0
  const [sliderValue, setSliderValue] = useState<number>(initialSliderValue)

  const [lowInput, setLowInput] = useState<string>(
    (sheet?.marginBands.low ?? DEFAULT_MARGIN_BANDS.low).toString(),
  )
  const [mediumInput, setMediumInput] = useState<string>(
    (sheet?.marginBands.medium ?? DEFAULT_MARGIN_BANDS.medium).toString(),
  )
  const [highInput, setHighInput] = useState<string>(
    (sheet?.marginBands.high ?? DEFAULT_MARGIN_BANDS.high).toString(),
  )

  // Keep local slider in sync when a fresh sheet arrives from the server
  useEffect(() => {
    if (sheet) {
      setSliderValue(sheet.userOverrideMarginPct ?? sheet.targetMarginPct)
      setLowInput(sheet.marginBands.low.toString())
      setMediumInput(sheet.marginBands.medium.toString())
      setHighInput(sheet.marginBands.high.toString())
    }
  }, [sheet])

  // Live-preview recomputation on drag — local only, no network
  const preview = useMemo(() => {
    if (!plan || !sheet) return null
    return computePricingSheet(plan, sheet.marginBands, sliderValue)
  }, [plan, sheet, sliderValue])

  if (!hasData) {
    return (
      <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-stone-800">Pricing Sheet</h2>
          <span className="text-xs text-stone-500">Auto-computed from Resource Plan</span>
        </div>
        <p className="text-sm italic text-stone-500">
          Generate the resource plan to see pricing.
        </p>
      </div>
    )
  }

  // Narrowing helpers — hasData already guarantees non-null, but TS needs the hint
  const currentSheet = sheet
  const currentPlan = plan

  const commitSlider = () => {
    onUpdate({ userOverrideMarginPct: sliderValue })
  }

  const commitBands = () => {
    const parsedLow = Number.parseFloat(lowInput)
    const parsedMedium = Number.parseFloat(mediumInput)
    const parsedHigh = Number.parseFloat(highInput)
    if (
      Number.isFinite(parsedLow) &&
      Number.isFinite(parsedMedium) &&
      Number.isFinite(parsedHigh)
    ) {
      onUpdate({
        marginBands: { low: parsedLow, medium: parsedMedium, high: parsedHigh },
      })
    }
  }

  const resetBands = () => {
    setLowInput(DEFAULT_MARGIN_BANDS.low.toString())
    setMediumInput(DEFAULT_MARGIN_BANDS.medium.toString())
    setHighInput(DEFAULT_MARGIN_BANDS.high.toString())
    onUpdate({ marginBands: { ...DEFAULT_MARGIN_BANDS } })
  }

  const resetOverride = () => {
    onUpdate({ userOverrideMarginPct: null })
  }

  const hasOverride = currentSheet.userOverrideMarginPct !== null && currentSheet.userOverrideMarginPct !== undefined

  const counts = currentPlan.lines.reduce(
    (acc, line) => {
      if (line.category === 'professional') acc.professional += 1
      else if (line.category === 'subcontracted_trade') acc.trades += 1
      else if (line.category === 'material' || line.category === 'equipment') acc.materials += 1
      else if (line.category === 'prime_overhead') acc.overhead += 1
      return acc
    },
    { professional: 0, trades: 0, materials: 0, overhead: 0 },
  )

  const totalLines = currentPlan.lines.length

  const appliedMargin = preview?.targetMarginPct ?? sliderValue
  const previewBid = preview?.recommendedBidPrice ?? currentSheet.recommendedBidPrice

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-stone-800">Pricing Sheet</h2>
        <span className="text-xs text-stone-500">Auto-computed from Resource Plan</span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div>
          <div className="text-xs text-stone-500 mb-1">Cost basis</div>
          <div className="text-lg font-semibold text-stone-900 tabular-nums">
            {formatCurrency(currentSheet.costBasisTotal)}
          </div>
        </div>
        <div>
          <div className="text-xs text-stone-500 mb-1">Aggregate risk</div>
          <div className="text-lg font-semibold text-stone-900 tabular-nums flex items-center gap-2">
            <span>{currentSheet.riskScore}</span>
            <span
              className={`inline-block w-2 h-2 rounded-full ${riskDotClass(currentSheet.riskScore)}`}
              aria-hidden="true"
            />
          </div>
        </div>
        <div>
          <div className="text-xs text-stone-500 mb-1">Target margin</div>
          <div className="text-lg font-semibold text-stone-900 tabular-nums">
            {currentSheet.targetMarginPct.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-stone-500 mb-1">Recommended bid</div>
          <div className="text-lg font-semibold text-stone-900 tabular-nums">
            {formatCurrency(currentSheet.recommendedBidPrice)}
          </div>
        </div>
      </div>

      {/* Slider block */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="pricing-margin-slider" className="text-xs text-stone-500">
            Adjust margin
          </label>
          {hasOverride && (
            <button
              type="button"
              onClick={resetOverride}
              className="text-xs text-stone-600 hover:text-stone-900 underline"
            >
              Reset to algorithm
            </button>
          )}
        </div>
        <input
          id="pricing-margin-slider"
          type="range"
          min={0}
          max={50}
          step={0.5}
          value={sliderValue}
          onChange={(e) => setSliderValue(Number.parseFloat(e.target.value))}
          onMouseUp={commitSlider}
          onTouchEnd={commitSlider}
          onKeyUp={commitSlider}
          className="w-full accent-stone-800"
        />
        <div className="text-xs text-stone-500 mt-1 tabular-nums">
          Applied margin: {appliedMargin.toFixed(1)}% → Recommended bid: {formatCurrency(previewBid)}
        </div>
      </div>

      {/* Margin band editor */}
      <div className="mb-6">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label htmlFor="band-low" className="block text-xs text-stone-500 mb-1">
              Low %
            </label>
            <input
              id="band-low"
              type="number"
              step={0.5}
              value={lowInput}
              onChange={(e) => setLowInput(e.target.value)}
              onBlur={commitBands}
              className="w-28 border border-stone-200 rounded px-2 py-1 text-sm text-stone-900 tabular-nums focus:outline-none focus:border-stone-500"
            />
          </div>
          <div>
            <label htmlFor="band-medium" className="block text-xs text-stone-500 mb-1">
              Medium %
            </label>
            <input
              id="band-medium"
              type="number"
              step={0.5}
              value={mediumInput}
              onChange={(e) => setMediumInput(e.target.value)}
              onBlur={commitBands}
              className="w-28 border border-stone-200 rounded px-2 py-1 text-sm text-stone-900 tabular-nums focus:outline-none focus:border-stone-500"
            />
          </div>
          <div>
            <label htmlFor="band-high" className="block text-xs text-stone-500 mb-1">
              High %
            </label>
            <input
              id="band-high"
              type="number"
              step={0.5}
              value={highInput}
              onChange={(e) => setHighInput(e.target.value)}
              onBlur={commitBands}
              className="w-28 border border-stone-200 rounded px-2 py-1 text-sm text-stone-900 tabular-nums focus:outline-none focus:border-stone-500"
            />
          </div>
          <button
            type="button"
            onClick={resetBands}
            className="text-xs text-stone-600 hover:text-stone-900 underline pb-1"
          >
            Reset defaults
          </button>
        </div>
      </div>

      {/* Line-count summary */}
      <div className="text-xs text-stone-500 tabular-nums">
        {totalLines} lines · {counts.professional} professional · {counts.trades} trades ·{' '}
        {counts.materials} materials/equipment · {counts.overhead} overhead
      </div>
    </div>
  )
}
