# Plan: Complete Gmail OAuth Send Flow

## Context

The EmailDraftPanel's "Send Email" button currently falls back to `mailto:` because the `onSend` prop is never passed in the parent page (`app/opportunities/[id]/page.tsx`). No API route exists for the panel to call. Additionally, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are empty strings in `.env.local`, so Google OAuth sign-in is non-functional. This plan wires up the end-to-end flow: credentials → token storage → API call → Gmail send → UI feedback.

---

## Step 0 — Manual: Configure Google Cloud (user action required before testing)

1. Go to Google Cloud Console → Create or select a project
2. Enable the **Gmail API**
3. OAuth consent screen → add scopes: `gmail.send`, `gmail.modify`
4. Create **OAuth 2.0 Client ID** (Web application type)
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Add to `.env.local`:
   ```
   GOOGLE_CLIENT_ID="<your-client-id>"
   GOOGLE_CLIENT_SECRET="<your-client-secret>"
   EMAIL_PROVIDER="gmail"
   ```

---

## Step 1 — New API route: `POST /api/email/send/route.ts`

Create `app/api/email/send/route.ts`.

Logic:
- Require auth session (401 if missing)
- Accept body: `{ to: string, subject: string, body: string }`
- Get Google tokens: first try `session.googleAccessToken` / `session.googleRefreshToken` (set in JWT for Google sign-ins), then fall back to DB lookup:
  ```typescript
  const account = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: 'google' },
    select: { access_token: true, refresh_token: true }
  })
  ```
- Call `sendEmail()` from `lib/email.ts` (already handles the gmail/smtp/sendgrid dispatch)
- Return `{ success, messageId?, error? }`

---

## Step 2 — Wire `onSend` in parent page

File: `app/opportunities/[id]/page.tsx`

Add a `handleEmailSend` useCallback that POSTs to `/api/email/send`. On failure, throw so EmailDraftPanel's catch surfaces the error.

```typescript
const handleEmailSend = useCallback(async (email: { to: string; subject: string; body: string }) => {
  const res = await fetch('/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(email),
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Send failed')
}, [])
```

Pass `onSend={handleEmailSend}` to `<EmailDraftPanel>` (currently ~line 419).

---

## Step 3 — Error + success feedback in EmailDraftPanel

File: `components/workspace/panels/EmailDraftPanel.tsx`

- Add `sendError: string | null` state (default null)
- Add `sendSuccess: boolean` state (default false)
- In `handleSend`:
  - Clear prior error: `setSendError(null)`
  - On success: `setSendSuccess(true)`, reset after 3s
  - On catch: `setSendError(err.message)`
- Display below the action buttons:
  - Error: red text `text-red-600 text-xs`
  - Success: green flash `text-green-600 text-xs` ("Email sent successfully")

---

## Step 4 — Gmail connection status indicator

File: `components/workspace/panels/EmailDraftPanel.tsx`

Add optional prop `gmailConnected?: boolean`.

When `gmailConnected === false`, show a subtle banner above the form:
```
⚠  Sign in with Google to send emails directly — or use "Open in Mail"
```
Styled: `bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-3 py-2`

In `app/opportunities/[id]/page.tsx`, use `useSession()` from `next-auth/react` to derive this:
```typescript
const { data: session } = useSession()
const gmailConnected = !!(session as any)?.googleAccessToken
```

Pass `gmailConnected={gmailConnected}` to EmailDraftPanel.

---

## Critical Files

| File | Change |
|------|--------|
| `app/api/email/send/route.ts` | **CREATE** — new POST handler |
| `app/opportunities/[id]/page.tsx` | Add `handleEmailSend` callback + `gmailConnected` derive + pass both to EmailDraftPanel |
| `components/workspace/panels/EmailDraftPanel.tsx` | Add error/success states + `gmailConnected` banner |

## Reused Without Changes

- `lib/email.ts` — `sendEmail()` already handles gmail dispatch
- `lib/gmail.ts` — `sendViaGmail()` already handles token refresh via googleapis
- `lib/auth.ts` — JWT callbacks already store `googleAccessToken` / `googleRefreshToken`
- `prisma/schema.prisma` — `Account` model already stores tokens

---

## Verification

1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_PROVIDER=gmail` in `.env.local`
2. Sign out, then sign in via Google → grants Gmail scopes
3. Navigate to any opportunity → Email tab
4. Confirm no amber warning banner
5. Enter a real `to` email, keep pre-filled subject/body, click "Send Email"
6. Confirm "Email sent successfully" flash
7. Check sender's Gmail Sent folder — email should appear
8. Test failure path: sign in via credentials (no Google), open Email tab → amber warning visible
