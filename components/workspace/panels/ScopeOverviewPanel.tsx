'use client'

import { useState, useMemo } from 'react'
import { format, differenceInDays, addMonths, startOfMonth } from 'date-fns'
import { complianceGlossary } from '@/lib/data/compliance-glossary'
import type { GlossaryTerm } from '@/lib/data/compliance-glossary'
import type { OpportunityBrief, ScopeOverviewArtifact } from '@/lib/openai'

// ── Types ────────────────────────────────────────────────────────────────────

interface StructuredContent {
  scope: string[]
  deliverables: string[]
  compliance: string[]
  qualifications: string[]
  periodOfPerformance: string[]
  evaluation: string[]
}

interface ScopeItem {
  id: string
  text: string
  tags: string[]
  critical?: boolean
}

interface TeamNote {
  id: string
  author: string
  date: string
  text: string
}

interface ScopeOverviewPanelProps {
  opportunity: {
    id: string
    title: string
    solicitationNumber: string
    agency?: string
    naicsCode?: string
    description?: string
    responseDeadline?: string | Date
    postedDate?: string | Date
    estimatedContractValue?: number
    state?: string
    setAside?: string
    contractType?: string
    rawData?: any
    parsedAttachments?: { structured?: StructuredContent } | any
  }
  assessment?: {
    estimatedValue?: number
    estimatedCost?: number
    profitMarginPercent?: number
  } | null
  brief?: OpportunityBrief | null
  /** AI-generated scope overview (products/services/documentation/compliance).
   *  When present, replaces the rule-based extraction for deliverables and
   *  compliance, and adds Products/Services blocks to the Overview tab. */
  aiScope?: ScopeOverviewArtifact | null
}

// ── Glossary matching ─────────────────────────────────────────────────────────

// Build a flat list of all terms for matching
const ALL_TERMS: GlossaryTerm[] = complianceGlossary.categories.flatMap(c => c.terms)

// Keyword aliases: pattern → exact term name in glossary
// Order matters: more specific patterns first
const TERM_ALIASES: [RegExp, string][] = [
  // Abbreviations (word-boundary, handles plurals like CDRLs)
  [/\bFATs?\b/i,          'First Article Test (FAT)'],
  [/\bITPs?\b/i,          'Inspection and Test Plan (ITP)'],
  [/\bCDRLs?\b/i,         'Contract Data Requirements List (CDRL)'],
  [/\bDIDs?\b/i,          'Data Item Description (DID)'],
  [/\bQCPs?\b/i,          'Quality Control Plan (QCP)'],
  [/\bQASPs?\b/i,         'Quality Assurance Surveillance Plan (QASP)'],
  [/\bCPARS\b/i,          'Contractor Performance Assessment Reporting System (CPARS)'],
  [/\bWAWF\b/i,           'DD-250 / Wide Area Workflow (WAWF) Acceptance'],
  [/\bDD[-\s]?250\b/i,    'DD-250 / Wide Area Workflow (WAWF) Acceptance'],
  [/\bCUI\b/i,            'Controlled Unclassified Information (CUI)'],
  [/\bFCL\b/i,            'Facility Clearance (FCL)'],
  [/\bOCI\b/i,            'Organizational Conflicts of Interest (OCI)'],
  [/\bFCA\b/i,            'False Claims Act (FCA) Liability'],
  [/\bMSRs?\b/i,          'Monthly Status Report (MSR)'],
  [/\bKOM\b/i,            'Kick-Off Meeting (KOM)'],
  [/\bPMP\b/i,            'Project Management Plan (PMP)'],
  [/\bNCRs?\b/i,          'Nonconformance Report (NCR)'],
  [/\bCoC\b/i,            'Certificate of Conformance (CoC)'],
  [/\bGFP\b/i,            'Contractor Furnished Equipment / Government Furnished Property (GFP) Accountability'],
  [/\bT4D\b/i,            'Termination for Default (T4D)'],
  [/\bT4C\b/i,            'Termination for Convenience (T4C)'],
  [/\bSCA\b/i,            'Wage Determination / Service Contract Act (SCA) Compliance'],
  [/\bCMMC\b/i,           'Cybersecurity Maturity Model Certification (CMMC)'],
  [/\bDD[-\s]?254\b/i,    'DD Form 254 (Contract Security Classification Specification)'],
  [/\bFOB\b/i,            'FAR 52.247-34 — FOB Destination'],
  // Spelled-out forms (catches "Inspection & Test Plans", "Inspection and Test Plan")
  [/inspection\s*[&and]+\s*test\s*plans?/i,            'Inspection and Test Plan (ITP)'],
  [/first\s+article\s+test/i,                          'First Article Test (FAT)'],
  [/certificate\s+of\s+conformance/i,                  'Certificate of Conformance (CoC)'],
  [/certification\s+data\s+(requirements?\s+list|package)/i, 'Contract Data Requirements List (CDRL)'],
  [/quality\s+control\s+plans?/i,                      'Quality Control Plan (QCP)'],
  [/quality\s+assurance\s+surveillance/i,              'Quality Assurance Surveillance Plan (QASP)'],
  [/monthly\s+status\s+report/i,                       'Monthly Status Report (MSR)'],
  [/kick[-\s]?off\s+meeting/i,                         'Kick-Off Meeting (KOM)'],
  [/project\s+management\s+plans?/i,                   'Project Management Plan (PMP)'],
  [/nonconformance\s+report/i,                         'Nonconformance Report (NCR)'],
  [/wide\s+area\s+workflow/i,                          'DD-250 / Wide Area Workflow (WAWF) Acceptance'],
  [/controlled\s+unclassified/i,                       'Controlled Unclassified Information (CUI)'],
  [/facility\s+clearance/i,                            'Facility Clearance (FCL)'],
  [/government[\s-]furnished\s+property/i,             'Contractor Furnished Equipment / Government Furnished Property (GFP) Accountability'],
  [/item\s+unique\s+identif/i,                         'DD-250 / Wide Area Workflow (WAWF) Acceptance'],
  // FAR clause numbers → specific glossary entries
  [/52\.204-10\b/i,       'FAR 52.204-10 — Reporting Executive Compensation'],
  [/52\.204-21\b/i,       'FAR 52.204-21 — Basic Safeguarding of Covered Contractor Information Systems'],
  [/52\.209-6\b/i,        'FAR 52.209-6 — Protecting the Government\'s Interest When Subcontracting'],
  [/52\.219-14\b/i,       'FAR 52.219-14 — Limitations on Subcontracting (Small Business Set-Asides)'],
  [/52\.222-26\b/i,       'FAR 52.222-26 — Equal Opportunity'],
  [/52\.232-33\b/i,       'FAR 52.232-33 — Payment by Electronic Funds Transfer (EFT)'],
  [/52\.246-[24]\b/i,     'FAR 52.246-2 / 52.246-4 — Inspection of Supplies / Inspection of Services'],
  [/52\.247-34\b/i,       'FAR 52.247-34 — FOB Destination'],
  [/252\.204-7012\b/i,    'DFARS 252.204-7012 — Safeguarding Covered Defense Information (CDI) / Cyber Incident Reporting'],
  // Any other FAR/DFARS clause number → inspection entry as fallback (most common)
  [/\b(?:FAR|DFARS?)\s+\d+\.\d/i, 'FAR 52.246-2 / 52.246-4 — Inspection of Supplies / Inspection of Services'],
  // Plain-language phrases
  [/buy\s+american/i,                   'Buy American Act Compliance'],
  [/wage\s+determination/i,             'Wage Determination / Service Contract Act (SCA) Compliance'],
  [/service\s+contract\s+act/i,         'Wage Determination / Service Contract Act (SCA) Compliance'],
  [/limitations?\s+on\s+subcontract/i,  'FAR 52.219-14 — Limitations on Subcontracting (Small Business Set-Asides)'],
  [/false\s+claims/i,                   'False Claims Act (FCA) Liability'],
  [/cure\s+notice/i,                    'Cure Notice'],
  [/show\s+cause/i,                     'Show Cause Notice'],
  [/termination\s+for\s+default/i,      'Termination for Default (T4D)'],
  [/termination\s+for\s+convenience/i,  'Termination for Convenience (T4C)'],
  [/per\s+contract\s+schedule/i,        'Shipping/Delivery Instructions (\'Per Contract\')'],
  [/per\s+contract\b/i,                 'Shipping/Delivery Instructions (\'Per Contract\')'],
  [/final\s+(?:product\s+)?delivery/i,  'Acceptance'],
  [/receiving\s+report/i,               'Receiving Report'],
]

function findGlossaryMatches(text: string): GlossaryTerm[] {
  const found = new Set<GlossaryTerm>()

  for (const [pattern, termName] of TERM_ALIASES) {
    if (pattern.test(text)) {
      const match = ALL_TERMS.find(t => t.term === termName)
      if (match && !found.has(match)) {
        found.add(match)
        if (found.size >= 3) break // cap early
      }
    }
  }

  // Fallback: scan full term core names
  if (found.size < 3) {
    for (const t of ALL_TERMS) {
      if (found.has(t)) continue
      const coreName = t.term.replace(/\s*\([^)]+\)\s*/g, '').replace(/\s*\/.*$/, '').trim()
      if (coreName.length > 10) {
        const escaped = coreName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (new RegExp(escaped, 'i').test(text)) {
          found.add(t)
          if (found.size >= 3) break
        }
      }
    }
  }

  return [...found]
}

// ── Tag colors ────────────────────────────────────────────────────────────────

const TAG_STYLES: Record<string, string> = {
  'CRITICAL': 'bg-amber-100 text-amber-800 border-amber-200',
  'CRITICAL PATH': 'bg-amber-100 text-amber-800 border-amber-200',
  'FIRST ARTICLE': 'bg-amber-100 text-amber-800 border-amber-200',
  'INSPECTION REQUIRED': 'bg-amber-100 text-amber-800 border-amber-200',
  'GOVERNMENT WITNESS': 'bg-amber-50 text-amber-700 border-amber-200',
  'REQUIRED': 'bg-stone-800 text-white border-stone-800',
  'MILITARY GRADE': 'bg-stone-700 text-white border-stone-700',
  'ITAR': 'bg-red-100 text-red-800 border-red-200',
  'BUY AMERICAN': 'bg-stone-100 text-stone-700 border-stone-300',
  'QUALITY ASSURANCE': 'bg-stone-100 text-stone-700 border-stone-300',
  'OPTIONAL': 'bg-stone-50 text-stone-500 border-stone-200',
  'CUI': 'bg-red-50 text-red-700 border-red-200',
  'FAR': 'bg-stone-100 text-stone-600 border-stone-200',
  'DFARS': 'bg-stone-100 text-stone-600 border-stone-200',
  'MIL-SPEC': 'bg-stone-100 text-stone-600 border-stone-200',
  'DEFAULT': 'bg-stone-100 text-stone-600 border-stone-200',
}

function tagStyle(tag: string): string {
  return TAG_STYLES[tag.toUpperCase()] || TAG_STYLES.DEFAULT
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractTags(text: string): string[] {
  const tags: string[] = []
  const t = text.toUpperCase()
  if (t.includes('FIRST ARTICLE') || t.includes('FAT')) tags.push('FIRST ARTICLE')
  if (t.includes('CRITICAL') || t.includes('SPECIAL EMPHASIS') || t.includes('LEVEL I')) tags.push('CRITICAL')
  if (t.includes('INSPECT')) tags.push('INSPECTION REQUIRED')
  if (t.includes('ITAR') || t.includes('EXPORT CONTROL')) tags.push('ITAR')
  if (t.includes('BUY AMERICAN') || t.includes('BALANCE OF PAYMENTS')) tags.push('BUY AMERICAN')
  if (t.includes('QUALITY') || t.includes('QC') || t.includes('ISO')) tags.push('QUALITY ASSURANCE')
  if (/\bFAR\s+\d/.test(t) || /FAR\s+52\./.test(t)) tags.push('FAR')
  if (/\bDFARS\b/.test(t)) tags.push('DFARS')
  if (/\bMIL-/.test(t)) tags.push('MIL-SPEC')
  if (t.includes('CUI') || t.includes('CONTROLLED UNCLASSIFIED')) tags.push('CUI')
  if (t.includes('OPTIONAL') || t.includes('OPTION LINE')) tags.push('OPTIONAL')
  return [...new Set(tags)].slice(0, 4)
}

function isCritical(text: string): boolean {
  const t = text.toUpperCase()
  return (
    t.includes('CRITICAL') || t.includes('SPECIAL EMPHASIS') ||
    t.includes('LEVEL I') || t.includes('ITAR') || t.includes('FIRST ARTICLE')
  )
}

function extractDeliverables(structured: StructuredContent | undefined): ScopeItem[] {
  const raw = structured?.deliverables || []
  const defaults = [
    { text: 'Certification Data Package (CDRLs)', tags: ['REQUIRED'] },
    { text: 'Inspection & Test Plans — submit 20 days pre-delivery', tags: ['REQUIRED'] },
    { text: 'First Article Test (FAT) Report', tags: ['FIRST ARTICLE', 'REQUIRED'] },
    { text: 'Final product delivery per contract schedule', tags: ['REQUIRED'] },
  ]
  if (raw.length === 0) {
    return defaults.map((d, i) => ({ id: `del-${i}`, text: d.text, tags: d.tags, critical: d.tags.includes('FIRST ARTICLE') }))
  }
  return raw.slice(0, 6).map((text, i) => ({
    id: `del-${i}`,
    text: text.length > 200 ? text.substring(0, 200) + '…' : text,
    tags: extractTags(text),
    critical: isCritical(text),
  }))
}

function extractCompliance(structured: StructuredContent | undefined, description: string): ScopeItem[] {
  const raw = structured?.compliance || []
  const farMatches = description.match(/(?:FAR|DFARS?|AFARS?|VAAR)\s+\d+\.\d+(?:-\d+)?/gi) || []
  const milMatches = description.match(/MIL-(?:STD|DTL|SPEC|I|S|T|C|P|A|E|H|PRF)-[\w-]+/gi) || []
  const combined = [
    ...raw,
    ...farMatches.map(f => `${f} — Federal Acquisition Regulation clause applies`),
    ...milMatches.map(m => `${m} — Military specification requirement`),
  ]
  if (combined.length === 0) {
    return [
      { id: 'comp-0', text: 'All applicable FAR clauses as listed in solicitation', tags: ['FAR'], critical: false },
      { id: 'comp-1', text: 'Buy American Act — domestic sourcing requirements apply', tags: ['BUY AMERICAN'], critical: false },
      { id: 'comp-2', text: 'Item Unique Identification (IUID) — part marking required', tags: ['REQUIRED'], critical: false },
    ]
  }
  return [...new Set(combined)].slice(0, 8).map((text, i) => ({
    id: `comp-${i}`,
    text: text.length > 200 ? text.substring(0, 200) + '…' : text,
    tags: extractTags(text),
    critical: isCritical(text),
  }))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Tag({ label }: { label: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${tagStyle(label)}`}>
      {label}
    </span>
  )
}

// Inline term explainer shown when user clicks "?"
function TermExplainer({ term, onClose }: { term: GlossaryTerm; onClose: () => void }) {
  return (
    <div className="mt-3 bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-stone-800">{term.term}</p>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 flex-shrink-0 mt-0.5">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="text-stone-600 leading-relaxed">{term.fullExplanation}</p>

      <div>
        <p className="font-semibold text-stone-700 mb-1">What you must do:</p>
        <ul className="space-y-1">
          {term.contractorMustDo.map((action, i) => (
            <li key={i} className="flex items-start gap-1.5 text-stone-600">
              <span className="text-stone-400 mt-0.5 flex-shrink-0">→</span>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      </div>

      {term.commonMistakes.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded p-2 space-y-1">
          <p className="font-semibold text-amber-800 text-[10px] uppercase tracking-wide">Common mistakes</p>
          {term.commonMistakes.map((m, i) => (
            <p key={i} className="text-amber-800 leading-snug">⚠ {m}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 border-t border-stone-200">
        {term.timing && (
          <span className="text-stone-400">
            <span className="font-medium text-stone-600">Timing:</span> {term.timing}
          </span>
        )}
        {term.farRef && (
          <span className="text-stone-400">
            <span className="font-medium text-stone-600">Reference:</span> {term.farRef}
          </span>
        )}
      </div>
    </div>
  )
}

function ScopeCard({
  item,
  showCheckbox,
  checked,
  onCheck,
}: {
  item: ScopeItem
  showCheckbox?: boolean
  checked?: boolean
  onCheck?: (id: string, checked: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [activeTerm, setActiveTerm] = useState<GlossaryTerm | null>(null)

  const isLong = item.text.length > 120
  const displayText = isLong && !expanded ? item.text.substring(0, 120) + '…' : item.text

  const glossaryMatches = useMemo(() => findGlossaryMatches(item.text), [item.text])
  const hasGlossary = glossaryMatches.length > 0

  const toggleTerm = (t: GlossaryTerm) => {
    setActiveTerm(prev => prev?.term === t.term ? null : t)
  }

  return (
    <div className={`rounded-lg border p-3 transition-colors ${
      item.critical
        ? 'border-l-2 border-l-amber-400 border-t-stone-200 border-r-stone-200 border-b-stone-200 bg-amber-50/30'
        : 'border-stone-200 bg-white hover:bg-stone-50'
    }`}>
      <div className="flex items-start gap-2">
        {showCheckbox && (
          <input
            type="checkbox"
            checked={checked}
            onChange={e => onCheck?.(item.id, e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-stone-300 text-stone-800 focus:ring-stone-500"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-stone-800 leading-snug">{displayText}</p>
          {isLong && (
            <button onClick={() => setExpanded(!expanded)} className="mt-1 text-xs text-stone-400 hover:text-stone-600">
              {expanded ? 'Show less ↑' : 'Show more ↓'}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {item.tags.map(tag => <Tag key={tag} label={tag} />)}
            {/* Glossary "?" buttons — one per matched term */}
            {glossaryMatches.map(t => (
              <button
                key={t.term}
                onClick={() => toggleTerm(t)}
                title={`What is ${t.term}?`}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                  activeTerm?.term === t.term
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-stone-50 text-stone-500 border-stone-200 hover:border-stone-400 hover:text-stone-700'
                }`}
              >
                <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t.term.replace(/\s*\(.*?\)/, '').trim().split(' ').slice(0, 3).join(' ')}
              </button>
            ))}
          </div>

          {/* Inline term explanation */}
          {activeTerm && (
            <TermExplainer term={activeTerm} onClose={() => setActiveTerm(null)} />
          )}
        </div>

        {!hasGlossary && (
          <button
            onClick={() => navigator.clipboard.writeText(item.text).catch(() => {})}
            className="flex-shrink-0 p-1 text-stone-300 hover:text-stone-500 transition-colors"
            title="Copy to clipboard"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

function SectionBlock({
  icon,
  title,
  count,
  items,
  accentClass,
  showCheckboxes,
  checkedItems,
  onCheck,
}: {
  icon: string
  title: string
  count: number
  items: ScopeItem[]
  accentClass: string
  showCheckboxes?: boolean
  checkedItems?: Set<string>
  onCheck?: (id: string, checked: boolean) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const visibleItems = showAll ? items : items.slice(0, 3)

  return (
    <div className={`rounded-xl border ${accentClass} overflow-hidden`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="text-sm font-semibold text-stone-800">{title}</span>
          <span className="text-xs text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full">{count}</span>
        </div>
        <svg className={`h-4 w-4 text-stone-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4 space-y-2 bg-stone-50/50">
          {visibleItems.map(item => (
            <ScopeCard
              key={item.id}
              item={item}
              showCheckbox={showCheckboxes}
              checked={checkedItems?.has(item.id)}
              onCheck={onCheck}
            />
          ))}
          {items.length > 3 && (
            <button onClick={() => setShowAll(!showAll)} className="w-full text-xs text-stone-400 hover:text-stone-600 py-1">
              {showAll ? 'Show less ↑' : `Show all ${items.length} ↓`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function DeliverableTable({ items }: { items: ScopeItem[] }) {
  const [activeTerm, setActiveTerm] = useState<{ rowId: string; term: GlossaryTerm } | null>(null)

  return (
    <div className="rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-100">
        <div className="flex items-center gap-2">
          <span className="text-base">📄</span>
          <span className="text-sm font-semibold text-stone-800">Documentation & Deliverables</span>
          <span className="text-xs text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full">{items.length}</span>
        </div>
      </div>
      <div className="bg-stone-50/50">
        <div className="grid grid-cols-12 px-4 py-2 border-b border-stone-200 bg-stone-100">
          <span className="col-span-7 text-xs font-semibold text-stone-500 uppercase tracking-wide">Deliverable</span>
          <span className="col-span-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Due</span>
          <span className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">Status</span>
        </div>
        {items.map((item, i) => {
          const dueSoon = item.text.toLowerCase().includes('20 days') || item.text.toLowerCase().includes('pre-delivery')
          const matches = findGlossaryMatches(item.text)
          const rowKey = item.id

          return (
            <div key={item.id}>
              <div className={`grid grid-cols-12 px-4 py-3 border-b border-stone-100 last:border-0 ${i % 2 === 1 ? 'bg-white' : 'bg-stone-50/30'}`}>
                <div className="col-span-7 pr-4">
                  <p className="text-sm text-stone-800 leading-snug">{item.text.length > 100 ? item.text.substring(0, 100) + '…' : item.text}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.tags.slice(0, 2).map(tag => <Tag key={tag} label={tag} />)}
                    {matches.map(t => (
                      <button
                        key={t.term}
                        onClick={() => setActiveTerm(
                          activeTerm?.rowId === rowKey && activeTerm.term.term === t.term
                            ? null
                            : { rowId: rowKey, term: t }
                        )}
                        title={`What is ${t.term}?`}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                          activeTerm?.rowId === rowKey && activeTerm.term.term === t.term
                            ? 'bg-stone-800 text-white border-stone-800'
                            : 'bg-stone-50 text-stone-500 border-stone-200 hover:border-stone-400 hover:text-stone-700'
                        }`}
                      >
                        <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {t.term.replace(/\s*\(.*?\)/, '').trim().split(' ').slice(0, 3).join(' ')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-3">
                  <span className={`text-xs font-medium ${dueSoon ? 'text-amber-700' : 'text-stone-500'}`}>
                    {dueSoon ? '20 days pre-delivery' : 'Per contract'}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">Pending</span>
                </div>
              </div>
              {/* Inline explanation — spans full row */}
              {activeTerm?.rowId === rowKey && (
                <div className="px-4 pb-3 bg-white border-b border-stone-100">
                  <TermExplainer term={activeTerm.term} onClose={() => setActiveTerm(null)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TeamNotes() {
  const [notes, setNotes] = useState<TeamNote[]>([])
  const [draft, setDraft] = useState('')
  const [authorName, setAuthorName] = useState('')

  const addNote = () => {
    const text = draft.trim()
    if (!text) return
    setNotes(prev => [...prev, {
      id: Date.now().toString(),
      author: authorName.trim() || 'You',
      date: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }),
      text,
    }])
    setDraft('')
  }

  return (
    <div className="rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-100">
        <div className="flex items-center gap-2">
          <span className="text-base">💬</span>
          <span className="text-sm font-semibold text-stone-800">Team Notes</span>
          {notes.length > 0 && <span className="text-xs text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full">{notes.length}</span>}
        </div>
      </div>
      <div className="bg-stone-50/50 p-4 space-y-3">
        {notes.length === 0 && <p className="text-xs text-stone-400 italic text-center py-2">No notes yet. Add a note for your team.</p>}
        {notes.map(note => (
          <div key={note.id} className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-stone-600">
              {note.author[0]?.toUpperCase()}
            </div>
            <div className="flex-1 bg-white rounded-lg border border-stone-200 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-stone-700">{note.author}</span>
                <span className="text-xs text-stone-400">{note.date}</span>
              </div>
              <p className="text-sm text-stone-700">{note.text}</p>
            </div>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <input value={authorName} onChange={e => setAuthorName(e.target.value)} placeholder="Your name"
            className="w-24 px-2 py-1.5 text-xs border border-stone-200 rounded-lg bg-white focus:outline-none focus:border-stone-400" />
          <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNote()}
            placeholder="Add a note for your team…"
            className="flex-1 px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white focus:outline-none focus:border-stone-400" />
          <button onClick={addNote} disabled={!draft.trim()}
            className="px-3 py-1.5 text-xs font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-40 transition-colors">
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Post-Award Milestone Tracker ──────────────────────────────────────────────

const POST_AWARD_STAGES = [
  { key: 'award',      label: 'Award',             desc: 'Contract awarded — start date confirmed' },
  { key: 'kickoff',   label: 'Kickoff Meeting',    desc: 'Initial meeting with COR / contracting officer' },
  { key: 'mobilize',  label: 'Mobilization',       desc: 'Team on-site, security clearances, equipment staged' },
  { key: 'delivery1', label: '1st Deliverable',    desc: 'First CDRLs or milestone delivery submitted' },
  { key: 'midterm',   label: 'Mid-term Review',    desc: 'Performance review with government customer' },
  { key: 'final',     label: 'Final Delivery',     desc: 'All deliverables accepted' },
  { key: 'closeout',  label: 'Contract Close-out', desc: 'Invoicing complete, documentation archived' },
]

function PostAwardTracker() {
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setCompleted(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const pct = Math.round((completed.size / POST_AWARD_STAGES.length) * 100)

  return (
    <div className="rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-100">
        <div className="flex items-center gap-2">
          <span className="text-base">🏁</span>
          <span className="text-sm font-semibold text-stone-800">Post-Award Progress</span>
          <span className="text-xs text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full">{pct}%</span>
        </div>
        <div className="w-24 h-1.5 bg-stone-100 rounded-full overflow-hidden">
          <div className="h-full bg-stone-600 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="bg-stone-50/50">
        {POST_AWARD_STAGES.map((stage, i) => {
          const done = completed.has(stage.key)
          const prevDone = i === 0 || completed.has(POST_AWARD_STAGES[i - 1].key)
          return (
            <div key={stage.key} className={`flex items-start gap-3 px-4 py-3 border-b border-stone-100 last:border-0 transition-colors ${done ? 'bg-white' : 'bg-stone-50/30'}`}>
              <button onClick={() => toggle(stage.key)}
                className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  done ? 'border-stone-600 bg-stone-600'
                  : prevDone ? 'border-stone-300 bg-white hover:border-stone-500'
                  : 'border-stone-200 bg-white opacity-50 cursor-not-allowed'
                }`}
                disabled={!prevDone && !done}>
                {done && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium ${done ? 'text-stone-400 line-through' : 'text-stone-800'}`}>{stage.label}</p>
                  <span className="text-xs text-stone-300">Stage {i + 1}</span>
                </div>
                <p className="text-xs text-stone-400 mt-0.5">{stage.desc}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Contract Lifecycle ────────────────────────────────────────────────────────

interface LifecyclePhase {
  phase: string
  timeframe: string
  durationMonths: number   // approximate months for calendar rendering
  color: string            // tailwind bg class
  actions: string[]
  overdeliver?: string[]
}

function parsePeriodMonths(brief: OpportunityBrief | null | undefined): number {
  const s = brief?.periodOfPerformance?.basePeriod ?? ''
  const optYears = brief?.periodOfPerformance?.optionYears ?? 0
  // Try "X months"
  const mMatch = s.match(/(\d+)\s*month/i)
  if (mMatch) return parseInt(mMatch[1]) + optYears * 12
  // Try "X year(s)"
  const yMatch = s.match(/(\d+)\s*year/i)
  if (yMatch) return parseInt(yMatch[1]) * 12 + optYears * 12
  // Try date range "Mon YYYY – Mon YYYY"
  const rangeMatch = s.match(/(\w+)\s+(\d{4})\s*[–\-]\s*(\w+)\s+(\d{4})/)
  if (rangeMatch) {
    const start = new Date(`${rangeMatch[1]} 1, ${rangeMatch[2]}`)
    const end = new Date(`${rangeMatch[3]} 1, ${rangeMatch[4]}`)
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      const diff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
      return diff + optYears * 12
    }
  }
  return 12 + optYears * 12 // default
}

function buildLifecycle(brief: OpportunityBrief | null | undefined, opportunity: { contractType?: string; setAside?: string; agency?: string }): LifecyclePhase[] {
  const hasDeliverables = (brief?.keyDeliverables?.length ?? 0) > 0
  const hasClearance = (brief?.whoQualifies?.clearances?.length ?? 0) > 0
  const isOnsite = brief?.placeOfPerformance?.siteType === 'on-site' || brief?.placeOfPerformance?.siteType === 'hybrid'
  const hasOptions = (brief?.periodOfPerformance?.optionYears ?? 0) > 0
  const perfMonths = parsePeriodMonths(brief)
  const optMonths = (brief?.periodOfPerformance?.optionYears ?? 0) * 12
  const baseMonths = perfMonths - optMonths

  return [
    {
      phase: 'Pre-Award',
      timeframe: 'Now through proposal submission',
      durationMonths: 1,
      color: 'bg-stone-400',
      actions: [
        "Read every page of the solicitation — especially Section C (scope), Section F (delivery), Section H (special requirements), and Section L/M (how you'll be evaluated)",
        'Identify all FAR and DFARS clauses in Section I — each one is a legal obligation you\'re agreeing to',
        'Verify your SAM.gov registration is active and all certifications are current',
        'Confirm your NAICS code and any size standard eligibility',
        ...(hasClearance ? ['Begin facility clearance (FCL) process early — it can take 6–18 months'] : []),
        'Get at minimum two subcontractor quotes — include their past performance info in your proposal',
        'Price your bid using historical comparable data, not gut feel',
      ],
      overdeliver: [
        'Submit your proposal 24–48 hours early — last-minute uploads fail more than you think',
        'Include a one-page executive summary that mirrors the government\'s evaluation criteria',
        'Volunteer relevant past performance proactively, even if not explicitly required',
      ],
    },
    {
      phase: 'Award & Kickoff',
      timeframe: 'Days 1–30 after award',
      durationMonths: 1,
      color: 'bg-stone-600',
      actions: [
        'Review the awarded contract in full — compare it to your proposal to catch any modifications',
        'Register in Wide Area Workflow (WAWF) before your first delivery — you cannot invoice without it',
        'Schedule the Kickoff Meeting (KOM) with your Contracting Officer (CO) and COR within 14 days',
        'Confirm your key personnel are in place and notify the CO immediately if there are any changes',
        ...(isOnsite ? ['Arrange site access, badges, and security processing for all on-site personnel'] : []),
        'Set up your reporting cadence — monthly status reports, financial reports, CDRL due dates',
        'Establish your Quality Control Plan (QCP) and submit it if required',
        ...(hasClearance ? ['Confirm all cleared personnel are listed on the DD-254 and verify current clearances'] : []),
      ],
      overdeliver: [
        'Send a one-page "Contract Start Memo" to your COR outlining your team, communication plan, and first 30-day milestones',
        'Set up a shared document folder with the government team before the KOM',
        'Ask your COR how they prefer to receive status updates — some want email, some want formal reports only',
      ],
    },
    {
      phase: 'Performance',
      timeframe: `Base period (${baseMonths} months)`,
      durationMonths: Math.max(baseMonths - 1, 1),
      color: 'bg-stone-700',
      actions: [
        'Submit all CDRLs and data items on or before their due dates — late deliverables trigger cure notices',
        'File monthly status reports (MSRs) even if nothing changed — silence looks like a problem',
        ...(hasDeliverables ? ['Submit Inspection & Test Plans (ITPs) at least 20 days before delivery'] : []),
        'Document everything — government witnesses, inspection results, approvals — in writing',
        'Track spending against the funded amount and notify your CO immediately if you\'re approaching the ceiling',
        'Respond to any government RFIs or data calls within the requested timeframe',
        'Keep subcontractor performance records — you\'ll need them for CPARS and future bids',
      ],
      overdeliver: [
        'Send a brief monthly "good news" note to your COR highlighting wins, not just status',
        'Proactively flag potential issues before they become problems — COs reward transparency',
        'Propose process improvements or cost-saving ideas in writing — it helps your CPARS rating',
        'Document lessons learned mid-contract, not just at the end',
      ],
    },
    ...(hasOptions ? [{
      phase: 'Option Year(s)',
      timeframe: `${brief?.periodOfPerformance?.optionYears} option year${(brief?.periodOfPerformance?.optionYears ?? 0) !== 1 ? 's' : ''} — exercise not guaranteed`,
      durationMonths: optMonths,
      color: 'bg-stone-500',
      actions: [
        'Confirm with your CO whether the option will be exercised — do not assume',
        'Review your pricing for the option period against current market rates',
        'Update subcontractor agreements and get renewed quotes if needed',
        'Verify SAM.gov registration remains active — options cannot be exercised if you\'ve lapsed',
        'Request a performance discussion with your COR before option exercise to surface any concerns',
      ],
      overdeliver: [
        'Prepare a one-page "Year in Review" summarizing accomplishments — share it with your CO at the right moment',
        'Propose value-added improvements or efficiencies for the option period',
      ],
    }] : []),
    {
      phase: 'Closeout',
      timeframe: 'Final 30–60 days',
      durationMonths: 1,
      color: 'bg-stone-800',
      actions: [
        'Submit all final deliverables and obtain written acceptance from the government',
        'File your final invoice through WAWF promptly after final acceptance',
        'Return all Government Furnished Property (GFP) and get receipts',
        'Respond to your CPARS evaluation within the 14-day contractor comment window — this is your permanent record',
        'Archive all contract documentation for at least 3 years (or longer per your contract terms)',
        'Collect past performance documentation for future proposals',
      ],
      overdeliver: [
        'Ask your COR for a written letter of commendation — it supplements CPARS',
        'Send a concise transition memo if another contractor is taking over',
        'Request a debrief even if the closeout was smooth — you learn something every time',
      ],
    },
  ]
}

// ── Lifecycle List View ───────────────────────────────────────────────────────

function LifecycleList({ phases }: { phases: LifecyclePhase[] }) {
  const [openPhase, setOpenPhase] = useState<string | null>(null)
  const [showOverdeliver, setShowOverdeliver] = useState<Record<string, boolean>>({})

  return (
    <div className="space-y-2">
      {phases.map((phase, i) => {
        const isOpen = openPhase === phase.phase
        const showOD = showOverdeliver[phase.phase]
        return (
          <div key={phase.phase} className="border border-stone-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenPhase(isOpen ? null : phase.phase)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-stone-50 transition-colors text-left"
            >
              <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${phase.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-800">{phase.phase}</p>
                <p className="text-xs text-stone-400">{phase.timeframe}</p>
              </div>
              <span className="text-[10px] text-stone-400 flex-shrink-0">{phase.actions.length} actions</span>
              <svg className={`h-4 w-4 text-stone-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 bg-stone-50/50 space-y-3">
                <div className="pt-3 space-y-1.5">
                  {phase.actions.map((action, j) => (
                    <div key={j} className="flex items-start gap-2">
                      <svg className="h-3.5 w-3.5 text-stone-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <p className="text-sm text-stone-700 leading-snug">{action}</p>
                    </div>
                  ))}
                </div>
                {(phase.overdeliver?.length ?? 0) > 0 && (
                  <div>
                    <button
                      onClick={() => setShowOverdeliver(prev => ({ ...prev, [phase.phase]: !showOD }))}
                      className="flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 transition-colors"
                    >
                      <svg className="h-3.5 w-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {showOD ? 'Hide' : 'Show'} ways to overdeliver
                    </button>
                    {showOD && (
                      <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg p-3 space-y-1.5">
                        {phase.overdeliver!.map((tip, j) => (
                          <div key={j} className="flex items-start gap-2">
                            <span className="text-amber-500 flex-shrink-0 mt-0.5 text-xs">⚡</span>
                            <p className="text-xs text-amber-900 leading-snug">{tip}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Lifecycle Calendar View ───────────────────────────────────────────────────

function LifecycleCalendar({ phases, responseDeadline }: { phases: LifecyclePhase[]; responseDeadline?: string | Date | null }) {
  // Default projected award: 45 days after response deadline, or 60 days from now
  const defaultAward = useMemo(() => {
    if (responseDeadline) {
      const dl = new Date(responseDeadline)
      const projected = new Date(dl)
      projected.setDate(projected.getDate() + 45)
      return projected.toISOString().split('T')[0]
    }
    const d = new Date()
    d.setDate(d.getDate() + 60)
    return d.toISOString().split('T')[0]
  }, [responseDeadline])

  const [awardDateStr, setAwardDateStr] = useState(defaultAward)
  const [activePhase, setActivePhase] = useState<string | null>(null)

  const awardDate = useMemo(() => {
    const d = new Date(awardDateStr + 'T00:00:00')
    return isNaN(d.getTime()) ? new Date() : d
  }, [awardDateStr])

  // Build phase segments: { phase, start (month index from awardDate), durationMonths }
  const segments = useMemo(() => {
    let cursor = 0
    // Pre-award: ends at award (shown before month 0)
    return phases.map(phase => {
      const seg = { phase, startMonth: cursor, durationMonths: phase.durationMonths }
      cursor += phase.durationMonths
      return seg
    })
  }, [phases])

  const totalMonths = segments.reduce((n, s) => Math.max(n, s.startMonth + s.durationMonths), 0)

  // Month labels: from 1 month before award to end
  const months = useMemo(() => {
    return Array.from({ length: totalMonths + 1 }, (_, i) => addMonths(startOfMonth(awardDate), i))
  }, [awardDate, totalMonths])

  const COL_WIDTH = 72 // px per month column

  return (
    <div className="space-y-4">
      {/* Date input */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs text-stone-500 font-medium">Projected award date:</label>
        <input
          type="date"
          value={awardDateStr}
          onChange={e => setAwardDateStr(e.target.value)}
          className="text-xs border border-stone-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-stone-400"
        />
        {responseDeadline && (
          <span className="text-[10px] text-stone-400">
            (Response deadline: {format(new Date(responseDeadline), 'MMM d, yyyy')} — award typically 30–90 days later)
          </span>
        )}
      </div>

      {/* Timeline */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        {/* Month header */}
        <div className="flex border-b border-stone-100" style={{ minWidth: months.length * COL_WIDTH }}>
          <div className="flex-shrink-0 w-28 px-3 py-2 text-[10px] font-semibold text-stone-400 uppercase tracking-wide border-r border-stone-100">
            Phase
          </div>
          {months.map((m, i) => (
            <div key={i} className="flex-shrink-0 text-center py-2 border-r border-stone-50 last:border-0" style={{ width: COL_WIDTH }}>
              <p className="text-[10px] font-medium text-stone-500">{format(m, 'MMM')}</p>
              <p className="text-[10px] text-stone-300">{format(m, 'yyyy')}</p>
            </div>
          ))}
        </div>

        {/* Phase rows */}
        <div className="divide-y divide-stone-50">
          {segments.map(({ phase, startMonth, durationMonths }) => {
            const isActive = activePhase === phase.phase
            return (
              <button
                key={phase.phase}
                onClick={() => setActivePhase(isActive ? null : phase.phase)}
                className={`flex w-full text-left transition-colors ${isActive ? 'bg-stone-50' : 'hover:bg-stone-50/50'}`}
                style={{ minWidth: months.length * COL_WIDTH }}
              >
                {/* Label */}
                <div className="flex-shrink-0 w-28 px-3 py-3 border-r border-stone-100 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${phase.color}`} />
                  <span className="text-[11px] font-medium text-stone-700 leading-tight">{phase.phase}</span>
                </div>
                {/* Bar */}
                <div className="flex-1 py-3 px-1 relative" style={{ minWidth: (months.length) * COL_WIDTH - 112 }}>
                  <div
                    className={`absolute top-3 h-6 rounded flex items-center px-2 ${phase.color} opacity-90 transition-opacity hover:opacity-100`}
                    style={{
                      left: `${startMonth * COL_WIDTH}px`,
                      width: `${durationMonths * COL_WIDTH - 4}px`,
                    }}
                  >
                    <span className="text-[10px] font-medium text-white truncate">{phase.timeframe}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Today marker */}
        {(() => {
          const todayOffset = (new Date().getTime() - awardDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
          if (todayOffset < 0 || todayOffset > totalMonths) return null
          return (
            <div className="relative h-0" style={{ minWidth: months.length * COL_WIDTH }}>
              <div
                className="absolute top-0 bottom-0 w-px bg-red-400 opacity-60 pointer-events-none"
                style={{ left: `${112 + todayOffset * COL_WIDTH}px`, height: `${segments.length * 48 + 40}px`, top: `-${segments.length * 48 + 40}px` }}
              >
                <span className="absolute -top-4 -left-4 text-[9px] text-red-500 font-semibold bg-white px-1">Today</span>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Expanded phase detail */}
      {activePhase && (() => {
        const phase = phases.find(p => p.phase === activePhase)
        if (!phase) return null
        return (
          <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
            <div className={`px-4 py-2.5 flex items-center gap-2 ${phase.color}`}>
              <p className="text-sm font-semibold text-white">{phase.phase}</p>
              <span className="text-xs text-white/70">{phase.timeframe}</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-1.5">
                {phase.actions.map((action, j) => (
                  <div key={j} className="flex items-start gap-2">
                    <svg className="h-3.5 w-3.5 text-stone-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <p className="text-sm text-stone-700 leading-snug">{action}</p>
                  </div>
                ))}
              </div>
              {(phase.overdeliver?.length ?? 0) > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide mb-1">⚡ Ways to overdeliver</p>
                  {phase.overdeliver!.map((tip, j) => (
                    <p key={j} className="text-xs text-amber-900 leading-snug">{tip}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-1">
        {phases.map(p => (
          <div key={p.phase} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${p.color}`} />
            <span className="text-[10px] text-stone-500">{p.phase}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-400 opacity-60" />
          <span className="text-[10px] text-stone-500">Today</span>
        </div>
      </div>
    </div>
  )
}

// ── Lifecycle Tab (list + calendar toggle) ────────────────────────────────────

function LifecycleTab({ brief, opportunity }: { brief: OpportunityBrief | null | undefined; opportunity: ScopeOverviewPanelProps['opportunity'] }) {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const phases = useMemo(() => buildLifecycle(brief, opportunity), [brief, opportunity.id])

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">From bid submission through contract closeout.</p>
        <div className="flex items-center bg-stone-100 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'list' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            List
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'calendar' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Timeline
          </button>
        </div>
      </div>

      {view === 'list'
        ? <LifecycleList phases={phases} />
        : <LifecycleCalendar phases={phases} responseDeadline={opportunity.responseDeadline} />
      }
    </div>
  )
}

// ── Field Guide (full searchable glossary) ────────────────────────────────────

function FieldGuide({ query }: { query: string }) {
  const [openTerm, setOpenTerm] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return complianceGlossary.categories
    return complianceGlossary.categories.map(cat => ({
      ...cat,
      terms: cat.terms.filter(t =>
        t.term.toLowerCase().includes(q) ||
        t.shortDef.toLowerCase().includes(q) ||
        t.farRef.toLowerCase().includes(q)
      ),
    })).filter(cat => cat.terms.length > 0)
  }, [query])

  const totalResults = filtered.reduce((n, c) => n + c.terms.length, 0)

  return (
    <div className="space-y-4">
      {query && <p className="text-xs text-stone-400">{totalResults} result{totalResults !== 1 ? 's' : ''}</p>}

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <p className="text-xs text-amber-800">{complianceGlossary.disclaimer}</p>
      </div>

      {filtered.map(cat => (
        <div key={cat.id} className="rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
            <p className="text-xs font-semibold text-stone-700 uppercase tracking-wide">{cat.label}</p>
            <p className="text-xs text-stone-500 mt-0.5">{cat.description}</p>
          </div>
          <div className="divide-y divide-stone-100">
            {cat.terms.map(t => {
              const isOpen = openTerm === `${cat.id}-${t.term}`
              return (
                <div key={t.term}>
                  <button onClick={() => setOpenTerm(isOpen ? null : `${cat.id}-${t.term}`)}
                    className="w-full flex items-start justify-between px-4 py-3 bg-white hover:bg-stone-50 transition-colors text-left gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800">{t.term}</p>
                      <p className="text-xs text-stone-500 mt-0.5">{t.shortDef}</p>
                    </div>
                    <svg className={`h-4 w-4 text-stone-400 flex-shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 bg-stone-50 space-y-3 text-xs">
                      <p className="text-stone-600 leading-relaxed pt-2">{t.fullExplanation}</p>
                      <div>
                        <p className="font-semibold text-stone-700 mb-1.5">What you must do:</p>
                        <ul className="space-y-1">
                          {t.contractorMustDo.map((a, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-stone-600">
                              <span className="text-stone-400 mt-0.5 flex-shrink-0">→</span>
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {t.commonMistakes.length > 0 && (
                        <div className="bg-amber-50 border border-amber-100 rounded p-2.5 space-y-1">
                          <p className="font-semibold text-amber-800 text-[10px] uppercase tracking-wide mb-1">Common mistakes</p>
                          {t.commonMistakes.map((m, i) => (
                            <p key={i} className="text-amber-800 leading-snug">⚠ {m}</p>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 border-t border-stone-200">
                        {t.timing && <span className="text-stone-400"><span className="font-medium text-stone-600">Timing:</span> {t.timing}</span>}
                        {t.farRef && <span className="text-stone-400"><span className="font-medium text-stone-600">Ref:</span> {t.farRef}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function KeyFact({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  if (!value) return null
  return (
    <div className={`${wide ? 'col-span-2' : 'col-span-1'} flex flex-col gap-0.5`}>
      <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-stone-800 leading-snug">{value}</span>
    </div>
  )
}

function HeadsUpBanner({ items }: { items: OpportunityBrief['headsUp'] }) {
  if (!items?.length) return null
  const iconMap: Record<string, string> = {
    bonding: '🔒', clearance: '🛡️', setaside: '⚖️', timeline: '⏰', onsite: '📍', other: '⚠️',
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-base flex-shrink-0 leading-none mt-0.5">{iconMap[item.type] ?? '⚠️'}</span>
          <p className="text-xs text-amber-900 leading-relaxed">{item.message}</p>
        </div>
      ))}
    </div>
  )
}

function OverviewTab({
  opportunity,
  brief,
  assessment,
}: {
  opportunity: ScopeOverviewPanelProps['opportunity']
  brief?: OpportunityBrief | null
  assessment?: { estimatedValue?: number; estimatedCost?: number; profitMarginPercent?: number } | null
}) {
  const structured: StructuredContent | undefined = (opportunity.parsedAttachments as any)?.structured

  const deadline = opportunity.responseDeadline ? new Date(opportunity.responseDeadline) : null
  const daysLeft = deadline ? differenceInDays(deadline, new Date()) : null

  // Estimated value — prefer brief > assessment > opportunity field
  const estValue = brief?.estimatedValue
    || (assessment?.estimatedValue ? `$${assessment.estimatedValue.toLocaleString()} (assessment)` : null)
    || (opportunity.estimatedContractValue ? `$${opportunity.estimatedContractValue.toLocaleString()}` : null)

  const periodStr = brief?.periodOfPerformance
    ? `${brief.periodOfPerformance.basePeriod}${brief.periodOfPerformance.optionYears ? ` + ${brief.periodOfPerformance.optionYears} option year${brief.periodOfPerformance.optionYears !== 1 ? 's' : ''}` : ''}`
    : null

  const location = brief?.placeOfPerformance?.location || opportunity.state || null

  const deadlineLabel = deadline
    ? `${format(deadline, 'MMM d, yyyy')}${daysLeft !== null ? ` (${daysLeft <= 0 ? 'expired' : `${daysLeft}d left`})` : ''}`
    : null

  const hasBrief = !!(brief?.whatTheyAreBuying || brief?.extendedOverview)
  const hasScope = !!(structured?.scope?.length || structured?.deliverables?.length)

  return (
    <div className="space-y-5">
      {/* Heads-up alerts */}
      {brief?.headsUp && brief.headsUp.length > 0 && (
        <HeadsUpBanner items={brief.headsUp} />
      )}

      {/* Key facts grid */}
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-3">Solicitation Facts</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <KeyFact label="Agency" value={opportunity.agency} wide />
          <KeyFact label="Solicitation #" value={opportunity.solicitationNumber} />
          <KeyFact label="NAICS" value={opportunity.naicsCode ? `${opportunity.naicsCode}` : null} />
          <KeyFact label="Response Deadline" value={deadlineLabel} />
          <KeyFact label="Contract Type" value={opportunity.contractType} />
          <KeyFact label="Set-Aside" value={opportunity.setAside} />
          <KeyFact label="Location" value={location} />
          <KeyFact label="Period of Performance" value={periodStr} />
          <KeyFact label="Estimated Value" value={estValue} />
          {brief?.contractType && <KeyFact label="Contract Vehicle" value={brief.contractType} />}
        </div>
      </div>

      {/* Narrative overview */}
      {hasBrief ? (
        <div className="bg-white border border-stone-200 rounded-xl p-5">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-4">What They&apos;re Buying</p>
          <div>
            {brief?.extendedOverview ? (
              brief.extendedOverview
                .split(/\n\n+|\n(?=[A-Z])/)
                .flatMap(chunk => chunk.split(/\n/).filter(Boolean))
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i} className="text-sm text-stone-700 leading-7 mb-4 last:mb-0">{para}</p>
                ))
            ) : (
              <p className="text-sm text-stone-700 leading-7">{brief?.whatTheyAreBuying}</p>
            )}
          </div>
          {brief?.endUser && (
            <p className="text-xs text-stone-500 italic border-t border-stone-100 pt-3 mt-4">End user: {brief.endUser}</p>
          )}
        </div>
      ) : (
        <div className="bg-white border border-stone-100 rounded-xl p-5">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-4">Description</p>
          {opportunity.description ? (
            <p className="text-sm text-stone-700 leading-7 whitespace-pre-wrap">{opportunity.description.slice(0, 2000)}</p>
          ) : (
            <p className="text-xs text-stone-400 italic">Generate the Opportunity Brief (Summary tab) for a plain-language overview.</p>
          )}
        </div>
      )}

      {/* Qualifications — only show if brief has data */}
      {brief?.whoQualifies && (brief.whoQualifies.clearances?.length || brief.whoQualifies.certifications?.length || brief.whoQualifies.licenses?.length || brief.whoQualifies.setAside) && (
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-3">Who Can Compete</p>
          <div className="space-y-2">
            {brief.whoQualifies.setAside && (
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider w-20 flex-shrink-0 pt-0.5">Set-Aside</span>
                <span className="text-sm text-stone-700">{brief.whoQualifies.setAside}</span>
              </div>
            )}
            {brief.whoQualifies.clearances && brief.whoQualifies.clearances.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider w-20 flex-shrink-0 pt-0.5">Clearance</span>
                <span className="text-sm text-stone-700">{brief.whoQualifies.clearances.join(', ')}</span>
              </div>
            )}
            {brief.whoQualifies.licenses && brief.whoQualifies.licenses.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider w-20 flex-shrink-0 pt-0.5">Licenses</span>
                <span className="text-sm text-stone-700">{brief.whoQualifies.licenses.join(', ')}</span>
              </div>
            )}
            {brief.whoQualifies.certifications && brief.whoQualifies.certifications.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider w-20 flex-shrink-0 pt-0.5">Certs</span>
                <span className="text-sm text-stone-700">{brief.whoQualifies.certifications.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Key deliverables */}
      {brief?.keyDeliverables && brief.keyDeliverables.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-3">Key Deliverables</p>
          <div className="space-y-2">
            {brief.keyDeliverables.map((d, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-500 text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-stone-800">{d.item}</span>
                  {d.frequency && <span className="text-xs text-stone-400 ml-2">— {d.frequency}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scope bullets from parsed attachments */}
      {hasScope && (
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-3">
            Scope — from Solicitation Documents
          </p>
          <div className="space-y-1.5">
            {(structured?.scope ?? []).slice(0, 10).map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-stone-300 mt-1 flex-shrink-0">•</span>
                <p className="text-sm text-stone-700 leading-snug">{item.length > 200 ? item.slice(0, 200) + '…' : item}</p>
              </div>
            ))}
            {(structured?.deliverables ?? []).length > 0 && !(structured?.scope?.length) && (
              (structured?.deliverables ?? []).slice(0, 8).map((item, i) => (
                <div key={`del-${i}`} className="flex items-start gap-2">
                  <span className="text-stone-300 mt-1 flex-shrink-0">•</span>
                  <p className="text-sm text-stone-700 leading-snug">{item.length > 200 ? item.slice(0, 200) + '…' : item}</p>
                </div>
              ))
            )}
          </div>
          <p className="text-[10px] text-stone-400 mt-3 pt-2 border-t border-stone-100">
            Extracted from solicitation attachments — see Deliverables and Compliance tabs for full detail.
          </p>
        </div>
      )}

      {!hasBrief && !hasScope && (
        <div className="bg-white border border-stone-100 rounded-xl px-6 py-10 text-center">
          <p className="text-sm text-stone-400">Generate the Opportunity Brief and parse attachments to populate this overview.</p>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

type FilterKey = 'compliance' | 'deliverables' | 'qualifications' | 'evaluation' | 'postAward' | 'lifecycle' | 'fieldGuide'

export default function ScopeOverviewPanel({ opportunity, assessment, brief, aiScope }: ScopeOverviewPanelProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('compliance')
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set())
  const [glossaryQuery, setGlossaryQuery] = useState('')

  const structured: StructuredContent | undefined = (opportunity.parsedAttachments as any)?.structured

  // AI scope wins when present; otherwise fall back to rule-based extraction.
  const deliverables = useMemo(() => {
    if (aiScope?.documentation && aiScope.documentation.length > 0) {
      return aiScope.documentation.map((d, i): ScopeItem => ({
        id: `del-${i}`,
        text: d.frequency ? `${d.text} (${d.frequency})` : d.text,
        tags: d.tags || [],
        critical: !!d.critical,
      }))
    }
    return extractDeliverables(structured)
  }, [aiScope?.documentation, opportunity.id, structured])

  const compliance = useMemo(() => {
    const base: ScopeItem[] = aiScope?.compliance && aiScope.compliance.length > 0
      ? aiScope.compliance.map((c, i): ScopeItem => ({
          id: `comp-${i}`,
          text: c.text,
          tags: c.tags || [],
          critical: !!c.critical,
        }))
      : extractCompliance(structured, opportunity.description || '')

    // Required plans (APP, QCP, WMP, Safety, Environmental, Site-Specific)
    // must show the place of performance the plan applies to. We inherit the
    // location from the solicitation brief + opportunity record so subs and
    // internal reviewers don't have to cross-reference to know where the plan
    // is enforced. Non-plan compliance items pass through untouched.
    const location = brief?.placeOfPerformance?.location
      || opportunity.state
      || null
    if (!location) return base
    const planRe = /\b(APP|QCP|WMP|SSHP|EMP|SWPPP|accident prevention plan|quality control plan|waste management plan|safety plan|site[- ]specific safety|environmental (?:protection|management) plan|storm ?water|health and safety plan)\b/i
    return base.map(item => {
      if (!planRe.test(item.text)) return item
      // Skip if the item already names the location
      if (item.text.toLowerCase().includes(location.toLowerCase())) return item
      return { ...item, text: `${item.text} · Location: ${location}` }
    })
  }, [aiScope?.compliance, opportunity.id, structured, opportunity.description, brief?.placeOfPerformance?.location, opportunity])

  const qualifications: ScopeItem[] = useMemo(() => {
    const raw = structured?.qualifications || []
    if (raw.length === 0) return []
    return raw.slice(0, 8).map((text, i) => ({
      id: `qual-${i}`,
      text: text.length > 200 ? text.substring(0, 200) + '…' : text,
      tags: extractTags(text),
      critical: isCritical(text),
    }))
  }, [opportunity.id])

  const evaluation: ScopeItem[] = useMemo(() => {
    const raw = structured?.evaluation || []
    if (raw.length === 0) return []
    return raw.slice(0, 8).map((text, i) => ({
      id: `eval-${i}`,
      text: text.length > 200 ? text.substring(0, 200) + '…' : text,
      tags: extractTags(text),
      critical: isCritical(text),
    }))
  }, [opportunity.id])

  const criticalCount = [...deliverables, ...compliance].filter(i => i.critical).length

  const handleCheck = (id: string, checked: boolean) => {
    setCheckedItems(prev => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  const hasParsedData = !!(structured?.compliance?.length || structured?.deliverables?.length)

  const ALL_FILTERS: { key: FilterKey; label: string; count?: number }[] = [
    { key: 'compliance',     label: '⚖️ Compliance',    count: compliance.length },
    { key: 'deliverables',   label: '📄 Deliverables',  count: deliverables.length },
    { key: 'qualifications', label: '🎓 Qualifications', count: qualifications.length },
    { key: 'evaluation',     label: '📊 Evaluation',    count: evaluation.length },
    { key: 'lifecycle',      label: '📅 Lifecycle' },
    { key: 'postAward',      label: '🏁 Post-Award' },
    { key: 'fieldGuide',     label: '📚 Reference' },
  ]
  const FILTERS = ALL_FILTERS.filter(f =>
    f.key === 'compliance' || f.key === 'postAward' || f.key === 'fieldGuide' || f.key === 'lifecycle' || (f.count ?? 0) > 0
  )

  return (
    <div className="h-full overflow-y-auto bg-stone-50">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">

        {/* Header card */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-stone-500 tracking-widest uppercase">Compliance & Post-Award</span>
              {criticalCount > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  ⚠️ {criticalCount} critical
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!hasParsedData && (
                <span className="text-[10px] text-stone-400 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                  Generate SOW to parse compliance data
                </span>
              )}
              {activeFilter !== 'fieldGuide' && (
                <button
                  onClick={() => setActiveFilter('fieldGuide')}
                  className="text-[10px] text-stone-400 hover:text-stone-600 flex items-center gap-1 transition-colors"
                  title="Open the Federal Contracting Reference Guide"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Reference
                </button>
              )}
            </div>
          </div>
          <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              onClick={() => navigator.clipboard.writeText(opportunity.solicitationNumber).catch(() => {})}
              className="flex items-center gap-1.5 text-sm font-semibold text-stone-800 hover:text-stone-600 group"
            >
              {opportunity.solicitationNumber}
              <svg className="h-3 w-3 text-stone-300 group-hover:text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            {opportunity.naicsCode && (
              <span className="text-sm text-stone-500">NAICS <span className="font-medium text-stone-700">{opportunity.naicsCode}</span></span>
            )}
            {opportunity.agency && (
              <span className="text-sm text-stone-500 truncate max-w-xs">{opportunity.agency}</span>
            )}
          </div>
        </div>

        {/* Glossary search — always visible */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={glossaryQuery}
            onChange={e => { setGlossaryQuery(e.target.value); if (e.target.value) setActiveFilter('fieldGuide') }}
            placeholder='Search reference — "FAT", "CDRL", "cure notice", "FAR 52.246"…'
            className="w-full pl-9 pr-9 py-2.5 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:border-stone-400"
          />
          {glossaryQuery && (
            <button
              onClick={() => setGlossaryQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Tab filters */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                activeFilter === f.key
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400 hover:text-stone-800'
              }`}
            >
              {f.label}
              {f.count !== undefined && f.count > 0 && (
                <span className={`text-[10px] px-1 rounded-full ${activeFilter === f.key ? 'bg-white/20' : 'bg-stone-100 text-stone-500'}`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Compliance — required plans from the solicitation surface first,
            followed by the extracted compliance line items. */}
        {activeFilter === 'compliance' && (
          <div className="space-y-4">
            <RequiredPlansTiles compliance={compliance} />
            {compliance.length > 0 ? (
              <SectionBlock
                icon="⚖️"
                title="Compliance Requirements"
                count={compliance.length}
                items={compliance}
                accentClass="border-stone-200"
                showCheckboxes
                checkedItems={checkedItems}
                onCheck={handleCheck}
              />
            ) : (
              <EmptyState message="No compliance requirements extracted. Generate the SOW to parse solicitation attachments." />
            )}
          </div>
        )}

        {/* Deliverables */}
        {activeFilter === 'deliverables' && (
          deliverables.length > 0
            ? <DeliverableTable items={deliverables} />
            : <EmptyState message="No deliverables extracted from parsed content." />
        )}

        {/* Qualifications */}
        {activeFilter === 'qualifications' && (
          qualifications.length > 0 ? (
            <SectionBlock
              icon="🎓"
              title="Qualifications & Requirements"
              count={qualifications.length}
              items={qualifications}
              accentClass="border-stone-200"
            />
          ) : (
            <EmptyState message="No qualification requirements extracted." />
          )
        )}

        {/* Evaluation */}
        {activeFilter === 'evaluation' && (
          evaluation.length > 0 ? (
            <SectionBlock
              icon="📊"
              title="Evaluation Criteria"
              count={evaluation.length}
              items={evaluation}
              accentClass="border-stone-200"
            />
          ) : (
            <EmptyState message="No evaluation criteria extracted." />
          )
        )}

        {/* Lifecycle */}
        {activeFilter === 'lifecycle' && (
          <LifecycleTab brief={brief} opportunity={opportunity} />
        )}

        {/* Post-Award */}
        {activeFilter === 'postAward' && (
          <>
            <PostAwardTracker />
            <TeamNotes />
          </>
        )}

        {/* Field Guide / Reference */}
        {activeFilter === 'fieldGuide' && <FieldGuide query={glossaryQuery} />}

      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-6 py-10 text-center">
      <p className="text-sm text-stone-400">{message}</p>
    </div>
  )
}

// ─── Required Plans ─────────────────────────────────────────────────────────
// Canonical prime-plan catalog. A plan tile only surfaces when at least one
// compliance item mentions it — that's what makes it "required by the
// solicitation." No invite action: plan assignment is delegated to the
// subcontractor intake form.
interface PlanDef {
  key: string
  label: string
  shortName: string
  detect: RegExp
  purpose: string
}

const REQUIRED_PLANS: PlanDef[] = [
  {
    key: 'app',
    label: 'Accident Prevention Plan (APP)',
    shortName: 'APP',
    detect: /\b(APP|accident prevention plan)\b/i,
    purpose: 'Site-specific safety plan — supervisor, JHAs, emergency response, medical facility, PPE.',
  },
  {
    key: 'qcp',
    label: 'Quality Control Plan (QCP)',
    shortName: 'QCP',
    detect: /\b(QCP|quality control plan)\b/i,
    purpose: 'QC officer, testing frequency, inspection procedures, non-conformance handling.',
  },
  {
    key: 'wmp',
    label: 'Waste Management Plan (WMP)',
    shortName: 'WMP',
    detect: /\b(WMP|waste management plan)\b/i,
    purpose: 'Waste streams, hauler, disposal / recycling facilities, ticket documentation.',
  },
  {
    key: 'sshp',
    label: 'Site-Specific Safety & Health Plan (SSHP)',
    shortName: 'SSHP',
    detect: /\b(SSHP|site[- ]specific safety(?: and health)? plan|health and safety plan)\b/i,
    purpose: 'EM 385-1-1 compliant safety plan tailored to this site\'s hazards.',
  },
  {
    key: 'swppp',
    label: 'Storm Water Pollution Prevention Plan (SWPPP)',
    shortName: 'SWPPP',
    detect: /\b(SWPPP|storm ?water(?: pollution)?(?: prevention)? plan)\b/i,
    purpose: 'BMPs, discharge points, inspection schedule, corrective actions for storm water.',
  },
  {
    key: 'emp',
    label: 'Environmental Protection / Management Plan',
    shortName: 'EMP',
    detect: /\b(EMP|environmental (?:protection|management) plan)\b/i,
    purpose: 'Environmental compliance, spill response, hazardous material handling.',
  },
  {
    key: 'tcp',
    label: 'Traffic Control Plan (TCP / MOT)',
    shortName: 'TCP',
    detect: /\b(TCP|MOT|traffic control plan|maintenance of traffic)\b/i,
    purpose: 'Lane closures, flaggers, signage, MUTCD-compliant traffic routing.',
  },
]

function RequiredPlansTiles({ compliance }: { compliance: ScopeItem[] }) {
  const detected = REQUIRED_PLANS.filter((p) =>
    compliance.some((c) => p.detect.test(c.text)),
  )
  if (detected.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
          Required Plans
        </p>
        <span className="text-[10px] text-stone-400">
          Pulled from solicitation compliance items
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {detected.map((plan) => (
          <div
            key={plan.key}
            className="border border-stone-200 rounded-lg p-3 bg-stone-50/50"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-sm font-semibold text-stone-900">{plan.shortName}</p>
              <span className="text-[10px] font-medium text-stone-500 bg-white border border-stone-200 px-1.5 py-0.5 rounded">
                Required
              </span>
            </div>
            <p className="text-xs font-medium text-stone-700 mb-1">{plan.label}</p>
            <p className="text-xs text-stone-500 leading-snug">{plan.purpose}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-stone-400 italic">
        Plan authors are assigned inside the subcontractor intake form —
        each sub delegates the relevant section to the right person on
        their team.
      </p>
    </div>
  )
}
