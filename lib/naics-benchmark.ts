import { searchHistoricalContracts, analyzeHistoricalPricing } from './usaspending'

export interface NaicsBenchmark {
  naicsCode: string
  agency: string | null
  medianValue: number
  averageValue: number
  totalContracts: number
  source: string
  fetchedAt: number
}

// In-process cache, keyed by `${naicsCode}|${agency||''}`. No TTL.
const cache = new Map<string, NaicsBenchmark | null>()
const inflight = new Map<string, Promise<NaicsBenchmark | null>>()

const FETCH_TIMEOUT_MS = 5000

// USASpending agency names are toptier — extract the first segment of
// SAM.gov's dotted fullParentPathName (e.g. "DEPT OF DEFENSE.DEPT OF THE AIR FORCE..." → "Department of Defense")
function toTopTierAgency(agency: string | null | undefined): string | null {
  if (!agency) return null
  const first = agency.split('.')[0]?.trim()
  if (!first) return null
  // Common SAM.gov → USASpending name mappings
  const upper = first.toUpperCase()
  if (upper.startsWith('DEPT OF DEFENSE') || upper === 'DOD') return 'Department of Defense'
  if (upper.startsWith('DEPT OF VETERANS') || upper.includes('VETERANS AFFAIRS')) return 'Department of Veterans Affairs'
  if (upper.startsWith('DEPT OF HOMELAND')) return 'Department of Homeland Security'
  if (upper.startsWith('DEPT OF HEALTH')) return 'Department of Health and Human Services'
  if (upper.startsWith('DEPT OF ')) {
    // "DEPT OF X" → "Department of X" (title case the rest)
    const rest = first.slice(8).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    return `Department of ${rest}`
  }
  return first
}

async function fetchBenchmark(
  naicsCode: string,
  agency: string | null
): Promise<NaicsBenchmark | null> {
  try {
    const contracts = await Promise.race([
      searchHistoricalContracts({ naicsCode, agencyName: agency || undefined, limit: 50 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)
      ),
    ])

    if (!contracts || contracts.length === 0) return null

    const analysis = analyzeHistoricalPricing(contracts, undefined, naicsCode)
    return {
      naicsCode,
      agency,
      medianValue: analysis.medianContractValue,
      averageValue: analysis.averageContractValue,
      totalContracts: analysis.totalContracts,
      source: agency
        ? `USASpending.gov — ${analysis.totalContracts} contract${analysis.totalContracts !== 1 ? 's' : ''} at ${agency} (NAICS ${naicsCode})`
        : `USASpending.gov — ${analysis.totalContracts} contract${analysis.totalContracts !== 1 ? 's' : ''} NAICS ${naicsCode} comparables`,
      fetchedAt: Date.now(),
    }
  } catch {
    return null
  }
}

/**
 * Fetch a benchmark for (NAICS + agency). Falls back to NAICS-only when the
 * agency-narrowed search returns no contracts. Results cached in-process.
 */
export async function getNaicsBenchmark(
  naicsCode: string,
  agency?: string | null
): Promise<NaicsBenchmark | null> {
  const code = naicsCode.trim()
  if (!code) return null

  const tier = toTopTierAgency(agency)
  const key = `${code}|${tier || ''}`

  if (cache.has(key)) return cache.get(key)!
  if (inflight.has(key)) return inflight.get(key)!

  const promise = (async () => {
    try {
      let result = tier ? await fetchBenchmark(code, tier) : null
      if (!result) {
        // Fall back to NAICS-only across all agencies
        const fallbackKey = `${code}|`
        if (cache.has(fallbackKey)) {
          result = cache.get(fallbackKey)!
        } else {
          result = await fetchBenchmark(code, null)
          cache.set(fallbackKey, result)
        }
      }
      cache.set(key, result)
      return result
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

/**
 * Batch lookup keyed by (naics, agency). Returns a Map keyed by the same
 * string used internally so callers can fetch by either tuple.
 */
export async function getNaicsBenchmarks(
  pairs: Array<{ naicsCode: string; agency?: string | null }>
): Promise<Map<string, NaicsBenchmark | null>> {
  const uniq = new Map<string, { naicsCode: string; agency: string | null }>()
  for (const p of pairs) {
    if (!p.naicsCode) continue
    const tier = toTopTierAgency(p.agency)
    const key = `${p.naicsCode}|${tier || ''}`
    if (!uniq.has(key)) uniq.set(key, { naicsCode: p.naicsCode, agency: tier })
  }
  const entries = await Promise.all(
    Array.from(uniq.entries()).map(async ([key, { naicsCode, agency }]) => {
      return [key, await getNaicsBenchmark(naicsCode, agency)] as const
    })
  )
  return new Map(entries)
}

export function benchmarkKey(naicsCode: string, agency?: string | null): string {
  return `${naicsCode}|${toTopTierAgency(agency) || ''}`
}
