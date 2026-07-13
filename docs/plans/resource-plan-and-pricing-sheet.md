# Plan: Resource Plan & Prime-Orchestrated Pricing Sheet

## Goal
Redefine "processing an opportunity" so that it (1) parses solicitation attachments, (2) writes the Opportunity Brief, (3) decomposes the contract into every role, business, and material line a prime would need to orchestrate, (4) rolls those lines into a pricing sheet where risk-per-line drives the profit margin on a sliding scale, (5) writes a **job description** for every professional role the prime will have to hire for, and (6) picks the correct government attachments to include in the master subcontractor email. **We no longer generate our own SOW** — the SOW panel, routes, and standalone pages are removed. The government's own solicitation attachments are what get sent to businesses; per-role job descriptions are what get used to hire individuals.

## Motivation (New Learning)
The current workflow assumes one subcontractor per contract and produces a Prime-authored SOW to send them. In practice: (a) primes win and keep leverage by *orchestrating a team* — multiple trades, supply lines, insurance, bonding, and their own coordination overhead; (b) the margin a prime can defend is proportional to the risk they've absorbed on behalf of the government; (c) subs trust the government's own attachments more than a Prime-authored restatement, and generating our own SOW added a step that neither side needed. So processing should enumerate every role/material with a risk-priced cost, and the master email should send the correct *government* attachments — no bespoke SOW.

## Success Criteria
- [ ] "Process opportunity" now covers four AI passes: (1) attachment parsing, (2) Opportunity Brief, (3) Resource Plan (with per-professional-role Job Descriptions), (4) Attachment Relevance classification for the master email
- [ ] **SOW is removed from the app.** No `SOWPanel`, no `activePanel === 'sow'`, no `/sows` pages, no `POST /api/sows*` handlers, no SOW nav in `WorkspaceLayout` or Breadcrumbs, no `generatingSOW` state, no `generateSOWSections()` function
- [ ] Every professional resource line has an AI-generated **Job Description** stored in its JSON — role summary, day-to-day responsibilities, required + preferred qualifications, place/schedule of work, compensation basis, reporting line
- [ ] The Resource Plan card lets the user expand any professional line to view/edit the Job Description inline; a "Copy" button copies the JD as clean text for use in job posts or recruiter briefs
- [ ] Every processed opportunity produces a `resourcePlan` JSON with ≥1 entries covering the mix of professional roles, subcontracted businesses, materials, equipment, and prime-side overhead needed to execute
- [ ] Each resource line renders on the Opportunity Brief page with: category icon, label, one-sentence value description, quantity/basis, and a risk chip
- [ ] Lines are grouped by category (Professionals · Subcontracted Trades · Materials/Equipment · Prime Overhead) with visually distinct but restrained styling (stone palette, no color families beyond stone + amber for risk chips)
- [ ] A "Pricing Sheet" section beneath the resource plan sums the line-level cost basis, exposes a **risk-to-margin slider**, and computes the recommended bid price
- [ ] Risk-to-margin slider: aggregate risk score (weighted average of per-line risk) maps to a margin percentage on a sliding scale (Low ≈ 8%, Medium ≈ 15%, High ≈ 25%, editable)
- [ ] Vendor discovery reads `resourcePlan` and runs one search per Professional/Subcontracted-Trade line (instead of one search per NAICS)
- [ ] After processing, the master subcontractor email in `EmailDraftPanel` has the correct *government* attachments pre-checked from the `attachmentRelevance` verdicts; the user can still toggle
- [ ] **The email template body is not modified.** All existing template variables, subject line, and layout in `EmailDraftPanel.tsx` remain byte-identical
- [ ] Existing single-vendor flow still works if `resourcePlan` is absent (backwards compatible)
- [ ] No TypeScript errors (`npx tsc --noEmit`)

## Design Decisions
| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Resource plan is a **third AI pass**, not folded into the brief | Keeps the brief prompt cheap and lets the plan re-run without regenerating the brief |
| 2 | Categories are fixed: `professional`, `subcontracted_trade`, `material`, `equipment`, `prime_overhead` | Constrains model output; makes grouping in UI trivial |
| 3 | Every line carries a `riskLevel: low \| medium \| high` chosen by the model | Feeds the sliding-scale margin without a second model call |
| 4 | Pricing sheet lives on the **Opportunity Brief page** (Summary panel), not the Bid panel | The brief is where the prime decides *whether* to pursue; pricing intent belongs with that decision. The Bid panel remains the formal deliverable |
| 5 | Sliding-scale margin defaults to `low=8%, medium=15%, high=25%` and is user-editable per opportunity | Matches new learning that risk absorbed → margin defended; keeps the target auditable |
| 6 | Prime overhead lines (bonding, insurance, PM coordination time) are *always* included, even if zero-cost, so the prime is prompted to fill them | Prevents the "invisible overhead" mistake we saw in early bids |
| 7 | Vendor discovery pivots from `NAICS_INDUSTRY_MAP` to the resource plan when present, falls back to the NAICS map when absent | Backwards compatible; no big-bang cutover |
| 8 | "Process opportunity" no longer generates a SOW. It runs brief + resource plan + attachment relevance. **The SOW panel is removed entirely** | New learning: the government's attachments are what subs trust; per-role JDs cover individual hires |
| 9 | Master email attachment selection is seeded by `generateAttachmentRelevance()` — the existing classifier already wired into `EmailDraftPanel` — but promoted to a **required** step of processing so the email is always pre-populated | Zero-change to the email template; only the *default checked set* comes from AI |
| 10 | Job descriptions are generated in the **same GPT-4o call** as the resource plan, not as a separate pass | One prompt, one round trip, guaranteed consistency between the role and the JD. Cost is small relative to the value |
| 11 | JDs are attached only to `professional` category lines. `subcontracted_trade` still uses the government attachments in the email; `material` / `equipment` / `prime_overhead` don't need JDs | Trades are businesses (RFQ flow), not hires. Materials are goods. Only humans get JDs |
| 12 | DB tables for SOWs (`SOW`, `SOWApproval`, `SOWVersion`, `SOWActivity`) are **kept in the schema** even after UI/route removal | Preserves historical records; avoids a destructive migration mid-flight. Table drop can be a follow-up plan once we've been off SOWs for a while |

## Resource Plan JSON Structure
```typescript
type ResourceCategory =
  | 'professional'        // individual role we'd hire or subcontract a person for
  | 'subcontracted_trade' // a whole business we'd sub to (HVAC company, landscaping firm)
  | 'material'            // consumables, supplies
  | 'equipment'           // rental or purchase of gear
  | 'prime_overhead'      // bonding, insurance, PM time, mobilization

type RiskLevel = 'low' | 'medium' | 'high'

interface JobDescription {
  roleTitle: string                       // "HVAC Technician, EPA 608 Certified"
  seniority?: string                      // "Journeyman", "Senior", "Lead"
  summary: string                         // 2–3 sentences — what this person does and why we need them
  responsibilities: string[]              // day-to-day duties, bulleted
  requiredQualifications: string[]        // licenses, clearances, certs, experience thresholds
  preferredQualifications?: string[]      // nice-to-have
  placeOfWork: string                     // POP, remote, hybrid
  schedule?: string                       // "M-F 0700-1530", "on-call", "swing shift"
  compensationBasis: string               // "hourly", "salaried", "day rate", "per-visit"
  reportingLine: string                   // "reports to Prime PM"; describe orchestration expectation
  generatedAt: string                     // ISO
}

interface ResourceLine {
  id: string                              // stable client-generated uuid
  category: ResourceCategory
  label: string                           // "HVAC technician (EPA 608)", "Performance bond"
  valueDescription: string                // one sentence — WHAT they add to the operation
  quantity?: string                       // "2 techs", "1 lot", "12 mo"
  basis?: string                          // "per month", "per event", "one-time"
  estimatedUnitCost?: number | null       // dollars, prime's internal estimate
  estimatedTotalCost?: number | null      // dollars — quantity × unit, or lump
  costSource?: string                     // "USASpending NAICS 561720 avg", "GSA rate", "manual"
  riskLevel: RiskLevel                    // model-chosen; user-editable
  riskRationale?: string                  // one line — WHY this risk level
  searchQueries?: string[]                // only for professional / subcontracted_trade — feeds vendor discovery
  suggestedNaics?: string | null          // optional narrower NAICS for the search
  linkedSubcontractorId?: string | null   // set once a real vendor is picked
  jobDescription?: JobDescription | null  // ONLY populated when category === 'professional'
}

interface ResourcePlan {
  lines: ResourceLine[]
  primeCoordinationHours?: number | null  // prime's own PM time to run the orchestra
  bondingRequired: boolean
  insuranceMinimums?: string[]            // ["$1M GL", "$500K auto"]
  generatedAt: string                     // ISO
  modelVersion: 'gpt-4o' | 'gpt-4o-mini'
}

interface PricingSheet {
  costBasisTotal: number                  // sum of line estimatedTotalCost
  riskScore: number                       // 0–100 weighted average (low=25, med=50, high=90)
  marginBands: { low: number; medium: number; high: number }  // percentages
  targetMarginPct: number                 // driven by riskScore → interpolated across bands
  targetMarginDollar: number              // costBasisTotal * targetMarginPct / 100
  recommendedBidPrice: number             // costBasisTotal + targetMarginDollar
  userOverrideMarginPct?: number | null   // when user drags the slider
  updatedAt: string
}
```

## Context References
- `lib/openai.ts` — add `generateResourcePlan()` alongside existing `generateOpportunityBrief()` etc.; **remove `generateSOWSections()`** and any SOW-only helpers
- `lib/sow-utils.ts` — delete (or, if any of its helpers like role permission checks are used elsewhere, extract those first, then delete the SOW-specific parts)
- `lib/attachment-parser.ts` — feeds the same parsed content into the new plan call
- `lib/google-places.ts` — `findSubcontractorsForOpportunity()` gains an override path when a `searchQueries` list is provided
- `app/api/opportunities/[id]/subcontractors/discover/route.ts` — pivot to per-role search plan when `resourcePlan` exists
- `components/workspace/panels/OpportunitySummaryPanel.tsx` — hosts the new UI blocks; loses the "Generate SOW" button
- `components/workspace/panels/OpportunityBriefCard.tsx` — unchanged; sits above the new blocks
- `components/assessment/MarginCalculator.tsx` — existing single-margin UI; will read from the pricing sheet when present
- `prisma/schema.prisma` — `Opportunity` model gets `resourcePlan Json?` + `pricingSheet Json?`. SOW-related tables remain (see Design Decision 12)

### Files to Delete (SOW removal)
- `components/workspace/panels/SOWPanel.tsx`
- `components/sows/` (whole directory — `SOWCard.tsx`, `SOWEditor.tsx`, `SOWViewer.tsx`, `SOWStatusBadge.tsx`, `SOWPDF.tsx`)
- `app/sows/page.tsx`, `app/sows/[id]/page.tsx`
- `app/api/sows/route.ts` and all children (`[id]/route.ts`, `assign-approver`, `accept`, `versions`, `approve`, `download`, `send`)
- `lib/sow-utils.ts` (after extracting any non-SOW helpers)

### Files to Modify for SOW Removal
- `app/opportunities/[id]/page.tsx` — remove `SOWPanel` import, `generatingSOW` state, `handleGenerateSOW`, `handleSaveSOW`, `handleSaveSOWAndRefresh`, `handleSOWStatusChange`, the `activePanel === 'sow'` case, `emailContext.sowSynopsis` seeding, and `emailTemplateType === 'sow_delivery'`
- `components/workspace/WorkspaceLayout.tsx` — remove the SOW nav item and any `sowCreated` progress step (renumber remaining steps)
- `components/workspace/DocumentDirectory.tsx` — remove SOW node
- `components/layout/Breadcrumbs.tsx` — remove `/sows` path handling
- `components/progress/*` — drop any `sowCreated` field references
- `app/admin/page.tsx` — remove SOW admin views if present
- `app/api/email/send/route.ts` — remove any SOW-attachment code paths (email still sends government attachments)
- `components/workspace/panels/EmailDraftPanel.tsx` — **only** touch the template-type literal union (drop `'sow_delivery'`) if TS complains; template body and layout stay byte-identical
- `prisma/schema.prisma` — no changes to SOW tables (kept for data preservation)

## Database Changes
- **Modified model:** `Opportunity`
  - `resourcePlan   Json?` — cached ResourcePlan JSON
  - `pricingSheet   Json?` — cached PricingSheet JSON (recomputed on line edits)
- **Modified model:** `Subcontractor`
  - `resourceLineId String?` — nullable FK-by-value pointing at `ResourceLine.id`; lets a discovered vendor be attached to the role it was searched for
- **Migration:** DB is Render Postgres — use `npx prisma db push` (per project memory: `migrate dev` fails in this env)

## API Routes
- **New:** `POST /api/opportunities/[id]/resource-plan`
  - Auth required
  - Reads `parsedAttachments`, `opportunityBrief`, `rawData`
  - Calls `generateResourcePlan()` (which produces JDs inline for professional lines)
  - Saves `resourcePlan`; recomputes and saves `pricingSheet`
  - Returns `{ resourcePlan, pricingSheet }`
- **New:** `POST /api/opportunities/[id]/resource-plan/lines/[lineId]/job-description`
  - Auth required, professional lines only
  - Calls `generateJobDescription()` and persists to the matching line
  - Returns `{ jobDescription }`
- **New:** `PATCH /api/opportunities/[id]/resource-plan`
  - Auth required
  - Body: `{ lines?: ResourceLine[], primeCoordinationHours?, bondingRequired?, insuranceMinimums? }`
  - Persists edits (add/remove/edit line, edit risk, edit cost) and recomputes `pricingSheet`
- **New:** `PATCH /api/opportunities/[id]/pricing-sheet`
  - Body: `{ userOverrideMarginPct?: number | null, marginBands?: {low,medium,high} }`
  - Recomputes and persists
- **Modified:** `POST /api/opportunities/[id]/subcontractors/discover`
  - Accepts optional `{ resourceLineId }` in body to scope the search to one role
  - When `resourcePlan` exists on the opportunity and no `resourceLineId` given, fan out one search per Professional/Subcontracted-Trade line (queued sequentially, capped at 5 lines per run)
  - Each created `Subcontractor` row gets `resourceLineId` set
- **New:** `POST /api/opportunities/[id]/process` — the single "Process opportunity" entrypoint
  - Auth required
  - Runs in parallel (`Promise.allSettled`):
    1. `parseAllAttachments()` (if `parsedAttachments` is null)
    2. `generateOpportunityBrief()`
    3. `generateResourcePlan()`
    4. `generateAttachmentRelevance()`
  - Persists whichever passes succeed; returns per-artifact status so the UI can show partial success
  - **Does not** call `generateSOWSections()` and **does not** create a `SOW` row
- **Removed:** `POST /api/sows` and all `/api/sows/*` children — the whole `app/api/sows/` directory is deleted

## UI Components

### New: `components/workspace/panels/ResourcePlanCard.tsx`
- `'use client'`
- Props: `plan: ResourcePlan | null`, `isGenerating: boolean`, `onGenerate: () => void`, `onEditLine(id, patch)`, `onAddLine(category)`, `onRemoveLine(id)`, `onOpenVendorSearch(lineId)`, `onUpdateJobDescription(lineId, patch)`, `onRegenerateJobDescription(lineId)`
- Layout: single card, one section per category (heading + line rows)
- Empty state: "Generate Resource Plan" button with the same visual language as the Brief card
- Each row: `[category icon] · label (semibold) · valueDescription (stone-600, one line, clamp-2) · quantity/basis (stone-500, tabular) · risk chip (amber-100/amber-800 for high, stone-100/stone-700 for low/medium) · estimatedTotalCost (right-aligned, tabular-nums) · overflow menu`
- **Professional rows only:** a chevron on the left expands the row inline to reveal the Job Description with fields: Role Title, Seniority, Summary, Responsibilities (bulleted, add/remove), Required + Preferred Qualifications (bulleted, add/remove), Place of Work, Schedule, Compensation Basis, Reporting Line. Every field is inline-editable and auto-saves on blur (silent save pattern — no button). A "Copy" button copies the whole JD as clean plain text. A "Regenerate" link re-runs the JD prompt for this one line only
- Overflow menu: Edit, Change risk, Find vendors (only on `professional` / `subcontracted_trade`), Remove
- All spacing uses the stone palette. Icons: small stroke-only SVGs (12–14px), no color families beyond stone/amber

### New: `components/workspace/panels/PricingSheetCard.tsx`
- `'use client'`
- Props: `sheet: PricingSheet | null`, `plan: ResourcePlan | null`, `onUpdate(patch)`
- Layout:
  - Top row: `Cost basis · Aggregate risk (badge) · Target margin (percent) · Recommended bid (large, right-aligned)`
  - Middle: **Risk-to-margin slider** — visual band from Low to High with the current riskScore marker; dragging the marker sets `userOverrideMarginPct`
  - Under the slider: three editable margin-band inputs (`Low %`, `Medium %`, `High %`) with a "Reset defaults" link
  - Bottom: line-count summary ("12 lines · 3 professional · 2 trades · 5 materials · 2 overhead")
- No emojis. No color families beyond stone + one accent for the slider knob

### Modified: `components/workspace/panels/OpportunitySummaryPanel.tsx`
- Props gain: `resourcePlan`, `pricingSheet`, `isGeneratingResourcePlan`, `onGenerateResourcePlan`, `onUpdateResourcePlan`, `onUpdatePricingSheet`, `onOpenVendorSearchForLine`, `onProcessOpportunity`, `isProcessing`
- Replace the existing "Generate SOW" button in the attachments section with a **"Process opportunity"** button (or add a top-level one near the Brief card if the SOW button is preferred for removal later)
- The Process button calls `onProcessOpportunity()` which triggers `POST /api/opportunities/[id]/process`
- Insert `<ResourcePlanCard>` **directly under** the Opportunity Brief card and **above** the "Overview" and attachments sections
- Insert `<PricingSheetCard>` directly under the ResourcePlanCard
- Remove the SOW generation button and the associated `onGenerateSOW` prop (still importable for the standalone SOW tab, but not shown in the Summary panel flow)
- Keep every other block below unchanged

### Modified: `app/opportunities/[id]/page.tsx`
- Add `isGeneratingResourcePlan` and `isProcessing` state
- Add handlers:
  - `handleProcessOpportunity()` — POST `/api/opportunities/[id]/process`; on success, refetch the opportunity so brief, resource plan, pricing sheet, and `aiArtifacts.attachmentRelevance` all update in one pass. The `EmailDraftPanel` re-seed effect (`EmailDraftPanel.tsx:209-219`) will automatically re-check the correct attachments as soon as the new `attachmentRelevance` arrives via props — no wiring change needed there
  - `handleGenerateResourcePlan()` — POST `/api/opportunities/[id]/resource-plan` (for standalone regeneration)
  - `handleUpdateResourcePlan(patch)` — PATCH same route
  - `handleUpdatePricingSheet(patch)` — PATCH `/api/opportunities/[id]/pricing-sheet`
  - `handleOpenVendorSearchForLine(lineId)` — switches to `subcontractors` panel and triggers scoped discover
- Thread all new props into `<OpportunitySummaryPanel>`
- **No changes** to any prop passed to `<EmailDraftPanel>` — it already receives `attachmentRelevance` and `selectedAttachmentIds`; the fresh values propagate through existing wiring

### Modified: `lib/openai.ts`
- New function `generateResourcePlan(input)` — GPT-4o
  - Input: `{ brief, parsedAttachments, rawData, title, agency, naicsCode, setAside }`
  - Prompt frame: "You are decomposing a federal contract into every role, business, material, and prime-side overhead line a small business prime would need to orchestrate execution. For each line, describe its value to the operation in one sentence, choose a risk level with a one-line rationale, and (for professional/trade lines) give 1–3 Google search queries that would surface qualified vendors. **For every `professional` line, also produce a complete Job Description** with role title, seniority, 2–3 sentence summary, 4–8 day-to-day responsibilities, required and preferred qualifications, place/schedule of work, compensation basis, and reporting line (Prime PM)."
  - Response format: strict JSON matching `ResourcePlan` (with `jobDescription` populated on every `professional` line)
  - Include hard rules: "Always include bonding and insurance overhead lines. Include a `prime_overhead` line for the prime's own coordination time. Never populate `jobDescription` on non-professional lines."
- New function `generateJobDescription(input)` — GPT-4o, for on-demand regeneration of a single JD
  - Input: `{ brief, resourceLine, placeOfPerformance }`
  - Returns `JobDescription`
  - Used by the "Regenerate" affordance on the ResourcePlanCard
- **Remove** `generateSOWSections()` and any SOW-only helpers/exports from this file
- Export the `ResourcePlan`, `ResourceLine`, `ResourceCategory`, `RiskLevel`, `JobDescription`, and `PricingSheet` types (or move to `lib/types/resource-plan.ts`)

### Modified: `lib/google-places.ts`
- `findSubcontractorsForOpportunity()` gains an optional `searchQueries?: string[]` param
- When present, skip the NAICS/title-keyword search plan and use `searchQueries` verbatim (still capped at 3 queries × 5 results)
- Keep every existing signal (radius, POP, distance, allow/block filters)

### Modified: `app/api/opportunities/[id]/subcontractors/discover/route.ts`
- If body has `resourceLineId`:
  - Load `resourcePlan`, pick the line, pass its `searchQueries` and `suggestedNaics` to `findSubcontractorsForOpportunity`
  - Every created `Subcontractor` gets `resourceLineId` set
- If body has no `resourceLineId` and the opportunity has a `resourcePlan`:
  - Iterate the first 5 professional/subcontracted-trade lines
  - Run one search per line, tagging created rows with `resourceLineId`
  - Respect the total cap of 15 vendors per run across all lines
- Otherwise: existing NAICS-map path (unchanged)

### Not Modified: `components/workspace/panels/EmailDraftPanel.tsx`
- **Explicitly untouched.** The template body, subject builders, and layout remain byte-identical.
- The existing effect that seeds `selectedAttachmentIds` from `attachmentRelevance` (`EmailDraftPanel.tsx:197-219`) already does the right thing — new relevance verdicts arriving from a fresh `/process` run will re-check the checkboxes automatically.
- The only visible change users experience here is that the correct attachments are **already pre-checked** the first time they open the Email tab after processing, instead of the previous behavior of every-attachment-selected.

### Modified: `components/assessment/MarginCalculator.tsx`
- When `opportunity.pricingSheet` exists: seed `estimatedCost` from `pricingSheet.costBasisTotal`, seed `estimatedValue` from `pricingSheet.recommendedBidPrice`
- Add a small link "Based on Resource Plan → open" that scrolls the summary panel back to the pricing card
- Keep existing manual-entry behavior when no plan exists

## Pricing Math
```
riskScore = Σ (weight[line] × riskWeight[line.riskLevel]) / Σ weight[line]
  where weight[line] = max(1, line.estimatedTotalCost or 1)
  and   riskWeight = { low: 25, medium: 50, high: 90 }

// Piecewise-linear across the three margin bands
if riskScore ≤ 25:                   targetMarginPct = bands.low
if 25 < riskScore ≤ 50: interpolate  bands.low → bands.medium
if 50 < riskScore ≤ 90: interpolate  bands.medium → bands.high
if riskScore > 90:                   targetMarginPct = bands.high

targetMarginDollar    = costBasisTotal × targetMarginPct / 100
recommendedBidPrice   = costBasisTotal + targetMarginDollar
// user override wins when set
finalMarginPct        = userOverrideMarginPct ?? targetMarginPct
```
This math lives in `lib/pricing.ts` (new) with a pure `computePricingSheet(plan, bands, override)` function that both API routes call. No math in components.

## Implementation Task List

### Phase A — Additive (Resource Plan + Pricing + JDs)
1. [ ] **Types** — create `lib/types/resource-plan.ts` with `ResourceCategory`, `RiskLevel`, `JobDescription`, `ResourceLine`, `ResourcePlan`, `PricingSheet`
2. [ ] **Pricing math** — create `lib/pricing.ts` with `computePricingSheet()`, unit-tested in-file with a couple of asserts
3. [ ] **Schema** — add `resourcePlan Json?`, `pricingSheet Json?` to `Opportunity`; `resourceLineId String?` to `Subcontractor`; `npx prisma db push`
4. [ ] **OpenAI: resource plan** — add `generateResourcePlan()` in `lib/openai.ts` with strict-JSON prompt; must populate JDs for professional lines
5. [ ] **OpenAI: JD regen** — add `generateJobDescription()` for on-demand single-line regeneration
6. [ ] **Route: POST resource-plan** — `app/api/opportunities/[id]/resource-plan/route.ts`
7. [ ] **Route: PATCH resource-plan** — same file, PATCH handler; recomputes pricing on every write
8. [ ] **Route: POST job-description regen** — `app/api/opportunities/[id]/resource-plan/lines/[lineId]/job-description/route.ts`
9. [ ] **Route: PATCH pricing-sheet** — `app/api/opportunities/[id]/pricing-sheet/route.ts`
10. [ ] **Route: POST process** — `app/api/opportunities/[id]/process/route.ts` — runs the four passes in parallel (parse + brief + resource plan + attachment relevance); persists everything; returns per-artifact status
11. [ ] **google-places** — add `searchQueries?: string[]` param; use verbatim when provided
12. [ ] **discover route** — read `resourceLineId` from body; fan out per line when plan present; tag rows
13. [ ] **ResourcePlanCard** — new component with inline JD expand/edit/copy/regenerate for professional lines
14. [ ] **PricingSheetCard** — new component with risk-to-margin slider
15. [ ] **SummaryPanel** — insert new cards + Process button (keep Generate SOW temporarily until Phase B; wire both)
16. [ ] **Parent page** — new state + handlers (including `handleProcessOpportunity`, `handleUpdateJobDescription`, `handleRegenerateJobDescription`); prop threading
17. [ ] **MarginCalculator** — seed from pricing sheet when present
18. [ ] **Type check checkpoint** — `npx tsc --noEmit` clean before moving to Phase B

### Phase B — SOW Removal
19. [ ] **Delete SOW routes** — `rm -rf app/api/sows/` (all handlers)
20. [ ] **Delete SOW pages** — `rm -rf app/sows/`
21. [ ] **Delete SOW components** — `rm -rf components/sows/`; `rm components/workspace/panels/SOWPanel.tsx`
22. [ ] **Prune openai.ts** — remove `generateSOWSections()`, related types, and any SOW-only prompt helpers
23. [ ] **Prune sow-utils.ts** — extract any non-SOW helpers (role permission checks, etc.) to a new home if reused elsewhere; then delete `lib/sow-utils.ts`
24. [ ] **Workspace shell** — remove SOW nav from `WorkspaceLayout.tsx`, `DocumentDirectory.tsx`; drop `sowCreated` progress step; renumber remaining steps
25. [ ] **Parent page cleanup** — drop `SOWPanel` import, `generatingSOW`, `handleGenerateSOW`, `handleSaveSOW`, `handleSaveSOWAndRefresh`, `handleSOWStatusChange`, `activePanel === 'sow'` case, `emailContext.sowSynopsis`, `emailTemplateType === 'sow_delivery'`
26. [ ] **Breadcrumbs** — remove `/sows` handling
27. [ ] **EmailDraftPanel** — drop `'sow_delivery'` from the template-type union only if TS requires; **no template body changes**
28. [ ] **Email send route** — remove any SOW-attachment paths from `app/api/email/send/route.ts`
29. [ ] **Admin page** — remove SOW admin views if present in `app/admin/page.tsx`
30. [ ] **Final grep** — `grep -rn "SOW\|generateSOWSections\|SOWPanel\|/sows\|sowCreated" app/ components/ lib/` returns only deliberately-preserved matches (schema comments, historical migrations)
31. [ ] **Verify Email is untouched** — `git diff components/workspace/panels/EmailDraftPanel.tsx` shows at most the one template-type literal removal; template body byte-identical
32. [ ] **Type check** — `npx tsc --noEmit` clean

## Validation Strategy

### Automated
- `npx tsc --noEmit` — must be clean
- Ad-hoc: `computePricingSheet` sanity asserts in `lib/pricing.ts` verified during type-check by a top-level `if (process.env.NODE_ENV === 'test')` block, or a lightweight `scripts/verify-pricing.ts`

### Manual User Journey
1. Open an unprocessed opportunity → Summary tab
2. Click **"Process opportunity"** → in one action, attachment parse + brief + resource plan (with per-professional JDs) + attachment-relevance classification all run in parallel (~20–30s)
3. Beneath the Brief, see a **Resource Plan** card grouped into Professionals, Subcontracted Trades, Materials/Equipment, Prime Overhead
4. Each row shows label, value-description, quantity, risk chip, estimated cost; scannable in under 10 seconds
5. Click the chevron on any **Professional** row → row expands to reveal the full **Job Description** — title, seniority, summary, responsibilities, required + preferred qualifications, place/schedule, comp basis, reporting line
6. Every JD field is inline-editable; edits auto-save on blur; "Copy" copies clean plain text; "Regenerate" reruns the JD prompt for that one line
7. Beneath the plan, the **Pricing Sheet** shows cost basis total, aggregate risk, target margin %, and a recommended bid price
8. Drag the risk-to-margin slider → recommended bid price updates live; the override persists after refresh
9. Edit the low/medium/high margin-band percentages → all lines recompute; persist after refresh
10. On any Professional / Subcontracted-Trade row, click "Find vendors" → navigates to the Subcontractors panel and scoped discovery runs using that line's `searchQueries`; discovered vendors are tagged with the line
11. Return to the Summary → the line now shows the linked vendor(s) count
12. Open the **Email tab** for the first time after processing → the correct government attachments are already pre-checked (per the AI's `attachmentRelevance` verdicts); the email template body is visually identical to what it was before this feature shipped
13. Toggle any checkbox → user override wins; template body still unchanged
14. Reload the page → resource plan, JDs, pricing sheet, slider position, vendor links, and email checkbox selection all persist
15. Confirm the workspace nav no longer contains an "SOW" item; visiting `/opportunities/[id]?panel=sow` (any old bookmark) redirects to `?panel=summary`; visiting `/sows` returns a 404
16. Open a pre-existing opportunity that has no resource plan → discovery still works via the NAICS-map fallback (backwards compatible)

## Notes / Guardrails
- Cap the model output to 20 lines. If it wants more, it must consolidate.
- All costs are **prime's internal estimate** at this stage — not a quote. Actual quotes still flow through `Subcontractor.quotedAmount` and can replace `estimatedTotalCost` for that line's linked vendor.
- Bonding and insurance overhead cost estimates come from the model's best guess seeded from `estimatedValue` (typical: 1–3% of contract value for a performance bond); flagged as `costSource: "estimate — replace before bid"`.
- The risk slider is *advisory*. The user can always override, but the underlying `targetMarginPct` remains visible so they know when they're deviating from the algorithm.
- Do not auto-run resource-plan generation on page load — always user-triggered (via "Process opportunity") or as part of the SOW pipeline.
- Follow the **stone-only** color rule. Only the risk-High chip uses amber; nothing else deviates from stone.
- Follow the **wire-what-the-UI-implies** rule (project memory): every field on each line is editable inline — no "coming soon" placeholders.
- **Email template is off-limits.** No edits to subject templates, body templates, greeting, sign-off, or `EmailDraftPanel` markup. The only allowable change is behavioral — the pre-checked attachment set now comes from `attachmentRelevance` on first render after processing (which is already implemented; processing just guarantees it exists).
- **SOW is removed from the running app** (routes, pages, panel, components, prompts). The DB tables remain — they hold historical data and dropping them mid-flight is unnecessary risk. A separate follow-up plan can drop the tables once we've been off SOWs for a while.
- **Job descriptions are only for `professional` category lines.** Subcontracted trades receive the government's own attachments via the master email; materials, equipment, and prime overhead don't get JDs.
- **JDs are generated inline with the resource plan** (same GPT-4o call) to guarantee consistency between the role summary and the JD. On-demand regeneration is available per-line for the edge cases where the initial JD needs a rewrite.
