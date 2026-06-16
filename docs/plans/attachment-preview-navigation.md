# Plan: Attachment Preview — Arrow Navigation + Document Preview Fixes

## Goal
Turn the single-attachment preview modal into a navigable viewer (arrow buttons + ←/→ keys, counter, wrap-around) used by both the Opportunity Summary and Email Draft panels, and broaden which file types actually render inline.

---

## Part A — Arrow Navigation in the Preview Modal

### Success Criteria
- [ ] In OpportunitySummaryPanel and EmailDraftPanel, opening a preview shows on-screen prev/next chevrons and supports `←` / `→` keyboard shortcuts.
- [ ] Modal header shows a counter: `3 of 7 · Solicitation.pdf`.
- [ ] At the last attachment, `→` (or Next button) wraps to the first; at the first, `←` wraps to the last.
- [ ] Non-previewable files (e.g. `.docx`, `.zip`) are still included in the sequence and show a prompt with **Download** + **Next ›** / **‹ Previous** actions.
- [ ] `Esc` still closes; no regression in portal/transform-stacking-context fix.
- [ ] `npx tsc --noEmit` clean.

### Context References
- `components/shared/AttachmentPreviewModal.tsx` — current modal, will gain navigation
- `lib/attachment-preview.ts` — `isPreviewable()` helper
- `components/workspace/panels/OpportunitySummaryPanel.tsx` (lines ~151, 176, 543, 791) — `viewingAttachment` state + invocation
- `components/workspace/panels/EmailDraftPanel.tsx` (lines ~188, 324) — `previewAttachment` state + invocation
- `lib/types/attachment.ts` — `RichAttachment`

### API Routes
None. This is a UI-only change.

### UI Components

**Modified:** `components/shared/AttachmentPreviewModal.tsx`

New props signature:
```ts
interface AttachmentPreviewModalProps {
  attachments: RichAttachment[]   // full list to navigate through
  currentId: string               // which one is showing
  opportunityId: string
  onChange: (id: string) => void  // called when arrow nav moves to a new attachment
  onClose: () => void
}
```

Internal changes:
- Derive `index`, `total`, `current`, `next()`, `prev()` (with wrap-around modulo `total`).
- Header counter: `<span>{index + 1} of {total}</span>` to the left of filename.
- On-screen chevron buttons: absolutely positioned overlays on the left/right edges of the modal body (only render if `total > 1`). Style: `bg-white/80 hover:bg-white shadow rounded-full p-2`, vertically centered, `text-stone-700`.
- Keyboard listener already exists for `Escape`; extend it to handle `ArrowLeft` → `prev()` and `ArrowRight` → `next()`.
- Non-previewable fallback panel: add `‹ Previous` and `Next ›` buttons next to the existing Download button so the user can keep stepping through without closing.
- Reset iframe `key` to `current.id` so React swaps the iframe cleanly when the source changes (avoids stale PDF.js state).

**Modified call sites:**

`OpportunitySummaryPanel.tsx` — pass the full `attachments` array (already in component state) + `viewingAttachment.id` + an `onChange` that sets `viewingAttachment` to the new one.

`EmailDraftPanel.tsx` — pass `availableAttachments` + `previewAttachment.id` + `onChange` that sets `previewAttachment`.

### Implementation Task List
1. [ ] Update `AttachmentPreviewModal.tsx` to the new props, internal nav helpers, header counter, chevron overlays, keyboard arrow handlers, and nav buttons inside the unsupported-file fallback.
2. [ ] Update `OpportunitySummaryPanel.tsx` invocation (line ~791) to pass `attachments`, `currentId`, `onChange`.
3. [ ] Update `EmailDraftPanel.tsx` invocation (line ~324) to pass `availableAttachments`, `currentId`, `onChange`.
4. [ ] `npx tsc --noEmit`.

### Validation
**Manual journey (OpportunitySummaryPanel):**
1. Open an opportunity with ≥3 attachments.
2. Click the eye icon on attachment 1. Modal opens, counter reads `1 of N`.
3. Press `→`. Counter increments, filename updates, iframe reloads.
4. Press `→` past the end. Counter wraps to `1 of N`.
5. Press `←` from `1 of N`. Wraps to `N of N`.
6. Click on-screen left/right chevrons — same behavior.
7. Navigate to a `.docx` attachment. Fallback panel shows with Download + Prev/Next buttons; Next still advances.
8. Press `Esc`. Modal closes.

**Manual journey (EmailDraftPanel):**
9. Open the email draft for the same opportunity. Click the eye icon on any attachment.
10. Repeat steps 3–8.

---

## Part B — Render More Document Types Inline

### Why some docs preview and some don't (current behavior)
`isPreviewable()` returns true only for extensions a browser can render in an `<iframe>`: `pdf, png, jpg, jpeg, gif, webp, svg, txt`. Office formats (DOCX, XLSX, PPTX, DOC, XLS) are binary ZIP containers — no browser engine can render them, so we show the fallback. The proxy route (`app/api/opportunities/[id]/attachments/[attachmentId]/proxy/route.ts`) is fine; it follows SAM.gov's 303 redirect, recovers the real filename, and infers MIME types correctly. The wall is purely browser rendering.

### Success Criteria
- [ ] `.docx` files render inline as styled HTML (via `mammoth`).
- [ ] `.csv` files render inline as a basic HTML table.
- [ ] `.xlsx` / `.xls` files: ship a "render later" decision or fall back gracefully with a clear "download for full fidelity" message (do NOT add `sheetjs` unless the user agrees in review).
- [ ] `.zip` and other truly opaque types keep the existing fallback.
- [ ] Inline preview renders inside the same modal frame so arrow nav (Part A) still works.

### API Routes

**New:** `GET /api/opportunities/[id]/attachments/[attachmentId]/preview-html`

Returns a sanitized HTML document for renderable office formats. Process:
1. Fetch the upstream binary using the same logic as the proxy route (extract code into `lib/samgov-fetch.ts` to avoid duplication, or have this route call the proxy URL internally).
2. Branch on extension:
   - `.docx` → `mammoth.convertToHtml({ buffer })` → wrap in a minimal HTML shell with embedded CSS (system font stack, max-width, padding) so it looks readable in an iframe.
   - `.csv` → parse with a tiny CSV splitter (handle quoted commas; no new dep needed for v1) → render a `<table>` with stone borders matching app palette.
   - anything else → 415 Unsupported Media Type (modal falls back to download UI).
3. Stream as `text/html; charset=utf-8` with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:` to neutralize any HTML mammoth produced.

### UI Components

**Modified:** `components/shared/AttachmentPreviewModal.tsx`

Replace the boolean `isPreviewable()` branch with a `previewKind(filename)` helper that returns `'iframe-binary' | 'iframe-html' | 'unsupported'`:
- `pdf`, images, `txt` → `'iframe-binary'` — point iframe at `/proxy`.
- `docx`, `csv` → `'iframe-html'` — point iframe at `/preview-html`.
- Everything else → `'unsupported'` — current fallback.

**New helper:** extend `lib/attachment-preview.ts` to export `previewKind(filename)` alongside the existing `isPreviewable` (keep the old function for any other callers, mark as `@deprecated`).

### Implementation Task List
1. [ ] `lib/attachment-preview.ts` — add `previewKind()`.
2. [ ] New route `app/api/opportunities/[id]/attachments/[attachmentId]/preview-html/route.ts` — DOCX via mammoth + CSV via inline parser. Wrap in HTML shell + strict CSP header.
3. [ ] Refactor `AttachmentPreviewModal.tsx` body to switch on `previewKind()`.
4. [ ] `npx tsc --noEmit`.

### Validation
**Manual journey:**
1. Open an opportunity with a `.docx` attachment (most solicitations have at least one — e.g. SF1449, instructions).
2. Click preview. The DOCX renders as formatted HTML in the iframe.
3. Arrow to a `.pdf`. PDF renders via browser viewer.
4. Arrow to a `.zip` or `.xlsx`. Fallback "Preview not available" with Download + Prev/Next.
5. Verify the `.docx` HTML iframe has no JavaScript execution (open DevTools, check the iframe's CSP header response, attempt `<script>` injection via a mammoth-converted doc with malicious markup — should be blocked).

---

## Sequencing Recommendation
Land Part A first (small, contained, immediately useful). Land Part B as a follow-up commit so it can be reviewed in isolation — it touches both an API route and the modal's render logic.

## Out of Scope (for this plan)
- XLSX inline preview (requires `sheetjs` or `exceljs`; discuss before adding).
- PPTX preview (no clean library; would need LibreOffice or a SaaS viewer).
- Office Online / Google Docs viewer integration (requires a publicly fetchable proxy URL, which would weaken auth; revisit if mammoth fidelity proves insufficient).
- Caching `preview-html` output (`Cache-Control: private, max-age=3600` is enough for v1; revisit if upstream fetch latency hurts UX).
