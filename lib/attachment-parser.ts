/**
 * Attachment parser for SAM.gov solicitation documents (PDF, DOCX).
 * Downloads attachments from SAM.gov URLs (which 303 redirect to S3),
 * extracts text content, and identifies structured solicitation data.
 */

import pdfParse from 'pdf-parse/lib/pdf-parse'
import mammoth from 'mammoth'
import { SamAttachment } from './samgov'

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
  }

  if (!text || text.length < 50) return content

  // Split into lines for section-based extraction
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  // Section header patterns (case-insensitive)
  const sectionPatterns: { key: keyof StructuredContent; patterns: RegExp[] }[] = [
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

  // Walk through lines and extract sections
  let currentSection: keyof StructuredContent | null = null
  let sectionBuffer: string[] = []
  let linesSinceHeader = 0
  const MAX_SECTION_LINES = 80

  for (const line of lines) {
    // Check if this line starts a new section
    let matchedSection: keyof StructuredContent | null = null
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
  }

  for (const att of parsedAttachments) {
    if (!att.text) continue
    const structured = extractStructuredContent(att.text)
    for (const key of Object.keys(merged) as (keyof StructuredContent)[]) {
      merged[key].push(...structured[key])
    }
  }

  return merged
}
