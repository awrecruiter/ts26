# Plan: SAM.gov Fetch Honors Search Filters

## Goal
Make the "Fetch from SAM.gov" button honor the current search/NAICS filters and paginate through SAM.gov results so a NAICS query returns hundreds of matches instead of a hard-capped 50.

## Problem
Today the opportunities page has two disconnected SAM.gov paths:

1. **"Fetch from SAM.gov"** (admin button, always visible) → `POST /api/opportunities/fetch` with `{ limit: 50, posted_days_ago: 90 }`. **Ignores the search box and the NAICS chip input.** Just pulls the 50 most recent postings.
2. **"Search SAM.gov live"** (only shown on zero results) → `POST /api/opportunities/search-sam` with `{ query, naics }`. Respects inputs, but caps SAM.gov call at `limit=50` per page with no pagination.

Symptom: user enters NAICS `237310` (31k matches on SAM.gov), clicks "Fetch from SAM.gov", gets ~2 new records. The search input is discarded; the bulk-fetch's 50 most recent rows are mostly already in the library.

## Success Criteria
- [ ] "Fetch from SAM.gov" sends the current `search` and `naicsCodes` from the page to the SAM.gov endpoint
- [ ] When NAICS is set, the SAM.gov call paginates until either ≥500 candidates are gathered or SAM.gov runs out of results
- [ ] ACTIVE-status (`ptype=o,p,k`) and 14-day-out deadline filters remain enforced
- [ ] User sees a result message like `"Fetched 137 new opportunities (412 SAM.gov matches, 275 already in library or closing soon)"`
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Existing "Search SAM.gov live" empty-state button still works (uses the same path)

## Context References
- `app/opportunities/page.tsx:140` — `handleFetchFromSAM` (the button to rewire)
- `app/opportunities/page.tsx:108` — `handleLiveSamSearch` (already correct shape — model after this)
- `app/api/opportunities/fetch/route.ts` — current bulk-fetch (to be replaced/folded into search-sam)
- `app/api/opportunities/search-sam/route.ts` — already accepts `{ query, naics }`; needs pagination loop
- `lib/samgov.ts` — SAM.gov v2 client (no changes; pagination handled in the route)

## Database Changes
None.

## API Routes

### Modified: `POST /api/opportunities/search-sam`
- Add pagination loop: when at least one `ncode` is present, keep calling SAM.gov with incrementing `offset` until either:
  - `opportunitiesData.length < limit` (last page), OR
  - cumulative candidates ≥ `MAX_SAMGOV_CANDIDATES` (500), OR
  - 10 pages fetched (safety stop)
- For title/solnum-only searches (no NAICS), keep the existing single-page behavior — title search rarely benefits from pagination and there's no abuse risk.
- Per-call `signal: AbortSignal.timeout(10000)` stays; wrap the whole loop in a 45-second budget.
- Response shape gains `samgovTotal` (total reported by SAM.gov, before dedupe) and `paged` (pages fetched).

### Removed/Deprecated: `POST /api/opportunities/fetch`
- Leave the route in place for now (still admin-only) but the UI no longer calls it. Mark a TODO to remove after one release cycle if no one uses it.
- (Alternative: delete it now. Prefer leaving it since it's a 60-second bulk job that's still useful for cron-style backfill — just not the right thing to wire to a search-driven button.)

## UI Components

### Modified: `app/opportunities/page.tsx`
- Rename the button handler from `handleFetchFromSAM` → call `handleLiveSamSearch` (same network call). Pull both into one helper `runSamSearch({ requireInput })`:
  - When the button is clicked with no `search` and no `naicsCodes`: show "Enter a search term or NAICS code first" — don't fire a blind bulk fetch
  - Else fire `POST /api/opportunities/search-sam` with the current values
- Result message reflects pagination counts (`saved`, `eligible`, `samgovTotal`)
- Keep the admin gate on the button (matches today's behavior)
- The empty-state "Search SAM.gov live" button keeps calling the same helper — no UX change there

## Implementation Task List
1. [ ] `app/api/opportunities/search-sam/route.ts` — add NAICS pagination loop with `MAX_SAMGOV_CANDIDATES=500` and overall 45-second budget; extend response with `samgovTotal` and `paged`
2. [ ] `app/opportunities/page.tsx` — consolidate `handleFetchFromSAM` and `handleLiveSamSearch` into one helper; rewire the admin button to pass the live `search` + `naicsCodes`
3. [ ] Result-message copy update on success/empty cases
4. [ ] Type check: `npx tsc --noEmit`

## Validation Strategy

### Automated
- `npx tsc --noEmit`

### Manual User Journey
1. Sign in as ADMIN, go to `/opportunities`
2. Open the filter panel, type `237310` into the NAICS chip input, press Enter
3. URL updates to `?naics=237310`
4. Click **Fetch from SAM.gov** in the header
5. Button shows "Fetching..." and resolves within ~30 seconds
6. Expect message: `"Fetched N new opportunities (M SAM.gov matches, K already in library or closing soon)"` with N ≥ 1 unless library is already exhaustive
7. List refreshes; new 237310 cards appear

### Edge cases to test
- Empty search + empty NAICS → button shows inline error, no network call
- NAICS only → pagination kicks in (verify with `Network` tab seeing multiple offset requests)
- Title-only search ("237310" in search box, no NAICS) → single SAM.gov call, treated as `title` substring (will likely return 0 — expected, this plan does *not* add NAICS auto-detection from the search box)
- Both set → NAICS pagination loop runs once per code, then dedupe + filter

## Out of Scope
- Auto-detecting a 2–6 digit number in the **search** box as a NAICS code. Deferred — adds magic that surprises users. If we want it later, do it as a separate change.
- Deleting `app/api/opportunities/fetch/route.ts`. Keep it for now as a bulk-recent backfill endpoint.
