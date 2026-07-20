'use client'

import { useCallback, useMemo, useState } from 'react'

interface CrewRow {
  label?: string
  count?: number
  hours?: number
}

interface Report {
  id: string
  reportDate: string // YYYY-MM-DD
  weatherConditions: string | null
  weatherTempHigh: string | null
  weatherTempLow: string | null
  precipitation: string | null
  windSpeed: string | null
  workHoursStart: string | null
  workHoursEnd: string | null
  hoursWorked: number | null
  personnel: CrewRow[]
  equipment: CrewRow[]
  workPerformed: string | null
  clinsWorked: string | null
  percentComplete: number | null
  materialsReceived: string | null
  materialsUsed: string | null
  safetyIncidents: string | null
  delays: string | null
  visitors: string | null
  photoUrls: string[]
  attachmentUrls: string[]
  superintendentName: string
  submittedAt: string
}

interface Props {
  token: string
  initialReports: Report[]
  defaultSuperName: string
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyForm(date: string, superName: string): Report {
  return {
    id: '',
    reportDate: date,
    weatherConditions: '',
    weatherTempHigh: '',
    weatherTempLow: '',
    precipitation: '',
    windSpeed: '',
    workHoursStart: '',
    workHoursEnd: '',
    hoursWorked: null,
    personnel: [{ label: '', count: undefined, hours: undefined }],
    equipment: [{ label: '', count: undefined, hours: undefined }],
    workPerformed: '',
    clinsWorked: '',
    percentComplete: null,
    materialsReceived: '',
    materialsUsed: '',
    safetyIncidents: '',
    delays: '',
    visitors: '',
    photoUrls: [],
    attachmentUrls: [],
    superintendentName: superName,
    submittedAt: '',
  }
}

/** Build a 6-week grid (M-Su) covering the current month + tails. */
function buildCalendar(anchor: Date): string[][] {
  const y = anchor.getFullYear()
  const m = anchor.getMonth()
  const first = new Date(y, m, 1)
  const startDow = (first.getDay() + 6) % 7 // Mon = 0
  const start = new Date(y, m, 1 - startDow)
  const weeks: string[][] = []
  for (let w = 0; w < 6; w++) {
    const row: string[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      row.push(
        `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
      )
    }
    weeks.push(row)
  }
  return weeks
}

export default function SuperDashboard({ token, initialReports, defaultSuperName }: Props) {
  const [reports, setReports] = useState<Report[]>(initialReports)
  const [activeDate, setActiveDate] = useState<string>(todayIso())
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const reportsByDate = useMemo(() => {
    const m = new Map<string, Report>()
    for (const r of reports) m.set(r.reportDate, r)
    return m
  }, [reports])

  const active: Report = useMemo(() => {
    return reportsByDate.get(activeDate) ?? emptyForm(activeDate, defaultSuperName)
  }, [reportsByDate, activeDate, defaultSuperName])

  const [draft, setDraft] = useState<Report>(active)

  // Reset draft when switching days.
  useMemo(() => setDraft(active), [active])

  const patch = useCallback((updates: Partial<Report>) => {
    setDraft(prev => ({ ...prev, ...updates }))
  }, [])

  const setCrewRow = useCallback((
    kind: 'personnel' | 'equipment',
    idx: number,
    field: keyof CrewRow,
    value: string,
  ) => {
    setDraft(prev => {
      const rows = [...(prev[kind] ?? [])]
      const row = { ...(rows[idx] ?? {}) }
      if (field === 'label') row.label = value
      else {
        const n = value.trim() === '' ? undefined : Number(value)
        row[field] = Number.isFinite(n as number) ? (n as number) : undefined
      }
      rows[idx] = row
      return { ...prev, [kind]: rows }
    })
  }, [])

  const addCrewRow = useCallback((kind: 'personnel' | 'equipment') => {
    setDraft(prev => ({
      ...prev,
      [kind]: [...(prev[kind] ?? []), { label: '', count: undefined, hours: undefined }],
    }))
  }, [])

  const removeCrewRow = useCallback((kind: 'personnel' | 'equipment', idx: number) => {
    setDraft(prev => ({
      ...prev,
      [kind]: (prev[kind] ?? []).filter((_, i) => i !== idx),
    }))
  }, [])

  const saveReport = useCallback(async () => {
    setError(null)
    setFlash(null)
    setSaving(true)
    try {
      const cleanRows = (rows: CrewRow[]) =>
        (rows ?? [])
          .filter(r => (r.label && r.label.trim()) || r.count || r.hours)
          .map(r => ({
            label: r.label?.trim() ?? '',
            count: r.count,
            hours: r.hours,
          }))

      const res = await fetch(`/api/super/${token}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          personnel: cleanRows(draft.personnel),
          equipment: cleanRows(draft.equipment),
          hoursWorked: draft.hoursWorked ?? undefined,
          percentComplete: draft.percentComplete ?? undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || data?.error || `Save failed (${res.status})`)
        return
      }
      const saved = data.report as Report & { reportDate: string }
      const normalizedDate =
        typeof saved.reportDate === 'string' && saved.reportDate.length >= 10
          ? saved.reportDate.slice(0, 10)
          : draft.reportDate
      const merged: Report = {
        ...draft,
        ...saved,
        reportDate: normalizedDate,
        photoUrls: saved.photoUrls ?? draft.photoUrls,
        attachmentUrls: saved.attachmentUrls ?? draft.attachmentUrls,
      }
      setReports(prev => {
        const others = prev.filter(r => r.reportDate !== normalizedDate)
        return [merged, ...others].sort((a, b) => b.reportDate.localeCompare(a.reportDate))
      })
      setDraft(merged)
      setFlash('Saved ✓')
      setTimeout(() => setFlash(null), 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [token, draft])

  const uploadFile = useCallback(async (file: File, kind: 'photo' | 'file') => {
    if (!draft.id) {
      setError('Save the report first before attaching photos or files.')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      const res = await fetch(`/api/super/${token}/reports/${draft.id}/upload`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || data?.error || `Upload failed (${res.status})`)
        return
      }
      const url = data.url as string
      setDraft(prev => ({
        ...prev,
        photoUrls: kind === 'photo' ? [...prev.photoUrls, url] : prev.photoUrls,
        attachmentUrls: kind === 'file' ? [...prev.attachmentUrls, url] : prev.attachmentUrls,
      }))
      setReports(prev => prev.map(r =>
        r.id === draft.id
          ? {
              ...r,
              photoUrls: kind === 'photo' ? [...r.photoUrls, url] : r.photoUrls,
              attachmentUrls: kind === 'file' ? [...r.attachmentUrls, url] : r.attachmentUrls,
            }
          : r,
      ))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [token, draft.id])

  const calendar = useMemo(() => buildCalendar(monthAnchor), [monthAnchor])
  const monthLabel = monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const today = todayIso()

  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      {/* Left sidebar — month calendar */}
      <aside className="md:sticky md:top-4 md:self-start">
        <div className="bg-white border border-stone-200 rounded-lg p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}
              className="text-stone-500 hover:text-stone-900 px-2"
              aria-label="Previous month"
            >
              ←
            </button>
            <span className="text-sm font-semibold text-stone-900">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}
              className="text-stone-500 hover:text-stone-900 px-2"
              aria-label="Next month"
            >
              →
            </button>
          </div>
          <div className="grid grid-cols-7 text-[10px] font-medium text-stone-400 mb-1">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <div key={i} className="text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {calendar.flat().map(iso => {
              const dayNum = Number(iso.slice(8, 10))
              const inMonth = iso.slice(0, 7) === `${monthAnchor.getFullYear()}-${String(monthAnchor.getMonth() + 1).padStart(2, '0')}`
              const isToday = iso === today
              const isActive = iso === activeDate
              const hasReport = reportsByDate.has(iso)
              const isFuture = iso > today
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setActiveDate(iso)}
                  disabled={isFuture}
                  className={`
                    aspect-square text-xs rounded flex items-center justify-center relative
                    ${isActive ? 'bg-stone-800 text-white' :
                      hasReport ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200' :
                      inMonth ? 'bg-stone-50 text-stone-700 hover:bg-stone-100' :
                      'text-stone-300 hover:bg-stone-50'}
                    ${isFuture ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                    ${isToday && !isActive ? 'ring-1 ring-stone-400' : ''}
                    transition-colors
                  `}
                >
                  {dayNum}
                  {hasReport && !isActive && (
                    <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-500" />
                  )}
                </button>
              )
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-stone-100 space-y-1.5 text-[11px] text-stone-600">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Submitted
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-stone-300" /> No report
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full ring-1 ring-stone-400 bg-white" /> Today
            </div>
          </div>
        </div>
      </aside>

      {/* Main form */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">
              Report for {new Date(activeDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h2>
            {draft.id && (
              <p className="text-xs text-stone-500 mt-0.5">
                Last saved {new Date(draft.submittedAt).toLocaleString('en-US')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {flash && (
              <span className="text-xs font-medium text-emerald-700">{flash}</span>
            )}
            <button
              type="button"
              onClick={() => void saveReport()}
              disabled={saving}
              className="bg-stone-800 hover:bg-stone-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
            >
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Submit report'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-md p-3">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Weather */}
          <Section title="Weather">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Conditions">
                <input className={INPUT} placeholder="Partly cloudy"
                  value={draft.weatherConditions ?? ''}
                  onChange={e => patch({ weatherConditions: e.target.value })} />
              </Field>
              <Field label="High">
                <input className={INPUT} placeholder="84°F"
                  value={draft.weatherTempHigh ?? ''}
                  onChange={e => patch({ weatherTempHigh: e.target.value })} />
              </Field>
              <Field label="Low">
                <input className={INPUT} placeholder="68°F"
                  value={draft.weatherTempLow ?? ''}
                  onChange={e => patch({ weatherTempLow: e.target.value })} />
              </Field>
              <Field label="Precipitation">
                <input className={INPUT} placeholder="None / 0.2 in"
                  value={draft.precipitation ?? ''}
                  onChange={e => patch({ precipitation: e.target.value })} />
              </Field>
              <Field label="Wind">
                <input className={INPUT} placeholder="10 mph SW"
                  value={draft.windSpeed ?? ''}
                  onChange={e => patch({ windSpeed: e.target.value })} />
              </Field>
              <Field label="Work start">
                <input className={INPUT} type="time"
                  value={draft.workHoursStart ?? ''}
                  onChange={e => patch({ workHoursStart: e.target.value })} />
              </Field>
              <Field label="Work end">
                <input className={INPUT} type="time"
                  value={draft.workHoursEnd ?? ''}
                  onChange={e => patch({ workHoursEnd: e.target.value })} />
              </Field>
              <Field label="Total hours">
                <input className={INPUT} type="number" step="0.25" placeholder="9.5"
                  value={draft.hoursWorked ?? ''}
                  onChange={e => patch({ hoursWorked: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
            </div>
          </Section>

          {/* Personnel */}
          <Section title="Personnel on site">
            <CrewTable
              rows={draft.personnel}
              headers={['Trade / role', 'Count', 'Hours']}
              onChange={(idx, field, value) => setCrewRow('personnel', idx, field, value)}
              onAdd={() => addCrewRow('personnel')}
              onRemove={idx => removeCrewRow('personnel', idx)}
              placeholder="Laborer, Ironworker, Operator…"
            />
          </Section>

          {/* Equipment */}
          <Section title="Equipment on site">
            <CrewTable
              rows={draft.equipment}
              headers={['Equipment', 'Count', 'Hours']}
              onChange={(idx, field, value) => setCrewRow('equipment', idx, field, value)}
              onAdd={() => addCrewRow('equipment')}
              onRemove={idx => removeCrewRow('equipment', idx)}
              placeholder="Excavator, Skid steer, Paver…"
            />
          </Section>

          {/* Work performed */}
          <Section title="Work performed">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
              <div className="sm:col-span-3">
                <Field label="CLINs / scope items">
                  <input className={INPUT} placeholder="CLIN 0001, 0003"
                    value={draft.clinsWorked ?? ''}
                    onChange={e => patch({ clinsWorked: e.target.value })} />
                </Field>
              </div>
              <Field label="% complete (today)">
                <input className={INPUT} type="number" min="0" max="100" placeholder="0–100"
                  value={draft.percentComplete ?? ''}
                  onChange={e => patch({ percentComplete: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="What was performed today">
              <textarea className={TEXTAREA} placeholder="Set forms for footing 3, poured 12 cy of ready-mix, stripped forms on footing 2."
                value={draft.workPerformed ?? ''}
                onChange={e => patch({ workPerformed: e.target.value })} />
            </Field>
          </Section>

          {/* Materials */}
          <Section title="Materials">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Received">
                <textarea className={TEXTAREA} placeholder="12 cy of 4000 psi concrete (ticket #12345)…"
                  value={draft.materialsReceived ?? ''}
                  onChange={e => patch({ materialsReceived: e.target.value })} />
              </Field>
              <Field label="Used / installed">
                <textarea className={TEXTAREA}
                  value={draft.materialsUsed ?? ''}
                  onChange={e => patch({ materialsUsed: e.target.value })} />
              </Field>
            </div>
          </Section>

          {/* Issues */}
          <Section title="Safety, delays, visitors">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Safety incidents">
                <textarea className={TEXTAREA} placeholder="None"
                  value={draft.safetyIncidents ?? ''}
                  onChange={e => patch({ safetyIncidents: e.target.value })} />
              </Field>
              <Field label="Delays">
                <textarea className={TEXTAREA} placeholder="Rain 2:00–3:30pm"
                  value={draft.delays ?? ''}
                  onChange={e => patch({ delays: e.target.value })} />
              </Field>
              <Field label="Visitors / inspections">
                <textarea className={TEXTAREA} placeholder="Owner rep site walk 10am"
                  value={draft.visitors ?? ''}
                  onChange={e => patch({ visitors: e.target.value })} />
              </Field>
            </div>
          </Section>

          {/* Photos + attachments */}
          <Section title="Photos & attachments">
            {!draft.id ? (
              <p className="text-xs text-stone-500">Save the report first — photos and files attach to a saved report.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-stone-700 mb-1 block">Photos</label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={uploading}
                    onChange={e => {
                      const files = Array.from(e.target.files ?? [])
                      for (const f of files) void uploadFile(f, 'photo')
                      e.target.value = ''
                    }}
                    className="block w-full text-xs text-stone-700 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-stone-800 file:text-white file:text-xs hover:file:bg-stone-700"
                  />
                  {draft.photoUrls.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {draft.photoUrls.map(url => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt="Site photo" className="w-full h-16 object-cover rounded border border-stone-200" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-700 mb-1 block">Documents (tickets, signed forms)</label>
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    multiple
                    disabled={uploading}
                    onChange={e => {
                      const files = Array.from(e.target.files ?? [])
                      for (const f of files) void uploadFile(f, 'file')
                      e.target.value = ''
                    }}
                    className="block w-full text-xs text-stone-700 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-stone-800 file:text-white file:text-xs hover:file:bg-stone-700"
                  />
                  {draft.attachmentUrls.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {draft.attachmentUrls.map(url => {
                        const name = url.split('/').pop() ?? url
                        return (
                          <li key={url}>
                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-stone-700 underline">
                              {name}
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {uploading && <p className="mt-2 text-xs text-stone-500">Uploading…</p>}
          </Section>

          {/* Signature */}
          <Section title="Superintendent">
            <Field label="Name (typed = signature)">
              <input className={INPUT} placeholder="Your name"
                value={draft.superintendentName ?? ''}
                onChange={e => patch({ superintendentName: e.target.value })} />
            </Field>
          </Section>

          <div className="flex items-center justify-end gap-3 pt-2">
            {flash && <span className="text-xs font-medium text-emerald-700">{flash}</span>}
            <button
              type="button"
              onClick={() => void saveReport()}
              disabled={saving}
              className="bg-stone-800 hover:bg-stone-700 text-white text-sm font-medium px-5 py-2 rounded-md disabled:opacity-50"
            >
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Submit report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const INPUT = 'w-full border border-stone-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-400'
const TEXTAREA = INPUT + ' min-h-[70px] resize-y'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-stone-200 rounded-lg p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-stone-900 mb-3">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-stone-700 mb-1 block">{label}</label>
      {children}
    </div>
  )
}

function CrewTable({
  rows, headers, onChange, onAdd, onRemove, placeholder,
}: {
  rows: CrewRow[]
  headers: [string, string, string]
  onChange: (idx: number, field: keyof CrewRow, value: string) => void
  onAdd: () => void
  onRemove: (idx: number) => void
  placeholder: string
}) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_80px_80px_28px] gap-2 mb-1 text-[11px] font-medium text-stone-500">
        <span>{headers[0]}</span>
        <span>{headers[1]}</span>
        <span>{headers[2]}</span>
        <span />
      </div>
      <div className="space-y-1">
        {rows.map((row, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_80px_80px_28px] gap-2 items-center">
            <input className={INPUT} placeholder={placeholder}
              value={row.label ?? ''} onChange={e => onChange(idx, 'label', e.target.value)} />
            <input className={INPUT} type="number" min="0"
              value={row.count ?? ''} onChange={e => onChange(idx, 'count', e.target.value)} />
            <input className={INPUT} type="number" min="0" step="0.25"
              value={row.hours ?? ''} onChange={e => onChange(idx, 'hours', e.target.value)} />
            <button type="button" onClick={() => onRemove(idx)}
              className="text-stone-400 hover:text-red-600 text-sm" aria-label="Remove row">
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={onAdd}
        className="mt-2 text-xs text-stone-600 hover:text-stone-900 underline">
        + Add row
      </button>
    </div>
  )
}
