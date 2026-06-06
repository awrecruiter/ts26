# Plan Stub: AI Bid Package Generator (Future Phase)

> **Status:** Roadmap placeholder, not for current execution. Captured here so it isn't forgotten when Phase 4.4.1 wraps.

## Concept

An admin-triggered AI agent that assembles the full bid package — formatted exactly as the opportunity's solicitation requires — by reading:

- The opportunity (NAICS, agency, contract type, SAM.gov `rawData`)
- The parsed solicitation attachments (the same `parsedAttachments` blob the SOW generator already uses)
- The approved SOW
- The set of subcontractor quotes the admin has reviewed and **explicitly selected** to include
- Any compliance / submission requirements extracted from the solicitation (FAR clauses, page limits, section ordering, signature blocks, etc.)

Output: a single submission-ready document (likely PDF) matching the solicitation's prescribed format. Stored against the `Bid` model (`Bid.content` + `Bid.fileUrl`).

## Trigger

- **Role:** `ADMIN` only — agents never trigger this.
- **Entry point:** A new admin-only action somewhere near the Bid panel — e.g. a "Generate Bid Package" button that's only visible when (a) the user is ADMIN, (b) the SOW exists and is approved, (c) at least one quote has been marked selected.
- **Workflow precondition:** Admin first reviews incoming quote responses (a separate quote-management view yet to be designed) and selects which subs/quotes are in. The selected set is the AI's input.

## Why this reshapes the agent journey

Today's `BidEditorPanel` is a manual assembly UI. Once AI generation lands, the agent's role in Stage 4 ("Bid") shifts:

| Phase | Agent in Stage 4 | Admin in Stage 4 |
|---|---|---|
| Now | Assembles bid manually | Same as agent |
| After AI bid generator | Reviews AI-generated draft, suggests edits | Selects winning quotes → triggers generator → reviews → submits |

The Submit-bid gating from Phase 4.4.1 is the first step of this hand-off; this phase completes it.

## Probable data dependencies (sketch — verify when planning)

- A `Subcontractor.selectedForBid Boolean @default(false)` (or similar) flag so the admin can mark which quotes go in.
- A `Subcontractor.quoteReceivedAt DateTime?` and existing `quotedAmount Float?` are already in the schema — verify they cover the "quote received and viewed" state.
- A new server route: `POST /api/bids/[id]/generate` — runs the AI generation pipeline.
- A new lib file: `lib/bid-package-generator.ts` — mirrors the structure of `lib/sow-utils.ts` + `lib/openai.ts`'s `generateSOWSections`.
- Likely uses Vercel AI SDK Workflow primitives (durable, long-running, retryable) rather than a single OpenAI call — bid generation can take minutes and shouldn't fail the request.

## Open questions to resolve before planning

1. What's the canonical "selected quotes" UX? Inline checkbox on the SubcontractorPanel, or a dedicated quote-review panel? Probably the latter, with a new role-gated entry.
2. Is the output a single PDF or a zip of (cover letter, technical volume, price volume, past performance volume) as some solicitations require?
3. Does the AI need to fill out specific government forms (SF-33, SF-1449, etc.) that may live as `AttachmentFormData` already? (Schema has `AttachmentFormData` — Phase 4.3 work.)
4. Approval workflow: should AGENTs be able to "request submission" once they're satisfied with the AI draft, triggering an admin review queue? `BidApprovalRequest` model exists for this.

## What this phase does NOT include

- Submission to SAM.gov / contract-writing system. Submission is still a human admin action against the agency's portal. The AI only produces the document.
- Agent-side bid editing — the current `BidEditorPanel` stays available; this just adds a generator alongside it.

## Forward link

When this phase is picked up, replace this stub with a full plan following the same structure as `sow-editor.md`. Update `IMPLEMENTATION_PLAN.md` to move the row from Backlog to In Progress.
