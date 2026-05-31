import { searchHistoricalContracts, analyzeHistoricalPricing } from './usaspending'

export interface NaicsBenchmark {
  naicsCode: string
  medianValue: number
  averageValue: number
  totalContracts: number
  source: string
  fetchedAt: number
}

// In-process cache. Cleared on process restart. No TTL —
// USASpending NAICS medians shift slowly over weeks.
const cache = new Map<string, NaicsBenchmark | null>()
const inflight = new Map<string, Promise<NaicsBenchmark | null>>()

const FETCH_TIMEOUT_MS = 5000

/**
 * Fetch a NAICS-level benchmark from USASpending.gov.
 * Returns null when there's no data or the request times out.
 * Results cached in-process per NAICS code.
 */
export async function getNaicsBenchmark(naicsCode: string): Promise<NaicsBenchmark | null> {
  const code = naicsCode.trim()
  if (!code) return null

  if (cache.has(code)) return cache.get(code)!
  if (inflight.has(code)) return inflight.get(code)!

  const promise = (async () => {
    try {
      const contracts = await Promise.race([
        searchHistoricalContracts({ naicsCode: code, limit: 50 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)
        ),
      ])

      if (!contracts || contracts.length === 0) {
        cache.set(code, null)
        return null
      }

      const analysis = analyzeHistoricalPricing(contracts, undefined, code)
      const benchmark: NaicsBenchmark = {
        naicsCode: code,
        medianValue: analysis.medianContractValue,
        averageValue: analysis.averageContractValue,
        totalContracts: analysis.totalContracts,
        source: `USASpending.gov — NAICS ${code} median of ${analysis.totalContracts} contract${analysis.totalContracts !== 1 ? 's' : ''}`,
        fetchedAt: Date.now(),
      }
      cache.set(code, benchmark)
      return benchmark
    } catch {
      // Timeout or network error — cache null so we don't retry every request
      cache.set(code, null)
      return null
    } finally {
      inflight.delete(code)
    }
  })()

  inflight.set(code, promise)
  return promise
}

/**
 * Batch lookup — returns a Map<naicsCode, benchmark|null>.
 * Parallel, deduped by code.
 */
export async function getNaicsBenchmarks(
  naicsCodes: string[]
): Promise<Map<string, NaicsBenchmark | null>> {
  const unique = Array.from(new Set(naicsCodes.filter(Boolean)))
  const entries = await Promise.all(
    unique.map(async (code) => [code, await getNaicsBenchmark(code)] as const)
  )
  return new Map(entries)
}
