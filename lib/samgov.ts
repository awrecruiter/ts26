/**
 * SAM.gov API Client
 *
 * Fetches opportunity details, attachments, and descriptions from SAM.gov
 */

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2'
const SAM_API_KEY = process.env.SAM_GOV_API_KEY || ''

export interface SamAttachment {
  id: string
  name: string
  description?: string
  url: string
  type?: string
  size?: number
  postedDate?: string
}

export interface SamOpportunityDetails {
  solicitationNumber: string
  title: string
  description?: string
  attachments: SamAttachment[]
  resourceLinks: SamAttachment[]
}

/**
 * Extract a human-readable filename from a SAM.gov resource download URL.
 * These URLs redirect to S3 with filenames encoded in the query string.
 */
function extractFilenameFromUrl(url: string): string | null {
  try {
    // Try to extract from response-content-disposition parameter
    // (present in S3 redirect URLs after following the 303)
    const match = url.match(/filename[=]([^&]+)/i)
    if (match) {
      return decodeURIComponent(match[1]).replace(/\+/g, ' ')
    }
    // Otherwise try the last path segment
    const urlObj = new URL(url)
    const segments = urlObj.pathname.split('/')
    const last = segments[segments.length - 1]
    if (last && last !== 'download') {
      return decodeURIComponent(last)
    }
  } catch {}
  return null
}

/**
 * SAM.gov resource URLs don't expose the original filename — they 303-redirect
 * to S3 with a Content-Disposition header carrying the real name. This follows
 * the redirect (HEAD request) and pulls the filename out of that header.
 *
 * Caches in-process to avoid repeating the round-trip for the same URL.
 */
const filenameCache = new Map<string, string | null>()

export async function resolveSamFilename(url: string): Promise<string | null> {
  if (filenameCache.has(url)) return filenameCache.get(url)!
  if (!url.startsWith('http')) {
    filenameCache.set(url, null)
    return null
  }
  // Append API key to SAM.gov resource URLs so the auth check passes
  let targetUrl = url
  if (url.includes('sam.gov/api') && SAM_API_KEY) {
    const u = new URL(url)
    if (!u.searchParams.has('api_key')) u.searchParams.set('api_key', SAM_API_KEY)
    targetUrl = u.toString()
  }
  try {
    // HEAD won't follow redirects with the filename — we need the GET response
    // headers from the final S3 URL. fetch follows redirects by default and
    // exposes the final response's headers.
    const res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { Range: 'bytes=0-0' }, // ask for 1 byte so we get headers cheaply
    })
    const cd = res.headers.get('content-disposition') || ''
    // RFC 5987 filename*= takes precedence, then plain filename=
    let name: string | null = null
    const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
    if (star) {
      try { name = decodeURIComponent(star[1].replace(/^"|"$/g, '')) } catch {}
    }
    if (!name) {
      const plain = cd.match(/filename="?([^";]+)"?/i)
      if (plain) name = plain[1]
    }
    if (name) {
      // SAM.gov often returns percent-encoded names with + for spaces
      // (form-encoding). Normalize both.
      try {
        name = decodeURIComponent(name.replace(/\+/g, ' '))
      } catch {
        // If decoding throws (invalid escape), just convert + → space and keep
        // the rest as-is.
        name = name.replace(/\+/g, ' ')
      }
    }
    filenameCache.set(url, name)
    return name
  } catch {
    filenameCache.set(url, null)
    return null
  }
}

/**
 * Batch-resolve real filenames for attachments whose names look generic
 * (e.g. "Attachment 1"). Updates the SamAttachment[] in place, then dedupes
 * by resolved name (SAM.gov occasionally returns the same file twice via
 * different keys — once in resourceLinks, again in pointOfContact).
 */
export async function resolveSamAttachmentFilenames(
  attachments: SamAttachment[]
): Promise<SamAttachment[]> {
  const needsResolution = attachments.filter((a) => /^Attachment\s*\d+$/i.test(a.name) || /^Resource\s*\d+$/i.test(a.name) || !a.name.includes('.'))
  await Promise.all(
    needsResolution.map(async (a) => {
      const real = await resolveSamFilename(a.url)
      if (real) {
        a.name = real
        // Infer type from the now-real extension
        const ext = real.split('.').pop()?.toLowerCase()
        if (ext) a.type = ext
      }
    })
  )

  // Dedupe by lowercased name (preserve first occurrence).
  const seen = new Set<string>()
  const deduped: SamAttachment[] = []
  for (const att of attachments) {
    const key = att.name.toLowerCase().trim()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(att)
  }
  attachments.length = 0
  attachments.push(...deduped)
  return attachments
}

/**
 * Extract attachments from stored raw SAM.gov data.
 * Handles both the v2 API format (plain URL strings in resourceLinks)
 * and older object-based formats.
 */
export function extractAttachmentsFromRawData(rawData: any): SamAttachment[] {
  if (!rawData) return []

  const attachments: SamAttachment[] = []
  const seenUrls = new Set<string>()

  // 1. resourceLinks — SAM.gov v2 API returns these as plain URL strings
  if (Array.isArray(rawData.resourceLinks)) {
    rawData.resourceLinks.forEach((item: any, index: number) => {
      if (typeof item === 'string' && item.startsWith('http')) {
        if (seenUrls.has(item)) return
        seenUrls.add(item)
        const filename = extractFilenameFromUrl(item)
        attachments.push({
          id: `resource-${index}`,
          name: filename || `Attachment ${index + 1}`,
          url: item,
          type: inferFileType(filename || item),
        })
      } else if (typeof item === 'object' && item !== null) {
        const url = item.url || item.uri || item.href || item.link
        if (!url || seenUrls.has(url)) return
        seenUrls.add(url)
        attachments.push({
          id: item.id || `resource-${index}`,
          name: item.name || item.title || extractFilenameFromUrl(url) || `Attachment ${index + 1}`,
          description: item.description,
          url,
          type: item.mimeType || item.type || inferFileType(item.name || url),
          size: item.fileSize || item.size,
          postedDate: item.postedDate || item.date,
        })
      }
    })
  }

  // 2. additionalInfoLink — sometimes a single URL string
  if (rawData.additionalInfoLink && typeof rawData.additionalInfoLink === 'string') {
    const url = rawData.additionalInfoLink
    if (url.startsWith('http') && !seenUrls.has(url)) {
      seenUrls.add(url)
      attachments.push({
        id: 'additionalInfo',
        name: 'Additional Information',
        url,
      })
    }
  }

  // 3. Point of contact — sometimes has URLs in additional info
  if (rawData.pointOfContact) {
    const pocs = Array.isArray(rawData.pointOfContact)
      ? rawData.pointOfContact
      : [rawData.pointOfContact]

    pocs.forEach((contact: any) => {
      if (contact.additionalInfo?.content) {
        const urlMatches = contact.additionalInfo.content.match(
          /https?:\/\/[^\s<>"']+/g
        )
        urlMatches?.forEach((url: string, idx: number) => {
          if (!seenUrls.has(url)) {
            seenUrls.add(url)
            attachments.push({
              id: `poc-link-${idx}`,
              name: extractFilenameFromUrl(url) || `Resource ${idx + 1}`,
              url,
            })
          }
        })
      }
    })
  }

  return attachments
}

/**
 * Fetch the actual description HTML from SAM.gov's noticedesc endpoint.
 * The v2 search API returns a URL instead of inline description text.
 */
export async function fetchNoticeDescription(descriptionUrl: string): Promise<string> {
  if (!descriptionUrl || !descriptionUrl.startsWith('http')) {
    return descriptionUrl || ''
  }

  try {
    // Append API key if not already present
    const url = new URL(descriptionUrl)
    if (!url.searchParams.has('api_key') && SAM_API_KEY) {
      url.searchParams.set('api_key', SAM_API_KEY)
    }

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      console.warn(`Failed to fetch notice description: ${response.status}`)
      return ''
    }

    const data = await response.json()

    // The API returns { description: "<html content>" }
    let html = data.description || data.content || ''

    // Strip HTML tags to get plain text
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<\/?(h[1-6]|div|section|article|header|footer|nav)[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#?\w+;/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return text
  } catch (error) {
    console.error('Failed to fetch notice description:', error)
    return ''
  }
}

/**
 * Fetch opportunity details directly from SAM.gov API
 */
export async function fetchOpportunityFromSam(
  solicitationNumber: string
): Promise<SamOpportunityDetails | null> {
  if (!SAM_API_KEY) {
    console.warn('SAM.gov API key not configured')
    return null
  }

  try {
    const response = await fetch(
      `${SAM_API_BASE}/search?solnum=${encodeURIComponent(solicitationNumber)}&api_key=${SAM_API_KEY}`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    )

    if (!response.ok) {
      console.error(`SAM.gov API error: ${response.status}`)
      return null
    }

    const data = await response.json()

    if (!data.opportunitiesData || data.opportunitiesData.length === 0) {
      return null
    }

    const opp = data.opportunitiesData[0]

    // Fetch the actual description if it's a URL
    let description = opp.description || ''
    if (typeof description === 'string' && description.startsWith('http')) {
      description = await fetchNoticeDescription(description)
    }

    return {
      solicitationNumber: opp.solicitationNumber,
      title: opp.title,
      description,
      attachments: extractAttachmentsFromRawData(opp),
      resourceLinks: opp.resourceLinks || [],
    }
  } catch (error) {
    console.error('Failed to fetch from SAM.gov:', error)
    return null
  }
}

/**
 * Fetch attachments for an opportunity (from DB rawData or fresh from SAM.gov)
 */
export async function getOpportunityAttachments(
  solicitationNumber: string,
  rawData?: any
): Promise<SamAttachment[]> {
  // First try to extract from stored raw data
  if (rawData) {
    const attachments = extractAttachmentsFromRawData(rawData)
    if (attachments.length > 0) {
      // Resolve placeholder names like "Attachment 1" to real filenames
      // pulled from SAM.gov's Content-Disposition header.
      await resolveSamAttachmentFilenames(attachments)
      return attachments
    }
  }

  // If no attachments found in raw data, try fetching fresh from SAM.gov
  const freshData = await fetchOpportunityFromSam(solicitationNumber)
  if (freshData) {
    await resolveSamAttachmentFilenames(freshData.attachments)
    return freshData.attachments
  }

  return []
}

/**
 * Build SAM.gov opportunity URL — prefer the uiLink from raw data
 */
export function getSamGovUrl(solicitationNumber: string, rawData?: any): string {
  if (rawData?.uiLink) {
    return rawData.uiLink
  }
  return `https://sam.gov/opp/${encodeURIComponent(solicitationNumber)}/view`
}

// ============ SAM.gov Entity Management API (Subcontractor Discovery) ============

const SAM_ENTITY_API_BASE = 'https://api.sam.gov/entity-information/v3/entities'
const SAM_ENTITY_API_KEY = process.env.SAM_GOV_ENTITY_API_KEY || SAM_API_KEY

export interface SamEntitySearchParams {
  naicsCode?: string
  stateCode?: string
  legalBusinessName?: string
  ueiNumber?: string
  registrationStatus?: string
  purposeOfRegistrationCode?: string
  pageSize?: number
}

export interface SamEntityPOC {
  firstName?: string
  lastName?: string
  middleInitial?: string
  title?: string
  emailAddress?: string
  phoneNumber?: string
  phoneExtension?: string
}

export interface SamEntity {
  entityRegistration?: {
    ueiSAM?: string
    legalBusinessName?: string
    registrationStatus?: string
    registrationDate?: string
    expirationDate?: string
    purposeOfRegistrationCode?: string
    cageCode?: string
    entityStartDate?: string
  }
  coreData?: {
    physicalAddress?: {
      addressLine1?: string
      addressLine2?: string
      city?: string
      stateOrProvinceCode?: string
      zipCode?: string
      countryCode?: string
      congressionalDistrict?: string
    }
    businessTypes?: {
      sbaBusinessTypeList?: Array<{
        sbaBusinessTypeCode?: string
        sbaBusinessTypeDesc?: string
      }>
      businessTypeList?: Array<{
        businessTypeCode?: string
        businessTypeDesc?: string
      }>
    }
    entityInformation?: {
      entityURL?: string
      phoneNumber?: string
    }
  }
  pointsOfContact?: {
    governmentBusinessPOC?: SamEntityPOC
    electronicBusinessPOC?: SamEntityPOC
    pastPerformancePOC?: SamEntityPOC
  }
}

export interface SamEntitySearchResult {
  totalRecords: number
  entityData: SamEntity[]
  error?: string
  errorType?: 'auth' | 'api' | 'network'
}

export async function searchSamEntities(
  params: SamEntitySearchParams
): Promise<SamEntitySearchResult> {
  if (!SAM_ENTITY_API_KEY) {
    console.warn('SAM.gov API key not configured')
    return { totalRecords: 0, entityData: [], error: 'SAM.gov API key not configured', errorType: 'auth' }
  }

  try {
    const url = new URL(SAM_ENTITY_API_BASE)
    url.searchParams.set('api_key', SAM_ENTITY_API_KEY)
    url.searchParams.set('registrationStatus', params.registrationStatus || 'A')
    url.searchParams.set('purposeOfRegistrationCode', params.purposeOfRegistrationCode || 'Z2')
    url.searchParams.set(
      'includeSections',
      'entityRegistration,coreData,pointsOfContact'
    )

    if (params.naicsCode) {
      url.searchParams.set('naicsCode', params.naicsCode)
    }
    if (params.stateCode) {
      // SAM.gov Entity API expects physicalAddressProvinceOrStateCode, not stateCode
      url.searchParams.set('physicalAddressProvinceOrStateCode', params.stateCode)
    }
    if (params.legalBusinessName) {
      url.searchParams.set('legalBusinessName', params.legalBusinessName)
    }
    if (params.ueiNumber) {
      url.searchParams.set('ueiSAM', params.ueiNumber)
    }

    const pageSize = params.pageSize || 10
    url.searchParams.set('page', '0')
    url.searchParams.set('size', String(pageSize))

    console.log(`Searching SAM.gov Entity API for NAICS=${params.naicsCode}, state=${params.stateCode}`)

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const msg = `SAM.gov Entity API auth error (${response.status}). The Entity Management API requires a separate FOUO API key (set SAM_GOV_ENTITY_API_KEY). Request one at https://sam.gov/content/entity-information`
        console.warn(msg)
        return { totalRecords: 0, entityData: [], error: msg, errorType: 'auth' }
      } else {
        const msg = `SAM.gov Entity API error: ${response.status}`
        console.error(msg)
        return { totalRecords: 0, entityData: [], error: msg, errorType: 'api' }
      }
    }

    const data = await response.json()

    return {
      totalRecords: data.totalRecords || 0,
      entityData: data.entityData || [],
    }
  } catch (error) {
    console.error('SAM.gov Entity API search failed:', error)
    return { totalRecords: 0, entityData: [], error: 'SAM.gov Entity API connection failed', errorType: 'network' }
  }
}

function pickBestPOC(entity: SamEntity): SamEntityPOC | null {
  const pocs = entity.pointsOfContact
  if (!pocs) return null
  return pocs.governmentBusinessPOC || pocs.electronicBusinessPOC || pocs.pastPerformancePOC || null
}

function formatPOCName(poc: SamEntityPOC): string {
  const parts = [poc.firstName, poc.middleInitial, poc.lastName].filter(Boolean)
  return parts.join(' ')
}

export function extractCertifications(entity: SamEntity): string[] {
  const certs: string[] = []
  const sbaTypes = entity.coreData?.businessTypes?.sbaBusinessTypeList || []
  const certMap: Record<string, string> = {
    'XX': '8(a)',
    'A6': 'HUBZone',
    '27': 'WOSB',
    'A2': 'SDVOSB',
    'A5': 'VOSB',
    '2X': 'EDWOSB',
  }

  for (const sba of sbaTypes) {
    const code = sba.sbaBusinessTypeCode || ''
    if (certMap[code]) {
      certs.push(certMap[code])
    } else if (sba.sbaBusinessTypeDesc) {
      certs.push(sba.sbaBusinessTypeDesc)
    }
  }

  return certs
}

export function samEntityToSubcontractor(
  entity: SamEntity,
  opportunityId: string
): Record<string, any> {
  const reg = entity.entityRegistration
  const core = entity.coreData
  const addr = core?.physicalAddress
  const poc = pickBestPOC(entity)

  const addressParts = [
    addr?.addressLine1,
    addr?.addressLine2,
    addr?.city,
    addr?.stateOrProvinceCode,
    addr?.zipCode,
  ].filter(Boolean)

  return {
    opportunityId,
    name: reg?.legalBusinessName || 'Unknown Entity',
    phone: core?.entityInformation?.phoneNumber || poc?.phoneNumber || null,
    email: poc?.emailAddress || null,
    website: core?.entityInformation?.entityURL || null,
    address: addressParts.join(', ') || null,
    verificationStatus: 'verified',
    verifiedAt: new Date(),
    verifiedBy: 'sam_gov',
    lastVerifiedAt: new Date(),
    confidenceLevel: 'high',
    contactName: poc ? formatPOCName(poc) : null,
    contactTitle: poc?.title || null,
    contactEmail: poc?.emailAddress || null,
    contactPhone: poc?.phoneNumber
      ? poc.phoneExtension
        ? `${poc.phoneNumber} x${poc.phoneExtension}`
        : poc.phoneNumber
      : null,
    ueiNumber: reg?.ueiSAM || null,
    samRegistrationStatus: reg?.registrationStatus || null,
    certifications: extractCertifications(entity),
    cageCode: reg?.cageCode || null,
    entityStartDate: reg?.entityStartDate || null,
    congressionalDistrict: addr?.congressionalDistrict || null,
    location: addr?.stateOrProvinceCode || null,
    source: 'sam_gov',
  }
}

/**
 * Infer file type from filename or URL
 */
function inferFileType(filenameOrUrl: string): string {
  const cleaned = filenameOrUrl.split('?')[0] // Remove query params
  const ext = cleaned.split('.').pop()?.toLowerCase()
  const typeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip',
    txt: 'text/plain',
    htm: 'text/html',
    html: 'text/html',
    csv: 'text/csv',
  }
  return typeMap[ext || ''] || 'application/octet-stream'
}
