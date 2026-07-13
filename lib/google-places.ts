/**
 * Google Places API client for subcontractor discovery
 * Port from Python: proposal-machine/src/google_places_client.py
 */

interface PlaceSearchResult {
  name: string
  address: string
  placeId: string
  types: string[]
  rating: number | null
  totalRatings: number | null
  /** Latitude from Places API geometry — used for distance computation */
  lat?: number | null
  /** Longitude from Places API geometry — used for distance computation */
  lng?: number | null
}

interface PlaceDetails {
  phone?: string
  website?: string
  businessStatus?: string
}

interface Subcontractor extends PlaceSearchResult, PlaceDetails {
  service?: string
  location?: string
  /** Straight-line distance in km from the place of performance. Null when POP
   * coordinates couldn't be determined (no geocode / no vendor geometry). */
  distanceKm?: number | null
}

/**
 * Industry metadata used to tighten Places search relevance.
 *
 * - `queries[]` — text-search phrases (as before)
 * - `googleType` — narrow Places `type=` parameter when one cleanly applies
 *   (`general_contractor`, `electrician`, etc.). Falls back to `establishment`.
 * - `typesAllow[]` — `place.types` tokens that count as in-industry. Result
 *   must contain at least one.
 * - `typesBlock[]` — `place.types` tokens that disqualify regardless. Unioned
 *   with the always-on `DEFAULT_BLOCK_TYPES` list.
 * - `nameKeywords[]` — explicit accept-tokens for the name-overlap check.
 *   Defaults to words derived from `queries[]` if omitted.
 */
interface IndustryMetadata {
  queries: string[]
  googleType?: string
  typesAllow?: string[]
  typesBlock?: string[]
  nameKeywords?: string[]
}

/**
 * Place types that are almost never a legitimate federal-contract subcontractor.
 * Unioned into every search's blocklist so a `restaurant` ranking high for
 * "Highway Construction in Anchorage" gets dropped before it reaches the UI.
 */
const DEFAULT_BLOCK_TYPES = [
  'restaurant', 'food', 'bar', 'cafe', 'meal_takeaway', 'meal_delivery',
  'lodging', 'campground', 'rv_park',
  'school', 'university', 'primary_school', 'secondary_school',
  'tourist_attraction', 'museum', 'park', 'amusement_park',
  'church', 'place_of_worship', 'cemetery',
  'beauty_salon', 'hair_care', 'spa', 'gym',
  'clothing_store', 'shoe_store', 'jewelry_store',
  'liquor_store', 'convenience_store',
]

const CONSTRUCTION_TYPES = ['general_contractor', 'contractor', 'roofing_contractor', 'plumber', 'electrician', 'painter']
const SUPPLIER_TYPES = ['hardware_store', 'home_goods_store', 'electronics_store', 'store']
const PRO_SERVICES_TYPES = ['lawyer', 'accounting', 'finance', 'insurance_agency', 'real_estate_agency', 'point_of_interest']

const NAICS_INDUSTRY_MAP: Record<string, IndustryMetadata> = {
  '236220': { queries: ['Commercial Construction', 'General Contractor'], googleType: 'general_contractor', typesAllow: CONSTRUCTION_TYPES },
  '237310': { queries: ['Highway Construction', 'Road Construction', 'Asphalt Paving Contractor'], googleType: 'general_contractor', typesAllow: [...CONSTRUCTION_TYPES, 'roofing_contractor'] },
  '238210': { queries: ['Electrical Contractor', 'Electrician'], googleType: 'electrician', typesAllow: ['electrician', ...CONSTRUCTION_TYPES] },
  '238220': { queries: ['Plumbing Contractor', 'HVAC Contractor'], googleType: 'plumber', typesAllow: ['plumber', ...CONSTRUCTION_TYPES] },
  '238910': { queries: ['Site Preparation Contractor', 'Excavating Contractor'], googleType: 'general_contractor', typesAllow: CONSTRUCTION_TYPES },
  '334210': { queries: ['Telephone Apparatus', 'Communications Equipment'], typesAllow: [...SUPPLIER_TYPES, 'electronics_store'] },
  '334220': { queries: ['Communications Equipment Repair', 'Electronics Repair', 'RF Electronics'], typesAllow: [...SUPPLIER_TYPES, 'electronics_store', 'electronics_repair'] },
  '334290': { queries: ['Communications Equipment', 'Electronic Components'], typesAllow: [...SUPPLIER_TYPES, 'electronics_store'] },
  '333120': { queries: ['Construction Equipment Dealer', 'Heavy Equipment Supplier'], typesAllow: [...SUPPLIER_TYPES, 'car_dealer'] },
  '333922': { queries: ['Material Handling Equipment', 'Conveyor Supplier'], typesAllow: SUPPLIER_TYPES },
  '339994': { queries: ['Broom Supplier', 'Brush Supplier', 'Industrial Sweeper Supplier', 'Janitorial Equipment Supplier'], typesAllow: SUPPLIER_TYPES },
  '423810': { queries: ['Construction Equipment Dealer', 'Heavy Equipment Supplier'], typesAllow: [...SUPPLIER_TYPES, 'car_dealer'] },
  '423830': { queries: ['Industrial Equipment Supplier', 'Industrial Machinery Supplier'], typesAllow: SUPPLIER_TYPES },
  '423840': { queries: ['Industrial Supplies', 'MRO Supplier'], typesAllow: SUPPLIER_TYPES },
  '334511': { queries: ['Radar Systems', 'Navigation Equipment'], typesAllow: [...SUPPLIER_TYPES, 'electronics_store'] },
  '334519': { queries: ['Measuring Instruments', 'Testing Equipment'], typesAllow: SUPPLIER_TYPES },
  '336411': { queries: ['Aircraft Manufacturing', 'Aerospace Contractor'], typesAllow: SUPPLIER_TYPES },
  '511210': { queries: ['Software Publisher', 'Software Development Company'], typesAllow: PRO_SERVICES_TYPES },
  '517311': { queries: ['Telecommunications', 'Network Services Provider'], typesAllow: PRO_SERVICES_TYPES },
  '518210': { queries: ['Data Processing', 'Cloud Services'], typesAllow: PRO_SERVICES_TYPES },
  '541310': { queries: ['Architectural Services', 'Architecture Firm'], typesAllow: PRO_SERVICES_TYPES },
  '541330': { queries: ['Engineering Services', 'Civil Engineering', 'Structural Engineering'], typesAllow: PRO_SERVICES_TYPES },
  '541380': { queries: ['Testing Laboratory', 'Inspection Services'], typesAllow: PRO_SERVICES_TYPES },
  '541511': { queries: ['Custom Software Development', 'Application Development'], typesAllow: PRO_SERVICES_TYPES },
  '541512': { queries: ['Computer Systems Design', 'IT Consulting', 'Software Development'], typesAllow: PRO_SERVICES_TYPES },
  '541513': { queries: ['Computer Facilities Management', 'IT Infrastructure'], typesAllow: PRO_SERVICES_TYPES },
  '541519': { queries: ['IT Services', 'Technology Consulting'], typesAllow: PRO_SERVICES_TYPES },
  '541611': { queries: ['Management Consulting', 'Business Consulting'], typesAllow: PRO_SERVICES_TYPES },
  '541612': { queries: ['Human Resources Consulting', 'HR Services'], typesAllow: PRO_SERVICES_TYPES },
  '541614': { queries: ['Logistics Consulting', 'Supply Chain Consulting'], typesAllow: PRO_SERVICES_TYPES },
  '541620': { queries: ['Environmental Consulting', 'Environmental Services'], typesAllow: PRO_SERVICES_TYPES },
  '541690': { queries: ['Scientific Consulting', 'Technical Consulting'], typesAllow: PRO_SERVICES_TYPES },
  '541715': { queries: ['Research and Development', 'R&D Services'], typesAllow: PRO_SERVICES_TYPES },
  '541990': { queries: ['Professional Services', 'Consulting Services'], typesAllow: PRO_SERVICES_TYPES },
  '561210': { queries: ['Facilities Support Services', 'Building Maintenance'], typesAllow: [...CONSTRUCTION_TYPES, 'point_of_interest'] },
  '561320': { queries: ['Temporary Staffing Agency', 'Staffing Services'], typesAllow: [...PRO_SERVICES_TYPES, 'employment_agency'] },
  '561612': { queries: ['Security Guard Services', 'Security Services'], typesAllow: PRO_SERVICES_TYPES, typesBlock: ['locksmith'] },
  '561720': { queries: ['Janitorial Services', 'Cleaning Services'], typesAllow: ['point_of_interest', 'general_contractor'] },
  '562910': { queries: ['Remediation Services', 'Environmental Cleanup'], typesAllow: [...CONSTRUCTION_TYPES, ...PRO_SERVICES_TYPES] },
  '611430': { queries: ['Professional Training', 'Training Services'], typesAllow: PRO_SERVICES_TYPES },
  '621999': { queries: ['Health Services', 'Medical Services'], typesAllow: ['health', 'doctor', 'hospital', 'point_of_interest'] },
  '811219': { queries: ['Electronics Repair', 'Equipment Maintenance'], typesAllow: ['electronics_store', 'point_of_interest'] },
}

/**
 * Title keyword → industry metadata. Lower bar than `NAICS_INDUSTRY_MAP` because
 * a single keyword fires regardless of NAICS — used as a supplementary signal.
 */
const TITLE_KEYWORD_MAP: Record<string, IndustryMetadata> = {
  'cybersecurity': { queries: ['Cybersecurity Services', 'Information Security'], typesAllow: PRO_SERVICES_TYPES },
  'security': { queries: ['Security Services', 'Security Consultant'], typesAllow: PRO_SERVICES_TYPES, typesBlock: ['locksmith'] },
  'construction': { queries: ['Construction Contractor', 'General Contractor'], googleType: 'general_contractor', typesAllow: CONSTRUCTION_TYPES },
  'maintenance': { queries: ['Maintenance Services', 'Facility Maintenance'], typesAllow: [...CONSTRUCTION_TYPES, 'point_of_interest'] },
  'repair': { queries: ['Equipment Repair', 'Maintenance Services'], typesAllow: [...CONSTRUCTION_TYPES, 'electronics_store', 'point_of_interest'] },
  'training': { queries: ['Training Services', 'Professional Training'], typesAllow: PRO_SERVICES_TYPES },
  'medical': { queries: ['Medical Services', 'Healthcare Services'], typesAllow: ['health', 'doctor', 'hospital'] },
  'health': { queries: ['Healthcare Services', 'Medical Supplies'], typesAllow: ['health', 'doctor', 'hospital'] },
  'software': { queries: ['Software Development', 'IT Services'], typesAllow: PRO_SERVICES_TYPES },
  'network': { queries: ['Network Services', 'Telecommunications'], typesAllow: PRO_SERVICES_TYPES },
  'cloud': { queries: ['Cloud Services', 'IT Infrastructure'], typesAllow: PRO_SERVICES_TYPES },
  'data': { queries: ['Data Services', 'IT Consulting'], typesAllow: PRO_SERVICES_TYPES },
  'logistics': { queries: ['Logistics Services', 'Supply Chain'], typesAllow: [...PRO_SERVICES_TYPES, 'moving_company'] },
  'transport': { queries: ['Transportation Services', 'Freight Services'], typesAllow: [...PRO_SERVICES_TYPES, 'moving_company', 'storage'] },
  'cleaning': { queries: ['Janitorial Services', 'Cleaning Services'], typesAllow: ['point_of_interest', 'general_contractor'] },
  'environmental': { queries: ['Environmental Services', 'Environmental Consulting'], typesAllow: [...CONSTRUCTION_TYPES, ...PRO_SERVICES_TYPES] },
  'engineering': { queries: ['Engineering Services', 'Engineering Firm'], typesAllow: PRO_SERVICES_TYPES },
  'consulting': { queries: ['Consulting Firm', 'Management Consulting'], typesAllow: PRO_SERVICES_TYPES },
  'staffing': { queries: ['Staffing Agency', 'Temporary Staffing'], typesAllow: [...PRO_SERVICES_TYPES, 'employment_agency'] },
  'electrical': { queries: ['Electrical Contractor', 'Electrician'], googleType: 'electrician', typesAllow: ['electrician', ...CONSTRUCTION_TYPES] },
  'plumbing': { queries: ['Plumbing Contractor', 'Plumber'], googleType: 'plumber', typesAllow: ['plumber', ...CONSTRUCTION_TYPES] },
  'hvac': { queries: ['HVAC Contractor', 'HVAC Services'], typesAllow: CONSTRUCTION_TYPES },
  'telecom': { queries: ['Telecommunications', 'Network Services'], typesAllow: PRO_SERVICES_TYPES },
  'research': { queries: ['Research Services', 'R&D Firm'], typesAllow: PRO_SERVICES_TYPES },
  'laboratory': { queries: ['Testing Laboratory', 'Lab Services'], typesAllow: PRO_SERVICES_TYPES },
  'inspection': { queries: ['Inspection Services', 'Quality Assurance'], typesAllow: PRO_SERVICES_TYPES },
  'architecture': { queries: ['Architectural Services', 'Architecture Firm'], typesAllow: PRO_SERVICES_TYPES },
  'survey': { queries: ['Surveying Services', 'Land Surveyor'], typesAllow: PRO_SERVICES_TYPES },
  'remediation': { queries: ['Environmental Remediation', 'Cleanup Services'], typesAllow: [...CONSTRUCTION_TYPES, ...PRO_SERVICES_TYPES] },
  'broom': { queries: ['Broom Supplier', 'Industrial Sweeper Supplier'], typesAllow: SUPPLIER_TYPES },
  'brush': { queries: ['Brush Supplier', 'Industrial Brush Manufacturer'], typesAllow: SUPPLIER_TYPES },
  'sweeper': { queries: ['Industrial Sweeper Supplier', 'Street Sweeper Dealer'], typesAllow: [...SUPPLIER_TYPES, 'car_dealer'] },
  'mop': { queries: ['Janitorial Equipment Supplier', 'Mop Supplier'], typesAllow: SUPPLIER_TYPES },
  'janitorial': { queries: ['Janitorial Equipment Supplier', 'Janitorial Supplies'], typesAllow: SUPPLIER_TYPES },
  'tractor': { queries: ['Tractor Dealer', 'Farm Equipment Dealer'], typesAllow: [...SUPPLIER_TYPES, 'car_dealer'] },
  'attachment': { queries: ['Tractor Implement Dealer', 'Equipment Attachment Supplier'], typesAllow: [...SUPPLIER_TYPES, 'car_dealer'] },
  'hydraulic': { queries: ['Hydraulic Equipment Dealer', 'Hydraulics Supplier'], typesAllow: SUPPLIER_TYPES },
}

const NAME_OVERLAP_STOPWORDS = new Set([
  'the', 'and', 'of', 'for', 'a', 'an', 'services', 'service', 'company', 'co',
  'inc', 'llc', 'corp', 'corporation', 'group', 'solutions', 'firm', 'usa', 'us',
])

function nameOverlapTokens(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !NAME_OVERLAP_STOPWORDS.has(t)),
  )
}

function nameHasOverlap(name: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true
  const nameTokens = nameOverlapTokens(name)
  if (nameTokens.size === 0) return false
  for (const kw of keywords) {
    for (const t of nameOverlapTokens(kw)) {
      if (nameTokens.has(t)) return true
    }
  }
  return false
}

// Full state names keyed by 2-letter code — used to match against formatted_address
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}

/**
 * Haversine formula — returns straight-line distance in kilometres between
 * two lat/lng coordinate pairs.
 */
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Geocode a place-of-performance string (e.g. "Anchorage, Alaska, USA") to
 * lat/lng using the Google Geocoding API. Returns null when the API is not
 * configured or the request fails — callers treat null as "distance unknown".
 */
export async function geocodePlaceOfPerformance(
  placeOfPerformance: string
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey || apiKey.includes('your_actual') || apiKey.includes('your_google')) {
    return null
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', placeOfPerformance)
    url.searchParams.set('key', apiKey)

    const res = await fetch(url.toString())
    const data = await res.json()

    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const { lat, lng } = data.results[0].geometry.location
      return { lat, lng }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Returns true when a Google formatted_address contains the given city name.
 * Case-insensitive substring match.
 */
function addressMatchesCity(address: string, city: string): boolean {
  return address.toLowerCase().includes(city.toLowerCase())
}

/**
 * Returns true when a Google formatted_address belongs to the given state.
 * Google addresses look like: "123 Main St, Anchorage, AK 99501, USA"
 * We match the 2-letter state code as a word boundary to avoid false hits
 * (e.g. "MA" in "Omaha" or "IN" in "Indiana").
 */
function addressMatchesState(address: string, stateCode: string): boolean {
  const code = stateCode.toUpperCase()
  const name = STATE_NAMES[code]
  // Match ", AK " or ", AK," — the code appears between comma+space and space/comma
  const codeRegex = new RegExp(`,\\s+${code}(?:\\s|,)`)
  if (codeRegex.test(address)) return true
  if (name && address.toLowerCase().includes(name.toLowerCase())) return true
  return false
}

interface SearchBusinessesResult {
  results: PlaceSearchResult[]
  /** Set when the Places API returns a non-OK status (e.g. REQUEST_DENIED) */
  apiError?: string
}

export interface BusinessSearchOptions {
  /** Narrow Places `type=` parameter (overrides 'establishment'). */
  googleType?: string
  /** Result must have at least one of these in `place.types`. */
  typesAllow?: string[]
  /** Result must have none of these in `place.types`.
   *  Unioned with the always-on DEFAULT_BLOCK_TYPES list. */
  typesBlock?: string[]
  /** Result name must share at least one non-stopword token with one of these. */
  nameKeywords?: string[]
}

export async function searchBusinesses(
  query: string,
  location: string = 'United States',
  maxResults: number = 5,
  stateCode?: string | null,
  options?: BusinessSearchOptions,
): Promise<SearchBusinessesResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY

  if (!apiKey || apiKey.includes('your_actual') || apiKey.includes('your_google')) {
    console.warn('GOOGLE_PLACES_API_KEY not configured properly. Key present:', !!apiKey, 'Key length:', apiKey?.length || 0)
    return { results: [] }
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json')
    // Include the full place of performance in the text query — this is the
    // primary signal the legacy Places API uses for geographic relevance.
    url.searchParams.set('query', `${query} ${location}`)
    url.searchParams.set('key', apiKey)
    // Narrow Places `type=` when the caller supplies one; otherwise fall back
    // to the broad `establishment` to stay backward-compatible with callers
    // (like enrichWithGoogleMaps) that look up known vendors by name.
    url.searchParams.set('type', options?.googleType || 'establishment')
    // Request more results than needed so post-filtering has enough to work with
    url.searchParams.set('maxResultCount', String(Math.min(maxResults * 4, 20)))

    console.log(`[Google Places] Searching for: "${query}" in "${location}"${stateCode ? ` (state: ${stateCode})` : ''}${options?.googleType ? ` (type: ${options.googleType})` : ''} (API key: ${apiKey.substring(0, 8)}...)`)

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json()

    if (data.status !== 'OK') {
      console.error(`[Google Places] API error: ${data.status}`, data.error_message || '')
      if (data.status === 'REQUEST_DENIED') {
        console.error('[Google Places] Check if Places API is enabled and API key is valid')
      }
      return { results: [], apiError: data.status as string }
    }

    const allResults: PlaceSearchResult[] = data.results.map((place: any) => ({
      name: place.name || '',
      address: place.formatted_address || '',
      placeId: place.place_id || '',
      types: place.types || [],
      rating: place.rating || null,
      totalRatings: place.user_ratings_total || null,
      // Extract geometry coordinates for downstream distance computation
      lat: place.geometry?.location?.lat ?? null,
      lng: place.geometry?.location?.lng ?? null,
    }))

    // Relevance post-filters — block list, allow list, name overlap. The first
    // two operate on Google's `place.types` array (its strongest in-product
    // category signal). The third defends against obviously off-topic
    // businesses that happen to satisfy the type filters.
    const blockSet = new Set([...DEFAULT_BLOCK_TYPES, ...(options?.typesBlock ?? [])])
    const allowSet = options?.typesAllow && options.typesAllow.length > 0
      ? new Set(options.typesAllow)
      : null
    const nameKeywords = options?.nameKeywords

    const typesPass = allResults.filter((b) => {
      for (const t of b.types) {
        if (blockSet.has(t)) return false
      }
      if (allowSet) {
        return b.types.some((t) => allowSet.has(t))
      }
      return true
    })

    const namePass = nameKeywords && nameKeywords.length > 0
      ? typesPass.filter((b) => nameHasOverlap(b.name, nameKeywords))
      : typesPass

    // State-code post-filter (legacy Places text-search only biases, doesn't
    // restrict). Operates on the address; runs after relevance filters so the
    // counts logged below describe the final outcome.
    const businesses: PlaceSearchResult[] = stateCode
      ? namePass.filter((b) => addressMatchesState(b.address, stateCode))
      : namePass

    console.log(
      `[Google Places] q="${query}" raw=${allResults.length} typesPass=${typesPass.length} nameOverlap=${namePass.length}${stateCode ? ` state=${businesses.length}` : ''}`,
    )
    if (allResults.length > 0 && businesses.length === 0) {
      // Sample the addresses we rejected so it's easy to debug
      console.log(`[Google Places] Rejected sample: ${allResults.slice(0, 5).map((b) => `${b.name} [${b.types.slice(0, 3).join(',')}] ${b.address}`).join(' | ')}`)
    }

    return { results: businesses.slice(0, maxResults) }
  } catch (error) {
    console.error('[Google Places] Search failed:', error)
    return { results: [] }
  }
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY

  if (!apiKey) {
    return {}
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
    url.searchParams.set('place_id', placeId)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('fields', 'formatted_phone_number,website,business_status')

    const response = await fetch(url.toString())
    const data = await response.json()

    if (data.status === 'OK' && data.result) {
      const result = data.result
      const details: PlaceDetails = {}

      if (result.formatted_phone_number) {
        details.phone = result.formatted_phone_number
      }
      if (result.website) {
        details.website = result.website
      }
      if (result.business_status) {
        details.businessStatus = result.business_status
      }

      return details
    }

    return {}
  } catch (error) {
    console.error('Place details API failed:', error)
    return {}
  }
}

export interface FindSubcontractorsResult {
  vendors: Subcontractor[]
  /** Set when the Places API returned a non-OK status on any search call */
  apiError?: string
}

export async function findSubcontractorsForOpportunity(opportunity: {
  naicsCode?: string | null
  /** Full place of performance string e.g. "Anchorage, Alaska, USA" */
  placeOfPerformance?: string | null
  /** 2-letter state code for geographic bounding box bias e.g. "AK" */
  stateCode?: string | null
  title?: string
  /** Search radius tier — controls query location and post-filter granularity */
  radiusMiles?: 25 | 50 | 100 | 250
  /** City name for city-level post-filtering at 25mi radius */
  city?: string | null
  /** Pre-geocoded POP coordinates — computed once by the caller to avoid
   * repeated Geocoding API calls per search query. Pass null to skip distance. */
  popCoords?: { lat: number; lng: number } | null
  /** When provided and non-empty, bypass the NAICS + title-keyword maps entirely
   * and drive the search from these queries. Feeds the per-resource-line search
   * pivot introduced with the Resource Plan. Capped at 3 queries × 5 results. */
  searchQueries?: string[]
  /** Optional industry filter to apply when `searchQueries` is used. When absent,
   * a permissive default is applied (no allow/block types, name keywords fall
   * back to the provided `searchQueries`). Ignored when `searchQueries` is
   * absent/empty (the NAICS-map path supplies its own metadata per query). */
  industryHint?: {
    googleType?: string
    typesAllow?: string[]
    typesBlock?: string[]
    nameKeywords?: string[]
  }
}): Promise<FindSubcontractorsResult> {
  const { naicsCode, placeOfPerformance, stateCode, title, radiusMiles = 50, city, popCoords, searchQueries, industryHint } = opportunity

  // Build (query, metadata) pairs — prioritize NAICS, then title keywords. Each
  // query carries its own industry filter (Google type, allow/block, name
  // overlap) so the search is tightened to the relevant category.
  const searchPlan: Array<{ query: string; meta: IndustryMetadata }> = []
  const queuedQueries = new Set<string>()

  const enqueue = (meta: IndustryMetadata) => {
    for (const q of meta.queries) {
      if (queuedQueries.has(q)) continue
      queuedQueries.add(q)
      searchPlan.push({ query: q, meta })
    }
  }

  // Override path: caller supplied per-role search queries (e.g. from a
  // Resource Plan line). Skip the NAICS + title-keyword maps and build the
  // plan directly from the queries, one entry per query.
  const trimmedQueries = (searchQueries ?? [])
    .map(q => q?.trim())
    .filter((q): q is string => !!q)
    .slice(0, 3)

  if (trimmedQueries.length > 0) {
    const meta: IndustryMetadata = {
      queries: trimmedQueries,
      googleType: industryHint?.googleType,
      typesAllow: industryHint?.typesAllow ?? [],
      typesBlock: industryHint?.typesBlock ?? [],
      nameKeywords: industryHint?.nameKeywords ?? trimmedQueries,
    }
    for (const q of trimmedQueries) {
      queuedQueries.add(q)
      searchPlan.push({ query: q, meta })
    }
  } else {
    // 1. NAICS-based queries
    if (naicsCode && NAICS_INDUSTRY_MAP[naicsCode]) {
      enqueue(NAICS_INDUSTRY_MAP[naicsCode])
    }

    // 2. Title keyword-based queries
    if (title) {
      const titleLower = title.toLowerCase()
      for (const [keyword, meta] of Object.entries(TITLE_KEYWORD_MAP)) {
        if (titleLower.includes(keyword)) enqueue(meta)
      }
    }
  }

  // 3. No fallback: if neither NAICS nor title gave us a usable strategy, return
  // empty rather than firing a literal "NAICS xxxx contractor" text search that
  // tends to return uncategorized junk.
  if (searchPlan.length === 0) {
    return { vendors: [] }
  }

  // At 100+ mi: use state-level query location for broader results
  // At <100 mi: use city-level place of performance for tighter bias
  const location = radiusMiles >= 100
    ? (stateCode ? `${stateCode}, USA` : placeOfPerformance || 'United States')
    : placeOfPerformance || (stateCode ? `${stateCode}, USA` : 'United States')

  const allSubcontractors: Subcontractor[] = []
  const seenNames = new Set<string>()
  const seenPlaceIds = new Set<string>()
  let firstApiError: string | undefined

  // Search up to 3 queries, 5 results each, to get good coverage
  for (const { query, meta } of searchPlan.slice(0, 3)) {
    // Pass stateCode so searchBusinesses can add a locationbias bounding box
    const searchResult = await searchBusinesses(query, location, 5, stateCode, {
      googleType: meta.googleType,
      typesAllow: meta.typesAllow,
      typesBlock: meta.typesBlock,
      nameKeywords: meta.nameKeywords ?? meta.queries,
    })

    // Capture the first API error we encounter (e.g. REQUEST_DENIED)
    if (searchResult.apiError && !firstApiError) {
      firstApiError = searchResult.apiError
    }

    // At 25mi: additionally post-filter by city name for tightest radius
    const filteredBusinesses = (radiusMiles === 25 && city)
      ? searchResult.results.filter(b => addressMatchesCity(b.address, city))
      : searchResult.results

    for (const business of filteredBusinesses) {
      // Deduplicate by name AND placeId
      const nameLower = business.name.toLowerCase()
      if (seenNames.has(nameLower)) continue
      if (business.placeId && seenPlaceIds.has(business.placeId)) continue

      seenNames.add(nameLower)
      if (business.placeId) seenPlaceIds.add(business.placeId)

      // Compute straight-line distance from place of performance when both
      // the POP coordinates and the vendor's geometry are available.
      let distanceKm: number | null = null
      if (popCoords && business.lat != null && business.lng != null) {
        distanceKm = Math.round(
          haversineKm(popCoords.lat, popCoords.lng, business.lat, business.lng)
        )
      }

      // Get detailed information
      const details = await getPlaceDetails(business.placeId)

      allSubcontractors.push({
        ...business,
        ...details,
        service: query,
        location: placeOfPerformance || (stateCode ? `${stateCode}, USA` : 'USA'),
        distanceKm,
      })
    }
  }

  return {
    vendors: allSubcontractors,
    ...(firstApiError && { apiError: firstApiError }),
  }
}

export interface GoogleMapsEnrichment {
  googleRating: number | null
  googleTotalReviews: number | null
  googleBusinessStatus: string | null
  googleBusinessHours: Record<string, string>[] | null
  website: string | null
  phone: string | null
  placeId: string | null
}

/**
 * Enrich a business with Google Maps data by searching by name + state.
 * Called AFTER SAM.gov discovery to add operational data to verified entities.
 */
export async function enrichWithGoogleMaps(
  businessName: string,
  state?: string | null
): Promise<GoogleMapsEnrichment | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey || apiKey.includes('your_actual') || apiKey.includes('your_google')) {
    return null
  }

  try {
    const location = state ? `${state}, USA` : 'United States'
    const { results } = await searchBusinesses(businessName, location, 1)

    if (results.length === 0) return null

    const match = results[0]

    // Get detailed info including hours
    const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json')
    detailsUrl.searchParams.set('place_id', match.placeId)
    detailsUrl.searchParams.set('key', apiKey)
    detailsUrl.searchParams.set(
      'fields',
      'formatted_phone_number,website,business_status,opening_hours,rating,user_ratings_total'
    )

    const detailsRes = await fetch(detailsUrl.toString())
    const detailsData = await detailsRes.json()

    if (detailsData.status !== 'OK' || !detailsData.result) {
      return {
        googleRating: match.rating,
        googleTotalReviews: match.totalRatings,
        googleBusinessStatus: null,
        googleBusinessHours: null,
        website: null,
        phone: null,
        placeId: match.placeId,
      }
    }

    const r = detailsData.result
    return {
      googleRating: r.rating ?? match.rating,
      googleTotalReviews: r.user_ratings_total ?? match.totalRatings,
      googleBusinessStatus: r.business_status || null,
      googleBusinessHours: r.opening_hours?.weekday_text
        ? r.opening_hours.weekday_text.map((text: string) => {
            const [day, ...hours] = text.split(': ')
            return { day, hours: hours.join(': ') }
          })
        : null,
      website: r.website || null,
      phone: r.formatted_phone_number || null,
      placeId: match.placeId,
    }
  } catch (error) {
    console.error('Google Maps enrichment failed for', businessName, error)
    return null
  }
}
