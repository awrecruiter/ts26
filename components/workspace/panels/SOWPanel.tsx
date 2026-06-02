'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { format } from 'date-fns'

interface SOWSection {
  title: string
  content: string
  summary?: string
  bullets?: string[]
  details?: string
}

interface Attachment {
  id: string
  name: string
  url: string
  type?: string
  size?: number
}

interface SOWPanelProps {
  sow?: {
    id: string
    version: number
    status: string
    content?: {
      header?: {
        title?: string
        date?: string
      }
      opportunity?: {
        title?: string
        solicitationNumber?: string
        agency?: string
        naicsCode?: string
        quoteDeadline?: string
        placeOfPerformance?: string
        primeCompany?: string
      }
      scope?: { overview?: string }
      sections?: SOWSection[]
      attachments?: { name: string; url: string }[]
      sourceEnhanced?: boolean
    } | null
    metadata?: Record<string, unknown> | null
    generatedAt: string | Date
    fileName?: string
    fileUrl?: string
  } | null
  opportunity: {
    id: string
    title: string
    solicitationNumber: string
    agency?: string
    description?: string
    attachments?: Attachment[]
    requirements?: string[]
    deliverables?: string[]
    naicsCode?: string
    periodOfPerformance?: string
  }
  onSave?: (content: unknown) => Promise<void>
  onSaveAndRefresh?: (content: unknown) => Promise<void>
  onGenerate?: () => Promise<void>
  onStatusChange?: (status: string) => Promise<void>
  isGenerating?: boolean
}

// ─── Auto-resize textarea ─────────────────────────────────────────────────────

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// ─── Main SOWPanel ────────────────────────────────────────────────────────────

export default function SOWPanel({
  sow,
  opportunity,
  onSave,
  onSaveAndRefresh,
  onGenerate,
  onStatusChange,
  isGenerating,
}: SOWPanelProps) {
  const buildDefaultSections = (): SOWSection[] => {
    const sections: SOWSection[] = []
    sections.push({
      title: '1. Scope of Work',
      content: opportunity.description || 'Define the scope of work based on the solicitation requirements.',
    })
    if (opportunity.requirements && opportunity.requirements.length > 0) {
      sections.push({
        title: '2. Requirements',
        content: opportunity.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n'),
      })
    } else {
      sections.push({ title: '2. Requirements', content: 'List specific requirements from the solicitation.' })
    }
    if (opportunity.deliverables && opportunity.deliverables.length > 0) {
      sections.push({
        title: '3. Deliverables',
        content: opportunity.deliverables.map((d, i) => `${i + 1}. ${d}`).join('\n'),
      })
    } else {
      sections.push({ title: '3. Deliverables', content: 'Specify deliverables expected from the subcontractor.' })
    }
    sections.push({
      title: '4. Timeline & Schedule',
      content: opportunity.periodOfPerformance
        ? `Period of Performance: ${opportunity.periodOfPerformance}\n\nKey milestones to be determined.`
        : 'Specify project timeline and key milestones.',
    })
    sections.push({
      title: '5. Terms & Conditions',
      content: 'Standard terms and conditions apply. Payment terms: Net 30 upon delivery acceptance.',
    })
    return sections
  }

  const convertStructuredSections = (rawSections: SOWSection[]): SOWSection[] => {
    return rawSections.map((s) => {
      if (s.content && typeof s.content === 'string') {
        return { title: s.title, content: s.content, summary: s.summary, bullets: s.bullets, details: s.details }
      }
      const parts: string[] = []
      if (s.summary) parts.push(s.summary)
      if (s.bullets && s.bullets.length > 0) {
        parts.push('')
        parts.push(...s.bullets.map((b: string) => `- ${b}`))
      }
      if (s.details) {
        parts.push('')
        parts.push(s.details)
      }
      return {
        title: s.title,
        content: parts.join('\n').trim() || s.details || s.summary || '',
        summary: s.summary,
        bullets: s.bullets,
        details: s.details,
      }
    })
  }

  const [sections, setSections] = useState<SOWSection[]>(
    sow?.content?.sections ? convertStructuredSections(sow.content.sections) : buildDefaultSections()
  )

  // Auto-save state
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedAtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasAutoTriggered = useRef(false)

  useEffect(() => {
    if (sow?.content?.sections) {
      setSections(convertStructuredSections(sow.content.sections))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sow])

  const buildContent = useCallback((currentSections: SOWSection[]) => ({
    header: {
      title: `SOW - ${opportunity.title}`,
      date: new Date().toISOString().split('T')[0],
    },
    sections: currentSections,
  }), [opportunity.title])

  // Debounced auto-save on blur
  const handleBlurSave = useCallback((currentSections: SOWSection[]) => {
    if (!onSave) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true)
      try {
        await onSave(buildContent(currentSections))
        setSavedAt(new Date())
        if (savedAtTimerRef.current) clearTimeout(savedAtTimerRef.current)
        savedAtTimerRef.current = setTimeout(() => setSavedAt(null), 3000)
      } finally {
        setIsSaving(false)
      }
    }, 400)
  }, [onSave, buildContent])

  const handleSectionTitleChange = (index: number, value: string) => {
    const updated = [...sections]
    updated[index] = { ...updated[index], title: value }
    setSections(updated)
  }

  const handleSectionContentChange = (index: number, value: string) => {
    const updated = [...sections]
    updated[index] = { ...updated[index], content: value, details: value }
    setSections(updated)
  }

  const handleBulletChange = (sectionIdx: number, bulletIdx: number, value: string) => {
    const updated = [...sections]
    const bullets = [...(updated[sectionIdx].bullets || [])]
    bullets[bulletIdx] = value
    updated[sectionIdx] = { ...updated[sectionIdx], bullets }
    setSections(updated)
  }

  const handleAddBullet = (sectionIdx: number) => {
    const updated = [...sections]
    const bullets = [...(updated[sectionIdx].bullets || []), '']
    updated[sectionIdx] = { ...updated[sectionIdx], bullets }
    setSections(updated)
  }

  const handleRemoveBullet = (sectionIdx: number, bulletIdx: number) => {
    const updated = [...sections]
    const bullets = (updated[sectionIdx].bullets || []).filter((_, i) => i !== bulletIdx)
    updated[sectionIdx] = { ...updated[sectionIdx], bullets }
    setSections(updated)
    handleBlurSave(updated)
  }

  // True when section.details is just bullets-joined-as-text (older rule-based
  // builders set details to "- bullet1\n- bullet2…" which would render as a
  // duplicate of the bullet list above).
  const isDetailsJustBullets = (section: SOWSection): boolean => {
    if (!section.details || !section.bullets || section.bullets.length === 0) return false
    const joined = section.bullets.map((b) => `- ${b}`).join('\n').trim()
    return section.details.trim() === joined
  }

  const handleAddSection = () => {
    const newSections = [...sections, { title: `${sections.length + 1}. New Section`, content: '' }]
    setSections(newSections)
  }

  const handleRemoveSection = (index: number) => {
    const newSections = sections.filter((_, i) => i !== index)
    setSections(newSections)
    handleBlurSave(newSections)
  }

  // ── No SOW yet ──────────────────────────────────────────────────────────
  if (!sow) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-stone-100 flex items-center justify-center">
            <svg className="h-6 w-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-medium text-stone-800 mb-2">No SOW yet</h2>
          <p className="text-sm text-stone-500 mb-4">
            Generate a Statement of Work tailored to this opportunity. The SOW will pull specifications from the solicitation.
          </p>
          {onGenerate && (
            <button
              onClick={() => onGenerate()}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating…
                </>
              ) : 'Generate SOW'}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── SOW exists ──────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* ── Header row ── */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-stone-900">Statement of Work</h1>
              <p className="text-sm text-stone-500 mt-0.5">
                Version {sow.version} · {format(new Date(sow.generatedAt), 'MMM d, yyyy')}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className={`px-2 py-1 text-xs font-medium rounded ${
                sow.status === 'APPROVED' ? 'bg-stone-800 text-white' :
                sow.status === 'PENDING_REVIEW' ? 'bg-stone-300 text-stone-700' :
                sow.status === 'SENT' ? 'bg-stone-200 text-stone-600' :
                'bg-stone-100 text-stone-500'
              }`}>
                {sow.status.replace(/_/g, ' ').toLowerCase()}
              </span>
              {onGenerate && (
                <button
                  onClick={() => {
                    if (confirm('Regenerate this SOW from the latest opportunity data? Your current edits will be replaced.')) {
                      onGenerate()
                    }
                  }}
                  disabled={isGenerating}
                  className="px-3 py-1 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded hover:bg-stone-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                  title="Rebuild the SOW from the current opportunity data and prompt"
                >
                  {isGenerating ? (
                    <>
                      <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Regenerating…
                    </>
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Regenerate
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* ── DOCUMENT — always visible, always editable. Click any section text to edit. ── */}
          <div className="bg-stone-50 rounded-lg">
            {/* Auto-save indicator */}
            <div className="flex items-center justify-end h-6 mb-2 px-1">
              {isSaving && (
                <span className="flex items-center gap-1.5 text-xs text-stone-400">
                  <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </span>
              )}
              {!isSaving && savedAt && (
                <span className="text-xs text-stone-400">
                  Saved ✓ {format(savedAt, 'h:mm a')}
                </span>
              )}
            </div>

            <div className="bg-white shadow-md rounded-lg overflow-hidden">
              {/* Document header */}
              <div className="px-6 sm:px-10 pt-8 sm:pt-10 pb-6 border-b border-stone-200 text-center">
                <p className="text-xs font-semibold tracking-widest uppercase text-stone-400 mb-2">
                  Statement of Work
                </p>
                <h2 className="text-lg font-semibold text-stone-900 mb-1">
                  {sow.content?.opportunity?.title || opportunity.title}
                </h2>
                <p className="text-sm text-stone-500">
                  {sow.content?.opportunity?.solicitationNumber || opportunity.solicitationNumber}
                </p>
                <p className="text-sm text-stone-400">
                  {sow.content?.opportunity?.agency || opportunity.agency}
                </p>
                {(sow.content?.opportunity?.naicsCode || opportunity.naicsCode) && (
                  <p className="text-xs text-stone-400 mt-1">
                    NAICS: {sow.content?.opportunity?.naicsCode || opportunity.naicsCode}
                  </p>
                )}
              </div>

              {/* Sections — always editable inline */}
              <div className="divide-y divide-stone-100">
                {sections.map((section, idx) => (
                  <div key={idx} className="px-4 sm:px-10 py-5 sm:py-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-6 h-6 bg-stone-900 text-white text-xs font-bold rounded flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </div>
                      <input
                        type="text"
                        value={section.title.replace(/^[\d.]+\s*/, '')}
                        onChange={(e) => handleSectionTitleChange(idx, `${idx + 1}. ${e.target.value}`)}
                        onBlur={() => handleBlurSave(sections)}
                        placeholder="Section title"
                        className="flex-1 text-sm font-semibold text-stone-800 bg-transparent border-none outline-none focus:ring-1 focus:ring-stone-200 rounded px-1 -mx-1"
                      />
                      <button
                        onClick={() => handleRemoveSection(idx)}
                        className="text-stone-300 hover:text-stone-500 transition-colors flex-shrink-0"
                        title="Remove section"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <div className="border-b border-stone-100 mb-4" />

                    {section.bullets && section.bullets.length > 0 && (
                      <ul className="mb-3 space-y-1.5">
                        {section.bullets.map((bullet, bi) => (
                          <li key={bi} className="flex items-start gap-2 group">
                            <span className="mt-2 h-1 w-1 rounded-full bg-stone-400 flex-shrink-0" />
                            <input
                              type="text"
                              value={bullet}
                              onChange={(e) => handleBulletChange(idx, bi, e.target.value)}
                              onBlur={() => handleBlurSave(sections)}
                              placeholder="Bullet point…"
                              className="flex-1 text-sm text-stone-700 bg-transparent border-none outline-none focus:ring-1 focus:ring-stone-200 rounded px-1 -mx-1"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveBullet(idx, bi)}
                              className="text-stone-200 hover:text-stone-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              title="Remove bullet"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </li>
                        ))}
                        <li>
                          <button
                            type="button"
                            onClick={() => handleAddBullet(idx)}
                            className="ml-3 text-xs text-stone-400 hover:text-stone-600 flex items-center gap-1 transition-colors"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add bullet
                          </button>
                        </li>
                      </ul>
                    )}

                    {/* Details prose — only when section has detail content distinct from bullets.
                        Without this guard, sections whose details were "bullets-joined-as-text"
                        rendered the same content twice (bullet list above + textarea below). */}
                    {(!section.bullets || section.bullets.length === 0 || !isDetailsJustBullets(section)) && (
                      <textarea
                        ref={(el) => { if (el) autoResize(el) }}
                        value={isDetailsJustBullets(section) ? '' : (section.details || section.content || '')}
                        onChange={(e) => {
                          handleSectionContentChange(idx, e.target.value)
                          autoResize(e.target)
                        }}
                        onBlur={() => handleBlurSave(sections)}
                        onInput={(e) => autoResize(e.currentTarget)}
                        placeholder={section.bullets && section.bullets.length > 0 ? 'Additional notes (optional)…' : 'Section body text…'}
                        rows={2}
                        className="w-full text-sm text-stone-700 leading-relaxed bg-transparent border-none outline-none resize-none focus:ring-1 focus:ring-stone-200 rounded px-1 -mx-1"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Add section */}
              <div className="px-4 sm:px-10 py-4 bg-stone-50 border-t border-stone-100">
                <button
                  onClick={handleAddSection}
                  className="w-full py-2 text-xs text-stone-400 hover:text-stone-600 flex items-center justify-center gap-1 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add section
                </button>
              </div>
            </div>
          </div>

          {/* ── Actions ── */}
          <div className="flex gap-3 pt-1">
            {sow.status === 'DRAFT' && onStatusChange && (
              <button
                onClick={() => onStatusChange('PENDING_REVIEW')}
                className="flex-1 px-4 py-3 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
              >
                Submit for review
              </button>
            )}
            {sow.status === 'APPROVED' && onStatusChange && (
              <button
                onClick={() => onStatusChange('SENT')}
                className="flex-1 px-4 py-3 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
              >
                Mark as sent
              </button>
            )}
            <a
              href={`/api/sows/${sow.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-3 text-sm font-medium text-stone-600 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download PDF
            </a>
          </div>

        </div>
      </div>
    </div>
  )
}
