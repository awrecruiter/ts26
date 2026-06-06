'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

interface ChecklistItem {
  id: string
  label: string
  checked: boolean
}

interface Subcontractor {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  website?: string | null
  address?: string | null
  service?: string | null
  rating?: number | null
  totalRatings?: number | null
  businessStatus?: string | null
  placeId?: string | null
  source?: string
  verificationStatus?: string | null
  certifications?: string[]
  ueiNumber?: string | null
  contactName?: string | null
  quotedAmount?: number | null
  isActualQuote?: boolean
  callCompleted?: boolean
  callCompletedAt?: string | null
  /** Straight-line distance in km from the place of performance. Null = unknown. */
  distanceKm?: number | null
  contactEmail?: string | null
  checklistState?: ChecklistItem[] | null
  deliverableChecks?: number[] | null
  sowSentAt?: string | null
  workflowCompletedAt?: string | null
}

type StepState = 'done' | 'current' | 'pending'

function StepBadge({ n, state }: { n: 1 | 2 | 3; state: StepState }) {
  const base = 'h-5 w-5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0'
  if (state === 'done') {
    return (
      <span className={`${base} bg-stone-800 text-white`} aria-label={`Step ${n} complete`}>
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  return (
    <span
      className={state === 'current' ? `${base} bg-stone-800 text-white` : `${base} bg-stone-100 text-stone-400`}
      aria-label={`Step ${n}`}
    >
      {n}
    </span>
  )
}

interface SubcontractorPanelProps {
  subcontractors: Subcontractor[]
  opportunityId: string
  naicsCode?: string
  state?: string
  placeOfPerformance?: { city: string | null, state: string | null }
  onRequestQuote?: (sub: Subcontractor) => void
  onSendDetails?: (sub: Subcontractor) => void
  /** Direct-send for Step 2 SOW: skips the email composer and fires the
   *  Gmail send inline. Returns success or an error string. */
  onSendSowDirect?: (sub: Subcontractor, email: string) => Promise<{ success: boolean; error?: string }>
  onSubcontractorsUpdated?: () => void
  /** Apply a per-vendor patch to the parent's state without refetching the
   *  whole opportunity. Use this for save email / mark call / sowSentAt
   *  stamping — anything that should feel instant and not blink the panel. */
  onSubPatchOptimistic?: (subId: string, patch: Partial<Subcontractor>) => void
  /** Parent-controlled expanded card so post-send flows can collapse. */
  expandedSubcontractorId?: string | null
  onExpandedSubcontractorChange?: (id: string | null) => void
  parsedRequirements?: { qualifications: string[], compliance: string[], scope: string[] }
  opportunityInfo?: { naicsCode?: string, state?: string, setAside?: string }
  keyDeliverables?: Array<{ item: string; frequency?: string }>
  /** AI-generated yes/no screening questions from aiArtifacts.callChecklist.
   *  When present, replaces the deterministic rule-based seed list. */
  aiCallChecklist?: string[]
  /** Spinner while artifacts are being (re)generated. */
  isGeneratingArtifacts?: boolean
  /** Per-artifact regenerate handler. */
  onRegenerateChecklist?: () => void | Promise<void>
}

function buildAIChecklist(items: string[]): ChecklistItem[] {
  return items
    .map(s => s.trim())
    .filter(s => s.length > 5)
    .map((label, i) => ({ id: `ai-${i}`, label, checked: false }))
}

function buildDefaultChecklist(
  parsedReqs?: { qualifications: string[], compliance: string[], scope: string[] },
  opportunityInfo?: { naicsCode?: string, state?: string, setAside?: string }
): ChecklistItem[] {
  const items: ChecklistItem[] = []
  let idx = 0
  const addItem = (label: string) => {
    items.push({ id: `default-${idx++}`, label, checked: false })
  }

  if (opportunityInfo?.naicsCode) {
    addItem(`NAICS code match (${opportunityInfo.naicsCode})`)
  }
  addItem('Place of performance capability')
  addItem('Available for timeline')
  if (opportunityInfo?.setAside) {
    addItem(`Set-aside eligibility: ${opportunityInfo.setAside}`)
  }

  // Pull at most a few well-formed qualification gates from the parsed solicitation.
  // The parser collects raw lines under matched section headers, so we have to
  // reject sentence fragments, bullet leftovers, FAR/citation prose, and anything
  // truncated — otherwise the checklist becomes a brain dump.
  if (parsedReqs?.qualifications?.length) {
    const KEYWORD = /\b(bond(?:ed|ing)?|certif|licens|clearance|insurance|past performance|capability statement)\b/i
    let autoAdded = 0
    for (const raw of parsedReqs.qualifications) {
      if (autoAdded >= 3) break
      const q = raw.trim()
      if (q.length < 25 || q.length > 100) continue
      if (!/^[A-Z]/.test(q)) continue                    // must start a sentence
      if (/[…]|\.{3}|\[NEEDS DETAIL/i.test(q)) continue  // no truncation/placeholders
      if (/^[•\-*]/.test(q)) continue                    // no bullet leftovers
      if (/\b\d{1,3}[A-Z]?\d{0,4}\.\d/.test(q)) continue // no FAR/CFR citations (e.g. 52.219-14, 5X236.604)
      if (/\([A-Z]{2,5}\/\/[A-Z]+\)/.test(q)) continue   // no classification markings (TS//NF)
      if (!KEYWORD.test(q)) continue
      addItem(q)
      autoAdded++
    }
  }

  return items
}

const RADIUS_TIERS = [25, 50, 100, 250] as const
type RadiusMiles = typeof RADIUS_TIERS[number]

export default function SubcontractorPanel({
  subcontractors,
  opportunityId,
  naicsCode,
  state,
  placeOfPerformance,
  onRequestQuote,
  onSendDetails,
  onSendSowDirect,
  onSubcontractorsUpdated,
  onSubPatchOptimistic,
  expandedSubcontractorId,
  onExpandedSubcontractorChange,
  parsedRequirements,
  opportunityInfo,
  keyDeliverables = [],
  aiCallChecklist,
  isGeneratingArtifacts,
  onRegenerateChecklist,
}: SubcontractorPanelProps) {
  const [filter, setFilter] = useState<'all' | 'quoted' | 'pending'>('all')
  const [isSearching, setIsSearching] = useState(false)
  const [isCleaning, setIsCleaning] = useState(false)
  const [localExpandedCard, setLocalExpandedCard] = useState<string | null>(null)
  const expandedCard = expandedSubcontractorId ?? localExpandedCard
  const setExpandedCard = (id: string | null) => {
    if (onExpandedSubcontractorChange) onExpandedSubcontractorChange(id)
    else setLocalExpandedCard(id)
  }
  const [apiError, setApiError] = useState<string | null>(null)
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null)
  const [radiusMiles, setRadiusMiles] = useState<RadiusMiles>(50)
  const [expandStatus, setExpandStatus] = useState<string | null>(null)
  // Track email input per vendor (local state until saved)
  const [emailInputs, setEmailInputs] = useState<Record<string, string>>({})
  // Track optimistic call state (in case server is slow)
  const [optimisticCalls, setOptimisticCalls] = useState<Record<string, boolean>>({})
  const [samWarning, setSamWarning] = useState<string | null>(null)
  const [samStatus, setSamStatus] = useState<{
    searched: boolean
    totalRecords: number
    added: number
    error: string | null
  } | null>(null)
  const [checklistState, setChecklistState] = useState<Record<string, ChecklistItem[]>>({})
  const [deliverableChecks, setDeliverableChecks] = useState<Record<string, Set<number>>>({})

  const checklistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const deliverableTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    setChecklistState(prev => {
      const next = { ...prev }
      let dirty = false
      for (const sub of subcontractors) {
        if (next[sub.id]) continue
        if (Array.isArray(sub.checklistState) && sub.checklistState.length > 0) {
          next[sub.id] = sub.checklistState
          dirty = true
        }
      }
      return dirty ? next : prev
    })
    setDeliverableChecks(prev => {
      const next = { ...prev }
      let dirty = false
      for (const sub of subcontractors) {
        if (next[sub.id]) continue
        if (Array.isArray(sub.deliverableChecks)) {
          next[sub.id] = new Set(sub.deliverableChecks)
          dirty = true
        }
      }
      return dirty ? next : prev
    })
  }, [subcontractors])

  const persistChecklist = useCallback((subId: string, items: ChecklistItem[]) => {
    if (checklistTimers.current[subId]) clearTimeout(checklistTimers.current[subId])
    checklistTimers.current[subId] = setTimeout(() => {
      fetch(`/api/opportunities/${opportunityId}/subcontractors/${subId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklistState: items }),
      }).catch(() => {})
    }, 600)
  }, [opportunityId])

  const persistDeliverables = useCallback((subId: string, set: Set<number>) => {
    if (deliverableTimers.current[subId]) clearTimeout(deliverableTimers.current[subId])
    deliverableTimers.current[subId] = setTimeout(() => {
      fetch(`/api/opportunities/${opportunityId}/subcontractors/${subId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverableChecks: Array.from(set).sort((a, b) => a - b) }),
      }).catch(() => {})
    }, 600)
  }, [opportunityId])

  const toggleDeliverable = (subId: string, idx: number) => {
    setDeliverableChecks((prev) => {
      const next = new Set(prev[subId] || [])
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      const updated = { ...prev, [subId]: next }
      persistDeliverables(subId, next)
      return updated
    })
  }
  const [newChecklistItem, setNewChecklistItem] = useState<Record<string, string>>({})

  const isCallCompleted = (sub: Subcontractor) => {
    return optimisticCalls[sub.id] ?? sub.callCompleted ?? false
  }

  const filtered = subcontractors.filter((sub) => {
    // Pending = SOW sent, awaiting vendor's quote response.
    if (filter === 'pending') return !!sub.sowSentAt && sub.quotedAmount == null
    // Quoted = vendor responded with a quote
    if (filter === 'quoted') return sub.quotedAmount != null
    return true
  })

  // "Pending" = SOW has been sent, awaiting vendor's quote response.
  // sowSentAt is the single source of truth (callCompleted is legacy and
  // may have been set by old workflows without an actual SOW going out).
  const activeVendors = filtered.filter(sub => !sub.sowSentAt)
  const pendingVendors = filtered.filter(sub => !!sub.sowSentAt)
  const hasBothGroups = activeVendors.length > 0 && pendingVendors.length > 0

  const getEmailInput = (sub: Subcontractor) => {
    return emailInputs[sub.id] ?? sub.email ?? ''
  }

  const getChecklist = (subId: string): ChecklistItem[] => {
    if (!checklistState[subId]) {
      const stored = subcontractors.find(s => s.id === subId)?.checklistState
      if (Array.isArray(stored) && stored.length > 0) {
        setChecklistState(prev => ({ ...prev, [subId]: stored }))
        return stored
      }
      const defaults = aiCallChecklist && aiCallChecklist.length > 0
        ? buildAIChecklist(aiCallChecklist)
        : buildDefaultChecklist(parsedRequirements, opportunityInfo)
      setChecklistState(prev => ({ ...prev, [subId]: defaults }))
      return defaults
    }
    return checklistState[subId]
  }

  // When AI checklist arrives later, replace any sub's rule-based seed that
  // the user hasn't touched yet (no checked items, no custom additions).
  useEffect(() => {
    if (!aiCallChecklist || aiCallChecklist.length === 0) return
    setChecklistState(prev => {
      let dirty = false
      const next = { ...prev }
      for (const [subId, items] of Object.entries(prev)) {
        const untouched =
          items.length > 0 &&
          items.every(it => it.id.startsWith('default-') && !it.checked)
        if (untouched) {
          next[subId] = buildAIChecklist(aiCallChecklist)
          dirty = true
        }
      }
      return dirty ? next : prev
    })
  }, [aiCallChecklist])

  const toggleChecklistItem = (subId: string, itemId: string) => {
    setChecklistState(prev => {
      const updated = (prev[subId] || []).map(item =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )
      persistChecklist(subId, updated)
      return { ...prev, [subId]: updated }
    })
  }

  const addChecklistItem = (subId: string) => {
    const text = newChecklistItem[subId]?.trim()
    if (!text) return
    const newItem: ChecklistItem = {
      id: `custom-${Date.now()}`,
      label: text,
      checked: false,
    }
    setChecklistState(prev => {
      const updated = [...(prev[subId] || []), newItem]
      persistChecklist(subId, updated)
      return { ...prev, [subId]: updated }
    })
    setNewChecklistItem(prev => ({ ...prev, [subId]: '' }))
  }

  const removeChecklistItem = (subId: string, itemId: string) => {
    setChecklistState(prev => {
      const updated = (prev[subId] || []).filter(item => item.id !== itemId)
      persistChecklist(subId, updated)
      return { ...prev, [subId]: updated }
    })
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const hasValidEmail = (sub: Subcontractor) => {
    const e = (emailInputs[sub.id] || sub.email || '').trim()
    return e.length > 0 && EMAIL_RE.test(e)
  }

  const samCount = subcontractors.filter(s => s.source === 'sam_gov').length
  const googleCount = subcontractors.filter(s => s.source === 'google_places').length

  const handleAutoDiscover = async () => {
    setIsSearching(true)
    setApiError(null)
    setCleanupMessage(null)
    setSamWarning(null)
    setSamStatus(null)
    setExpandStatus(null)

    const startIdx = RADIUS_TIERS.indexOf(radiusMiles)

    try {
      for (let i = startIdx; i < RADIUS_TIERS.length; i++) {
        const currentRadius = RADIUS_TIERS[i]
        if (i > startIdx) {
          setExpandStatus(`No results at ${RADIUS_TIERS[i - 1]}mi — searching ${currentRadius}mi...`)
        }

        const res = await fetch(`/api/opportunities/${opportunityId}/subcontractors/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ radiusMiles: currentRadius }),
        })
        const data = await res.json()

        if (!res.ok || data.error) {
          setApiError(data.message || data.error || 'Discovery failed')
          break
        }

        if (data.samWarning) setSamWarning(data.samWarning)
        if (data.sam) setSamStatus(data.sam)

        if (data.added > 0) {
          setRadiusMiles(currentRadius)
          setExpandStatus(null)
          onSubcontractorsUpdated?.()
          break
        }

        // 0 results — if we've exhausted all tiers, refresh anyway
        if (i === RADIUS_TIERS.length - 1) {
          onSubcontractorsUpdated?.()
        }
      }
    } catch (error) {
      console.error('Auto-discover failed:', error)
      setApiError('Failed to connect to discovery service')
    } finally {
      setIsSearching(false)
      setExpandStatus(null)
    }
  }

  const handleCleanDuplicates = async () => {
    setIsCleaning(true)
    setCleanupMessage(null)
    setApiError(null)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/subcontractors/deduplicate`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        setApiError(data.message || data.error || 'Cleanup failed')
      } else {
        setCleanupMessage(data.message)
        if (data.deleted > 0) {
          onSubcontractorsUpdated?.()
        }
      }
    } catch (error) {
      console.error('Dedup failed:', error)
      setApiError('Failed to clean duplicates')
    } finally {
      setIsCleaning(false)
    }
  }

  const handleDismiss = async (sub: Subcontractor) => {
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/subcontractors/${sub.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onSubcontractorsUpdated?.()
      }
    } catch (error) {
      console.error('Failed to dismiss subcontractor:', error)
    }
  }

  const handleToggleCall = async (sub: Subcontractor) => {
    const newValue = !isCallCompleted(sub)
    setOptimisticCalls(prev => ({ ...prev, [sub.id]: newValue }))

    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/subcontractors/${sub.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callCompleted: newValue }),
      })
      if (res.ok) {
        onSubPatchOptimistic?.(sub.id, {
          callCompleted: newValue,
          callCompletedAt: newValue ? new Date().toISOString() : null,
        })
      } else {
        setOptimisticCalls(prev => ({ ...prev, [sub.id]: !newValue }))
      }
    } catch {
      setOptimisticCalls(prev => ({ ...prev, [sub.id]: !newValue }))
    }
  }

  const handleSaveEmail = (sub: Subcontractor) => {
    const email = emailInputs[sub.id]?.trim()
    if (!email) return
    // Truly optimistic: UI updates first, server in the background.
    onSubPatchOptimistic?.(sub.id, { email })
    fetch(`/api/opportunities/${opportunityId}/subcontractors/${sub.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch((error) => {
      console.error('Failed to save email:', error)
    })
  }

  const [sendingSowId, setSendingSowId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<{ id: string; msg: string } | null>(null)
  // Synchronous guard against double-click races (React state updates lag).
  const sendInFlightRef = useRef<Set<string>>(new Set())

  const handleSendSOW = useCallback(async (sub: Subcontractor) => {
    if (sendInFlightRef.current.has(sub.id)) return
    if (sub.sowSentAt) return // already sent — button should be disabled anyway

    const liveEmail = (emailInputs[sub.id] ?? sub.email ?? '').trim()
    if (!liveEmail || !EMAIL_RE.test(liveEmail)) return

    // Persist email in the background if it isn't saved yet.
    if (liveEmail !== (sub.email || '')) {
      handleSaveEmail(sub)
    }

    sendInFlightRef.current.add(sub.id)
    if (onSendSowDirect) {
      setSendingSowId(sub.id)
      setSendError(null)
      const result = await onSendSowDirect(sub, liveEmail)
      setSendingSowId(null)
      sendInFlightRef.current.delete(sub.id)
      if (!result.success) {
        setSendError({ id: sub.id, msg: result.error || 'Send failed' })
      }
      return
    }
    if (onSendDetails) onSendDetails(sub)
    sendInFlightRef.current.delete(sub.id)
  }, [emailInputs, onSendSowDirect, onSendDetails])

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-stone-900">Subcontractors</h1>
              <p className="text-sm text-stone-500 mt-1">
                {subcontractors.length} vendor{subcontractors.length !== 1 ? 's' : ''}
                {googleCount > 0 && samCount > 0
                  ? ` — ${googleCount} Google, ${samCount} SAM.gov`
                  : googleCount > 0
                  ? ' from Google Maps'
                  : samCount > 0
                  ? ' from SAM.gov'
                  : ''}
              </p>
              {subcontractors.length > 0 && (
                <p className="text-xs text-stone-500 mt-1">
                  {subcontractors.filter(v => v.sowSentAt).length} of {subcontractors.length} quotes requested
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Clean Duplicates Button */}
              {subcontractors.length > 1 && (
                <button
                  onClick={handleCleanDuplicates}
                  disabled={isCleaning}
                  className="px-3 py-2 text-xs font-medium text-stone-500 bg-white border border-stone-200 rounded hover:bg-stone-50 transition-colors disabled:opacity-50 flex items-center gap-1.5 min-h-[44px]"
                  title="Remove duplicate vendors"
                >
                  {isCleaning ? (
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                  {isCleaning ? 'Cleaning...' : 'Clean Duplicates'}
                </button>
              )}

              {/* Radius Dropdown */}
              <select
                value={radiusMiles}
                onChange={(e) => setRadiusMiles(Number(e.target.value) as RadiusMiles)}
                disabled={isSearching}
                className="px-2 py-2 text-xs font-medium text-stone-600 bg-white border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-stone-300 disabled:opacity-50 min-h-[44px]"
                title="Search radius"
              >
                {RADIUS_TIERS.map(r => (
                  <option key={r} value={r}>{r}mi</option>
                ))}
              </select>

              {/* Find Vendors Button */}
              <button
                onClick={handleAutoDiscover}
                disabled={isSearching}
                className="px-3 py-2 text-xs font-medium text-stone-600 bg-white border border-stone-300 rounded hover:bg-stone-50 transition-colors disabled:opacity-50 flex items-center gap-1.5 min-h-[44px]"
              >
                <svg className={`h-3.5 w-3.5 ${isSearching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isSearching ? (expandStatus ? 'Expanding...' : 'Searching...') : 'Find Vendors'}
              </button>
            </div>
          </div>

          {/* Geography label */}
          <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-400">
            <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {expandStatus ? (
              <span className="text-stone-500 italic">{expandStatus}</span>
            ) : placeOfPerformance?.city && placeOfPerformance?.state ? (
              <span>Searching within <span className="font-medium text-stone-600">{radiusMiles}mi</span> of <span className="font-medium text-stone-600">{placeOfPerformance.city}, {placeOfPerformance.state}</span></span>
            ) : placeOfPerformance?.state ? (
              <span>Searching within <span className="font-medium text-stone-600">{placeOfPerformance.state}</span> (statewide)</span>
            ) : (
              <span>Searching nationally</span>
            )}
          </div>
        </div>

        {/* API Error Banner */}
        {apiError && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-amber-700">{apiError}</p>
              </div>
              <button onClick={() => setApiError(null)} className="text-amber-500 hover:text-amber-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Cleanup Success Banner */}
        {cleanupMessage && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-green-700">{cleanupMessage}</p>
              <button onClick={() => setCleanupMessage(null)} className="ml-auto text-green-500 hover:text-green-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* SAM.gov Empty Result Banner — only when no error and nothing added */}
        {!samWarning && samStatus?.searched && samStatus.added === 0 && (
          <div className="mb-4 p-3 bg-stone-50 border border-stone-200 rounded-lg flex items-start gap-3">
            <svg className="h-4 w-4 text-stone-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-xs text-stone-600">
                <span className="font-medium text-stone-700">SAM.gov:</span>{' '}
                {samStatus.totalRecords === 0
                  ? 'No SAM-registered vendors matched this NAICS code'
                  : `${samStatus.totalRecords} SAM-registered ${samStatus.totalRecords === 1 ? 'vendor matches' : 'vendors match'} this NAICS code, but all were duplicates of existing Google Maps results`}
                {samStatus.totalRecords > 0 ? '.' : ' in this geography.'}
              </p>
            </div>
            <button onClick={() => setSamStatus(null)} className="text-stone-400 hover:text-stone-600">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* SAM.gov Warning Banner */}
        {samWarning && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800 mb-1">SAM.gov Entity Search Unavailable</p>
                <p className="text-xs text-amber-700">{samWarning}</p>
              </div>
              <button onClick={() => setSamWarning(null)} className="text-amber-500 hover:text-amber-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 bg-stone-100 p-1 rounded-lg mb-4 w-fit">
          {(['all', 'pending', 'quoted'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                filter === f
                  ? 'bg-white text-stone-800 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {f === 'all' ? 'All' : f === 'quoted' ? 'Quoted' : 'Pending'}
            </button>
          ))}
        </div>

        {/* Vendor Cards — Active vendors first, then Pending */}
        <div className="space-y-3">
          {[...activeVendors, ...pendingVendors].map((sub, idx) => {
            const callDone = isCallCompleted(sub)
            const emailValue = getEmailInput(sub)
            const hasEmail = hasValidEmail(sub)
            const isSamGov = sub.source === 'sam_gov'
            const certs = sub.certifications || []

            // Divider sits between the last active vendor and the first pending one.
            const showDivider = hasBothGroups && !!sub.sowSentAt && idx === activeVendors.length

            return (
              <div key={sub.id}>
                {showDivider && (
                  <div className="flex items-center gap-3 py-3 mb-3">
                    <div className="flex-1 h-px bg-stone-200" />
                    <span className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">
                      Pending — Awaiting Quote Response
                    </span>
                    <div className="flex-1 h-px bg-stone-200" />
                  </div>
                )}
                <div
                  className={`rounded-lg overflow-hidden border ${
                    callDone
                      ? 'bg-stone-50/70 border-stone-200/60'
                      : 'bg-white border-stone-200'
                  }`}
                >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Name + Source Badge + Rating */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-sm font-medium text-stone-900 truncate">
                          {sub.name}
                        </h3>

                        {/* Source Badge */}
                        {isSamGov ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-800 rounded">
                            <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            SAM.gov
                          </span>
                        ) : sub.source === 'google_places' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-stone-100 text-stone-500 rounded">
                            Google Maps
                          </span>
                        ) : null}

                        {callDone && (
                          <>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-stone-200 text-stone-500 rounded">
                              &#10003; Called
                            </span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded">
                              {hasEmail ? 'Ready for SOW' : 'Needs email'}
                            </span>
                          </>
                        )}

                        {sub.rating != null && (
                          <span className="flex items-center gap-1 text-xs text-stone-500">
                            <svg className="h-3.5 w-3.5 fill-amber-400" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                            <span className="font-medium text-stone-700">{sub.rating.toFixed(1)}</span>
                            {sub.totalRatings != null && (
                              <span className="text-stone-400">({sub.totalRatings.toLocaleString()})</span>
                            )}
                          </span>
                        )}

                        {/* Distance from place of performance (Google Places vendors only) */}
                        {sub.distanceKm != null && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-stone-100 text-stone-500 rounded"
                            title="Straight-line distance from place of performance"
                          >
                            <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {sub.distanceKm < 2
                              ? 'On-site'
                              : `${Math.round(sub.distanceKm / 1.60934)} mi away`}
                          </span>
                        )}
                      </div>

                      {/* Certification Tags (SAM.gov vendors) */}
                      {certs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {certs.map((cert, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 rounded"
                            >
                              {cert}
                            </span>
                          ))}
                        </div>
                      )}

                      {sub.service && (
                        <p className="text-xs text-stone-500 mb-2">{sub.service}</p>
                      )}

                      {/* Contact Info */}
                      <div className="space-y-1.5 mt-3">
                        {/* SAM.gov contact name */}
                        {isSamGov && sub.contactName && (
                          <p className="text-xs text-stone-600 flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5 text-stone-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            {sub.contactName}
                          </p>
                        )}

                        {sub.phone && (
                          <a href={`tel:${sub.phone}`} className="text-xs text-stone-700 hover:text-stone-900 flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            {sub.phone}
                          </a>
                        )}

                        {sub.address && (
                          <p className="text-xs text-stone-500 flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5 text-stone-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="truncate">{sub.address}</span>
                          </p>
                        )}

                        {sub.website && (
                          <a
                            href={sub.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-stone-600 hover:text-stone-800 flex items-center gap-1.5"
                          >
                            <svg className="h-3.5 w-3.5 text-stone-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                            </svg>
                            <span className="truncate">{sub.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                          </a>
                        )}

                        {/* UEI for SAM.gov vendors */}
                        {isSamGov && sub.ueiNumber && (
                          <p className="text-xs text-stone-400 flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5 text-stone-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                            </svg>
                            UEI: {sub.ueiNumber}
                          </p>
                        )}
                      </div>

                      {/* Quote status */}
                      {sub.quotedAmount != null && (
                        <div className="mt-3 inline-flex items-center gap-2 px-2 py-1 bg-stone-100 rounded text-xs text-stone-600">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Quote: ${sub.quotedAmount.toLocaleString()}
                        </div>
                      )}
                    </div>

                    {/* Right side: Actions */}
                    <div className="flex flex-row sm:flex-col gap-2 flex-shrink-0">
                      {/* Dismiss — permanent removal */}
                      <button
                        onClick={() => handleDismiss(sub)}
                        className="px-3 py-2 text-xs text-stone-400 hover:text-red-600 transition-colors min-h-[44px] flex items-center"
                        title="Remove vendor permanently"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => setExpandedCard(expandedCard === sub.id ? null : sub.id)}
                        className="px-3 py-2 text-xs text-stone-500 hover:text-stone-700 flex items-center justify-center gap-1 min-h-[44px]"
                      >
                        {expandedCard === sub.id ? 'Less' : 'Actions'}
                        <svg className={`h-3 w-3 transition-transform ${expandedCard === sub.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded: Email → Send → Mark Complete. Call sits above as
                    a helper that doesn't gate the numbered sequence. */}
                {expandedCard === sub.id && (
                  <div className="px-4 pb-4 pt-3 border-t border-stone-100 bg-stone-50">
                    {/* Helper: phone link only. Marking complete lives at Step 3. */}
                    {sub.phone && !callDone && (
                      <div className="flex items-center gap-3 mb-4">
                        <a
                          href={`tel:${sub.phone}`}
                          className="px-3 py-2 text-xs font-medium text-stone-600 bg-white border border-stone-300 rounded hover:bg-stone-50 transition-colors"
                        >
                          Call {sub.phone}
                        </a>
                      </div>
                    )}

                    {/* Call Checklist — only visible before call is marked complete */}
                    {!callDone && (
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-stone-500 flex items-center gap-2">
                            Call Checklist
                            {isGeneratingArtifacts && (
                              <svg className="animate-spin h-3 w-3 text-stone-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            )}
                          </p>
                          {onRegenerateChecklist && !isGeneratingArtifacts && (
                            <button
                              onClick={() => onRegenerateChecklist()}
                              className="text-[11px] text-stone-400 hover:text-stone-600 transition-colors"
                              title="Regenerate AI screening questions"
                            >
                              Regenerate
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {getChecklist(sub.id).map((item) => (
                            <div key={item.id} className="flex items-center gap-2 group">
                              <button
                                onClick={() => toggleChecklistItem(sub.id, item.id)}
                                className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                                  item.checked
                                    ? 'bg-stone-600 border-stone-600'
                                    : 'border-stone-300 hover:border-stone-400'
                                }`}
                              >
                                {item.checked && (
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                              <span className={`text-xs flex-1 ${item.checked ? 'text-stone-400 line-through' : 'text-stone-700'}`}>
                                {item.label}
                              </span>
                              <button
                                onClick={() => removeChecklistItem(sub.id, item.id)}
                                className="text-stone-300 hover:text-stone-500 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <input
                            type="text"
                            value={newChecklistItem[sub.id] || ''}
                            onChange={(e) => setNewChecklistItem(prev => ({ ...prev, [sub.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') addChecklistItem(sub.id) }}
                            placeholder="Add item..."
                            className="flex-1 px-2 py-1 text-xs border border-stone-200 rounded focus:ring-1 focus:ring-stone-300 focus:border-stone-300"
                          />
                          <button
                            onClick={() => addChecklistItem(sub.id)}
                            className="px-2 py-1 text-xs font-medium text-stone-500 hover:text-stone-700 border border-stone-200 rounded hover:bg-stone-50"
                          >
                            +
                          </button>
                        </div>

                        {/* Key Deliverables — check off as vendor confirms during the call */}
                        {keyDeliverables.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-stone-200">
                            <p className="text-xs font-medium text-stone-500 mb-2">
                              Can deliver
                              <span className="ml-2 text-stone-400 font-normal">
                                ({(deliverableChecks[sub.id]?.size || 0)}/{keyDeliverables.length})
                              </span>
                            </p>
                            <div className="space-y-1.5">
                              {keyDeliverables.map((d, i) => {
                                const checked = deliverableChecks[sub.id]?.has(i) ?? false
                                return (
                                  <div key={i} className="flex items-start gap-2">
                                    <button
                                      onClick={() => toggleDeliverable(sub.id, i)}
                                      className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center mt-0.5 transition-colors ${
                                        checked
                                          ? 'bg-stone-600 border-stone-600'
                                          : 'border-stone-300 hover:border-stone-400'
                                      }`}
                                    >
                                      {checked && (
                                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </button>
                                    <span className={`text-xs flex-1 ${checked ? 'text-stone-400 line-through' : 'text-stone-700'}`}>
                                      {d.item}
                                      {d.frequency && (
                                        <span className="ml-2 text-stone-400">({d.frequency})</span>
                                      )}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                      </div>
                    )}

                    {/* Step 1: Email — first action. Always enabled. */}
                    <div className="mb-4 flex items-start gap-3">
                      <div className="pt-6">
                        <StepBadge n={1} state={hasEmail ? 'done' : 'current'} />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium mb-1.5 text-stone-600">
                          Vendor Email Address
                        </label>
                        <input
                          type="email"
                          value={emailValue}
                          onChange={(e) => setEmailInputs(prev => ({ ...prev, [sub.id]: e.target.value }))}
                          onBlur={() => {
                            const v = (emailInputs[sub.id] ?? '').trim()
                            if (v && v !== (sub.email || '') && EMAIL_RE.test(v)) handleSaveEmail(sub)
                          }}
                          placeholder="Enter vendor email..."
                          className="w-full px-3 py-2 text-sm border border-stone-200 rounded focus:ring-2 focus:ring-stone-300 focus:border-stone-300 bg-white"
                        />
                      </div>
                    </div>

                    {/* Step 2: Send SOW — illuminates when a valid email is saved.
                        After a successful send the button greys out (done state)
                        and the vendor auto-moves to the Pending group. */}
                    <div className="flex items-center gap-3">
                      <StepBadge n={2} state={sub.sowSentAt ? 'done' : hasEmail ? 'current' : 'pending'} />
                      <button
                        onClick={() => handleSendSOW(sub)}
                        disabled={!hasEmail || sendingSowId === sub.id || !!sub.sowSentAt}
                        className={`flex-1 px-4 py-2.5 text-sm font-medium rounded transition-colors ${
                          sub.sowSentAt
                            ? 'bg-stone-100 text-stone-500 cursor-default'
                            : hasEmail
                            ? 'bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-60'
                            : 'bg-stone-100 text-stone-400 cursor-not-allowed'
                        }`}
                      >
                        {sendingSowId === sub.id
                          ? 'Sending…'
                          : sub.sowSentAt
                          ? '✓ SOW Sent'
                          : hasEmail
                          ? 'Send SOW'
                          : 'Enter email to send SOW'}
                      </button>
                    </div>
                    {sendError && sendError.id === sub.id && (
                      <p className="text-xs text-red-500 mt-2">{sendError.msg}</p>
                    )}

                  </div>
                )}
              </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-stone-100 flex items-center justify-center">
                <svg className="h-6 w-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-sm text-stone-500 mb-2">
                {filter === 'all' ? 'No vendors found yet' :
                 filter === 'pending' ? 'No vendors awaiting a quote — send a SOW to move a vendor here.' :
                 'No quotes received yet — quotes appear here once vendors reply by email'}
              </p>
              <button
                onClick={handleAutoDiscover}
                className="text-sm text-stone-600 hover:text-stone-800 font-medium"
              >
                Find vendors via Google Maps + SAM.gov
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
