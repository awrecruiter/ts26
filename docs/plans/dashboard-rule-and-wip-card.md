# Plan: Dashboard Entry Rule + WIP-First Opportunity Card

Three related changes:

1. **Redefine `engaged` in place:** an opportunity is "engaged" only when at least one of its subcontractors has a non-null `sowSentAt`. Same param name; both existing callers (the dashboard page and the agent widget) keep working.
2. **Manual "Mark SOW sent" control** on each vendor card, so a user who sent the SOW off-platform (email client, etc.) can still flip the on-platform record without going through the on-platform send flow.
3. **Opportunity card layout:** the past-awards (Comparables) module leaves the inside of the card and becomes a sibling column attached to the right. The space it freed inside the card is replaced by a WIP status module (stage, completion bar, next action).

---

## Goal
Make the dashboard a real work-in-progress board. Entry is gated on "subs have actually been emailed" (so pure-discovery noise doesn't dilute the view), the WIP state of each opportunity becomes visible at a glance, and the comparables data still travels with the card but no longer crowds it.

## Why now
Dashboard widgets phase (4.7) is up next per `IMPLEMENTATION_PLAN.md`, and the card itself is doing too much: comparables crowd the assessment block while workflow state is invisible — exactly the data the dashboard is supposed to surface. Also, the existing "engaged" filter currently matches "anything goes" (any SOW / bid / sub / progress / assessment), so the dashboard fills with discovery-stage records that aren't actually being worked.

## Success Criteria
- [ ] `GET /api/opportunities?engaged=true` returns only opportunities with at least one `Subcontractor` row where `sowSentAt IS NOT NULL`. Both existing callers (`app/dashboard/page.tsx`, `components/dashboard/AgentDashboard.tsx`) automatically benefit; no UI param change.
- [ ] The Subcontractor PATCH endpoint accepts `sowSent: boolean` and toggles `sowSentAt` accordingly (true → `new Date()`, false → `null`).
- [ ] The active-vendor card in `SubcontractorPanel` shows a small **"Mark sent"** action (link-style button) next to the Step 2 send block. Clicking it stamps `sowSentAt` via PATCH and optimistically moves the vendor card to Pending without a server round-trip wait.
- [ ] The `OpportunityCard` body width does not change. Comparables is removed from the inside of the card; everything else (header / description / assessment metrics / meta / footer) stays within the current card width.
- [ ] A new **WIP status** module appears in the slot the comparables tile used to occupy (`col-span-2` of the assessment grid). It shows: stage chip, completion %, a thin progress bar, and the top next-action string when available.
- [ ] A **side column** is attached to the right of the card containing the comparables module — same vertical height on desktop, stacks below the card on narrow viewports (`<sm`).
- [ ] Clicking either the card body or the side column navigates to the opportunity workspace (matches today's whole-card link behavior).
- [ ] `npx tsc --noEmit` clean.
- [ ] `/opportunities` list (which reuses `OpportunityCard`) renders with the new layout too — both surfaces benefit. The list page does not pass `engaged=true`, so it still shows the full library.

## Context References
- `app/api/opportunities/route.ts:33` — reads `engaged` param
- `app/api/opportunities/route.ts:108-120` — current "anything goes" engaged filter to replace
- `app/dashboard/page.tsx:97,117,175,197` — existing `engaged=true` send-sites (no edits needed after redefinition)
- `components/dashboard/AgentDashboard.tsx:63` — existing `engaged=true` send-site (no edits needed)
- `app/api/opportunities/[id]/subcontractors/[subId]/route.ts` — PATCH route that already handles `callCompleted`, `email`, `workflowCompleted` etc. — extend with `sowSent`
- `prisma/schema.prisma:310-393` — `Subcontractor` model (no schema change; field exists)
- `components/workspace/panels/SubcontractorPanel.tsx:1069-1095` — Step 2 send-SOW block where the "Mark sent" link will sit
- `components/workspace/panels/SubcontractorPanel.tsx:498-524` — existing `handleSendSOW`; the manual flow mirrors this shape but PATCHes instead of calling `onSendSowDirect`
- `app/opportunities/[id]/page.tsx` — owns the `subcontractors` state; needs an optimistic updater for the new manual-mark action
- `components/opportunities/OpportunityCard.tsx:39-77` — props (add `progress`)
- `components/opportunities/OpportunityCard.tsx:230-273` — comparables tile that moves out to the side column
- `components/opportunities/OpportunityCard.tsx:349-456` — assessment grid where WIP module slots in
- `app/api/opportunities/route.ts:139-170` — Prisma `include` block; add `progress` selector

## Database Changes
None. `sowSentAt` and `OpportunityProgress` both already exist.

## API Routes

### Modified: `GET /api/opportunities`
- The `engaged` filter block is replaced with:
  ```ts
  if (engaged) {
    where.subcontractors = { some: { sowSentAt: { not: null } } }
  }
  ```
- Extend the `include` block with `progress: { select: { currentStage: true, completionPct: true, nextActions: true } }` so the card can render WIP without an extra round-trip.

### Modified: `PATCH /api/opportunities/[id]/subcontractors/[subId]`
- Add handling for `body.sowSent`:
  ```ts
  if (body.sowSent !== undefined) {
    updateData.sowSentAt = body.sowSent ? new Date() : null
  }
  ```
- All other existing body keys keep working unchanged.

## UI Components

### Modified: `components/workspace/panels/SubcontractorPanel.tsx`
- A new prop `onMarkSowSent?: (sub: Subcontractor) => Promise<void>` (callback to the parent, mirrors `onSendSowDirect`).
- Step 2 block (`:1069-1095`) gains a secondary control below the **Send SOW** button:
  ```
  Send SOW  [button]
  Already sent it off-platform? · Mark sent
  ```
  The "Mark sent" is a small underlined text button (`text-[11px] text-stone-500 hover:text-stone-800 underline underline-offset-2`). Disabled when `sub.sowSentAt` is already set.
- Click handler:
  - Synchronous guard via `sendInFlightRef.current` (same pattern as `handleSendSOW`).
  - Calls `onMarkSowSent(sub)` if present; the parent does the PATCH and the optimistic state update.
  - Shows the same inline error UI on failure as `handleSendSOW` (reuse `setSendError`).

### Modified: `app/opportunities/[id]/page.tsx`
- New handler `handleMarkSowSent(sub)`:
  - Optimistically sets `sub.sowSentAt = new Date().toISOString()` in local subcontractors state (matches today's vendor-card optimism per memory).
  - PATCHes `/api/opportunities/[id]/subcontractors/[subId]` with `{ sowSent: true }`.
  - On failure: revert and surface the error via the existing send-error channel.

### Modified: `components/opportunities/OpportunityCard.tsx`
- Add `progress?: { currentStage: string | null; completionPct: number; nextActions: any }` to the props type
- New file-local `WIPStatusTile` sub-component — renders stage chip + completion % + thin progress bar + first next-action line. Falls back to "No progress recorded yet" when `progress` is null.
- New file-local `ComparablesAside` sub-component — takes the comparables tile, the show-all-awards expander, and the saved-estimate line. Internal state for `expanded` / `awards` / `loadingAwards` / `awardsError` moves into the aside.
- Restructure outer layout: replace the single `<Link>` with a flex wrapper that holds two `<Link>` siblings (same `href`): left = current card body, right = side column. On mobile (`<sm`) they stack; on desktop the aside is `w-64` with a thin `border-l border-stone-200` so the two read as one unit.
- Replace the `col-span-2` comparables slot inside the assessment grid with `<WIPStatusTile progress={progress} />`. The remaining tiles reflow from `grid-cols-2 sm:grid-cols-5` → `grid-cols-2 sm:grid-cols-4`.

### Unchanged
- `app/dashboard/page.tsx` (admin role) and `components/dashboard/AgentDashboard.tsx` (AGENT/VIEWER roles) — both already send `engaged=true`; meaning silently switches. Both dashboards adopt the new rule with zero edits to either file's filter wiring.
- `/opportunities` list page — does not pass `engaged=true`, still shows the full library; benefits from the new card layout automatically.
- Workspace page (other panels), SOW flow, bid flow — unaffected.

## Cleanup of currently-dashboarded opportunities
No separate cleanup task is required. Under the old rule any opportunity with an assessment / SOW / bid / progress record / subcontractor was "engaged"; under the new rule only opportunities with at least one subcontractor whose `sowSentAt` is non-null qualify. Every record that was previously on the dashboard for any other reason fails the new check and drops off automatically on the first request after deploy. No migration, no DELETE queries, no admin script.

## Implementation Task List
1. [ ] `app/api/opportunities/route.ts` — replace `engaged` filter body with `{ subcontractors: { some: { sowSentAt: { not: null } } } }`; add `progress` to the include block
2. [ ] `app/api/opportunities/[id]/subcontractors/[subId]/route.ts` — accept `sowSent: boolean` in PATCH body, write `sowSentAt`
3. [ ] `app/opportunities/[id]/page.tsx` — `handleMarkSowSent` with optimistic update + revert-on-error; pass `onMarkSowSent` to `SubcontractorPanel`
4. [ ] `components/workspace/panels/SubcontractorPanel.tsx` — accept new prop, render "Mark sent" secondary link below Send SOW button, wire click
5. [ ] `components/opportunities/OpportunityCard.tsx` — add `progress` prop, extract `ComparablesAside`, build `WIPStatusTile`, restructure outer layout to two-column flex
6. [ ] Manual eyeball on `/opportunities` to confirm the new layout doesn't regress
7. [ ] Type check: `npx tsc --noEmit`

## Validation Strategy

### Automated
- `npx tsc --noEmit`

### Manual User Journey — dashboard rule
1. Sign in. Visit `/dashboard`. Note the current count.
2. Open an opportunity that has subcontractors but none with `sowSentAt`. Verify it does **not** appear on the dashboard.
3. In the vendor panel, click **Mark sent** under the Send SOW block for one vendor. The vendor card optimistically flips to Pending.
4. Return to `/dashboard` — the opportunity now appears.
5. Visit `/opportunities` — both the pre-send and post-send opportunities appear there (the list page is unfiltered).

### Manual User Journey — card layout
1. On `/dashboard`, every card has a left column with the WIP tile in the assessment block (stage chip, % progress bar, next action) and a side column on the right with the comparables module.
2. Card body width (left column) is unchanged.
3. Click on the side column → routes to the same workspace as clicking the card body.
4. Resize to mobile width — side column stacks below the card body.
5. For an opportunity with no `OpportunityProgress` row, the WIP tile shows "No progress recorded yet"; layout doesn't collapse.

### Edge cases
- Vendor manually marked sent, then user wants to revert: clicking again is disabled. Reverting "sent" status is out of scope (matches the existing on-platform send flow which also doesn't unsend).
- Opportunity has `sowSentAt` on a Subcontractor that gets deleted (cascade): the dashboard rule re-evaluates on every query, so it stops being eligible. Expected.
- Card with comparables = `insufficient` → side column still renders with the existing fallback message.
- Multiple subcontractors with `sowSentAt` → Prisma `some` clause is fine; one card per opportunity.

## Out of Scope
- Designing the dashboard summary widgets at the top of `/dashboard` — Phase 4.7's main scope, separate plan
- A "mark as unsent" flow (undoing the optimistic flag)
- An audit log of who marked sent when (could be useful later; defer)
- Adding the engaged rule to the `/opportunities` list (intentionally a library view)
- Persisting card UI state (e.g. comparables-aside expanded) across reloads
