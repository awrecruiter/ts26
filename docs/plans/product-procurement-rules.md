# Plan: Product Procurement Rules (Auto-Detected + Generalized Pipeline)

## Goal
Auto-detect whether an opportunity is a **product/supply procurement** or a **services contract** and generalize the existing Resource Plan pipeline so a single flow produces the right categories, prompts, vendor searches, and UI for both types.

## Motivation
The current Resource Plan pipeline is service-centric: it assumes labor to orchestrate, produces per-professional Job Descriptions, and drives Google Places to find local subcontractors. Real SAM.gov opportunities include product buys (uniforms, fittings, spare parts, IT equipment) where none of that applies — the prime is a reseller/distributor absorbing supply-chain risk, not orchestrating a workforce. Ignoring this results in nonsensical resource plans (fake "HVAC technician" lines for a hardware buy) and dead vendor searches.

## Design Decisions
| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Detection uses the existing `isProductSolicitation()` helper — do not rewrite | PSC-first + NAICS + title-keyword logic already exists as dead code; wiring it in is cheap |
| 2 | Cache the classification on the `Opportunity` row as `contractType` (enum) + `contractTypeReason` (string) | Avoid re-running detection on every render; keep the reason visible for audit / user override |
| 3 | Two values only: `SERVICES` (default) and `PRODUCT`. No `HYBRID`. | Ambiguous contracts fall through to SERVICES, which produces a superset of categories. Introducing HYBRID triples branch complexity for limited gain |
| 4 | Generalize `ResourceCategory` by ADDING new values, not replacing — keeps backwards compatibility with existing plans | Existing plans keep working; the LLM chooses new categories when the contract is a product |
| 5 | New categories: `product`, `logistics_shipping`, `warranty_support` | Cover the three main product-side line types: the goods, freight/delivery, and post-delivery obligations |
| 6 | `generateResourcePlan()` receives `contractType` in its prompt and uses a **different category whitelist + rules** per type — one prompt, two branches | One codepath, one round trip. Cheaper than two prompts, and matches the "generalize" directive |
| 7 | Job Descriptions still ONLY populate on `professional` lines. Product plans typically have zero professional lines → zero JDs generated | Category-gated JD logic in the UI already exists — no new gating needed |
| 8 | Vendor discovery for product lines uses `SUPPLIER_TYPES` place types (already defined in `google-places.ts`) and search queries targeting distributors/manufacturers | The `searchQueries?: string[]` override path already exists — the LLM emits distributor-style queries when `contractType === PRODUCT` |
| 9 | Section grouping in `ResourcePlanCard` becomes dynamic — only render categories with ≥1 line, and section labels come from a category label map | Avoids empty "Professionals" section on product plans and empty "Products" section on service plans |
| 10 | Pricing math is unchanged. Risk-weighted margin math applies to product-side risk (single-source, delivery timing) exactly as it does to labor risk | The math is category-agnostic. Only the LLM's per-line risk rationale narrative changes |
| 11 | Prime overhead lines still auto-included on product plans (freight insurance, procurement PM time, cash-flow for advance orders) | Prevents the "invisible overhead" mistake for product buys too |
| 12 | User can override `contractType` on the opportunity if the auto-detection is wrong | The classification is best-effort; a manual toggle is a cheap safety net |

## Success Criteria
- [ ] Every `Opportunity` row has a `contractType` value (`SERVICES` \| `PRODUCT`) — backfilled for existing rows via a one-time script
- [ ] `contractType` is auto-detected on opportunity fetch/refresh via `isProductSolicitation()` (which becomes live code)
- [ ] The user can toggle `contractType` from the Opportunity Brief page — the toggle stores an explicit override that survives re-fetches
- [ ] `generateResourcePlan()` receives `contractType` and produces:
  - For `PRODUCT` opportunities: 0 professional lines, 0 subcontracted_trade lines, ≥1 product line, ≥1 logistics_shipping line (unless brief specifies pickup), ≥1 prime_overhead line
  - For `SERVICES` opportunities: existing behavior — no product/logistics/warranty categories emitted
- [ ] `ResourcePlanCard` groups + labels sections dynamically; empty sections don't render
- [ ] Vendor discovery for `PRODUCT` opportunities uses distributor/manufacturer place types + supplier-style search queries (LLM emits them per line); services flow unchanged
- [ ] A small badge on the Opportunity Summary panel shows the detected contract type ("Product procurement" or "Services contract") with the detection reason on hover
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Existing service-side flow is byte-identical for opportunities whose `contractType === 'SERVICES'`

## Context References
- `lib/opportunity-classification.ts` — houses `isProductSolicitation()`; will be extended to `classifyContractType()` returning `{ contractType, confidence, reason }`
- `lib/types/resource-plan.ts` — expand `ResourceCategory` union
- `lib/openai.ts` — `generateResourcePlan()` gets a `contractType` input and branches the prompt
- `lib/google-places.ts` — `findSubcontractorsForOpportunity()` already supports `searchQueries` override; no code change needed there
- `app/api/opportunities/fetch/route.ts` — call classifier when writing opportunities (initial cache)
- `app/api/opportunities/[id]/route.ts` (GET) — re-classify if `pscCode`/`naicsCode`/`title` changed since last classification and no user override exists
- `app/api/opportunities/[id]/resource-plan/route.ts` — pass `contractType` into `generateResourcePlan()`
- `app/api/opportunities/[id]/process/route.ts` — same
- `app/api/opportunities/[id]/subcontractors/discover/route.ts` — no code change (the LLM's per-line `searchQueries` already flow through)
- `components/workspace/panels/OpportunitySummaryPanel.tsx` — show contract-type badge + override control
- `components/workspace/panels/ResourcePlanCard.tsx` — dynamic section rendering
- `prisma/schema.prisma` — add `contractType`, `contractTypeSource`, `contractTypeOverride` to `Opportunity`

## Database Changes
- **Modified model:** `Opportunity`
  - `contractType String @default("SERVICES")` — cached classification result: `"SERVICES"` \| `"PRODUCT"`
  - `contractTypeSource String?` — one-line explanation (`"PSC code 5825 (products)"`, `"NAICS 337214 (manufacturing)"`, `"title keyword: 'furnish and deliver'"`, `"defaulted to services"`)
  - `contractTypeOverride Boolean @default(false)` — when true, auto-detection will not overwrite the user's manual choice
- Not using a Prisma enum — plain string keeps future values (like `CONSTRUCTION`) additive without a migration
- **Backfill script:** `scripts/backfill-contract-type.ts` — reads every existing `Opportunity`, runs `classifyContractType()`, writes `contractType` + `contractTypeSource` (leaves `contractTypeOverride = false`)
- **Migration:** DB is Render Postgres — use `npx prisma db push` (per project memory)

## API Routes
- **New:** `PATCH /api/opportunities/[id]/contract-type`
  - Auth required
  - Body: `{ contractType: 'SERVICES' | 'PRODUCT', override: true }` (setting override:false triggers re-classification from source data)
  - Persists and returns the new value
- **Modified:** `POST /api/opportunities/[id]/resource-plan`
  - Reads `contractType` off the opportunity and passes it to `generateResourcePlan()`
- **Modified:** `POST /api/opportunities/[id]/process`
  - Same — passes `contractType` into the resource-plan pass
- **Modified:** `POST /api/opportunities/fetch` (SAM.gov ingest)
  - After writing each opportunity, calls `classifyContractType()` and stores the result (only when `contractTypeOverride === false`)

## Function Changes

### `lib/opportunity-classification.ts`
- **Keep** existing `isProductSolicitation()` for backwards compatibility (it's already dead code, but harmless)
- **Add** `classifyContractType(input): { contractType: 'SERVICES' | 'PRODUCT'; source: string }`
  - Delegates to the existing PSC/NAICS/title-keyword tiers
  - Returns the wire-format contract type + a human-readable source string
  - Signature accepts `{ pscCode?, naicsCode?, title?, description? }` — no full Opportunity object required so it can be called from ingest and from scripts

### `lib/types/resource-plan.ts`
- Extend `ResourceCategory`:
  ```typescript
  export type ResourceCategory =
    | 'professional'
    | 'subcontracted_trade'
    | 'material'
    | 'equipment'
    | 'prime_overhead'
    // New for product procurement:
    | 'product'
    | 'logistics_shipping'
    | 'warranty_support'
  ```
- Add `ContractType = 'SERVICES' | 'PRODUCT'` type alias for reuse

### `lib/openai.ts`
- `generateResourcePlan(input)` — extend `input` with `contractType: ContractType`
- Split the "CATEGORIES" section of the prompt into two branches keyed on `contractType`:
  - **SERVICES branch** (existing):
    ```
    CATEGORIES (use these exact strings):
    - "professional" — individual role we'd hire
    - "subcontracted_trade" — whole business
    - "material" — consumables
    - "equipment" — rental or purchase of gear
    - "prime_overhead" — bonding, insurance, PM time, mobilization
    ```
  - **PRODUCT branch** (new):
    ```
    CATEGORIES (use these exact strings — this is a product/supply procurement):
    - "product" — the goods being procured (line per SKU family or bundle)
    - "logistics_shipping" — freight, delivery, packaging, HAZMAT handling
    - "warranty_support" — extended warranty, replacement parts stock, post-delivery obligations
    - "prime_overhead" — procurement PM time, cash-flow for advance orders, freight insurance
    DO NOT emit "professional", "subcontracted_trade", "material", or "equipment" for product procurements.
    Vendor search queries on product lines MUST target distributors, wholesalers, or manufacturers — not local service businesses.
    Do NOT produce Job Descriptions on any line.
    ```
- Response validation: reject any `professional` line when `contractType === 'PRODUCT'`; reject any `product`/`logistics_shipping`/`warranty_support` line when `contractType === 'SERVICES'`

## UI Components

### Modified: `components/workspace/panels/ResourcePlanCard.tsx`
- Category label map extended with new labels:
  ```typescript
  const CATEGORY_LABELS = {
    professional: 'Professionals',
    subcontracted_trade: 'Subcontracted Trades',
    material: 'Materials & Equipment',
    equipment: 'Materials & Equipment',
    prime_overhead: 'Prime Overhead',
    product: 'Products',
    logistics_shipping: 'Logistics & Shipping',
    warranty_support: 'Warranty & Support',
  }
  ```
- New CATEGORY_ORDER for product plans: `['product', 'logistics_shipping', 'warranty_support', 'prime_overhead']`
- Section grouping becomes: iterate CATEGORY_ORDER for the plan's contract type; only render sections that have ≥1 line
- Row-level UI is category-gated already (chevron/JD only for `professional`) — no change to row rendering
- Icons: reuse "boxes" icon for `product`, add a small "truck" icon for `logistics_shipping`, and a "shield-check" for `warranty_support` (stroke-only SVG, stone palette)

### Modified: `components/workspace/panels/OpportunitySummaryPanel.tsx`
- Add a small pill next to the Brief card title:
  - `Services contract` (stone-100 / stone-700) or `Product procurement` (stone-100 / stone-700) — no other color families
  - Hover tooltip shows `contractTypeSource`
  - Clicking the pill opens a small popover with "Change to Services / Product" radio + "This overrides auto-detection" note
- New prop `onUpdateContractType(nextType)` — calls `PATCH /api/opportunities/[id]/contract-type` and refetches
- No layout changes beyond the pill

### Modified: `app/opportunities/[id]/page.tsx`
- New handler `handleUpdateContractType(nextType)` — PATCHes and refetches
- Thread as `onUpdateContractType` to `<OpportunitySummaryPanel>`

## Detection Wiring

```
[SAM.gov fetch] ─► classifyContractType(rawOpportunity) ─► Opportunity.contractType (if !override)
                                                     └──► Opportunity.contractTypeSource

[User toggles pill] ─► PATCH /api/.../contract-type { contractType, override: true }
                                                   └──► Opportunity.contractTypeOverride = true

[Generate resource plan] ─► pass Opportunity.contractType into generateResourcePlan()
```

If `contractTypeOverride === true`, subsequent fetches / re-classifications are no-ops for this row.

## Implementation Task List

### Phase A — Classification wiring
1. [ ] **Types + helper** — extend `lib/opportunity-classification.ts` with `classifyContractType()`; add `ContractType` type alias to `lib/types/resource-plan.ts`
2. [ ] **Schema** — add `contractType`, `contractTypeSource`, `contractTypeOverride` to `Opportunity`; `npx prisma db push`
3. [ ] **Backfill script** — `scripts/backfill-contract-type.ts`; run once (dry-run flag + real run)
4. [ ] **Ingest wiring** — `app/api/opportunities/fetch/route.ts` calls `classifyContractType()` after writing each opportunity, gated on `!contractTypeOverride`
5. [ ] **PATCH route** — `app/api/opportunities/[id]/contract-type/route.ts` — accepts explicit override
6. [ ] **Type check checkpoint** — `npx tsc --noEmit` clean

### Phase B — Generalized Resource Plan
7. [ ] **Extend ResourceCategory** — add `product`, `logistics_shipping`, `warranty_support` to `lib/types/resource-plan.ts`
8. [ ] **Split the prompt** — `generateResourcePlan()` in `lib/openai.ts` gets a `contractType` input and switches the CATEGORIES + rules block
9. [ ] **Response validation** — reject cross-type category emissions (log + drop the offending lines, keep the rest)
10. [ ] **Pass through routes** — `resource-plan/route.ts` (POST) + `process/route.ts` read `contractType` off the opportunity and pass to `generateResourcePlan()`

### Phase C — UI
11. [ ] **Category labels + icons** — extend `ResourcePlanCard.tsx` maps; add truck + shield-check SVGs
12. [ ] **Dynamic section rendering** — filter empty sections; use per-type CATEGORY_ORDER
13. [ ] **Contract-type pill** — new component `ContractTypePill.tsx` inside `OpportunitySummaryPanel.tsx` (or inline — user preference is inline unless the file gets unwieldy)
14. [ ] **Parent page handler** — `handleUpdateContractType` in `app/opportunities/[id]/page.tsx`
15. [ ] **Type check + manual QA**

## Validation Strategy

### Automated
- `npx tsc --noEmit` — clean
- Backfill script has a `--dry-run` mode that prints classification results without writing

### Manual User Journey
1. Open an existing services opportunity → pill reads "Services contract" → hover shows detection reason
2. Click "Process opportunity" (if the button is still present) or "Generate Resource Plan" → plan produces professional/trade/material/overhead lines exactly as before (byte-identical UX for services flow)
3. Open a **product** opportunity (e.g., a NAICS 337214 furniture buy or PSC 7110) → pill reads "Product procurement" → hover shows the PSC/NAICS reason
4. Generate the resource plan → the plan has `product`, `logistics_shipping`, `prime_overhead` sections; no "Professionals" section renders; no Job Descriptions appear
5. On a product line, expand the overflow menu → "Find vendors" (if re-enabled per prior instruction) uses distributor/manufacturer queries when scoped discovery runs
6. Click the pill → override to "Services contract" → the pill locks (override=true) → regenerate → categories switch to the services set
7. Toggle back to Product → override still true → source note reads "user override"
8. Reload the page → all state persists
9. Confirm `npx tsc --noEmit` is clean

## Notes / Guardrails
- **No breaking change for existing plans.** Existing `resourcePlan` JSON blobs remain valid; the additive category values don't invalidate anything.
- **Ingest classification is idempotent.** Re-running it produces the same output for the same source data.
- **Override respects user intent.** Once a user explicitly picks a contract type, auto-classification stops fighting them for that row.
- **Product plans skip JD generation entirely.** The prompt prohibits it; the response validator drops any stray JD.
- **No new pricing math.** Risk-weighted margin math and the slider work identically. Only the LLM's per-line risk rationale narrative shifts (supply-chain risk vs labor risk).
- **Stone-only palette.** The pill uses stone-100/stone-700 for both variants; no color families introduced. Icons are stroke-only.
- **No new panel or route beyond the PATCH.** The Resource Plan surface adapts in place.
