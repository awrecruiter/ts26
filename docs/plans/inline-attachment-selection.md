# Plan: Inline Attachment Selection in Summary & Preview

## Goal
Add an inline checkbox to each attachment in the Summary panel's attachment list, and a "Include in email" toggle in the preview modal header — so the user can add/remove attachments from the shared email+SOW bundle without opening the "Generate SOW" picker modal.

## Problem
Today the parent already owns a single `selectedAttachments: Set<string>` shared by the Summary panel, the Email Draft panel, and the Generate-SOW input (shipped in `fd2448e`). The Summary panel even shows a counter `"X of Y selected for email & SOW"` above the attachment list. But the only places a user can actually toggle that Set are:
- The Email Draft panel's per-attachment row
- The "Select Attachments for SOW" modal that opens *after* clicking **Generate SOW**

The Summary panel's inline `AttachmentRow` and the `AttachmentPreviewModal` are read-only with respect to selection — so a user analyzing attachments on the brief page has to either flip tabs to the Email panel or open the SOW picker to mark something for the bundle. The counter implies a control that doesn't exist.

## Success Criteria
- [ ] Each `AttachmentRow` in `OpportunitySummaryPanel` renders a checkbox at the left edge; clicking it toggles the parent `selectedAttachments` Set
- [ ] The checkbox state stays in sync with the Email Draft panel and the Generate-SOW picker (same source of truth)
- [ ] The "X of Y selected for email & SOW" counter line gets two compact buttons next to it: **Select all** / **Clear** (matches the existing wording inside the SOW picker modal)
- [ ] `AttachmentPreviewModal` header shows a checkbox labeled **Include in email** that toggles the same Set for the currently-previewed attachment
- [ ] Toggling in the preview modal updates the count visible in the Summary panel underneath without closing the modal
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No regression in the existing "Generate SOW" picker modal (still opens, still pre-checks based on the same Set)

## Context References
- `app/opportunities/[id]/page.tsx` — owns `selectedAttachments` Set, passes `selectedAttachments` + `onToggleAttachment` to `OpportunitySummaryPanel` and `EmailDraftPanel`
- `components/workspace/panels/OpportunitySummaryPanel.tsx:523-527` — current counter line (no controls)
- `components/workspace/panels/OpportunitySummaryPanel.tsx:546-565` — `<AttachmentRow>` render block (needs `selected` + `onToggleSelect` props)
- `components/workspace/panels/OpportunitySummaryPanel.tsx:807-818` — `<AttachmentPreviewModal>` render block (needs to pass selection down)
- `components/workspace/panels/OpportunitySummaryPanel.tsx:823-…` — `AttachmentRow` internal component (needs a checkbox on the left)
- `components/shared/AttachmentPreviewModal.tsx:75-87` — modal header (where the **Include in email** checkbox goes)
- `components/workspace/panels/OpportunitySummaryPanel.tsx:716-735` — existing checkbox markup inside the SOW picker, to copy the visual style
- `components/workspace/panels/EmailDraftPanel.tsx` — read for parity on row styling and "Select all/Clear" pattern

## Database Changes
None.

## API Routes
None.

## UI Components

### Modified: `components/workspace/panels/OpportunitySummaryPanel.tsx`
- **AttachmentRow** gains two props: `selected: boolean`, `onToggleSelect: () => void`. A checkbox is rendered as the leftmost element (before the file-icon-button), `stone-*` styling matching the SOW-picker checkbox (`h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500`). The whole row stays clickable for view; the checkbox `stopPropagation`s its own click so toggling doesn't open the preview.
- The render block passing each `<AttachmentRow>` reads `selected={selectedAttachments.has(att.id)}` and `onToggleSelect={() => onToggleAttachment(att.id)}`.
- The existing counter line at `:523-527` gets two trailing buttons:
  - **Select all** → toggles every currently-unselected `visible` attachment on (same logic as inside the SOW picker, but operates on the filtered `visible` list so a user filtered to "Forms" can select-all-forms without touching documents)
  - **Clear** → toggles every currently-selected `visible` attachment off
  - Buttons styled `text-[11px] text-stone-500 hover:text-stone-800 underline underline-offset-2`
- `<AttachmentPreviewModal>` invocation at `:807-818` gains two props: `selected={selectedAttachments.has(viewingAttachment.id)}` and `onToggleSelect={() => onToggleAttachment(viewingAttachment.id)}`.

### Modified: `components/shared/AttachmentPreviewModal.tsx`
- Props gain `selected: boolean` and `onToggleSelect: () => void`.
- Header (currently the row at `:75-87`) gets a labeled checkbox between the filename and the Download button:
  ```tsx
  <label className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded cursor-pointer hover:bg-stone-50">
    <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-3.5 w-3.5 rounded border-stone-300 text-stone-800 focus:ring-stone-500" />
    Include in email
  </label>
  ```
- Arrow-key navigation (←/→) preserves the current selection state because the parent computes `selected` from `currentId` against the same Set on each render.

### Unchanged
- `EmailDraftPanel.tsx` — already has per-row checkboxes; no work needed
- The "Generate SOW" picker modal — leave its checkboxes as a final-confirmation step (acts on the same Set, so anything pre-selected inline appears already-checked when the modal opens)

## Implementation Task List
1. [ ] `AttachmentPreviewModal.tsx` — add `selected` + `onToggleSelect` props and the **Include in email** checkbox in the header
2. [ ] `OpportunitySummaryPanel.tsx` — pass `selected` + `onToggleSelect` down to the preview modal invocation
3. [ ] `OpportunitySummaryPanel.tsx` — extend `AttachmentRow` props with `selected` + `onToggleSelect`; render a leading checkbox; wire it from the parent render block
4. [ ] `OpportunitySummaryPanel.tsx` — add **Select all** / **Clear** buttons next to the counter line; operate on the `visible` (filter-respecting) list
5. [ ] Type-check: `npx tsc --noEmit`

## Validation Strategy

### Automated
- `npx tsc --noEmit`

### Manual User Journey
1. Open an opportunity with ≥3 attachments. Summary panel renders inline checkboxes on each row. Counter reads e.g. `3 of 3 selected for email & SOW`.
2. Uncheck one row inline. Counter updates to `2 of 3`. No modal opens.
3. Click an attachment to open the preview modal. The header shows **Include in email** checked (or unchecked, matching state).
4. Toggle the preview's **Include in email** checkbox. Counter visible behind the modal updates in real time.
5. Use arrow keys to navigate to the next attachment. **Include in email** reflects that attachment's state.
6. Close the modal. Switch to the Email Draft panel. The same set of attachments is checked there.
7. Click **Clear** next to the counter on the Summary panel. All checkboxes clear (only for the currently-visible filter — verified by switching the filter to "Forms" and confirming Documents stay untouched).
8. Click **Generate SOW**. The SOW picker modal opens with checkboxes pre-matching the inline state.

### Edge cases
- Attachment list filtered to "Forms" → **Select all** / **Clear** only affect form rows
- Preview modal open while parent re-fetches attachments (e.g. after rename) → checkbox stays consistent because state is keyed by `att.id`, not list index
- Empty attachment list → counter and bulk buttons hidden (existing `attachments.length > 0` guard already gates the counter)

## Out of Scope
- Persisting selection across page reloads (per-session only, matches today's behavior)
- A keyboard shortcut to toggle selection inside the preview (defer — Spacebar would conflict with PDF-viewer scrolling)
- Distinct "email bundle" vs "SOW input" sets (still shared, as decided in `fd2448e`)
