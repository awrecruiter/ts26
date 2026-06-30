# Plan: Tighter Google Places Subcontractor Relevance

## Goal
Stop irrelevant businesses (restaurants, lodging, retail) from leaking into subcontractor search results by (a) using Google's narrow `type=` parameter when the NAICS maps cleanly, (b) post-filtering on the returned `types[]` array with industry allow/block lists, and (c) rejecting results whose name has zero token overlap with the search query.

## Problem
`lib/google-places.ts` queries Places text-search with `type=establishment` (the broadest possible filter) and a free-text query like `"Highway Construction Anchorage, Alaska, USA"`. It returns every business Google ranks for those tokens, then post-filters only by **state code in the address**. Results regularly include `restaurant`, `lodging`, `school`, etc. because:

- We read `place.types` into the result object but never use it for filtering
- We use `type=establishment` instead of narrower types like `general_contractor`, `electrician`, `plumber`, `roofing_contractor`
- We don't check whether the business **name** has any token overlap with the search query — so "Sunny's Cafe" survives a "Highway Construction" search if it's in the right state
- When a NAICS isn't in the `NAICS_SERVICE_MAP`, the fallback query is the literal string `"NAICS 237310 contractor"`, which is read by Google as "any of those tokens"

## Success Criteria
- [ ] For NAICS codes that map to a Google `type` (construction, electrical, plumbing, etc.), the Places request uses that narrower `type` parameter instead of `establishment`
- [ ] Every returned result is filtered through a per-query `typesAllow` / `typesBlock` check before being returned to the caller
- [ ] Every returned result is rejected if its **name** has zero token overlap with the **query keywords** (after normalizing case and stripping common stopwords)
- [ ] The fallback "no NAICS in map" path no longer emits a literal `"NAICS 237310 contractor"` query — instead the route returns an empty result set and the UI message stays "No matches" (vs. surfacing junk)
- [ ] The state-code post-filter and the existing dedupe/distance logic stay untouched
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] At least one of: a debug log shows `N raw → M passed types filter → K passed name overlap` for each query, so future relevance debugging is trivial

## Context References
- `lib/google-places.ts:34-77` — `NAICS_SERVICE_MAP` (extend with paired Google-type metadata)
- `lib/google-places.ts:218-292` — `searchBusinesses` (where the `type` param is set and where the post-filter belongs)
- `lib/google-places.ts:340-453` — `findSubcontractorsForOpportunity` (where the per-query iteration happens and the fallback junk-query lives)
- `lib/google-places.ts:33` — no current import of Place type table; we'll inline a small constant rather than introduce a new module
- `app/api/opportunities/[id]/subcontractors/discover/route.ts` — caller; should not need changes if the public signature is preserved

## Database Changes
None.

## API Routes
None — `findSubcontractorsForOpportunity` keeps the same signature.

## Implementation

### 1. NAICS → industry metadata (replaces / extends `NAICS_SERVICE_MAP`)
Introduce a new constant `NAICS_INDUSTRY_MAP` keyed by NAICS code, with each value carrying:
- `queries: string[]` — the text-search phrases (same shape as today's `NAICS_SERVICE_MAP[code]`)
- `googleType?: string` — the narrow Places type to pass as `type=` (e.g. `general_contractor`, `electrician`, `plumber`, `roofing_contractor`). Optional — codes without a clean match omit it.
- `typesAllow: string[]` — `place.types` tokens that count as "in industry" (matching ANY one is enough). Example for construction NAICS: `['general_contractor', 'contractor', 'roofing_contractor']`.
- `typesBlock?: string[]` — `place.types` tokens that disqualify regardless. A global default block list (`restaurant`, `lodging`, `food`, `bar`, `cafe`, `school`, `tourist_attraction`, `church`) is unioned in.
- `nameKeywords?: string[]` — explicit accept-tokens for the name-overlap check (defaults to the words derived from `queries`).

Keep the existing `TITLE_KEYWORD_MAP` for fallback discovery — but each entry there also gains an optional `typesAllow` so a "cybersecurity" title can require `['point_of_interest']` ∩ blocklist (cybersecurity firms don't have a clean Places type).

### 2. `searchBusinesses` signature gains optional `typeFilter`
```ts
interface BusinessSearchOptions {
  googleType?: string         // sets the URL's type= param (overrides 'establishment')
  typesAllow?: string[]       // post-filter: at least one must appear in result.types
  typesBlock?: string[]       // post-filter: none may appear in result.types
  nameKeywords?: string[]     // post-filter: at least one keyword must appear in result.name
}
```
- If `googleType` is set, replace `type=establishment` with that value.
- After mapping `data.results`, apply (a) types blocklist, (b) types allowlist (if non-empty), (c) name-keyword overlap (if non-empty). Each filter logs counts at debug-level: `[Places] q="x" → raw=N typesPass=N nameOverlap=N`.

### 3. `findSubcontractorsForOpportunity` wiring
- For each iteration, pull the query's industry metadata (NAICS lookup first, then title-keyword fallback). Build a `BusinessSearchOptions` for `searchBusinesses`.
- Remove the `NAICS ${naicsCode} contractor` literal-string fallback (current `lib/google-places.ts:380-389`). When neither NAICS nor title yields a strategy, return `{ vendors: [] }` — no junk query.
- Keep the radius / city / state code logic untouched.

### 4. Global default `DEFAULT_BLOCK_TYPES`
Constant at module top:
```ts
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
```
Always unioned with per-query `typesBlock` inside `searchBusinesses`.

### 5. Name-overlap helper
```ts
function nameHasOverlap(name: string, keywords: string[]): boolean {
  const STOPWORDS = new Set(['the','and','services','company','inc','llc','corp','group','&'])
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  const nameTokens = new Set(norm(name).filter(t => !STOPWORDS.has(t)))
  const queryTokens = keywords.flatMap(norm).filter(t => !STOPWORDS.has(t))
  return queryTokens.some(t => nameTokens.has(t))
}
```
Called only when `nameKeywords` is set. Empty `nameKeywords` skips the check (defensive — a missing entry in the industry map shouldn't accidentally reject everything).

## Implementation Task List
1. [ ] Add `DEFAULT_BLOCK_TYPES` and `nameHasOverlap` helpers to `lib/google-places.ts`
2. [ ] Replace `NAICS_SERVICE_MAP` with `NAICS_INDUSTRY_MAP` (same NAICS codes covered; old `queries[]` carried over; new `googleType`, `typesAllow`, `typesBlock`, `nameKeywords` fields populated for the codes we ship today)
3. [ ] Extend `searchBusinesses` to accept the new `BusinessSearchOptions` and apply the three-stage post-filter; debug-log counts
4. [ ] Update `findSubcontractorsForOpportunity` to build options from the metadata, remove the literal-string NAICS fallback
5. [ ] Touch up `TITLE_KEYWORD_MAP` so each entry's shape matches the new metadata (`queries[]` + optional `typesAllow` + `nameKeywords`)
6. [ ] Type check: `npx tsc --noEmit`

## Validation Strategy

### Automated
- `npx tsc --noEmit`

### Manual User Journey
1. Open an opportunity with NAICS `237310` (highway construction) in Anchorage, AK
2. Click **Discover Vendors** in the Subcontractors panel
3. Expect: results filled with `general_contractor` / `contractor` / `roofing_contractor` types; no restaurants, no schools, no lodging
4. Open dev-server log: each Places query line shows `raw=N typesPass=K nameOverlap=K'`, confirming filters fired
5. Open an opportunity with a NAICS not in the map (e.g. some obscure one). Click **Discover Vendors**. Expect: 0 results returned, UI message "No matches" — no junk query attempted.

### Edge cases
- NAICS in map but `googleType` omitted → text-search still tightened by allow/block + name overlap
- Title keyword fires but NAICS is in map → both contribute queries; each iteration uses its own metadata; dedupe by `placeId`/name continues to apply
- Result has empty `place.types` → blocked by allowlist when one is set; surfaced when no allowlist (rare — Places almost always returns at least `point_of_interest`)
- Existing `state-code` post-filter still runs after the new filters — final list = `(allow ∩ ¬block ∩ nameOverlap ∩ state)`

## Out of Scope
- Calling Google's **new** Places API v1 (`places.googleapis.com/v1/places:searchText`), which supports richer category filters natively. Would be a larger migration.
- Adding business-status filtering (`CLOSED_PERMANENTLY` rejection). Deferred — narrow change for a separate pass.
- LLM-based relevance scoring of result names. Adds latency + cost; revisit only if rule-based filtering still leaks.
- Per-user feedback loop ("mark as irrelevant" → blocklist learning). Out of scope.
