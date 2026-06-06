th# Plan: Vendor Workflow Step Numbering + Role Gating + Quote Count (Phase 4.4.1)

## Goal
Three coupled changes that make the agent's journey readable at a glance, scope their authority correctly, and surface progress:

1. **Number the journey** — macro (1–5 workspace stages) and micro (1–3 per-vendor actions). Both layered onto existing UI elements, no new components.
2. **Restrict bid submission to admins** — agents can build the bid; only role=ADMIN can mark it SUBMITTED. Stage 5 disappears for non-admins and the Submit button in BidEditorPanel becomes admin-only.
3. **Track and display the quote-request count per opportunity** — each successful "Send SOW" email stamps `sowSentAt` on the subcontractor; the count surfaces in the SubcontractorPanel header.

### Macro numbering (1 → 5)
The five workspace stages already shown in the top progress bar — `SOW · Subs · Quotes · Bid · Submit` — get numbered so the agent always sees where they are in the bid lifecycle. For non-admins, the bar reads `1 SOW · 2 Subs · 3 Quotes · 4 Bid` only — Stage 5 is hidden so they aren't promised a button they can't press.

### Micro numbering (1 → 3)
Inside Stage 2 (Subs), each expanded vendor card's three actions — `Call · Capture Email · Send SOW` — get numbered so the per-vendor workflow reads itself.

The macro bar already exists (`WorkspaceLayout.tsx:117-142`) and renders via a tiny `ProgressStep` component (`WorkspaceLayout.tsx:255`) — we extend it. The micro steps live inside `SubcontractorPanel.tsx`'s expanded card — we add an inline `StepBadge` helper.

## Why two layers and not three
The panel-level flow within Stage 2 (Find Vendors → triage list → expand a card → pending divider) is already linear top-to-bottom and visually self-explanatory. Adding a third tier of letters/sub-numbers (2a, 2b, 2c) would add noise without information. Keep it macro + micro.

## Role model
`session.user.role` is one of `AGENT | ADMIN | VIEWER` (`prisma/schema.prisma:60-64`). Only `ADMIN` may submit bids. AGENT and VIEWER never see the Submit affordance — neither in the macro bar nor in `BidEditorPanel`. There's no third "request submission" workflow in this phase; if an agent needs a bid pushed live, the admin marks it submitted manually. (A formal "request submission → admin approves" flow is a future phase, scaffolded by the existing `BidApprovalRequest` model but not wired here.)

## Success Criteria
- [ ] **Admin** sees workspace progress bar `1 SOW · 2 Subs · 3 Quotes · 4 Bid · 5 Submit` with numbered badges that flip to a check when their stage is complete.
- [ ] **Agent** sees workspace progress bar `1 SOW · 2 Subs · 3 Quotes · 4 Bid` only — Stage 5 is hidden.
- [ ] The expanded vendor card reads `1 Call · 2 Email · 3 Send SOW` with badges in three states: done (check), current (filled with number), pending (dimmed with number).
- [ ] `BidEditorPanel`'s "Mark as Submitted" button only renders when `session.user.role === 'ADMIN'`. Agents see the bid through `REVIEWED` status and no further action.
- [ ] The SubcontractorPanel header (or a nearby visible spot) reads `X of Y quotes requested` where X = subs with `sowSentAt !== null` and Y = total subs for the opportunity.
- [ ] When an email is sent via `/api/email/send` with `subcontractorId` present and the SOW PDF attached, the subcontractor's `sowSentAt` is set to `new Date()` exactly once (idempotent — re-sends don't reset it; or reset it on every send, whichever ends up matching PRD §3.18 better; default: set on first success, leave on subsequent sends).
- [ ] No new wrapper elements, no new headers, no new colored boxes for the numbering layer. Numbering rides on the existing button/input/ProgressStep.
- [ ] Existing stone-only palette preserved — no new color introductions.
- [ ] No new dependencies, no new icons beyond what's already imported.
- [ ] No TypeScript errors (`npx tsc --noEmit`).
- [ ] No behavioral change to the per-vendor workflow other than the `sowSentAt` stamp.

## Current State

### Macro layer — workspace progress bar
`components/workspace/WorkspaceLayout.tsx:117-142` renders a horizontal row of five `ProgressStep` components, each a 16px dot + label:

| Stage | Label | Completion field |
|---|---|---|
| 1 | SOW | `progress.sowCreated` |
| 2 | Subs | `progress.subcontractorsFound` |
| 3 | Quotes | `progress.quotesReceived` |
| 4 | Bid | `progress.bidCreated` |
| 5 | Submit | `progress.bidSubmitted` |

`ProgressStep` (`WorkspaceLayout.tsx:255-272`) takes `{ label, completed }`. When `completed`, it draws a stone-600 dot with a white check. When not, it draws a stone-200 empty dot. There's no number rendered, so the agent has to read the labels to know the order.

### Micro layer — expanded vendor card
`components/workspace/panels/SubcontractorPanel.tsx` lines 844–1050 render an expanded vendor card with a single `"Vendor Workflow"` uppercase header followed by three vertically stacked actions:

| # | Element | Renders when | File:line |
|---|---------|--------------|-----------|
| 1 | "Call {phone}" anchor button (or green "✓ Called" badge after) | Always (label flips post-call) | `SubcontractorPanel.tsx:849` |
| 2 | Email text input + Save button | `callDone === true` | `SubcontractorPanel.tsx:998` |
| 3 | "Send SOW" primary button (or dimmed gate) | `callDone === true` | `SubcontractorPanel.tsx:1024` |

The user sees three unrelated-looking widgets under a single header. There's no visual cue that they're a sequence — the relationship is implicit and only visible by reading the labels.

## Design Decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | Use a small numbered badge as the **leading visual** of each existing action row. No new wrapper. | "Baked-in" — number sits inside the existing flex row, leftmost. |
| 2 | Badge is a 20px circle: `h-5 w-5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0`. | Matches the visual weight of existing icons in the panel. |
| 3 | Three states based on workflow progress, no new colors: <br>• **Done** → `bg-stone-800 text-white` + check icon (no number) <br>• **Current** → `bg-stone-800 text-white` + number <br>• **Pending** → `bg-stone-100 text-stone-400` + number | All stone palette. Matches the email-gate illumination pattern from `ed4d859`. |
| 4 | Remove the existing `"Vendor Workflow"` uppercase header. The numbered badges make it obvious. | Header is now redundant noise. |
| 5 | Step 2 (Email) badge sits to the **left of the input wrapper**, not inside it. Step 3 (Send SOW) badge sits to the left of the button. The existing `flex` rows already accommodate this. | No layout reshuffle. |
| 6 | "Step Done" check icon reuses the existing inline check SVG already used at line ~866 for the "✓ Called" badge. | No new icons. |

## State Derivation

Inside the existing `{[...activeVendors, ...pendingVendors].map(...)` block, after `callDone`, `hasEmail`, `canSendSOW` are computed:

```ts
const stepState = (n: 1 | 2 | 3): 'done' | 'current' | 'pending' => {
  if (n === 1) return callDone ? 'done' : 'current'
  if (n === 2) return !callDone ? 'pending' : (hasEmail ? 'done' : 'current')
  return !canSendSOW ? 'pending' : 'current'
}
```

Step 3 never reaches 'done' in this view — sending the SOW transitions the vendor card into a different post-send state managed elsewhere. That's fine; 'current' means "ready to fire."

## Reusable Component (Inline, Same File)

Define inside `SubcontractorPanel.tsx` (not a new file — "no new elements" intent):

```tsx
function StepBadge({ n, state }: { n: 1 | 2 | 3; state: 'done' | 'current' | 'pending' }) {
  const base = 'h-5 w-5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0'
  if (state === 'done') {
    return (
      <span className={`${base} bg-stone-800 text-white`} aria-label={`Step ${n} complete`}>
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  const classes = state === 'current'
    ? `${base} bg-stone-800 text-white`
    : `${base} bg-stone-100 text-stone-400`
  return <span className={classes} aria-label={`Step ${n}`}>{n}</span>
}
```

This is a function declared inside the module, not a new exported component or file.

## File-Level Changes

### `components/workspace/WorkspaceLayout.tsx` — macro numbering + admin-gated Stage 5

1. **`ProgressStep` signature change (~line 255)** — extend to accept an optional `n` prop:
   ```tsx
   function ProgressStep({ n, label, completed }: { n?: number; label: string; completed?: boolean }) { ... }
   ```
2. **Inside the badge circle (~line 258-266)** — change from "empty when not complete" to "show the number when not complete":
   - Completed → render existing check icon (unchanged)
   - Not completed + `n` present → render `<span className="text-[10px] font-semibold text-stone-500">{n}</span>` inside the dot
   - Bump circle from `w-4 h-4` to `w-5 h-5` so a digit fits cleanly (still small, still subtle). Update icon size from `w-2.5 h-2.5` to `w-3 h-3` to match.
3. **Add an `isAdmin` prop** to `WorkspaceLayout` (`{ isAdmin?: boolean }`) — passed down from the opportunity page. Default `false` so anonymous/missing context errs on the side of hiding admin-only UI.
4. **Call sites (~lines 129-133)** — pass `n` 1–5 to each; conditionally render Stage 5:
   ```tsx
   <ProgressStep n={1} label="SOW" completed={progress.sowCreated} />
   <ProgressStep n={2} label="Subs" completed={progress.subcontractorsFound} />
   <ProgressStep n={3} label="Quotes" completed={progress.quotesReceived} />
   <ProgressStep n={4} label="Bid" completed={progress.bidCreated} />
   {isAdmin && <ProgressStep n={5} label="Submit" completed={progress.bidSubmitted} />}
   ```
5. **Fix the progress percent denominator** (~line 98) — when `isAdmin === false`, exclude `bidSubmitted` from the `progressSteps` array so the bar isn't permanently capped at 80%.

### `app/opportunities/[id]/page.tsx`

- Read `useSession()` at the top of the component (it already does for other things; add if missing). Pass `isAdmin={session?.user?.role === 'ADMIN'}` into `<WorkspaceLayout>`.

### `components/workspace/panels/BidEditorPanel.tsx` — admin-only Submit

- Accept an `isAdmin?: boolean` prop.
- The button at line 252 (`onClick={() => onStatusChange('SUBMITTED')}`) only renders when `isAdmin === true`. For agents, the bid stays at `REVIEWED` and they see a small inline note: `"Ready for admin to submit"` (uses existing stone-400 text style — no new component).
- Update the dev-warning block added in `e986543` to also include `!isAdmin && bid.status === 'REVIEWED'` as an expected (non-warning) path — i.e. don't warn when a non-admin sees a Reviewed bid.
- Parent (`app/opportunities/[id]/page.tsx`) passes `isAdmin={session?.user?.role === 'ADMIN'}` to `<BidEditorPanel>`.

### `prisma/schema.prisma` + DB push — quote-request tracking

Add to the `Subcontractor` model:
```prisma
sowSentAt DateTime?
```
Push with `npx prisma db push` (per project memory — `migrate dev` doesn't work non-interactively on Render). Regenerate client.

### `app/api/email/send/route.ts` — stamp sowSentAt on success

The route already receives `subcontractorId` and currently discards it (line 154-155: `void subcontractorId`). Replace with:
- After `result.success` is true, if `subcontractorId` and `sowId` were both in the request, call:
  ```ts
  await prisma.subcontractor.update({
    where: { id: subcontractorId },
    data: { sowSentAt: new Date() },
  })
  ```
- Wrap in try/catch — a failed stamp must not fail the user's email. Log on error.

### `components/workspace/panels/SubcontractorPanel.tsx` — count display

At the top of the rendered vendor list (after the "Find Vendors" action bar, before the cards), add a one-line count summary:

```tsx
{vendors.length > 0 && (
  <p className="text-xs text-stone-500 mb-3">
    {vendors.filter(v => v.sowSentAt).length} of {vendors.length} quotes requested
  </p>
)}
```

Uses existing typography classes. No new component. Reads `sowSentAt` from the same vendor data the panel already loads. The `Subcontractor` type in the panel needs `sowSentAt?: string | null` added to match the new schema field.

### `components/workspace/panels/SubcontractorPanel.tsx` — micro numbering

1. **~line 847** — Delete the `<p>Vendor Workflow</p>` header. The numbered badges replace it.
2. **~line 850 (Step 1 row)** — Wrap the Call button + "✓ Called" badge in a `flex items-center gap-3` row, prepended with `<StepBadge n={1} state={stepState(1)} />`. The existing button doesn't change.
3. **~line 998 (Step 2 row)** — Move the existing input + Save button into a `flex items-center gap-3` row, prepended with `<StepBadge n={2} state={stepState(2)} />`. Keep all existing behavior.
4. **~line 1024 (Step 3 row)** — Wrap the existing single "Send SOW" button in a `flex items-center gap-3` row, prepended with `<StepBadge n={3} state={stepState(3)} />`. Button keeps its current `w-full` minus the badge's 20px — switch to `flex-1` so it fills remaining width.
5. **Add `stepState` helper** in the same scope as `hasValidEmail` (~line 308).
6. **Add `StepBadge` function declaration** at the top of the file scope (after imports, before the panel function), or inline-define inside the panel — either is fine since it's purely visual and only used here.

### Why not share one badge component across both files
The macro badge (16→20px, just done vs pending) and the micro badge (20px, three states — done/current/pending) have different state machines. Extracting a shared component would require parameterizing both shape and state-space, which is more code than two inline 10-line helpers. Keep them adjacent to where they're used.

## Out of Scope
- The collapsed vendor card (when not expanded) — no numbering there.
- The "Pending — Awaiting SOW / Quote" group divider above pending vendors — unchanged.
- Active vendors (pre-call) — they show the workflow stub but only Step 1 is interactive; the numbering still applies cleanly.
- Panel-level sub-numbering (Find Vendors → triage → expand) — see "Why two layers" above; intentionally skipped.
- Sidebar panel-nav tabs (Summary / Scope / SOW / Subs / Bid / Email) — these are navigation, not workflow. No numbering.
- A "current stage" highlight on the workspace bar — would require knowing which stage the agent is in based on `activePanel`. Possible follow-up, not in this plan.
- A "request submission" / approval workflow — `BidApprovalRequest` exists in the schema but wiring it is its own phase. For now agents stop at REVIEWED and admins submit directly.
- **AI bid package generation** — admin-triggered AI assembly of the full submission deliverable, gated on admin-selected winning quotes. Captured in `docs/plans/ai-bid-package-generator.md` for a future phase. This phase's admin-only Submit gate is the first step of that hand-off.
- Resetting `sowSentAt` when an admin demotes a sub or removes a SOW — `sowSentAt` is a record of "we asked them", not "they're still asked." Once set, it stays unless explicitly cleared by an API call. No UI for clearing in this phase.
- Quote-received tracking — separate metric (`quotedAmount` is already on the model). Out of scope here; the count shown is *requested*, not *received*.

## Manual QA

### Macro (workspace progress bar) — as ADMIN
1. Open an opportunity with no progress recorded → bar reads `1 SOW · 2 Subs · 3 Quotes · 4 Bid · 5 Submit`, all badges show numbers (none checked).
2. Generate a SOW → badge **1** flips to a check; badges 2–5 still show numbers.
3. Discover vendors → badge **2** flips to a check.
4. Continue through Quotes / Bid / Submit → each badge flips in sequence; the underlying progress fill grows.

### Macro (workspace progress bar) — as AGENT
5. Log in as a non-admin user. Open the same opportunity → bar reads `1 SOW · 2 Subs · 3 Quotes · 4 Bid` only (no Stage 5).
6. Progress fill reaches 100% when all four agent stages are complete (denominator excludes `bidSubmitted`).

### Bid submission gating
7. Open BidEditorPanel as AGENT with bid status `REVIEWED` → "Mark as Submitted" button is hidden; small note reads "Ready for admin to submit."
8. Same view as ADMIN → button is visible and clicking it transitions the bid to `SUBMITTED`.

### Quote-request count
9. Open SubcontractorPanel for an opportunity with 5 vendors, 0 SOWs sent → header reads `0 of 5 quotes requested`.
10. Send SOW to one vendor (full flow: expand card, mark call complete, enter email, click Send SOW, hit Send in email panel) → after the send succeeds and the page refreshes, header reads `1 of 5 quotes requested`. Inspect Prisma: that subcontractor row now has `sowSentAt` set.
11. Send to a second vendor → header reads `2 of 5 quotes requested`.
12. Force an email send failure (e.g. invalid Gmail token) → header count stays at 2; the sub's `sowSentAt` is NOT stamped.

### Micro (expanded vendor card)
1. Open an opportunity with at least one ACTIVE vendor (not yet called) and one PENDING vendor (called).
2. Expand an active vendor: badge **1** is filled/active, **2** and **3** are dimmed/pending.
3. Click Call → mark complete: badge **1** becomes a check, badge **2** becomes active.
4. Type an invalid email → badge **2** stays active, **3** stays dimmed.
5. Type a valid email → badge **2** becomes a check, badge **3** becomes active (illuminated button).
6. Refresh page → state persists (already covered by `5024261`); badges re-derive correctly.

### Cross-layer
7. With the workspace bar showing badge **2** as current (Subs stage incomplete), expand a vendor and verify the in-card 1/2/3 badges read independently — they're scoped to a single vendor, not the macro flow.

## Verification
- `npx tsc --noEmit` clean.
- Visual check on `https://usher-nextjs.vercel.app` after deploy on a real opportunity.
- No new color classes added (`grep -E 'gray-|slate-|zinc-|neutral-' WorkspaceLayout.tsx SubcontractorPanel.tsx` returns nothing new).
- No new files created in `components/` (`git status` shows only modified files).

## Estimated Effort
~75 minutes of edits + tsc + db push + deploy. Six files changed:
- `prisma/schema.prisma` — add `Subcontractor.sowSentAt DateTime?` (~1 line) + `prisma db push` + `prisma generate`.
- `components/workspace/WorkspaceLayout.tsx` — ProgressStep gets `n` prop, `isAdmin` prop on the layout, Stage 5 conditional, denominator fix (~15 lines).
- `app/opportunities/[id]/page.tsx` — pass `isAdmin` down to WorkspaceLayout and BidEditorPanel (~4 lines).
- `components/workspace/panels/BidEditorPanel.tsx` — accept `isAdmin`, gate submit button + inline note, adjust dev warning (~10 lines).
- `app/api/email/send/route.ts` — stamp `sowSentAt` on send success when `subcontractorId` present (~8 lines).
- `components/workspace/panels/SubcontractorPanel.tsx` — `StepBadge` helper, `stepState` derivation, 3 row wrappers, header removed, count summary line, `Subcontractor` type extended with `sowSentAt` (~45 lines).
