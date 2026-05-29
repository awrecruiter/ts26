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
  responseDeadline: string
  postedDate?: string | null
  placeOfPerformance: string
  pointOfContact?: string | null
  description?: string | null
  parsedScope?: string[]
  parsedDeliverables?: string[]
  parsedCompliance?: string[]
  parsedPeriodOfPerformance?: string[]
  subcontractorName?: string | null
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
    responseDeadline,
    postedDate,
    placeOfPerformance,
    pointOfContact,
    description,
    parsedScope,
    parsedDeliverables,
    parsedCompliance,
    parsedPeriodOfPerformance,
    subcontractorName,
  } = input

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

  // Agency-specific tone and deliverable guidance
  let agencyToneGuidance: string
  let deliverablesGuidance: string

  if (isDoD) {
    agencyToneGuidance = `This is a Department of Defense (DoD) contract. Use DoD acquisition language where appropriate: reference MIL-SPEC/MIL-STD standards if relevant, use terms like "Government-Furnished Equipment (GFE)", "Contracting Officer Representative (COR)", "Quality Assurance Surveillance Plan (QASP)", and "Contract Data Requirements List (CDRL)". Tone should be formal, precise, and compliance-focused.`
    deliverablesGuidance = `Structure deliverables as Contract Data Requirements List (CDRL) items where applicable. Each deliverable should specify: the data item title, frequency (e.g., monthly, upon completion), submission format (electronic/hard copy), and recipient (COR or Contracting Officer). Use DoD-standard CDRL terminology where it applies.`
  } else if (isDHS) {
    agencyToneGuidance = `This is a Department of Homeland Security (DHS) contract. Reference DHS Acquisition Regulation (HSAR) requirements where applicable. Use terms like "Contracting Officer's Representative (COR)" and DHS security/clearance requirements if present. Tone should be security-conscious and operationally focused.`
    deliverablesGuidance = `Use milestone-based deliverables with specific due dates or offsets from period of performance start. Each deliverable should specify the name, format, submission method, and acceptance criteria. Reference any required DHS reporting templates or systems if mentioned in the solicitation.`
  } else if (isVA) {
    agencyToneGuidance = `This is a Department of Veterans Affairs (VA) contract. Reference VA Acquisition Regulation (VAAR) requirements where applicable. Use terms like "COR (Contracting Officer's Representative)" and note HIPAA compliance for any work involving Veteran data or healthcare. Tone should be Veteran-centered and compliance-focused.`
    deliverablesGuidance = `Use milestone-based deliverables. Highlight any deliverables involving Veteran data, PHI (Protected Health Information), or VA system access. Specify submission to COR with VA-required formats. Note HIPAA compliance requirements for any data deliverables.`
  } else if (isHealthAgency) {
    agencyToneGuidance = `This is a civilian health agency (HHS/NIH/CDC/FDA) contract. Reference Federal Acquisition Regulation (FAR) Part 12 or 15 as applicable. Use terms like "COR", "deliverables", and "milestone schedule" with relevant health or scientific terminology where warranted. Tone should be technically precise.`
    deliverablesGuidance = `Use milestone-based deliverables tied to the research or program schedule. Each deliverable should specify: name, format, submission date or frequency, and COR acceptance. Reference any required federal health data standards (HL7, FHIR, etc.) only if mentioned in the solicitation.`
  } else {
    agencyToneGuidance = `This is a civilian federal agency contract. Reference Federal Acquisition Regulation (FAR) requirements as applicable. Use terms like "Contracting Officer's Representative (COR)", "Performance Work Statement (PWS)", and "Quality Assurance Surveillance Plan (QASP)" where relevant. Tone should be professional, clear, and action-oriented for a small business subcontractor.`
    deliverablesGuidance = `Use milestone-based deliverables with specific due dates or offsets from period of performance start. Each deliverable should specify the name, format, submission method, and acceptance criteria. Avoid DoD-specific acronyms like CDRLs — use plain milestone language instead.`
  }

  const contextBlock = [
    `Solicitation Number: ${solicitationNumber}`,
    `Title: ${title}`,
    `Issuing Agency: ${agency}`,
    naicsCode ? `NAICS Code: ${naicsCode}` : null,
    setAside ? `Set-Aside: ${setAside}` : null,
    `Response Deadline: ${responseDeadline}`,
    postedDate ? `Posted: ${postedDate}` : null,
    `Place of Performance: ${placeOfPerformance}`,
    pointOfContact ? `Point of Contact: ${pointOfContact}` : null,
    subcontractorName ? `Subcontractor: ${subcontractorName}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const parsedBlock = hasParsed
    ? `\n\nPARSED SOLICITATION CONTENT:\n` +
      (parsedScope?.length ? `Scope:\n${parsedScope.slice(0, 5).join('\n')}\n` : '') +
      (parsedDeliverables?.length ? `Deliverables:\n${parsedDeliverables.slice(0, 5).join('\n')}\n` : '') +
      (parsedCompliance?.length ? `Compliance:\n${parsedCompliance.slice(0, 5).join('\n')}\n` : '') +
      (parsedPeriodOfPerformance?.length ? `Period of Performance:\n${parsedPeriodOfPerformance.slice(0, 3).join('\n')}\n` : '')
    : description
    ? `\n\nSOLICITATION DESCRIPTION:\n${description.slice(0, 3000)}`
    : ''

  const prompt = `You are writing a Statement of Work (SOW) for a prime contractor to send to a subcontractor. Write in plain, direct language a small business owner can act on — no jargon, no padding, no boilerplate.

AGENCY CONTEXT:
${agencyToneGuidance}

OPPORTUNITY DETAILS:
${contextBlock}${parsedBlock}

DELIVERABLES GUIDANCE:
${deliverablesGuidance}

Generate exactly 6 SOW sections in JSON. Each section must have:
- "title": short heading (e.g. "1.0 Background")
- "summary": one plain sentence — what this section covers (max 100 chars)
- "bullets": 3–5 specific, actionable bullet points drawn directly from this solicitation's data. Apply agency-appropriate terminology per the AGENCY CONTEXT above.
- "details": 1–2 short paragraphs of plain prose. Every sentence must be specific to this solicitation. Omit anything unknown — never invent filler. Apply agency-appropriate tone from the AGENCY CONTEXT above.

Sections:
1. 1.0 Background — what this contract is, who issued it (include the specific agency name), why it exists, and its role in the agency's mission
2. 2.0 Scope of Work — precisely what the subcontractor must do, referencing specific requirements from the solicitation
3. 3.0 Place of Performance — where work happens, including any remote/on-site split and travel requirements if stated
4. 4.0 Period of Performance — start/end dates, key milestones, and the response deadline of ${responseDeadline}
5. 5.0 Deliverables — concrete outputs following the DELIVERABLES GUIDANCE above; be specific to this solicitation
6. 6.0 Compliance — only the specific regulatory and certification requirements that apply to this agency and NAICS code; do not list generic FAR clauses unless they appear in the solicitation data

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

  const prompt = `You are analyzing federal government solicitation attachments. For each attachment, suggest a human-readable name and detect if it is a standard government form.

ATTACHMENTS:
${attachmentList}

For each attachment, return a JSON object with:
- "id": the attachment ID (exact match, do not change)
- "suggestedName": A clear, human-readable filename in Title Case that someone could understand at a glance (e.g. "Statement of Work.pdf", "SF-1449 Solicitation Form.pdf", "Wage Determination WD-2024-0001.pdf", "Technical Requirements Section L.pdf"). Keep the original file extension. Return null ONLY if the original name is already a full plain-English title with spaces (e.g. "Performance Work Statement.pdf"). ALWAYS suggest a better name for contract numbers, codes, or vague names like "Attachment_A.pdf", "document1.pdf", "W912BV24R0003_0001.pdf", "J0002.pdf".
- "confidence": "HIGH" (confident based on document content), "MEDIUM" (reasonable guess from filename or partial content), or "LOW" (limited information)
- "isForm": true if this is a standard government form (SF-1449, SF-33, SF-26, SF-30, DD-1155, DD-254, OF-347, wage determination, etc.), false otherwise
- "formType": the form identifier if isForm is true (e.g. "SF-1449"), null otherwise

Rules:
- Do NOT change file extensions
- Contract numbers, UUIDs, codes (e.g. "W912BV24R0003_0001.pdf", "J0002.pdf") are NOT descriptive — always suggest a better name
- Vague names like "Attachment_A", "Exhibit_1", "Section_L_M" should get clearer names based on content
- For forms, always include the form number in the suggestedName
- Return a JSON object with key "results" containing an array of ${attachments.length} objects

Return ONLY valid JSON. No markdown, no extra text.`

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
