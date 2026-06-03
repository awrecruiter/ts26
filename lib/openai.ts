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
  /** Narrative paragraph (2–4 sentences) that synthesizes what this section
   *  means for the sub. Renders ABOVE bullets in the PDF and editor. */
  overview?: string
  bullets: string[]
  /** Legacy field kept for back-compat with older stored SOWs. New AI output
   *  uses `overview` instead. The renderers fall back to details when
   *  overview is missing. */
  details?: string
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

  // Give the AI enough source material to synthesize from. Previously trimmed
  // to 250 chars × 5 items per category — too thin to write a narrative
  // about. Now: 400 chars × 8 items, so the AI has ~13K chars of parsed
  // content to ground itself in. Plenty of room in GPT-4o's context.
  const trim = (s: string, max = 400) => {
    const cleaned = s.replace(/\s+/g, ' ').trim()
    return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned
  }
  const parsedBlock = hasParsed
    ? `\n\nPARSED SOLICITATION CONTENT (excerpts from attachments — use to synthesize a narrative):\n` +
      (parsedScope?.length ? `Scope excerpts:\n${parsedScope.slice(0, 8).map(s => `- ${trim(s)}`).join('\n')}\n` : '') +
      (parsedDeliverables?.length ? `Deliverable excerpts:\n${parsedDeliverables.slice(0, 8).map(s => `- ${trim(s)}`).join('\n')}\n` : '') +
      (parsedCompliance?.length ? `Compliance excerpts:\n${parsedCompliance.slice(0, 8).map(s => `- ${trim(s)}`).join('\n')}\n` : '') +
      (parsedPeriodOfPerformance?.length ? `Period of performance excerpts:\n${parsedPeriodOfPerformance.slice(0, 4).map(s => `- ${trim(s)}`).join('\n')}\n` : '')
    : description
    ? `\n\nSOLICITATION DESCRIPTION:\n${description.slice(0, 3000)}`
    : ''

  const prompt = `You are writing a Statement of Work (SOW) FROM a prime contractor TO a potential subcontractor. The goal: both parties walk away with confidence — the sub understands what they'd be supplying and whether they qualify; the prime gets a useful quote back.

Your job is to SYNTHESIZE the parsed solicitation excerpts below into a coherent narrative the sub can act on. Read the excerpts, infer the program's purpose, who the end customer is, what kind of work is needed, and what would qualify a sub for it. Then write each section so it tells part of that story.

THE NARRATIVE STANDARD:
A well-written section has TWO parts:
1. A short "overview" paragraph (2–4 plain-English sentences) that synthesizes WHAT this section means for the sub — context, why this matters, the lay of the land
2. A short list of "bullets" (2–4 items, ≤100 chars each) with the concrete, specific facts pulled from the source

The overview is the synthesis. The bullets are the receipts.

EXAMPLE — for a section about scope:
✅ GOOD overview: "NGA is contracting for ongoing sustainment of FS3i — a software platform that supports geospatial intelligence operations. The prime needs subs who can handle modernization work in a classified DoD environment, including cloud migration support and software updates against existing baselines."
❌ BAD overview: "Section 2.0 covers the scope of work."
❌ BAD overview: "" (empty)
✅ GOOD bullets: ["Modernize and sustain WebDVOF cloud architecture", "Develop against existing NGA software baselines", "Support transition from on-prem to AWS GovCloud"]
❌ BAD bullets: ["the work scope on contract.", "work completed.", "subcontractor effort."]

GROUNDING (still important — don't invent):
- Synthesize from what's in the parsed excerpts. Infer reasonable connections (if excerpts mention "AWS GovCloud" + "NGA" + "FS3i", you can write "cloud migration in a classified NGA environment").
- Do NOT invent specific standards, clause numbers, dollar amounts, or clearance levels that aren't in the excerpts.
- If you can see a pattern but lack a specific fact (e.g. excerpts mention security but no clearance level), write the pattern without the missing fact: "Work occurs in a classified environment — confirm clearance requirements with the prime."
- When source is genuinely too thin for a real bullet, use one bullet: "[NEEDS DETAIL: <what's missing>]" rather than a fabricated specific.

WHAT TO AVOID:
- Mid-sentence fragments yanked from PDFs ("the work scope on contract.")
- Glossary-list dumps ("SRB Service Registry Board SPID Security Plan...")
- Restatements of obvious facts ("The Government typically must manage...")
- Generic filler ("All applicable FAR clauses", "Per the solicitation")
- Invented standards (MIL-STD-498, ISO 9001 for software, Buy American for services)

AUDIENCE:
- The sub is quoting parts/services TO THE PRIME, not bidding on the federal contract.
- Don't mention SAM.gov registration, federal response deadlines, SF-1449 forms, or anything procedural between the prime and the government.
- The ONE deadline that matters: quote-to-prime deadline ${quoteDeadline}.

AGENCY TONE (voice only, doesn't authorize inventing facts):
${agencyToneGuidance}

OPPORTUNITY DETAILS:
${contextBlock}${parsedBlock}

DELIVERABLES GUIDANCE:
${deliverablesGuidance}

OUTPUT FORMAT — exactly this JSON shape:
{
  "sections": [
    {
      "title": "1.0 Program Overview",
      "summary": "one-line headline, ≤80 chars",
      "overview": "narrative paragraph, 2–4 sentences, synthesizing what this section means for the sub",
      "bullets": ["concrete fact 1", "concrete fact 2", "concrete fact 3"]
    },
    ... 5 more sections
  ]
}

Generate exactly 6 sections in this order:

1. **1.0 Program Overview** — Narrative: what is this contract, who is the customer, what's their mission, why does it exist. Bullets: program/system name, end customer, contract type if known, base period if known, scale indicators (multi-year, AWS migration, etc.).

2. **2.0 What We Need From You** — Narrative: what the prime needs the sub to supply, in plain language. Bullets: concrete supply items / services / specs the sub would provide.

3. **3.0 Place of Performance & Travel** — Narrative: where work happens (on-site/remote/hybrid), security context, any travel expectations. Bullets: specific locations from source, on-site requirements, travel cadence if stated.

4. **4.0 Critical Requirements** — Narrative: the gate-keeper requirements that determine if a sub even qualifies. Bullets: security clearance level (if stated), required certifications (CMMC level, ISO, etc., only if in source), required past performance domain, key technical standards.

5. **5.0 Deliverables** — Narrative: what the sub produces and how it integrates with the prime's deliverables to the government. Bullets: specific deliverable items with format/frequency if stated.

6. **6.0 Quote Submission** — Narrative: what the prime needs back from the sub, by when, and why. Bullets: standard quote-content checklist (firm fixed price, lead time, exceptions, capability statement, POC).

Return ONLY valid JSON in the shape above. No markdown, no explanation.`

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
    // Accept three shapes the model has been observed to produce:
    //   1. { sections: [s1, s2, ...] }  (the requested shape)
    //   2. [s1, s2, ...]                (bare array)
    //   3. { title, summary, bullets } (a single section — model collapses when
    //      it thinks there's not enough source. We treat this as an AI failure
    //      since we asked for 6 sections.)
    let sections: SOWSection[]
    if (Array.isArray(parsed)) {
      sections = parsed
    } else if (Array.isArray(parsed.sections)) {
      sections = parsed.sections
    } else if (parsed.title && Array.isArray(parsed.bullets)) {
      // Single-section response — AI gave up. Treat as failure so caller
      // falls back to rule-based builders, which at least produce 6 sections.
      throw new Error(`AI collapsed to single section (likely thin-input refusal): ${parsed.title}`)
    } else {
      throw new Error(`Unexpected JSON shape: ${raw.slice(0, 150)}`)
    }

    if (!sections.length) {
      throw new Error('OpenAI returned empty sections array')
    }

    // Normalize: ensure each section has overview (prefer new field, fall
    // back to legacy details). Stored SOWs may go through this path again.
    return sections.map((s) => ({
      ...s,
      overview: s.overview || s.details || '',
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
    }))
  } catch (parseErr) {
    if (parseErr instanceof Error && parseErr.message.startsWith('AI collapsed')) {
      throw parseErr
    }
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
