'use client'

import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { previousBusinessDay } from '@/lib/business-days'
import type { RichAttachment } from '@/lib/types/attachment'
import type { OpportunityBrief, AttachmentRelevanceMap } from '@/lib/openai'
import AttachmentPreviewModal from '@/components/shared/AttachmentPreviewModal'

interface EmailDraftPanelProps {
  recipientName?: string
  recipientEmail?: string
  opportunityTitle: string
  solicitationNumber: string
  bidAmount?: number
  deadline?: Date | null
  agency?: string
  templateType?: 'quote_request' | 'follow_up' | 'custom'
  onSend?: (email: {
    to: string
    subject: string
    body: string
    attachmentIds: string[]
    attachPreworkTemplates?: string[]
  }) => Promise<{
    success: boolean
    error?: string
    preworkProvisioned?: Array<{ templateKey: string; url: string; templateDisplayName: string }>
    preworkDiagnostic?: string
  }>
  availableAttachments?: RichAttachment[]
  opportunityId?: string
  /** IDs of pre-selected attachments (parent-controlled, survives panel switching) */
  selectedAttachmentIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  /** AI-generated brief — used to make the body specific instead of generic. */
  brief?: OpportunityBrief | null
  /** Per-attachment include/skip verdicts from aiArtifacts.attachmentRelevance.
   *  When present, drives the default selection. */
  attachmentRelevance?: AttachmentRelevanceMap | null
  /** AI-generated screening questions to inject into the body. */
  callChecklist?: string[]
  /** Internal deadline for the sub to return their quote. */
  quoteDeadline?: string | null
  /** Default state of the "Include Prework portal links" checkbox. Falls back
   *  to true for quote_request templates, false for anything else. */
  defaultIncludePrework?: boolean
  /** Prework requirement template keys to provision + link when the checkbox
   *  is on. Defaults to the sub-list entry + SOV/pricing breakdown pair. */
  preworkTemplates?: string[]
}

const TEMPLATES: Record<string, { subject: string; body: string }> = {
  quote_request: {
    subject: 'Quote Request — {{title}} ({{agency}})',
    body: `Hello {{name}},

I'm reaching out from a prime bidding on a federal opportunity and would like a quote on the portion that fits your shop.

THE WORK
{{what_we_need}}

KEY DELIVERABLES
{{deliverables_block}}

QUALIFICATION GATES
{{qualifications_block}}

WHAT I NEED FROM YOU BY {{quote_due}}
• Firm fixed-price quote — all-inclusive (materials, labor, shipping, taxes, fees)
• Lead time / delivery schedule from receipt of order
• Capability statement (1–2 pages: past performance + competencies + certifications + key personnel)
• Any exceptions, assumptions, or clarifying questions
• Your point of contact (name, title, email, direct phone)

A few quick screening questions:
{{screening_questions}}

The full SOW and supporting docs are attached for reference.

Thanks,
[Your Name]
https://www.1stdirectionco.com/`,
  },
  follow_up: {
    subject: 'Following Up — {{title}}',
    body: `Hello {{name}},

Following up on the quote request I sent for {{title}} ({{solicitation}}).

Our internal deadline to assemble the bid is {{quote_due}} — if you're not able to quote, a quick reply lets me move on. If you are quoting, let me know when I can expect numbers back.

Thanks,
[Your Name]
https://www.1stdirectionco.com/`,
  },
  custom: {
    subject: '',
    body: '',
  },
}

/**
 * Build the rich placeholder values from the AI brief + checklist.
 * Returns plain-text blocks ready to drop into the template body.
 */
function buildBriefContext(brief: OpportunityBrief | null | undefined, callChecklist?: string[]): {
  what_we_need: string
  deliverables_block: string
  qualifications_block: string
  screening_questions: string
} {
  const what = brief?.whatTheyAreBuying?.trim()
  const what_we_need = what || '(SOW attached — see "What We Need From You" section.)'

  const deliverables_block = brief?.keyDeliverables?.length
    ? brief.keyDeliverables
        .slice(0, 5)
        .map(d => `• ${d.item}${d.frequency ? ` (${d.frequency})` : ''}`)
        .join('\n')
    : '• See attached SOW for the deliverables list.'

  const qParts: string[] = []
  const wq = brief?.whoQualifies
  if (wq?.setAside) qParts.push(`Set-aside: ${wq.setAside}`)
  if (wq?.clearances?.length) qParts.push(`Clearance: ${wq.clearances.join(', ')}`)
  if (wq?.certifications?.length) qParts.push(`Certifications: ${wq.certifications.join(', ')}`)
  if (wq?.licenses?.length) qParts.push(`Licenses: ${wq.licenses.join(', ')}`)
  const qualifications_block = qParts.length
    ? qParts.map(p => `• ${p}`).join('\n')
    : '• No special clearance or certification gates flagged. Confirm fit per the SOW.'

  const screening_questions = callChecklist?.length
    ? callChecklist.slice(0, 3).map(q => `   – ${q}`).join('\n')
    : '   – (See call checklist in our sub vetting workflow.)'

  return { what_we_need, deliverables_block, qualifications_block, screening_questions }
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export default function EmailDraftPanel({
  recipientName = '',
  recipientEmail = '',
  opportunityTitle,
  solicitationNumber,
  bidAmount,
  deadline,
  agency,
  templateType = 'quote_request',
  onSend,
  availableAttachments,
  opportunityId,
  selectedAttachmentIds,
  onSelectionChange,
  brief,
  attachmentRelevance,
  callChecklist,
  quoteDeadline,
  defaultIncludePrework,
  preworkTemplates = ['sub_quote'],
}: EmailDraftPanelProps) {
  const [to, setTo] = useState(recipientEmail)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [toError, setToError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState<string | null>(null)
  const [sendPreworkLinks, setSendPreworkLinks] = useState<Array<{ templateKey: string; url: string; templateDisplayName: string }>>([])
  const [sendPreworkDiagnostic, setSendPreworkDiagnostic] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState(templateType)
  const [previewAttachment, setPreviewAttachment] = useState<RichAttachment | null>(null)

  // Prework portal links toggle. Default: on for quote_request templates,
  // off otherwise (follow-ups + custom). Prop wins over that heuristic.
  const initialIncludePrework =
    defaultIncludePrework ?? (templateType === 'quote_request')
  const [includePrework, setIncludePrework] = useState<boolean>(initialIncludePrework)

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  // Initial default selection: respect relevance verdicts when present,
  // otherwise fall back to "all attachments selected" to preserve old behavior.
  const computeInitialSelected = (): Set<string> => {
    if (!availableAttachments?.length) return new Set()
    if (attachmentRelevance && Object.keys(attachmentRelevance).length > 0) {
      return new Set(availableAttachments.filter(a => attachmentRelevance[a.id]?.include).map(a => a.id))
    }
    return new Set(availableAttachments.map(a => a.id))
  }
  const [localSelected, setLocalSelected] = useState<Set<string>>(computeInitialSelected)

  // When relevance arrives after first mount (auto-trigger), re-seed selection
  // — but only if the user hasn't customized (i.e. local matches what we'd seed
  // without relevance, or is the parent-controlled "all" default).
  const relevanceAppliedRef = useRef(false)
  useEffect(() => {
    if (!attachmentRelevance || Object.keys(attachmentRelevance).length === 0) return
    if (relevanceAppliedRef.current) return
    if (!availableAttachments?.length) return
    relevanceAppliedRef.current = true
    const next = new Set(availableAttachments.filter(a => attachmentRelevance[a.id]?.include).map(a => a.id))
    if (onSelectionChange) {
      onSelectionChange(next)
    } else {
      setLocalSelected(next)
    }
  }, [attachmentRelevance, availableAttachments, onSelectionChange])

  // Resolved selected set: prefer parent-controlled, fall back to local
  const selectedAttachments = selectedAttachmentIds ?? localSelected
  const setSelectedAttachments = (next: Set<string>) => {
    if (onSelectionChange) {
      onSelectionChange(next)
    } else {
      setLocalSelected(next)
    }
  }

  // Fallback quote-due when the parent didn't pass an explicit quoteDeadline.
  // Snap 3 days before the federal deadline backward to the previous business
  // day so it never lands on a weekend or observed US federal holiday.
  const responseNeeded = deadline
    ? format(
        previousBusinessDay(new Date(deadline.getTime() - 3 * 24 * 60 * 60 * 1000)),
        'EEEE, MMMM d',
      )
    : 'end of week'

  useEffect(() => {
    setSelectedTemplate(templateType)
  }, [templateType])

  useEffect(() => {
    setTo(recipientEmail)
  }, [recipientEmail])

  useEffect(() => {
    const template = TEMPLATES[selectedTemplate]
    if (!template) return

    const briefCtx = buildBriefContext(brief, callChecklist)

    const replacements: Record<string, string> = {
      '{{name}}': recipientName || '[Recipient Name]',
      '{{title}}': opportunityTitle,
      '{{solicitation}}': solicitationNumber,
      '{{amount}}': bidAmount ? `$${bidAmount.toLocaleString()}` : '[Amount]',
      '{{agency}}': agency || '[Agency]',
      '{{deadline}}': deadline ? format(deadline, 'MMMM d, yyyy') : '[Deadline]',
      '{{response_needed}}': responseNeeded,
      '{{quote_due}}': quoteDeadline || responseNeeded,
      '{{what_we_need}}': briefCtx.what_we_need,
      '{{deliverables_block}}': briefCtx.deliverables_block,
      '{{qualifications_block}}': briefCtx.qualifications_block,
      '{{screening_questions}}': briefCtx.screening_questions,
    }

    let newSubject = template.subject
    let newBody = template.body

    Object.entries(replacements).forEach(([key, value]) => {
      newSubject = newSubject.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value)
      newBody = newBody.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value)
    })

    setSubject(newSubject)
    setBody(newBody)
  }, [selectedTemplate, recipientName, opportunityTitle, solicitationNumber, bidAmount, deadline, agency, responseNeeded, brief, callChecklist, quoteDeadline])

  const handleSend = async () => {
    if (!to || !subject || !body) return

    // Validate recipient email format before sending
    if (!EMAIL_REGEX.test(to.trim())) {
      setToError('Enter a valid email address')
      return
    }
    setToError(null)
    setSendError(null)
    setSendSuccess(null)
    setSendPreworkLinks([])
    setSendPreworkDiagnostic(null)

    if (!onSend) {
      const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      window.open(mailtoUrl)
      return
    }

    setSending(true)
    try {
      const result = await onSend({
        to: to.trim(),
        subject,
        body,
        attachmentIds: Array.from(selectedAttachments),
        // Always ship the template keys when the box is checked — the server
        // silently drops them if no subcontractorId is on the request.
        ...(includePrework && preworkTemplates.length > 0
          ? { attachPreworkTemplates: preworkTemplates }
          : {}),
      })
      if (result?.success) {
        setSendSuccess(`Email sent to ${to.trim()}.`)
        if (result.preworkProvisioned?.length) {
          setSendPreworkLinks(result.preworkProvisioned)
        }
        if (result.preworkDiagnostic) {
          setSendPreworkDiagnostic(result.preworkDiagnostic)
        }
      } else {
        setSendError(result?.error || 'Email send failed.')
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Email send failed.')
    } finally {
      setSending(false)
    }
  }

  const totalAttachments = availableAttachments?.length ?? 0

  return (
    <>
      {/* Attachment Preview Modal */}
      {previewAttachment && opportunityId && availableAttachments && (
        <AttachmentPreviewModal
          attachments={availableAttachments}
          currentId={previewAttachment.id}
          opportunityId={opportunityId}
          onChange={(id) => {
            const next = availableAttachments?.find(a => a.id === id)
            if (next) setPreviewAttachment(next)
          }}
          onClose={() => setPreviewAttachment(null)}
        />
      )}

      <div className="h-full overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-stone-900">Email Draft</h1>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value as any)}
              className="text-sm text-stone-600 bg-stone-100 border-0 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-stone-300"
            >
              <option value="quote_request">Quote Request</option>
              <option value="follow_up">Follow Up</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Email form */}
          <div className={`bg-white border rounded-lg overflow-hidden ${toError ? 'border-red-300' : 'border-stone-200'}`}>
            <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-3">
              <span className="text-xs text-stone-400 w-12">To</span>
              <input
                type="email"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  if (toError) setToError(null)
                }}
                placeholder="recipient@example.com"
                className="flex-1 text-sm text-stone-800 bg-transparent border-0 outline-none placeholder-stone-300"
              />
              {toError && (
                <span className="text-xs text-red-500 flex-shrink-0">{toError}</span>
              )}
            </div>
            <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-3">
              <span className="text-xs text-stone-400 w-12">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
                className="flex-1 text-sm text-stone-800 bg-transparent border-0 outline-none placeholder-stone-300"
              />
            </div>
            <div className="p-4">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder="Email content..."
                className="w-full text-sm text-stone-800 bg-transparent border-0 outline-none resize-none placeholder-stone-300 leading-relaxed"
              />
            </div>
          </div>

          {/* ── Attachment Bundle ── */}
          {availableAttachments && availableAttachments.length > 0 && (
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              {/* Bundle header */}
              <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <h3 className="text-xs font-semibold text-stone-600 uppercase tracking-wide">
                    Attachment Bundle
                  </h3>
                </div>
                {totalAttachments > 0 && (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-stone-500">
                      {selectedAttachments.size} of {availableAttachments?.length ?? 0} selected
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          setSelectedAttachments(new Set(availableAttachments!.map((a) => a.id)))
                        }
                        className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2"
                      >
                        All
                      </button>
                      <button
                        onClick={() => setSelectedAttachments(new Set())}
                        className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2"
                      >
                        None
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="divide-y divide-stone-100">
                {/* Divider label */}
                <div className="px-4 py-2 bg-stone-50">
                  <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">
                    Solicitation Documents
                  </p>
                </div>

                {availableAttachments.map((att) => (
                  <div key={att.id} className="px-4 py-3 flex items-center gap-3 bg-white hover:bg-stone-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedAttachments.has(att.id)}
                      onChange={(e) => {
                        const next = new Set(selectedAttachments)
                        if (e.target.checked) next.add(att.id)
                        else next.delete(att.id)
                        setSelectedAttachments(next)
                      }}
                      className="w-4 h-4 rounded border-stone-300 text-stone-600 focus:ring-stone-300 flex-shrink-0"
                    />

                    {/* Eyeball preview button */}
                    <button
                      onClick={() => setPreviewAttachment(att)}
                      className="p-0.5 text-stone-300 hover:text-stone-600 transition-colors flex-shrink-0"
                      title={`Preview ${att.originalName}`}
                      aria-label="Preview attachment"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>

                    <div className="flex-1 min-w-0">
                      {/* Original SAM.gov filename — primary identifier */}
                      <p className="text-sm text-stone-800 truncate">{att.originalName}</p>
                      {/* Working name if renamed */}
                      {att.isEdited && (
                        <p className="text-[11px] text-stone-400 truncate">
                          renamed → {att.currentName}
                        </p>
                      )}
                      {/* AI relevance verdict */}
                      {attachmentRelevance?.[att.id] && (
                        <p
                          className={`text-[11px] truncate mt-0.5 ${
                            attachmentRelevance[att.id].include ? 'text-stone-500' : 'text-stone-400'
                          }`}
                          title={attachmentRelevance[att.id].reason}
                        >
                          {attachmentRelevance[att.id].include ? '✓ Auto-included' : '○ Skipped'} — {attachmentRelevance[att.id].reason}
                        </p>
                      )}
                    </div>

                    {att.size && (
                      <span className="text-[11px] text-stone-400 flex-shrink-0">
                        {(att.size / 1024).toFixed(0)} KB
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="px-4 py-2.5 bg-stone-50 border-t border-stone-100">
                <p className="text-[11px] text-stone-400">
                  Attach selected documents manually if using your mail client.
                </p>
              </div>
            </div>
          )}

          {/* Send result banner */}
          {sendSuccess && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 space-y-2">
              <p>{sendSuccess}</p>
              {sendPreworkLinks.length > 0 && (
                <div className="pt-2 border-t border-emerald-200">
                  <p className="text-xs font-semibold text-emerald-900 mb-1.5">
                    {sendPreworkLinks.length === 1 ? 'Portal link' : 'Portal links'} attached to the email (verify what your sub sees):
                  </p>
                  <ul className="space-y-1">
                    {sendPreworkLinks.map(link => (
                      <li key={link.templateKey} className="flex items-start gap-2 text-xs">
                        <span className="text-emerald-700 font-medium flex-shrink-0">
                          {link.templateDisplayName}:
                        </span>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-800 underline break-all font-mono"
                        >
                          {link.url}
                        </a>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(link.url).catch(() => {})}
                          className="text-emerald-700 hover:text-emerald-900 flex-shrink-0"
                          title="Copy link"
                        >
                          copy
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {sendPreworkDiagnostic && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
                  ⚠ {sendPreworkDiagnostic}
                </p>
              )}
            </div>
          )}
          {sendError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {sendError}
            </div>
          )}

          {/* Prework portal toggle */}
          {preworkTemplates.length > 0 && (
            <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer hover:bg-stone-100 transition-colors">
              <input
                type="checkbox"
                checked={includePrework}
                onChange={(e) => setIncludePrework(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-stone-300 text-stone-800 focus:ring-stone-300 flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-stone-800">
                  Include quote submission link
                </p>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Adds a secure magic-link URL where the sub can confirm their
                  info and send their quote without logging in.
                </p>
              </div>
            </label>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleSend}
              disabled={sending || !to || !EMAIL_REGEX.test(to.trim()) || !subject || !body}
              className="flex-1 px-4 py-3 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? 'Sending...' : 'Send Email'}
            </button>
            <button
              onClick={() => {
                const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
                window.open(mailtoUrl)
              }}
              className="px-4 py-3 text-sm font-medium text-stone-600 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
            >
              Open in Mail
            </button>
          </div>

          <p className="text-xs text-stone-400 text-center">
            Emails are not saved automatically. Use &quot;Open in Mail&quot; to use your default email client.
          </p>
        </div>
      </div>
    </>
  )
}
