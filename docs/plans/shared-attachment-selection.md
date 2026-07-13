# Plan: Shared Attachment Selection — Summary ↔ Email (single bundle)

## Goal
Make the attachment checkboxes in `OpportunitySummaryPanel` write to the same parent-owned Set that `EmailDraftPanel` already reads from, so a user analyzing attachments on the Summary tab can select the relevant ones once and have them flow into both the email bundle and the SOW input. Counter visible in both panels.

## Why now
ARCHITECTURE.md already states the parent holds `emailSelectedAttachments (Set<string>)` and that it survives panel switching (`app/opportunities/[id]/page.tsx:37`). The Email panel correctly reads from `selectedAttachmentIds` (its prop). But the Summary panel maintains its **own local** `selectedAttachments` Set (`OpportunitySummaryPanel.tsx:150`) used only to gate "Generate SOW", with no link to the email selection. This plan unifies them.

## Success Criteria
- [ ] One source of truth in `app/opportunities/[id]/page.tsx` for "which attachments are selected" — name it `selectedAttachments` (rename from `emailSelectedAttachments` since it now serves both flows).
- [ ] Checking/unchecking a box in the Summary panel updates the parent Set; the change is visible in the Email panel after switching tabs (and vice versa).
- [ ] Summary panel removes its local `selectedAttachments` state.
- [ ] "Generate SOW" button in the Summary panel uses the shared Set as its input (was: local Set).
- [ ] Both panels show a counter near the attachment list header — same wording: `{n} of {total} selected for email & SOW`.
- [ ] No regression in EmailDraftPanel's Select All / Deselect All buttons (they continue to operate on the shared Set via the parent setter).
- [ ] `npx tsc --noEmit` clean.

## Context References
- `app/opportunities/[id]/page.tsx:37` — current `emailSelectedAttachments` state, line 551 passes to EmailDraftPanel via `selectedAttachmentIds`
- `app/opportunities/[id]/page.tsx:68-86` — useEffect that initializes the Set to "all attachments" on first fetch
- `app/opportunities/[id]/page.tsx:158-165` — `handleGenerateSOW(selectedAttachments?: string[])` (currently driven by the Summary panel's local Set)
- `components/workspace/panels/OpportunitySummaryPanel.tsx:115` — `onGenerateSOW?: (selectedAttachments?: string[]) => void` prop
- `components/workspace/panels/OpportunitySummaryPanel.tsx:150` — `useState<Set<string>>(new Set())` (will be removed)
- `components/workspace/panels/OpportunitySummaryPanel.tsx:713-757` — current checkbox + Generate SOW button using the local Set
- `components/workspace/panels/EmailDraftPanel.tsx:188` — accepts `selectedAttachmentIds: Set<string> | undefined`
- `components/workspace/panels/EmailDraftPanel.tsx:221` — `const selectedAttachments = selectedAttachmentIds ?? localSelected` (will simplify: always use prop)

## Database Changes
None. This is a state-architecture refactor.

## API Routes
None.

## UI Components

### `app/opportunities/[id]/page.tsx` (parent — state hub)
- Rename `emailSelectedAttachments` → `selectedAttachments` (and setter). Keep the existing "initialize to all" useEffect.
- Add a memoized `toggleAttachmentSelection(id: string)` callback and a `setAttachmentSelection(next: Set<string>)` callback so child panels can update without prop-drilling the raw setter.
- Pass to `OpportunitySummaryPanel`:
  - `selectedAttachments: Set<string>`
  - `onToggleAttachment: (id: string) => void`
- Pass to `EmailDraftPanel`:
  - `selectedAttachmentIds: Set<string>` (already passed — just rename source)
  - `onSelectionChange?: (next: Set<string>) => void` — new optional prop so Select All / Deselect All in the email panel write back to the parent. (Today the email panel calls a local setter when the prop is present — verify; if it already lifts up correctly, this prop may not be needed. See "Investigation" below.)
- `handleGenerateSOW` reads `Array.from(selectedAttachments)` from parent state when invoked from the Summary panel's button (no need to pass an arg through).

### `components/workspace/panels/OpportunitySummaryPanel.tsx`
- Remove the local `selectedAttachments` state.
- Add props: `selectedAttachments: Set<string>`, `onToggleAttachment: (id: string) => void`.
- Replace `setSelectedAttachments(new Set(prev))` checkbox handler with `onToggleAttachment(att.id)`.
- "Generate SOW" button text becomes `Generate SOW ({selectedAttachments.size} attachment{...})` — same as today, just sourced from prop.
- Add a small counter line above the attachment list: `<p className="text-xs text-stone-500">{selectedAttachments.size} of {attachments.length} selected for email & SOW</p>`.

### `components/workspace/panels/EmailDraftPanel.tsx`
- Add the same counter line above the existing attachment list (matches Summary panel wording for consistency).
- If `onSelectionChange` prop is added, replace local `setLocalSelected` calls with `onSelectionChange(next)` when the prop is provided. If the panel already routes through a parent setter, no change needed beyond the counter.

### Investigation step (before coding)
Re-read `EmailDraftPanel.tsx` lines 188–230 + 510–540 to confirm exactly how `localSelected` and `selectedAttachmentIds` interact today. If the panel writes only to `localSelected` and never lifts changes up, that's a pre-existing bug (the Summary panel's selection would be overwritten the first time you toggle in the email panel) and the `onSelectionChange` prop above closes it. Note the finding in the implementation commit.

## Implementation Task List
1. [ ] Read EmailDraftPanel.tsx around lines 188-230, 510-540 and confirm/note the current selection-write flow.
2. [ ] Parent: rename state, add toggle/set callbacks, update `handleGenerateSOW` to source from parent state.
3. [ ] OpportunitySummaryPanel: drop local Set, accept new props, wire checkboxes through, add counter line.
4. [ ] EmailDraftPanel: add counter line; if needed, add `onSelectionChange` prop and route Select All / Deselect All / per-row toggles through it.
5. [ ] Type-check: `npx tsc --noEmit`.

## Validation
**Manual journey:**
1. Open an opportunity with 4+ attachments. Default state: all checked (initialized in useEffect).
2. In the Summary panel, uncheck 2 of them. Counter reads `2 of 4 selected for email & SOW`.
3. Switch to the Email Draft panel. Counter reads the same. Attachment list reflects the same 2 checkboxes.
4. In the Email panel, click "Deselect All". Counter reads `0 of 4`.
5. Switch back to Summary. Counter and checkboxes show the same `0 of 4`.
6. Tick one checkbox in Summary, then click Generate SOW. Network request `POST /api/sows` body includes `selectedAttachments: ['<that-one-id>']`.

## Out of Scope
- Persisting the selection across page reloads (current behavior is per-session; defer unless asked).
- Distinct SOW-input vs email-bundle selections (you chose option 5a — shared).
- Highlighting which attachments are "critical" by default (handled separately by Scope Overview's parsed attachment analysis).
