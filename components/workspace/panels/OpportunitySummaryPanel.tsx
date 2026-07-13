'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { format, differenceInDays } from 'date-fns'
import type { RichAttachment } from '@/lib/types/attachment'
import type { OpportunityBrief } from '@/lib/openai'
import type {
  ContractType,
  JobDescription,
  MarginBands,
  ResourceCategory,
  ResourceLine,
  ResourcePlan,
  PricingSheet,
} from '@/lib/types/resource-plan'
import OpportunityBriefCard from './OpportunityBriefCard'
import ResourcePlanCard from './ResourcePlanCard'
import PricingSheetCard from './PricingSheetCard'
import FormFillModal from './FormFillModal'
import AttachmentPreviewModal from '@/components/shared/AttachmentPreviewModal'

type ComparableConfidence = 'high' | 'medium' | 'low' | 'insufficient'
type ComparableMatchTier =
  | 'naics+agency+keywords'
  | 'naics+keywords'
  | 'naics+agency'
  | 'naics'
  | null

interface ComparableAward {
  id: string
  awardId: string
  recipientName: string
  awardAmount: number
  awardingAgency: string | null
  awardingOffice: string | null
  description: string | null
  popStart: string | null
  popEnd: string | null
  naicsCode: string | null
  pscCode: string | null
  solicitationId: string | null
  isRecompete: boolean
  isCurrentIncumbent: boolean
  fetchedAt: string
  matchTier: string
}

interface ComparableSummary {
  count: number
  p25: number
  median: number
  p75: number
  min: number
  max: number
  confidence: ComparableConfidence
  matchTier: ComparableMatchTier
  fetchedAt: string
  topIncumbent: { name: string; amount: number; popStart: string | null } | null
  currentIncumbent: { name: string; popEnd: string | null } | null
}

interface ComparablesPayload {
  summary: ComparableSummary
  awards: ComparableAward[]
}

interface OpportunitySummaryPanelProps {
  opportunity: {
    id: string
    title: string
    solicitationNumber: string
    agency?: string
    department?: string
    naicsCode?: string
    naicsDescription?: string
    pscCode?: string | null
    state?: string
    placeOfPerformance?: string
    description?: string
    postedDate?: string | Date
    responseDeadline?: string | Date
    status: string
    setAside?: string
    contractType?: string
    estimatedContractValue?: number
    sourceUrl?: string
    rawData?: any
    requirements?: string[]
    deliverables?: string[]
    periodOfPerformance?: string
    pointOfContact?: {
      name?: string
      email?: string
      phone?: string
    }
  }
  assessment?: {
    id?: string
    estimatedValue: number
    estimatedCost: number
    profitMarginPercent: number
    profitMarginDollar: number
    recommendation: string
    strategicValue?: string | null
    riskLevel?: string | null
    confidence?: string
    dataSource?: string
    notes?: string | null
    assessedAt?: string
    assessedBy?: { name: string; email: string }
    historicalData?: Array<{
      award_id?: string
      award_amount?: number
      awarding_agency_name?: string
      recipient_name?: string
      description?: string
      period_of_performance_start_date?: string
      period_of_performance_current_end_date?: string
      naics_code?: string
    }> | null
  } | null
  hasBid?: boolean
  hasSOW?: boolean
  hasSubcontractors?: boolean
  onGenerateSOW?: (selectedAttachments?: string[]) => void
  isGeneratingSOW?: boolean
  onFindSubcontractors?: () => void
  onCreateBid?: () => void
  onProceed?: () => void
  nextStep?: string
  brief?: OpportunityBrief | null
  isGeneratingBrief?: boolean
  onGenerateBrief?: () => void
  briefError?: string | null
  /** Shared attachment selection (parent-owned, survives panel switching).
   *  Same Set drives the email bundle and the SOW generator input. */
  selectedAttachments: Set<string>
  onToggleAttachment: (id: string) => void
  // Resource Plan + Pricing Sheet
  resourcePlan?: ResourcePlan | null
  pricingSheet?: PricingSheet | null
  isProcessing?: boolean
  onProcessOpportunity?: () => void
  isGeneratingResourcePlan?: boolean
  onGenerateResourcePlan?: () => void
  onEditResourceLine?: (lineId: string, patch: Partial<ResourceLine>) => void
  onAddResourceLine?: (category: ResourceCategory) => void
  onRemoveResourceLine?: (lineId: string) => void
  onOpenVendorSearchForLine?: (lineId: string) => void
  onUpdateJobDescription?: (lineId: string, patch: Partial<JobDescription>) => void
  onRegenerateJobDescription?: (lineId: string) => void
  regeneratingJdFor?: string | null
  onUpdatePricingSheet?: (patch: { userOverrideMarginPct?: number | null; marginBands?: MarginBands }) => void
  contractType?: ContractType
  contractTypeSource?: string | null
  contractTypeOverride?: boolean
  onUpdateContractType?: (nextType: ContractType) => void
}

export default function OpportunitySummaryPanel({
  opportunity,
  assessment,
  hasBid,
  hasSOW,
  hasSubcontractors,
  onGenerateSOW,
  isGeneratingSOW,
  onFindSubcontractors,
  onCreateBid,
  onProceed,
  nextStep,
  brief = null,
  isGeneratingBrief = false,
  onGenerateBrief,
  briefError = null,
  selectedAttachments,
  onToggleAttachment,
  resourcePlan = null,
  pricingSheet = null,
  isProcessing = false,
  onProcessOpportunity,
  isGeneratingResourcePlan = false,
  onGenerateResourcePlan,
  onEditResourceLine,
  onAddResourceLine,
  onRemoveResourceLine,
  onOpenVendorSearchForLine,
  onUpdateJobDescription,
  onRegenerateJobDescription,
  regeneratingJdFor = null,
  onUpdatePricingSheet,
  contractType = 'SERVICES',
  contractTypeSource = null,
  contractTypeOverride = false,
  onUpdateContractType,
}: OpportunitySummaryPanelProps) {
  const [attachments, setAttachments] = useState<RichAttachment[]>([])
  const [loadingAttachments, setLoadingAttachments] = useState(false)
  const [samGovUrl, setSamGovUrl] = useState('')
  const [hasParsedContent, setHasParsedContent] = useState(false)
  const [parsedSummary, setParsedSummary] = useState<{ parsedCount: number; totalAttachments: number; sections: string[] } | null>(null)
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false)
  const [viewingAttachment, setViewingAttachment] = useState<RichAttachment | null>(null)

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // AI analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // Attachment filter — which subset of the list to display
  const [attachmentFilter, setAttachmentFilter] = useState<'all' | 'forms' | 'documents' | 'edited'>('all')

  // Visible attachments under the active filter — drives the list,
  // the "Select all / Clear" bulk buttons, and the empty-filter message.
  const visibleAttachments = useMemo(
    () =>
      attachments.filter((att) => {
        if (attachmentFilter === 'forms') return att.formData?.isForm === true
        if (attachmentFilter === 'documents') return !att.formData?.isForm
        if (attachmentFilter === 'edited') return att.isEdited === true
        return true
      }),
    [attachments, attachmentFilter],
  )

  // Form fill modal
  const [fillingAttachment, setFillingAttachment] = useState<RichAttachment | null>(null)

  // Solicitation description expansion
  const [showSolicitation, setShowSolicitation] = useState(false)

  // Comparable past awards (USASpending.gov)
  const [comparables, setComparables] = useState<ComparablesPayload | null>(null)
  const [comparablesLoading, setComparablesLoading] = useState(false)

  const closeViewer = useCallback(() => setViewingAttachment(null), [])

  const deadline = opportunity.responseDeadline ? new Date(opportunity.responseDeadline) : null
  const daysLeft = deadline ? differenceInDays(deadline, new Date()) : null
  const postedDate = opportunity.postedDate ? new Date(opportunity.postedDate) : null

  const [realDescription, setRealDescription] = useState(opportunity.description || '')

  // Fetch attachments on mount
  useEffect(() => {
    const fetchAttachments = async () => {
      setLoadingAttachments(true)
      try {
        const res = await fetch(`/api/opportunities/${opportunity.id}/attachments`)
        if (res.ok) {
          const data = await res.json()
          setAttachments(data.attachments || [])
          setSamGovUrl(data.samGovUrl || '')
          setHasParsedContent(!!data.hasParsedContent)
          if (data.hasParsedContent && data.parsedAttachments) {
            const pa = data.parsedAttachments
            const sections: string[] = []
            if (pa.structured?.scope?.length) sections.push('Scope')
            if (pa.structured?.deliverables?.length) sections.push('Deliverables')
            if (pa.structured?.compliance?.length) sections.push('Compliance')
            if (pa.structured?.periodOfPerformance?.length) sections.push('Period of Performance')
            if (pa.structured?.qualifications?.length) sections.push('Qualifications')
            if (pa.structured?.evaluation?.length) sections.push('Evaluation Criteria')
            setParsedSummary({
              parsedCount: pa.parsedCount || 0,
              totalAttachments: pa.totalAttachments || 0,
              sections,
            })
          }
          if (data.description && data.description.length > 10) {
            setRealDescription(data.description)
          }
        }
      } catch (error) {
        console.error('Failed to fetch attachments:', error)
      } finally {
        setLoadingAttachments(false)
      }
    }
    fetchAttachments()
  }, [opportunity.id])

  // Auto-analyze attachments when they load (if any lack formData)
  useEffect(() => {
    if (!attachments.length || isAnalyzing) return
    // Retry when formData is missing OR when a prior attempt failed (null suggested name).
    const needsAnalysis = attachments.some(
      (att) => !att.formData || !att.formData.aiSuggestedName
    )
    if (!needsAnalysis) return

    const runAnalysis = async () => {
      setIsAnalyzing(true)
      setAnalyzeError(null)
      try {
        const res = await fetch(`/api/opportunities/${opportunity.id}/attachments/analyze`, {
          method: 'POST',
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          // Re-fetch attachments to get updated formData
          const attRes = await fetch(`/api/opportunities/${opportunity.id}/attachments`)
          if (attRes.ok) {
            const att = await attRes.json()
            setAttachments(att.attachments || [])
          }
        } else {
          setAnalyzeError(data.error || `Naming failed (${res.status})`)
        }
      } catch (err) {
        setAnalyzeError(err instanceof Error ? err.message : 'Network error')
      } finally {
        setIsAnalyzing(false)
      }
    }

    runAnalysis()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments.length > 0, opportunity.id])

  // Apply AI suggested name via the existing rename flow
  const applySuggestedName = useCallback(async (att: RichAttachment) => {
    const suggested = att.formData?.aiSuggestedName
    if (!suggested) return

    setSaving(true)
    try {
      const res = await fetch(
        `/api/opportunities/${opportunity.id}/attachments/${att.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentName: suggested }),
        }
      )
      const data = await res.json()
      if (res.ok) {
        setAttachments((prev) =>
          prev.map((a) => (a.id === att.id ? { ...data.attachment, formData: att.formData } : a))
        )
      }
    } catch {
      // Ignore
    } finally {
      setSaving(false)
    }
  }, [opportunity.id])

  // Start editing an attachment name
  const startEditing = useCallback((att: RichAttachment) => {
    const ext = getExtension(att.currentName)
    const base = ext ? att.currentName.slice(0, -ext.length) : att.currentName
    setEditingId(att.id)
    setEditingValue(base)
    setEditError(null)
  }, [])

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingId(null)
    setEditingValue('')
    setEditError(null)
  }, [])

  // Save rename via PATCH
  const saveRename = useCallback(async (att: RichAttachment) => {
    const ext = getExtension(att.currentName)
    const newName = editingValue.trim() + ext

    if (!editingValue.trim()) {
      setEditError('Name cannot be empty')
      return
    }

    if (/[/\\:*?"<>|]/.test(editingValue)) {
      setEditError('Invalid characters: / \\ : * ? " < > |')
      return
    }

    // Check for local duplicate (quick client-side check)
    const duplicate = attachments.some(
      (a) => a.id !== att.id && a.currentName.toLowerCase() === newName.toLowerCase()
    )
    if (duplicate) {
      setEditError('Name already in use')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(
        `/api/opportunities/${opportunity.id}/attachments/${att.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentName: newName }),
        }
      )
      const data = await res.json()
      if (!res.ok) {
        setEditError(data.error || 'Failed to save')
        return
      }
      // Update local state with the returned rich attachment
      setAttachments((prev) =>
        prev.map((a) => (a.id === att.id ? (data.attachment as RichAttachment) : a))
      )
      setEditingId(null)
      setEditingValue('')
      setEditError(null)
    } catch {
      setEditError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }, [editingValue, attachments, opportunity.id])

  const workflowState = getWorkflowState(hasSOW, hasSubcontractors, hasBid)

  // Fetch comparable past awards on mount
  useEffect(() => {
    let cancelled = false
    const fetchComparables = async () => {
      setComparablesLoading(true)
      try {
        const res = await fetch(`/api/opportunities/${opportunity.id}/comparables`)
        if (res.ok) {
          const data = (await res.json()) as ComparablesPayload
          if (!cancelled) setComparables(data)
        }
      } catch (error) {
        console.error('Failed to fetch comparables:', error)
      } finally {
        if (!cancelled) setComparablesLoading(false)
      }
    }
    fetchComparables()
    return () => {
      cancelled = true
    }
  }, [opportunity.id])

  return (
    <div className="h-full overflow-auto">
      {/* OPPORTUNITY BRIEF */}
      <div className="p-6 bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto space-y-4">
          <OpportunityBriefCard
            brief={brief}
            isGenerating={isGeneratingBrief}
            onGenerate={onGenerateBrief ?? (() => {})}
            opportunityTitle={opportunity.title}
            agency={opportunity.agency}
            error={briefError}
          />
        </div>
      </div>

      {/* RESOURCE PLAN + PRICING SHEET */}
      <div className="p-6 bg-stone-50 border-b border-stone-200">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex justify-end">
            <ContractTypePill
              contractType={contractType}
              contractTypeSource={contractTypeSource}
              contractTypeOverride={contractTypeOverride}
              onUpdate={onUpdateContractType}
            />
          </div>
          <ResourcePlanCard
            plan={resourcePlan}
            isGenerating={isGeneratingResourcePlan}
            onGenerate={onGenerateResourcePlan ?? (() => {})}
            onEditLine={onEditResourceLine ?? (() => {})}
            onAddLine={onAddResourceLine ?? (() => {})}
            onRemoveLine={onRemoveResourceLine ?? (() => {})}
            onOpenVendorSearch={onOpenVendorSearchForLine ?? (() => {})}
            onUpdateJobDescription={onUpdateJobDescription ?? (() => {})}
            onRegenerateJobDescription={onRegenerateJobDescription ?? (() => {})}
            regeneratingJdFor={regeneratingJdFor}
            contractType={contractType}
          />
          <PricingSheetCard
            sheet={pricingSheet}
            plan={resourcePlan}
            onUpdate={onUpdatePricingSheet ?? (() => {})}
          />
        </div>
      </div>

      {/* FIRST FOLD — quick actions only */}
      <div className="px-4 sm:px-6 py-4 bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={onProceed}
            className="px-4 py-2.5 text-sm font-medium text-white bg-stone-800 rounded hover:bg-stone-700 transition-colors inline-flex items-center gap-2 min-h-[44px]"
          >
            <span>{nextStep || workflowState.action}</span>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* BELOW FOLD */}
      <div className="p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Overview — AI narrative + full solicitation description */}
          <div className="p-5 bg-white border border-stone-200 rounded-lg space-y-4">
            <h2 className="text-sm font-semibold text-stone-800">Overview</h2>

            {brief?.extendedOverview ? (
              /* Extended AI narrative — richer multi-paragraph version */
              <div className="space-y-3">
                {brief.extendedOverview.split(/\n+/).filter(Boolean).map((para, i) => (
                  <p key={i} className="text-sm text-stone-700 leading-relaxed">{para}</p>
                ))}
              </div>
            ) : brief?.whatTheyAreBuying ? (
              /* Fallback: short summary from older brief */
              <p className="text-sm text-stone-700 leading-relaxed">{brief.whatTheyAreBuying}</p>
            ) : null}

            {brief && !brief.extendedOverview && (
              <p className="text-xs text-stone-400 italic">Regenerate the brief to get a full narrative overview.</p>
            )}

            {/* Full solicitation description — collapsible */}
            {realDescription && (
              <div className={brief?.whatTheyAreBuying ? 'pt-3 border-t border-stone-100' : ''}>
                <button
                  onClick={() => setShowSolicitation((v) => !v)}
                  className="flex items-center gap-2 w-full text-left group"
                >
                  <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider flex-1">
                    {brief?.whatTheyAreBuying ? 'From Solicitation' : 'Description'}
                  </p>
                  <svg
                    className={`h-3.5 w-3.5 text-stone-400 transition-transform flex-shrink-0 ${showSolicitation ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSolicitation && (
                  <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-wrap mt-2">
                    {realDescription}
                  </p>
                )}
              </div>
            )}

            {!brief?.whatTheyAreBuying && !realDescription && (
              <p className="text-sm text-stone-400 italic">No description available.</p>
            )}
          </div>

          {/* SAM.gov Attachments */}
          <div className="p-5 bg-white border border-stone-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
                <svg className="h-4 w-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                Solicitation Documents
              </h2>
              <div className="flex items-center gap-2">
                {isAnalyzing ? (
                  <span className="flex items-center gap-1.5 text-xs text-stone-400">
                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Analyzing…
                  </span>
                ) : attachments.length > 0 && (
                  <button
                    onClick={async () => {
                      setIsAnalyzing(true)
                      setAnalyzeError(null)
                      try {
                        const res = await fetch(`/api/opportunities/${opportunity.id}/attachments/analyze?force=true`, { method: 'POST' })
                        const data = await res.json().catch(() => ({}))
                        if (res.ok) {
                          const attRes = await fetch(`/api/opportunities/${opportunity.id}/attachments`)
                          if (attRes.ok) setAttachments((await attRes.json()).attachments || [])
                        } else {
                          setAnalyzeError(data.error || `Naming failed (${res.status})`)
                        }
                      } catch (err) {
                        setAnalyzeError(err instanceof Error ? err.message : 'Network error')
                      } finally { setIsAnalyzing(false) }
                    }}
                    className="text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
                    title="Re-analyze attachment names with AI"
                  >
                    Re-analyze names
                  </button>
                )}
              </div>
            </div>

            {analyzeError && (
              <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                <span className="font-medium">AI naming unavailable:</span> {analyzeError}
              </div>
            )}

            {attachments.length > 0 && (
              <div className="flex items-center gap-3 mb-2">
                <p className="text-xs text-stone-500">
                  {selectedAttachments.size} of {attachments.length} selected for email & SOW
                </p>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      visibleAttachments.forEach((a) => {
                        if (!selectedAttachments.has(a.id)) onToggleAttachment(a.id)
                      })
                    }}
                    className="text-[11px] text-stone-500 hover:text-stone-800 underline underline-offset-2"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      visibleAttachments.forEach((a) => {
                        if (selectedAttachments.has(a.id)) onToggleAttachment(a.id)
                      })
                    }}
                    className="text-[11px] text-stone-500 hover:text-stone-800 underline underline-offset-2"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {loadingAttachments ? (
              <div className="py-4 text-center text-stone-400 text-sm">
                Loading attachments...
              </div>
            ) : attachments.length > 0 ? (
              visibleAttachments.length > 0 ? (
                /* Cap visible height at ~5 rows so long attachment lists
                   don't push the rest of the summary panel off-screen. */
                <div className="max-h-[26rem] overflow-y-auto pr-1 space-y-2 -mr-1">
                  {visibleAttachments.map((att) => (
                    <AttachmentRow
                      key={att.id}
                      attachment={att}
                      opportunityId={opportunity.id}
                      isEditing={editingId === att.id}
                      editingValue={editingValue}
                      editError={editingId === att.id ? editError : null}
                      saving={saving}
                      selected={selectedAttachments.has(att.id)}
                      onToggleSelect={() => onToggleAttachment(att.id)}
                      onView={() => setViewingAttachment(att)}
                      onStartEdit={() => startEditing(att)}
                      onEditChange={(val) => {
                        setEditingValue(val)
                        setEditError(null)
                      }}
                      onSave={() => saveRename(att)}
                      onCancel={cancelEditing}
                      onUseSuggestion={() => applySuggestedName(att)}
                      onFillForm={() => setFillingAttachment(att)}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-stone-400">
                  No attachments match this filter
                </div>
              )
            ) : (
              <div className="py-4 text-center">
                <p className="text-sm text-stone-500 mb-3">No attachments found in database</p>
                {samGovUrl && (
                  <a
                    href={samGovUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-700 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
                  >
                    View on SAM.gov
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            )}

            {/* Filter buttons + parsed-count indicator */}
            {attachments.length > 0 && (
              <div className="mt-3 pt-3 border-t border-stone-100">
                <div className="flex items-center gap-2 flex-wrap">
                  {([
                    { key: 'all', label: 'All', count: attachments.length },
                    { key: 'forms', label: 'Forms', count: attachments.filter((a) => a.formData?.isForm).length },
                    { key: 'documents', label: 'Documents', count: attachments.filter((a) => !a.formData?.isForm).length },
                    { key: 'edited', label: 'Edited', count: attachments.filter((a) => a.isEdited).length },
                  ] as const).map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setAttachmentFilter(f.key)}
                      className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                        attachmentFilter === f.key
                          ? 'bg-stone-800 text-white'
                          : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                      }`}
                    >
                      {f.label} {f.count > 0 && <span className="opacity-60">({f.count})</span>}
                    </button>
                  ))}
                  {hasParsedContent && parsedSummary && (
                    <span className="text-[10px] text-stone-400 ml-auto">
                      {parsedSummary.parsedCount}/{parsedSummary.totalAttachments} parsed
                    </span>
                  )}
                </div>
              </div>
            )}

            {samGovUrl && attachments.length > 0 && (
              <div className="mt-3 pt-3 border-t border-stone-100">
                <a
                  href={samGovUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-stone-500 hover:text-stone-700 flex items-center gap-1"
                >
                  View full solicitation on SAM.gov →
                </a>
              </div>
            )}
          </div>

          {/* Comparable Past Awards (USASpending.gov) */}
          {comparables && comparables.awards.length > 0 && (
            <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-stone-100">
                <h3 className="text-sm font-semibold text-stone-800">Comparable Past Awards</h3>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  USASpending.gov · n={comparables.summary.count}
                  {opportunity.naicsCode && ` · NAICS ${opportunity.naicsCode}`}
                  {opportunity.pscCode && ` · PSC ${opportunity.pscCode}`}
                  {' · '}fetched {format(new Date(comparables.summary.fetchedAt), 'yyyy-MM-dd')}
                  {' · '}{comparables.summary.confidence} confidence
                  {comparables.summary.matchTier && ` · tier=${comparables.summary.matchTier}`}
                </p>
              </div>

              {/* Current incumbent callout */}
              {comparables.summary.currentIncumbent && (
                <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-900">
                  <span className="font-semibold">Current incumbent:</span> {comparables.summary.currentIncumbent.name}
                  {comparables.summary.currentIncumbent.popEnd && (
                    <> — contract expires {format(new Date(comparables.summary.currentIncumbent.popEnd), 'MMM yyyy')}</>
                  )}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 text-stone-500 uppercase tracking-wide text-[10px]">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Awardee (incumbent)</th>
                      <th className="text-left px-4 py-2 font-medium">Agency</th>
                      <th className="text-right px-4 py-2 font-medium">Amount</th>
                      <th className="text-left px-4 py-2 font-medium">Period</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {comparables.awards.slice(0, 10).map((c, i) => {
                      const start = c.popStart ? format(new Date(c.popStart), 'MMM yyyy') : null
                      const end = c.popEnd ? format(new Date(c.popEnd), 'MMM yyyy') : null
                      return (
                        <tr key={c.id || c.awardId || i} className="hover:bg-stone-50">
                          <td className="px-4 py-2 text-stone-800 font-medium">
                            <div className="flex items-center gap-2">
                              <span>{c.recipientName || '—'}</span>
                              {c.isRecompete && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                                  Recompete
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-stone-600">{c.awardingAgency || '—'}</td>
                          <td className="px-4 py-2 text-right text-stone-900 font-semibold tabular-nums">
                            ${(c.awardAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-4 py-2 text-stone-500">
                            {start && end ? `${start} – ${end}` : start || end || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Attachment Selection Modal for SOW generation */}
      {showAttachmentPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30">
          <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900">Select Attachments for SOW</h3>
              <p className="text-xs text-stone-500 mt-1">Choose which documents to include in the SOW</p>
            </div>
            <div className="px-5 py-3 max-h-60 overflow-y-auto">
              <div className="space-y-2">
                {attachments.map((att) => (
                  <label
                    key={att.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-stone-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAttachments.has(att.id)}
                      onChange={() => onToggleAttachment(att.id)}
                      className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-stone-700 truncate">{att.currentName}</p>
                      {att.size && (
                        <p className="text-xs text-stone-400">{formatFileSize(att.size)}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-stone-200 flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    // Toggle every currently-unselected attachment → all selected
                    attachments.forEach(a => {
                      if (!selectedAttachments.has(a.id)) onToggleAttachment(a.id)
                    })
                  }}
                  className="text-xs text-stone-500 hover:text-stone-700"
                >
                  Select All
                </button>
                <button
                  onClick={() => {
                    // Toggle every currently-selected attachment → all cleared
                    attachments.forEach(a => {
                      if (selectedAttachments.has(a.id)) onToggleAttachment(a.id)
                    })
                  }}
                  className="text-xs text-stone-500 hover:text-stone-700"
                >
                  Select None
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAttachmentPicker(false)}
                  className="px-3 py-1.5 text-sm text-stone-600 bg-white border border-stone-300 rounded hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowAttachmentPicker(false)
                    onGenerateSOW?.(Array.from(selectedAttachments))
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-stone-800 rounded hover:bg-stone-700"
                >
                  Generate SOW ({selectedAttachments.size} attachment{selectedAttachments.size !== 1 ? 's' : ''})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form fill modal */}
      {fillingAttachment && (
        <FormFillModal
          opportunityId={opportunity.id}
          attachmentId={fillingAttachment.id}
          attachmentName={fillingAttachment.currentName}
          proxyUrl={`/api/opportunities/${opportunity.id}/attachments/${fillingAttachment.id}/proxy`}
          existingFields={fillingAttachment.formData?.fields ?? null}
          onClose={() => setFillingAttachment(null)}
          onSaved={(savedFields) => {
            setAttachments((prev) =>
              prev.map((a) =>
                a.id === fillingAttachment.id
                  ? { ...a, formData: a.formData ? { ...a.formData, fields: savedFields, filledAt: new Date().toISOString() } : null }
                  : a
              )
            )
          }}
        />
      )}

      {/* Inline attachment viewer modal — full screen on mobile */}
      {viewingAttachment && (
        <AttachmentPreviewModal
          attachments={attachments}
          currentId={viewingAttachment.id}
          opportunityId={opportunity.id}
          onChange={(id) => {
            const next = attachments.find(a => a.id === id)
            if (next) setViewingAttachment(next)
          }}
          onClose={closeViewer}
          selected={selectedAttachments.has(viewingAttachment.id)}
          onToggleSelect={() => onToggleAttachment(viewingAttachment.id)}
        />
      )}
    </div>
  )
}

// ─── AttachmentRow ────────────────────────────────────────────────────────────

interface AttachmentRowProps {
  attachment: RichAttachment
  opportunityId: string
  isEditing: boolean
  editingValue: string
  editError: string | null
  saving: boolean
  selected: boolean
  onToggleSelect: () => void
  onView: () => void
  onStartEdit: () => void
  onEditChange: (val: string) => void
  onSave: () => void
  onCancel: () => void
  onUseSuggestion: () => void
  onFillForm: () => void
}

function AttachmentRow({
  attachment,
  opportunityId,
  isEditing,
  editingValue,
  editError,
  saving,
  selected,
  onToggleSelect,
  onView,
  onStartEdit,
  onEditChange,
  onSave,
  onCancel,
  onUseSuggestion,
  onFillForm,
}: AttachmentRowProps) {
  const ext = getExtension(attachment.currentName)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSave()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50 overflow-hidden hover:border-stone-300 hover:bg-stone-100/50 transition-colors">
      <div className="flex items-center gap-2 p-3">
        {/* Include-in-email checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          disabled={isEditing}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500 flex-shrink-0 disabled:opacity-40"
          title={selected ? 'Selected for email & SOW' : 'Add to email & SOW'}
        />
        {/* File icon — clickable to view */}
        <button
          type="button"
          onClick={onView}
          disabled={isEditing}
          className="text-stone-400 hover:text-stone-700 flex-shrink-0 disabled:cursor-default"
          title="View attachment"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </button>

        {/* Name area */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="text"
                value={editingValue}
                onChange={(e) => onEditChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className={`flex-1 text-sm text-stone-800 bg-white border rounded px-2 py-0.5 outline-none focus:ring-1 ${
                  editError
                    ? 'border-red-400 focus:ring-red-300'
                    : 'border-stone-300 focus:ring-stone-300'
                }`}
                disabled={saving}
              />
              {ext && (
                <span className="text-sm text-stone-400 flex-shrink-0">{ext}</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onView}
                className="text-sm text-stone-700 truncate font-medium text-left hover:text-stone-900 hover:underline underline-offset-2"
                title="View attachment"
              >
                {attachment.currentName}
              </button>
              {/* FORM badge */}
              {attachment.formData?.isForm && (
                <span
                  className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-semibold bg-stone-700 text-white rounded"
                  title={attachment.formData.formType ?? 'Government Form'}
                >
                  {attachment.formData.formType ?? 'FORM'}
                </span>
              )}
            </div>
          )}

          {/* AI suggested name row — only when no manual rename and suggestion exists */}
          {!isEditing && !attachment.isEdited && attachment.formData?.aiSuggestedName && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-stone-400 italic truncate flex-1 min-w-0">
                Suggested: {attachment.formData.aiSuggestedName}
              </span>
              {attachment.formData.aiConfidence === 'MEDIUM' && (
                <span className="flex-shrink-0 px-1 py-0.5 text-[9px] font-medium bg-amber-50 text-amber-600 border border-amber-200 rounded" title="Medium confidence">?</span>
              )}
              {attachment.formData.aiConfidence === 'LOW' && (
                <span className="flex-shrink-0 px-1 py-0.5 text-[9px] font-medium bg-red-50 text-red-500 border border-red-200 rounded" title="Low confidence">?</span>
              )}
              <button
                onClick={onUseSuggestion}
                disabled={saving}
                className="flex-shrink-0 text-[10px] font-medium text-stone-500 hover:text-stone-700 underline underline-offset-2 disabled:opacity-40 transition-colors"
              >
                Use suggestion
              </button>
            </div>
          )}

          {/* Metadata row */}
          {!isEditing && (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {attachment.isEdited && attachment.originalName !== attachment.currentName && (
                <span className="text-xs text-stone-400 truncate">
                  Original: {attachment.originalName}
                </span>
              )}
              {attachment.size && (
                <span className="text-xs text-stone-400">{formatFileSize(attachment.size)}</span>
              )}
              {attachment.postedDate && (
                <span className="text-xs text-stone-400">
                  Added {format(new Date(attachment.postedDate), 'MMM d yyyy')}
                </span>
              )}
              <span className="text-xs text-stone-400">SAM.gov</span>
              {attachment.isEdited && (
                <span
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded"
                  title={
                    attachment.editedBy && attachment.editedAt
                      ? `Renamed by ${attachment.editedBy} on ${format(new Date(attachment.editedAt), 'MMM d, yyyy h:mm a')}`
                      : attachment.editedAt
                      ? `Renamed on ${format(new Date(attachment.editedAt), 'MMM d, yyyy h:mm a')}`
                      : 'Renamed'
                  }
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  edited
                </span>
              )}
              {attachment.formData?.filledAt && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-stone-100 text-stone-600 rounded">
                  filled
                </span>
              )}
            </div>
          )}

          {/* Validation error */}
          {isEditing && editError && (
            <p className="text-xs text-red-500 mt-0.5">{editError}</p>
          )}
        </div>

        {/* Actions */}
        {isEditing ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onSave}
              disabled={saving || !editingValue.trim()}
              className="px-2.5 py-1 text-xs font-medium text-white bg-stone-700 rounded hover:bg-stone-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              className="px-2.5 py-1 text-xs font-medium text-stone-600 bg-white border border-stone-300 rounded hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* View */}
            <button
              onClick={onView}
              className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
              title="View"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            {/* Download */}
            <a
              href={`/api/opportunities/${opportunityId}/attachments/${attachment.id}/proxy?download=1`}
              download
              className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
              title="Download"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>
            {/* Fill Form button — only for detected forms */}
            {attachment.formData?.isForm && (
              <button
                onClick={onFillForm}
                className="px-2 py-1 text-[10px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 rounded transition-colors flex-shrink-0"
                title={`Fill ${attachment.formData.formType ?? 'form'}`}
              >
                Fill Form
              </button>
            )}
            {/* Rename */}
            <button
              onClick={onStartEdit}
              className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
              title="Rename"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Contract Lifecycle & Action Plan ────────────────────────────────────────

// ─── Helper Components ────────────────────────────────────────────────────────

interface ContractTypePillProps {
  contractType: ContractType
  contractTypeSource: string | null
  contractTypeOverride: boolean
  onUpdate?: (nextType: ContractType) => void
}

function ContractTypePill({
  contractType,
  contractTypeSource,
  contractTypeOverride,
  onUpdate,
}: ContractTypePillProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ContractType>(contractType)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setSelected(contractType)
  }, [contractType])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const label = contractType === 'PRODUCT' ? 'Product procurement' : 'Services contract'
  const tooltip = contractTypeSource || 'Auto-detected'

  const handleSave = () => {
    if (selected !== contractType) onUpdate?.(selected)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={tooltip}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-stone-100 text-stone-700 border border-stone-200 hover:bg-stone-200 transition-colors"
      >
        <span>{label}</span>
        <svg
          className={`h-3 w-3 text-stone-500 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-60 bg-white border border-stone-200 rounded shadow-sm p-3 text-sm">
          <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-2">
            Contract type
          </p>
          <label className="flex items-center gap-2 py-1 cursor-pointer">
            <input
              type="radio"
              name="contract-type"
              value="SERVICES"
              checked={selected === 'SERVICES'}
              onChange={() => setSelected('SERVICES')}
              className="h-3.5 w-3.5 text-stone-800 focus:ring-stone-500 border-stone-300"
            />
            <span className="text-stone-700">Services contract</span>
          </label>
          <label className="flex items-center gap-2 py-1 cursor-pointer">
            <input
              type="radio"
              name="contract-type"
              value="PRODUCT"
              checked={selected === 'PRODUCT'}
              onChange={() => setSelected('PRODUCT')}
              className="h-3.5 w-3.5 text-stone-800 focus:ring-stone-500 border-stone-300"
            />
            <span className="text-stone-700">Product procurement</span>
          </label>
          {contractTypeSource && (
            <p className="mt-2 pt-2 border-t border-stone-100 text-[11px] text-stone-500 leading-snug">
              {contractTypeSource}
            </p>
          )}
          {contractTypeOverride && (
            <p className="mt-1 text-[11px] text-stone-500 italic">
              Currently locked by user override
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-stone-500 hover:text-stone-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={selected === contractType}
              className="px-2.5 py-1 text-xs font-medium text-white bg-stone-800 rounded hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === 0) return ''
  return filename.slice(lastDot)
}

function getWorkflowState(hasSOW?: boolean, hasSubcontractors?: boolean, hasBid?: boolean) {
  if (!hasSOW) return { step: 1, action: 'Generate SOW', panel: 'sow' }
  if (!hasSubcontractors) return { step: 2, action: 'Find Subcontractors', panel: 'subcontractors' }
  if (!hasBid) return { step: 3, action: 'Create Bid', panel: 'bid' }
  return { step: 4, action: 'Review & Submit', panel: 'bid' }
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} bytes`
}
