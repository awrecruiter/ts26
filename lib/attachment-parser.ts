/**
 * Attachment parser for SAM.gov solicitation documents (PDF, DOCX).
 * Downloads attachments from SAM.gov URLs (which 303 redirect to S3),
 * extracts text content, and identifies structured solicitation data.
 */

import mammoth from 'mammoth'
import { SamAttachment } from './samgov'

// Import the core parser directly (no test-file wrapper) for serverless compatibility.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> =
  require('pdf-parse/lib/pdf-parse')

export interface ParsedAttachment {
  name: string
  url: string
  text: string
  pageCount?: number
  error?: string
}

export interface StructuredContent {
  scope: string[]
  deliverables: string[]
  compliance: string[]
  periodOfPerformance: string[]
  qualifications: string[]
  evaluation: string[]
  /** Targeted, high-signal facts extracted from the full text: clearance
   *  levels, certifications (CMMC/FedRAMP/NIST), specific FAR/DFARS clauses,
   *  and place-of-performance locations. Surfaces these so the SOW generator
   *  can use them even when no section header explicitly groups them. */
  keyFacts: {
    clearances: string[]
    certifications: string[]
    farClauses: string[]
    locations: string[]
    contractTypes: string[]
  }
}

/**
 * Download a file from a SAM.gov attachment URL.
 * SAM.gov resource links return a 303 redirect to an S3 pre-signed URL.
 */
export async function downloadAttachment(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'USHER-SOW-Generator/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Extract text from a PDF buffer.
 */
export async function parsePDF(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const data = await pdfParse(buffer)
  return {
    text: data.text.trim(),
    pages: data.numpages,
  }
}

/**
 * Extract text from a DOCX buffer.
 */
export async function parseDOCX(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim()
}

/**
 * Parse a single attachment by downloading and extracting text.
 * Dispatches to the correct parser based on file extension.
 */
export async function parseAttachment(url: string, filename: string): Promise<ParsedAttachment> {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const cleanExt = ext.split('?')[0] // Remove query params from extension

  if (!['pdf', 'docx', 'doc'].includes(cleanExt)) {
    return {
      name: filename,
      url,
      text: '',
      error: `Unsupported file type: .${cleanExt}`,
    }
  }

  try {
    const buffer = await downloadAttachment(url)

    if (cleanExt === 'pdf') {
      const { text, pages } = await parsePDF(buffer)
      return { name: filename, url, text, pageCount: pages }
    }

    if (cleanExt === 'docx' || cleanExt === 'doc') {
      const text = await parseDOCX(buffer)
      return { name: filename, url, text }
    }

    return { name: filename, url, text: '', error: 'Unknown parser' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Failed to parse attachment "${filename}":`, message)
    return { name: filename, url, text: '', error: message }
  }
}

/**
 * Parse all attachments from a SAM.gov opportunity.
 * Skips unsupported types and continues on individual failures.
 */
export async function parseAllAttachments(
  attachments: SamAttachment[]
): Promise<ParsedAttachment[]> {
  const parseable = attachments.filter((att) => {
    const ext = att.name.split('.').pop()?.toLowerCase().split('?')[0] || ''
    return ['pdf', 'docx', 'doc'].includes(ext)
  })

  if (parseable.length === 0) {
    return []
  }

  const results = await Promise.allSettled(
    parseable.map((att) => parseAttachment(att.url, att.name))
  )

  return results.map((result, idx) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    return {
      name: parseable[idx].name,
      url: parseable[idx].url,
      text: '',
      error: result.reason?.message || 'Parse failed',
    }
  })
}

/**
 * Targeted-fact extraction from the full attachment text.
 * Scans for high-signal patterns that subs use to triage opportunities:
 * security clearance, certifications/compliance frameworks, named FAR/DFARS
 * clauses, place-of-performance, and contract type. Returns short, deduped,
 * normalized strings the SOW generator can drop directly into bullets.
 */
export function extractKeyFacts(text: string): StructuredContent['keyFacts'] {
  const facts: StructuredContent['keyFacts'] = {
    clearances: [],
    certifications: [],
    farClauses: [],
    locations: [],
    contractTypes: [],
  }
  if (!text) return facts
  const collapsed = text.replace(/\s+/g, ' ')

  // --- Clearance levels ---------------------------------------------------
  const clearancePatterns: Array<{ re: RegExp; label: string }> = [
    { re: /\b(top\s*secret\s*\/\s*sci|ts\/sci|ts-sci)\b/i, label: 'Top Secret / SCI' },
    { re: /\btop\s+secret\b/i, label: 'Top Secret' },
    { re: /\b(secret\s+clearance|secret-level|active\s+secret)\b/i, label: 'Secret' },
    { re: /\bconfidential\s+clearance\b/i, label: 'Confidential' },
    { re: /\bpublic\s+trust\b/i, label: 'Public Trust' },
    { re: /\bposition\s+of\s+(public\s+)?trust\b/i, label: 'Position of Trust' },
    { re: /\bIT\s*-?\s*I\b/i, label: 'IT-I (Privileged)' },
    { re: /\bIT\s*-?\s*II\b/i, label: 'IT-II (Limited Privileged)' },
  ]
  for (const { re, label } of clearancePatterns) {
    if (re.test(collapsed) && !facts.clearances.includes(label)) {
      facts.clearances.push(label)
    }
  }
  // Dedupe subset clearances: "TS/SCI" implies "Top Secret"; if both
  // match, keep only the more specific one.
  if (facts.clearances.includes('Top Secret / SCI')) {
    facts.clearances = facts.clearances.filter((c) => c !== 'Top Secret')
  }

  // --- Certifications / Compliance frameworks ----------------------------
  const certPatterns: Array<{ re: RegExp; label: string }> = [
    { re: /\bCMMC\s+(Level\s+)?(1|2|3|I|II|III)\b/i, label: 'CMMC' },
    { re: /\bFedRAMP\s+(High|Moderate|Low|Tailored)\b/i, label: 'FedRAMP' },
    { re: /\bFedRAMP\b/i, label: 'FedRAMP' },
    { re: /\bNIST\s+(SP\s+)?800-?171\b/i, label: 'NIST SP 800-171' },
    { re: /\bNIST\s+(SP\s+)?800-?53\b/i, label: 'NIST SP 800-53' },
    { re: /\bFISMA\b/i, label: 'FISMA' },
    { re: /\bHIPAA\b/i, label: 'HIPAA' },
    { re: /\bISO[\s-]?9001\b/i, label: 'ISO 9001' },
    { re: /\bISO[\s-]?27001\b/i, label: 'ISO 27001' },
    { re: /\bISO[\s-]?20000\b/i, label: 'ISO 20000' },
    { re: /\bIEEE\s+12207\b/i, label: 'IEEE 12207' },
    { re: /\bCMMI[\s-]?(Level\s+)?(3|4|5|III|IV|V)\b/i, label: 'CMMI' },
    { re: /\bSection\s+508\b/i, label: 'Section 508 (Accessibility)' },
  ]
  for (const { re, label } of certPatterns) {
    const match = collapsed.match(re)
    if (match) {
      // Use the actual matched text (preserves the level: e.g. "CMMC Level 2")
      const full = match[0].replace(/\s+/g, ' ').trim()
      // Dedupe by base label so we don't list "FedRAMP" + "FedRAMP Moderate"
      if (!facts.certifications.some((c) => c.toLowerCase().startsWith(label.toLowerCase().split(' ')[0]))) {
        facts.certifications.push(full.length <= 60 ? full : label)
      }
    }
  }

  // --- FAR / DFARS clauses (named, specific) -----------------------------
  // FAR clauses look like 52.XXX-X or 52.XXX-XX
  // DFARS clauses look like 252.XXX-XXXX
  const farRe = /\b(?:FAR\s+)?52\.\d{3}-\d{1,2}(?:\([a-z]\))?\b/gi
  const dfarsRe = /\b(?:DFARS\s+)?252\.\d{3}-\d{4}\b/gi
  const seenClauses = new Set<string>()
  for (const re of [farRe, dfarsRe]) {
    const matches = collapsed.matchAll(re)
    for (const m of matches) {
      const clause = m[0].replace(/^(FAR|DFARS)\s+/i, '').trim()
      const key = clause.toLowerCase()
      if (!seenClauses.has(key) && facts.farClauses.length < 8) {
        seenClauses.add(key)
        facts.farClauses.push(clause)
      }
    }
  }

  // --- Locations (place of performance) ----------------------------------
  // "Springfield, VA", "St. Louis, MO 63101", "Washington, DC", "Fort Belvoir"
  const cityStateRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s+[A-Z]\.[a-z]+)?),\s+([A-Z]{2})\b(?:\s+\d{5})?/g
  const fortRe = /\b(Fort\s+[A-Z][a-z]+|Joint\s+Base\s+[A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*|Naval\s+(?:Base|Station|Air\s+Station)\s+[A-Z][a-z]+|Camp\s+[A-Z][a-z]+|Andrews\s+AFB|Wright-Patterson\s+AFB)\b/g
  // Common federal-facility name patterns. We capture and dedupe.
  const seenLocations = new Set<string>()
  // Skip obvious non-location matches that fit the pattern (months, "Software, IL" type collisions)
  const cityBlocklist = /^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Section|Article|Chapter|Annex|Appendix|Table|Figure|Schedule|Page|Volume|Part|Subpart|Department|Subject|Title|Notice|Reference|Block|Column|Form|Subject|Standard)$/i
  for (const m of collapsed.matchAll(cityStateRe)) {
    const city = m[1].trim()
    const state = m[2].trim()
    if (cityBlocklist.test(city)) continue
    const loc = `${city}, ${state}`
    if (!seenLocations.has(loc.toLowerCase()) && facts.locations.length < 5) {
      seenLocations.add(loc.toLowerCase())
      facts.locations.push(loc)
    }
  }
  for (const m of collapsed.matchAll(fortRe)) {
    const loc = m[0].trim()
    if (!seenLocations.has(loc.toLowerCase()) && facts.locations.length < 5) {
      seenLocations.add(loc.toLowerCase())
      facts.locations.push(loc)
    }
  }

  // --- Contract types ----------------------------------------------------
  const contractTypePatterns: Array<{ re: RegExp; label: string }> = [
    { re: /\bfirm[\s-]?fixed[\s-]?price\b|\bFFP\b/i, label: 'Firm Fixed Price (FFP)' },
    { re: /\btime[\s-]?and[\s-]?materials?\b|\bT&M\b/i, label: 'Time & Materials (T&M)' },
    { re: /\bcost[\s-]?plus[\s-]?fixed[\s-]?fee\b|\bCPFF\b/i, label: 'Cost Plus Fixed Fee (CPFF)' },
    { re: /\bcost[\s-]?plus[\s-]?award[\s-]?fee\b|\bCPAF\b/i, label: 'Cost Plus Award Fee (CPAF)' },
    { re: /\bcost[\s-]?plus[\s-]?incentive[\s-]?fee\b|\bCPIF\b/i, label: 'Cost Plus Incentive Fee (CPIF)' },
    { re: /\bIDIQ\b|\bindefinite[\s-]?delivery[\s-]?indefinite[\s-]?quantity\b/i, label: 'IDIQ' },
    { re: /\bBPA\b|\bblanket\s+purchase\s+agreement\b/i, label: 'BPA' },
    { re: /\blabor[\s-]?hour\b/i, label: 'Labor Hour' },
  ]
  for (const { re, label } of contractTypePatterns) {
    if (re.test(collapsed) && !facts.contractTypes.includes(label)) {
      facts.contractTypes.push(label)
    }
  }

  return facts
}

/**
 * Extract structured content from raw parsed text using keyword/section matching.
 * Looks for common government solicitation section headers and extracts content.
 */
export function extractStructuredContent(text: string): StructuredContent {
  const content: StructuredContent = {
    scope: [],
    deliverables: [],
    compliance: [],
    periodOfPerformance: [],
    qualifications: [],
    evaluation: [],
    keyFacts: extractKeyFacts(text),
  }

  if (!text || text.length < 50) return content

  // Split into lines for section-based extraction
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  // Section header patterns (case-insensitive)
  type SectionKey = 'scope' | 'deliverables' | 'compliance' | 'periodOfPerformance' | 'qualifications' | 'evaluation'
  const sectionPatterns: { key: SectionKey; patterns: RegExp[] }[] = [
    {
      key: 'scope',
      patterns: [
        /scope\s+of\s+(work|services|effort)/i,
        /statement\s+of\s+work/i,
        /description\s+of\s+(work|services|requirements)/i,
        /technical\s+requirements/i,
        /performance\s+work\s+statement/i,
        /task\s+requirements/i,
      ],
    },
    {
      key: 'deliverables',
      patterns: [
        /deliverables?/i,
        /delivery\s+schedule/i,
        /contract\s+deliverables/i,
        /required\s+deliverables/i,
        /work\s+products/i,
      ],
    },
    {
      key: 'compliance',
      patterns: [
        /compliance\s+requirements/i,
        /regulatory\s+requirements/i,
        /applicable\s+(laws|regulations|standards)/i,
        /far\s+clauses/i,
        /terms\s+and\s+conditions/i,
        /security\s+requirements/i,
        /clearance\s+requirements/i,
      ],
    },
    {
      key: 'periodOfPerformance',
      patterns: [
        /period\s+of\s+performance/i,
        /contract\s+(period|duration|term)/i,
        /base\s+(year|period)/i,
        /option\s+(year|period)/i,
        /performance\s+period/i,
      ],
    },
    {
      key: 'qualifications',
      patterns: [
        /qualifications?/i,
        /minimum\s+requirements/i,
        /contractor\s+(qualifications|requirements)/i,
        /experience\s+requirements/i,
        /personnel\s+requirements/i,
        /key\s+personnel/i,
      ],
    },
    {
      key: 'evaluation',
      patterns: [
        /evaluation\s+(criteria|factors)/i,
        /source\s+selection/i,
        /award\s+(criteria|factors)/i,
        /basis\s+for\s+award/i,
        /proposal\s+evaluation/i,
      ],
    },
  ]

  // Walk through lines and extract sections. Limited to the array-valued
  // keys; keyFacts is populated separately via extractKeyFacts.
  let currentSection: SectionKey | null = null
  let sectionBuffer: string[] = []
  let linesSinceHeader = 0
  const MAX_SECTION_LINES = 80

  for (const line of lines) {
    // Check if this line starts a new section
    let matchedSection: SectionKey | null = null
    for (const { key, patterns } of sectionPatterns) {
      if (patterns.some((p) => p.test(line))) {
        matchedSection = key
        break
      }
    }

    if (matchedSection) {
      // Save previous section content
      if (currentSection && sectionBuffer.length > 0) {
        content[currentSection].push(sectionBuffer.join('\n'))
      }
      currentSection = matchedSection
      sectionBuffer = []
      linesSinceHeader = 0
      continue
    }

    if (currentSection) {
      linesSinceHeader++
      // Stop collecting if we've gone too far (next section probably started)
      if (linesSinceHeader > MAX_SECTION_LINES) {
        content[currentSection].push(sectionBuffer.join('\n'))
        currentSection = null
        sectionBuffer = []
        continue
      }
      sectionBuffer.push(line)
    }
  }

  // Flush last section
  if (currentSection && sectionBuffer.length > 0) {
    content[currentSection].push(sectionBuffer.join('\n'))
  }

  return content
}

/**
 * Combine structured content from multiple parsed attachments into a single view.
 */
export function mergeStructuredContent(
  parsedAttachments: ParsedAttachment[]
): StructuredContent {
  const merged: StructuredContent = {
    scope: [],
    deliverables: [],
    compliance: [],
    periodOfPerformance: [],
    qualifications: [],
    evaluation: [],
    keyFacts: {
      clearances: [],
      certifications: [],
      farClauses: [],
      locations: [],
      contractTypes: [],
    },
  }

  for (const att of parsedAttachments) {
    if (!att.text) continue
    const structured = extractStructuredContent(att.text)
    // Section arrays
    for (const key of ['scope', 'deliverables', 'compliance', 'periodOfPerformance', 'qualifications', 'evaluation'] as const) {
      merged[key].push(...structured[key])
    }
    // Key facts — dedupe per category as we accumulate across attachments
    for (const key of Object.keys(merged.keyFacts) as Array<keyof StructuredContent['keyFacts']>) {
      for (const item of structured.keyFacts[key]) {
        if (!merged.keyFacts[key].some((existing) => existing.toLowerCase() === item.toLowerCase())) {
          merged.keyFacts[key].push(item)
        }
      }
    }
  }

  return merged
}
