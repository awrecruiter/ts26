'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  REQUIREMENT_TEMPLATES,
  SUBMITTAL_GROUPS,
  SUBMITTAL_GROUP_ORDER,
  templatesForGroup,
} from '@/lib/requirements/templates'
import type { RequirementTemplate, SubmittalGroup } from '@/lib/requirements/types'

interface SubMinimal {
  id: string
  name: string
  contactName?: string | null
  email?: string | null
  contactEmail?: string | null
  resourceLineId?: string | null
}

interface RequirementRow {
  id: string
  templateKey: string
  submittalGroup: string
  status: 'TODO' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'WAIVED'
  assignedEmail: string
  assignedName: string | null
  dueAt: string | null
  submittedAt: string | null
  responses: Record<string, unknown> | null
  attachmentUrls: string[]
  subcontractor: SubMinimal
  tokens: Array<{
    token: string
    expiresAt: string
    consumedAt: string | null
    createdAt: string
  }>
}

interface Props {
  opportunityId: string
  subcontractors: SubMinimal[]
}

export default function PreworkPanel({ opportunityId, subcontractors }: Props) {
  const [requirements, setRequirements] = useState<RequirementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assignFor, setAssignFor] = useState<RequirementTemplate | null>(null)
  const [viewing, setViewing] = useState<RequirementRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/requirements`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || `Load failed (${res.status})`)
        return
      }
      setRequirements(data.requirements ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [opportunityId])

  useEffect(() => { void load() }, [load])

  const byGroup = useMemo(() => {
    const m: Record<string, RequirementRow[]> = {}
    for (const r of requirements) {
      (m[r.submittalGroup] ??= []).push(r)
    }
    return m
  }, [requirements])

  // Quote comparison matrix — one row per sub with any submitted requirement
  // across the evaluation-critical templates (quote, insurance, SF-1413).
  // Sorted so the lowest quote lands at the top and subs without a quote
  // fall to the bottom.
  const quoteMatrix = useMemo(() => {
    const isDone = (s: RequirementRow['status']) => s === 'SUBMITTED' || s === 'APPROVED'
    const bySub = new Map<string, RequirementRow[]>()
    for (const r of requirements) {
      if (!isDone(r.status)) continue
      const list = bySub.get(r.subcontractor.id) ?? []
      list.push(r)
      bySub.set(r.subcontractor.id, list)
    }

    const rows = Array.from(bySub.entries()).map(([subId, subRows]) => {
      const sub = subRows[0].subcontractor
      const quoteRow = subRows.find(r => r.templateKey === 'sub_quote')
      const insRow   = subRows.find(r => r.templateKey === 'insurance_certificate')
      const sfRow    = subRows.find(r => r.templateKey === 'sf1413_signature')
      const listRow  = subRows.find(r => r.templateKey === 'sub_quote')

      const rawTotal = quoteRow?.responses?.grand_total
      const quoted =
        typeof rawTotal === 'number'
          ? rawTotal
          : typeof rawTotal === 'string' && rawTotal.trim() !== '' && !Number.isNaN(Number(rawTotal))
            ? Number(rawTotal)
            : null

      const rawExp = insRow?.responses?.expiration_date
      const expiration = typeof rawExp === 'string' ? rawExp : null
      const rawGl = insRow?.responses?.gl_limit
      const glLimit =
        typeof rawGl === 'number'
          ? rawGl
          : typeof rawGl === 'string' && rawGl.trim() !== ''
            ? rawGl
            : null

      return {
        subId,
        subName: sub.name,
        quoted,
        insurance: insRow ? { expiration, glLimit } : null,
        sf1413: !!sfRow,
        subListDone: !!listRow,
      }
    })

    rows.sort((a, b) => {
      if (a.quoted == null && b.quoted == null) return a.subName.localeCompare(b.subName)
      if (a.quoted == null) return 1
      if (b.quoted == null) return -1
      return a.quoted - b.quoted
    })
    return rows
  }, [requirements])

  const resend = async (rowId: string) => {
    const res = await fetch(`/api/opportunities/${opportunityId}/requirements/${rowId}/resend`, {
      method: 'POST',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(data?.error || `Resend failed (${res.status})`)
      return
    }
    await load()
    alert(data?.email?.success ? 'Invite resent.' : 'New link created but email send failed. Copy link from the row.')
  }

  const remove = async (rowId: string) => {
    if (!confirm('Remove this requirement?')) return
    const res = await fetch(`/api/opportunities/${opportunityId}/requirements/${rowId}`, {
      method: 'DELETE',
    })
    if (res.ok) await load()
  }

  const approve = async (rowId: string) => {
    await fetch(`/api/opportunities/${opportunityId}/requirements/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPROVED' }),
    })
    await load()
  }

  const reject = async (rowId: string) => {
    const reason = prompt('Reason for rejection?')
    if (reason === null) return
    await fetch(`/api/opportunities/${opportunityId}/requirements/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'REJECTED', rejectionReason: reason }),
    })
    await load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <p className="text-xs font-bold text-stone-500 tracking-widest uppercase mb-1">
          Prework
        </p>
        <h1 className="text-xl font-semibold text-stone-900 mb-1">
          Bid-package plan components
        </h1>
        <p className="text-sm text-stone-600 max-w-2xl">
          Components of the required preconstruction plans. Assign each item to a subcontractor and
          send them a secure link — their responses come back here and roll up into the bid package.
        </p>
      </header>

      {loading && <p className="text-sm text-stone-500">Loading…</p>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md p-3 mb-4">{error}</div>
      )}

      <div className="space-y-6">
        <QuoteComparisonCard matrix={quoteMatrix} />
        {SUBMITTAL_GROUP_ORDER.map(groupKey => (
          <GroupSection
            key={groupKey}
            groupKey={groupKey}
            rows={byGroup[groupKey] ?? []}
            onAssign={setAssignFor}
            onView={setViewing}
            onResend={resend}
            onRemove={remove}
            onApprove={approve}
            onReject={reject}
          />
        ))}
      </div>

      {assignFor && (
        <AssignModal
          template={assignFor}
          subcontractors={subcontractors}
          opportunityId={opportunityId}
          existingRows={requirements.filter(r => r.templateKey === assignFor.key)}
          onClose={() => setAssignFor(null)}
          onDone={async () => { setAssignFor(null); await load() }}
        />
      )}

      {viewing && (
        <ViewResponseModal
          row={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}

// ─── Group section ─────────────────────────────────────────────────────────

function GroupSection({
  groupKey,
  rows,
  onAssign,
  onView,
  onResend,
  onRemove,
  onApprove,
  onReject,
}: {
  groupKey: SubmittalGroup
  rows: RequirementRow[]
  onAssign: (t: RequirementTemplate) => void
  onView: (r: RequirementRow) => void
  onResend: (id: string) => void
  onRemove: (id: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const group = SUBMITTAL_GROUPS[groupKey]
  const templates = templatesForGroup(groupKey)

  const submitted = rows.filter(r => r.status === 'SUBMITTED' || r.status === 'APPROVED').length
  const total = rows.length

  return (
    <section className="bg-white border border-stone-200 rounded-lg">
      <header className="px-4 sm:px-5 py-3 border-b border-stone-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-stone-900">
            {group.displayName}
            {group.sowReference && (
              <span className="ml-2 text-xs font-normal text-stone-400">{group.sowReference}</span>
            )}
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">{group.description}</p>
        </div>
        {total > 0 && (
          <span className="text-xs text-stone-500 flex-shrink-0">
            {submitted} / {total} responded
          </span>
        )}
      </header>

      <div className="divide-y divide-stone-100">
        {templates.map(tpl => {
          const tplRows = rows.filter(r => r.templateKey === tpl.key)
          return (
            <div key={tpl.key} className="px-4 sm:px-5 py-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-800">{tpl.displayName}</p>
                  <p className="text-xs text-stone-500 mt-0.5">{tpl.purpose}</p>
                </div>
                <button
                  onClick={() => onAssign(tpl)}
                  className="text-xs font-medium text-stone-700 hover:text-stone-900 border border-stone-300 rounded-md px-2.5 py-1 flex-shrink-0"
                >
                  Assign
                </button>
              </div>
              {tplRows.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {tplRows.map(row => (
                    <RowLine
                      key={row.id}
                      row={row}
                      onView={onView}
                      onResend={onResend}
                      onRemove={onRemove}
                      onApprove={onApprove}
                      onReject={onReject}
                    />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RowLine({
  row,
  onView,
  onResend,
  onRemove,
  onApprove,
  onReject,
}: {
  row: RequirementRow
  onView: (r: RequirementRow) => void
  onResend: (id: string) => void
  onRemove: (id: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const status = row.status
  const badge = statusBadge(status)
  const activeToken = row.tokens[0]
  const link = activeToken && !activeToken.consumedAt
    ? `${window.location.origin}/req/${activeToken.token}`
    : null

  const copyLink = () => {
    if (!link) return
    navigator.clipboard.writeText(link).then(
      () => { /* ok */ },
      () => alert('Copy failed — link: ' + link),
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-stone-50 border border-stone-200 rounded-md px-3 py-2 text-xs">
      <span className={`px-1.5 py-0.5 rounded font-medium ${badge.className}`}>{badge.label}</span>
      <span className="text-stone-700 font-medium truncate max-w-[160px]">{row.subcontractor.name}</span>
      <span className="text-stone-400 truncate">{row.assignedEmail}</span>
      {row.dueAt && (
        <span className="text-stone-500">
          due {new Date(row.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {status === 'SUBMITTED' && (
          <>
            <button onClick={() => onView(row)}
                    className="px-2 py-0.5 rounded border border-stone-300 hover:bg-white">View</button>
            <button onClick={() => onApprove(row.id)}
                    className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
            <button onClick={() => onReject(row.id)}
                    className="px-2 py-0.5 rounded border border-stone-300 hover:bg-white">Reject</button>
          </>
        )}
        {(status === 'APPROVED' || status === 'REJECTED') && (
          <button onClick={() => onView(row)}
                  className="px-2 py-0.5 rounded border border-stone-300 hover:bg-white">View</button>
        )}
        {(status === 'TODO' || status === 'IN_PROGRESS' || status === 'REJECTED') && (
          <>
            {link && (
              <button onClick={copyLink}
                      className="px-2 py-0.5 rounded border border-stone-300 hover:bg-white">Copy link</button>
            )}
            <button onClick={() => onResend(row.id)}
                    className="px-2 py-0.5 rounded border border-stone-300 hover:bg-white">Resend</button>
          </>
        )}
        <button onClick={() => onRemove(row.id)}
                className="px-2 py-0.5 rounded text-stone-500 hover:text-red-600">×</button>
      </div>
    </li>
  )
}

function statusBadge(status: RequirementRow['status']) {
  switch (status) {
    case 'TODO':        return { label: 'Sent',       className: 'bg-stone-200 text-stone-700' }
    case 'IN_PROGRESS': return { label: 'Started',    className: 'bg-amber-100 text-amber-800' }
    case 'SUBMITTED':   return { label: 'Submitted',  className: 'bg-blue-100 text-blue-800' }
    case 'APPROVED':    return { label: 'Approved',   className: 'bg-emerald-100 text-emerald-800' }
    case 'REJECTED':    return { label: 'Rejected',   className: 'bg-red-100 text-red-800' }
    case 'WAIVED':      return { label: 'Waived',     className: 'bg-stone-100 text-stone-500' }
  }
}

// ─── Assign modal ──────────────────────────────────────────────────────────

function AssignModal({
  template,
  subcontractors,
  opportunityId,
  existingRows,
  onClose,
  onDone,
}: {
  template: RequirementTemplate
  subcontractors: SubMinimal[]
  opportunityId: string
  existingRows: RequirementRow[]
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const existingSubIds = new Set(existingRows.map(r => r.subcontractor.id))
  const available = subcontractors.filter(s => !existingSubIds.has(s.id))
  const [subId, setSubId] = useState(available[0]?.id ?? '')
  const selected = available.find(s => s.id === subId)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!selected) return
    setEmail(selected.contactEmail || selected.email || '')
    setName(selected.contactName || '')
  }, [selected])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subId) return
    setSending(true)
    setErr(null)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subcontractorId: subId,
          templateKey: template.key,
          assignedEmail: email,
          assignedName: name,
          sendInvite: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.error || `Failed (${res.status})`)
        return
      }
      if (data?.email?.success === false) {
        // still succeeded on creating the row, but email failed — surface a warning
        alert(`Requirement created. Email send failed: ${data.email.error}. Use "Copy link" to share manually.`)
      }
      await onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSending(false)
    }
  }

  if (!mounted) return null

  const hasSubs = subcontractors.length > 0

  const modal = (
    <div className="fixed inset-0 bg-stone-900/50 z-[100] flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-stone-900 mb-1">Assign requirement</h3>
        <p className="text-xs text-stone-500 mb-4">{template.displayName}</p>

        {!hasSubs ? (
          <div>
            <p className="text-sm text-stone-600 mb-4">
              No subcontractors on this opportunity yet. Add subcontractors from the Subcontractors tab
              first — then come back here to assign prework requirements.
            </p>
            <button onClick={onClose}
                    className="text-sm text-stone-700 hover:text-stone-900">Close</button>
          </div>
        ) : available.length === 0 ? (
          <div>
            <p className="text-sm text-stone-600 mb-4">
              All {subcontractors.length} subcontractor(s) on this opportunity already have this
              requirement assigned. Use Resend on the row below if you need to send the link again.
            </p>
            <button onClick={onClose}
                    className="text-sm text-stone-700 hover:text-stone-900">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-stone-700">Subcontractor</span>
              <select
                value={subId}
                onChange={e => setSubId(e.target.value)}
                className="mt-1 w-full border border-stone-300 rounded-md px-3 py-2 text-sm bg-white"
              >
                {available.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-stone-700">Contact name (optional)</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="mt-1 w-full border border-stone-300 rounded-md px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-stone-700">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="mt-1 w-full border border-stone-300 rounded-md px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-stone-500 mt-1">Suggested role: {template.suggestedRole}</p>
            </label>

            {err && <p className="text-xs text-red-700">{err}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={onClose}
                      className="text-sm text-stone-600 hover:text-stone-900 px-3 py-1.5">
                Cancel
              </button>
              <button type="submit" disabled={sending || !subId || !email}
                      className="bg-stone-800 hover:bg-stone-700 text-white text-sm font-medium px-4 py-1.5 rounded-md disabled:opacity-50">
                {sending ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

// ─── View response modal ──────────────────────────────────────────────────

function ViewResponseModal({
  row,
  onClose,
}: {
  row: RequirementRow
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const entries = row.responses ? Object.entries(row.responses) : []
  if (!mounted) return null
  const modal = (
    <div className="fixed inset-0 bg-stone-900/50 z-[100] flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-stone-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-stone-900">{row.subcontractor.name}</h3>
            <p className="text-xs text-stone-500">
              Submitted {row.submittedAt ? new Date(row.submittedAt).toLocaleString() : '—'}
            </p>
          </div>
          <button onClick={onClose}
                  className="text-stone-400 hover:text-stone-700">×</button>
        </div>
        <div className="p-6 overflow-y-auto space-y-3">
          {entries.length === 0 ? (
            <p className="text-sm text-stone-500">No answers recorded.</p>
          ) : (
            <dl className="space-y-3 text-sm">
              {entries.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-medium text-stone-500">{k}</dt>
                  <dd className="text-stone-800 whitespace-pre-wrap break-words">
                    {formatValue(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {row.attachmentUrls.length > 0 && (
            <div className="pt-4 border-t border-stone-100">
              <p className="text-xs font-medium text-stone-500 mb-2">Attachments</p>
              <ul className="space-y-1">
                {row.attachmentUrls.map(url => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                       className="text-sm text-stone-700 underline break-all">
                      {url.split('/').pop() || url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

// ─── Quote comparison card ───────────────────────────────────────────────────

interface QuoteMatrixRow {
  subId: string
  subName: string
  quoted: number | null
  insurance: { expiration: string | null; glLimit: number | string | null } | null
  sf1413: boolean
  subListDone: boolean
}

const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function QuoteComparisonCard({ matrix }: { matrix: QuoteMatrixRow[] }) {
  // Empty state: hide entirely rather than showing a placeholder card.
  if (matrix.length === 0) return null

  // Lowest/highest quote comparison — only meaningful when 2+ subs quoted.
  // Δ shows how far under the highest bid the lowest sub is.
  const quotedRows = matrix.filter((r): r is QuoteMatrixRow & { quoted: number } => r.quoted != null)
  const hasSpread = quotedRows.length >= 2
  const lowest = hasSpread ? quotedRows[0] : null
  const highest = hasSpread ? quotedRows[quotedRows.length - 1] : null
  const delta = hasSpread && lowest && highest ? highest.quoted - lowest.quoted : 0

  return (
    <section className="bg-white border border-stone-200 rounded-lg">
      <header className="px-4 sm:px-5 py-3 border-b border-stone-100">
        <h2 className="text-sm font-semibold text-stone-900">Quote Comparison</h2>
        <p className="text-xs text-stone-500 mt-0.5">Submitted quotes side-by-side</p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-500 border-b border-stone-100">
              <th className="px-4 sm:px-5 py-2 font-medium">Subcontractor</th>
              <th className="px-3 py-2 font-medium">Quote</th>
              <th className="px-3 py-2 font-medium">Insurance</th>
              <th className="px-3 py-2 font-medium">SF-1413</th>
              <th className="px-3 py-2 font-medium">Company Info</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {matrix.map(row => (
              <tr key={row.subId}>
                <td className="px-4 sm:px-5 py-2 text-stone-800 font-medium">{row.subName}</td>
                <td className="px-3 py-2 text-stone-800 tabular-nums">
                  {row.quoted != null ? CURRENCY.format(row.quoted) : <span className="text-stone-400">—</span>}
                </td>
                <td className="px-3 py-2">
                  <InsuranceCell insurance={row.insurance} />
                </td>
                <td className="px-3 py-2">
                  {row.sf1413 ? <CheckIcon /> : <span className="text-stone-400">—</span>}
                </td>
                <td className="px-3 py-2">
                  {row.subListDone ? <CheckIcon /> : <span className="text-stone-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasSpread && lowest && (
        <div className="px-4 sm:px-5 py-2.5 border-t border-stone-100 text-xs text-stone-600">
          Lowest quote: <span className="font-medium text-stone-900">{CURRENCY.format(lowest.quoted)}</span>{' '}
          from <span className="font-medium text-stone-900">{lowest.subName}</span>
          {delta > 0 && <> — Δ {CURRENCY.format(delta)} under highest.</>}
        </div>
      )}
    </section>
  )
}

function InsuranceCell({ insurance }: { insurance: QuoteMatrixRow['insurance'] }) {
  if (!insurance || !insurance.expiration) return <span className="text-stone-400">—</span>
  const exp = new Date(insurance.expiration)
  if (Number.isNaN(exp.getTime())) return <span className="text-stone-400">—</span>
  const now = new Date()
  const msPerDay = 24 * 60 * 60 * 1000
  const daysUntil = Math.floor((exp.getTime() - now.getTime()) / msPerDay)

  if (daysUntil < 0) {
    return <span className="inline-flex items-center gap-1 text-red-700 font-medium">✗ expired</span>
  }
  if (daysUntil <= 30) {
    const label = exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return <span className="inline-flex items-center gap-1 text-amber-700 font-medium">⚠ expires {label}</span>
  }
  return <CheckIcon />
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-4 h-4 text-emerald-600 inline-block"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}
