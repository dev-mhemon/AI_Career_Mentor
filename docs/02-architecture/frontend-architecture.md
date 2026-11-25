# Frontend Architecture (`M01`–`M14`)

**Status:** Draft / review pending (synchronized through `M14-D`, 2026-11-25). Derived from [PRD (C01)](../01-product/PRD.md), [SAD (C02)](SAD.md), [API Specification (C05)](../05-api/API-Specification.md), [UI/UX Specification (C09)](../01-product/UIUX-Specification.md), and the implemented Next.js 16 App Router application under `frontend/src/`. Adopted C01–C09 specifications control policy; this derived document does not introduce new product requirements, endpoints, or release acceptance.

---

## 1. Runtime Stack & Design Constraints

- **Framework & Runtime:** Next.js `16.3.8` App Router, React 19 (clean state rules: zero synchronous `setState` inside `useEffect` or render; SSR-safe `useSyncExternalStore` for browser connectivity/storage listeners), TypeScript strict mode (`type` aliases rather than `interface` for component/DTO contracts), Tailwind CSS v4, npm lockfiles, and Vitest + Testing Library.
- **Typography (`frontend/src/fonts.ts` & [layout.tsx](../../frontend/src/app/layout.tsx)):** Self-hosted via `next/font/google`: `Hind Siliguri` (Bangla-first body/UI), `Inter` / `Geist` (English SaaS & UI chrome), and `JetBrains Mono` (code blocks, timestamps, and telemetry/ID badges). No fake font stubs.
- **Zero Direct Application DB Writes (`ADR-019`):** All application reads and mutations flow through the NestJS backend (`/api/v1/**`). Browser Supabase SDK usage is restricted strictly to Auth OAuth redirect/session handoff; private domain tables are never written directly from browser code.

---

## 2. Complete 25-Screen Route Map & Route Groups

Every screen in `C09 §3` (`Screens 01–25`) plus the dedicated Admin Audit Logs view is mapped across five App Router route groups:

| Route Group / Access Policy | Route (`frontend/src/app/**`) | C09 Screen(s) | Purpose & Guard Invariant |
|---|---|---|---|
| **Public Entry** | `/` (`page.tsx`) | Screen 01 | Public Bangla-first landing page & CTA entry |
| **Auth (`(auth)/`)** | `/login` | Screen 02 | Email/BD phone password login + Google/Facebook OAuth with personalized last-used hint |
| **Auth (`(auth)/`)** | `/register` | Screen 03 | Open signup (email or `+880` phone, 8-char password policy, privacy consent) |
| **Auth (`(auth)/`)** | `/verify` | Screen 04 | 6-digit OTP verification (`/verify?channel=<email\|phone>`, zero identifier in URL per `R18`) |
| **Auth (`(auth)/`)** | `/forgot-password`, `/reset-password` | Screens 05–06 | Anti-enumeration recovery initiation & OTP password reset (`R18` draft lifecycle) |
| **Auth Callback** | `/auth/callback` (`route.ts`) | OAuth Bridge | Exchanges OAuth code, calls `EP-A10`, routes by `next_step` (`dashboard`, `profile_setup`, `add_verified_contact`, or `/admin` for active `ADMIN`) |
| **Onboarding (`(onboarding)/`)** | `/onboarding`, `/onboarding/profile`, `/onboarding/skills`, `/onboarding/preferences`, `/onboarding/goal`, `/onboarding/clarify` | Screens 07–11 | Optional skippable profile setup, explicit beginner `None`, learning preferences, dynamic goal capture & 2-round AI clarification (`active ADMIN` redirected to `/admin`) |
| **Learner Core (`(app)/`)** | `/dashboard` | Screen 13 | Learner command center, Focus Roadmap summary, and `N01`-gated `DashboardTechUpdatesPreview` (fetched strictly when `effective_access.technology_update === true`) |
| **Learner Core (`(app)/`)** | `/roadmaps`, `/roadmaps/[id]/draft`, `/roadmaps/[id]` | Screens 12, 14, 15 | Multi-roadmap hub (`<= 3` active), draft review/revision/lock (`>45` topic guardrail), locked roadmap detail, merge diff viewer & Undo |
| **Learner Core (`(app)/`)** | `/daily-plan`, `/today` | Screens 16–17 | Sequential day-by-day plan & rebuild (frozen completed/in-progress/quiz-active days) and Today's Topic (`EP-L04` 5-state machine + shared resources) |
| **Learner Core (`(app)/`)** | `/quiz/[attemptId]` | Screen 18 | Daily practice quiz (MCQ + FR + `"I don't know"`), deterministic MCQ grading & async AI Practice Review (`EP-PR01`–`EP-PR03`) |
| **Learner Core (`(app)/`)** | `/progress` | Screen 19 | Level-scoped skill mastery (`Not Started` / `Learning` / `Practicing` / `Proficient`) & append-only achievement history (zero `"Job Ready"` labels) |
| **Learner Core (`(app)/`)** | `/mentor` | Screen 20 | Contextual AI Mentor two-pane chat (`R15` SSE streaming, 90-day retention sweep, strictly zero rating/report controls per `R34`) |
| **Learner Core (`(app)/`)** | `/tech-updates` | Screen 21 | Personalized Daily Technology Intelligence (`R10` default-OFF locked card when disabled; `R25` status banners & grounded citations when enabled) |
| **Learner Account (`(app)/`)** | `/profile`, `/career-profile`, `/settings` | Screens 07–09, 22 | Inline profile/skill/career-goal management and Screen 22 Account Settings (identity linking, secondary contact, learning settings, Danger Zone account deletion accessible even when `suspended` per `PRD §7`) |
| **Isolated Admin (`(app)/admin/`)** | `/admin`, `/admin/users`, `/admin/features`, `/admin/audit-logs` | Screens 23–25 + Audit | Server-verified `ADMIN`-only workspace (`EP-AD01`–`EP-AD08`): usage/cost UTC series, user search/inspect/suspend, global & per-user `R10` feature toggles, and tamper-proof audit logs |

---

## 3. Complete 29/29 `C09 §2` SPEC Component Inventory

All 29 normative component contracts from `C09 §2` are implemented as modular React components and indexed in [COMPONENT-INVENTORY.md](../../frontend/src/components/ui/COMPONENT-INVENTORY.md) (§8):

- **Navigation & Layout (01–04):** `Header` (`01`), `Sidebar` (`02`), `BottomNavigation` (`03`, mobile `md:hidden` 5-tab bar for active learners only — omitted on `admin` and `suspended` accounts), `StepIndicator` (`04`).
- **Forms & Feedback Primitives (05–12):** `Input` (`05`), `Select` / `MultiSelectCombobox` (`06`), `Checkbox` (`07`), `ToggleSwitch` (`08`), `MultiStepFormWrapper` (`09`), `Modal` (`10`), `Toast` (`11`), `Tabs` / `SegmentedTabs` (`12`).
- **Career, Roadmap & Learning Cards (13–20):** `CareerCard` (`13`), `SkillCard` (`14`), `SkillBadge` (`15`), `RoadmapPhaseCard` (`16`), `RoadmapDiffViewer` (`17`), `MilestoneCard` (`18`), `DailyTaskCard` (`19`), `LearningResourceCard` (`20`).
- **Assessment, Progress & AI Components (21–29):** `QuizCard` (`21`), `PracticeReviewCard` (`22`), `SkillProgressBadge` (`23`), `ProgressHistoryCard` (`24`), `AIExplanationCard` (`25`), `AIRecommendationCard` (`26`), `AIChatMessage` (`27`), `AILoadingState` (`28`), `AIFeedbackComponent` (`29`).

---

## 4. Session, Proxy & API Client Architecture

1. **Server-Verified Auth & Zero JWT-Role Trust (`PRD §50`):**
   - Edge proxy ([proxy.ts](../../frontend/src/proxy.ts)) enforces authenticated route protection and session cookie handling without trusting browser-supplied role claims.
   - Server Components read current user identity and effective feature access strictly through server-verified `EP-A13 /api/v1/auth/me` via `getAppSessionStateResult` (`frontend/src/lib/auth/user.ts`) and [shell-user.ts](../../frontend/src/lib/auth/shell-user.ts).
   - Active `ADMIN` accounts are isolated to `/admin/**` across Server Layouts and `AdminWorkspaceGuard`; suspended admins bypass the admin workspace redirect so they retain access to `/settings` and account deletion (`PRD §7`).
2. **Single-Flight Token Refresh (`EP-A07`):**
   - Server Actions ([actions.ts](../../frontend/src/lib/auth/actions.ts)) wrap authenticated backend requests in `withSingleSessionRefresh`, rotating refresh tokens once on `401` and clearing local session state on terminal refresh failure without entering refresh loops.
   - Read-only Server Component renders never mutate cookies or rotate tokens.
3. **Typed API Client & Error Mapping:**
   - [client.ts](../../frontend/src/lib/api/client.ts) implements typed runtime-validated requests for all canonical backend endpoints, case-insensitive `Idempotency-Key` attachment (`withIdempotencyKey`) for `H-IDEM` mutations, and `EP-J01` job polling.
   - [error-mapper.ts](../../frontend/src/lib/api/error-mapper.ts) maps `C05 §16` error envelopes (`code`, `message`, `details`, `requestId`, `retryAfterSeconds`) into user-safe Bangla/English UI messages without exposing raw stack traces, SQL errors, or AI provider details.

---

## 5. Resilience, Input Preservation (`R16`/`R18`), Accessibility & PWA Boundary

- **`R16` Unsaved Input Preservation:** Form components (`LoginForm`, `RegisterForm`, `GoalSetupForm`, `AIFeedbackComponent`, `QuizSessionView`, `MentorChatView`, and `MultiStepFormWrapper`) retain entered user text and selections across retryable API errors (`422`, `429`, `502`, `503`, `504`) and transient network failures.
- **`R18` Verification Draft Lifecycle ([verification-draft.ts](../../frontend/src/lib/auth/verification-draft.ts)):** Stores only `{ channel, normalized_identifier, contact_masked, expires_at, context }` in `sessionStorage` with TTL `min(server challenge expiry, 10 minutes)`. Contact identifiers never enter URLs, query parameters, `localStorage`, or telemetry; passwords, OTP codes, and JWTs never enter drafts.
- **Offline & Reconnected Recovery (`Header`):** Pure `useSyncExternalStore` network listener displays an accessible offline alert (`role="alert"`) when `navigator.onLine === false` and transitions to a `"Connection restored"` status banner (`role="status"`, auto-dismissed after 4 seconds) upon reconnection.
- **Practical WCAG 2.1 AA & Bangla-First UX:**
  - `SkipLink` targets `#main-content`; interactive touch targets meet `>= 44x44px` on mobile navigation (`BottomNavigation`, `Header`, action buttons); status badges combine icon + text label (never color alone); modals/drawers enforce focus entry, keyboard focus trap, and `Escape` focus restoration.
  - Global `@media (prefers-reduced-motion: reduce)` rule in [globals.css](../../frontend/src/app/globals.css) collapses animation/transition durations and disables smooth scrolling.
  - Mixed Bangla/English learner inputs use `dir="auto"`; `Header` provides a learner-only `BN / EN` mode indicator with `aria-label="Language mode: Bangla and English"`.
- **PWA Scope Boundary (`C01 §4/§54/§58`, `C09 §8`):**
  - [manifest.ts](../../frontend/src/app/manifest.ts) emits `/manifest.webmanifest` (`start_url: '/today'`, `display: 'standalone'`, `lang: 'bn'`, `theme_color: '#0f766e'`, `background_color: '#f8fafc'`) referencing verified raster and vector assets under `frontend/public/icons/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `icon.svg`).
  - Strictly **zero** Service Worker registration (`navigator.serviceWorker.register`) and **zero** Web Push permission requests (`Notification.requestPermission`) exist in `frontend/src/`, honoring `C01 §58` non-goals (verified in `m14-pwa-a11y-qualification.test.tsx`).

---

## 6. Privacy-Filtered Telemetry (`C09 §7`)

[telemetry.ts](../../frontend/src/lib/telemetry/telemetry.ts) enforces the strict `C09 §7` event contract:

- **14 Allowlisted Events (`TelemetryEventName`):** `page_viewed`, `auth_login_submitted`, `auth_signup_submitted`, `auth_otp_verified`, `onboarding_started`, `profile_completed`, `career_goal_submitted`, `ai_generation_requested`, `ai_generation_succeeded`, `ai_generation_failed`, `roadmap_activated`, `learning_started`, `quiz_submitted`, `mentor_message_sent`. Unlisted events are dropped.
- **Resilient Anonymous Session Rotation:** Generates a per-tab UUID v4 `anonymous_session_id` in `sessionStorage` and rotates it cleanly on Sign In / Sign Out (`rotateTelemetrySessionId()`). If `sessionStorage.setItem` fails (e.g., quota/restricted mode), the rotated in-memory UUID remains authoritative across subsequent `getTelemetrySessionId()` / `trackEvent()` calls instead of falling back to a stale stored UUID, restoring storage reads only after a later `setItem` succeeds.
- **Strict Field-Specific Metadata Key & Value Allowlists:** Only 9 explicit metadata keys are permitted (`feature_key`, `screen_name`, `request_id`, `channel`, `step`, `status_code`, `error_code`, `reason_code`, `source`); all other keys (`detail`, `contact_number`, `content`, `goal_text`, `answer_text`, `email`, `phone`, `password`, etc.) are dropped unconditionally. Every allowlisted field enforces its own strict value domain (preventing disguised phone/PII strings such as `'01712-345678'`):
  - `screen_name`: 27 registered screens/flows (`landing`, `login`, `register`, `forgot_password`, `reset_password`, `verify_otp`, `onboarding_profile`, `onboarding_goal`, `onboarding_review`, `onboarding_generating`, `onboarding_ready`, `roadmap_draft`, `dashboard`, `career_profile`, `roadmaps`, `roadmap_detail`, `daily_plan`, `today`, `quiz`, `progress`, `mentor`, `tech_updates`, `settings`, `admin_dashboard`, `admin_users`, `admin_features`, `admin_audit_logs`).
  - `feature_key`: 7 canonical features (`roadmap_generator`, `daily_plan`, `quiz_practice`, `ai_practice_review`, `progress_tracking`, `ai_mentor`, `technology_update`) plus `onboarding` and `auth`.
  - `channel`: `email`, `phone`, `google`, `oauth`, `otp`, `password`, `web`, `pwa`.
  - `source`: `web`, `pwa`, `sidebar`, `bottom_nav`, `header`, `onboarding`, `career_profile`, `dashboard`, `roadmap_draft`, `today`, `daily_plan`, `quiz`, `mentor`, `settings`, `manual`, `retry`.
  - `step`: `1`..`5` (integer or string) or `profile`, `goal`, `review`, `generating`, `ready`, `verify`, `submit`.
  - `error_code` / `reason_code`: uppercase snake-case enum pattern `/^[A-Z][A-Z0-9_]{1,47}$/` failing all email/phone/JWT patterns.
  - `request_id`: UUID v4 or `req_[A-Za-z0-9_-]{8,48}` only.
  - `status_code`: finite integer `100..599` only.
- **Fail-Safe Non-Throwing Contract:** All `sessionStorage`, `crypto`, and custom `TelemetrySink` invocations are wrapped in `try/catch` so restricted storage environments or throwing sinks never abort UI flows (such as post-`lockRoadmap` navigation).

---

## 7. Verification Cross-References

See [QA-plan.md](../08-testing/QA-plan.md) for the full M01–M14 frontend test matrix (`78` Vitest suites, including `m14-pwa-a11y-qualification.test.tsx`, which provides jsdom structural, DOM landmark, and Tailwind responsive-class contract coverage for `360px`/`768px`/`1024px+` layouts, WCAG 2.1 AA controls, PWA asset/non-SW checks, offline recovery, `R16` preservation, and zero-PII telemetry; live multi-browser viewport rendering at `360px`/`768px`/`1024px+` remains explicitly pending staging/browser execution) and [backend-architecture.md](backend-architecture.md) for the corresponding NestJS service architecture.
