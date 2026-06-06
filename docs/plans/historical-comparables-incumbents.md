# Plan: Historical Comparables + Incumbent Visibility

## Goal

Replace today's misleading "Contract Value" (median of top-50 biggest awards in a NAICS+agency bucket) with a real per-opportunity comparable-awards estimate and a visible incumbent list — so the user can see typical award sizes for *this* scope of work and who has won similar work before.

## Why today's number is wrong

`lib/usaspending.ts:97-98` sorts USASpending results by `Award Amount desc` and takes the top 50. For NAICS 336412 at DLA Aviation that includes F-35 component contracts. Median of giant contracts is still giant → every card shows a 9-figure number unrelated to the actual procurement. Two opps with the same `(NAICS, agency)` hit the same cache entry in `naics-benchmark.ts:14` and display *identical* values (NextGen Passport + Mexican Criminal Courts both = $340,169,526 in the PDF screenshot).

Incumbent data is already in the API response (`recipient_name`, `period_of_performance_*`) and silently discarded by `analyzeHistoricalPricing()`.

## Success Criteria

- [ ] Listing card shows a **range** (e.g. `$1.2M – $4.1M · median $2.3M · n=12`) instead of one inflated median
- [ ] Two opportunities with the same NAICS+agency but different scope show **different** numbers
- [ ] Each card surfaces the **top incumbent**: "ACME Defense ($1.4M, Mar 2024)"
- [ ] Opportunity workspace surfaces the **full incumbent list** (top 5–10) with recipient, amount, period, agency office
- [ ] **Recompete detection**: when prior award's `Solicitation Identifier` matches the current `solicitationNumber`, flag it: `"⚠ Current incumbent — contract expires Mar 2027"`
- [ ] Source line is the full triple: `USASpending.gov · n=12 · NAICS 336412 + DoD + "amplifier" · fetched 2026-06-06 · Medium`
- [ ] "Insufficient data" shown when n < 3 — no fake numbers
- [ ] No TypeScript errors (`npx tsc --noEmit`)

## Context References

- **Files to modify:**
  - `lib/usaspending.ts` — rewrite query strategy
  - `lib/naics-benchmark.ts` — deprecate in favor of per-opportunity comparables (keep import shim for one cycle)
  - `app/api/opportunities/route.ts` — list endpoint, swap benchmark enrichment for comparables enrichment
  - `app/api/opportunities/[id]/assessment/auto-generate/route.ts` — use the new comparables search
  - `components/opportunities/OpportunityCard.tsx` — new range-style metric block, top-incumbent row
  - `components/workspace/panels/OpportunitySummaryPanel.tsx` — incumbent table (already scaffolded at line 556, needs data wiring + recompete flag)
  - `prisma/schema.prisma` — new `OpportunityComparable` model
- **External:** USASpending API v2 `/api/v2/search/spending_by_award/` — supports combined `naics_codes + keywords + psc_codes + award_type_codes`, sort by `Action Date`. See `https://api.usaspending.gov/docs/endpoints#search/spending_by_award`.

## Database Changes

New model `OpportunityComparable` — one row per (opportunity, historical award). Cached results of the per-opportunity search.

```prisma
model OpportunityComparable {
  id            String   @id @default(cuid())
  opportunityId String
  opportunity   Opportunity @relation(fields: [opportunityId], references: [id], onDelete: Cascade)

  // From USASpending
  awardId          String
  recipientName    String
  awardAmount      Float
  awardingAgency   String?
  awardingOffice   String?      // toptier.subtier.office, when available
  description      String?      @db.Text
  popStart         DateTime?
  popEnd           DateTime?
  naicsCode        String?
  pscCode          String?
  solicitationId   String?      // for recompete matching against Opportunity.solicitationNumber
  isRecompete      Boolean      @default(false)  // computed at insert: solicitationId == opportunity.solicitationNumber
  isCurrentIncumbent Boolean    @default(false)  // computed: isRecompete && popEnd > now

  // Provenance
  fetchedAt        DateTime     @default(now())
  matchTier        String       // 'naics+agency+keywords' | 'naics+keywords' | 'naics+agency' | 'naics'

  @@index([opportunityId])
  @@index([opportunityId, awardAmount])
  @@unique([opportunityId, awardId])
  @@map("opportunity_comparables")
}
```

Add relation on `Opportunity`:
```prisma
comparables OpportunityComparable[]
```

Migration: `npx prisma db push` (per memory — `migrate dev` fails on Render PG).

## New: `lib/comparables.ts`

Replaces the analysis logic in `lib/usaspending.ts` / `lib/naics-benchmark.ts` for the per-opportunity case.

```ts
export interface ComparableSummary {
  count: number
  p25: number
  median: number
  p75: number
  min: number
  max: number
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  matchTier: 'naics+agency+keywords' | 'naics+keywords' | 'naics+agency' | 'naics'
  fetchedAt: Date
  topIncumbent: { name: string; amount: number; popStart: Date | null } | null
  currentIncumbent: { name: string; popEnd: Date | null } | null
  awards: OpportunityComparable[]  // up to 20
}

export async function getComparablesForOpportunity(
  opportunity: Pick<Opportunity, 'id' | 'naicsCode' | 'agency' | 'title' | 'solicitationNumber' | 'rawData'>,
  opts?: { maxAgeHours?: number }   // default 168 (7 days)
): Promise<ComparableSummary>
```

Query strategy — try tiers in order, stop at first that returns ≥ 3 results:

| Tier | Filters | Notes |
|------|---------|-------|
| 1 | NAICS + agency (toptier) + keywords from title | Most specific. Keywords = top 2-3 nouns from title (`"antenna"`, `"hvac"`) |
| 2 | NAICS + keywords (drop agency) | Toptier name often mismatched |
| 3 | NAICS + agency | Match Tier today's behavior |
| 4 | NAICS only | Last resort — confidence = low |

Across all tiers:
- `sort: 'Action Date', order: 'desc'` — recent first, NOT biggest first
- `time_period`: last 5 years
- `award_type_codes`: by default `['C', 'D']` (delivery orders + definitive contracts). Skip `A` (BPA) and `B` (Purchase Order) which skew small, skip IDIQ umbrella ceilings unless PSC code matches an IDIQ-type procurement.
- If `opportunity.rawData.classificationCode` (PSC) available, add to filter — more precise than NAICS alone.
- Pull `Solicitation Identifier` field to flag recompetes.

Confidence:
- `high` = tier 1 or 2, n ≥ 10
- `medium` = tier 1 or 2 with n 3-9, OR tier 3 with n ≥ 10
- `low` = tier 3 with n 3-9, OR tier 4
- `insufficient` = n < 3 → return summary with `null`s; UI shows "Insufficient data — enter manual estimate"

## API Routes

### Modified: `GET /api/opportunities`
- Stop calling `getNaicsBenchmarks`. Instead, in the response, include each opp's cached comparables summary if fresh (< 7 days old):
  ```ts
  comparables: {
    count, p25, median, p75, confidence, matchTier, topIncumbent, currentIncumbent
  } | null
  ```
- Do **not** fetch fresh comparables during list load (would be 18 USASpending calls = slow). Stale comparables come from the DB; refresh is triggered separately (see below).

### New: `POST /api/opportunities/[id]/comparables/refresh`
- Forces a fresh USASpending query for one opportunity, stores results in `OpportunityComparable`, returns the new summary.
- Called from the listing page on initial load for opps with no cached comparables (batched, 3 concurrent max).
- Also called by `assessment/auto-generate` so the assessment uses the new data.

### New: `GET /api/opportunities/[id]/comparables`
- Returns full list of stored comparables for the workspace incumbent panel (up to 20 awards).

### Modified: `POST /api/opportunities/[id]/assessment/auto-generate`
- Use `getComparablesForOpportunity()` instead of `getPricingRecommendation()`.
- Store `summary.median` as `assessment.estimatedValue`, but also store the full `awards[]` array in `assessment.historicalData` (existing field) for backward compat with the panel display.

### Deprecate: `lib/naics-benchmark.ts`
- Keep file as a thin shim that calls `getComparablesForOpportunity()` for one cycle, then remove.

## UI Components

### Modified: `components/opportunities/OpportunityCard.tsx`

Replace the four-metric block. Today's "Contract Value" tile becomes:

```
Comparable awards (last 5 yrs)
$1.2M – $4.1M · median $2.3M
n=12 · NAICS 336412 + DoD · Medium
Top winner: ACME Defense ($1.4M, Mar 2024)
⚠ Recompete: current contract expires Mar 2027
```

When `comparables` is null/insufficient → `"Insufficient data — enter manual estimate"` (matches existing fallback).

### Modified: `components/workspace/panels/OpportunitySummaryPanel.tsx`

The existing "Comparable Past Awards" table at line 556 already shows recipient/amount/period — wire it to fetch from `GET /api/opportunities/[id]/comparables` instead of `assessment.historicalData`. Add:
- "Recompete" badge in the first column when `award.isRecompete`
- "Current incumbent" callout above the table when `summary.currentIncumbent` is set
- Source line below the table: `n=12 · NAICS 336412 + DoD + "amplifier" · fetched 2026-06-06 · Medium confidence`

### New parent state in `app/opportunities/page.tsx` (listing page)

After initial render, kick off `POST .../comparables/refresh` for any opp whose `comparables` came back null. Batch 3-concurrent. Update card data as each resolves. Show subtle "Loading comparables…" placeholder until first response.

## Implementation Task List

1. [ ] `prisma/schema.prisma` — add `OpportunityComparable` model + relation; run `npx prisma db push`; `npx prisma generate`
2. [ ] `lib/comparables.ts` — new module: tier strategy, USASpending query with `Action Date` sort + keywords + PSC, P25/P75 stats, recompete detection
3. [ ] `lib/usaspending.ts` — split: keep raw API call (`searchHistoricalContracts`), remove `analyzeHistoricalPricing` (move to comparables.ts), update `getPricingRecommendation` to delegate
4. [ ] `app/api/opportunities/[id]/comparables/route.ts` — new `GET` handler
5. [ ] `app/api/opportunities/[id]/comparables/refresh/route.ts` — new `POST` handler, idempotent (delete+insert by opportunityId)
6. [ ] `app/api/opportunities/route.ts` — drop benchmark enrichment, add cached comparables enrichment
7. [ ] `app/api/opportunities/[id]/assessment/auto-generate/route.ts` — switch to `getComparablesForOpportunity()`
8. [ ] `app/opportunities/page.tsx` — wire batched refresh after initial list render
9. [ ] `components/opportunities/OpportunityCard.tsx` — new range-style metric + top-incumbent row
10. [ ] `components/workspace/panels/OpportunitySummaryPanel.tsx` — wire incumbent table to `GET .../comparables`, add recompete badges + current-incumbent callout + full source line
11. [ ] `lib/naics-benchmark.ts` — shim → calls new module (remove in follow-up commit)
12. [ ] Type-check: `npx tsc --noEmit`

## Validation Strategy

### Automated
- `npx tsc --noEmit`
- Existing E2E: `bash tests/e2e/opportunities.sh` — verify listing still renders and clicking through still works

### Manual User Journey
1. Open `/opportunities`. For each card, confirm:
   - Number is no longer 9-figure for small-scope procurements
   - Source line shows tier + count + confidence + fetched date
2. Find two opps with the same NAICS+agency (e.g. NextGen Passport + Mexican Criminal Courts, both 541519 + State Dept). Confirm they show **different** ranges.
3. Open the antenna opportunity (NAICS 334220). Confirm at least one comparable in the incumbent list mentions the same buying activity (DLA Maritime Columbus).
4. Open `43--PUMP,CENTRIFUGAL` (NAICS displayed as "4320" today). Confirm NAICS now displays correctly OR is treated as malformed → "Insufficient data" (don't crash).
5. Pick a known recompete (any solicitation ending in a -R0XXX number that you can verify has prior awards on USASpending). Confirm "Current incumbent" callout appears.
6. Open workspace → Summary tab → confirm the "Comparable Past Awards" table now populates without needing to run an assessment.
7. Click "Run assessment" on a fresh opp — confirm `estimatedValue` saved is `summary.median`, not the old top-50-biggest median.

### Edge cases to verify
- Opp with malformed NAICS (e.g. `"4320"` instead of 6-digit) → graceful "Insufficient data", no crash
- Opp with no `rawData.classificationCode` (no PSC) → tier strategy still works using NAICS alone
- USASpending API down / 500s → fall back to cached comparables (any age), show stale-warning in source line
- Opp posted today with no prior awards → "Insufficient data" + suggest manual entry

## Bundled fixes (same PR)

### Fix 1: NAICS "4320" bug — PSC bleeding into the NAICS column

**Root cause:** `scripts/fetch-real-opportunities.ts:93`:
```ts
let naicsCode = opp.naicsCode || opp.classificationCode || null
```
SAM.gov's `classificationCode` is the PSC (Product Service Code, 4-digit FSC), **not** NAICS. When `opp.naicsCode` is absent, PSC bleeds in. That's why PUMP CENTRIFUGAL shows "NAICS: 4320" (which is FSC 4320 — Pumps and Compressors).

**Fix:**
- `prisma/schema.prisma` — add `pscCode String?` to `Opportunity` model (also wanted for comparables tier-1 matching)
- `scripts/fetch-real-opportunities.ts:93-100,113` — split:
  ```ts
  const naicsCode = opp.naicsCode || null  // never fall back to classificationCode
  const pscCode   = opp.classificationCode || null
  ```
  Write both fields on `upsert`.
- One-off data-repair script `scripts/repair-misclassified-naics.ts`:
  - Find rows where `naicsCode` is 4 digits (real NAICS is always 6)
  - Move that value to `pscCode`, set `naicsCode = null`
  - Run once after migration
- `components/opportunities/OpportunityCard.tsx` + `OpportunitySummaryPanel.tsx` — display PSC alongside NAICS when present:
  ```
  NAICS: 334220 · PSC: 5985
  ```
- `lib/comparables.ts` — when `pscCode` is set, include it in tier-1 USASpending query (`psc_codes: { require: [pscCode] }`)

### Fix 2: Email-panel attachment preview — wire it like the briefing page

**Current state:** `EmailDraftPanel.tsx:157-222` defines its own `AttachmentPreviewModal`. The eye button works, but the modal is less robust than `OpportunitySummaryPanel.tsx:702-769`:

| Behavior | Briefing page | Email panel |
|---|---|---|
| Iframe-friendly check | `isPreviewable()` fallback message | None — always iframes (silent fail for non-PDF) |
| Display name | `currentName` | `originalName` |
| Download link | `?download=1` query | bare `download` attr |
| Layout | White card on backdrop, rounded | Plain dark backdrop |

**Fix:**
- Extract a shared `components/shared/AttachmentPreviewModal.tsx` from `OpportunitySummaryPanel.tsx:702-769`. Props: `attachment: RichAttachment`, `opportunityId: string`, `onClose: () => void`.
- Replace both the inline modal in `EmailDraftPanel.tsx:157-222` and the inline modal in `OpportunitySummaryPanel.tsx:702-769` with `<AttachmentPreviewModal />`.
- `isPreviewable()` (currently a private helper at `OpportunitySummaryPanel.tsx:1016`) — move to `lib/attachment-preview.ts` so the shared modal can import it.
- Verify the eye button on the email panel renders the new shared modal end-to-end (PDF inline, DOCX shows "download to view" fallback).

### Additional task list items

13. [ ] `prisma/schema.prisma` — add `pscCode String?` to `Opportunity`; `npx prisma db push`; `npx prisma generate`
14. [ ] `scripts/fetch-real-opportunities.ts` — split NAICS/PSC ingest; backfill `pscCode` on update path too
15. [ ] `scripts/repair-misclassified-naics.ts` — one-off cleanup; run once
16. [ ] `components/opportunities/OpportunityCard.tsx` + `OpportunitySummaryPanel.tsx` — display PSC alongside NAICS
17. [ ] `lib/comparables.ts` — add PSC to tier-1 filter
18. [ ] `lib/attachment-preview.ts` — extract `isPreviewable()` helper
19. [ ] `components/shared/AttachmentPreviewModal.tsx` — extract shared modal
20. [ ] `OpportunitySummaryPanel.tsx` — replace inline modal with shared component
21. [ ] `EmailDraftPanel.tsx` — replace inline `AttachmentPreviewModal` with shared component

### Additional manual validation

8. PUMP CENTRIFUGAL card — confirm NAICS column is blank (or "—") and PSC shows "4320"
9. Any card with both NAICS + PSC available — confirm both display
10. After repair script — confirm no row in `opportunities` has a 4-digit `naicsCode`
11. Open any opp → Email panel → click eye on a PDF attachment — confirm shared modal opens with white card, iframe loads, Download button uses `?download=1`
12. Click eye on a DOCX attachment (non-iframable) — confirm "Preview not available" fallback shows, not a broken iframe

## Out of scope (follow-up)

- Backfill comparables for the 18 existing opportunities — handle in a one-off script after the main work lands
- Incumbent intelligence cross-reference (does the incumbent have other active SAM.gov registrations? are they bidding on other opps in our pipeline?) — separate feature
- USASpending subaward data (who the incumbent subbed to) — separate
