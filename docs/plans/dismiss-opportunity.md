# Plan: Dismiss Unwanted Opportunities

## Goal
Add a one-click "Dismiss" action that hides an opportunity from the default views on the dashboard and opportunities list, with a reversible "Show dismissed" toggle and a Restore button.

## Success Criteria
- [ ] Per-card Dismiss button on the dashboard and `/opportunities` list (hover/secondary action — doesn't get accidentally clicked).
- [ ] Dismiss button in the opportunity workspace header (`/opportunities/[id]`) — confirms before dismissing.
- [ ] Dismissed opps disappear from the default `status=ACTIVE` list.
- [ ] Status filter on both list pages gains a `Dismissed` option that surfaces the dismissed pile.
- [ ] Cards in the dismissed view show a `Restore` button that puts the opp back to `ACTIVE`.
- [ ] DB tracks `dismissedAt` so we can sort restorable list newest-first (and audit later if needed).
- [ ] `npx tsc --noEmit` clean.

## Context References
- `prisma/schema.prisma:107-152` — `Opportunity` model + `OpportunityStatus` enum (lines 192-197)
- `app/dashboard/page.tsx` — dashboard list (uses `OpportunityCard`)
- `app/opportunities/page.tsx` — opportunities list page (status filter dropdown line ~463-470)
- `app/opportunities/[id]/page.tsx` — workspace page
- `components/opportunities/OpportunityCard.tsx` — shared card
- `components/workspace/WorkspaceLayout.tsx` — workspace shell header (good spot for Dismiss button)
- `app/api/opportunities/[id]/route.ts` — existing PATCH/PUT handler we may extend

## Database Changes
Schema edits to `prisma/schema.prisma`:
```prisma
enum OpportunityStatus {
  ACTIVE
  EXPIRED
  AWARDED
  CANCELLED
  DISMISSED   // user-curated "not interested"
}

model Opportunity {
  // existing fields ...
  dismissedAt   DateTime?
  dismissedById String?
  dismissedBy   User?     @relation("DismissedBy", fields: [dismissedById], references: [id])
  // ...
  @@index([status])
  @@index([dismissedAt])
}

model User {
  // existing fields ...
  dismissedOpportunities Opportunity[] @relation("DismissedBy")
}
```

Migration command (per project convention — `migrate dev` doesn't work on Render):
```
npx prisma db push
npx prisma generate
```

## API Routes
**New:** `POST /api/opportunities/[id]/dismiss`
- Requires session.
- Sets `status = 'DISMISSED'`, `dismissedAt = now()`, `dismissedById = session.user.id`.
- Returns `{ opportunity }` so the client can patch its local cache.
- If already dismissed: idempotent 200 (no-op).

**New:** `POST /api/opportunities/[id]/restore`
- Requires session.
- Sets `status = 'ACTIVE'`, `dismissedAt = null`, `dismissedById = null`.
- Returns `{ opportunity }`.
- If not currently dismissed: idempotent 200.

**Modified:** `GET /api/opportunities` — confirm the existing `status` query param filter naturally accepts `DISMISSED`. No code change expected since it's already enum-pass-through; verify and add the enum value to any whitelist.

## UI Components

### `components/opportunities/OpportunityCard.tsx`
- Add a `Dismiss` button in the card's top-right corner — small, subtle: `text-stone-400 hover:text-stone-700`, X icon, `aria-label="Dismiss opportunity"`.
- When clicked: `e.preventDefault(); e.stopPropagation();` so it doesn't navigate, then POST to dismiss endpoint and call an `onDismissed?: (id: string) => void` prop so the parent list can drop the row optimistically.
- When the card represents a dismissed opp (`opportunity.status === 'DISMISSED'`): show **Restore** button in place of Dismiss + a subtle "Dismissed {date}" footer line.

### `app/dashboard/page.tsx` and `app/opportunities/page.tsx`
- Pass `onDismissed` to each `<OpportunityCard>` — handler removes the card from local list state (optimistic), reverts on error.
- Add `DISMISSED` as a `<option>` to the existing status `<select>` dropdowns (look for `<option value="ACTIVE">Active</option>` and friends; `/opportunities/page.tsx:468`).
- When `statusFilter === 'DISMISSED'`, the Dismiss icon becomes a Restore icon (handled in the card itself based on `opportunity.status`).

### `components/workspace/WorkspaceLayout.tsx` (workspace header)
- Add a `Dismiss this opportunity` action — small button or kebab-menu entry beside the existing header items.
- On click: `window.confirm('Dismiss this opportunity? You can restore it from the Dismissed view.')` → POST to dismiss endpoint → `router.push('/opportunities')`.
- If the opp is already DISMISSED, show "Restore" instead.

## Implementation Task List
1. [ ] Schema: add `DISMISSED` enum value + `dismissedAt`/`dismissedById` fields + `User` relation + indexes. Run `npx prisma db push && npx prisma generate`.
2. [ ] `app/api/opportunities/[id]/dismiss/route.ts` — POST handler.
3. [ ] `app/api/opportunities/[id]/restore/route.ts` — POST handler.
4. [ ] `OpportunityCard.tsx` — Dismiss/Restore button + props.
5. [ ] Dashboard + opportunities list page — wire `onDismissed` + `DISMISSED` option in status filter.
6. [ ] `WorkspaceLayout.tsx` — header Dismiss/Restore action.
7. [ ] Type-check: `npx tsc --noEmit`.

## Validation
**Manual journey:**
1. From the dashboard, hover a card → Dismiss button visible. Click it → row disappears (optimistic). Verify in DB (`prisma studio`) that `status=DISMISSED, dismissedAt=now`.
2. Change the status filter to `Dismissed` → the dismissed opp re-appears with a Restore button + "Dismissed <date>" footer.
3. Click Restore → row disappears from Dismissed view; switch back to Active → it's back.
4. Open an opportunity workspace, click the Dismiss header button → confirm dialog → on confirm, redirects to `/opportunities` and the opp is no longer in the default view.
5. Repeat steps 1–4 on `/opportunities` (the full list page) to confirm both surfaces work.

## Out of Scope
- Bulk-dismiss multi-select on lists (defer until single-row flow ships).
- "Dismiss reason" notes (you said no).
- Per-user dismissal — current schema is single-org; if multiple users need independent views later, migrate to an `OpportunityDismissal` join table.
- Webhook to re-surface a dismissed opp if SAM.gov updates it (defer; flag if it becomes an issue).
