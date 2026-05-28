'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { format, differenceInDays } from 'date-fns'
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout'
import OpportunitySummaryPanel from '@/components/workspace/panels/OpportunitySummaryPanel'
import BidEditorPanel from '@/components/workspace/panels/BidEditorPanel'
import SubcontractorPanel from '@/components/workspace/panels/SubcontractorPanel'
import SOWPanel from '@/components/workspace/panels/SOWPanel'
import EmailDraftPanel from '@/components/workspace/panels/EmailDraftPanel'
import ScopeOverviewPanel from '@/components/workspace/panels/ScopeOverviewPanel'
import type { RichAttachment } from '@/lib/types/attachment'
import { extractCity, extractStateCode } from '@/lib/opportunity-classification'

export default function OpportunityWorkspacePage() {
  const params = useParams()
  const router = useRouter()
  const [opportunity, setOpportunity] = useState<any>(null)
  const [assessment, setAssessment] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activePanel, setActivePanel] = useState('summary')
  const [selectedSubcontractor, setSelectedSubcontractor] = useState<any>(null)
  const [emailContext, setEmailContext] = useState<{ sowSynopsis?: string }>({})
  const [emailTemplateType, setEmailTemplateType] = useState<'quote_request' | 'sow_delivery' | 'follow_up' | 'custom'>('quote_request')
  const [generatingSOW, setGeneratingSOW] = useState(false)
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [discoveringSubcontractors, setDiscoveringSubcontractors] = useState(false)
  const [solicitationAttachments, setSolicitationAttachments] = useState<RichAttachment[]>([])
  const [emailSelectedAttachments, setEmailSelectedAttachments] = useState<Set<string>>(new Set())

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
          // Initialize email selection to all attachments (default all selected)
          setEmailSelectedAttachments(prev => {
            // Only initialize if not yet set
            if (prev.size === 0) return new Set(atts.map((a) => a.id))
            return prev
          })
        }
      })
      .catch(() => {})
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
    try {
      setGeneratingBrief(true)
      const res = await fetch(`/api/opportunities/${opportunity.id}/brief`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setOpportunity((prev: any) => ({ ...prev, opportunityBrief: data.brief }))
      }
    } catch (err) {
      console.error('Failed to generate brief:', err)
    } finally {
      setGeneratingBrief(false)
    }
  }

  const handleGenerateSOW = async (selectedAttachments?: string[]) => {
    try {
      setGeneratingSOW(true)
      const res = await fetch('/api/sows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId: opportunity.id, selectedAttachments }),
      })
      if (res.ok) {
        await fetchData()
        setActivePanel('sow')
      }
    } catch (err) {
      console.error('Failed to generate SOW:', err)
    } finally {
      setGeneratingSOW(false)
    }
  }

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

  // Silent save — used for auto-save on blur (no re-render of parent)
  const handleSaveSOW = async (content: any) => {
    const sow = opportunity?.sows?.[0]
    if (!sow) return

    await fetch(`/api/sows/${sow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  }

  // Save + full refresh — used after "Save & re-generate plain language"
  const handleSaveSOWAndRefresh = async (content: any) => {
    await handleSaveSOW(content)
    await fetchData()
  }

  const handleSOWStatusChange = async (status: string) => {
    const sow = opportunity?.sows?.[0]
    if (!sow) return

    await fetch(`/api/sows/${sow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await fetchData()
  }

  // Generate SOW synopsis for emails - must be before early returns to maintain hooks order
  const currentSOW = opportunity?.sows?.[0]

  // Extract place of performance for SubcontractorPanel geo-radius UI
  const placeOfPerformanceData = useMemo(() => ({
    city: opportunity?.rawData ? extractCity(opportunity.rawData) : null,
    state: opportunity?.rawData
      ? (extractStateCode(opportunity.rawData) || opportunity?.state || null)
      : (opportunity?.state || null),
  }), [opportunity?.rawData, opportunity?.state])

  const sowSynopsis = useMemo(() => {
    if (!currentSOW?.content) return undefined
    const content = currentSOW.content
    const bullets: string[] = []

    // Extract key info from SOW content
    if (content.opportunity?.title) {
      bullets.push(`Project: ${content.opportunity.title}`)
    }
    if (content.scope?.overview) {
      bullets.push(`Scope: ${content.scope.overview.substring(0, 150)}${content.scope.overview.length > 150 ? '...' : ''}`)
    }
    if (content.deliverables && Array.isArray(content.deliverables)) {
      const deliverableList = content.deliverables.slice(0, 3).map((d: any) => d.title || d).join(', ')
      bullets.push(`Key deliverables: ${deliverableList}`)
    }
    if (content.period_of_performance) {
      bullets.push(`Timeline: ${content.period_of_performance}`)
    }

    return bullets.length > 0 ? bullets.join('\n• ') : undefined
  }, [currentSOW])

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

  // Workflow order: SOW → Subcontractors → Bid (bid is LAST)
  const getWorkflowState = () => {
    if (!currentSOW) return { step: 1, action: 'Generate SOW', panel: 'sow' as const }
    if (!hasSubcontractors) return { step: 2, action: 'Find Subcontractors', panel: 'subcontractors' as const }
    if (!currentBid) return { step: 3, action: 'Create Bid', panel: 'bid' as const }
    return { step: 4, action: 'Review & Submit', panel: 'bid' as const }
  }
  const workflowState = getWorkflowState()

  // Handle proceed action - navigate to the next workflow step
  const handleProceed = async () => {
    const state = getWorkflowState()
    if (state.step === 1) {
      await handleGenerateSOW()
    } else if (state.step === 2) {
      await handleDiscoverSubcontractors()
    } else if (state.step === 3) {
      await handleCreateBid()
    } else {
      setActivePanel('bid')
    }
  }

  // Determine next action (Workflow: SOW → Subs → Bid)
  let nextAction = workflowState.action
  if (currentBid?.status === 'DRAFT') {
    nextAction = 'Review bid'
  } else if (currentBid?.status === 'REVIEWED') {
    nextAction = 'Submit bid'
  }

  // Progress tracking (workflow order: SOW → Subs → Bid)
  const progress = {
    sowCreated: !!currentSOW,
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
          hasSOW={!!currentSOW}
          hasSubcontractors={hasSubcontractors}
          onCreateBid={handleCreateBid}
          onSeeBid={() => setActivePanel('bid')}
          onGenerateSOW={handleGenerateSOW}
          onSeeSOW={() => setActivePanel('sow')}
          isGeneratingSOW={generatingSOW}
          onFindSubcontractors={handleDiscoverSubcontractors}
          onSeeSubcontractors={() => setActivePanel('subcontractors')}
          onProceed={handleProceed}
          nextStep={workflowState.action}
          brief={opportunity?.opportunityBrief ?? null}
          isGeneratingBrief={generatingBrief}
          onGenerateBrief={handleGenerateBrief}
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
          brief={opportunity?.opportunityBrief ?? null}
        />
      ),
    },
    {
      id: 'sow',
      label: 'SOW',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      content: (
        <SOWPanel
          sow={currentSOW}
          opportunity={{ ...opportunity, attachments: solicitationAttachments }}
          onGenerate={handleGenerateSOW}
          isGenerating={generatingSOW}
          onSave={handleSaveSOW}
          onSaveAndRefresh={handleSaveSOWAndRefresh}
          onStatusChange={handleSOWStatusChange}
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
          onRequestQuote={(sub) => {
            setSelectedSubcontractor(sub)
            setEmailTemplateType('quote_request')
            setActivePanel('email')
          }}
          onSendDetails={(sub) => {
            setSelectedSubcontractor(sub)
            setEmailTemplateType('sow_delivery')
            setActivePanel('email')
          }}
          onSubcontractorsUpdated={fetchData}
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
          sowSynopsis={sowSynopsis}
          deadline={deadline}
          agency={opportunity.agency}
          templateType={emailTemplateType}
          availableAttachments={solicitationAttachments}
          sowFileName={currentSOW?.fileName}
          opportunityId={opportunity.id}
          selectedAttachmentIds={emailSelectedAttachments}
          onSelectionChange={setEmailSelectedAttachments}
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
      headerContent={
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Left: Back + Title */}
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => router.push('/opportunities')}
              className="text-stone-400 hover:text-stone-600 p-1"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-medium text-stone-800 truncate">
                {opportunity.title}
              </h1>
              <p className="text-xs text-stone-400">{opportunity.solicitationNumber}</p>
            </div>
          </div>

          {/* Right: Deadline */}
          <div className="flex items-center gap-4">
            {deadline && daysLeft !== null && (
              <div className={`px-3 py-1.5 rounded text-sm font-medium ${
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
          currentSOW={currentSOW}
          hasSubcontractors={hasSubcontractors}
          generatingSOW={generatingSOW}
          discoveringSubcontractors={discoveringSubcontractors}
          onGenerateSOW={handleGenerateSOW}
          onSeeSOW={() => setActivePanel('sow')}
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
  currentSOW,
  hasSubcontractors,
  generatingSOW,
  discoveringSubcontractors,
  onGenerateSOW,
  onSeeSOW,
  onFindSubcontractors,
  onSeeSubcontractors,
  onCreateBid,
  onSeeBid,
}: {
  opportunity: any
  assessment: any
  currentBid: any
  currentSOW: any
  hasSubcontractors: boolean
  generatingSOW: boolean
  discoveringSubcontractors: boolean
  onGenerateSOW: () => void
  onSeeSOW: () => void
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
        {currentSOW ? (
          <button onClick={onSeeSOW} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-700 bg-stone-50 border border-stone-200 rounded hover:bg-stone-100 flex items-center gap-2 transition-colors">
            <span className="w-2 h-2 rounded-full bg-stone-500 flex-shrink-0" />
            View SOW
          </button>
        ) : (
          <button onClick={onGenerateSOW} disabled={generatingSOW} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-700 bg-stone-50 border border-stone-200 rounded hover:bg-stone-100 flex items-center gap-2 transition-colors disabled:opacity-50">
            {generatingSOW ? (
              <svg className="animate-spin w-2 h-2 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <span className="w-2 h-2 rounded-full bg-stone-300 flex-shrink-0" />
            )}
            {generatingSOW ? 'Generating SOW…' : 'Generate SOW'}
          </button>
        )}
        {hasSubcontractors ? (
          <button onClick={onSeeSubcontractors} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-700 bg-stone-50 border border-stone-200 rounded hover:bg-stone-100 flex items-center gap-2 transition-colors">
            <span className="w-2 h-2 rounded-full bg-stone-500 flex-shrink-0" />
            View Subcontractors
          </button>
        ) : (
          <button onClick={onFindSubcontractors} disabled={discoveringSubcontractors} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-700 bg-stone-50 border border-stone-200 rounded hover:bg-stone-100 flex items-center gap-2 transition-colors disabled:opacity-50">
            <span className="w-2 h-2 rounded-full bg-stone-300 flex-shrink-0" />
            {discoveringSubcontractors ? 'Finding subs…' : 'Find Subcontractors'}
          </button>
        )}
        {currentBid ? (
          <button onClick={onSeeBid} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-700 bg-stone-50 border border-stone-200 rounded hover:bg-stone-100 flex items-center gap-2 transition-colors">
            <span className="w-2 h-2 rounded-full bg-stone-500 flex-shrink-0" />
            View Bid — ${currentBid.recommendedPrice?.toLocaleString()}
          </button>
        ) : (
          <button onClick={onCreateBid} disabled={!currentSOW || !hasSubcontractors} className="w-full text-left px-3 py-2 text-xs font-medium text-stone-400 bg-stone-50 border border-stone-100 rounded flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title={!currentSOW ? 'Generate SOW first' : 'Find subcontractors first'}>
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
          {opportunity.contractType && (
            <SidebarTile label="Contract Type" value={opportunity.contractType} />
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
