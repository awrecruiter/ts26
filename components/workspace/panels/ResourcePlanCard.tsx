'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  JobDescription,
  ResourceCategory,
  ResourceLine,
  ResourcePlan,
  RiskLevel,
} from '@/lib/types/resource-plan'

interface ResourcePlanCardProps {
  plan: ResourcePlan | null
  isGenerating: boolean
  onGenerate: () => void
  onEditLine: (lineId: string, patch: Partial<ResourceLine>) => void
  onAddLine: (category: ResourceCategory) => void
  onRemoveLine: (lineId: string) => void
  onOpenVendorSearch: (lineId: string) => void
  onUpdateJobDescription: (lineId: string, patch: Partial<JobDescription>) => void
  onRegenerateJobDescription: (lineId: string) => void
  regeneratingJdFor?: string | null
}

const CATEGORY_ORDER: ResourceCategory[] = [
  'professional',
  'subcontracted_trade',
  'material',
  'prime_overhead',
]

const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  professional: 'Professionals',
  subcontracted_trade: 'Subcontracted Trades',
  material: 'Materials & Equipment',
  equipment: 'Materials & Equipment',
  prime_overhead: 'Prime Overhead',
}

const CATEGORY_SHORT: Record<ResourceCategory, string> = {
  professional: 'professional',
  subcontracted_trade: 'trades',
  material: 'materials',
  equipment: 'materials',
  prime_overhead: 'overhead',
}

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high']

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
}

function formatCurrency(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

// -------------------- Icons --------------------

function CategoryIcon({ category }: { category: ResourceCategory }) {
  const base = 'h-3.5 w-3.5 text-stone-500'
  switch (category) {
    case 'professional':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
        </svg>
      )
    case 'subcontracted_trade':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 20V9l8-5 8 5v11" />
          <path d="M9 20v-6h6v6" />
        </svg>
      )
    case 'material':
    case 'equipment':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 12l9 4 9-4" />
          <path d="M3 17l9 4 9-4" />
        </svg>
      )
    case 'prime_overhead':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      )
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 text-stone-500 transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg className="h-4 w-4 text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="6" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="18" r="1" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  )
}

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// -------------------- Risk Chip --------------------

function RiskChip({ level }: { level: RiskLevel }) {
  const cls =
    level === 'high'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-stone-100 text-stone-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {RISK_LABELS[level]}
    </span>
  )
}

// -------------------- Overflow Menu --------------------

interface OverflowMenuProps {
  line: ResourceLine
  onEdit: () => void
  onChangeRisk: (risk: RiskLevel) => void
  onFindVendors: () => void
  onRemove: () => void
}

function OverflowMenu({ line, onEdit, onChangeRisk, onFindVendors, onRemove }: OverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const [riskOpen, setRiskOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setRiskOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const canFindVendors =
    line.category === 'professional' || line.category === 'subcontracted_trade'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setRiskOpen(false)
        }}
        className="p-1 rounded hover:bg-stone-100 transition-colors"
        title="More"
      >
        <DotsIcon />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-white border border-stone-200 rounded shadow-sm py-1 text-sm">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
            className="w-full text-left px-3 py-1.5 text-stone-800 hover:bg-stone-50"
          >
            Edit line
          </button>
          <div
            className="relative"
            onMouseEnter={() => setRiskOpen(true)}
            onMouseLeave={() => setRiskOpen(false)}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-stone-800 hover:bg-stone-50 flex items-center justify-between"
            >
              <span>Change risk</span>
              <span className="text-stone-400">›</span>
            </button>
            {riskOpen && (
              <div className="absolute left-full top-0 -ml-px w-36 bg-white border border-stone-200 rounded shadow-sm py-1">
                {RISK_ORDER.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      onChangeRisk(r)
                      setOpen(false)
                      setRiskOpen(false)
                    }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-stone-50 ${
                      line.riskLevel === r ? 'text-stone-900 font-medium' : 'text-stone-700'
                    }`}
                  >
                    {RISK_LABELS[r]}
                  </button>
                ))}
              </div>
            )}
          </div>
          {canFindVendors && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onFindVendors()
              }}
              className="w-full text-left px-3 py-1.5 text-stone-800 hover:bg-stone-50"
            >
              Find vendors
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onRemove()
            }}
            className="w-full text-left px-3 py-1.5 text-stone-800 hover:bg-stone-50"
          >
            Remove line
          </button>
        </div>
      )}
    </div>
  )
}

// -------------------- Inline Edit Form --------------------

interface LineEditFormProps {
  line: ResourceLine
  onEditLine: (lineId: string, patch: Partial<ResourceLine>) => void
  onClose: () => void
  onSaved: () => void
}

function LineEditForm({ line, onEditLine, onClose, onSaved }: LineEditFormProps) {
  const [label, setLabel] = useState(line.label)
  const [valueDescription, setValueDescription] = useState(line.valueDescription)
  const [quantity, setQuantity] = useState(line.quantity ?? '')
  const [basis, setBasis] = useState(line.basis ?? '')
  const [totalCost, setTotalCost] = useState<string>(
    line.estimatedTotalCost != null ? String(line.estimatedTotalCost) : '',
  )
  const [riskRationale, setRiskRationale] = useState(line.riskRationale ?? '')
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  const saveField = useCallback(
    (patch: Partial<ResourceLine>) => {
      onEditLine(line.id, patch)
      onSaved()
    },
    [line.id, onEditLine, onSaved],
  )

  const inputCls =
    'w-full px-2 py-1 text-sm bg-white border border-stone-200 rounded focus:outline-none focus:border-stone-400'

  return (
    <div
      ref={ref}
      className="mt-2 p-3 bg-stone-50 border border-stone-200 rounded space-y-2"
    >
      <div>
        <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
          Label
        </label>
        <input
          className={inputCls}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== line.label && saveField({ label })}
        />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
          Value description
        </label>
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={valueDescription}
          onChange={(e) => setValueDescription(e.target.value)}
          onBlur={() =>
            valueDescription !== line.valueDescription && saveField({ valueDescription })
          }
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
            Quantity
          </label>
          <input
            className={inputCls}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => quantity !== (line.quantity ?? '') && saveField({ quantity })}
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
            Basis
          </label>
          <input
            className={inputCls}
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            onBlur={() => basis !== (line.basis ?? '') && saveField({ basis })}
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
            Total cost
          </label>
          <input
            className={inputCls}
            inputMode="numeric"
            value={totalCost}
            onChange={(e) => setTotalCost(e.target.value)}
            onBlur={() => {
              const trimmed = totalCost.trim()
              const next: number | null = trimmed === '' ? null : Number(trimmed)
              if (next !== null && Number.isNaN(next)) return
              if (next !== (line.estimatedTotalCost ?? null)) {
                saveField({ estimatedTotalCost: next })
              }
            }}
          />
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
          Risk rationale
        </label>
        <input
          className={inputCls}
          value={riskRationale}
          onChange={(e) => setRiskRationale(e.target.value)}
          onBlur={() =>
            riskRationale !== (line.riskRationale ?? '') && saveField({ riskRationale })
          }
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-stone-500 hover:text-stone-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// -------------------- Job Description Panel --------------------

interface JobDescriptionPanelProps {
  lineId: string
  jd: JobDescription | null | undefined
  onUpdate: (lineId: string, patch: Partial<JobDescription>) => void
  onRegenerate: (lineId: string) => void
  isRegenerating: boolean
}

function formatJdAsText(jd: JobDescription): string {
  const lines: string[] = []
  lines.push(jd.roleTitle)
  if (jd.seniority) lines.push(`Seniority: ${jd.seniority}`)
  lines.push('')
  lines.push('Summary')
  lines.push(jd.summary)
  lines.push('')
  if (jd.responsibilities.length) {
    lines.push('Responsibilities')
    jd.responsibilities.forEach((r) => lines.push(`- ${r}`))
    lines.push('')
  }
  if (jd.requiredQualifications.length) {
    lines.push('Required Qualifications')
    jd.requiredQualifications.forEach((r) => lines.push(`- ${r}`))
    lines.push('')
  }
  if (jd.preferredQualifications && jd.preferredQualifications.length) {
    lines.push('Preferred Qualifications')
    jd.preferredQualifications.forEach((r) => lines.push(`- ${r}`))
    lines.push('')
  }
  lines.push(`Place of Work: ${jd.placeOfWork}`)
  if (jd.schedule) lines.push(`Schedule: ${jd.schedule}`)
  lines.push(`Compensation Basis: ${jd.compensationBasis}`)
  lines.push(`Reporting Line: ${jd.reportingLine}`)
  return lines.join('\n')
}

function BulletListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="group flex items-center gap-1.5">
          <span className="text-stone-400 text-xs shrink-0">•</span>
          <input
            className="flex-1 px-1.5 py-0.5 text-xs bg-transparent border border-transparent rounded hover:border-stone-200 focus:border-stone-300 focus:bg-white focus:outline-none"
            defaultValue={item}
            placeholder={placeholder}
            onBlur={(e) => {
              const next = e.target.value
              if (next !== item) {
                const copy = items.slice()
                copy[i] = next
                onChange(copy)
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              const copy = items.slice()
              copy.splice(i, 1)
              onChange(copy)
            }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-stone-100 transition-opacity"
            title="Remove"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="text-xs text-stone-500 hover:text-stone-800 transition-colors"
      >
        + Add
      </button>
    </div>
  )
}

function JobDescriptionPanel({
  lineId,
  jd,
  onUpdate,
  onRegenerate,
  isRegenerating,
}: JobDescriptionPanelProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!jd) return
    try {
      await navigator.clipboard.writeText(formatJdAsText(jd))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore
    }
  }, [jd])

  if (!jd) {
    return (
      <div className="mt-2 p-3 bg-stone-50 border border-stone-200 rounded text-xs text-stone-500 flex items-center justify-between">
        <span>No job description yet.</span>
        <button
          type="button"
          onClick={() => onRegenerate(lineId)}
          disabled={isRegenerating}
          className="text-stone-700 hover:text-stone-900 disabled:opacity-50 flex items-center gap-1"
        >
          {isRegenerating ? (
            <>
              <Spinner size={3} />
              Generating…
            </>
          ) : (
            'Generate'
          )}
        </button>
      </div>
    )
  }

  const patch = (p: Partial<JobDescription>) => onUpdate(lineId, p)

  const fieldCls =
    'w-full px-1.5 py-0.5 text-xs bg-transparent border border-transparent rounded hover:border-stone-200 focus:border-stone-300 focus:bg-white focus:outline-none'
  const labelCls =
    'block text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-1'

  return (
    <div className="mt-2 p-3 bg-stone-50 border border-stone-200 rounded space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <label className={labelCls}>Role title</label>
          <input
            className={`${fieldCls} text-sm font-semibold text-stone-900`}
            defaultValue={jd.roleTitle}
            onBlur={(e) => e.target.value !== jd.roleTitle && patch({ roleTitle: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-stone-600 hover:text-stone-900 transition-colors"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => onRegenerate(lineId)}
            disabled={isRegenerating}
            className="text-xs text-stone-600 hover:text-stone-900 disabled:opacity-50 flex items-center gap-1"
          >
            {isRegenerating ? (
              <>
                <Spinner size={3} />
                Regenerating…
              </>
            ) : (
              'Regenerate'
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Seniority</label>
          <input
            className={fieldCls}
            defaultValue={jd.seniority ?? ''}
            onBlur={(e) =>
              e.target.value !== (jd.seniority ?? '') && patch({ seniority: e.target.value })
            }
          />
        </div>
        <div>
          <label className={labelCls}>Reporting line</label>
          <input
            className={fieldCls}
            defaultValue={jd.reportingLine}
            onBlur={(e) =>
              e.target.value !== jd.reportingLine && patch({ reportingLine: e.target.value })
            }
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Summary</label>
        <textarea
          className={`${fieldCls} resize-none`}
          rows={2}
          defaultValue={jd.summary}
          onBlur={(e) => e.target.value !== jd.summary && patch({ summary: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls}>Responsibilities</label>
        <BulletListEditor
          items={jd.responsibilities}
          onChange={(next) => patch({ responsibilities: next })}
          placeholder="Add a responsibility"
        />
      </div>

      <div>
        <label className={labelCls}>Required qualifications</label>
        <BulletListEditor
          items={jd.requiredQualifications}
          onChange={(next) => patch({ requiredQualifications: next })}
          placeholder="Add a required qualification"
        />
      </div>

      <div>
        <label className={labelCls}>Preferred qualifications</label>
        <BulletListEditor
          items={jd.preferredQualifications ?? []}
          onChange={(next) => patch({ preferredQualifications: next })}
          placeholder="Add a preferred qualification"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Place of work</label>
          <input
            className={fieldCls}
            defaultValue={jd.placeOfWork}
            onBlur={(e) =>
              e.target.value !== jd.placeOfWork && patch({ placeOfWork: e.target.value })
            }
          />
        </div>
        <div>
          <label className={labelCls}>Schedule</label>
          <input
            className={fieldCls}
            defaultValue={jd.schedule ?? ''}
            onBlur={(e) =>
              e.target.value !== (jd.schedule ?? '') && patch({ schedule: e.target.value })
            }
          />
        </div>
        <div>
          <label className={labelCls}>Compensation basis</label>
          <input
            className={fieldCls}
            defaultValue={jd.compensationBasis}
            onBlur={(e) =>
              e.target.value !== jd.compensationBasis &&
              patch({ compensationBasis: e.target.value })
            }
          />
        </div>
      </div>
    </div>
  )
}

// -------------------- Line Row --------------------

interface LineRowProps {
  line: ResourceLine
  onEditLine: (lineId: string, patch: Partial<ResourceLine>) => void
  onRemoveLine: (lineId: string) => void
  onOpenVendorSearch: (lineId: string) => void
  onUpdateJobDescription: (lineId: string, patch: Partial<JobDescription>) => void
  onRegenerateJobDescription: (lineId: string) => void
  regeneratingJdFor?: string | null
}

function LineRow({
  line,
  onEditLine,
  onRemoveLine,
  onOpenVendorSearch,
  onUpdateJobDescription,
  onRegenerateJobDescription,
  regeneratingJdFor,
}: LineRowProps) {
  const [editing, setEditing] = useState(false)
  const [jdOpen, setJdOpen] = useState(false)
  const [flashSaved, setFlashSaved] = useState(false)

  const isProfessional = line.category === 'professional'

  const handleSaved = useCallback(() => {
    setFlashSaved(true)
    window.setTimeout(() => setFlashSaved(false), 1000)
  }, [])

  const handleChangeRisk = useCallback(
    (risk: RiskLevel) => onEditLine(line.id, { riskLevel: risk }),
    [line.id, onEditLine],
  )

  return (
    <div className="py-3 border-t border-stone-100 first:border-t-0">
      <div className="flex items-start gap-2">
        {/* Chevron slot */}
        <div className="w-4 pt-0.5 shrink-0">
          {isProfessional && (
            <button
              type="button"
              onClick={() => setJdOpen((v) => !v)}
              className="p-0.5 rounded hover:bg-stone-100 transition-colors"
              title={jdOpen ? 'Collapse' : 'Expand job description'}
            >
              <ChevronIcon open={jdOpen} />
            </button>
          )}
        </div>

        {/* Icon */}
        <div className="pt-0.5 shrink-0">
          <CategoryIcon category={line.category} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold text-stone-900">{line.label}</span>
            {flashSaved && (
              <span className="text-[10px] text-stone-500">Saved ✓</span>
            )}
          </div>
          <p className="text-xs text-stone-600 mt-0.5 line-clamp-2">{line.valueDescription}</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {(line.quantity || line.basis) && (
              <span className="text-xs text-stone-500 tabular-nums">
                {[line.quantity, line.basis].filter(Boolean).join(' · ')}
              </span>
            )}
            <RiskChip level={line.riskLevel} />
          </div>
        </div>

        {/* Cost + menu */}
        <div className="flex items-start gap-2 shrink-0">
          <span className="text-sm text-stone-900 tabular-nums pt-0.5">
            {formatCurrency(line.estimatedTotalCost)}
          </span>
          <OverflowMenu
            line={line}
            onEdit={() => setEditing(true)}
            onChangeRisk={handleChangeRisk}
            onFindVendors={() => onOpenVendorSearch(line.id)}
            onRemove={() => onRemoveLine(line.id)}
          />
        </div>
      </div>

      {editing && (
        <LineEditForm
          line={line}
          onEditLine={onEditLine}
          onClose={() => setEditing(false)}
          onSaved={handleSaved}
        />
      )}

      {isProfessional && jdOpen && (
        <JobDescriptionPanel
          lineId={line.id}
          jd={line.jobDescription}
          onUpdate={onUpdateJobDescription}
          onRegenerate={onRegenerateJobDescription}
          isRegenerating={regeneratingJdFor === line.id}
        />
      )}
    </div>
  )
}

// -------------------- Main Card --------------------

export default function ResourcePlanCard({
  plan,
  isGenerating,
  onGenerate,
  onEditLine,
  onAddLine,
  onRemoveLine,
  onOpenVendorSearch,
  onUpdateJobDescription,
  onRegenerateJobDescription,
  regeneratingJdFor = null,
}: ResourcePlanCardProps) {
  const grouped = useMemo(() => {
    const map: Record<ResourceCategory, ResourceLine[]> = {
      professional: [],
      subcontracted_trade: [],
      material: [],
      equipment: [],
      prime_overhead: [],
    }
    if (!plan) return map
    for (const line of plan.lines) {
      if (map[line.category]) {
        map[line.category].push(line)
      }
    }
    return map
  }, [plan])

  // For "Materials & Equipment" merged section
  const materialsMerged = useMemo(
    () => [...grouped.material, ...grouped.equipment],
    [grouped.material, grouped.equipment],
  )

  const totals = useMemo(() => {
    if (!plan) {
      return { total: 0, byCat: { professional: 0, trades: 0, materials: 0, overhead: 0 } }
    }
    return {
      total: plan.lines.length,
      byCat: {
        professional: grouped.professional.length,
        trades: grouped.subcontracted_trade.length,
        materials: materialsMerged.length,
        overhead: grouped.prime_overhead.length,
      },
    }
  }, [plan, grouped, materialsMerged])

  const handleAdd = useCallback(
    (category: ResourceCategory) => onAddLine(category),
    [onAddLine],
  )

  if (!plan) {
    return (
      <div className="bg-stone-50 border border-stone-200 rounded-lg p-5 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wide mb-1">
              Resource Plan
            </h2>
            <p className="text-sm text-stone-500">
              Decomposed team, materials, and overhead the prime needs to orchestrate this contract.
            </p>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded hover:bg-stone-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isGenerating ? (
              <>
                <Spinner />
                Generating…
              </>
            ) : (
              'Generate Resource Plan'
            )}
          </button>
        </div>
      </div>
    )
  }

  const renderSection = (
    key: string,
    label: string,
    category: ResourceCategory,
    lines: ResourceLine[],
  ) => (
    <div key={key} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
          {label}
        </h3>
        <button
          type="button"
          onClick={() => handleAdd(category)}
          className="text-xs text-stone-500 hover:text-stone-800 transition-colors"
        >
          + Add
        </button>
      </div>
      {lines.length > 0 && (
        <div>
          {lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              onEditLine={onEditLine}
              onRemoveLine={onRemoveLine}
              onOpenVendorSearch={onOpenVendorSearch}
              onUpdateJobDescription={onUpdateJobDescription}
              onRegenerateJobDescription={onRegenerateJobDescription}
              regeneratingJdFor={regeneratingJdFor}
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-5 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
            Resource Plan
          </p>
          <h2 className="text-base font-semibold text-stone-900">
            Team, materials, and overhead
          </h2>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          title="Regenerate resource plan"
          className="text-xs text-stone-400 hover:text-stone-600 disabled:opacity-50 transition-colors"
        >
          {isGenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      <div className="space-y-4">
        {CATEGORY_ORDER.map((cat) => {
          if (cat === 'material') {
            return renderSection('materials', CATEGORY_LABELS.material, 'material', materialsMerged)
          }
          return renderSection(cat, CATEGORY_LABELS[cat], cat, grouped[cat])
        })}
      </div>

      <div className="mt-5 pt-3 border-t border-stone-100 text-xs text-stone-500">
        {totals.total} {totals.total === 1 ? 'line' : 'lines'} ·{' '}
        {totals.byCat.professional} {CATEGORY_SHORT.professional} ·{' '}
        {totals.byCat.trades} {CATEGORY_SHORT.subcontracted_trade} ·{' '}
        {totals.byCat.materials} {CATEGORY_SHORT.material} ·{' '}
        {totals.byCat.overhead} {CATEGORY_SHORT.prime_overhead}
      </div>
    </div>
  )
}
