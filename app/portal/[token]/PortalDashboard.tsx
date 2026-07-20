'use client'

import { useCallback, useMemo, useState } from 'react'
import type { RequirementTemplate, FormField } from '@/lib/requirements/types'

type Value = string | number | string[] | null

interface Requirement {
  id: string
  templateKey: string
  status: string
  responses: Record<string, unknown> | null
  attachmentUrls: string[]
  submittedAt: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  rejectionReason: string | null
}

interface Cycle {
  id: string
  periodLabel: string
  status: string
}

interface Props {
  token: string
  cycle: Cycle
  initialRequirements: Requirement[]
  templates: RequirementTemplate[]
}

function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.length > 0
  return false
}

/** Traffic-light for the assembly-line view. */
type TaskStatus = 'complete' | 'submitted' | 'partial' | 'missing' | 'rejected'

function computeTaskStatus(req: Requirement, template: RequirementTemplate): TaskStatus {
  if (req.status === 'REJECTED') return 'rejected'
  if (req.status === 'APPROVED') return 'complete'
  if (req.status === 'SUBMITTED') return 'submitted'
  const responses = req.responses ?? {}
  let required = 0
  let requiredFilled = 0
  let anyFilled = req.attachmentUrls.length > 0
  for (const section of template.formSchema) {
    for (const f of section.fields) {
      if (f.required) {
        required++
        if (f.type === 'file') {
          if (req.attachmentUrls.length > 0) requiredFilled++
        } else if (isFilled((responses as Record<string, unknown>)[f.key])) {
          requiredFilled++
        }
      }
      if (!anyFilled && isFilled((responses as Record<string, unknown>)[f.key])) {
        anyFilled = true
      }
    }
  }
  if (required > 0 && requiredFilled === required) return 'submitted'
  if (anyFilled) return 'partial'
  return 'missing'
}

const STATUS_META: Record<TaskStatus, { label: string; dot: string; text: string; bg: string; border: string }> = {
  complete: { label: 'Approved',  dot: 'bg-emerald-500', text: 'text-emerald-800', bg: 'bg-emerald-50',  border: 'border-emerald-200' },
  submitted:{ label: 'Submitted', dot: 'bg-emerald-400', text: 'text-emerald-800', bg: 'bg-emerald-50/60', border: 'border-emerald-100' },
  partial:  { label: 'In progress', dot: 'bg-amber-400',   text: 'text-amber-900',  bg: 'bg-amber-50',   border: 'border-amber-200' },
  missing:  { label: 'Missing',   dot: 'bg-red-400',     text: 'text-red-800',    bg: 'bg-red-50',     border: 'border-red-200' },
  rejected: { label: 'Needs correction', dot: 'bg-red-500', text: 'text-red-900',  bg: 'bg-red-50',     border: 'border-red-300' },
}

export default function PortalDashboard({
  token,
  cycle,
  initialRequirements,
  templates,
}: Props) {
  const [requirements, setRequirements] = useState<Requirement[]>(initialRequirements)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [taskValues, setTaskValues] = useState<Record<string, Record<string, Value>>>(() => {
    const init: Record<string, Record<string, Value>> = {}
    for (const r of initialRequirements) {
      const vals: Record<string, Value> = {}
      if (r.responses) {
        for (const [k, v] of Object.entries(r.responses)) {
          vals[k] = (v ?? null) as Value
        }
      }
      init[r.id] = vals
    }
    return init
  })
  const [uploadingReq, setUploadingReq] = useState<string | null>(null)
  const [uploadingField, setUploadingField] = useState<string | null>(null)
  const [submittingReq, setSubmittingReq] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missingByReq, setMissingByReq] = useState<Record<string, string[]>>({})

  const templatesByKey = useMemo(() => {
    const m = new Map<string, RequirementTemplate>()
    for (const t of templates) m.set(t.key, t)
    return m
  }, [templates])

  const taskCards = useMemo(() => {
    return requirements
      .map(req => {
        const template = templatesByKey.get(req.templateKey)
        if (!template) return null
        return { req, template, taskStatus: computeTaskStatus(req, template) }
      })
      .filter((x): x is { req: Requirement; template: RequirementTemplate; taskStatus: TaskStatus } => x !== null)
  }, [requirements, templatesByKey])

  const readiness = useMemo(() => {
    const total = taskCards.length
    if (total === 0) return { pct: 0, done: 0, total: 0, missing: 0 }
    const done = taskCards.filter(t => t.taskStatus === 'complete' || t.taskStatus === 'submitted').length
    const missing = taskCards.filter(t => t.taskStatus === 'missing' || t.taskStatus === 'rejected').length
    return { pct: Math.round((done / total) * 100), done, total, missing }
  }, [taskCards])

  const setField = useCallback((reqId: string, key: string, v: Value) => {
    setTaskValues(prev => ({ ...prev, [reqId]: { ...(prev[reqId] ?? {}), [key]: v } }))
  }, [])

  const uploadFile = useCallback(async (reqId: string, field: FormField, file: File) => {
    setUploadingReq(reqId)
    setUploadingField(field.key)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/portal/${token}/tasks/${reqId}/upload`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || data?.error || `Upload failed (${res.status})`)
        return
      }
      setRequirements(prev => prev.map(r =>
        r.id === reqId
          ? { ...r, attachmentUrls: [...r.attachmentUrls, data.url as string], status: r.status === 'TODO' ? 'IN_PROGRESS' : r.status }
          : r,
      ))
      setTaskValues(prev => {
        const cur = prev[reqId] ?? {}
        const existing = cur[field.key]
        const next = { ...cur }
        if (field.multiple) {
          const arr = Array.isArray(existing) ? existing : []
          next[field.key] = [...arr, data.url as string]
        } else {
          next[field.key] = data.url as string
        }
        return { ...prev, [reqId]: next }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploadingReq(null)
      setUploadingField(null)
    }
  }, [token])

  const submitTask = useCallback(async (reqId: string) => {
    setSubmittingReq(reqId)
    setError(null)
    setMissingByReq(prev => ({ ...prev, [reqId]: [] }))
    try {
      const req = requirements.find(r => r.id === reqId)
      if (!req) return
      const res = await fetch(`/api/portal/${token}/tasks/${reqId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: taskValues[reqId] ?? {},
          attachmentUrls: req.attachmentUrls,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.error === 'validation' && Array.isArray(data.missing)) {
          setMissingByReq(prev => ({ ...prev, [reqId]: data.missing as string[] }))
          setError(data.message || 'Please complete required fields before submitting.')
        } else {
          setError(data?.message || data?.error || `Submit failed (${res.status})`)
        }
        return
      }
      setRequirements(prev => prev.map(r =>
        r.id === reqId ? { ...r, status: 'SUBMITTED', submittedAt: new Date().toISOString() } : r,
      ))
      setOpenTaskId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSubmittingReq(null)
    }
  }, [token, requirements, taskValues])

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      {/* Left rail — payment-readiness score + status legend */}
      <aside className="md:sticky md:top-4 md:self-start">
        <div className="bg-white border border-stone-200 rounded-lg p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1">
            Payment Readiness
          </div>
          <div className="flex items-baseline gap-1 mb-2">
            <span className="text-3xl font-semibold text-stone-900">{readiness.pct}%</span>
            <span className="text-xs text-stone-500">ready</span>
          </div>
          <div className="h-2 bg-stone-100 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${readiness.pct}%` }}
            />
          </div>
          <div className="text-xs text-stone-600">
            <span className="font-medium text-stone-900">{readiness.done}</span> of {readiness.total} tasks submitted
          </div>
          {readiness.missing > 0 && (
            <div className="text-xs text-red-700 mt-1">
              <span className="font-medium">{readiness.missing}</span> still missing
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-stone-100">
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-2">Status</div>
            <ul className="space-y-1.5 text-xs text-stone-700">
              <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Approved</li>
              <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Submitted</li>
              <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400" /> In progress</li>
              <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400" /> Missing</li>
            </ul>
          </div>
        </div>
      </aside>

      {/* Task list */}
      <div>
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-md p-3">
            {error}
          </div>
        )}
        <div className="space-y-3">
          {taskCards.map(({ req, template, taskStatus }) => {
            const meta = STATUS_META[taskStatus]
            const isOpen = openTaskId === req.id
            const missing = missingByReq[req.id] ?? []
            return (
              <section
                key={req.id}
                className={`border rounded-lg ${meta.border} ${meta.bg} transition-colors`}
              >
                <button
                  type="button"
                  onClick={() => setOpenTaskId(isOpen ? null : req.id)}
                  className="w-full flex items-center gap-3 p-4 text-left"
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${meta.dot} flex-shrink-0`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-stone-900 truncate">
                        {template.displayName}
                      </h2>
                      <span className={`text-[10px] uppercase tracking-wide font-semibold ${meta.text}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-xs text-stone-600 mt-0.5 truncate">
                      {template.purpose}
                    </p>
                    {taskStatus === 'rejected' && req.rejectionReason && (
                      <p className="text-xs text-red-800 mt-1">
                        Reviewer note: {req.rejectionReason}
                      </p>
                    )}
                  </div>
                  <svg
                    className={`w-4 h-4 text-stone-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="border-t border-stone-200 bg-white p-4 rounded-b-lg">
                    <div className="space-y-4">
                      {template.formSchema.flatMap(section => section.fields).map(field => (
                        <FieldRenderer
                          key={field.key}
                          field={field}
                          value={(taskValues[req.id]?.[field.key] ?? null) as Value}
                          onChange={v => setField(req.id, field.key, v)}
                          onUpload={file => uploadFile(req.id, field, file)}
                          uploading={uploadingReq === req.id && uploadingField === field.key}
                          attachmentUrls={req.attachmentUrls}
                          highlight={missing.includes(field.label)}
                        />
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-xs text-stone-500">
                        {req.attachmentUrls.length} file{req.attachmentUrls.length === 1 ? '' : 's'} on this task
                      </span>
                      <button
                        type="button"
                        onClick={() => void submitTask(req.id)}
                        disabled={submittingReq === req.id}
                        className="bg-stone-800 hover:bg-stone-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
                      >
                        {submittingReq === req.id ? 'Submitting…' : req.status === 'SUBMITTED' ? 'Resubmit' : 'Submit task'}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface FieldProps {
  field: FormField
  value: Value
  onChange: (v: Value) => void
  onUpload: (file: File) => void
  uploading: boolean
  attachmentUrls: string[]
  highlight: boolean
}

function FieldRenderer({ field, value, onChange, onUpload, uploading, attachmentUrls, highlight }: FieldProps) {
  const label = (
    <label className={`block text-sm font-medium mb-1.5 ${highlight ? 'text-red-700' : 'text-stone-800'}`}>
      {field.label}
      {field.required && <span className="text-red-500 ml-1">*</span>}
    </label>
  )
  const help = field.helpText ? (
    <p className="text-xs text-stone-500 mt-1">{field.helpText}</p>
  ) : null

  const baseInput = `w-full border rounded-md px-3 py-2 text-sm bg-white ${
    highlight ? 'border-red-300' : 'border-stone-300'
  } focus:outline-none focus:ring-2 focus:ring-stone-400`

  if (field.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          className={baseInput + ' min-h-[80px] resize-y'}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
        />
        {help}
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div>
        {label}
        <select
          className={baseInput}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
        >
          {(field.options ?? []).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {help}
      </div>
    )
  }

  if (field.type === 'file') {
    const uploadedUrls = Array.isArray(value)
      ? value
      : typeof value === 'string' && value
        ? [value]
        : []
    return (
      <div>
        {label}
        <div className="border border-dashed border-stone-300 rounded-md p-4 bg-stone-50">
          <input
            type="file"
            accept={field.accept}
            multiple={field.multiple}
            disabled={uploading}
            onChange={e => {
              const files = Array.from(e.target.files ?? [])
              for (const file of files) onUpload(file)
              e.target.value = ''
            }}
            className="block w-full text-sm text-stone-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-stone-800 file:text-white file:text-xs file:font-medium hover:file:bg-stone-700"
          />
          {uploading && (
            <p className="text-xs text-stone-500 mt-2">Uploading…</p>
          )}
          {uploadedUrls.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {uploadedUrls.map(url => {
                const name = url.split('/').pop() ?? url
                return (
                  <li key={url} className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-stone-700 underline">
                      {name}
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
          {uploadedUrls.length === 0 && attachmentUrls.length > 0 && (
            <p className="text-[11px] text-stone-500 mt-2">
              {attachmentUrls.length} file{attachmentUrls.length === 1 ? '' : 's'} already attached to this task.
            </p>
          )}
        </div>
        {help}
      </div>
    )
  }

  const htmlType =
    field.type === 'email' ? 'email'
    : field.type === 'phone' ? 'tel'
    : field.type === 'date' ? 'date'
    : field.type === 'number' || field.type === 'currency' ? 'number'
    : 'text'

  const step = field.type === 'currency' ? '0.01' : undefined

  return (
    <div>
      {label}
      <input
        type={htmlType}
        step={step}
        className={baseInput}
        placeholder={field.placeholder}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        onChange={e => onChange(e.target.value)}
      />
      {help}
    </div>
  )
}
