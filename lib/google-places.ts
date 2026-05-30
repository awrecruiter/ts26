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

// NAICS code to service type mapping for search queries
const NAICS_SERVICE_MAP: Record<string, string[]> = {
  '236220': ['Commercial Construction', 'General Contractor'],
  '237310': ['Highway Construction', 'Road Construction'],
  '238210': ['Electrical Contractor', 'Electrician'],
  '238220': ['Plumbing Contractor', 'HVAC Contractor'],
  '238910': ['Site Preparation Contractor'],
  '334210': ['Telephone Apparatus', 'Communications Equipment'],
  '334220': ['Communications Equipment Repair', 'Electronics Repair', 'RF Electronics'],
  '334290': ['Communications Equipment', 'Electronic Components'],
  '334511': ['Radar Systems', 'Navigation Equipment'],
  '334519': ['Measuring Instruments', 'Testing Equipment'],
  '336411': ['Aircraft Manufacturing', 'Aerospace Contractor'],
  '511210': ['Software Publisher', 'Software Development Company'],
  '517311': ['Telecommunications', 'Network Services Provider'],
  '518210': ['Data Processing', 'Cloud Services'],
  '541310': ['Architectural Services', 'Architecture Firm'],
  '541330': ['Engineering Services', 'Civil Engineering', 'Structural Engineering'],
  '541380': ['Testing Laboratory', 'Inspection Services'],
  '541511': ['Custom Software Development', 'Application Development'],
  '541512': ['Computer Systems Design', 'IT Consulting', 'Software Development'],
  '541513': ['Computer Facilities Management', 'IT Infrastructure'],
  '541519': ['IT Services', 'Technology Consulting'],
  '541611': ['Management Consulting', 'Business Consulting'],
  '541612': ['Human Resources Consulting', 'HR Services'],
  '541614': ['Logistics Consulting', 'Supply Chain Consulting'],
  '541620': ['Environmental Consulting', 'Environmental Services'],
  '541690': ['Scientific Consulting', 'Technical Consulting'],
  '541715': ['Research and Development', 'R&D Services'],
  '541990': ['Professional Services', 'Consulting Services'],
  '561210': ['Facilities Support Services', 'Building Maintenance'],
  '561320': ['Temporary Staffing Agency', 'Staffing Services'],
  '561612': ['Security Guard Services', 'Security Services'],
  '561720': ['Janitorial Services', 'Cleaning Services'],
  '562910': ['Remediation Services', 'Environmental Cleanup'],
  '611430': ['Professional Training', 'Training Services'],
  '621999': ['Health Services', 'Medical Services'],
  '811219': ['Electronics Repair', 'Equipment Maintenance'],
}

// Keywords from opportunity titles mapped to relevant search terms
const TITLE_KEYWORD_MAP: Record<string, string[]> = {
  'cybersecurity': ['Cybersecurity Services', 'Information Security'],
  'security': ['Security Services', 'Security Consultant'],
  'construction': ['Construction Contractor', 'General Contractor'],
  'maintenance': ['Maintenance Services', 'Facility Maintenance'],
  'repair': ['Equipment Repair', 'Maintenance Services'],
  'training': ['Training Services', 'Professional Training'],
  'medical': ['Medical Services', 'Healthcare Services'],
  'health': ['Healthcare Services', 'Medical Supplies'],
  'software': ['Software Development', 'IT Services'],
  'network': ['Network Services', 'Telecommunications'],
  'cloud': ['Cloud Services', 'IT Infrastructure'],
  'data': ['Data Services', 'IT Consulting'],
  'logistics': ['Logistics Services', 'Supply Chain'],
  'transport': ['Transportation Services', 'Freight Services'],
  'cleaning': ['Janitorial Services', 'Cleaning Services'],
  'environmental': ['Environmental Services', 'Environmental Consulting'],
  'engineering': ['Engineering Services', 'Engineering Firm'],
  'consulting': ['Consulting Firm', 'Management Consulting'],
  'staffing': ['Staffing Agency', 'Temporary Staffing'],
  'electrical': ['Electrical Contractor', 'Electrician'],
  'plumbing': ['Plumbing Contractor', 'Plumber'],
  'hvac': ['HVAC Contractor', 'HVAC Services'],
  'telecom': ['Telecommunications', 'Network Services'],
  'research': ['Research Services', 'R&D Firm'],
  'laboratory': ['Testing Laboratory', 'Lab Services'],
  'inspection': ['Inspection Services', 'Quality Assurance'],
  'architecture': ['Architectural Services', 'Architecture Firm'],
  'survey': ['Surveying Services', 'Land Surveyor'],
  'remediation': ['Environmental Remediation', 'Cleanup Services'],
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

export async function searchBusinesses(
  query: string,
  location: string = 'United States',
  maxResults: number = 5,
  stateCode?: string | null
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
    url.searchParams.set('type', 'establishment')
    // Request more results than needed so post-filtering has enough to work with
    url.searchParams.set('maxResultCount', String(Math.min(maxResults * 4, 20)))

    console.log(`[Google Places] Searching for: "${query}" in "${location}"${stateCode ? ` (state: ${stateCode})` : ''} (API key: ${apiKey.substring(0, 8)}...)`)

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

    // Post-filter by state: the legacy Places API text search does not
    // restrict geographically — it only biases. We filter on the returned
    // formatted_address which always contains the state code, e.g. "AK 99501".
    let businesses: PlaceSearchResult[]
    if (stateCode) {
      businesses = allResults.filter(b => addressMatchesState(b.address, stateCode))
      console.log(`[Google Places] ${allResults.length} raw results, ${businesses.length} in ${stateCode} for "${query}"`)
      if (businesses.length === 0) {
        // Log the addresses we rejected so it's easy to debug
        console.log(`[Google Places] Rejected addresses: ${allResults.slice(0, 5).map(b => b.address).join(' | ')}`)
      }
    } else {
      businesses = allResults
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
}): Promise<FindSubcontractorsResult> {
  const { naicsCode, placeOfPerformance, stateCode, title, radiusMiles = 50, city, popCoords } = opportunity

  // Build search queries — prioritize NAICS, then title keywords
  let searchQueries: string[] = []

  // 1. NAICS-based queries
  if (naicsCode && NAICS_SERVICE_MAP[naicsCode]) {
    searchQueries.push(...NAICS_SERVICE_MAP[naicsCode])
  }

  // 2. Title keyword-based queries
  if (title) {
    const titleLower = title.toLowerCase()
    for (const [keyword, queries] of Object.entries(TITLE_KEYWORD_MAP)) {
      if (titleLower.includes(keyword)) {
        for (const q of queries) {
          if (!searchQueries.includes(q)) {
            searchQueries.push(q)
          }
        }
      }
    }
  }

  // 3. Fallback: generic NAICS or title-based search
  if (searchQueries.length === 0) {
    if (naicsCode) {
      searchQueries = [`NAICS ${naicsCode} contractor`]
    } else if (title) {
      // Use first few meaningful words from title
      const words = title.split(/\s+/).filter(w => w.length > 3).slice(0, 3).join(' ')
      searchQueries = [`${words} contractor`]
    } else {
      searchQueries = ['government contractor']
    }
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
  for (const query of searchQueries.slice(0, 3)) {
    // Pass stateCode so searchBusinesses can add a locationbias bounding box
    const searchResult = await searchBusinesses(query, location, 5, stateCode)

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
