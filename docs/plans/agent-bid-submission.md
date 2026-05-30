# Plan: Agent Bid Submission Workflow

## Goal
Let agents email the SOW to subcontractors they've engaged, then package up the SOW + subcontractor email responses + bid components and submit everything to an admin for final review and approval before the bid goes to the government.

## Success Criteria
- [ ] Agent can email the SOW (as PDF attachment) to one or more subcontractors from the workspace
- [ ] Agent can attach uploaded subcontractor email responses (quote emails, agreements) to a submission package
- [ ] Agent submits the package with a note — this triggers an email to all ADMIN users with a review link
- [ ] A `BidApprovalRequest` record is created, visible in a new admin review queue
- [ ] Admin can approve (→ bid status becomes `REVIEWED`, stage moves to `READY`) or reject with a comment
- [ ] Rejection sends the agent an email with the admin's comment
- [ ] Approval sends the agent an email confirming the bid is ready to submit
- [ ] No TypeScript errors (`npx tsc --noEmit`)

---

## New Workflow

```
Agent workspace
  ↓ (1) Emails SOW PDF to subcontractors via EmailDraftPanel
  ↓ (2) Subcontractors reply with quotes / agreements
  ↓ (3) Agent uploads those email responses as attachments
  ↓ (4) Agent clicks "Complete" in BidEditorPanel
  ↓ (5) Submission package created → email sent to all ADMINs
Admin review queue (/admin/bid-approvals)
  ↓ (6) Admin opens package, reviews SOW + bid pricing + subcontractor responses
  ↓ (7) Admin approves or rejects with comment
  ↓ (8) Agent receives email notification of outcome
```

---

## Database Changes

### New model: `BidApprovalRequest`
```prisma
model BidApprovalRequest {
  id            String   @id @default(cuid())
  opportunityId String
  bidId         String
  submittedById String
  agentNote     String?  @db.Text

  status        BidApprovalStatus @default(PENDING)
  reviewedById  String?
  reviewerNote  String?  @db.Text
  reviewedAt    DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  opportunity   Opportunity @relation(fields: [opportunityId], references: [id], onDelete: Cascade)
  bid           Bid         @relation(fields: [bidId], references: [id], onDelete: Cascade)
  submittedBy   User        @relation("BidSubmitter", fields: [submittedById], references: [id])
  reviewedBy    User?       @relation("BidReviewer", fields: [reviewedById], references: [id])

  @@index([opportunityId])
  @@index([status])
  @@map("bid_approval_requests")
}

enum BidApprovalStatus {
  PENDING
  APPROVED
  REJECTED
}
```

### Modified: `Bid` model
- Add `approvalRequests BidApprovalRequest[]` relation

### Modified: `Opportunity` model
- Add `bidApprovalRequests BidApprovalRequest[]` relation

### Migration
`npx prisma db push` (Render PostgreSQL)

---

## API Routes

### `POST /api/opportunities/[id]/bid-approval`
Agent submits bid package for admin review.
- Auth: AGENT or ADMIN role
- Body: `{ bidId: string, agentNote?: string }`
- Creates `BidApprovalRequest` with status `PENDING`
- Fetches all ADMIN users from DB
- Sends email to every admin via `lib/email.ts`:
  - Subject: `[Review Required] Bid Package — [opportunity title]`
  - Body: agent name, opportunity, note, link to `/admin/bid-approvals/[requestId]`
- Returns `{ request: BidApprovalRequest }`

### `PATCH /api/admin/bid-approvals/[id]`
Admin approves or rejects.
- Auth: ADMIN only
- Body: `{ action: 'APPROVE' | 'REJECT', reviewerNote?: string }`
- Updates `BidApprovalRequest.status`, `reviewedById`, `reviewerNote`, `reviewedAt`
- If APPROVE:
  - Updates `Bid.status` → `REVIEWED`
  - Updates `OpportunityProgress.currentStage` → `READY`
  - Emails agent: "Your bid package for [title] has been approved — it's ready to submit."
- If REJECT:
  - Bid status stays `DRAFT`
  - Emails agent with reviewer note: "Your bid package needs revision: [note]"
- Returns `{ request: BidApprovalRequest }`

### `GET /api/admin/bid-approvals`
Admin queue — all pending + recent requests.
- Auth: ADMIN only
- Returns requests with `opportunity`, `bid`, `submittedBy` included
- Sorted by `createdAt desc`

---

## UI Changes

### Modified: `components/workspace/panels/BidEditorPanel.tsx`
Add a "Complete" section at the bottom of the panel.

**Shown when:** `bid.status === 'DRAFT'` and agent role

```
┌──────────────────────────────────────────────────┐
│  Ready to complete this bid package?             │
│                                                  │
│  [Note to admin — optional]                      │
│  ┌────────────────────────────────────────────┐  │
│  │  e.g. "All three quotes received. SDVOSB   │  │
│  │  sub confirmed. SOW sent 5/28."            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  [ Complete → ]                   │
└──────────────────────────────────────────────────┘
```

**After submission:** Replace the button with a status badge:
```
⏳ Awaiting admin review — submitted [date]
```

**If rejected:** Show the rejection note in an amber callout:
```
⚠️ Revision requested: "[admin note]"
[ Resubmit → ]
```

### Modified: `components/workspace/panels/EmailDraftPanel.tsx`
Add a "Send SOW" quick-action button in the subcontractor email flow:
- Pre-populates subject: `SOW — [opportunity title]`
- Attaches the latest approved SOW PDF (fetches via `/api/sows/[id]/download`)
- Pre-fills recipient from the subcontractor's email address
- Existing email send logic handles the rest

### New: `app/admin/bid-approvals/page.tsx`
Admin review queue page.

**Layout:**
```
Pending Reviews (2)
┌─────────────────────────────────────────────────┐
│  HVAC Maintenance — Fort Bragg                  │
│  Submitted by: Jane Agent   2 hours ago         │
│  Note: "All quotes in. SOW sent to 3 subs."    │
│  [ Review Package → ]                           │
└─────────────────────────────────────────────────┘

Recently Reviewed
┌─────────────────────────────────────────────────┐
│  IT Network Upgrade — Pentagon    ✅ Approved    │
│  Cybersecurity Audit — GSA        ❌ Rejected    │
└─────────────────────────────────────────────────┘
```

### New: `app/admin/bid-approvals/[id]/page.tsx`
Full review page for a single request. Admin sees:
- Opportunity summary (title, agency, deadline, value)
- Bid pricing breakdown (from `bid.content`)
- Subcontractor quotes summary
- Agent's note
- SOW link (opens in iframe via existing proxy)
- Approve / Reject buttons with comment field

---

## Email Templates

### To admin (on submission)
```
Subject: [Review Required] Bid Package — HVAC Maintenance Services
Body:
  Jane Agent has submitted a bid package for your review.

  Opportunity: HVAC Maintenance Services — Fort Bragg
  Deadline: June 12, 2026 (14 days)
  Recommended Price: $2,340,000
  Agent Note: "All three quotes received. SDVOSB sub confirmed. SOW sent 5/28."

  [ Review Package ]  ← links to /admin/bid-approvals/[id]
```

### To agent (on approval)
```
Subject: Bid Package Approved — HVAC Maintenance Services
Body:
  Your bid package for HVAC Maintenance Services has been approved.
  The bid is now ready to submit to the government.

  [ Open Workspace ]
```

### To agent (on rejection)
```
Subject: Bid Package Needs Revision — HVAC Maintenance Services
Body:
  Admin reviewed your bid package and requested revisions.

  Feedback: "[reviewer note]"

  [ Open Workspace ]
```

---

## Implementation Task List

1. [ ] **Schema** — add `BidApprovalRequest` model + `BidApprovalStatus` enum, update `Bid` + `Opportunity` relations, `npx prisma db push`
2. [ ] **`POST /api/opportunities/[id]/bid-approval`** — create request, email all admins
3. [ ] **`GET /api/admin/bid-approvals`** — return pending + recent queue
4. [ ] **`PATCH /api/admin/bid-approvals/[id]`** — approve/reject, update bid + stage, email agent
5. [ ] **BidEditorPanel** — add "Complete" button section, status badge, rejection callout
6. [ ] **EmailDraftPanel** — add "Send SOW" quick action with PDF attachment
7. [ ] **`/admin/bid-approvals` page** — queue list view
8. [ ] **`/admin/bid-approvals/[id]` page** — full review detail page
9. [ ] **Type check** — `npx tsc --noEmit`

---

## Notes
- Email to admin uses existing `lib/email.ts` — falls back silently if email not configured (log warning)
- Multiple ADMINs all get notified; first to act wins (no double-approve logic needed initially)
- Agent can resubmit after rejection — creates a new `BidApprovalRequest`, old one stays in history
- SOW PDF attachment in EmailDraftPanel should pull the most recent SOW with status `APPROVED` or `DRAFT` (whichever is latest)
- The admin review page is accessible from the existing `/admin` nav, not from the agent dashboard
- `BidApprovalRequest` is scoped to an opportunity+bid pair — an opportunity can have multiple requests over time (revisions)
