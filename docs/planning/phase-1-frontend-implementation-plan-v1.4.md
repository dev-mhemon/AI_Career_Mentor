# Phase 1 Frontend Implementation Plan v1.4

## 1. Overview
This plan governs the frontend implementation for Phase 1 Authentication & Access Control, updating v1.3 to resolve real-world signup flow issues (missing Phone UI, Email link vs OTP flow, rate limiting). It strictly adheres to the frozen PRD v1.1 and SAD v1.1.

## 2. Authentication Flow Design

### 2.1 Email Registration
- **Action**: Uses `supabase.auth.signUp({ email, password })`.
- **Flow**: Returns a `session == null` state if email confirmation is required.
- **Routing**: Redirects the user to `/verify?type=email&identifier=<email>`.

### 2.2 Phone Registration (WhatsApp/SMS)
- **Status**: Required feature blocked by infrastructure dependency (Twilio/WhatsApp provider missing).
- **Action**: Uses `supabase.auth.signUp({ phone, password, options: { channel: 'whatsapp' } })` (falling back to SMS if needed).
- **Flow**: Returns a `session == null` state.
- **Routing**: Redirects the user to `/verify?type=phone&identifier=<phone>`.

### 2.3 Email Verification (OTP)
- **Mechanism**: Supabase sends a 6-digit OTP alongside the magic link in the default email template (using `{{ .Token }}`).
- **Verification**: Uses `supabase.auth.verifyOtp({ email, token, type: 'signup' })`.

### 2.4 Phone/WhatsApp Verification (OTP)
- **Mechanism**: Supabase sends a 6-digit OTP via the configured SMS/WhatsApp provider.
- **Verification**: Uses `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`.

### 2.5 Unified Verification Screen
- **Location**: `app/(auth)/verify/page.tsx`
- **Responsibility**: A reusable screen capable of verifying either Email or Phone depending on query parameters.
- **UX**: Dynamically displays "Enter the verification code sent to your [email/WhatsApp]".
- **States**: Initial, Code entry, Verifying (loading), Success.
- **Errors**: Invalid code, Expired code, Provider failure, Network failure, Too many attempts.

### 2.6 Resend Behavior
- **Action**: Uses `supabase.auth.resend({ type: 'signup', email })` or `supabase.auth.resend({ type: 'sms', phone })`.
- **Cooldown**: 60-second client-side timer enforced to prevent immediate repeated requests.
- **Rules**: No automatic resend loops. Clearly displays rate-limit errors from the provider.

### 2.7 Rate-Limit Handling
- **Issue**: Supabase applies strict default rate limits to auth emails and OTP requests.
- **Strategy**: Display a professional, user-facing error message (e.g., "Too many requests. Please wait a minute and try again.") on `429 Too Many Requests`. Never attempt to bypass provider controls or implement automatic retry loops.

## 3. Session Establishment & Orchestration
After a successful `verifyOtp()` (or standard login):

1. **Session Establishment**: `verifyOtp()` returns a valid Supabase session.
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
- Issue JWTs, send verification emails/OTPs, manage credentials, enforce rate limits.

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
- **Phone**: Test phone validation, OTP request, valid/invalid/expired handling, and provider failure states.
- **OAuth**: Test Google/Facebook callback, sync, status fetch, and redirect.
- **Access Control**: Ensure unauthenticated users are blocked, pending users cannot access dashboard, and active users cannot access invite.
- **Regression**: Existing Login, Logout, /sync, /me, and backend JWT validation must remain fully functional.

## 7. Infrastructure Dependencies
- **Phone/WhatsApp Auth**: Blocked in end-to-end testing until a provider (e.g., Twilio / Twilio Verify for WhatsApp) is configured in the Supabase Dashboard.
- **Email Rate Limits**: Highly recommended to configure a custom SMTP provider in Supabase to bypass the strict free-tier rate limits.

## 8. Explicit Out-of-Scope Items
- Phone Authentication is **NOT** out-of-scope (it is required), but it is blocked by infrastructure.
- User profile, Career roadmap, AI mentor, Learning tasks, Progress tracking, Admin dashboard, and Career knowledge base remain completely out of scope for Phase 1.
