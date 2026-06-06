// DEPRECATED: Superseded by lib/comparables.ts (per-opportunity comparables). Functions return null. Will be deleted next cycle.

export interface NaicsBenchmark {
  naicsCode: string
  agency: string | null
  medianValue: number
  averageValue: number
  totalContracts: number
  source: string
  fetchedAt: number
}

export async function getNaicsBenchmark(
  _naicsCode?: string,
  _agency?: string | null
): Promise<NaicsBenchmark | null> {
  return null
}

export async function getNaicsBenchmarks(
  _pairs?: Array<{ naicsCode: string; agency?: string | null }>
): Promise<Map<string, NaicsBenchmark | null>> {
  return new Map()
}

export function benchmarkKey(naicsCode: string, agency?: string | null): string {
  return `${naicsCode}|${agency || ''}`
}
