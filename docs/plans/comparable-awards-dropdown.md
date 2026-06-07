# Plan: Comparable Awards Dropdown on Listing Card

## Goal

Add an inline-expanding "Show all N awards" disclosure to each `OpportunityCard` on `/opportunities`, so users can read the full incumbent list for an opportunity without leaving the listing. The card itself stays a `<Link>` to the workspace — only the trigger and panel interior intercept clicks.

## Why

The listing card currently surfaces only the **top winner** ($amount, MMM yyyy). The full comparable-awards list (up to 20 rows) lives in the workspace summary panel — so to compare incumbent histories across opportunities the user has to drill into each card, then back out. We already store the data per-opportunity (`OpportunityComparable` table); the only missing piece is a compact surfacing on the listing.

## Success Criteria

- [ ] On cards where `comparables.count ≥ 1`, a `Show all N awards ▾` link appears directly under the "Top winner:" line.
- [ ] Clicking the trigger does **not** navigate to `/opportunities/[id]` — the card click target stays elsewhere on the card.
- [ ] First click lazy-fetches awards via `GET /api/opportunities/[id]/comparables`. Subsequent clicks toggle the panel without refetch.
- [ ] Panel shows the list with `max-h` ≈ 5 rows and an inner scroll for longer lists (up to 20).
- [ ] Each row renders `recipientName · $amount (compact) · MMM yyyy`. Recompete rows show a small `Recompete` badge next to the name.
- [ ] Loading, error, and `count === 0` states are handled gracefully (no broken trigger).
- [ ] No regression: clicks anywhere on the card outside the trigger/panel still open the workspace.
- [ ] No TypeScript errors (`npx tsc --noEmit`).

## Context References

- **Files to modify**
  - `components/opportunities/OpportunityCard.tsx` — add expand state, trigger button, panel.
- **No backend changes** — `GET /api/opportunities/[id]/comparables` already returns `{ summary, awards }` with the exact shape we need.
- **Existing event-conflict pattern** — same approach used by the workflow Mark Complete button inside the vendor card (`SubcontractorPanel.tsx`) — `e.preventDefault()` + `e.stopPropagation()` on internal clickable elements wrapped in a `<Link>`.

## Implementation

### Component state

Add to `OpportunityCard.tsx`:

```ts
interface ComparableAward {
  id: string
  awardId: string
  recipientName: string
  awardAmount: number
  popStart: string | null
  popEnd: string | null
  awardingAgency: string | null
  isRecompete: boolean
  isCurrentIncumbent: boolean
}

const [expanded, setExpanded] = useState(false)
const [awards, setAwards] = useState<ComparableAward[] | null>(null)
const [loadingAwards, setLoadingAwards] = useState(false)
const [awardsError, setAwardsError] = useState<string | null>(null)
```

### Trigger

Place directly under the existing "Top winner: ..." line in the comparables tile. Only render when `comparables && comparables.count > 0`.

```tsx
<button
  type="button"
  onClick={handleToggle}
  aria-expanded={expanded}
  aria-controls={`awards-${opportunity.id}`}
  className="mt-1 inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700"
>
  {expanded ? 'Hide list' : `Show all ${comparables.count} awards`}
  <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}> … </svg>
</button>
```

`handleToggle`:

```ts
const handleToggle = (e: React.MouseEvent) => {
  e.preventDefault()
  e.stopPropagation()
  if (!expanded && awards === null && !loadingAwards) {
    setLoadingAwards(true)
    setAwardsError(null)
    fetch(`/api/opportunities/${opportunity.id}/comparables`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setAwards(Array.isArray(d.awards) ? d.awards : []))
      .catch(() => setAwardsError('Could not load awards'))
      .finally(() => setLoadingAwards(false))
  }
  setExpanded((s) => !s)
}
```

### Panel

Rendered conditionally when `expanded`. Wrap the whole panel in `onClick={swallow}` so any stray click inside (scrollbar, etc.) never propagates to the `<Link>`:

```tsx
const swallow = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation() }

{expanded && (
  <div
    id={`awards-${opportunity.id}`}
    onClick={swallow}
    className="mt-2 border-t border-stone-200 pt-2 max-h-[170px] overflow-y-auto"
  >
    {loadingAwards && (
      <p className="text-xs italic text-stone-400 px-2 py-1">Loading…</p>
    )}
    {awardsError && (
      <p className="text-xs text-stone-500 px-2 py-1">{awardsError}</p>
    )}
    {!loadingAwards && !awardsError && awards && awards.length === 0 && (
      <p className="text-xs text-stone-400 px-2 py-1">No awards to show</p>
    )}
    {!loadingAwards && !awardsError && awards && awards.length > 0 && (
      <ul className="divide-y divide-stone-100">
        {awards.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs"
          >
            <div className="min-w-0 flex items-center gap-2">
              <span className="truncate text-stone-800">{a.recipientName}</span>
              {a.isRecompete && (
                <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                  Recompete
                </span>
              )}
            </div>
            <div className="flex-shrink-0 flex items-center gap-3 tabular-nums">
              <span className="font-semibold text-stone-900">{formatCompact(a.awardAmount)}</span>
              <span className="text-stone-500 w-16 text-right">
                {a.popStart ? formatMonYear(a.popStart) : '—'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
)}
```

Reuse the existing `formatCompact` and `formatMonYear` helpers already in the file.

### Trigger gating

- `comparables === null` (still loading): no trigger (the existing "Loading comparables…" line already conveys state).
- `comparables.count === 0` or `comparables.confidence === 'insufficient'`: no trigger.
- Otherwise: render trigger.

### Edge handling

- Rapid double-clicks: the `awards === null && !loadingAwards` guard prevents double-fetch.
- Filter change that re-renders the card: component state resets, awards cached in-memory are lost. Acceptable — fresh card means fresh request on next open.
- API returns more than ~5 rows: inner scroll engages; card height capped by `max-h-[170px]`.

## Validation

### Automated
- `npx tsc --noEmit` — must pass.

### Manual
1. Open `/opportunities`. Confirm each card with `comparables.count ≥ 1` shows `Show all N awards ▾` under the top-winner line.
2. Click the trigger on one card. Confirm:
   - Card does NOT navigate.
   - Panel expands inline.
   - Network tab shows one `GET /api/opportunities/[id]/comparables` call.
   - List populates with up to 20 rows.
3. Click the same trigger again. Confirm panel collapses with no new network call.
4. Re-open the same card. Confirm panel opens instantly (cached awards).
5. Click on the card *outside* the trigger and panel area (header, description, footer). Confirm workspace opens.
6. Open a card whose `comparables.count === 0` or `confidence === 'insufficient'`. Confirm no trigger renders.
7. Scroll inside the panel (when n > 5). Confirm page does not scroll.
8. Verify a known recompete row shows the `Recompete` badge.
9. Force an error (e.g. take API offline). Confirm "Could not load awards" appears, trigger remains clickable for retry.

### Edge cases to verify
- Mobile (320px wide): panel scrolls, trigger stays tappable.
- Keyboard: tab onto trigger → Enter toggles. `aria-expanded` flips correctly.
- Very long recipient names: truncated with `...`, amount/date column stays aligned.

## Out of scope (follow-up)

- Sorting / filtering the dropdown list (server already returns amount-desc).
- Row click → vendor CRM lookup or copy-to-clipboard.
- Persisting expanded state across page navigation.
- Changing the workspace incumbent table (already its own surface).
- Showing the agency column on the listing — usually identical to the card's own agency, would just add visual noise.
