# Phase 1 Frontend Implementation Plan v1.6

## 1. Overview
This plan governs the frontend implementation for Phase 1 Authentication & Access Control. It updates v1.5 to resolve final technical ambiguities regarding Supabase API shapes, explicit configuration behaviors, rate limits, and fallback strategies, ensuring full alignment with the frozen PRD v1.1 and SAD v1.1.

## 2. Authentication Flow Design

### 2.1 Email Registration & Configuration
- **Configuration**: Email confirmation must be **ENABLED** in Supabase.
- **Email Template**: To support our in-app verification UX without relying on magic links, the Supabase Email Confirmation template must be configured in the dashboard to expose the raw OTP via the `{{ .Token }}` variable. The `{{ .ConfirmationURL }}` variable must not be treated as the primary signup UX.
- **Action**: `supabase.auth.signUp({ email, password })`.
- **Flow**: Returns a `session == null` state because confirmation is pending.
- **Routing**: Redirects the user to `/verify?type=email&identifier=<email>`.

### 2.2 Phone Registration (WhatsApp/SMS)
- **Configuration**: Phone confirmation must be **ENABLED**.
- **Status**: Required feature blocked by infrastructure configuration. (Twilio / Twilio Verify is not yet set up in the Supabase Dashboard).
- **Channels**: 
  - Primary channel: WhatsApp
  - Fallback channel: SMS
- **Fallback Mechanism**: Supabase does **not** automatically fall back from WhatsApp to SMS internally. The **Application** explicitly requests SMS fallback through a supported API. If the initial WhatsApp OTP fails or the user chooses to switch, the frontend UI must provide a "Send via SMS instead" button, which calls `resend()` explicitly for the SMS channel.
- **Action**: `supabase.auth.signUp({ phone, password, options: { channel: 'whatsapp' } })`.
- **Flow**: Returns a `session == null` state.
- **Routing**: Redirects the user to `/verify?type=phone&identifier=<phone>`.

### 2.3 Email Verification (OTP)
- **Verification API**: The exact API expected by the SDK for an email/password signup confirmation is:
  ```typescript
  supabase.auth.verifyOtp({
    email: string,
    token: string,
    type: 'signup'
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
  - **OTP Length**: Do not hard-code a 6-digit assumption. The input field must support the actual configured verification token format (which can be customized in Supabase).
- **States**: Code entry, Verifying (loading), Success.
- **Errors**: Invalid code, Expired code, Too many attempts, Provider failure, Network failure.

### 2.6 Resend Behavior
- **Action**: 
  - Email: `supabase.auth.resend({ type: 'signup', email })`.
  - Phone (SMS Fallback): `supabase.auth.resend({ type: 'sms', phone })`.
- **Cooldown**: 60-second client-side timer enforced.
- **Rules**: 
  - User can manually resend after cooldown.
  - No automatic resend loops.
  - No automatic retry loops after a `429 Too Many Requests` error.
  - Provider rate-limit errors must be surfaced professionally.

### 2.7 Email Rate Limits & Custom SMTP
- **Rate Limit Documentation**: The current built-in Supabase email service enforces a strict limit of **3 emails per hour**. This is a provider/service delivery limit, and development testing will hit this limit quickly.
- **Enforcement**: Frontend must not bypass this limit. 429/rate-limit errors must be displayed clearly to the user.
- **Custom SMTP**: Custom SMTP is a recommended infrastructure configuration for reliable development and production email delivery, subject to the SMTP provider's own limits and Supabase configuration. It is not an exploit to bypass security, but a necessary scale configuration.

## 3. Final Step-by-Step Flows

### 3.1 Final Email Flow
1. Email + Password
2. Supabase `signUp()`
3. Email confirmation required (session == null)
4. OTP/token delivered by configured Supabase email template (`{{ .Token }}`)
5. Redirect to `/verify`
6. `verifyOtp({ email, token, type: 'signup' })`
7. Supabase session established
8. `POST /api/auth/sync`
9. `GET /api/auth/me`
10. `PENDING_INVITE` → redirect to `/invite` | `ACTIVE` → redirect to `/dashboard`

### 3.2 Final Phone Flow
1. Phone + Password
2. Supabase `signUp({ ..., options: { channel: 'whatsapp' } })`
3. Phone confirmation required (session == null)
4. WhatsApp OTP delivered via configured provider
5. Redirect to `/verify`
6. `verifyOtp({ phone, token, type: 'sms' })`
7. Supabase session established
8. `POST /api/auth/sync`
9. `GET /api/auth/me`
10. `PENDING_INVITE` → redirect to `/invite` | `ACTIVE` → redirect to `/dashboard`
*(If WhatsApp delivery fails, user clicks "Send via SMS instead", application calls `resend({ type: 'sms', phone })`, and flow resumes at step 5).*

## 4. Google & Facebook OAuth
- **Flow**: User clicks button → Browser client `signInWithOAuth` → external provider consent → redirects to `/auth/callback`.
- **Callback**: Server Route Handler calls `exchangeCodeForSession()`, orchestrates `/sync` and `/me`, and redirects to `/invite` or `/dashboard`.

## 5. Architectural Boundaries
- **Supabase**: Issues JWTs, sends verification emails/OTPs, manages credentials, enforces rate limits.
- **Next.js**: Refreshes session via Proxy, protects unauthenticated routes, orchestrates auth handoff (`/sync`, `/me`), abstracts API calls via Bearer token. Does not verify JWT signatures.
- **NestJS**: Final application security authority. Verifies ES256 JWT signatures via Supabase JWKS. Handles RBAC and invitation status.

## 6. Testing Strategy
- **Email**: Test signup, email confirmation pending state, verification screen, valid/invalid/expired OTP, resend manual triggers, resend cooldown, 429/rate-limit, successful session, `/sync`, `/me`, `/invite`, `/dashboard`.
- **Phone**: Test phone validation, WhatsApp OTP request, valid/invalid/expired OTP, resend, SMS fallback behavior (app-initiated), provider unavailable, session establishment, `/sync`, `/me`, `/invite`. *(Note: E2E execution of SMS fallback behavior is blocked by infrastructure testing constraints until Twilio is configured).*
- **OAuth**: Test Google/Facebook callback, sync, status fetch, and redirect.
- **Access Control**: Ensure unauthenticated users are blocked, pending users cannot access dashboard, active users cannot access invite.
- **Regression**: Existing Login, Logout, /sync, /me, and backend JWT validation must remain functional.

## 7. Infrastructure Dependencies
- **Phone/WhatsApp Auth**: Twilio / Twilio Verify must be configured in the Supabase Dashboard.
- **Email Template**: Dashboard configuration required to expose `{{ .Token }}`.
- **Email Delivery**: Custom SMTP configuration is recommended for reliable delivery without arbitrary 3-emails/hour blocks.
