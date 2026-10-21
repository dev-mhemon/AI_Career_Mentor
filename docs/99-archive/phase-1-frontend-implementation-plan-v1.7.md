# Phase 1 Frontend Implementation Plan v1.7

## 1. Overview
This is the final frontend implementation plan for Phase 1 Authentication & Access Control. It updates v1.6 to firmly mandate Custom SMTP infrastructure, define configuration variables for email rate limits, finalize OTP API payloads (specifically updating `verifyOtp` for email), and establish a manual Supabase Dashboard configuration checklist.

## 2. Authentication Flow Design

### 2.1 Email Registration & Configuration
- **Configuration**: Email confirmation must be **ENABLED** in Supabase.
- **Email Template**: To support our in-app verification UX without relying on magic links, the Supabase Email Confirmation template must be customized in the dashboard to expose the raw OTP via the `{{ .Token }}` variable. The OTP flow is the primary verification UX. The `{{ .ConfirmationURL }}` remains available only as a secondary/alternative mechanism if technically necessary, but `/verify` is the primary email verification UX.
- **Action**: `supabase.auth.signUp({ email, password })`.
- **Flow**: Returns a `session == null` state because confirmation is pending.
- **Routing**: Redirects the user to `/verify?type=email&identifier=<email>`.
- **Backend Sync Data Constraint**: To prevent unique constraint collisions, any missing or absent identity fields (e.g., an absent phone for an email-only user) MUST be stored as `NULL` in the database, never as an empty string (`""`).

### 2.2 Phone Registration (WhatsApp/SMS)
- **Configuration**: Phone confirmation must be **ENABLED**.
- **Status**: Required feature blocked by infrastructure configuration. (Twilio / Twilio Verify is not yet set up in the Supabase Dashboard).
- **Channels**: 
  - Primary channel: WhatsApp
  - Fallback channel: SMS
- **Fallback Mechanism**: Supabase does **not** automatically fall back from WhatsApp to SMS. The **Application** explicitly requests SMS fallback. If the initial WhatsApp OTP fails or the user chooses to switch, the frontend UI must provide a "Send via SMS instead" button, which calls `resend()` explicitly for the SMS channel. The SMS provider must actually be configured before this can work.
- **Action**: `supabase.auth.signUp({ phone, password, options: { channel: 'whatsapp' } })`.
- **Flow**: Returns a `session == null` state.
- **Routing**: Redirects the user to `/verify?type=phone&identifier=<phone>`.

### 2.3 Email Verification (OTP)
- **Verification API**: The exact API expected by the SDK for an email/password signup confirmation is:
  ```typescript
  supabase.auth.verifyOtp({
    email: string,
    token: string,
    type: 'email'
  })
  ```

### 2.4 Phone/WhatsApp Verification (OTP)
- **Verification API**: The exact API expected by the SDK for phone confirmation is:
  ```typescript
  supabase.auth.verifyOtp({
    phone: string,
    token: string,
    type: 'sms'
  })
  ```

### 2.5 Unified Verification Screen
- **Location**: `app/(auth)/verify/page.tsx`
- **Responsibility**: A reusable screen capable of verifying either Email or Phone depending on URL query parameters.
- **UX Behavior**:
  - Dynamically displays generic instructions: "Enter the verification code sent to your email." or "Enter the verification code sent to your WhatsApp."
  - **OTP Length**: Do not hard-code a 6-digit assumption. The generic verification-code input field must support the actual configured verification token format.
- **States**: Code entry, Verifying (loading), Success.
- **Errors**: Distinguish between Invalid OTP, Expired OTP, Too many verification attempts, Resend cooldown, Project/provider rate limit, Network failure, and SMTP/provider failure. Do not expose internal provider details. 

### 2.6 Resend Behavior
- **Action**: 
  - Email: `supabase.auth.resend({ type: 'signup', email })`.
  - Phone (SMS Fallback): `supabase.auth.resend({ type: 'sms', phone })`.
- **Cooldown**: A client-side 60-second cooldown is enforced. This is an additional UX protection, not a replacement for Supabase's own server-side rate limits. Server/provider limits remain authoritative.
- **Rules**: 
  - User can manually resend after cooldown.
  - No automatic resend loops.
  - No automatic retry loops after a `429 Too Many Requests` error.
  - Provider rate-limit errors must be surfaced professionally (e.g. "Too many verification emails have been requested. Please wait and try again later.").

### 2.7 Email Rate Limits & Custom SMTP
- **Custom SMTP Required**: Our product does NOT depend on Supabase's default shared email delivery service (which is restricted to 2 emails per hour and only suitable for initial testing). Custom SMTP is **REQUIRED** for our project's reliable email authentication flow (signup verifications, password recovery, etc.).
- **Rate Limit Customization**: Using Custom SMTP allows configuration of `rate_limit_email_sent`.
  - **Proposed Configuration**: rate_limit_email_sent = 30/hour is a provisional project-level authentication email delivery limit, not a per-user or signup limit. It must be validated against expected signup, resend, and password recovery traffic before production.
- **Distinction**: The Project-level delivery limit (`rate_limit_email_sent`) is distinct from the Per-user Resend cooldown. Both must remain protected.

## 3. Final Step-by-Step Flows

### 3.1 Final Email Flow
1. Email + Password
2. Supabase `signUp()`
3. Email confirmation required (session == null)
4. Verification email sent via Custom SMTP (using `{{ .Token }}`)
5. Redirect to `/verify`
6. `verifyOtp({ email, token, type: 'email' })`
7. Supabase session established
8. `POST /api/auth/sync`
9. `GET /api/auth/me`
10. `PENDING_INVITE` → redirect to `/invite` | `ACTIVE` → redirect to `/dashboard`

### 3.2 Final Phone Flow
1. Phone + Password
2. Supabase `signUp({ ..., options: { channel: 'whatsapp' } })`
3. Phone confirmation required (session == null)
4. WhatsApp OTP requested via Twilio channel
5. Redirect to `/verify`
6. `verifyOtp({ phone, token, type: 'sms' })`
7. Supabase session established
8. `POST /api/auth/sync`
9. `GET /api/auth/me`
10. `PENDING_INVITE` → redirect to `/invite` | `ACTIVE` → redirect to `/dashboard`
*(If WhatsApp delivery fails, user clicks "Send via SMS instead", application calls `resend({ type: 'sms', phone })`, and SMS OTP is delivered).*

## 4. Google & Facebook OAuth
- **Flow**: User clicks button → Browser client `signInWithOAuth` → external provider consent → redirects to `/auth/callback`.
- **Callback**: Server Route Handler calls `exchangeCodeForSession()`, orchestrates `/sync` and `/me`, and redirects to `/invite` or `/dashboard`.

## 5. Architectural Boundaries
- **Supabase**: Issues JWTs, sends verification emails/OTPs, manages credentials, enforces rate limits.
- **Next.js (Frontend - Port 3001)**: Refreshes session via Proxy, protects unauthenticated routes, orchestrates auth handoff (`/sync`, `/me`), abstracts API calls via Bearer token. Does not verify JWT signatures.
- **NestJS (Backend - Port 3000)**: Final application security authority. Verifies ES256 JWT signatures via Supabase JWKS. Handles RBAC and invitation status.

## 6. Testing Strategy
- **Email**: Test signup, verification email delivery, OTP verification, invalid OTP, expired OTP, resend, 60-second cooldown, project rate limit, 429 handling, SMTP/provider failure, successful session, `/sync`, `/me`, `/invite`, `/dashboard`.
- **Phone**: Test phone validation, WhatsApp signup, WhatsApp OTP, invalid OTP, expired OTP, manual SMS fallback, SMS OTP, provider failure, rate limit, session, `/sync`, `/me`, `/invite`. *(Note: E2E execution of provider-dependent states must be marked BLOCKED until Twilio is configured. Unit/integration tests can mock responses).*
- **OAuth**: Test Google/Facebook callback, sync, status fetch, and redirect.
- **Access Control**: Ensure unauthenticated users are blocked, pending users cannot access dashboard, active users cannot access invite.
- **Regression**: Existing Login, Logout, /sync, /me, and backend JWT validation must remain functional.

## 7. Supabase Dashboard Configuration Checklist
*(Secrets must be stored securely in the Supabase Dashboard, NOT in the frontend `.env.example`)*

### Email
- [ ] Email authentication enabled
- [ ] Email confirmation enabled
- [ ] Confirm signup email template configured
- [ ] `{{ .Token }}` included in template
- [ ] Custom SMTP configured
- [ ] Email rate limit configured (`rate_limit_email_sent`)
- [ ] Site URL configured (`http://localhost:3001`)
- [ ] Redirect URLs configured (e.g. `http://localhost:3001/auth/callback`)

### Phone
- [ ] Phone authentication enabled
- [ ] Phone confirmation enabled
- [ ] WhatsApp provider configured (e.g. Twilio Verify)
- [ ] SMS provider/fallback configured
- [ ] Provider credentials/configuration verified
- [ ] Phone rate limits reviewed

### OAuth
- [ ] Google provider configuration
- [ ] Facebook provider configuration
- [ ] Redirect URLs configured
