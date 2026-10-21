# Phase 1 Frontend Implementation Plan v1.5

## 1. Overview
This plan governs the frontend implementation for Phase 1 Authentication & Access Control. It updates v1.4 to resolve technical ambiguities regarding Supabase OTP APIs, email template behavior, WhatsApp/SMS fallbacks, and rate-limit handling, strictly adhering to the frozen PRD v1.1 and SAD v1.1.

## 2. Authentication Flow Design

### 2.1 Email Registration
- **Action**: Uses `supabase.auth.signUp({ email, password })`.
- **Flow**: Returns a `session == null` state if email confirmation is required.
- **Routing**: Redirects the user to `/verify?type=email&identifier=<email>`.

### 2.2 Phone Registration (WhatsApp/SMS)
- **Status**: Required feature blocked by infrastructure dependency (Twilio/WhatsApp provider missing).
- **Action**: Uses `supabase.auth.signUp({ phone, password, options: { channel: 'whatsapp' } })` for the primary WhatsApp channel.
- **Fallback**: Supabase does **not** automatically fall back from WhatsApp to SMS. Fallback is an application-level responsibility (e.g., a "Send via SMS instead" button on the verification screen that triggers a new request without the `whatsapp` channel parameter).
- **Flow**: Returns a `session == null` state.
- **Routing**: Redirects the user to `/verify?type=phone&identifier=<phone>`.

### 2.3 Email Verification (OTP)
- **Requirement**: The Supabase email template must be configured to include the `{{ .Token }}` variable. This project relies on the explicit OTP code, not the `{{ .ConfirmationURL }}` magic link, to provide an uninterrupted in-app UX.
- **Verification API**: Uses exactly `supabase.auth.verifyOtp({ email, token, type: 'signup' })`.

### 2.4 Phone/WhatsApp Verification (OTP)
- **Mechanism**: Supabase sends an OTP via the configured Twilio SMS/WhatsApp provider.
- **Verification API**: Uses exactly `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`.

### 2.5 Unified Verification Screen
- **Location**: `app/(auth)/verify/page.tsx`
- **Responsibility**: A reusable screen capable of verifying either Email or Phone depending on URL query parameters.
- **UX Behavior**:
  - Dynamically displays generic instructions like: "Enter the verification code sent to your email" or "WhatsApp".
  - **OTP Length**: The input field should **not** hardcode a "6-digit" limit. It should be a standard text input for the verification code, as provider/Supabase configurations can alter OTP lengths (though 6 is the default).
- **States**: Initial, Code entry, Verifying (loading), Success.
- **Errors**: Invalid code, Expired code, Provider failure, Network failure, Too many attempts.

### 2.6 Resend Behavior
- **Action**: 
  - Email: Uses exactly `supabase.auth.resend({ type: 'signup', email })`.
  - Phone: Uses exactly `supabase.auth.resend({ type: 'sms', phone })`.
- **Cooldown**: 60-second client-side timer enforced to prevent immediate repeated requests.
- **Rules**: 
  - User can manually resend after cooldown.
  - No automatic resend loops.
  - No automatic retry loops after a `429 Too Many Requests` error.
  - Provider rate-limit errors must be surfaced professionally to the user.

### 2.7 Rate-Limit Handling & Custom SMTP
- **Issue**: Supabase built-in email delivery has strict provider/service rate limits (typically 3-4 emails per hour on the free shared tier). Development testing will rapidly hit these limits.
- **Strategy**: 
  - Frontend must catch `429 Too Many Requests` errors and display a clear user-facing message (e.g., "Too many requests. Please wait a minute and try again.").
  - **Infrastructure Recommendation**: Custom SMTP is a recommended infrastructure configuration for reliable development/production email delivery, subject to the SMTP provider's own limits and Supabase configuration. It should NOT be viewed as a tool to "bypass" security controls.

## 3. Session Establishment & Orchestration
After a successful `verifyOtp()` (or standard login), the exact flow is:

1. **Session Establishment**: `verifyOtp()` natively returns a valid Supabase session.
2. **Token Extraction**: Extract the access token.
3. **Sync**: Call `POST /api/auth/sync` via the Next.js Server Action to ensure the user exists in NestJS.
4. **Status Check**: Call `GET /api/auth/me` to determine application-level status.
5. **Routing**:
   - `PENDING_INVITE` → redirect to `/invite`
   - `ACTIVE` → redirect to `/dashboard`
6. **Failure**: Rollback session (`signOut()`) and display a clear error if sync/me fails. Do not leave the user in an inconsistent state.

## 4. Google & Facebook OAuth
- **Flow**: User clicks button → Browser client `signInWithOAuth` → external provider consent → redirects to `/auth/callback`.
- **Callback**: Server Route Handler calls `exchangeCodeForSession()`, orchestrates `/sync` and `/me`, and redirects to `/invite` or `/dashboard`.

## 5. Architectural Boundaries

### 5.1 Supabase Responsibility
- Issue JWTs, send verification emails/OTPs (via `{{ .Token }}` or Twilio), manage credentials, enforce rate limits.

### 5.2 Next.js Responsibility
- **Proxy**: Session refresh (via `getUser()`), lightweight authentication boundary for protected routes (`/dashboard`, `/invite`). Redirects unauthenticated users to `/login`. DOES NOT call `/api/auth/me` or decide application status.
- **Server Actions**: Handle orchestrating `signUp`, `verifyOtp`, `resend`, `/sync`, `/me`, and redirects. Do not perform JWT signature verification.
- **API Client**: Attaches Bearer token and abstracts HTTP errors.
- **Server Components**: Implement business-level route guards based on `/me`.

### 5.3 NestJS & PostgreSQL Responsibility
- **NestJS**: The final application security authority. Verifies ES256 JWT signatures via Supabase JWKS. Handles RBAC and invitation status.
- **PostgreSQL**: Stores local application user records, skills, roadmap, etc.

## 6. Testing Strategy
- **Email**: Test registration, password validation, successful delivery state, valid/invalid/expired code handling, resend cooldown logic, rate limit handling, and the full orchestration to `/invite` or `/dashboard`.
- **Phone**: Test phone validation, OTP request, fallback to SMS UI state, valid/invalid/expired handling, and provider failure states.
- **OAuth**: Test Google/Facebook callback, sync, status fetch, and redirect.
- **Access Control**: Ensure unauthenticated users are blocked, pending users cannot access dashboard, and active users cannot access invite.
- **Regression**: Existing Login, Logout, /sync, /me, and backend JWT validation must remain fully functional.

## 7. Infrastructure Dependencies
- **Phone/WhatsApp Auth**: Blocked in end-to-end testing until Twilio / Twilio Verify is configured for WhatsApp/SMS in the Supabase Dashboard.
- **Email Delivery**: Custom SMTP is recommended for reliable OTP email delivery. The Supabase email template must be verified to contain the `{{ .Token }}` variable.

## 8. Explicit Out-of-Scope Items
- Phone Authentication is **NOT** out-of-scope (it is required), but it is blocked by infrastructure.
- User profile, Career roadmap, AI mentor, Learning tasks, Progress tracking, Admin dashboard, and Career knowledge base remain completely out of scope for Phase 1.
