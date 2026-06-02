import OpenAI from 'openai'

// Lazy singleton — defer construction until first use so missing OPENAI_API_KEY
// doesn't crash the build or unrelated API routes at module load time.
let _openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

export interface SOWSection {
  title: string
  summary: string
  bullets: string[]
  details: string
}

interface SOWGenerationInput {
  title: string
  solicitationNumber: string
  agency: string
  naicsCode?: string | null
  setAside?: string | null
  quoteDeadline: string // Internal deadline for the sub to send quote to the prime (NOT the federal response date)
  placeOfPerformance: string
  description?: string | null
  parsedScope?: string[]
  parsedDeliverables?: string[]
  parsedCompliance?: string[]
  parsedPeriodOfPerformance?: string[]
  subcontractorName?: string | null
  primeCompany?: string | null
}

/**
 * Use OpenAI to generate professional SOW section copy.
 * Returns sections 1–6 with summary, bullets, and full details.
 */
export async function generateSOWSections(input: SOWGenerationInput): Promise<SOWSection[]> {
  const {
    title,
    solicitationNumber,
    agency,
    naicsCode,
    setAside,
    quoteDeadline,
    placeOfPerformance,
    description,
    parsedScope,
    parsedDeliverables,
    parsedCompliance,
    parsedPeriodOfPerformance,
    subcontractorName,
    primeCompany,
  } = input
  const primeName = primeCompany || 'the prime contractor'

  const hasParsed = !!(
    (parsedScope && parsedScope.length > 0) ||
    (parsedDeliverables && parsedDeliverables.length > 0) ||
    (parsedCompliance && parsedCompliance.length > 0)
  )

  // Determine agency type for tone and deliverable format guidance
  const agencyUpper = agency.toUpperCase()
  const isDoD = /\b(DOD|ARMY|NAVY|MARINE|AIR FORCE|SPACE FORCE|DEFENSE|DLA|DCMA|DARPA|SOCOM|CENTCOM|INDOPACOM|NORTHCOM|EUCOM|TRANSCOM|JSOC|NAVSEA|NAVAIR|SPAWAR|PEO|AMC|USMC|USAF|DISA|MDA|NRO|DIA|NSA|PENTAGON|AFRL|ARL|ERDC|CERL|USACE|CORPS OF ENGINEERS)\b/i.test(agencyUpper)
  const isDHS = /\b(DHS|HOMELAND|FEMA|CBP|ICE|TSA|USCG|SECRET SERVICE|CISA)\b/i.test(agencyUpper)
  const isVA = /\b(VA\b|VETERANS AFFAIRS|VETERANS HEALTH|VHA|VBA)\b/i.test(agencyUpper)
  const isHealthAgency = /\b(HHS|NIH|CDC|FDA|CMS|HRSA|SAMHSA|AHRQ)\b/i.test(agencyUpper)

  // Agency tone is for VOICE only — formality, terminology preferences. It does
  // NOT authorize inventing standards, clearances, or clauses. Every specific
  // citation must still be grounded in the source content above.
  let agencyToneGuidance: string
  let deliverablesGuidance: string

  if (isDoD) {
    agencyToneGuidance = `This is a Department of Defense (DoD) contract. Voice: formal, precise, compliance-conscious. You MAY use the acronyms COR, CDRL, QASP, GFE, GFP if they fit the section. You may NOT cite specific MIL-STD/MIL-SPEC numbers, DFARS clauses, security clearance levels, or CMMC levels unless they appear in the source content above.`
    deliverablesGuidance = `When deliverables are listed in the source, format each one with name + frequency + submission format if those are available. If frequency/format are not in the source, omit them rather than inventing.`
  } else if (isDHS) {
    agencyToneGuidance = `This is a Department of Homeland Security (DHS) contract. Voice: security-conscious, operational. You may use COR; you may NOT cite specific HSAR clauses or clearance levels unless they appear in the source content above.`
    deliverablesGuidance = `When deliverables are listed in the source, format each one with name + due date + submission method if those are available. Omit fields not in source.`
  } else if (isVA) {
    agencyToneGuidance = `This is a Department of Veterans Affairs (VA) contract. Voice: Veteran-centered, compliance-focused. You may use COR. You may NOT cite HIPAA/PHI/VAAR specifics unless the source mentions Veteran data or healthcare work.`
    deliverablesGuidance = `When deliverables are listed in the source, name them concretely. Omit submission specifics not in source.`
  } else if (isHealthAgency) {
    agencyToneGuidance = `This is a civilian health agency (HHS/NIH/CDC/FDA) contract. Voice: technically precise. You may use COR. You may NOT cite specific health data standards (HL7, FHIR, HIPAA) unless they appear in the source content above.`
    deliverablesGuidance = `When deliverables are listed in the source, name them concretely with format/frequency only if stated. No invented timelines.`
  } else {
    agencyToneGuidance = `This is a civilian federal agency contract. Voice: professional, action-oriented for a small business subcontractor. You may use COR/PWS/QASP if they fit. You may NOT cite specific FAR clauses unless they appear in the source content above.`
    deliverablesGuidance = `When deliverables are listed in the source, name them concretely with format/frequency only if stated. No invented timelines.`
  }

  const contextBlock = [
    `Prime contractor: ${primeName}`,
    `Solicitation reference: ${solicitationNumber} — "${title}"`,
    `End customer: ${agency}`,
    naicsCode ? `NAICS Code: ${naicsCode}` : null,
    setAside ? `Set-Aside (informational only): ${setAside}` : null,
    `Quote-to-prime deadline: ${quoteDeadline}`,
    `Place of performance / delivery: ${placeOfPerformance}`,
    subcontractorName ? `Subcontractor being addressed: ${subcontractorName}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  // Condense each parsed item to ~250 chars so we don't blow the context with
  // raw multi-paragraph PDF extractions. Without this, parsed content alone
  // can be 5,000+ chars per category, crowding out the actual instructions.
  const trim = (s: string, max = 250) => {
    const cleaned = s.replace(/\s+/g, ' ').trim()
    return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned
  }
  const parsedBlock = hasParsed
    ? `\n\nPARSED SOLICITATION CONTENT (excerpts from attachments):\n` +
      (parsedScope?.length ? `Scope:\n${parsedScope.slice(0, 5).map(s => `- ${trim(s)}`).join('\n')}\n` : '') +
      (parsedDeliverables?.length ? `Deliverables:\n${parsedDeliverables.slice(0, 5).map(s => `- ${trim(s)}`).join('\n')}\n` : '') +
      (parsedCompliance?.length ? `Compliance:\n${parsedCompliance.slice(0, 5).map(s => `- ${trim(s)}`).join('\n')}\n` : '') +
      (parsedPeriodOfPerformance?.length ? `Period of Performance:\n${parsedPeriodOfPerformance.slice(0, 3).map(s => `- ${trim(s)}`).join('\n')}\n` : '')
    : description
    ? `\n\nSOLICITATION DESCRIPTION:\n${description.slice(0, 3000)}`
    : ''

  const prompt = `You are writing a Statement of Work (SOW) FROM a prime contractor TO a potential subcontractor. The subcontractor will scan this in under 90 seconds to decide: "Can I supply this, and is it worth quoting?" Then they will send a quote back to the prime by the quote-to-prime deadline below.

EVIDENCE RULE — non-negotiable, this is the most important rule:
Every specific FACT you write (a standard number, a clause number, a clearance level, a certification, a date, a dollar amount, a quantity, a technical spec, a system name, a software language, a hardware part, a security requirement, a country-of-origin rule) MUST appear in OPPORTUNITY DETAILS or PARSED SOLICITATION CONTENT below. If a fact is not in the source, you have exactly two options:
  (a) Omit it entirely.
  (b) Write the literal placeholder: [NEEDS DETAIL: <short description of what would belong here>]
A placeholder is ALWAYS better than an invented plausible fact. The user will see "[NEEDS DETAIL: ...]" and know to fill it in or parse more attachments. They CANNOT detect a hallucinated fact and will send a wrong SOW to a real subcontractor.

FORBIDDEN INVENTED CONTENT — never write these unless they appear verbatim in the source:
- MIL-STD-498 (deprecated 1998 standard, almost never in real modern solicitations)
- Specific MIL-STD / MIL-SPEC numbers
- ISO 9001 or other ISO numbers (only if the source explicitly cites them)
- Buy American Act (only for manufactured-goods contracts, not for software/services)
- Trade Agreements Act / TAA (only if source cites it)
- Specific CMMC levels (CMMC L1/L2/L3 — only the level explicitly stated in source)
- TS/SCI/SECRET/CONFIDENTIAL clearance levels (only the level stated in source)
- Specific FAR or DFARS clause numbers
- HIPAA, FedRAMP, FISMA, NIST 800-171, NIST 800-53 (only if cited in source)

FORBIDDEN GENERIC FILLER — never use these phrases even if they "sound right":
- "All applicable FAR clauses"
- "Refer to the solicitation"
- "Per the solicitation requirements"
- "All work products specified in the solicitation"
- "Compliance with all terms and conditions"
- "Standard industry practices"
- "Industry best practices"
- "As required by the government"
If you find yourself writing a bullet generic enough to apply to ANY federal contract, replace it with a [NEEDS DETAIL: ...] placeholder.

CRITICAL AUDIENCE RULES:
- The audience is a SUBCONTRACTOR quoting parts/services to the PRIME. They are NOT bidding on the federal contract.
- DO NOT mention SAM.gov registration, the federal response deadline, SF-1449 forms, or any procedural step the subcontractor takes with the government. The prime handles all federal procedural steps.
- DO NOT instruct the subcontractor to "submit a quote to the agency" — they submit to the PRIME.
- The ONE deadline in this document is the quote-to-prime deadline: ${quoteDeadline}. Treat this as THE deadline.

AGENCY TONE (voice/formality only — does NOT authorize inventing facts):
${agencyToneGuidance}

OPPORTUNITY DETAILS:
${contextBlock}${parsedBlock}

DELIVERABLES GUIDANCE:
${deliverablesGuidance}

DENSITY RULES — the SOW must be scannable in 30 seconds:
- Each bullet ≤ 100 characters (~15 words). Telegram-style: short, concrete, action-oriented. If a fact takes more than 15 words, split it or drop the modifier.
- 2–4 bullets per section, 3 typical. NEVER 5. Empty white space is desirable — a sub reading on phone needs breathing room.
- Quality over quantity: one specific fact beats three generic ones.
- "details" prose: leave EMPTY ("") for most sections. Only fill when there's a critical caveat or numeric/contextual detail that genuinely doesn't fit a bullet. Default to empty. Most sections do not need a details paragraph.

PER-SECTION EVIDENCE BUDGET:
- 3+ concrete facts → 3–4 short bullets, each tied to one fact
- 1–2 facts → those bullets only (no [NEEDS DETAIL] padding)
- 0 facts → one bullet: "[NEEDS DETAIL: <what belongs here>]"

Output: exactly 6 SOW sections as JSON. Each section has:
- "title": short heading
- "summary": one plain sentence (max 80 chars). Empty section → "Needs detail from the solicitation."
- "bullets": 1–4 short bullets per rules above
- "details": "" (empty string) by default. Only non-empty when a critical caveat genuinely doesn't fit a bullet — never restating bullets as prose.

Sections:
1. 1.0 What We Need — the product or service the prime needs the sub to supply. Concrete: part / spec / quantity / function / end-use. This is the "can I supply this?" section.
2. 2.0 Scope of Work — specific tasks or supply items the sub performs. Specs, quantities, performance standards, acceptance criteria from the source.
3. 3.0 Place of Performance / Delivery — where the sub ships to (FOB destination) or performs (site/remote). Mention travel only if the source states it.
4. 4.0 Quote Submission — when and how the sub returns their quote TO THE PRIME. Anchor on the quote-to-prime deadline (${quoteDeadline}). Include firm fixed price, lead time, exceptions, point of contact. DO NOT mention the federal response deadline. This section can use the standard request bullets — it's the only section where invariant content is OK.
5. 5.0 Deliverables — concrete outputs the sub provides. Each bullet is one specific item from the source. Generic phrases forbidden — use [NEEDS DETAIL: ...] instead.
6. 6.0 Compliance Pass-Through — specific technical/regulatory items from the source that flow down to the sub: technical standards, certifications, security/clearance, country-of-origin rules, named FAR/DFARS clauses. If the source has none, output a single bullet: "[NEEDS DETAIL: compliance pass-through items not extracted — parse the solicitation attachments or add manually]".

Return ONLY a valid JSON array of 6 objects. No markdown, no explanation.`

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(raw)
    // Handle both { sections: [...] } and bare [...]
    const sections: SOWSection[] = Array.isArray(parsed) ? parsed : (parsed.sections || [])

    if (!sections.length) {
      throw new Error('OpenAI returned empty sections')
    }

    return sections
  } catch {
    throw new Error(`Failed to parse OpenAI SOW response: ${raw.slice(0, 200)}`)
  }
}

// ─── Opportunity Brief ────────────────────────────────────────────────────────

export interface OpportunityBrief {
  whatTheyAreBuying: string
  extendedOverview?: string
  endUser?: string
  placeOfPerformance: {
    location: string
    siteType: 'on-site' | 'remote' | 'hybrid' | 'unknown'
    travelRequired: boolean
  }
  whoQualifies: {
    setAside?: string
    licenses?: string[]
    clearances?: string[]
    certifications?: string[]
  }
  keyDeliverables: Array<{
    item: string
    frequency?: string
  }>
  periodOfPerformance: {
    basePeriod: string
    optionYears?: number
  }
  estimatedValue?: string
  contractType?: string
  headsUp: Array<{
    type: 'bonding' | 'clearance' | 'setaside' | 'timeline' | 'onsite' | 'other'
    message: string
  }>
  generatedAt: string
}

interface BriefGenerationInput {
  title: string
  agency: string
  solicitationNumber: string
  naicsCode?: string | null
  setAside?: string | null
  description?: string | null
  rawData?: Record<string, unknown> | null
  parsedAttachments?: {
    structured?: {
      scope?: string[]
      deliverables?: string[]
      compliance?: string[]
      periodOfPerformance?: string[]
      placeOfPerformance?: string
    }
  } | null
}

/**
 * Generate an Opportunity Brief — plain-language summary answering what, where, who qualifies,
 * deliverables, and any gotchas. Cached to opportunity.opportunityBrief.
 */
export async function generateOpportunityBrief(input: BriefGenerationInput): Promise<OpportunityBrief> {
  const {
    title,
    agency,
    solicitationNumber,
    naicsCode,
    setAside,
    description,
    rawData,
    parsedAttachments,
  } = input

  const structured = parsedAttachments?.structured

  const contextBlock = [
    `Title: ${title}`,
    `Agency: ${agency}`,
    `Solicitation Number: ${solicitationNumber}`,
    naicsCode ? `NAICS Code: ${naicsCode}` : null,
    setAside ? `Set-Aside: ${setAside}` : null,
    rawData?.placeOfPerformance ? `Place of Performance: ${JSON.stringify(rawData.placeOfPerformance)}` : null,
    rawData?.contractType ? `Contract Type: ${rawData.contractType}` : null,
    rawData?.awardAmount ? `Estimated Value: ${rawData.awardAmount}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const parsedBlock = structured
    ? '\n\nPARSED SOLICITATION CONTENT:\n' +
      (structured.scope?.length ? `Scope:\n${structured.scope.slice(0, 6).join('\n')}\n` : '') +
      (structured.deliverables?.length ? `Deliverables:\n${structured.deliverables.slice(0, 6).join('\n')}\n` : '') +
      (structured.compliance?.length ? `Compliance:\n${structured.compliance.slice(0, 6).join('\n')}\n` : '') +
      (structured.periodOfPerformance?.length ? `Period of Performance:\n${structured.periodOfPerformance.slice(0, 4).join('\n')}\n` : '') +
      (structured.placeOfPerformance ? `Place of Performance Detail: ${structured.placeOfPerformance}\n` : '')
    : description
    ? `\n\nSOLICITATION DESCRIPTION:\n${description.slice(0, 4000)}`
    : ''

  const prompt = `You are briefing a small business contractor on a federal solicitation before they search for subcontractors. Write a plain-language brief that answers the key questions they need answered.

OPPORTUNITY DATA:
${contextBlock}${parsedBlock}

Return a JSON object matching this exact structure:
{
  "whatTheyAreBuying": "2–3 plain-English sentences. What is the government buying? Who is the end user? What is the core work?",
  "extendedOverview": "4–7 paragraphs of plain-language narrative. Cover: (1) the full scope and nature of the work, (2) operational context and why the agency needs this, (3) what day-to-day performance looks like, (4) key technical or specialized requirements, (5) notable risks or complexities a small business should understand, (6) how success will be measured. Write for a non-government project manager who is deciding whether to pursue this bid.",
  "endUser": "Who benefits from or uses the delivered services/products (e.g. 'Army personnel at Fort Knox'). Omit if unclear.",
  "placeOfPerformance": {
    "location": "City, State (or 'Multiple locations' or 'TBD')",
    "siteType": "on-site | remote | hybrid | unknown",
    "travelRequired": true or false
  },
  "whoQualifies": {
    "setAside": "Set-aside type if applicable (e.g. 'SDVOSB', '8(a)', 'HUBZone') or null",
    "licenses": ["Any required trade or professional licenses. Empty array if none."],
    "clearances": ["Any required security clearances, e.g. 'Secret', 'Top Secret'. Empty array if none."],
    "certifications": ["Any required certifications, e.g. 'ISO 9001', 'CMMC Level 2'. Empty array if none."]
  },
  "keyDeliverables": [
    { "item": "Plain-language deliverable description", "frequency": "Monthly / Per incident / Annually / One-time (or omit if not stated)" }
  ],
  "periodOfPerformance": {
    "basePeriod": "Plain description, e.g. '12 months' or 'Base year: Oct 2026 – Sep 2027'",
    "optionYears": 4 (number of option years, or omit if none)
  },
  "estimatedValue": "Dollar amount if stated, e.g. '$2.4M/year (stated)' or 'Not stated'",
  "contractType": "FFP / T&M / CPFF / IDIQ / etc. or null if not stated",
  "headsUp": [
    {
      "type": "bonding | clearance | setaside | timeline | onsite | other",
      "message": "Plain-language warning, e.g. 'Performance bond required — may disqualify smaller subs'"
    }
  ],
  "generatedAt": "${new Date().toISOString()}"
}

Heads Up rules — include an entry for each that applies:
- type "bonding": if bonding or insurance >$100K is mentioned
- type "clearance": if any security clearance (Secret, Top Secret, DD-254) is required
- type "setaside": if a set-aside restricts who can participate (list the restriction)
- type "timeline": if response deadline is within 30 days OR if base period is unusually short (<6 months)
- type "onsite": if work requires mandatory on-site presence (not remote-eligible)
- type "other": any other unusual requirement that would affect subcontractor eligibility

Keep all language plain and direct. No FAR clause numbers in plain text unless critical to understand. No jargon without explanation.

Return ONLY valid JSON. No markdown, no extra text.`

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 3500,
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(raw) as OpportunityBrief
    if (!parsed.whatTheyAreBuying) throw new Error('Missing required brief fields')
    return parsed
  } catch {
    throw new Error(`Failed to parse brief response: ${raw.slice(0, 200)}`)
  }
}

// ─── Attachment Analysis ──────────────────────────────────────────────────────

/** Known government form patterns — checked against filename before calling LLM */
const FORM_PATTERNS: Array<{ pattern: RegExp; formType: string }> = [
  { pattern: /SF[-_]?1449/i, formType: 'SF-1449' },
  { pattern: /SF[-_]?33\b/i, formType: 'SF-33' },
  { pattern: /SF[-_]?26\b/i, formType: 'SF-26' },
  { pattern: /SF[-_]?30\b/i, formType: 'SF-30' },
  { pattern: /DD[-_]?1155/i, formType: 'DD-1155' },
  { pattern: /DD[-_]?254/i, formType: 'DD-254' },
  { pattern: /OF[-_]?347/i, formType: 'OF-347' },
  { pattern: /wage.?determination|WD[-_\s]\d/i, formType: 'Wage Determination' },
  { pattern: /davis.?bacon/i, formType: 'Wage Determination' },
]

export interface AttachmentInput {
  id: string
  originalName: string
  textContent?: string
}

export interface AttachmentAnalysis {
  id: string
  suggestedName: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  isForm: boolean
  formType: string | null
}

/**
 * Detect known government form by filename pattern (no LLM needed).
 */
function detectFormByFilename(filename: string): { isForm: boolean; formType: string | null } {
  for (const { pattern, formType } of FORM_PATTERNS) {
    if (pattern.test(filename)) return { isForm: true, formType }
  }
  return { isForm: false, formType: null }
}

/**
 * Batch-analyze attachments with GPT-4o to suggest human-readable names
 * and detect government forms. Falls back to filename-only detection if OpenAI fails.
 */
export async function analyzeAttachments(
  attachments: AttachmentInput[]
): Promise<AttachmentAnalysis[]> {
  if (!attachments.length) return []

  // Pre-screen with filename patterns first
  const filenameResults = attachments.map((att) => ({
    id: att.id,
    ...detectFormByFilename(att.originalName),
  }))

  // Build prompt
  const attachmentList = attachments
    .map(
      (att, i) =>
        `${i + 1}. ID: "${att.id}"\n   Filename: "${att.originalName}"${
          att.textContent ? `\n   Content excerpt: "${att.textContent.slice(0, 400)}"` : ''
        }`
    )
    .join('\n\n')

  const prompt = `You are renaming federal government solicitation attachments so a small business owner can scan a list and instantly know what each document is.

ATTACHMENTS:
${attachmentList}

For each attachment, return a JSON object with:
- "id": the attachment ID (exact match)
- "suggestedName": Title-Case filename describing WHAT THIS DOCUMENT IS, derived from the CONTENT EXCERPT and/or the original filename. Keep the original extension.
- "confidence": "HIGH" if confident from content, "MEDIUM" if reasonable from filename + partial content, "LOW" if uncertain
- "isForm": true if standard government form (SF-*, DD-*, OF-*, wage determination), false otherwise
- "formType": form ID (e.g. "SF-1449") when isForm is true, null otherwise

CRITICAL — anti-hallucination rules:
- If the original filename is generic (e.g. "Attachment 1", "Document.pdf", "File_3") AND there is NO content excerpt → return suggestedName: null. DO NOT invent a name.
- Only suggest a specific document type when the content excerpt or filename actually supports it.
- When filename is a code/UUID but you have NO content excerpt → return suggestedName: null.
- When original filename is already plain-English ("Performance Work Statement.pdf") → return suggestedName: null.

DIFFERENTIATION — when multiple attachments share the same document type:
- Many federal docs start with the same boilerplate (SF-30 amendment header, SF-1449 form fields). Look PAST that into the actual subject — amendment number, modification description, attachment letter, section/exhibit identifier, version, date.
- Each suggestedName must be DISTINCT from the others. If 3 docs are all amendments, name them by their amendment number / subject — e.g. "Amendment 0002 - Q&A Responses.docx", "Amendment 0003 - Wage Rate Update.docx", "Amendment 0004 - Final Q&A.docx".
- If you can't find a distinguishing detail, fall back to the original filename (return suggestedName: null) rather than producing duplicate names.

Format rules:
- Keep the original file extension exactly.
- For known forms, include the form number (e.g. "SF-1449 Solicitation Form.pdf").
- Return JSON with key "results" containing exactly ${attachments.length} objects.

Return ONLY valid JSON. No markdown, no explanation.`

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    })

    const raw = response.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)
    const results: AttachmentAnalysis[] = Array.isArray(parsed)
      ? parsed
      : parsed.results || []

    // Merge with filename detection: filename patterns take precedence for isForm/formType
    return results.map((r) => {
      const filenameMatch = filenameResults.find((f) => f.id === r.id)
      return {
        id: r.id,
        suggestedName: r.suggestedName ?? null,
        confidence: r.confidence ?? 'LOW',
        isForm: filenameMatch?.isForm || r.isForm || false,
        formType: filenameMatch?.formType || r.formType || null,
      }
    })
  } catch {
    // Fallback: return filename-only results with no suggested names
    return attachments.map((att) => {
      const filenameMatch = filenameResults.find((f) => f.id === att.id)!
      return {
        id: att.id,
        suggestedName: null,
        confidence: 'LOW' as const,
        isForm: filenameMatch.isForm,
        formType: filenameMatch.formType,
      }
    })
  }
}

// ─── Agent Briefing ───────────────────────────────────────────────────────────

export interface AgentBriefing {
  summary: string
  talkingPoints: string[]
  qualifications: string[]
  complianceFlags: string[]
  generatedAt: string
}

interface AgentBriefingInput {
  title: string
  agency: string
  naicsCode?: string | null
  setAside?: string | null
  description?: string | null
  rawData?: Record<string, unknown> | null
  parsedAttachments?: {
    structured?: {
      scope?: string[]
      deliverables?: string[]
      compliance?: string[]
    }
  } | null
}

export async function generateAgentBriefing(input: AgentBriefingInput): Promise<AgentBriefing> {
  const { title, agency, naicsCode, setAside, description, rawData, parsedAttachments } = input
  const structured = parsedAttachments?.structured

  const contextBlock = [
    `Title: ${title}`,
    `Agency: ${agency}`,
    naicsCode ? `NAICS Code: ${naicsCode}` : null,
    setAside ? `Set-Aside: ${setAside}` : null,
    rawData?.estimatedValue ? `Estimated Value: ${rawData.estimatedValue}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const parsedBlock = structured
    ? '\n\nPARSED SOLICITATION CONTENT:\n' +
      (structured.scope?.length ? `Scope:\n${structured.scope.slice(0, 5).join('\n')}\n` : '') +
      (structured.deliverables?.length ? `Deliverables:\n${structured.deliverables.slice(0, 5).join('\n')}\n` : '') +
      (structured.compliance?.length ? `Compliance:\n${structured.compliance.slice(0, 5).join('\n')}\n` : '')
    : description
    ? `\n\nSOLICITATION DESCRIPTION:\n${description.slice(0, 4000)}`
    : ''

  const prompt = `You are briefing a field agent (non-technical small business representative) on a federal solicitation they are working to win. Write in plain English — no jargon, no government acronyms without explanation, nothing generic.

OPPORTUNITY:
${contextBlock}${parsedBlock}

Return a JSON object with exactly this structure:
{
  "summary": "2–3 plain-English sentences. What is the government buying? Who needs it? What is the core work the contractor must perform?",
  "talkingPoints": ["3–5 bullets: key facts a field agent would want to know when discussing this opportunity — size of contract, type of work, who the end user is, anything that makes this a strong or weak fit"],
  "qualifications": ["Exact eligibility requirements drawn from the solicitation: required licenses, certifications, clearances, set-aside eligibility, minimum experience thresholds, bonding. Every bullet must name a specific requirement — no generic items like 'must be qualified'. If no specific requirements are stated, return an empty array."],
  "complianceFlags": ["Compliance requirements and gotchas: mandatory on-site presence, reporting cadences, FAR clauses with real consequences, insurance minimums, specific deliverable formats. Every bullet must be specific and actionable. If none apply, return an empty array."],
  "generatedAt": "${new Date().toISOString()}"
}

Rules:
- Every bullet in qualifications and complianceFlags must come from the actual solicitation data — no invented or generic items
- Use plain language any small business owner can act on
- Return ONLY valid JSON. No markdown, no extra text.`

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content || '{}'
  try {
    const parsed = JSON.parse(raw) as AgentBriefing
    if (!parsed.summary) throw new Error('Missing summary')
    return {
      summary: parsed.summary,
      talkingPoints: parsed.talkingPoints || [],
      qualifications: parsed.qualifications || [],
      complianceFlags: parsed.complianceFlags || [],
      generatedAt: parsed.generatedAt || new Date().toISOString(),
    }
  } catch {
    throw new Error(`Failed to parse agent briefing: ${raw.slice(0, 200)}`)
  }
}

/**
 * Generate a concise AI synopsis for an opportunity description.
 */
export async function generateOpportunitySynopsis(
  title: string,
  description: string,
  agency: string,
  naicsCode?: string | null
): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `Summarize this federal government solicitation in 2–3 concise sentences for a contractor reviewing it. Focus on what work is required, who needs it, and any key requirements. Be specific, not generic.

Title: ${title}
Agency: ${agency}
${naicsCode ? `NAICS: ${naicsCode}` : ''}
Description:
${description.slice(0, 4000)}

Return only the summary text, no labels or formatting.`,
      },
    ],
    temperature: 0.2,
    max_tokens: 200,
  })

  return response.choices[0]?.message?.content?.trim() || ''
}
