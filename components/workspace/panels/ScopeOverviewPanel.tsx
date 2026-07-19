'use client'

import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { format, differenceInDays, addMonths, startOfMonth } from 'date-fns'
import { complianceGlossary } from '@/lib/data/compliance-glossary'
import type { GlossaryTerm } from '@/lib/data/compliance-glossary'
import type { OpportunityBrief, ScopeOverviewArtifact } from '@/lib/openai'
import {
  generateAccidentPreventionPlan,
  collectPlanFields,
  type AppSubResponses,
  type GeneratedPlan,
  type PlanField,
  type PlanItem,
  type PlanSection,
} from '@/lib/plans/app-plan'

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
    /** Resource plan lines drive the Construction Schedule + SOV viewers. */
    resourcePlan?: {
      lines?: Array<{
        id: string
        label: string
        category?: string
        valueDescription?: string
        quantity?: string | null
        basis?: string | null
        estimatedTotalCost?: number | null
      }>
    } | null
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

// Site-facility & general-requirement scan. Federal SOWs express these as
// "the contractor shall provide / furnish / dispose of / clean up …" —
// not as literal "dumpster" mentions. We match a broader vocabulary per
// tag so real requirements surface even when the exact facility word is
// absent (e.g. "removal and disposal of all trash, debris, and
// construction waste" is a dumpster-like requirement).
const SITE_FACILITY_PATTERNS: { tag: string; re: RegExp }[] = [
  { tag: 'TRAILER',
    re: /\b(?:job|field|office|construction|site|temporary|temp\.?)\s*(?:trailer|office)\b|\bfield office\b|\bconstruction (?:trailer|office)\b|\bon[- ]?site office\b/i },
  { tag: 'WASTE',
    re: /\b(?:dumpster|roll[- ]?off|waste (?:container|receptacle|bin|disposal|management|removal)|refuse (?:container|receptacle|bin)|debris (?:box|removal|disposal)|construction (?:waste|debris)|trash (?:and|&) debris|removal (?:and|&) (?:proper )?disposal|dispos(?:e|al) of (?:all )?(?:trash|debris|waste))\b/i },
  { tag: 'PORTA-JOHN',
    re: /\b(?:porta[- ]?(?:john|potty|let)s?|portable (?:toilet|restroom|sanitation)|chemical toilet|port[- ]?a[- ]?jane|sanitation (?:facilit|service)|restroom facilit)/i },
  { tag: 'STORAGE',
    re: /\b(?:conex|storage (?:container|box|trailer|area)|shipping container|material staging|equipment staging)\b/i },
  { tag: 'FENCING',
    re: /\btemporary (?:fenc(?:e|ing))\b|\b(?:site|construction|perimeter|safety) fenc(?:e|ing)\b|\bstaging area\b|\bwork zone barricad/i },
  { tag: 'UTILITIES',
    re: /\btemporary (?:power|water|electric(?:al|ity)?|utilities|sanitation|lighting)\b|\butility hookup\b|\bportable generator\b|\bgenerator (?:for|on[- ]site)\b|\bwater supply\b/i },
  { tag: 'SIGNAGE',
    re: /\b(?:project|construction) sign(?:age|s)?\b|\btemporary sign(?:age|s)?\b|\bwarning sign(?:age|s)?\b/i },
  { tag: 'DUST CONTROL',
    re: /\bdust control\b|\bwater truck\b|\bdust suppression\b/i },
  { tag: 'SPILL / HAZMAT',
    re: /\bspill (?:kit|response|prevention|contain)|\bhazardous material(?:s)? spill|\bcontain,? clean up,? and (?:properly )?dispose\b|\boil (?:or hazardous )?spill/i },
  { tag: 'CLEANUP',
    re: /\b(?:site|final|daily) clean[- ]?up\b|\bproject clean[- ]?up\b|\bsweep (?:road|pavement|site) (?:free|clean)\b/i },
]

function extractSiteFacilityRequirements(
  structured: StructuredContent | undefined,
  description: string,
): ScopeItem[] {
  const blocks = [
    description ?? '',
    ...(structured?.scope ?? []),
    ...(structured?.deliverables ?? []),
    ...(structured?.compliance ?? []),
    ...(structured?.qualifications ?? []),
  ]
  const seen = new Set<string>()
  const items: ScopeItem[] = []
  let idx = 0
  for (const block of blocks) {
    if (!block) continue
    // Federal-SOW parsed text has stray single newlines mid-sentence. Join
    // those first so sentence patterns don't get chopped in half, THEN split
    // on true sentence terminators / bullet chars / paragraph breaks.
    const normalized = block
      .replace(/\r/g, '')
      .replace(/([^\n])\n(?!\n)/g, '$1 ')
    const sentences = normalized
      .split(/(?<=[.!?])\s+|\n{2,}|(?:^|\s)(?=[•·▪◦])/g)
      .map(s => s.replace(/^[•·▪◦\s\-a-z]{0,4}\.?\s*/i, '').trim())
      .filter(s => s.length > 15 && s.length < 400)
    for (const sentence of sentences) {
      for (const { tag, re } of SITE_FACILITY_PATTERNS) {
        if (!re.test(sentence)) continue
        const dedupeKey = `${tag}::${sentence.toLowerCase().slice(0, 80)}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        items.push({
          id: `site-${idx++}`,
          text: sentence,
          tags: [tag, 'SITE FACILITY'],
          critical: false,
        })
        break // one tag per sentence
      }
    }
  }
  return items.slice(0, 15)
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

  // Which plan the user is previewing (auto-filled preview modal). The
  // sentinel '__all__' opens the merged package view used by the print-all
  // download flow.
  const [viewingPlan, setViewingPlan] = useState<string | null>(null)
  // Selected sub responses for populating the plan. Fetched from the
  // /requirements API — the "chosen" sub is whichever sub has a submitted
  // sub_quote AND a payment_package requirement (i.e., admin has selected
  // them for bid). Falls back to any sub with a submitted sub_quote so a
  // preview is possible before final selection.
  const [selectedSubForPlan, setSelectedSubForPlan] = useState<{
    id: string
    name: string
    responses: Record<string, unknown> | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/opportunities/${opportunity.id}/requirements`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data || !Array.isArray(data.requirements)) return
        type Req = {
          subcontractorId?: string | null
          templateKey?: string | null
          status?: string | null
          responses?: Record<string, unknown> | null
          subcontractor?: { id: string; name: string } | null
        }
        const reqs = data.requirements as Req[]
        const paymentPackageSubs = new Set(
          reqs.filter(r => r.templateKey === 'payment_package' && r.subcontractorId)
              .map(r => r.subcontractorId as string),
        )
        const isDone = (s?: string | null) => s === 'SUBMITTED' || s === 'APPROVED'
        // Prefer a sub who has been Selected for bid AND has a submitted quote.
        const selected = reqs.find(r =>
          r.templateKey === 'sub_quote' &&
          isDone(r.status) &&
          r.subcontractorId &&
          paymentPackageSubs.has(r.subcontractorId),
        )
        // Fallback: any sub with a submitted quote — useful before selection.
        const fallback = selected ? null : reqs.find(r =>
          r.templateKey === 'sub_quote' && isDone(r.status),
        )
        const chosen = selected ?? fallback
        if (chosen && chosen.subcontractor) {
          setSelectedSubForPlan({
            id: chosen.subcontractor.id,
            name: chosen.subcontractor.name,
            responses: chosen.responses ?? null,
          })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [opportunity.id])

  const structured: StructuredContent | undefined = (opportunity.parsedAttachments as any)?.structured

  // Full attachment corpus for content-based plan detection. Combines every
  // structured section + the raw `fullText` of each parsed attachment (SOW,
  // O&M Plan, drawings notes, etc.) + the opportunity's own description.
  // This is what lets a plan surface because the SOW says "dust control" or
  // "95% proctor" even when the plan name itself isn't spelled out.
  const fullAttachmentText = useMemo(() => {
    const rawAttachments = ((opportunity.parsedAttachments as unknown as {
      attachments?: Array<{ fullText?: string | null }>
    })?.attachments ?? []).map(a => a?.fullText ?? '')
    return [
      opportunity.description ?? '',
      ...(structured?.scope ?? []),
      ...(structured?.deliverables ?? []),
      ...(structured?.compliance ?? []),
      ...(structured?.qualifications ?? []),
      ...(structured?.evaluation ?? []),
      ...(structured?.periodOfPerformance ?? []),
      ...rawAttachments,
    ].join('\n\n')
  }, [opportunity.description, opportunity.parsedAttachments, structured])

  // Auto-filled APP object — reused by both the modal and the completion
  // percentage math so the "Ready" chip on the tile stays consistent with
  // what the user sees when they click through.
  const generatedApp = useMemo(() => generateAccidentPreventionPlan({
    opportunity: {
      title: opportunity.title,
      solicitationNumber: opportunity.solicitationNumber,
      agency: opportunity.agency ?? null,
      state: opportunity.state ?? null,
      placeOfPerformance: brief?.placeOfPerformance?.location ?? opportunity.state ?? null,
    },
    primeCompanyName: null,
    selectedSub: selectedSubForPlan
      ? {
          id: selectedSubForPlan.id,
          name: selectedSubForPlan.name,
          responses: (selectedSubForPlan.responses ?? {}) as AppSubResponses,
        }
      : null,
  }), [opportunity.title, opportunity.solicitationNumber, opportunity.agency, opportunity.state, brief?.placeOfPerformance?.location, selectedSubForPlan])

  // Per-plan completion — powers the tile progress bars and the overall
  // "Bid Package Completion" gate. Each plan measures a different thing:
  //   APP → percent of fields already populated (not "needs input")
  //   CS  → percent of resource lines with a real duration source
  //   SOV → percent of resource lines with a real cost
  //   others (QCP, WMP, TCP, SSHP, SWPPP, EMP) → placeholder 0% until we
  //   build their generators. Marked so the user sees why it's incomplete.
  const planCompletion = useMemo((): Record<string, PlanCompletion> => {
    const out: Record<string, PlanCompletion> = {}

    // APP — walk every field (top-level, items, subitems, and checklist).
    const appFields = collectPlanFields(generatedApp)
    const appFilled = appFields.filter((f) => !f.needsInput).length
    out.app = {
      percent: appFields.length === 0 ? 0 : Math.round((appFilled / appFields.length) * 100),
      filled: appFilled,
      total: appFields.length,
      note: 'Fields filled from sub + opportunity + template',
    }

    // Construction Schedule + SOV read the resource plan.
    const lines = opportunity.resourcePlan?.lines ?? []
    if (lines.length === 0) {
      out.cs = { percent: 0, filled: 0, total: 0, note: 'Generate a resource plan to seed tasks' }
      out.sov = { percent: 0, filled: 0, total: 0, note: 'Generate a resource plan to seed line items' }
    } else {
      const withDuration = lines.filter(l =>
        (l.basis && /day|week|month|hr|hour/i.test(l.basis)) ||
        (l.quantity && /\d/.test(l.quantity)),
      ).length
      out.cs = {
        percent: Math.round((withDuration / lines.length) * 100),
        filled: withDuration,
        total: lines.length,
        note: 'Tasks with an estimated duration',
      }
      const withCost = lines.filter(l => l.estimatedTotalCost != null && l.estimatedTotalCost > 0).length
      out.sov = {
        percent: Math.round((withCost / lines.length) * 100),
        filled: withCost,
        total: lines.length,
        note: 'Line items with a real cost',
      }
    }

    // Placeholder plans — no generator yet.
    for (const key of ['qcp', 'wmp', 'sshp', 'swppp', 'emp', 'tcp']) {
      out[key] = { percent: 0, filled: 0, total: 0, note: 'Generator pending' }
    }
    return out
  }, [generatedApp, opportunity.resourcePlan])

  // "Download all plans" fires the browser print dialog after switching the
  // modal into print-all mode. Users then Save-as-PDF for submission.
  const handleDownloadPackage = () => {
    setViewingPlan('__all__')
    // Give React a beat to mount the merged viewer before opening print.
    setTimeout(() => window.print(), 200)
  }

  // Every FAR / DFARS / etc. clause referenced across the opportunity docs.
  const farClauses = useMemo(() => extractFarClauses(fullAttachmentText), [fullAttachmentText])

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

    // Merge site-facility requirements (trailers, dumpsters, porta-johns,
    // storage containers, temporary fencing / utilities / signage) that the
    // solicitation calls out. These live in the general-requirements portion
    // of the SOW and don't come back from the FAR/MIL-clause scan, so we
    // append them here.
    const siteFacilities = extractSiteFacilityRequirements(structured, opportunity.description || '')
    const combined = [...base, ...siteFacilities]

    // Required plans (APP, QCP, WMP, Safety, Environmental, Site-Specific)
    // must show the place of performance the plan applies to. We inherit the
    // location from the solicitation brief + opportunity record so subs and
    // internal reviewers don't have to cross-reference to know where the plan
    // is enforced. Non-plan compliance items pass through untouched.
    const location = brief?.placeOfPerformance?.location
      || opportunity.state
      || null
    if (!location) return combined
    const planRe = /\b(APP|QCP|WMP|SSHP|EMP|SWPPP|accident prevention plan|quality control plan|waste management plan|safety plan|site[- ]specific safety|environmental (?:protection|management) plan|storm ?water|health and safety plan)\b/i
    return combined.map(item => {
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
            followed by the extracted compliance line items, and finally the
            full list of applicable FAR / DFARS clauses in a scrollable list
            at the bottom. */}
        {activeFilter === 'compliance' && (
          <div className="space-y-4">
            <RequiredPlansTiles
              compliance={compliance}
              attachmentText={fullAttachmentText}
              naicsCode={opportunity.naicsCode}
              completionByPlan={planCompletion}
              onOpenPlan={(key) => setViewingPlan(key)}
              onDownloadPackage={handleDownloadPackage}
            />
            {/* Compliance Requirements — replaced with the applicable FAR
                clauses (title + reference-library explanation per clause).
                Sits at the bottom of the scrollable Compliance section. */}
            <ComplianceRequirementsFarList clauses={farClauses} />
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

      {/* Auto-filled plan preview modal — one of: APP, Construction Schedule,
          Schedule of Values, or the print-all package view. */}
      {viewingPlan === 'app' && (
        <PlanViewerModal plan={generatedApp} onClose={() => setViewingPlan(null)} />
      )}
      {viewingPlan === 'cs' && (
        <ConstructionScheduleModal
          opportunity={opportunity}
          brief={brief}
          onClose={() => setViewingPlan(null)}
        />
      )}
      {viewingPlan === 'sov' && (
        <ScheduleOfValuesModal
          opportunity={opportunity}
          brief={brief}
          onClose={() => setViewingPlan(null)}
        />
      )}
      {viewingPlan === '__all__' && (
        <PlanPackageModal
          plan={generatedApp}
          opportunity={opportunity}
          brief={brief}
          onClose={() => setViewingPlan(null)}
        />
      )}
      {/* Template-outline modal for plans without a full generator (QCP,
          WMP, SSHP, SWPPP, EMP, TCP). Shows sections + expected fields
          so the user can see exactly what the plan will contain. */}
      {viewingPlan &&
        !['app', 'cs', 'sov', '__all__'].includes(viewingPlan) &&
        (() => {
          const planDef = REQUIRED_PLANS.find((p) => p.key === viewingPlan)
          if (!planDef?.templateOutline?.length) return null
          return (
            <PlanTemplateOutlineModal
              plan={planDef}
              onClose={() => setViewingPlan(null)}
            />
          )
        })()}
    </div>
  )
}

// WorkspaceLayout wraps every panel in a translateX() container, which
// becomes the containing block for `fixed` descendants — that pushes any
// modal opened from a non-first panel off-screen. Portal the modal to
// document.body so `fixed inset-0` resolves against the viewport.
function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(children, document.body)
}

// ─── Plan Template Outline Modal ──────────────────────────────────────────
// Shown when the user clicks a plan tile that doesn't have a full generator
// yet (QCP, WMP, SSHP, SWPPP, EMP, TCP). Renders the plan's declared
// section outline — title, purpose, expected fields — so the user can see
// exactly what the plan will contain when it's generated.
function PlanTemplateOutlineModal({
  plan,
  onClose,
}: {
  plan: PlanDef
  onClose: () => void
}) {
  const outline = plan.templateOutline ?? []
  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl max-w-3xl w-full my-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-stone-200 rounded-t-xl px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-0.5">
              {plan.shortName} · Template outline
            </p>
            <h2 className="text-lg font-semibold text-stone-900">{plan.label}</h2>
            <p className="text-xs text-stone-500 mt-0.5">{plan.purpose}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 p-1"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-3 border-b border-stone-100 bg-stone-50/50">
          <p className="text-[11px] text-stone-600 leading-snug">
            Structural preview of the plan. Sections and fields below are
            what the generator will populate once the SOW is finalized and
            a subcontractor is selected for bid.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {outline.length === 0 ? (
            <p className="text-sm text-stone-500 italic">No outline defined for this plan yet.</p>
          ) : (
            outline.map((section, idx) => (
              <section key={idx} className="border-l-2 border-stone-200 pl-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-semibold text-stone-400 tabular-nums">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-sm font-semibold text-stone-900">{section.title}</h3>
                </div>
                <p className="text-xs text-stone-600 mt-1 leading-relaxed">{section.purpose}</p>
                {section.expectedFields.length > 0 && (
                  <div className="mt-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-stone-400 mb-1.5">
                      Expected fields
                    </p>
                    <ul className="space-y-1">
                      {section.expectedFields.map((f, i) => (
                        <li key={i} className="text-xs text-stone-700 flex items-start gap-1.5 leading-snug">
                          <span className="text-stone-300 mt-0.5 flex-shrink-0">▸</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            ))
          )}
        </div>

        <div className="px-6 py-3 border-t border-stone-100 text-[10px] text-stone-500 rounded-b-xl flex items-center justify-between">
          <span>{outline.length} section{outline.length === 1 ? '' : 's'} · plan authors assigned via sub intake</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-medium text-stone-700 hover:text-stone-900 underline"
          >
            Close
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

// ─── Plan Viewer Modal ─────────────────────────────────────────────────────
// Renders a GeneratedPlan (sections + fields) with clear provenance chips
// so the user can see which values came from the opportunity, the selected
// sub's intake responses, template boilerplate, or still need admin input.
function PlanViewerModal({
  plan,
  onClose,
}: {
  plan: GeneratedPlan
  onClose: () => void
}) {
  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl max-w-3xl w-full my-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-stone-200 rounded-t-xl px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-0.5">
              {plan.planCode} · Auto-filled preview
            </p>
            <h2 className="text-lg font-semibold text-stone-900">{plan.displayName}</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {plan.sourceSubcontractorName
                ? `Sub-provided fields sourced from ${plan.sourceSubcontractorName}`
                : 'No selected sub yet — sub-provided fields will fill once a sub is selected for bid.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="text-xs px-3 py-1.5 border border-stone-200 rounded hover:bg-stone-50"
              title="Print / Save as PDF"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-stone-400 hover:text-stone-700 p-1"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="px-6 py-3 border-b border-stone-100 flex flex-wrap gap-3 text-[10px]">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded bg-stone-800" />Opportunity</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded bg-emerald-500" />Selected sub</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded bg-stone-300" />Template</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded bg-amber-400" />Needs admin input</span>
        </div>

        {/* Sections — rendered to mirror the USACE APP template structure:
            lettered sections (b., c., d., …), numbered items (1., 2., …),
            and lettered subitems (A., B., … or a., b., …). Signature Sheet
            and Weekly Safety Meeting appendices render as printable tables. */}
        <div className="px-6 py-5 space-y-7">
          {plan.sections.map((section) => (
            <PlanSectionRender key={section.key} section={section} />
          ))}
        </div>

        <div className="px-6 py-3 border-t border-stone-100 text-[10px] text-stone-400 text-center rounded-b-xl">
          Generated {new Date(plan.generatedAt).toLocaleString('en-US')}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

// ─── Compliance Requirements (FAR clauses, glossary-explained) ─────────────
// Every FAR / DFARS / AFARS / VAAR / EPAAR / GSAM clause found in the
// attachment corpus is listed here as THE Compliance Requirements list.
// Each row shows the clause reference, its canonical short title, and —
// when a Reference Library term maps to that clause via its farRef — a
// "Read what this means" expander with the plain-language explanation +
// contractor must-do list from the glossary.

// Build a reverse index: FAR code → matching glossary terms. Terms declare
// their coverage via `farRef` strings like "FAR 52.209-3 (…)" — we scrape
// every code out of that string so a single term can cover multiple
// clauses (e.g. "FAR 52.246-2 / 52.246-4").
const GLOSSARY_TERMS_BY_FAR_CODE: Map<string, GlossaryTerm[]> = (() => {
  const m = new Map<string, GlossaryTerm[]>()
  for (const cat of complianceGlossary.categories) {
    for (const term of cat.terms) {
      const codes = term.farRef.match(/\d{1,2}\.\d{1,4}(?:-\d{1,4})?/g) ?? []
      for (const code of codes) {
        const arr = m.get(code) ?? []
        arr.push(term)
        m.set(code, arr)
      }
    }
  }
  return m
})()

function ComplianceRequirementsFarList({ clauses }: { clauses: FarClause[] }) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const filtered = useMemo(() => {
    if (!query.trim()) return clauses
    const q = query.toLowerCase()
    return clauses.filter(c =>
      c.ref.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q),
    )
  }, [clauses, query])

  return (
    <div className="bg-white rounded-xl border border-stone-200">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-100">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider flex items-center gap-1.5">
            <span>⚖️</span> Compliance Requirements
          </p>
          <span className="text-[10px] font-medium text-stone-500 bg-stone-100 border border-stone-200 px-1.5 py-0.5 rounded">
            {clauses.length}
          </span>
        </div>
        {clauses.length > 0 && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter — code or title"
            className="text-xs px-2 py-1 border border-stone-200 rounded focus:outline-none focus:border-stone-400 w-48"
          />
        )}
      </div>
      {clauses.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-stone-400 italic">
          No FAR / DFARS clauses parsed from the attachments yet. Generate
          the SOW to parse solicitation attachments.
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto divide-y divide-stone-100">
          {filtered.map((c) => {
            const key = `${c.system}-${c.code}`
            const terms = GLOSSARY_TERMS_BY_FAR_CODE.get(c.code) ?? []
            const hasGlossary = terms.length > 0
            const isOpen = expanded === key
            const acquisitionUrl = c.system === 'FAR'
              ? `https://www.acquisition.gov/far/${c.code}`
              : c.system === 'DFARS'
                ? `https://www.acquisition.gov/dfars/${c.code}`
                : null
            return (
              <div key={key}>
                {/* Whole row is a button so clicking anywhere expands. */}
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : key)}
                  className="w-full text-left px-4 py-2.5 hover:bg-stone-50 transition-colors flex items-start gap-3"
                  aria-expanded={isOpen}
                >
                  <span className="shrink-0 mt-0.5 text-[10px] font-mono font-semibold text-stone-500 bg-stone-50 border border-stone-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                    {c.ref}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug ${c.known ? 'text-stone-800' : 'text-stone-500 italic'}`}>
                      {c.title || '(no context captured)'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-stone-500 flex items-center gap-1.5">
                      {hasGlossary
                        ? `Reference Library · ${terms.length} term${terms.length > 1 ? 's' : ''}`
                        : 'Full clause text on acquisition.gov'}
                    </p>
                  </div>
                  <svg
                    className={`h-3.5 w-3.5 text-stone-400 shrink-0 mt-1 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Expanded content — glossary explanation if we have one,
                    otherwise a link out to the official FAR text. */}
                {isOpen && (
                  <div className="px-4 pb-4 ml-16 space-y-3">
                    {hasGlossary ? (
                      terms.map((t, i) => (
                        <div key={i} className="bg-stone-50 border border-stone-200 rounded p-3 space-y-2 text-xs">
                          <p className="font-semibold text-stone-800">{t.term}</p>
                          <p className="text-stone-700 leading-relaxed">{t.fullExplanation}</p>
                          {t.contractorMustDo.length > 0 && (
                            <div>
                              <p className="font-semibold text-stone-700 mb-1">What you must do:</p>
                              <ul className="space-y-1">
                                {t.contractorMustDo.map((action, j) => (
                                  <li key={j} className="flex items-start gap-1.5 text-stone-600">
                                    <span className="text-stone-400 mt-0.5 flex-shrink-0">→</span>
                                    <span>{action}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {t.commonMistakes.length > 0 && (
                            <div className="bg-amber-50 border border-amber-100 rounded p-2 space-y-1">
                              <p className="font-semibold text-amber-800 text-[10px] uppercase tracking-wide">Common mistakes</p>
                              {t.commonMistakes.map((mistake, k) => (
                                <p key={k} className="text-amber-800 leading-snug">⚠ {mistake}</p>
                              ))}
                            </div>
                          )}
                          {t.timing && (
                            <p className="text-[11px] text-stone-500 italic">Timing: {t.timing}</p>
                          )}
                          {acquisitionUrl && (
                            <a
                              href={acquisitionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-700 hover:text-stone-900 underline"
                            >
                              Read full clause on acquisition.gov →
                            </a>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="bg-stone-50 border border-stone-200 rounded p-3 space-y-2 text-xs">
                        <p className="text-stone-700 leading-relaxed">
                          No Reference Library term is mapped to this clause yet.
                          {c.known
                            ? ' The title above is the canonical FAR short name.'
                            : ' The title above is a best-effort snippet pulled from the surrounding attachment text.'}
                        </p>
                        {acquisitionUrl ? (
                          <a
                            href={acquisitionUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-700 hover:text-stone-900 underline"
                          >
                            Read full clause on acquisition.gov →
                          </a>
                        ) : (
                          <p className="text-[11px] text-stone-500 italic">
                            Look up this {c.system} clause on your agency&apos;s regulatory site.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-stone-400 italic">
              No clauses match &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Construction Schedule (Gantt) ─────────────────────────────────────────
// Reads the resource plan's lines as tasks. Each task infers a duration
// from `quantity` + `basis` where possible (e.g. quantity "7", basis
// "days"), otherwise a default 5-day slot. Bars are laid out on a
// weekly grid spanning from the opportunity's postedDate (or today) to
// its responseDeadline (or +12 weeks).
function ConstructionScheduleModal({
  opportunity,
  brief,
  onClose,
}: {
  opportunity: ScopeOverviewPanelProps['opportunity']
  brief: OpportunityBrief | null | undefined
  onClose: () => void
}) {
  const lines = opportunity.resourcePlan?.lines ?? []
  const start = opportunity.postedDate ? new Date(opportunity.postedDate) : new Date()
  const end = opportunity.responseDeadline
    ? new Date(opportunity.responseDeadline)
    : new Date(start.getTime() + 12 * 7 * 24 * 60 * 60 * 1000)
  const totalDays = Math.max(7, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
  const weekMarks = Math.max(1, Math.ceil(totalDays / 7))

  // Derive a duration in days for each task. This is intentionally simple —
  // once sub_quote.duration_days is stitched in via the resource plan, the
  // bars will lengthen accordingly.
  function taskDurationDays(l: NonNullable<typeof lines>[number]): number {
    const qty = Number((l.quantity ?? '').match(/\d+/)?.[0] ?? '')
    if (qty > 0 && /day/i.test(l.basis ?? '')) return qty
    if (qty > 0 && /week/i.test(l.basis ?? '')) return qty * 7
    if (qty > 0 && /month/i.test(l.basis ?? '')) return qty * 30
    return 5
  }

  // Compute serial start offsets so tasks stack in visible order.
  let cursorDay = 0
  const tasks = lines.map(l => {
    const duration = Math.min(taskDurationDays(l), totalDays)
    const offset = cursorDay
    cursorDay = Math.min(cursorDay + duration, totalDays)
    return { line: l, offset, duration }
  })

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full my-4" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-stone-200 rounded-t-xl px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-0.5">Schedule · Gantt</p>
            <h2 className="text-lg font-semibold text-stone-900">Construction Schedule</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {opportunity.title} · {opportunity.solicitationNumber}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => window.print()} className="text-xs px-3 py-1.5 border border-stone-200 rounded hover:bg-stone-50">Print</button>
            <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-700 p-1" aria-label="Close">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between text-[11px] text-stone-500 mb-2">
            <span>{format(start, 'MMM d, yyyy')}</span>
            <span>Duration: {totalDays} days · {weekMarks} weeks</span>
            <span>{format(end, 'MMM d, yyyy')}</span>
          </div>

          {tasks.length === 0 ? (
            <div className="text-sm text-stone-500 italic p-8 text-center border border-dashed border-stone-200 rounded">
              No resource plan yet — generate one on the Summary tab to populate the schedule.
            </div>
          ) : (
            <div className="space-y-2">
              {/* Week header */}
              <div className="grid" style={{ gridTemplateColumns: `160px repeat(${weekMarks}, 1fr)` }}>
                <div />
                {Array.from({ length: weekMarks }).map((_, i) => (
                  <div key={i} className="text-[10px] text-stone-400 text-center border-l border-stone-100">
                    W{i + 1}
                  </div>
                ))}
              </div>

              {/* Task rows */}
              {tasks.map(({ line, offset, duration }) => {
                const leftPct = (offset / totalDays) * 100
                const widthPct = (duration / totalDays) * 100
                return (
                  <div
                    key={line.id}
                    className="grid items-center py-1.5 border-t border-stone-100"
                    style={{ gridTemplateColumns: `160px 1fr` }}
                  >
                    <div className="pr-3 text-xs text-stone-700 truncate" title={line.label}>
                      {line.label}
                    </div>
                    <div className="relative h-5 bg-stone-50 rounded border border-stone-100 overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 bg-stone-800 rounded-sm flex items-center px-1.5"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        title={`Day ${offset + 1} — Day ${offset + duration}`}
                      >
                        <span className="text-[10px] text-white truncate">{duration}d</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {brief?.periodOfPerformance && (
            <p className="mt-4 text-[11px] text-stone-500">
              Period of performance: {brief.periodOfPerformance.basePeriod}
              {brief.periodOfPerformance.optionYears
                ? ` + ${brief.periodOfPerformance.optionYears} option year${brief.periodOfPerformance.optionYears !== 1 ? 's' : ''}`
                : ''}
            </p>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

// ─── Schedule of Values (SF-1443 style table) ──────────────────────────────
function ScheduleOfValuesModal({
  opportunity,
  brief,
  onClose,
}: {
  opportunity: ScopeOverviewPanelProps['opportunity']
  brief: OpportunityBrief | null | undefined
  onClose: () => void
}) {
  const lines = opportunity.resourcePlan?.lines ?? []
  const total = lines.reduce((acc, l) => acc + (l.estimatedTotalCost ?? 0), 0)

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full my-4" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-stone-200 rounded-t-xl px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-0.5">SF-1443 · Auto-filled preview</p>
            <h2 className="text-lg font-semibold text-stone-900">Schedule of Values</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {opportunity.title} · {opportunity.solicitationNumber}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => window.print()} className="text-xs px-3 py-1.5 border border-stone-200 rounded hover:bg-stone-50">Print</button>
            <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-700 p-1" aria-label="Close">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6">
          {lines.length === 0 ? (
            <div className="text-sm text-stone-500 italic p-8 text-center border border-dashed border-stone-200 rounded">
              No resource plan yet — generate one on the Summary tab to populate the SOV.
            </div>
          ) : (
            <>
              <table className="w-full text-sm border border-stone-200 rounded overflow-hidden">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="text-left text-[10px] font-semibold text-stone-500 uppercase tracking-wider px-3 py-2">Item</th>
                    <th className="text-left text-[10px] font-semibold text-stone-500 uppercase tracking-wider px-3 py-2">Description</th>
                    <th className="text-right text-[10px] font-semibold text-stone-500 uppercase tracking-wider px-3 py-2">Qty</th>
                    <th className="text-right text-[10px] font-semibold text-stone-500 uppercase tracking-wider px-3 py-2">Amount</th>
                    <th className="text-right text-[10px] font-semibold text-stone-500 uppercase tracking-wider px-3 py-2">%</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const pct = total > 0 && l.estimatedTotalCost
                      ? Math.round((l.estimatedTotalCost / total) * 100)
                      : 0
                    return (
                      <tr key={l.id} className="border-t border-stone-100">
                        <td className="px-3 py-2 text-stone-700 tabular-nums">{String(i + 1).padStart(4, '0')}</td>
                        <td className="px-3 py-2 text-stone-800">
                          <div className="font-medium">{l.label}</div>
                          {l.valueDescription && (
                            <div className="text-xs text-stone-500 mt-0.5">{l.valueDescription}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-stone-700 tabular-nums">
                          {l.quantity ? `${l.quantity}${l.basis ? ` ${l.basis}` : ''}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-stone-900 tabular-nums font-medium">
                          {l.estimatedTotalCost != null
                            ? `$${l.estimatedTotalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                            : 'Needs quote'}
                        </td>
                        <td className="px-3 py-2 text-right text-stone-500 tabular-nums text-xs">{pct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-stone-50 border-t-2 border-stone-200">
                    <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold text-stone-800">Grand total</td>
                    <td className="px-3 py-2 text-right text-sm font-semibold text-stone-900 tabular-nums">
                      ${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-stone-500 tabular-nums">100%</td>
                  </tr>
                </tfoot>
              </table>
              {brief?.estimatedValue && (
                <p className="mt-3 text-[11px] text-stone-500 text-right">
                  Solicitation estimated value: {brief.estimatedValue}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

// ─── Package view — all viewers stacked, optimized for print/save-as-PDF ──
function PlanPackageModal({
  plan,
  opportunity,
  brief,
  onClose,
}: {
  plan: GeneratedPlan
  opportunity: ScopeOverviewPanelProps['opportunity']
  brief: OpportunityBrief | null | undefined
  onClose: () => void
}) {
  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full mx-auto my-4" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-stone-200 rounded-t-xl px-6 py-4 flex items-start justify-between gap-4 print:hidden">
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-0.5">Bid Package · All Plans</p>
            <h2 className="text-lg font-semibold text-stone-900">Print / Save as PDF for submission</h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => window.print()} className="text-xs px-3 py-1.5 bg-stone-800 text-white rounded hover:bg-stone-700">Open print dialog</button>
            <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-700 p-1" aria-label="Close">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-8">
          {/* APP */}
          <section>
            <h3 className="text-base font-semibold text-stone-900 mb-3">1. Accident Prevention Plan (APP)</h3>
            <div className="space-y-5">
              {plan.sections.map(section => (
                <PlanSectionRender key={section.key} section={section} />
              ))}
            </div>
          </section>

          {/* CS */}
          <section className="break-before-page">
            <h3 className="text-base font-semibold text-stone-900 mb-3">2. Construction Schedule</h3>
            <p className="text-xs text-stone-500 mb-3">Full Gantt view available in the Construction Schedule preview.</p>
            {(opportunity.resourcePlan?.lines ?? []).length === 0 ? (
              <p className="text-xs text-amber-700 italic">Resource plan not generated yet.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {opportunity.resourcePlan?.lines?.map(l => (
                  <li key={l.id}>· {l.label}{l.quantity ? ` — ${l.quantity}${l.basis ? ` ${l.basis}` : ''}` : ''}</li>
                ))}
              </ul>
            )}
          </section>

          {/* SOV */}
          <section className="break-before-page">
            <h3 className="text-base font-semibold text-stone-900 mb-3">3. Schedule of Values</h3>
            {(opportunity.resourcePlan?.lines ?? []).length === 0 ? (
              <p className="text-xs text-amber-700 italic">Resource plan not generated yet.</p>
            ) : (
              <table className="w-full text-xs border border-stone-200">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="text-left px-2 py-1">Item</th>
                    <th className="text-left px-2 py-1">Description</th>
                    <th className="text-right px-2 py-1">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunity.resourcePlan?.lines?.map((l, i) => (
                    <tr key={l.id} className="border-t border-stone-100">
                      <td className="px-2 py-1 tabular-nums">{String(i + 1).padStart(4, '0')}</td>
                      <td className="px-2 py-1">{l.label}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {l.estimatedTotalCost != null ? `$${l.estimatedTotalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {brief?.estimatedValue && (
              <p className="mt-2 text-[11px] text-stone-500">Solicitation estimated value: {brief.estimatedValue}</p>
            )}
          </section>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

function sourceDotClass(field: PlanField): string {
  if (field.needsInput) return 'bg-amber-400'
  switch (field.source) {
    case 'opportunity': return 'bg-stone-800'
    case 'sub': return 'bg-emerald-500'
    case 'template': return 'bg-stone-300'
    default: return 'bg-amber-400'
  }
}

// Inline value chip — shown to the right (or below on mobile) of an item
// so the "1. Foo:" reads like "1. Foo: <value>" with a source dot.
function PlanValueChip({ field }: { field: PlanField }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 align-baseline">
      <span className={`inline-block w-1.5 h-1.5 rounded ${sourceDotClass(field)} shrink-0 translate-y-[-1px]`} aria-hidden="true" />
      <span className={`${field.needsInput ? 'text-amber-700 italic' : 'text-stone-800'}`}>
        {field.value}
      </span>
    </span>
  )
}

// Standalone field row (used on the Cover and where items don't apply).
function PlanFieldRow({ field }: { field: PlanField }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 border-b border-stone-50 last:border-b-0">
      <span className={`mt-1.5 inline-block w-2 h-2 rounded ${sourceDotClass(field)} shrink-0`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">{field.label}</p>
        <p className={`text-sm leading-snug ${field.needsInput ? 'text-amber-700 italic' : 'text-stone-800'}`}>
          {field.value}
        </p>
      </div>
    </div>
  )
}

// A single numbered / lettered item — indented per depth so 4.A sits under 4.
function PlanItemRender({ item, depth = 0 }: { item: PlanItem; depth?: number }) {
  const prefix = item.number ? `${item.number}.` : ''
  return (
    <li className={depth === 0 ? '' : 'mt-1'}>
      <div className="flex items-baseline gap-2">
        {prefix && (
          <span className="text-xs font-semibold text-stone-500 tabular-nums shrink-0 min-w-[1.5rem]">
            {prefix}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm leading-snug ${depth === 0 ? 'text-stone-800' : 'text-stone-700'}`}>
            {item.text}
            {item.field && (
              <>
                {' '}
                <PlanValueChip field={item.field} />
              </>
            )}
          </p>
          {item.subitems && item.subitems.length > 0 && (
            <ol className="mt-1.5 pl-2 space-y-1.5 border-l border-stone-100">
              {item.subitems.map((s, i) => (
                <PlanItemRender key={i} item={s} depth={depth + 1} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </li>
  )
}

// Blank signature grid — printable, 20 rows by default.
function PlanSignatureGrid({ columns, rows }: { columns: string[]; rows: number }) {
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-stone-50">
          <tr>
            <th className="w-8 px-2 py-1.5 text-left font-medium text-stone-500 border-r border-stone-200">#</th>
            {columns.map((c) => (
              <th key={c} className="px-3 py-1.5 text-left font-medium text-stone-500 border-r border-stone-200 last:border-r-0">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i} className="border-t border-stone-100">
              <td className="w-8 px-2 py-2 text-stone-400 tabular-nums border-r border-stone-100">{i + 1}</td>
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 border-r border-stone-100 last:border-r-0">&nbsp;</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Weekly Safety Meeting–style topic checklist.
function PlanChecklistRender({
  fields,
  categories,
}: {
  fields?: PlanField[]
  categories: Array<{ heading?: string; items: string[] }>
}) {
  return (
    <div className="space-y-4">
      {fields && fields.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
          {fields.map((f, i) => <PlanFieldRow key={i} field={f} />)}
        </div>
      )}
      {categories.map((cat, ci) => (
        <div key={ci}>
          {cat.heading && (
            <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
              {cat.heading}
            </p>
          )}
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {cat.items.map((topic, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-stone-700 leading-snug">
                <span className="inline-block w-3 h-3 border border-stone-300 rounded-sm shrink-0 mt-0.5" aria-hidden="true" />
                <span>{topic}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// Section render — handles fields, items, signature table, and checklist.
function PlanSectionRender({ section }: { section: PlanSection }) {
  const heading = section.letter ? `${section.letter}. ${section.title}` : section.title
  return (
    <section className={section.appendix ? 'border-t border-stone-200 pt-5' : ''}>
      <h3 className={`font-semibold text-stone-900 mb-2 ${section.appendix ? 'text-xs uppercase tracking-widest text-stone-500' : 'text-sm'}`}>
        {heading}
      </h3>
      {section.intro && (
        <p className="text-xs text-stone-600 mb-3 leading-relaxed">{section.intro}</p>
      )}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="mb-3 space-y-1 text-xs text-stone-700 list-disc list-inside">
          {section.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
      {section.fields && section.fields.length > 0 && (
        <div className="space-y-1 mb-3">
          {section.fields.map((f, i) => <PlanFieldRow key={i} field={f} />)}
        </div>
      )}
      {section.items && section.items.length > 0 && (
        <ol className="space-y-2.5">
          {section.items.map((it, i) => <PlanItemRender key={i} item={it} />)}
        </ol>
      )}
      {section.signatureTable && (
        <PlanSignatureGrid columns={section.signatureTable.columns} rows={section.signatureTable.rows} />
      )}
      {section.checklist && (
        <PlanChecklistRender fields={section.checklist.fields} categories={section.checklist.categories} />
      )}
    </section>
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
// A plan tile surfaces when any of these trigger:
//   (a) a compliance item explicitly names the plan (APP, QCP, etc.)
//   (b) the opportunity's NAICS falls under construction (23xxxx) and the
//       plan is a construction default under USACE / EM 385-1-1
//   (c) content-triggers: the actual attachment text calls out work that
//       implies this plan is required (e.g. "dust control" → APP,
//       "traffic control" → TCP, "95% proctor" → QCP). Each trigger
//       carries a human-readable rationale we surface on the tile.
// No invite action: plan assignment is delegated to the subcontractor intake
// form. Clicking a plan opens the auto-filled preview.
interface ContentTrigger {
  pattern: RegExp
  rationale: string
}
interface PlanOutlineSection {
  title: string
  purpose: string
  expectedFields: string[]
}
interface PlanDef {
  key: string
  label: string
  shortName: string
  detect: RegExp
  purpose: string
  /** True when this plan is a construction default (surfaces on NAICS 23xxxx). */
  constructionDefault?: boolean
  /** Attachment-text phrases that imply this plan is required. */
  contentTriggers?: ContentTrigger[]
  /** Template outline shown when the plan is clicked. Sections + expected
   *  fields. Displayed as a preview even before a generator has run. */
  templateOutline?: PlanOutlineSection[]
}

const REQUIRED_PLANS: PlanDef[] = [
  {
    key: 'app',
    label: 'Accident Prevention Plan (APP)',
    shortName: 'APP',
    detect: /\b(APP|accident prevention plan)\b/i,
    purpose: 'Site-specific safety plan — supervisor, JHAs, emergency response, medical facility, PPE.',
    constructionDefault: true,
    contentTriggers: [
      { pattern: /\bdust control\b/i, rationale: 'SOW requires dust control during installation' },
      { pattern: /\bhazardous material(?:s)? spill|\boil (?:or hazardous )?spill|\bcontain,? clean up,? and (?:properly )?dispose/i, rationale: 'SOW requires hazmat / oil spill response' },
      { pattern: /\bEM[- ]?385\b|\bOSHA (?:10|30)\b/i, rationale: 'EM 385-1-1 / OSHA compliance called out' },
      { pattern: /\bpersonal protective equipment\b|\bPPE\b/i, rationale: 'PPE requirements referenced' },
    ],
    templateOutline: [
      { title: 'Site & Project Information', purpose: 'Basic identification — who, what, where.', expectedFields: ['Project name / solicitation #', 'Site address & directions', 'Prime + subcontractor names', 'Contract start / duration'] },
      { title: 'Safety Personnel', purpose: 'Named accountable individuals with credentials.', expectedFields: ['Site Safety & Health Officer (SSHO)', 'Competent persons by hazard class', 'Emergency contacts + phone tree'] },
      { title: 'Job Hazard Analyses (JHA)', purpose: 'Task-by-task hazard identification and controls.', expectedFields: ['Task description', 'Hazards identified', 'Controls / PPE', 'Training required'] },
      { title: 'Emergency Response', purpose: 'What to do when things go wrong.', expectedFields: ['Nearest hospital / clinic address', 'Route map from site', 'Evacuation assembly point', 'Spill response kit location'] },
      { title: 'PPE Program', purpose: 'Required equipment per task class.', expectedFields: ['Baseline PPE (hard hat, safety glasses, boots)', 'Task-specific PPE (respirators, harnesses)', 'Inspection & replacement schedule'] },
      { title: 'Training & Records', purpose: 'OSHA / EM 385 compliance record-keeping.', expectedFields: ['OSHA 10 / 30 certifications', 'Site-specific orientation log', 'Daily safety huddle attendance', 'Incident / near-miss log'] },
    ],
  },
  {
    key: 'qcp',
    label: 'Quality Control Plan (QCP)',
    shortName: 'QCP',
    detect: /\b(QCP|quality control plan)\b/i,
    purpose: 'QC officer, testing frequency, inspection procedures, non-conformance handling.',
    constructionDefault: true,
    contentTriggers: [
      { pattern: /\b95%\s*(?:standard\s*)?proctor\b|\bstandard proctor\b|\bcompaction test\b/i, rationale: 'Compaction density testing (proctor) required' },
      { pattern: /\bquality (?:assurance|control)\b/i, rationale: 'Quality assurance / control mentioned' },
      { pattern: /\btesting (?:lab|report|frequency|schedule)\b|\binspection (?:and testing|frequency|report)\b/i, rationale: 'Testing / inspection cadence required' },
      { pattern: /\bmaterial specifications?\b/i, rationale: 'Material specifications submittal required' },
    ],
    templateOutline: [
      { title: 'QC Organization', purpose: 'Names, credentials, and chain of authority for quality control.', expectedFields: ['Quality Control Manager (QCM) name + resume', 'Independent-of-production reporting line', 'QC staff by discipline (soils, concrete, welding)', 'Testing lab qualifications (AASHTO / A2LA)'] },
      { title: 'Submittal Register', purpose: 'Every submittal called out in the specs — status tracker.', expectedFields: ['Submittal number + spec section', 'Type (product data / shop drawing / sample)', 'Government review window (typ. 14 days)', 'Resubmittal disposition'] },
      { title: 'Testing Plan', purpose: 'What gets tested, how often, by whom.', expectedFields: ['Test type per material (proctor, slump, gradation)', 'Frequency (per lot / per lift / per placement)', 'Acceptance criteria', 'Testing lab + certifications'] },
      { title: '3-Phase Inspection', purpose: 'USACE 3-phase control — preparatory, initial, follow-up.', expectedFields: ['Preparatory meeting agenda + attendees', 'Initial phase checklist', 'Follow-up inspection frequency', 'Records retention'] },
      { title: 'Non-Conformance Handling', purpose: 'What happens when work fails.', expectedFields: ['NCR log + numbering', 'Root cause analysis workflow', 'Disposition (rework / repair / accept-with-deviation)', 'Closure verification'] },
      { title: 'Reports & Records', purpose: 'Daily and periodic reporting to the government.', expectedFields: ['Daily QC report format', 'Deficiency log', 'As-built markups', 'Final QC certification'] },
    ],
  },
  {
    key: 'wmp',
    label: 'Waste Management Plan (WMP)',
    shortName: 'WMP',
    detect: /\b(WMP|waste management plan)\b/i,
    purpose: 'Waste streams, hauler, disposal / recycling facilities, ticket documentation.',
    constructionDefault: true,
    contentTriggers: [
      { pattern: /\bremoval (?:and|&) (?:proper )?disposal\b|\bdispos(?:e|al) of (?:all )?(?:trash|debris|waste)|construction waste/i, rationale: 'Trash / debris / construction-waste removal + disposal required' },
      { pattern: /\btrash (?:and|&) debris\b|\bdebris (?:box|removal|disposal)\b/i, rationale: 'Debris removal called out' },
    ],
    templateOutline: [
      { title: 'Waste Stream Inventory', purpose: 'Every material type expected to leave the site.', expectedFields: ['Construction & demolition (C&D) debris', 'Hazardous / regulated waste (solvents, fuel)', 'Recyclable streams (metal, cardboard, concrete)', 'General trash'] },
      { title: 'Segregation & Storage', purpose: 'Onsite handling before pickup.', expectedFields: ['Container types + labeling', 'Container locations on site plan', 'Secondary containment for hazmat', 'Housekeeping / spill prevention'] },
      { title: 'Hauler & Facilities', purpose: 'Licensed downstream chain of custody.', expectedFields: ['Hauler name + license #', 'Landfill / transfer station', 'Recycling facility (per stream)', 'Hazmat disposal facility (EPA ID)'] },
      { title: 'Documentation', purpose: 'Paper trail proving compliant disposal.', expectedFields: ['Weight tickets (per load)', 'Uniform Hazardous Waste Manifests', 'Recycling receipts', 'Monthly diversion summary'] },
      { title: 'Diversion Targets', purpose: 'Recycling / reuse goals stated in solicitation.', expectedFields: ['Target diversion % (e.g. 50% C&D)', 'Baseline calculation method', 'Reporting cadence to CO'] },
    ],
  },
  {
    key: 'sshp',
    label: 'Site-Specific Safety & Health Plan (SSHP)',
    shortName: 'SSHP',
    detect: /\b(SSHP|site[- ]specific safety(?: and health)? plan|health and safety plan)\b/i,
    purpose: 'EM 385-1-1 compliant safety plan tailored to this site\'s hazards.',
    templateOutline: [
      { title: 'Site Characterization', purpose: 'Physical and operational context of the work area.', expectedFields: ['Site description + boundary map', 'Adjacent operations / occupied areas', 'Overhead / underground utilities', 'Site security & controlled access'] },
      { title: 'Hazard Analysis', purpose: 'Task-specific hazards identified via JHA.', expectedFields: ['Activity Hazard Analyses (AHAs) per task', 'Risk assessment (probability × severity)', 'Controls hierarchy (elim / eng / admin / PPE)'] },
      { title: 'Roles & Responsibilities', purpose: 'Who does what for safety.', expectedFields: ['Site Safety & Health Officer (SSHO) — 24-hr contact', 'Competent persons (excavation, fall, confined space)', 'Qualified persons for specialized work', 'First-aid / CPR certified staff'] },
      { title: 'Training & Orientation', purpose: 'Required certifications and onboarding.', expectedFields: ['OSHA 10 / 30 hour rosters', 'EM 385-1-1 training (if USACE)', 'Site-specific orientation checklist', 'Daily huddle / weekly toolbox topics'] },
      { title: 'Emergency Response', purpose: 'What to do when things go wrong.', expectedFields: ['Nearest hospital / clinic (address + route)', 'Notification tree (911 → PM → CO)', 'Evacuation plan + muster point', 'Incident reporting workflow'] },
      { title: 'Records & Recordkeeping', purpose: 'Documentation retained for the government.', expectedFields: ['OSHA 300 log', 'Incident / near-miss reports', 'Inspection records', 'Training attendance logs'] },
    ],
  },
  {
    key: 'swppp',
    label: 'Storm Water Pollution Prevention Plan (SWPPP)',
    shortName: 'SWPPP',
    detect: /\b(SWPPP|storm ?water(?: pollution)?(?: prevention)? plan)\b/i,
    purpose: 'BMPs, discharge points, inspection schedule, corrective actions for storm water.',
    contentTriggers: [
      { pattern: /\bstorm ?water\b|\brunoff\b|\berosion control\b|\bBMP(?:s)?\b|\bsediment control\b/i, rationale: 'Storm water / erosion control referenced' },
    ],
    templateOutline: [
      { title: 'Site Description', purpose: 'Physical setting driving the plan.', expectedFields: ['Total site + disturbed acreage', 'Existing drainage patterns', 'Receiving waters (name + 303(d) status)', 'Soil types + slopes'] },
      { title: 'Potential Pollutants', purpose: 'What could reach storm water from this site.', expectedFields: ['Sediment sources (grading, stockpiles)', 'Non-storm-water (concrete washout, dewatering)', 'Fuel / oil handling areas', 'Solid waste / debris'] },
      { title: 'Best Management Practices (BMPs)', purpose: 'Controls implemented onsite.', expectedFields: ['Erosion controls (mulching, blankets)', 'Sediment controls (silt fence, fiber roll, sediment traps)', 'Stabilized construction entrance', 'Concrete washout containment', 'Good housekeeping / spill kits'] },
      { title: 'Inspection Schedule', purpose: 'Cadence and triggers for BMP inspection.', expectedFields: ['Routine inspections (weekly)', 'Rain-triggered inspections (>0.25")', 'Inspector qualifications', 'Inspection form template'] },
      { title: 'Corrective Actions', purpose: 'Response to BMP failure or discharge.', expectedFields: ['Deficiency close-out timeline (typ. 7 days)', 'Escalation for repeat failures', 'Records + photos'] },
      { title: 'Permit Compliance', purpose: 'Alignment with applicable CGP / state permit.', expectedFields: ['NOI submittal proof', 'Permit coverage number', 'NEC (termination) at project close'] },
    ],
  },
  {
    key: 'emp',
    label: 'Environmental Protection / Management Plan',
    shortName: 'EMP',
    detect: /\b(EMP|environmental (?:protection|management) plan)\b/i,
    purpose: 'Environmental compliance, spill response, hazardous material handling.',
    contentTriggers: [
      { pattern: /\benvironmental (?:consideration|protection|regulation|impact)/i, rationale: 'Environmental protection called out in SOW' },
      { pattern: /\bminimize site disturbance\b|\bsite disturbance\b/i, rationale: 'Minimize site disturbance required' },
    ],
    templateOutline: [
      { title: 'Environmental Baseline', purpose: 'Sensitive resources on and around the site.', expectedFields: ['Sensitive habitat / T&E species', 'Cultural or archaeological resources', 'Wetlands / waters of the U.S.', 'Adjacent land uses'] },
      { title: 'Impact Avoidance', purpose: 'How work will avoid protected resources.', expectedFields: ['Exclusion / buffer zones + flagging', 'Seasonal or time-of-day restrictions', 'Equipment staging boundaries', 'Vegetation protection details'] },
      { title: 'Spill Prevention & Response', purpose: 'Fuel / lubricant / hazmat handling.', expectedFields: ['Spill kit locations + inventory', 'Secondary containment for fuel storage', 'Notification procedure (911, agency, CO)', 'Cleanup + disposal chain'] },
      { title: 'Hazardous Material Handling', purpose: 'Onsite chemicals and their controls.', expectedFields: ['SDS binder location', 'Storage requirements per SDS', 'Employee training records', 'Waste characterization + disposal'] },
      { title: 'Air Quality & Dust', purpose: 'Emissions and particulate controls.', expectedFields: ['Dust control method (water, chemical)', 'Vehicle idling limits', 'Fugitive dust monitoring'] },
      { title: 'Restoration & Monitoring', purpose: 'Post-work site recovery.', expectedFields: ['Revegetation / seed mix', 'Monitoring frequency + duration', 'Success criteria', 'Corrective replanting'] },
    ],
  },
  {
    key: 'tcp',
    label: 'Traffic Control Plan (TCP / MOT)',
    shortName: 'TCP',
    detect: /\b(TCP|MOT|traffic control plan|maintenance of traffic)\b/i,
    purpose: 'Lane closures, flaggers, signage, MUTCD-compliant traffic routing.',
    constructionDefault: true,
    contentTriggers: [
      { pattern: /\btraffic control\b|\balternate route(?:s)?\b|\bmaintain access\b|\bobstruct road(?:s|way)?\b|\blane closure\b|\bflagger\b|\bdetour\b/i, rationale: 'Traffic control / alternate routing required' },
      { pattern: /\brecreating public\b|\bemergency personnel\b/i, rationale: 'Maintain public + emergency access' },
    ],
    templateOutline: [
      { title: 'Existing Conditions', purpose: 'Baseline traffic environment.', expectedFields: ['Road classification + AADT', 'Posted speed + advisory speed', 'Sight distance / horizontal curvature', 'Intersections + access points within work zone'] },
      { title: 'Work Zone Layout', purpose: 'MUTCD-compliant zone diagram per phase.', expectedFields: ['Advance warning area (signs, distances)', 'Transition area (taper length by speed)', 'Activity area + buffer', 'Termination area'] },
      { title: 'Traffic Control Devices', purpose: 'Signs, cones, barriers deployed.', expectedFields: ['Sign inventory (type / quantity / MUTCD code)', 'Channelizing device spacing', 'Portable barriers or attenuators (if used)', 'Nighttime retroreflectivity spec'] },
      { title: 'Personnel', purpose: 'Certified flagging and supervision.', expectedFields: ['Flaggers — ATSSA / state certification', 'Traffic Control Supervisor (TCS)', 'Spotters for backing / crossing operations', 'Shift schedules'] },
      { title: 'Public + Emergency Access', purpose: 'Continued access for the public and responders.', expectedFields: ['Detour route + signage plan', 'Emergency vehicle passage procedure', 'Business / resident access maintenance', 'Public notification (72-hr advance)'] },
      { title: 'Special Conditions', purpose: 'Night / weather / event-specific measures.', expectedFields: ['Nighttime work lighting spec', 'Weather-triggered shutdown thresholds', 'Special events / peak-hour restrictions'] },
    ],
  },
  {
    key: 'cs',
    label: 'Construction Schedule (Gantt)',
    shortName: 'Schedule',
    detect: /\b(construction schedule|project schedule|CPM schedule|critical path|milestone schedule|Gantt|baseline schedule)\b/i,
    purpose: 'Sequenced tasks with start / finish dates, dependencies, and float — driven by scope + sub duration inputs.',
    constructionDefault: true,
    contentTriggers: [
      { pattern: /\b(?:construction|project|baseline|master) schedule\b|\bcritical path\b|\bCPM\b|\bmilestone\b/i, rationale: 'Schedule / milestone tracking required' },
      { pattern: /\bcalendar days\b|\bperformance period\b|\bcompletion date\b/i, rationale: 'Fixed performance window in the solicitation' },
    ],
  },
  {
    key: 'sov',
    label: 'Schedule of Values (SF-1443)',
    shortName: 'SOV',
    detect: /\b(schedule of values|SOV|SF[- ]?1443|cost breakdown|line[- ]item pric)/i,
    purpose: 'Line-item cost breakdown of the bid — labor, materials, equipment, overhead per CLIN.',
    constructionDefault: true,
    contentTriggers: [
      { pattern: /\bschedule of values\b|\bSF[- ]?1443\b/i, rationale: 'SOV / SF-1443 required by solicitation' },
      { pattern: /\bunit price\b|\blump sum\b|\bCLIN\b|\bcost breakdown\b/i, rationale: 'Line-item pricing structure called out' },
    ],
  },
]

function isConstructionNaics(code?: string | null): boolean {
  if (!code) return false
  return /^23/.test(code.trim())
}

export interface PlanCompletion {
  percent: number
  filled: number
  total: number
  /** Optional caption explaining what's missing / where the % came from. */
  note?: string
}

// ─── FAR clause extraction ─────────────────────────────────────────────────
// Common FAR / DFARS / AFARS / VAAR clauses show up in solicitations as
// bare references like "FAR 52.209-10" or "52.222-6 Construction Wage Rate
// Requirements." Pull every unique reference out of the attachment corpus
// and try to match each against a short-title lookup — falls back to the
// surrounding text snippet when the exact title isn't recognised.
const FAR_TITLES: Record<string, string> = {
  // ── Part 52.202 — Definitions
  '52.202-1': 'Definitions',
  // ── Part 52.203 — Improper Business Practices and Personal Conflicts of Interest
  '52.203-2': 'Certificate of Independent Price Determination',
  '52.203-3': 'Gratuities',
  '52.203-5': 'Covenant Against Contingent Fees',
  '52.203-6': 'Restrictions on Subcontractor Sales to the Government',
  '52.203-7': 'Anti-Kickback Procedures',
  '52.203-8': 'Cancellation, Rescission, and Recovery of Funds for Illegal or Improper Activity',
  '52.203-10': 'Price or Fee Adjustment for Illegal or Improper Activity',
  '52.203-11': 'Certification and Disclosure Regarding Payments to Influence Federal Transactions',
  '52.203-12': 'Limitation on Payments to Influence Certain Federal Transactions',
  '52.203-13': 'Contractor Code of Business Ethics and Conduct',
  '52.203-14': 'Display of Hotline Poster(s)',
  '52.203-16': 'Preventing Personal Conflicts of Interest',
  '52.203-17': 'Contractor Employee Whistleblower Rights',
  '52.203-18': 'Prohibition on Contracting with Entities That Require Certain Internal Confidentiality Agreements or Statements—Representation',
  '52.203-19': 'Prohibition on Requiring Certain Internal Confidentiality Agreements or Statements',
  // ── Part 52.204 — Administrative Matters
  '52.204-3': 'Taxpayer Identification',
  '52.204-4': 'Printed or Copied Double-Sided on Postconsumer Fiber Content Paper',
  '52.204-5': 'Women-Owned Business (Other Than Small Business)',
  '52.204-7': 'System for Award Management (SAM)',
  '52.204-8': 'Annual Representations and Certifications',
  '52.204-9': 'Personal Identity Verification of Contractor Personnel',
  '52.204-10': 'Reporting Executive Compensation and First-Tier Subcontract Awards',
  '52.204-13': 'System for Award Management Maintenance',
  '52.204-16': 'Commercial and Government Entity Code Reporting',
  '52.204-17': 'Ownership or Control of Offeror',
  '52.204-18': 'Commercial and Government Entity Code Maintenance',
  '52.204-19': 'Incorporation by Reference of Representations and Certifications',
  '52.204-20': 'Predecessor of Offeror',
  '52.204-21': 'Basic Safeguarding of Covered Contractor Information Systems',
  '52.204-23': 'Prohibition on Contracting for Hardware, Software, and Services Developed or Provided by Kaspersky Lab and Other Covered Entities',
  '52.204-24': 'Representation Regarding Certain Telecommunications and Video Surveillance Services or Equipment (Section 889)',
  '52.204-25': 'Prohibition on Contracting for Certain Telecommunications and Video Surveillance Services or Equipment (Section 889 Part B)',
  '52.204-26': 'Covered Telecommunications Equipment or Services—Representation',
  '52.204-27': 'Prohibition on a ByteDance Covered Application',
  // ── Part 52.209 — Contractor Qualifications
  '52.209-2': 'Prohibition on Contracting with Inverted Domestic Corporations—Representation',
  '52.209-5': 'Certification Regarding Responsibility Matters',
  '52.209-6': "Protecting the Government's Interest When Subcontracting with Contractors Debarred, Suspended, or Proposed for Debarment",
  '52.209-7': 'Information Regarding Responsibility Matters',
  '52.209-10': 'Prohibition on Contracting with Inverted Domestic Corporations',
  '52.209-11': 'Representation by Corporations Regarding Delinquent Tax Liability or a Felony Conviction under Any Federal Law',
  '52.209-12': 'Certification Regarding Tax Matters',
  // ── Part 52.211 — Priorities and Delivery
  '52.211-15': 'Defense Priority and Allocation Requirements',
  // ── Part 52.212 — Commercial Products and Services
  '52.212-1': 'Instructions to Offerors—Commercial Products and Commercial Services',
  '52.212-2': 'Evaluation—Commercial Products and Commercial Services',
  '52.212-3': 'Offeror Representations and Certifications—Commercial Products and Commercial Services',
  '52.212-4': 'Contract Terms and Conditions—Commercial Products and Commercial Services',
  '52.212-5': 'Contract Terms and Conditions Required to Implement Statutes or Executive Orders—Commercial Products and Commercial Services',
  '52.213-4': 'Terms and Conditions—Simplified Acquisitions (Other Than Commercial Products and Commercial Services)',
  // ── Part 52.215 — Contracting by Negotiation
  '52.215-1': 'Instructions to Offerors—Competitive Acquisition',
  '52.215-2': 'Audit and Records—Negotiation',
  '52.215-8': 'Order of Precedence—Uniform Contract Format',
  '52.215-14': 'Integrity of Unit Prices',
  '52.215-20': 'Requirements for Certified Cost or Pricing Data and Data Other Than Certified Cost or Pricing Data',
  '52.215-21': 'Requirements for Certified Cost or Pricing Data and Data Other Than Certified Cost or Pricing Data—Modifications',
  '52.215-23': 'Limitations on Pass-Through Charges',
  // ── Part 52.216 — Types of Contracts
  '52.216-1': 'Type of Contract',
  '52.216-18': 'Ordering',
  '52.216-19': 'Order Limitations',
  '52.216-22': 'Indefinite Quantity',
  // ── Part 52.217 — Special Contracting Methods
  '52.217-5': 'Evaluation of Options',
  '52.217-8': 'Option to Extend Services',
  '52.217-9': 'Option to Extend the Term of the Contract',
  // ── Part 52.219 — Small Business Programs
  '52.219-1': 'Small Business Program Representations',
  '52.219-4': 'Notice of Price Evaluation Preference for HUBZone Small Business Concerns',
  '52.219-6': 'Notice of Total Small Business Set-Aside',
  '52.219-8': 'Utilization of Small Business Concerns',
  '52.219-9': 'Small Business Subcontracting Plan',
  '52.219-13': 'Notice of Set-Aside of Orders',
  '52.219-14': 'Limitations on Subcontracting',
  '52.219-16': 'Liquidated Damages—Subcontracting Plan',
  '52.219-27': 'Notice of Set-Aside for, or Sole-Source Award to, Service-Disabled Veteran-Owned Small Business Concerns',
  '52.219-28': 'Post-Award Small Business Program Rerepresentation',
  '52.219-29': 'Notice of Set-Aside for, or Sole-Source Award to, Economically Disadvantaged Women-Owned Small Business Concerns',
  '52.219-30': 'Notice of Set-Aside for, or Sole-Source Award to, Women-Owned Small Business Concerns Eligible Under the Women-Owned Small Business Program',
  // ── Part 52.222 — Labor Laws
  '52.222-3': 'Convict Labor',
  '52.222-4': 'Contract Work Hours and Safety Standards—Overtime Compensation',
  '52.222-6': 'Construction Wage Rate Requirements (Davis-Bacon)',
  '52.222-7': 'Withholding of Funds (Davis-Bacon)',
  '52.222-8': 'Payrolls and Basic Records (Davis-Bacon)',
  '52.222-11': 'Subcontracts (Labor Standards)',
  '52.222-14': 'Disputes Concerning Labor Standards',
  '52.222-15': 'Certification of Eligibility',
  '52.222-17': 'Nondisplacement of Qualified Workers',
  '52.222-19': 'Child Labor—Cooperation with Authorities and Remedies',
  '52.222-21': 'Prohibition of Segregated Facilities',
  '52.222-22': 'Previous Contracts and Compliance Reports',
  '52.222-23': 'Notice of Requirement for Affirmative Action to Ensure Equal Employment Opportunity for Construction',
  '52.222-25': 'Affirmative Action Compliance',
  '52.222-26': 'Equal Opportunity',
  '52.222-27': 'Affirmative Action Compliance Requirements for Construction',
  '52.222-35': 'Equal Opportunity for Veterans',
  '52.222-36': 'Equal Opportunity for Workers with Disabilities',
  '52.222-37': 'Employment Reports on Veterans',
  '52.222-38': "Compliance with Veterans' Employment Reporting Requirements",
  '52.222-40': 'Notification of Employee Rights Under the National Labor Relations Act',
  '52.222-41': 'Service Contract Labor Standards',
  '52.222-42': 'Statement of Equivalent Rates for Federal Hires',
  '52.222-50': 'Combating Trafficking in Persons',
  '52.222-54': 'Employment Eligibility Verification (E-Verify)',
  '52.222-55': 'Minimum Wages for Contractor Workers Under Executive Order 14026',
  '52.222-62': 'Paid Sick Leave Under Executive Order 13706',
  // ── Part 52.223 — Environment, Energy & Safety
  '52.223-3': 'Hazardous Material Identification and Material Safety Data',
  '52.223-5': 'Pollution Prevention and Right-to-Know Information',
  '52.223-6': 'Drug-Free Workplace',
  '52.223-11': 'Ozone-Depleting Substances and High Global Warming Potential Hydrofluorocarbons',
  '52.223-15': 'Energy Efficiency in Energy-Consuming Products',
  '52.223-17': 'Affirmative Procurement of EPA-Designated Items in Service and Construction Contracts',
  '52.223-18': 'Encouraging Contractor Policies to Ban Text Messaging While Driving',
  // ── Part 52.224 — Privacy
  '52.224-1': 'Privacy Act Notification',
  '52.224-2': 'Privacy Act',
  '52.224-3': 'Privacy Training',
  // ── Part 52.225 — Foreign Acquisition
  '52.225-1': 'Buy American—Supplies',
  '52.225-3': 'Buy American—Free Trade Agreements—Israeli Trade Act',
  '52.225-4': 'Buy American—Free Trade Agreements—Israeli Trade Act Certificate',
  '52.225-9': 'Buy American—Construction Materials',
  '52.225-11': 'Buy American—Construction Materials Under Trade Agreements',
  '52.225-12': 'Notice of Buy American Requirement—Construction Materials Under Trade Agreements',
  '52.225-13': 'Restrictions on Certain Foreign Purchases',
  '52.225-25': 'Prohibition on Contracting with Entities Engaging in Certain Activities or Transactions Relating to Iran—Representation and Certifications',
  // ── Part 52.227 — Patents, Data, Copyrights
  '52.227-1': 'Authorization and Consent',
  '52.227-2': 'Notice and Assistance Regarding Patent and Copyright Infringement',
  '52.227-4': 'Patent Indemnity—Construction Contracts',
  '52.227-14': 'Rights in Data—General',
  // ── Part 52.228 — Bonds and Insurance
  '52.228-1': 'Bid Guarantee',
  '52.228-5': 'Insurance—Work on a Government Installation',
  '52.228-11': 'Pledges of Assets',
  '52.228-12': 'Prospective Subcontractor Requests for Bonds',
  '52.228-13': 'Alternative Payment Protections',
  '52.228-14': 'Irrevocable Letter of Credit',
  '52.228-15': 'Performance and Payment Bonds—Construction',
  '52.228-16': 'Performance and Payment Bonds—Other Than Construction',
  // ── Part 52.229 — Taxes
  '52.229-3': 'Federal, State, and Local Taxes',
  // ── Part 52.230 — Cost Accounting Standards
  '52.230-1': 'Cost Accounting Standards Notices and Certification',
  '52.230-2': 'Cost Accounting Standards',
  // ── Part 52.232 — Payment
  '52.232-1': 'Payments',
  '52.232-8': 'Discounts for Prompt Payment',
  '52.232-11': 'Extras',
  '52.232-17': 'Interest',
  '52.232-23': 'Assignment of Claims',
  '52.232-25': 'Prompt Payment',
  '52.232-27': 'Prompt Payment for Construction Contracts',
  '52.232-33': 'Payment by Electronic Funds Transfer—SAM',
  '52.232-39': 'Unenforceability of Unauthorized Obligations',
  '52.232-40': 'Providing Accelerated Payments to Small Business Subcontractors',
  // ── Part 52.233 — Protests, Disputes, and Appeals
  '52.233-1': 'Disputes',
  '52.233-2': 'Service of Protest',
  '52.233-3': 'Protest After Award',
  '52.233-4': 'Applicable Law for Breach of Contract Claim',
  // ── Part 52.236 — Construction and Architect-Engineer Contracts
  '52.236-1': 'Performance of Work by the Contractor',
  '52.236-2': 'Differing Site Conditions',
  '52.236-3': 'Site Investigation and Conditions Affecting the Work',
  '52.236-4': 'Physical Data',
  '52.236-5': 'Material and Workmanship',
  '52.236-6': 'Superintendence by the Contractor',
  '52.236-7': 'Permits and Responsibilities',
  '52.236-8': 'Other Contracts',
  '52.236-9': 'Protection of Existing Vegetation, Structures, Equipment, Utilities, and Improvements',
  '52.236-10': 'Operations and Storage Areas',
  '52.236-11': 'Use and Possession Prior to Completion',
  '52.236-12': 'Cleaning Up',
  '52.236-13': 'Accident Prevention',
  '52.236-14': 'Availability and Use of Utility Services',
  '52.236-15': 'Schedules for Construction Contracts',
  '52.236-16': 'Quantity Surveys',
  '52.236-17': 'Layout of Work',
  '52.236-19': 'Organization and Direction of the Work',
  '52.236-21': 'Specifications and Drawings for Construction',
  '52.236-27': 'Site Visit (Construction)',
  // ── Part 52.237 — Service Contracting
  '52.237-1': 'Site Visit',
  '52.237-2': 'Protection of Government Buildings, Equipment, and Vegetation',
  '52.237-3': 'Continuity of Services',
  // ── Part 52.242 — Contract Administration
  '52.242-13': 'Bankruptcy',
  '52.242-14': 'Suspension of Work',
  '52.242-15': 'Stop-Work Order',
  // ── Part 52.243 — Changes
  '52.243-1': 'Changes—Fixed-Price',
  '52.243-4': 'Changes (Construction)',
  // ── Part 52.244 — Subcontracting
  '52.244-2': 'Subcontracts',
  '52.244-5': 'Competition in Subcontracting',
  '52.244-6': 'Subcontracts for Commercial Products and Commercial Services',
  // ── Part 52.245 — Government Property
  '52.245-1': 'Government Property',
  // ── Part 52.246 — Quality Assurance
  '52.246-2': 'Inspection of Supplies—Fixed-Price',
  '52.246-4': 'Inspection of Services—Fixed-Price',
  '52.246-12': 'Inspection of Construction',
  '52.246-21': 'Warranty of Construction',
  // ── Part 52.247 — Transportation
  '52.247-34': 'F.O.B. Destination',
  // ── Part 52.248 — Value Engineering
  '52.248-1': 'Value Engineering',
  // ── Part 52.249 — Termination
  '52.249-1': 'Termination for Convenience of the Government (Fixed-Price) (Short Form)',
  '52.249-2': 'Termination for Convenience of the Government (Fixed-Price)',
  '52.249-4': 'Termination for Convenience of the Government (Services) (Short Form)',
  '52.249-7': 'Termination (Fixed-Price Architect-Engineer)',
  '52.249-10': 'Default (Fixed-Price Construction)',
  '52.249-14': 'Excusable Delays',
  // ── Part 52.252 — Solicitation Provisions and Contract Clauses
  '52.252-1': 'Solicitation Provisions Incorporated by Reference',
  '52.252-2': 'Clauses Incorporated by Reference',
  '52.252-3': 'Alterations in Solicitation',
  '52.252-4': 'Alterations in Contract',
  '52.252-5': 'Authorized Deviations in Provisions',
  '52.252-6': 'Authorized Deviations in Clauses',
  // ── Part 52.253 — Forms
  '52.253-1': 'Computer Generated Forms',
}

// Common DFARS clauses seen in DoD solicitations.
const DFARS_TITLES: Record<string, string> = {
  '252.203-7000': 'Requirements Relating to Compensation of Former DoD Officials',
  '252.203-7001': 'Prohibition on Persons Convicted of Fraud or Other Defense-Contract-Related Felonies',
  '252.203-7002': 'Requirement to Inform Employees of Whistleblower Rights',
  '252.203-7005': 'Representation Relating to Compensation of Former DoD Officials',
  '252.204-7000': 'Disclosure of Information',
  '252.204-7003': 'Control of Government Personnel Work Product',
  '252.204-7004': 'Antiterrorism Awareness Training for Contractors',
  '252.204-7008': 'Compliance with Safeguarding Covered Defense Information Controls',
  '252.204-7009': 'Limitations on the Use or Disclosure of Third-Party Contractor Reported Cyber Incident Information',
  '252.204-7012': 'Safeguarding Covered Defense Information and Cyber Incident Reporting',
  '252.204-7015': 'Notice of Authorized Disclosure of Information for Litigation Support',
  '252.204-7016': 'Covered Defense Telecommunications Equipment or Services—Representation',
  '252.204-7017': 'Prohibition on the Acquisition of Covered Defense Telecommunications Equipment or Services—Representation',
  '252.204-7018': 'Prohibition on the Acquisition of Covered Defense Telecommunications Equipment or Services',
  '252.204-7020': 'NIST SP 800-171 DoD Assessment Requirements',
  '252.204-7024': 'Notice on the Use of the Supplier Performance Risk System',
  '252.209-7999': 'Representation by Corporations Regarding an Unpaid Delinquent Tax Liability or a Felony Conviction under Any Federal Law',
  '252.219-7003': 'Small Business Subcontracting Plan (DoD Contracts)',
  '252.223-7008': 'Prohibition of Hexavalent Chromium',
  '252.225-7001': 'Buy American and Balance of Payments Program',
  '252.225-7002': 'Qualifying Country Sources as Subcontractors',
  '252.225-7008': 'Restriction on Acquisition of Specialty Metals',
  '252.225-7048': 'Export-Controlled Items',
  '252.226-7001': 'Utilization of Indian Organizations, Indian-Owned Economic Enterprises, and Native Hawaiian Small Business Concerns',
  '252.232-7003': 'Electronic Submission of Payment Requests and Receiving Reports',
  '252.232-7006': 'Wide Area WorkFlow Payment Instructions',
  '252.232-7010': 'Levies on Contract Payments',
  '252.243-7001': 'Pricing of Contract Modifications',
  '252.244-7000': 'Subcontracts for Commercial Products or Commercial Services',
  '252.246-7003': 'Notification of Potential Safety Issues',
  '252.247-7023': 'Transportation of Supplies by Sea',
}

export interface FarClause {
  ref: string      // e.g. "FAR 52.209-10"
  code: string     // e.g. "52.209-10"
  system: string   // "FAR" | "DFARS" | "AFARS" | "VAAR" | "EPAAR" | "GSAM"
  title: string    // known title or best-effort context snippet
  known: boolean   // true when we recognized the code
}

// Federal solicitations often print clause titles in ALL CAPS. Convert those
// to Title Case, but keep short function/style words lower ("of", "and",
// "the") and preserve acronyms and hyphenated compounds.
const TITLE_LOWER_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of',
  'on', 'or', 'the', 'to', 'up', 'with', 'from', 'per', 'via',
])
function toTitleCase(s: string): string {
  const words = s.toLowerCase().split(/(\s+|—|–|-)/)
  return words
    .map((w, i) => {
      if (!w || /^\s+$/.test(w) || w === '—' || w === '–' || w === '-') return w
      // Keep uppercase for known acronyms embedded in titles.
      if (/^(sam|dod|dfars|far|epa|osha|dbe|hubzone|sba|it|us|eft|naics|cui|ffp|nist|sp|ffr|it|ust|cage|itar|rfp|rfq)$/i.test(w)) {
        return w.toUpperCase()
      }
      if (i > 0 && TITLE_LOWER_WORDS.has(w)) return w
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractFarClauses(text: string): FarClause[] {
  if (!text) return []
  // Require the dash (e.g. 52.209-10) so we skip subpart references like
  // "FAR 12" or "FAR 12.203" that show up as chapter callouts, not as
  // enforceable clauses on the contract.
  const re = /(FAR|DFARS?|AFARS?|VAAR|EPAAR|GSAM)\s*(\d{1,2}\.\d{1,4}-\d{1,4})/gi
  const seen = new Map<string, FarClause>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const system = m[1].toUpperCase().replace('DFAR', 'DFARS').replace('AFAR', 'AFARS')
    const code = m[2]
    const key = `${system}:${code}`
    if (seen.has(key)) continue

    let title = ''
    let known = false
    if (system === 'FAR' && FAR_TITLES[code]) {
      title = FAR_TITLES[code]
      known = true
    } else if (system === 'DFARS' && DFARS_TITLES[code]) {
      title = DFARS_TITLES[code]
      known = true
    } else {
      // Best-effort: look at up to ~240 chars AFTER the clause reference —
      // federal clause titles can run 100+ characters (e.g. 52.225-25) and
      // the previous 120-char window was clipping them mid-phrase. Strip
      // trailing FAR-code fragments, all-caps date stamps, and empty
      // parens; then take the first sentence-like chunk.
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 240)
        .replace(/[\s\r\n]+/g, ' ')
        .replace(/\b(?:FAR|DFARS?)\s*\d{2,3}[\s\d.-]*/gi, '')
        .replace(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{4}\b/gi, '')
        .replace(/\(\s*\)/g, '')
        .replace(/^[\s.,;:()\-]+/, '')
        .split(/(?:[.;\n]|\s{2,})/)[0]
        .trim()

      // Reject snippets that end mid-phrase — trailing prepositions,
      // conjunctions, or articles are the tell that we clipped a title
      // in the middle. Better to drop the row than surface a fragment.
      const endsMidPhrase =
        /\b(?:and|or|the|a|an|of|to|for|with|by|as|in|on|at|from|that|which|when|where|is|are|be|been|being|has|have|had|internal|external|federal|certain|these|those|this|his|her|its)$/i.test(after)

      const startsWithWord = /^[A-Z][a-zA-Z]{2,}/.test(after)
      if (startsWithWord && !endsMidPhrase && after.length >= 8 && after.length <= 220) {
        // Federal solicitations often print clause titles in ALL CAPS.
        // Convert to Title Case so the compliance list reads coherently
        // alongside the canonical entries above.
        title = /^[^a-z]+$/.test(after) ? toTitleCase(after) : after
      }
    }

    // Drop rows with no usable title so we don't fill the compliance list
    // with garbage snippets — the user only sees clauses we can actually
    // name or explain.
    if (!title) continue

    seen.set(key, { ref: `${system} ${code}`, code, system, title, known })
  }
  return Array.from(seen.values()).sort((a, b) => a.ref.localeCompare(b.ref))
}

function RequiredPlansTiles({
  compliance,
  attachmentText,
  naicsCode,
  completionByPlan,
  onOpenPlan,
  onDownloadPackage,
}: {
  compliance: ScopeItem[]
  attachmentText: string
  naicsCode?: string | null
  completionByPlan: Record<string, PlanCompletion>
  onOpenPlan: (planKey: string) => void
  onDownloadPackage: () => void
}) {
  const isConstruction = isConstructionNaics(naicsCode)
  const detected = REQUIRED_PLANS
    .map((plan) => {
      const rationales: string[] = []
      if (compliance.some((c) => plan.detect.test(c.text))) {
        rationales.push('Named in the solicitation compliance items')
      }
      if (isConstruction && plan.constructionDefault) {
        rationales.push(`Construction default for NAICS ${naicsCode}`)
      }
      if (attachmentText) {
        for (const trigger of plan.contentTriggers ?? []) {
          if (trigger.pattern.test(attachmentText)) rationales.push(trigger.rationale)
        }
      }
      const unique = Array.from(new Set(rationales))
      return { plan, rationales: unique }
    })
    .filter((row) => row.rationales.length > 0)

  if (detected.length === 0) return null

  // Overall bid-package completion — average of every surfaced plan's percent.
  const overallPercent = Math.round(
    detected.reduce((acc, { plan }) => acc + (completionByPlan[plan.key]?.percent ?? 0), 0) /
      detected.length,
  )
  const readyToSubmit = overallPercent >= 100

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
          Required Plans
        </p>
        <span className="text-[10px] text-stone-400">
          Detected from solicitation attachments + NAICS
        </span>
      </div>

      {/* Overall bid-package completion + download gate */}
      <div className="mb-4 p-3 rounded-lg border border-stone-200 bg-stone-50">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-xs font-semibold text-stone-800">Bid Package Completion</p>
            <p className="text-[11px] text-stone-500 mt-0.5">
              {readyToSubmit
                ? 'All plans are ready — you can package and download for submission.'
                : `${100 - overallPercent}% still to complete across ${detected.length} plans.`}
            </p>
          </div>
          <span className={`text-lg font-semibold tabular-nums ${readyToSubmit ? 'text-emerald-600' : 'text-stone-700'}`}>
            {overallPercent}%
          </span>
        </div>
        <div className="h-2 bg-stone-200 rounded-full overflow-hidden mb-3">
          <div
            className={`h-full transition-all ${readyToSubmit ? 'bg-emerald-500' : 'bg-stone-600'}`}
            style={{ width: `${overallPercent}%` }}
          />
        </div>
        <button
          type="button"
          onClick={onDownloadPackage}
          disabled={!readyToSubmit}
          className={`w-full text-sm font-medium px-3 py-2 rounded transition-colors ${
            readyToSubmit
              ? 'bg-stone-800 text-white hover:bg-stone-700'
              : 'bg-stone-100 text-stone-400 cursor-not-allowed'
          }`}
          title={readyToSubmit ? 'Open every plan for print / save as PDF' : 'All plans must be 100% to enable download'}
        >
          {readyToSubmit ? 'Download all plans for submission' : `Download locked · ${overallPercent}% complete`}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {detected.map(({ plan, rationales }) => {
          const hasGenerator = plan.key === 'app' || plan.key === 'cs' || plan.key === 'sov'
          const hasOutline = !!plan.templateOutline?.length
          const isClickable = hasGenerator || hasOutline
          const c = completionByPlan[plan.key] ?? { percent: 0, filled: 0, total: 0 }
          const isDone = c.percent >= 100
          const ctaLabel = hasGenerator ? 'Open preview' : 'See template outline'
          return (
            <button
              key={plan.key}
              type="button"
              onClick={() => isClickable && onOpenPlan(plan.key)}
              disabled={!isClickable}
              className={`text-left border border-stone-200 rounded-lg p-3 bg-stone-50/50 transition-colors ${
                isClickable ? 'hover:border-stone-400 hover:bg-white cursor-pointer' : 'cursor-default'
              }`}
              title={isClickable ? `${ctaLabel} for ${plan.shortName}` : undefined}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-stone-900">{plan.shortName}</p>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                  isDone
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-white text-stone-500 border-stone-200'
                }`}>
                  {isDone ? 'Ready' : 'Required'}
                </span>
              </div>
              <p className="text-xs font-medium text-stone-700 mb-1">{plan.label}</p>
              <p className="text-xs text-stone-500 leading-snug">{plan.purpose}</p>

              {/* Completion strip */}
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10px] text-stone-500 mb-1">
                  <span>{c.note ?? (hasGenerator ? 'Fields filled' : 'Template outline available')}</span>
                  <span className="tabular-nums">
                    {c.percent}%{c.total > 0 && ` · ${c.filled}/${c.total}`}
                  </span>
                </div>
                <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${isDone ? 'bg-emerald-500' : 'bg-stone-500'}`}
                    style={{ width: `${c.percent}%` }}
                  />
                </div>
              </div>

              {rationales.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {rationales.slice(0, 3).map((r, i) => (
                    <li key={i} className="text-[11px] text-stone-600 leading-snug flex items-start gap-1.5">
                      <span className="text-stone-400 mt-0.5 flex-shrink-0">·</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
              {isClickable && (
                <p className="mt-2 text-[11px] font-medium text-stone-700">
                  {ctaLabel} →
                </p>
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-[11px] text-stone-400 italic">
        Plan authors are assigned inside the subcontractor intake form —
        each sub delegates the relevant section to the right person on
        their team.
      </p>
    </div>
  )
}
