'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { format, differenceInDays } from 'date-fns'
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout'
import OpportunitySummaryPanel from '@/components/workspace/panels/OpportunitySummaryPanel'
import BidEditorPanel from '@/components/workspace/panels/BidEditorPanel'
import SubcontractorPanel from '@/components/workspace/panels/SubcontractorPanel'
import EmailDraftPanel from '@/components/workspace/panels/EmailDraftPanel'
import ScopeOverviewPanel from '@/components/workspace/panels/ScopeOverviewPanel'
import AgentActivityPanel from '@/components/workspace/panels/AgentActivityPanel'
import PreworkPanel from '@/components/workspace/panels/PreworkPanel'
import type { RichAttachment } from '@/lib/types/attachment'
import type { ContractType, JobDescription, ResourceCategory, ResourceLine, MarginBands } from '@/lib/types/resource-plan'
import { extractCity, extractStateCode } from '@/lib/opportunity-classification'

export default function OpportunityWorkspacePage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const [opportunity, setOpportunity] = useState<any>(null)
  const [assessment, setAssessment] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activePanel, setActivePanel] = useState('summary')
  const [selectedSubcontractor, setSelectedSubcontractor] = useState<any>(null)
  const [expandedSubcontractorId, setExpandedSubcontractorId] = useState<string | null>(null)
  const [emailTemplateType, setEmailTemplateType] = useState<'quote_request' | 'follow_up' | 'custom'>('quote_request')
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [discoveringSubcontractors, setDiscoveringSubcontractors] = useState(false)
  const [solicitationAttachments, setSolicitationAttachments] = useState<RichAttachment[]>([])
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set())
  const [generatingArtifacts, setGeneratingArtifacts] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isGeneratingResourcePlan, setIsGeneratingResourcePlan] = useState(false)
  const [regeneratingJdFor, setRegeneratingJdFor] = useState<string | null>(null)
  const artifactsRequestedRef = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [oppRes, assessRes] = await Promise.all([
        fetch(`/api/opportunities/${params.id}`),
        fetch(`/api/opportunities/${params.id}/assessment`),
      ])

      if (oppRes.ok) {
        const oppData = await oppRes.json()
        setOpportunity(oppData.opportunity)
      }
      if (assessRes.ok) {
        const assessData = await assessRes.json()
        setAssessment(assessData.assessment)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Fetch solicitation attachments for SOW panel and email panel
  useEffect(() => {
    if (!opportunity?.id) return
    fetch(`/api/opportunities/${opportunity.id}/attachments`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.attachments) {
          const atts: RichAttachment[] = data.attachments
          setSolicitationAttachments(atts)
          // Initialize selection to all attachments (default all selected).
          // Shared between Summary panel checkboxes, Email bundle, and SOW input.
          setSelectedAttachments(prev => {
            // Only initialize if not yet set
            if (prev.size === 0) return new Set(atts.map((a) => a.id))
            return prev
          })
        }
      })
      .catch(() => {})
  }, [opportunity?.id])

  // Auto-generate unified AI artifacts (brief, callChecklist, scopeOverview,
  // agentBriefing) the first time we have parsed attachments but no cached
  // artifacts. Single request, fires once per page session.
  useEffect(() => {
    if (!opportunity?.id) return
    if (opportunity.aiArtifacts) return
    if (!opportunity.parsedAttachments) return
    if (artifactsRequestedRef.current) return
    artifactsRequestedRef.current = true
    setGeneratingArtifacts(true)
    fetch(`/api/opportunities/${opportunity.id}/artifacts`, { method: 'POST' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.artifacts) {
          setOpportunity((prev: any) => prev ? { ...prev, aiArtifacts: data.artifacts } : prev)
        }
      })
      .catch(() => {})
      .finally(() => setGeneratingArtifacts(false))
  }, [opportunity?.id, opportunity?.parsedAttachments, opportunity?.aiArtifacts])

  // Shared attachment selection — read/written by Summary panel checkboxes and
  // Email panel Select All / Deselect All / per-row toggles. Same Set drives
  // the outgoing email bundle and the SOW generator input.
  const handleToggleAttachment = useCallback((id: string) => {
    setSelectedAttachments(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const handleSetAttachmentSelection = useCallback((next: Set<string>) => {
    setSelectedAttachments(next)
  }, [])

  const handleRegenerateArtifact = useCallback(async (artifact: 'brief' | 'callChecklist' | 'scopeOverview' | 'agentBriefing') => {
    if (!opportunity?.id) return
    setGeneratingArtifacts(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/artifacts?artifact=${artifact}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.artifacts) {
        setOpportunity((prev: any) => prev ? { ...prev, aiArtifacts: data.artifacts } : prev)
      }
    } finally {
      setGeneratingArtifacts(false)
    }
  }, [opportunity?.id])

  const handleCreateBid = async () => {
    try {
      const res = await fetch('/api/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId: opportunity.id }),
      })
      if (res.ok) {
        await fetchData()
        setActivePanel('bid')
      }
    } catch (err) {
      console.error('Failed to create bid:', err)
    }
  }

  const handleGenerateBrief = async () => {
    if (!opportunity?.id) return
    setBriefError(null)
    try {
      setGeneratingBrief(true)
      const res = await fetch(`/api/opportunities/${opportunity.id}/brief`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setOpportunity((prev: any) => ({ ...prev, opportunityBrief: data.brief }))
      } else {
        setBriefError(data.error || `Brief generation failed (${res.status})`)
      }
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setGeneratingBrief(false)
    }
  }

  const handleProcessOpportunity = useCallback(async () => {
    if (!opportunity?.id) return
    setIsProcessing(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/process`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.opportunity) {
        setOpportunity(data.opportunity)
      }
    } catch (err) {
      console.error('Failed to process opportunity:', err)
    } finally {
      setIsProcessing(false)
    }
  }, [opportunity?.id])

  const handleGenerateResourcePlan = useCallback(async () => {
    if (!opportunity?.id) return
    setIsGeneratingResourcePlan(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/resource-plan`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setOpportunity((prev: any) => prev
          ? { ...prev, resourcePlan: data.resourcePlan, pricingSheet: data.pricingSheet }
          : prev)
      }
    } catch (err) {
      console.error('Failed to generate resource plan:', err)
    } finally {
      setIsGeneratingResourcePlan(false)
    }
  }, [opportunity?.id])

  const patchResourcePlan = useCallback(async (patch: {
    lines?: ResourceLine[]
    primeCoordinationHours?: number | null
    bondingRequired?: boolean
    insuranceMinimums?: string[]
  }) => {
    if (!opportunity?.id) return
    // Optimistic update
    setOpportunity((prev: any) => prev
      ? { ...prev, resourcePlan: { ...(prev.resourcePlan || {}), ...patch } }
      : prev)
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/resource-plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setOpportunity((prev: any) => prev
          ? { ...prev, resourcePlan: data.resourcePlan, pricingSheet: data.pricingSheet }
          : prev)
      }
    } catch (err) {
      console.error('Failed to patch resource plan:', err)
    }
  }, [opportunity?.id])

  const handleEditResourceLine = useCallback((lineId: string, patch: Partial<ResourceLine>) => {
    const current = opportunity?.resourcePlan?.lines as ResourceLine[] | undefined
    if (!current) return
    const nextLines = current.map(line => line.id === lineId ? { ...line, ...patch } : line)
    void patchResourcePlan({ lines: nextLines })
  }, [opportunity?.resourcePlan, patchResourcePlan])

  const handleAddResourceLine = useCallback((category: ResourceCategory) => {
    const current = (opportunity?.resourcePlan?.lines as ResourceLine[] | undefined) ?? []
    const id = `line_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const blank: ResourceLine = {
      id,
      category,
      label: 'New line',
      valueDescription: '',
      riskLevel: 'medium',
    }
    void patchResourcePlan({ lines: [...current, blank] })
  }, [opportunity?.resourcePlan, patchResourcePlan])

  const handleRemoveResourceLine = useCallback((lineId: string) => {
    const current = opportunity?.resourcePlan?.lines as ResourceLine[] | undefined
    if (!current) return
    void patchResourcePlan({ lines: current.filter(line => line.id !== lineId) })
  }, [opportunity?.resourcePlan, patchResourcePlan])

  const handleUpdateJobDescription = useCallback((lineId: string, patch: Partial<JobDescription>) => {
    const current = opportunity?.resourcePlan?.lines as ResourceLine[] | undefined
    if (!current) return
    const nextLines = current.map(line => {
      if (line.id !== lineId) return line
      const jd = line.jobDescription ?? {
        roleTitle: line.label,
        summary: line.valueDescription,
        responsibilities: [],
        requiredQualifications: [],
        placeOfWork: '',
        compensationBasis: '',
        reportingLine: 'Reports to Prime Project Manager.',
        generatedAt: new Date().toISOString(),
      }
      return { ...line, jobDescription: { ...jd, ...patch } }
    })
    void patchResourcePlan({ lines: nextLines })
  }, [opportunity?.resourcePlan, patchResourcePlan])

  const handleRegenerateJobDescription = useCallback(async (lineId: string) => {
    if (!opportunity?.id) return
    setRegeneratingJdFor(lineId)
    try {
      const res = await fetch(
        `/api/opportunities/${opportunity.id}/resource-plan/lines/${lineId}/job-description`,
        { method: 'POST' },
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.jobDescription) {
        handleUpdateJobDescription(lineId, data.jobDescription)
      }
    } catch (err) {
      console.error('Failed to regenerate JD:', err)
    } finally {
      setRegeneratingJdFor(null)
    }
  }, [opportunity?.id, handleUpdateJobDescription])

  const handleUpdatePricingSheet = useCallback(async (patch: {
    userOverrideMarginPct?: number | null
    marginBands?: MarginBands
  }) => {
    if (!opportunity?.id) return
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/pricing-sheet`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.pricingSheet) {
        setOpportunity((prev: any) => prev ? { ...prev, pricingSheet: data.pricingSheet } : prev)
      }
    } catch (err) {
      console.error('Failed to update pricing sheet:', err)
    }
  }, [opportunity?.id])

  const handleUpdateContractType = useCallback(async (nextType: ContractType) => {
    if (!opportunity?.id) return
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}/contract-type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractType: nextType, override: true }),
      })
      if (res.ok) await fetchData()
    } catch (err) {
      console.error('Failed to update contract type:', err)
    }
  }, [opportunity?.id, fetchData])

  const handleOpenVendorSearchForLine = useCallback(async (lineId: string) => {
    if (!opportunity?.id) return
    setActivePanel('subcontractors')
    try {
      await fetch(`/api/opportunities/${opportunity.id}/subcontractors/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceLineId: lineId }),
      })
      await fetchData()
    } catch (err) {
      console.error('Failed to discover for line:', err)
    }
  }, [opportunity?.id, fetchData])

  // Discover subcontractors for this opportunity
  const handleDiscoverSubcontractors = async () => {
    try {
      setDiscoveringSubcontractors(true)
      const res = await fetch(`/api/opportunities/${opportunity.id}/subcontractors/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        await fetchData()
        setActivePanel('subcontractors')
      }
    } catch (err) {
      console.error('Failed to discover subcontractors:', err)
    } finally {
      setDiscoveringSubcontractors(false)
    }
  }

  const handleSaveBid = async (amount: number) => {
    const bid = opportunity?.bids?.[0]
    if (!bid) return

    await fetch(`/api/bids/${bid.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendedPrice: amount }),
    })
    await fetchData()
  }

  const handleBidStatusChange = async (status: string) => {
    const bid = opportunity?.bids?.[0]
    if (!bid) return

    await fetch(`/api/bids/${bid.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await fetchData()
  }

  // Extract place of performance for SubcontractorPanel geo-radius UI
  const placeOfPerformanceData = useMemo(() => ({
    city: opportunity?.rawData ? extractCity(opportunity.rawData) : null,
    state: opportunity?.rawData
      ? (extractStateCode(opportunity.rawData) || opportunity?.state || null)
      : (opportunity?.state || null),
  }), [opportunity?.rawData, opportunity?.state])

  if (loading) {
    return (
      <div className="h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-stone-300 border-t-stone-600"></div>
          <p className="mt-3 text-sm text-stone-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || !opportunity) {
    return (
      <div className="h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-stone-600 mb-4">{error || 'Not found'}</p>
          <button
            onClick={() => router.push('/opportunities')}
            className="px-4 py-2 text-sm text-stone-600 bg-white border border-stone-300 rounded hover:bg-stone-50"
          >
            Back to opportunities
          </button>
        </div>
      </div>
    )
  }

  const deadline = opportunity.responseDeadline ? new Date(opportunity.responseDeadline) : null
  const daysLeft = deadline ? differenceInDays(deadline, new Date()) : null
  const currentBid = opportunity.bids?.[0]
  const hasSubcontractors = (opportunity.subcontractors?.length || 0) > 0
  const hasQuotedSubcontractors = opportunity.subcontractors?.some((s: any) => s.quotedAmount != null)

  // Workflow order: Subcontractors → Bid → Review & Submit
  const getWorkflowState = () => {
    if (!hasSubcontractors) return { step: 1, action: 'Find Subcontractors', panel: 'subcontractors' as const }
    if (!currentBid) return { step: 2, action: 'Create Bid', panel: 'bid' as const }
    return { step: 3, action: 'Review & Submit', panel: 'bid' as const }
  }
  const workflowState = getWorkflowState()

  // Handle proceed action - navigate to the next workflow step
  const handleProceed = async () => {
    const state = getWorkflowState()
    if (state.step === 1) {
      await handleDiscoverSubcontractors()
    } else if (state.step === 2) {
      await handleCreateBid()
    } else {
      setActivePanel('bid')
    }
  }

  // Determine next action (Workflow: Subs → Bid → Submit)
  let nextAction = workflowState.action
  if (currentBid?.status === 'DRAFT') {
    nextAction = 'Review bid'
  } else if (currentBid?.status === 'REVIEWED') {
    nextAction = 'Submit bid'
  }

  // Progress tracking (workflow order: Subs → Bid → Submit)
  const progress = {
    subcontractorsFound: hasSubcontractors,
    quotesReceived: hasQuotedSubcontractors,
    bidCreated: !!currentBid,
    bidSubmitted: currentBid?.status === 'SUBMITTED',
  }

  // Build panels
  const panels = [
    {
      id: 'summary',
      label: 'Summary',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
        </svg>
      ),
      content: (
        <OpportunitySummaryPanel
          opportunity={opportunity}
          assessment={assessment}
          hasBid={!!currentBid}
          hasSubcontractors={hasSubcontractors}
          brief={opportunity?.aiArtifacts?.brief ?? opportunity?.opportunityBrief ?? null}
          isGeneratingBrief={generatingBrief || generatingArtifacts}
          onGenerateBrief={() => handleRegenerateArtifact('brief')}
          briefError={briefError}
          selectedAttachments={selectedAttachments}
          onToggleAttachment={handleToggleAttachment}
          resourcePlan={opportunity?.resourcePlan ?? null}
          isProcessing={isProcessing}
          onProcessOpportunity={handleProcessOpportunity}
          isGeneratingResourcePlan={isGeneratingResourcePlan}
          onGenerateResourcePlan={handleGenerateResourcePlan}
          onEditResourceLine={handleEditResourceLine}
          onAddResourceLine={handleAddResourceLine}
          onRemoveResourceLine={handleRemoveResourceLine}
          onOpenVendorSearchForLine={handleOpenVendorSearchForLine}
          onUpdateJobDescription={handleUpdateJobDescription}
          onRegenerateJobDescription={handleRegenerateJobDescription}
          regeneratingJdFor={regeneratingJdFor}
          contractType={(opportunity?.contractType === 'PRODUCT' ? 'PRODUCT' : 'SERVICES') as ContractType}
          contractTypeSource={opportunity?.contractTypeSource ?? null}
          contractTypeOverride={!!opportunity?.contractTypeOverride}
          onUpdateContractType={handleUpdateContractType}
        />
      ),
    },
    {
      id: 'scope',
      label: 'Compliance',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
      content: (
        <ScopeOverviewPanel
          opportunity={opportunity}
          assessment={assessment}
          brief={opportunity?.aiArtifacts?.brief ?? opportunity?.opportunityBrief ?? null}
          aiScope={opportunity?.aiArtifacts?.scopeOverview ?? null}
        />
      ),
    },
    {
      id: 'subcontractors',
      label: 'Subcontractors',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      content: (
        <SubcontractorPanel
          subcontractors={opportunity.subcontractors || []}
          opportunityId={opportunity.id}
          naicsCode={opportunity.naicsCode}
          state={opportunity.state}
          placeOfPerformance={placeOfPerformanceData}
          parsedRequirements={opportunity.parsedAttachments?.structured}
          opportunityInfo={{ naicsCode: opportunity.naicsCode, state: opportunity.state, setAside: opportunity.setAside }}
          keyDeliverables={opportunity.aiArtifacts?.brief?.keyDeliverables || opportunity.opportunityBrief?.keyDeliverables || []}
          aiCallChecklist={opportunity.aiArtifacts?.callChecklist}
          isGeneratingArtifacts={generatingArtifacts}
          onRegenerateChecklist={() => handleRegenerateArtifact('callChecklist')}
          onRequestQuote={(sub) => {
            setSelectedSubcontractor(sub)
            setEmailTemplateType('quote_request')
            setActivePanel('email')
          }}
          onSendDetails={(sub) => {
            setSelectedSubcontractor(sub)
            setEmailTemplateType('follow_up')
            setActivePanel('email')
          }}
          onSubPatchOptimistic={(subId, patch) => {
            setOpportunity((prev: any) => prev ? {
              ...prev,
              subcontractors: prev.subcontractors?.map((s: any) =>
                s.id === subId ? { ...s, ...patch } : s
              ),
            } : prev)
          }}
          onMarkSowSent={async (sub) => {
            if (sub.sowSentAt) return { success: true }
            const nowIso = new Date().toISOString()
            // Optimistic — flip the card to Pending immediately.
            setOpportunity((prev: any) => prev ? {
              ...prev,
              subcontractors: prev.subcontractors?.map((s: any) =>
                s.id === sub.id
                  ? { ...s, sowSentAt: nowIso, callCompleted: true, callCompletedAt: nowIso }
                  : s
              ),
            } : prev)
            try {
              const res = await fetch(`/api/opportunities/${opportunity.id}/subcontractors/${sub.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sowSent: true, callCompleted: true }),
              })
              if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                // Revert.
                setOpportunity((prev: any) => prev ? {
                  ...prev,
                  subcontractors: prev.subcontractors?.map((s: any) =>
                    s.id === sub.id
                      ? { ...s, sowSentAt: null, callCompleted: false, callCompletedAt: null }
                      : s
                  ),
                } : prev)
                return { success: false, error: data.error || `Mark failed (${res.status})` }
              }
              return { success: true }
            } catch (e) {
              setOpportunity((prev: any) => prev ? {
                ...prev,
                subcontractors: prev.subcontractors?.map((s: any) =>
                  s.id === sub.id
                    ? { ...s, sowSentAt: null, callCompleted: false, callCompletedAt: null }
                    : s
                ),
              } : prev)
              return { success: false, error: e instanceof Error ? e.message : 'Network error' }
            }
          }}
          onSubcontractorsUpdated={fetchData}
          expandedSubcontractorId={expandedSubcontractorId}
          onExpandedSubcontractorChange={setExpandedSubcontractorId}
        />
      ),
    },
    {
      id: 'prework',
      label: 'Prework',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      content: (
        <PreworkPanel
          opportunityId={opportunity.id}
          subcontractors={opportunity.subcontractors || []}
        />
      ),
    },
    {
      id: 'email',
      label: 'Email',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      content: (
        <EmailDraftPanel
          recipientName={selectedSubcontractor?.contactName || selectedSubcontractor?.name}
          recipientEmail={selectedSubcontractor?.email || ''}
          opportunityTitle={opportunity.title}
          solicitationNumber={opportunity.solicitationNumber}
          bidAmount={currentBid?.recommendedPrice}
          deadline={deadline}
          agency={opportunity.agency}
          templateType={emailTemplateType}
          availableAttachments={solicitationAttachments}
          opportunityId={opportunity.id}
          selectedAttachmentIds={selectedAttachments}
          onSelectionChange={handleSetAttachmentSelection}
          brief={opportunity?.aiArtifacts?.brief ?? opportunity?.opportunityBrief ?? null}
          attachmentRelevance={opportunity?.aiArtifacts?.attachmentRelevance ?? null}
          callChecklist={opportunity?.aiArtifacts?.callChecklist ?? undefined}
          quoteDeadline={null}
          onSend={async ({ to, subject, body, attachmentIds, attachPreworkTemplates }) => {
            try {
              const res = await fetch('/api/email/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to,
                  subject,
                  body,
                  attachmentIds,
                  opportunityId: opportunity.id,
                  subcontractorId: selectedSubcontractor?.id,
                  attachPreworkTemplates,
                }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok || !data.success) {
                return { success: false, error: data.error || `Send failed (${res.status})` }
              }
              // Refetch so sowSentAt lands in state. Only auto-return to the
              // Subs panel when there's nothing prework-related to show — if
              // portal links or a diagnostic came back, keep the user here so
              // they can verify the exact URLs their sub will receive.
              fetchData()
              const hasPreworkFeedback =
                (Array.isArray(data.preworkProvisioned) && data.preworkProvisioned.length > 0) ||
                Boolean(data.preworkDiagnostic)
              if (!hasPreworkFeedback) {
                setExpandedSubcontractorId(null)
                setActivePanel('subcontractors')
              }
              return {
                success: true,
                preworkProvisioned: data.preworkProvisioned,
                preworkDiagnostic: data.preworkDiagnostic,
              }
            } catch (e) {
              return { success: false, error: e instanceof Error ? e.message : 'Network error' }
            }
          }}
        />
      ),
    },
    {
      id: 'agent',
      label: 'Agent',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      ),
      content: (
        <AgentActivityPanel
          opportunity={opportunity}
          assessment={assessment}
        />
      ),
    },
  ]

  // Add bid panel if bid exists
  if (currentBid) {
    panels.splice(1, 0, {
      id: 'bid',
      label: 'Bid',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      content: (
        <BidEditorPanel
          bid={currentBid}
          opportunity={opportunity}
          userRole={session?.user?.role}
          onSave={handleSaveBid}
          onStatusChange={handleBidStatusChange}
        />
      ),
    })
  }

  return (
    <WorkspaceLayout
      panels={panels}
      activePanel={activePanel}
      onPanelChange={setActivePanel}
      progress={progress}
      nextAction={nextAction}
      isAdmin={session?.user?.role === 'ADMIN'}
      opportunityId={opportunity.id}
      opportunityStatus={opportunity.status}
      headerContent={
        <div className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 min-h-[48px]">
          {/* Left: Back + Title */}
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <button
              onClick={() => router.push('/opportunities')}
              className="text-stone-400 hover:text-stone-600 p-1.5 flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-medium text-stone-800 truncate leading-tight">
                {opportunity.title}
              </h1>
              <p className="text-xs text-stone-400 truncate">{opportunity.solicitationNumber}</p>
            </div>
          </div>

          {/* Right: Deadline */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {deadline && daysLeft !== null && (
              <div className={`px-2.5 py-1.5 rounded text-xs sm:text-sm font-medium flex-shrink-0 ${
                daysLeft <= 3 ? 'bg-stone-800 text-white' :
                daysLeft <= 7 ? 'bg-stone-200 text-stone-700' :
                'bg-stone-100 text-stone-600'
              }`}>
                {daysLeft <= 0 ? 'Expired' : `${daysLeft}d`}
              </div>
            )}
          </div>
        </div>
      }
      sidebarContent={
        <OpportunitySidebar
          opportunity={opportunity}
          assessment={assessment}
          currentBid={currentBid}
          hasSubcontractors={hasSubcontractors}
          discoveringSubcontractors={discoveringSubcontractors}
          onFindSubcontractors={handleDiscoverSubcontractors}
          onSeeSubcontractors={() => setActivePanel('subcontractors')}
          onCreateBid={handleCreateBid}
          onSeeBid={() => setActivePanel('bid')}
        />
      }
    />
  )
}

// ─── Opportunity Details Sidebar ──────────────────────────────────────────────

function OpportunitySidebar({
  opportunity,
  assessment,
  currentBid,
  hasSubcontractors,
  discoveringSubcontractors,
  onFindSubcontractors,
  onSeeSubcontractors,
  onCreateBid,
  onSeeBid,
}: {
  opportunity: any
  assessment: any
  currentBid: any
  hasSubcontractors: boolean
  discoveringSubcontractors: boolean
  onFindSubcontractors: () => void
  onSeeSubcontractors: () => void
  onCreateBid: () => void
  onSeeBid: () => void
}) {
  const raw = opportunity.rawData as any

  // Extract point of contact
  const pocs = raw?.pointOfContact
    ? Array.isArray(raw.pointOfContact) ? raw.pointOfContact : [raw.pointOfContact]
    : []
  const primaryPOC = pocs[0]

  const deadline = opportunity.responseDeadline ? new Date(opportunity.responseDeadline) : null
  const daysLeft = deadline ? differenceInDays(deadline, new Date()) : null
  const postedDate = opportunity.postedDate ? new Date(opportunity.postedDate) : null

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">

      {/* Workflow quick actions */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Actions</p>
        {hasSubcontractors && (
          <button onClick={onSeeSubcontractors} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-700 bg-stone-50 border border-stone-200 rounded hover:bg-stone-100 flex items-center gap-2 transition-colors">
            <span className="w-2 h-2 rounded-full bg-stone-500 flex-shrink-0" />
            View Subcontractors
          </button>
        )}
        {currentBid ? (
          <button onClick={onSeeBid} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-700 bg-stone-50 border border-stone-200 rounded hover:bg-stone-100 flex items-center gap-2 transition-colors">
            <span className="w-2 h-2 rounded-full bg-stone-500 flex-shrink-0" />
            View Bid — ${currentBid.recommendedPrice?.toLocaleString()}
          </button>
        ) : (
          <button onClick={onCreateBid} disabled={!hasSubcontractors} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-400 bg-stone-50 border border-stone-100 rounded flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Find subcontractors first">
            <span className="w-2 h-2 rounded-full bg-stone-200 flex-shrink-0" />
            Create Bid
          </button>
        )}
      </div>

      {/* Bid estimate tiles */}
      {assessment && (
        <div>
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">Bid Estimate</p>
          <div className="grid grid-cols-2 gap-1.5">
            <SidebarTile label="Value" value={`$${formatSidebarCurrency(assessment.estimatedValue)}`} />
            <SidebarTile label="Cost" value={`$${formatSidebarCurrency(assessment.estimatedCost)}`} />
            <SidebarTile
              label="Margin"
              value={`${assessment.profitMarginPercent?.toFixed(0)}%`}
              subValue={`$${formatSidebarCurrency(assessment.profitMarginDollar)}`}
              highlight={assessment.profitMarginPercent >= 20}
            />
            {assessment.recommendation && (
              <SidebarTile
                label="Decision"
                value={assessment.recommendation}
                highlight={assessment.recommendation === 'GO'}
              />
            )}
          </div>

          {/* Data source attribution */}
          <div className="mt-2 flex items-start gap-1.5">
            <svg className="h-3 w-3 text-stone-300 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[10px] text-stone-400 leading-snug">
              {currentBid?.source === 'usaspending_api'
                ? <>Source: <span className="font-medium">USASpending.gov</span> — {(currentBid.historicalData as any)?.totalContracts ?? '?'} comparable contracts · Confidence: <span className="font-medium capitalize">{currentBid.confidence ?? 'unknown'}</span></>
                : currentBid?.source === 'cost_based'
                  ? <>Source: <span className="font-medium">Cost-based estimate</span> · Confidence: <span className="font-medium capitalize">{currentBid?.confidence ?? 'low'}</span></>
                  : currentBid
                    ? <>Source: <span className="font-medium">Default fallback</span> — insufficient historical data · Enter manual estimate for accuracy</>
                    : assessment?.notes
                      ? <>{assessment.notes}</>
                      : <>Value from manual assessment · Enter cost to calculate margin</>
              }
            </p>
          </div>
        </div>
      )}

      {/* Opportunity detail tiles — 2-column grid */}
      <div>
        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">Opportunity</p>
        <div className="grid grid-cols-2 gap-1.5">
          {daysLeft !== null && (
            <SidebarTile
              label="Days Left"
              value={daysLeft <= 0 ? 'Expired' : String(daysLeft)}
              subValue={daysLeft > 0 ? 'days remaining' : undefined}
              dark
              span
            />
          )}
          {opportunity.agency && (
            <SidebarTile label="Agency" value={opportunity.agency} span wrap />
          )}
          {opportunity.naicsCode && (
            <SidebarTile label="NAICS" value={opportunity.naicsCode} subValue={opportunity.naicsDescription} span />
          )}
          {(opportunity.placeOfPerformance || opportunity.state) && (
            <SidebarTile label="Location" value={opportunity.placeOfPerformance || opportunity.state} />
          )}
          {opportunity.setAside && (
            <SidebarTile label="Set-Aside" value={formatSetAside(opportunity.setAside)} />
          )}
          {opportunity.rawData?.contractType && (
            <SidebarTile label="Contract Type" value={opportunity.rawData.contractType} />
          )}
          {postedDate && (
            <SidebarTile label="Posted" value={format(postedDate, 'MMM d, yyyy')} />
          )}
          {deadline && (
            <SidebarTile
              label="Deadline"
              value={format(deadline, 'MMM d, yyyy')}
              subValue={daysLeft !== null ? (daysLeft <= 0 ? 'Expired' : `${daysLeft} days left`) : undefined}
              highlight={daysLeft !== null && daysLeft <= 14 && daysLeft > 0}
              span
            />
          )}
          {opportunity.department && (
            <SidebarTile label="Department" value={opportunity.department} span />
          )}
        </div>
      </div>

      {/* Point of Contact */}
      {primaryPOC && (
        <div>
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">Point of Contact</p>
          <div className="space-y-1">
            {(primaryPOC.fullName || primaryPOC.firstName) && (
              <p className="text-xs font-medium text-stone-700">
                {primaryPOC.fullName || `${primaryPOC.firstName || ''} ${primaryPOC.lastName || ''}`.trim()}
              </p>
            )}
            {primaryPOC.title && (
              <p className="text-xs text-stone-500">{primaryPOC.title}</p>
            )}
            {primaryPOC.email && (
              <a href={`mailto:${primaryPOC.email}`} className="text-xs text-stone-600 hover:text-stone-800 block truncate underline underline-offset-2">
                {primaryPOC.email}
              </a>
            )}
            {primaryPOC.phone && (
              <p className="text-xs text-stone-500">{primaryPOC.phone}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarTile({
  label,
  value,
  subValue,
  highlight,
  span,
  wrap,
  dark,
}: {
  label: string
  value: string
  subValue?: string
  highlight?: boolean
  span?: boolean
  wrap?: boolean
  dark?: boolean
}) {
  if (dark) {
    return (
      <div className={`border rounded-lg p-3 flex flex-col items-center justify-center text-center ${span ? 'col-span-2' : ''} bg-stone-800 border-stone-800`}>
        <p className="text-[10px] uppercase tracking-wide text-stone-400 mb-1">{label}</p>
        <p className="text-3xl font-bold text-white leading-none">{value}</p>
        {subValue && (
          <p className="text-[10px] text-stone-400 mt-1">{subValue}</p>
        )}
      </div>
    )
  }

  return (
    <div className={`border rounded-lg p-2.5 ${span ? 'col-span-2' : ''} bg-white border-stone-200`}>
      <p className="text-[10px] mb-0.5 uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`text-xs font-medium ${wrap ? 'leading-snug' : 'truncate'} ${highlight ? 'text-stone-900' : 'text-stone-700'}`} title={value}>
        {value}
      </p>
      {subValue && (
        <p className={`text-[10px] mt-0.5 ${wrap ? 'leading-snug' : 'truncate'} text-stone-400`} title={subValue}>
          {subValue}
        </p>
      )}
    </div>
  )
}

function formatSidebarCurrency(amount: number): string {
  if (!amount) return '—'
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `${(amount / 1000).toFixed(0)}K`
  return amount.toLocaleString()
}

function formatSetAside(setAside?: string): string {
  if (!setAside) return 'Full & Open'
  const mapping: Record<string, string> = {
    'SBA': 'Small Business', 'SDVOSB': 'Service-Disabled Veteran-Owned',
    'WOSB': 'Women-Owned', '8A': '8(a) Program', 'HUBZONE': 'HUBZone',
  }
  return mapping[setAside] || setAside.replace(/_/g, ' ')
}
