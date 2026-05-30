/**
 * Opportunity Classification — Product vs. Service Detection
 *
 * Determines whether a federal solicitation is for products or services
 * to optimize vendor discovery (local vs. national search).
 */

interface ClassificationResult {
  isProduct: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

// NAICS prefixes that indicate product/manufacturing solicitations
const PRODUCT_NAICS_PREFIXES = ['31', '32', '33', '42']
// 31-33 = Manufacturing, 42 = Wholesale Trade

// PSC codes starting with numbers are products; letters are services
// A-Z prefix = services, 1-9 prefix = products
function isPSCProduct(classificationCode: string): boolean | null {
  if (!classificationCode) return null
  const first = classificationCode.charAt(0)
  if (/[0-9]/.test(first)) return true
  if (/[A-Z]/i.test(first)) return false
  return null
}

// Keywords in title that suggest product solicitations
const PRODUCT_KEYWORDS = [
  'supply', 'supplies', 'equipment', 'materials', 'parts',
  'purchase', 'procurement of', 'furnish', 'deliver',
  'manufacturing', 'fabrication', 'commodity', 'goods',
]

// Keywords that suggest service solicitations
const SERVICE_KEYWORDS = [
  'services', 'consulting', 'maintenance', 'support',
  'management', 'training', 'construction', 'installation',
  'engineering', 'design', 'analysis', 'assessment',
]

export function isProductSolicitation(opportunity: {
  naicsCode?: string | null
  title?: string | null
  rawData?: any
}): ClassificationResult {
  const { naicsCode, title, rawData } = opportunity
  const classificationCode = rawData?.classificationCode || ''

  // 1. Check PSC code (highest confidence for product detection)
  const pscResult = isPSCProduct(classificationCode)
  if (pscResult !== null) {
    return {
      isProduct: pscResult,
      confidence: 'high',
      reason: `PSC code "${classificationCode}" indicates ${pscResult ? 'product' : 'service'}`,
    }
  }

  // 2. Check NAICS prefix
  if (naicsCode) {
    const prefix2 = naicsCode.substring(0, 2)
    if (PRODUCT_NAICS_PREFIXES.includes(prefix2)) {
      return {
        isProduct: true,
        confidence: 'high',
        reason: `NAICS ${naicsCode} prefix "${prefix2}" is manufacturing/wholesale`,
      }
    }
  }

  // 3. Check title keywords
  if (title) {
    const titleLower = title.toLowerCase()
    const productMatch = PRODUCT_KEYWORDS.find(kw => titleLower.includes(kw))
    if (productMatch) {
      // Check if service keywords also match (ambiguous)
      const serviceMatch = SERVICE_KEYWORDS.find(kw => titleLower.includes(kw))
      if (serviceMatch) {
        return {
          isProduct: false,
          confidence: 'low',
          reason: `Title contains both product ("${productMatch}") and service ("${serviceMatch}") keywords; defaulting to service`,
        }
      }
      return {
        isProduct: true,
        confidence: 'medium',
        reason: `Title keyword "${productMatch}" suggests product solicitation`,
      }
    }

    const serviceMatch = SERVICE_KEYWORDS.find(kw => titleLower.includes(kw))
    if (serviceMatch) {
      return {
        isProduct: false,
        confidence: 'medium',
        reason: `Title keyword "${serviceMatch}" suggests service solicitation`,
      }
    }
  }

  // 4. Default to service (most federal contracts are services)
  return {
    isProduct: false,
    confidence: 'low',
    reason: 'No strong indicators; defaulting to service solicitation',
  }
}

/**
 * Extract state code from raw place of performance data.
 * Returns 2-letter state code or null.
 */
export function extractStateCode(rawData: any): string | null {
  const pop = rawData?.placeOfPerformance
  if (!pop) return null
  // Try state code directly
  if (pop.state?.code) return pop.state.code
  // Try state name → code mapping for common cases
  if (pop.state?.name) {
    return STATE_NAME_TO_CODE[pop.state.name.toUpperCase()] || null
  }
  return null
}

/**
 * Extract city name from raw place of performance data.
 * Returns city name string or null.
 */
export function extractCity(rawData: any): string | null {
  const pop = rawData?.placeOfPerformance
  if (!pop) return null
  if (pop.city?.name) return pop.city.name
  if (pop.cityName) return pop.cityName
  return null
}

/**
 * Extract city + state text for location-specific searches.
 */
export function extractPlaceOfPerformance(rawData: any, fallbackState?: string | null): string {
  const pop = rawData?.placeOfPerformance
  if (!pop) return fallbackState ? `${fallbackState}, USA` : 'United States'

  const parts = [
    pop.city?.name,
    pop.state?.name || pop.state?.code,
  ].filter(Boolean)

  if (parts.length > 0) return `${parts.join(', ')}, USA`
  return fallbackState ? `${fallbackState}, USA` : 'United States'
}

/**
 * Suggest a default search radius (in miles) based on place of performance density.
 *
 * Logic:
 * - Dense metro cities (NYC, LA, Chicago, DC, etc.)  → 25 mi
 * - Most named cities                                 → 50 mi  (default)
 * - Sparsely populated states (AK, MT, WY, ND, SD, ID, NM) → 100 mi
 * - No city specified (state-only or nationwide)      → 100 mi
 *
 * Returns one of the RADIUS_TIERS values: 25 | 50 | 100 | 250.
 */
export function suggestSearchRadius(
  city: string | null | undefined,
  stateCode: string | null | undefined
): 25 | 50 | 100 | 250 {
  // Sparsely populated states — widen by default
  const SPARSE_STATES = new Set(['AK', 'MT', 'WY', 'ND', 'SD', 'ID', 'NM', 'NV', 'VT', 'ME', 'NH', 'WV'])
  if (!city) {
    return stateCode && SPARSE_STATES.has(stateCode.toUpperCase()) ? 100 : 100
  }

  const cityLower = city.toLowerCase().trim()

  // Dense metro areas — tight radius to keep results hyper-local
  const DENSE_METROS = new Set([
    'new york', 'new york city', 'nyc', 'brooklyn', 'queens', 'bronx', 'manhattan',
    'los angeles', 'la', 'chicago', 'houston', 'phoenix', 'philadelphia',
    'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville',
    'fort worth', 'columbus', 'charlotte', 'indianapolis', 'san francisco',
    'seattle', 'denver', 'washington', 'washington dc', 'nashville', 'oklahoma city',
    'el paso', 'boston', 'portland', 'las vegas', 'memphis', 'baltimore', 'milwaukee',
    'albuquerque', 'tucson', 'fresno', 'sacramento', 'mesa', 'kansas city',
    'atlanta', 'omaha', 'colorado springs', 'raleigh', 'long beach', 'virginia beach',
    'minneapolis', 'tampa', 'new orleans', 'arlington', 'wichita', 'bakersfield',
    'aurora', 'anaheim', 'santa ana', 'corpus christi', 'riverside', 'st. louis',
    'lexington', 'pittsburgh', 'anchorage', 'stockton', 'cincinnati', 'st. paul',
    'toledo', 'greensboro', 'newark', 'plano', 'henderson', 'lincoln', 'buffalo',
    'jersey city', 'chula vista', 'fort wayne', 'orlando', 'st. petersburg',
    'norfolk', 'laredo', 'madison', 'durham', 'lubbock', 'winston-salem',
    'garland', 'glendale', 'hialeah', 'reno', 'baton rouge', 'irvine',
    'chesapeake', 'irving', 'scottsdale', 'north las vegas', 'fremont',
    'gilbert', 'san bernardino', 'birmingham', 'boise',
  ])

  if (DENSE_METROS.has(cityLower)) return 25

  // Sparse states with a city specified — still use 100mi
  if (stateCode && SPARSE_STATES.has(stateCode.toUpperCase())) return 100

  // Default: named city that isn't a mega-metro
  return 50
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
  'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
  'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
  'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS',
  'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
  'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
  'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
  'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT',
  'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV',
  'WISCONSIN': 'WI', 'WYOMING': 'WY', 'DISTRICT OF COLUMBIA': 'DC',
}
