/**
 * Google Geocoding API wrapper.
 *
 * Takes a free-form address string, returns { lat, lng } or null. Uses the
 * same GOOGLE_PLACES_API_KEY as vendor discovery (Places + Geocoding share
 * one key on Vercel).
 *
 * Callers are responsible for caching the result — this module does not touch
 * the database.
 */

export interface GeocodeResult {
  lat: number
  lng: number
  formatted: string
}

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not configured')
  const trimmed = address.trim()
  if (!trimmed) return null

  const url = new URL(GEOCODE_URL)
  url.searchParams.set('address', trimmed)
  url.searchParams.set('key', apiKey)
  // Bias to US since federal contracts land here — reduces false hits on
  // ambiguous state codes ("VA" → Virginia, not Vatican).
  url.searchParams.set('components', 'country:US')

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) return null
  const data = await res.json()
  if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
    return null
  }
  const first = data.results[0]
  const loc = first?.geometry?.location
  if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null
  return { lat: loc.lat, lng: loc.lng, formatted: first.formatted_address || trimmed }
}

/**
 * Build a geocodable address string from an Opportunity's SAM.gov rawData.
 * Prefers city + state; falls back to state alone. Returns null if we can't
 * assemble anything usable.
 */
export function addressFromOpportunity(opp: {
  state?: string | null
  rawData?: any
}): string | null {
  const pop = opp.rawData?.placeOfPerformance
  const city = pop?.city?.name || pop?.cityName || null
  const stateCode = pop?.state?.code || pop?.state?.name || opp.state || null
  const zip = pop?.zip || null

  const parts: string[] = []
  if (city) parts.push(city)
  if (stateCode) parts.push(stateCode)
  if (zip) parts.push(zip)
  if (parts.length === 0) return null
  return parts.join(', ')
}
