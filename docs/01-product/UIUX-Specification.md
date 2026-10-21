# AI Career Intelligence Mentor Platform

# UI/UX Specification Document v2.0.2

## Enterprise Frontend Implementation Contract — Final Release Edition

**Version:** v2.0.2  
**Supersedes:** UI/UX Specification Document v2.0.1  
**Status:** ENTERPRISE RUNTIME NOT EXECUTED (FINAL RELEASE — COMPLETE SCREEN & COMPONENT CONTRACTS)

------------------------------------------------------------------------

# 1. Document Purpose & Core UX Guardrails

This document defines the approved, binding frontend implementation contract for the **AI Career Intelligence Mentor Platform** built with **Next.js + TypeScript + React + Tailwind CSS**.

It preserves 100% alignment with:

- PRD v1.4.1 (Final Freeze)
- SAD v1.1.1 (ADRs 001–020)
- DDD v1.2.2 (50-Table Domain Model)
- DIS v1.1.1 (Database Implementation Specification)
- API Specification v1.5.1 (82 catalog entries (81 HTTP routes + internal EP-G04) & DTOs)
- DMS v1.2.2 (Migrations 000–020)
- Database Implementation Validation Report v1.1
- AI System Design v1.1.1

## 1.1 Product Boundary & UX Guardrails

The platform is a **Personal AI Career Mentor** for technology learners and professionals in Bangladesh.

It is **not**:

- A course marketplace
- A generic chatbot
- An LMS
- A job board
- A resume service

Mandatory product guardrails enforced across every screen and component:

1. **Bangla-First Mixed Language UX (PRD §4, §26):** The MVP user interface is primarily Bangla, retaining English for technical terms where clearer and supporting natural Bangla-English mixed wording. User inputs (career goals, short free-response quiz answers, AI Mentor chat) accept Bangla, English, and natural Bangla-English mixed language.
2. **Learning Progress vs. Job Readiness Exclusion (PRD §34–§36):** The UI displays only the four approved learning states (`Not Started`, `Learning`, `Practicing`, `Proficient`) per skill and Career Level (`Junior`, `Mid`, `Senior`). The UI must **never** display `"Job Ready"`, `"You will get a job"`, or gamified badge/trophy achievements.
3. **PWA & Bangladesh Mobile Network Resilience (PRD §4, §54, §58):** The MVP is a mobile-responsive Progressive Web App (PWA) optimized for common mobile devices and slower Bangladesh network conditions. Unsaved form and quiz inputs are preserved locally across retryable network errors (`PRD §54`), and an offline reconnection banner is shown when disconnected, but **offline learning mode and push notifications are excluded from the MVP (`PRD §4, §58`)**.
4. **Backend-Mediated Data Access (`ADR-019`):** All state mutations flow through the NestJS REST API (`/api/v1/*`) using typed feature services; the frontend never writes directly to Supabase tables.

## 1.2 v2.0.1 → v2.0.2 Final Enhancement Summary

UI/UX Specification Document v2.0.2 completes all implementation contracts:

- **29 Production Component Implementation Contracts (§2):** Full specifications for Purpose, Variants, States, Props, Events, Responsive Behavior, Accessibility Rules, and Data Contracts. Renamed `ProgressReadinessIndicator` → `SkillProgressBadge` and `AchievementCard` → `ProgressHistoryCard` to enforce PRD §34–§36.
- **25 Production Screen Implementation Contracts (§3):** Complete 15-attribute implementation specifications for every Public, Authentication, Onboarding, Main Application, and Admin screen.
- **Complete 12-Domain API Traceability Matrix (§4):** Maps every frontend feature service to its REST v1.5.1 endpoint, HTTP method, Request/Response DTOs, loading/error states, and cache invalidation rules.
- **Roadmap Mutation UX Contract (§5), Security UX Rules (§6), Telemetry Contract (§7), and Developer Handoff Checklist (§8).**

------------------------------------------------------------------------

# 2. Component Implementation Contracts (All 29 Production Components)

Every production component enforces **WCAG 2.1 AA** accessibility (minimum 4.5:1 text contrast, visible keyboard focus rings, ARIA roles/labels, `44x44px` minimum mobile touch targets, and never relying on color alone to convey status per PRD §54).

## 2.1 Navigation Components (Components 01–04)

| # | Component | Purpose | Variants | States | Props & Data Contract (`API v1.5.1`) | Events | Responsive & A11y Rules |
|---|---|---|---|---|---|---|---|
| **01** | `Header` | Top application bar with Focus Roadmap switcher, language hint, and account menu | `public`, `authenticated`, `admin` | `default`, `focus_switching`, `offline_banner` | `user: AuthUserDTO \| null`, `focusRoadmap: RoadmapSummaryDTO \| null`, `activeRoadmaps: RoadmapSummaryDTO[]` | `onSwitchFocus(roadmapId)`, `onLogout()`, `onOpenSettings()` | Sticky top (`h-16`); includes hidden "Skip to main content" link; focus switcher uses `aria-expanded` and `aria-haspopup="listbox"`. |
| **02** | `Sidebar` | Primary vertical navigation for desktop and tablet viewports | `expanded`, `collapsed`, `admin` | `active_route`, `feature_disabled`, `suspended` | `effectiveAccess: Record<FeatureKey, boolean>`, `currentPath: string`, `role: 'USER' \| 'ADMIN'` | `onNavigate(path)`, `onToggleCollapse()` | Visible at `>= 768px` (`md:flex`); marks active link with `aria-current="page"`; shows lock icon on features where `effectiveAccess[key] === false`. |
| **03** | `BottomNavigation` | Thumb-zone primary navigation bar for mobile viewports | `learner_5_tab` (`Today`, `Roadmap`, `Daily Plan`, `Progress`, `Mentor`) | `active_tab`, `today_ready_dot`, `disabled` | `currentPath: string`, `todayStatus: TodayStatus`, `effectiveAccess: Record<FeatureKey, boolean>` | `onTabSelect(path)` | Visible at `< 768px` (`md:hidden`); fixed bottom; minimum `44x44px` hit target per tab; `role="navigation"`, `aria-label="Primary Mobile Navigation"`. |
| **04** | `StepIndicator` | Multi-step progress tracker for Onboarding and Goal Clarification | `horizontal_labeled`, `compact_bar` | `completed`, `current`, `upcoming` | `currentStep: number`, `totalSteps: number`, `labels: string[]` | `onStepClick(stepIndex)` | Collapses step labels to active step title on `< 640px`; `role="progressbar"`, `aria-valuenow={currentStep}`, `aria-valuemin={1}`, `aria-valuemax={totalSteps}`. |

## 2.2 Form & Feedback Primitives (Components 05–12)

| # | Component | Purpose | Variants | States | Props & Data Contract (`API v1.5.1`) | Events | Responsive & A11y Rules |
|---|---|---|---|---|---|---|---|
| **05** | `Input` | Accessible text, email, password, Bangladesh `+880` phone, and 6-digit OTP input | `text`, `textarea`, `email`, `password`, `phone_bd`, `otp_6` | `default`, `focused`, `filled`, `error`, `disabled`, `readonly` | `name: string`, `label: string`, `value: string`, `error?: FieldErrorDTO`, `maxLength?: number`, `dir?: 'auto'` | `onChange(value)`, `onBlur()` | `phone_bd` auto-normalizes `01[3-9]xxxxxxxx` to `+8801[3-9]xxxxxxxx` (PRD §10); links `label` via `htmlFor`; sets `aria-invalid="true"` and `aria-describedby` when `error` is present. |
| **06** | `Select` | Single-value select and searchable combobox (IANA timezone, Career Level, skills) | `native_mobile`, `custom_dropdown`, `searchable_combobox` | `closed`, `open`, `loading`, `error`, `disabled` | `label: string`, `options: Array<{value: string, label: string, sublabel?: string}>`, `value: string`, `error?: FieldErrorDTO` | `onSelect(value)`, `onSearch(query)` | Full keyboard support (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`); `role="combobox"`, `aria-expanded`, `aria-activedescendant`. |
| **07** | `Checkbox` | Binary consent and large-expansion acknowledgement control | `standard`, `warning_callout` | `unchecked`, `checked`, `indeterminate`, `error`, `disabled` | `checked: boolean`, `label: string`, `description?: string`, `error?: string`, `required?: boolean` | `onChange(checked)` | Used for `privacy_consent` (`EP-A01`), `acknowledge_stale` (`EP-R05`), and `acknowledge_large_expansion` (`EP-R11`); minimum `44x44px` tap area. |
| **08** | `ToggleSwitch` | Immediate binary toggle for beginner `"None"` skills and Admin feature flags | `standard`, `beginner_none`, `admin_override` | `on`, `off`, `saving`, `disabled` | `checked: boolean`, `label: string`, `helperText?: string`, `disabled?: boolean` | `onToggle(checked)` | `role="switch"`, `aria-checked={checked}`; prevents simultaneous `existing_skills_none = true` and skill tags on Profile Setup (`PRD §14`). |
| **09** | `MultiStepFormWrapper` | Stateful form shell that preserves unsaved user input across slow/dropped networks | `onboarding_wizard`, `quiz_session` | `editing`, `autosaving`, `saved_local`, `submitting`, `network_error` | `storageKey: string`, `currentStep: number`, `canProceed: boolean`, `isSubmitting: boolean` | `onNext()`, `onBack()`, `onSubmit()`, `onRestoreDraft()` | Persists form/quiz state in `sessionStorage` (`PRD §54`); displays subtle "ড্রাফট সংরক্ষিত (Saved locally)" indicator; never loses entered text on `502/503/504` errors. |
| **10** | `Modal` | Accessible dialog for confirmations, learning hours, and destructive actions | `confirm`, `hours_prompt`, `destructive_delete`, `report_dialog` | `open`, `submitting`, `error`, `closed` | `isOpen: boolean`, `title: string`, `confirmLabel: string`, `requireLiteral?: 'DELETE'` | `onConfirm(payload?)`, `onClose()` | Focus trap (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`); `Escape` closes when not `submitting`; full-screen bottom sheet on `< 640px`. |
| **11** | `Toast` | Non-blocking notification banner with rate-limit/cooldown countdown timer | `info`, `success`, `warning`, `error_retryable` | `entering`, `visible`, `countdown`, `dismissed` | `message: string`, `error?: ErrorDTO`, `retryAfterSeconds?: number` | `onRetry()`, `onDismiss()` | `role="status"` (`aria-live="polite"`) or `role="alert"` for errors; renders live second-by-second countdown when `retryAfterSeconds` is returned (`423`, `429`). |
| **12** | `Tabs` | Section switcher for Roadmap views, Progress filters, and Admin panels | `underline`, `segmented_pill` | `active`, `inactive`, `disabled` | `tabs: Array<{id: string, label: string, count?: number}>`, `activeId: string` | `onTabChange(id)` | Horizontal scroll on mobile without clipping; `role="tablist"`, `role="tab"`, `aria-selected`, `role="tabpanel"`. |

## 2.3 Career Domain Components (Components 13–15)

| # | Component | Purpose | Variants | States | Props & Data Contract (`API v1.5.1`) | Events | Responsive & A11y Rules |
|---|---|---|---|---|---|---|---|
| **13** | `CareerCard` | Displays a dynamic career goal, AI clarification prompt, canonical role, and target level | `clarifying`, `awaiting_confirmation`, `confirmed`, `discontinued` | `default`, `answering`, `confirming`, `error` | `goal: CareerGoalResponseDTO`, `alternativeRoles?: RoleOptionDTO[]` | `onSubmitClarification(answer)`, `onConfirmGoal(roleId, level)`, `onEditGoal()`, `onDiscontinueGoal()` | Displays round `1/2` or `2/2` (`PRD §15`); includes `Junior / Mid / Senior` level selector (`PRD §18`); stacks actions vertically on mobile. |
| **14** | `SkillCard` | Displays a canonical skill, required depth, learning state, and cross-roadmap sharing | `profile_skill`, `roadmap_skill`, `weak_area`, `alias_clarification` | `self_reported`, `evidence_backed`, `unresolved_alias` | `skill: SkillProgressDTO \| ProfileSkillDTO`, `unresolved?: UnresolvedSkillDTO` | `onInspectSkill(skillId)`, `onResolveAlias(input, skillId)` | Shows "Shared across N roadmaps" badge when `shared_with_roadmap_ids.length > 1` (`PRD §17`); displays `required_depth` for current roadmap context. |
| **15** | `SkillBadge` | Compact semantic badge for priority and skill-gap classification | `priority` (`core \| supporting \| optional`), `gap_type` (`existing \| transferable \| refresh \| strengthen \| missing`) | `active`, `retired` | `priority: ItemPriority`, `gapType: SkillGapType`, `retired?: boolean` | `onClick()` | Always pairs a distinct SVG icon + text label (`Core / মূল`, `Supporting / সহায়ক`, `Optional / ঐচ্ছিক`) — never relies on color alone (`PRD §54`). |

## 2.4 Roadmap Domain Components (Components 16–18)

| # | Component | Purpose | Variants | States | Props & Data Contract (`API v1.5.1`) | Events | Responsive & A11y Rules |
|---|---|---|---|---|---|---|---|
| **16** | `RoadmapPhaseCard` | Collapsible learning phase container listing ordered topics, prerequisites, and effort | `draft`, `locked`, `level_outline` | `expanded`, `collapsed`, `stale_warning` | `phase: RoadmapPhaseDTO`, `isLocked: boolean`, `isFocus: boolean` | `onSelectTopic(topicId)`, `onOpenSources(itemId)` | Displays `estimated_effort_hours` with explicit helper label *"আনুমানিক সময় — গ্যারান্টি নয় (Guidance only)"* (`PRD §20`); hides `retired: true` items from active view. |
| **17** | `RoadmapDiffViewer` | Visual diff inspector for reviewing `Roadmap Merge` proposals and triggering Undo | `user_request`, `level_change`, `ai_proposal` | `proposed`, `large_expansion_warning`, `accepting`, `rejecting`, `undo_available` | `merge: MergeProposalDTO`, `currentVersionNo: number` | `onAccept(ackLargeExpansion)`, `onReject()`, `onUndoLastMerge()` | Color + icon + prefix (`+ Added`, `~ Updated`, `↑ Reprioritized`, `- Retired`); shows `daily_plan_impact` (`completed_days_unchanged` vs. `future_days_affected`, `PRD §21`). |
| **18** | `MilestoneCard` | Displays phase milestone completion checklist within a roadmap | `phase_milestone` | `pending`, `in_progress`, `completed` | `milestone: {id: string, title: string}`, `completedTopics: number`, `totalTopics: number` | `onClick()` | Accessible `<progress>` semantics; uses encouraging learning copy without employment guarantees (`PRD §36`). |

## 2.5 Learning & Assessment Domain Components (Components 19–22)

| # | Component | Purpose | Variants | States | Props & Data Contract (`API v1.5.1`) | Events | Responsive & A11y Rules |
|---|---|---|---|---|---|---|---|
| **19** | `DailyTaskCard` | Displays sequential learning unit (`Day 1..N`) in Today and Daily Plan views | `today_hero`, `plan_day_row` | `pending`, `in_progress`, `completed`, `preparing` | `day: PlanDayDTO`, `today?: TodayResponseDTO` | `onStartStudy(topicId)`, `onStartQuiz(planItemId)` | Uses sequential `Day N (দিন N)` labels rather than calendar dates so missed calendar days never skip content (`PRD §27`). |
| **20** | `LearningResourceCard` | Attribution link card for official documentation, release notes, and articles | `official_docs`, `release_notes`, `article`, `standard`, `video` | `default`, `visited` | `resource: LearningResourceDTO` | `onOpenExternal(url)` | Displays `publisher`, `resource_type`, and `retrieved_at`; external link opens with `target="_blank" rel="noopener noreferrer"` and screen-reader external-link announcement. |
| **21** | `QuizCard` | Interactive question renderer for MCQs and short free-response prompts | `mcq`, `free_response` (`sql \| code \| config \| test_case \| debug \| command \| design \| text`) | `unanswered`, `answered`, `i_dont_know`, `autosaving`, `graded_review` | `question: QuizQuestionDTO`, `answer?: QuizAnswerDTO`, `result?: QuizResultQuestionDTO`, `questionNumber: number` | `onSelectOption(optionId)`, `onChangeText(text)`, `onToggleIDontKnow(bool)`, `onReportQuestion()` | Supports Bangla/English/Mixed input; monospace code/SQL textarea with line numbers (no execution sandbox per `PRD §29`); explicit `"জানি না (I don't know)"` option (`PRD §29`). |
| **22** | `PracticeReviewCard` | Displays formative `AI Practice Review` rubric evaluation on free-response answers | `rubric_feedback` | `pending`, `reviewed`, `failed_retryable`, `not_evidence` | `feedback: PracticeFeedbackDTO` | `onRetryReview(reviewId)`, `onReportScoring(reviewId)` | Labels review as *"AI Practice Review (অনুশীলন পর্যালোচনা)"* — never a formal assessment (`PRD §31`); shows `Good / Needs Work`, 3 dimensions (`correctness`, `understanding`, `reasoning`), strengths/mistakes, or non-evidence notice for junk answers. |

## 2.6 Progress Domain Components (Components 23–24 — PRD §34–§36 Compliant)

| # | Component | Purpose | Variants | States | Props & Data Contract (`API v1.5.1`) | Events | Responsive & A11y Rules |
|---|---|---|---|---|---|---|---|
| **23** | `SkillProgressBadge` *(replaces `ProgressReadinessIndicator`)* | Displays the 4 valid MVP learning states per skill and Career Level | `not_started`, `learning`, `practicing`, `proficient` | `default`, `updated_with_reason` | `learningState: LearningState`, `careerLevel: CareerLevel`, `stateReason: string \| null` | `onInspectReason()` | **Strictly displays `Not Started`, `Learning`, `Practicing`, or `Proficient` alongside `Junior / Mid / Senior` — never displays `"Job Ready"` or percentage pass/fail thresholds (`PRD §34–§36`).** |
| **24** | `ProgressHistoryCard` *(replaces `AchievementCard`)* | Displays explainable learning state transitions and evidence events | `state_change`, `evidence_added` | `default` | `item: ProgressHistoryItemDTO` | `onOpenSourceAttempt(sourceId)` | Shows `from_state → to_state`, `career_level`, `occurred_at`, and the AI's `reason` for the change (`PRD §35`, `EP-G03`); contains no gamified trophies or badges. |

## 2.7 AI Domain Components (Components 25–29)

| # | Component | Purpose | Variants | States | Props & Data Contract (`API v1.5.1`) | Events | Responsive & A11y Rules |
|---|---|---|---|---|---|---|---|
| **25** | `AIExplanationCard` | Renders structured topic explanations, Q&A, and Daily Technology Updates | `topic_explanation`, `technology_update` | `ready`, `preparing`, `no_important_changes`, `temporarily_unavailable` | `topic?: TopicDetailDTO`, `update?: TechnologyUpdateDTO`, `updateState?: UpdateState` | `onRate(score, comment)`, `onReport(reason, comment)`, `onMarkViewed(updateId)` | Renders mixed Bangla-English Markdown and code blocks; for Tech Updates, displays `publisher`, `fetched_at`, `release_status` (`released/announced/planned/experimental`), `relevance`, and `action_timing` (`act_now/learn_later/awareness_only`) (`PRD §41–§43`). |
| **26** | `AIRecommendationCard` | Displays AI roadmap rationale, next steps, and optional merge suggestions | `roadmap_summary`, `optional_merge_banner` | `default`, `dismissed` | `summary: RoadmapSummaryBlockDTO`, `pendingMerge?: MergeProposalSummaryDTO` | `onReviewMerge(mergeId)`, `onAskMentor(context)` | Explains *why* AI recommended a path (`PRD §26`) and clearly marks AI merge proposals as optional suggestions requiring user acceptance (`PRD §21`). |
| **27** | `AIChatMessage` | Renders user and AI Mentor messages with safety and claim-context indicators | `user`, `assistant`, `safety_redirection` | `sending`, `sent`, `failed_retryable` | `message: MessageDTO`, `safetyMode?: boolean`, `learningClaimRecorded?: boolean`, `clientMessageId?: string` | `onRetrySend(clientMessageId)` | Preserves Bangla/English/Mixed formatting; when `learningClaimRecorded === true` (e.g., *"I studied this"*), shows subtle info note that claims are saved as chat context only (`PRD §37`); when `safetyMode === true`, renders supportive redirection card (`PRD §37`). |
| **28** | `AILoadingState` | Non-blocking `Preparing` state card with automatic background job polling | `inline_banner`, `full_section_skeleton` | `queued`, `preparing`, `succeeded`, `failed_retryable` | `job: JobAcceptedDTO \| JobStatusDTO`, `title: string` | `onJobSucceeded(resultRef)`, `onRetryJob()` | Polls `GET /api/v1/jobs/{id}` (`EP-J01`) every `retry_after_seconds` without blocking navigation (`PRD §48`, ` preload` aria-busy="true"). |
| **29** | `AIFeedbackComponent` | Independent rating/report actions | `rating_1_5`, `report_button`, both | `idle`, `modal_open`, `submitting`, `submitted`, `already_reported` | `ratingTarget?: {type:RatingTarget,id:UUID}`, `reportTarget?: {type:ReportTarget,id:UUID}`, `currentScore?:number` | `onSubmitRating(score,comment)`, `onSubmitReport(reason,comment)` | Render each capability separately; topic supports both, roadmap uses explicit mapping, quiz/review report only, tech rating only, mentor neither. |

------------------------------------------------------------------------

# 3. Screen Implementation Contracts (All 25 Production Screens)

Screen contracts combine local rules with inherited component (§2), HTTP/auth (§6), telemetry (§7) and service-cache (§4) rules. The required attributes are: **Purpose, User Goal, Components, Data Requirements, API Dependencies, User Actions, Loading State, Empty State, Error State, Permission State, Responsive Behavior, Accessibility Behavior, Analytics Events, Security Rules, and Navigation Rules**.

## 3.1 Public Experience Screens (Screens 01–04)

### Screen 01: Landing Page (`/`)
- **Purpose:** Introduce the Bangla-first Personal AI Career Mentor for technology careers in Bangladesh.
- **User Goal:** Understand the platform's technology career scope and start registration or login.
- **Components:** `Header(public)`, Hero Banner, Technology Role Grid (`Frontend`, `Backend`, `Full-Stack`, `QA/SDET`, `DevOps`, `Cloud`, `Cybersecurity`, `Mobile`, `Data`, `AI/ML`), How-It-Works Steps, Footer.
- **Data Requirements & API Dependencies:** Optional session check via `GET /api/v1/auth/me` (`EP-A13`) to offer a "Go to Dashboard" button if already authenticated.
- **User Actions:** Click `"শুরু করুন (Register)"` or `"লগইন (Login)"`.
- **Loading / Empty / Error States:** Static SSR/SSG render (instant load); no empty/error state blocking entry.
- **Permission State:** `AZ-PUB` (Public).
- **Responsive & Accessibility Behavior:** Single-column stack on mobile (`< 768px`), 12-column grid on desktop (`>= 1024px`); semantic `<main>`, `<h1>`–`<h3>` hierarchy, WCAG 2.1 AA contrast.
- **Analytics Events:** `page_viewed (screen: 'landing')`.
- **Security & Product Rules:** Contains zero guaranteed-employment claims (`PRD §26`).
- **Navigation Rules:** `"Register"` → `/register`; `"Login"` → `/login`; authenticated CTA → `/dashboard`.

### Screen 02: Login (`/login`)
- **Purpose:** Authenticate returning users via Email/Password, Bangladesh Phone (`+880`)/Password, Google, or Facebook (`PRD §8`).
- **User Goal:** Sign in to access roadmaps, daily learning, or account settings.
- **Components:** `Header(public)`, `Input(identifier)`, `Input(password)`, OAuth Buttons (`Google`, `Facebook`), `Toast`.
- **Data Requirements & API Dependencies:** `POST /api/v1/auth/login` (`EP-A05`: `LoginRequestDTO` → `AuthSessionDTO`), `POST /api/v1/auth/oauth/session` (`EP-A10`: `OAuthSessionRequestDTO` → `OAuthSessionResponseDTO`).
- **User Actions:** Enter email or `+880` phone + password and submit; click Google/Facebook OAuth; click `"পাসওয়ার্ড ভুলে গেছেন? (Forgot Password)"`.
- **Loading State:** Disables submit button with inline spinner during `EP-A05` / `EP-A10`.
- **Empty State:** Empty form with Bangla/English placeholders (`example@email.com` or `017XXXXXXXX`).
- **Error State:** `INVALID_CREDENTIALS (401)` generic error banner (anti-enumeration); `ACCOUNT_LOCKED (423)` renders `Toast` with live `retryAfterSeconds` countdown; `UNVERIFIED_ACCOUNT (403)` redirects to `/verify` with contact pre-filled.
- **Permission State:** `AZ-PUB`. Note: Suspended users (`user.status === 'suspended'`) **are permitted to log in** so they can reach Account Deletion (`PRD §7, §13`).
- **Responsive & Accessibility Behavior:** Centered card (`max-w-md w-full px-4`); password visibility toggle with `aria-label`; error summary focused on failure.
- **Analytics Events:** `auth_started`, `auth_completed`, `auth_failed`.
- **Security Rules:** Never logs passwords or tokens in telemetry or `localStorage` error logs; normalizes Bangladesh phone numbers to `+880`.
- **Navigation Rules:** On `200`: if `user.status === 'suspended'` → `/settings`; else if `verified_contact_required === true` → `/settings?prompt=verify_contact`; else if `next_step === 'profile_setup'` → `/onboarding/profile`; else → `/dashboard`.

### Screen 03: Registration (`/register`)
- **Purpose:** Open self-registration via Email or Bangladesh Phone (`+880`) + Password or OAuth (`PRD §7–§8`).
- **User Goal:** Create a personal account without invitation codes or admin approval (`PRD §7`).
- **Components:** `Header(public)`, `Tabs(Email Signup | Phone Signup)`, `Input(email | phone_bd)`, `Input(password)`, `Input(confirm_password)`, `Checkbox(privacy_consent)`, OAuth Buttons, `Toast`.
- **Data Requirements & API Dependencies:** `POST /api/v1/auth/register` (`EP-A01`: `RegisterRequestDTO` → `RegistrationPendingDTO`), `POST /api/v1/auth/oauth/session` (`EP-A10`).
- **User Actions:** Toggle Email vs. Phone; enter credentials; check privacy consent; submit registration.
- **Loading State:** Button spinner (`"অ্যাকাউন্ট তৈরি হচ্ছে..."`).
- **Empty State:** Clean registration form defaulting to Email tab.
- **Error State:**
  - **Password Mismatch (`PRD §8`):** If `password !== confirm_password`, client blocks submission immediately, shows field-level error on `confirm_password` (`PASSWORD_MISMATCH`), and **preserves all valid entered values**.
  - Server errors: `CONTACT_ALREADY_REGISTERED (409)`, `INVALID_PHONE_NUMBER (422)`, `PASSWORD_POLICY_FAILED (422)`, `OTP_LIMIT_EXCEEDED (429)`, `SMS_PROVIDER_ERROR (502)`, `EMAIL_PROVIDER_ERROR (502)`.
- **Permission State:** `AZ-PUB`.
- **Responsive & Accessibility Behavior:** Mobile-friendly single column; `autocomplete="new-password"`; inline `aria-describedby` for password rules.
- **Analytics Events:** `auth_started`, `auth_failed`.
- **Security Rules:** Enforces `+8801[3-9][0-9]{8}` format before dispatch (`PRD §10`).
- **Navigation Rules:** On `201 RegistrationPendingDTO` → `/verify?channel={verification_channel} (restore actual normalized_identifier from the short-lived verification draft)`.

### Screen 04: Verification (`/verify`)
- **Purpose:** Verify Email code or Bangladesh SMS OTP to establish an authenticated session (`PRD §9–§10`).
- **User Goal:** Enter the 6-digit verification code or request a resend after cooldown.
- **Components:** `Header(public)`, `Input(otp_6)`, Resend Cooldown Button, `Toast`.
- **Data Requirements & API Dependencies:** `POST /api/v1/auth/verify-email` (`EP-A02`), `POST /api/v1/auth/verify-phone` (`EP-A03`), `POST /api/v1/auth/resend-verification` (`EP-A04`).
- **User Actions:** Enter 6-digit code; click `"কোড পুনরায় পাঠান (Resend Code)"` when cooldown expires.
- **Loading State:** Verifying spinner; countdown timer until `resend_available_at`.
- **Empty State:** 6-digit numeric input (`inputMode="numeric"`, `autocomplete="one-time-code"`).
- **Error State:** `VERIFICATION_CODE_INVALID (422)`, `VERIFICATION_CODE_EXPIRED (410)`, `VERIFICATION_ATTEMPTS_EXCEEDED (429)`, `RESEND_COOLDOWN_ACTIVE (429)` (updates countdown from `retryAfterSeconds`), `ALREADY_VERIFIED (409)`.
- **Permission State:** `AZ-PUB` (or `AZ-USER` when verifying a secondary contact added via `EP-A12`).
- **Responsive & Accessibility Behavior:** Large `48x56px` digit boxes on mobile; announces remaining resend seconds via `aria-live="polite"`.
- **Analytics Events:** `auth_completed`, `auth_failed`.
- **Security Rules:** Rate-limited per contact and per IP (`PRD §10`).
- **Navigation Rules:** On `200 AuthSessionDTO` → `/onboarding/profile` (new user) or `/settings` (if verifying added contact).

## 3.2 Authentication Recovery Screens (Screens 05–06)

### Screen 05: Password Recovery (`/forgot-password`)
- **Purpose & User Goal:** Request a password reset verification code sent to verified Email or Bangladesh Phone (`PRD §8`).
- **Components:** `Header(public)`, `Input(identifier)`, Submit Button, `Toast`.
- **Data & API Dependencies:** `POST /api/v1/auth/forgot-password` (`EP-A08`: `ForgotPasswordRequestDTO`).
- **User Actions:** Enter registered email or `+880` phone and submit.
- **Loading / Empty / Error States:** Loading spinner; anti-enumeration `202` success banner (`"If the account exists, a code was sent."`); handles `RESEND_COOLDOWN_ACTIVE (429)` and `OTP_LIMIT_EXCEEDED (429)`.
- **Permission / Responsive / A11y / Security:** `AZ-PUB`; centered mobile card; identical response for known/unknown identifiers to prevent account enumeration.
- **Analytics Events:** `auth_started`.
- **Navigation Rules:** On `202` → `/reset-password (restore short-lived recovery draft; no identifier in URL)`.

### Screen 06: Password Reset (`/reset-password`)
- **Purpose & User Goal:** Submit the 6-digit reset code and set a new password (`PRD §8`).
- **Components:** `Header(public)`, `Input(otp_6)`, `Input(new_password)`, `Input(confirm_new_password)`, `Toast`.
- **Data & API Dependencies:** `POST /api/v1/auth/reset-password` (`EP-A09`: `ResetPasswordRequestDTO`).
- **User Actions:** Enter code, new password, confirm new password, and submit.
- **Loading / Empty / Error States:** Client-side mismatch check (`new_password === confirm_new_password`); handles `VERIFICATION_CODE_INVALID (422)`, `VERIFICATION_CODE_EXPIRED (410)`, `VERIFICATION_ATTEMPTS_EXCEEDED (429)`, `PASSWORD_POLICY_FAILED (422)`.
- **Permission / Responsive / A11y / Security:** `AZ-PUB`; revokes all prior sessions upon success (`PRD §8`).
- **Analytics Events:** `auth_completed`, `auth_failed`.
- **Navigation Rules:** On `200` → `/login?reset=success`.

## 3.3 Onboarding Screens (Screens 07–12)

### Screen 07: Profile Setup (`/onboarding/profile`)
- **Purpose:** Collect current profession/role, education, experience level, timezone, and preferred daily learning hours (`PRD §14`).
- **User Goal:** Provide background context required before AI Roadmap generation.
- **Components:** `Header(authenticated)`, `StepIndicator(Step 1 of 5)`, `MultiStepFormWrapper`, `Input(current_role)`, `Input(education)`, `Select(experience_level: beginner|junior|mid|senior)`, `Select(timezone: IANA)`, `Input(preferred_daily_hours: 0.5..12.0)`.
- **Data & API Dependencies:** `GET /api/v1/profile` (`EP-P01`), `PATCH /api/v1/profile` (`EP-P02`), `PATCH /api/v1/profile/learning-settings` (`EP-P04`).
- **User Actions:** Edit auto-detected IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, default `Asia/Dhaka`); enter role, experience, and daily hours (`0.5` step increments); click `"পরবর্তী (Next)"` or `"ড্যাশবোর্ডে যান (Skip to Dashboard)"`.
- **Loading / Empty / Error States:** Skeleton form while `EP-P01` loads; preserves draft in `sessionStorage`; handles `INVALID_TIMEZONE (422)` and `VALIDATION_FAILED (422)`.
- **Permission State:** `AZ-USER` (`Gate: none`). Per `PRD §7`, profile completion is **not** required to access `/dashboard`, only before `EP-R01` roadmap generation.
- **Responsive & Accessibility Behavior:** Single-column step card on mobile; clear Bangla labels with English technical hints.
- **Analytics Events:** `onboarding_started`.
- **Security Rules:** Profile text is treated as untrusted user input (`PRD §44`); written via NestJS `service_role` (`ADR-019`).
- **Navigation Rules:** `"Next"` → `/onboarding/skills`; `"Skip"` → `/dashboard`.

### Screen 08: Skills Input (`/onboarding/skills`)
- **Purpose:** Collect existing technology skills (or explicit **"None"** for complete beginners) and resolve uncertain skill aliases (`PRD §14, §17`).
- **User Goal:** Declare current skills without being blocked if starting from zero.
- **Components:** `StepIndicator(Step 2 of 5)`, `MultiStepFormWrapper`, `ToggleSwitch(existing_skills_none)`, `Select(searchable skill tag input)`, `SkillCard(profile_skill & alias_clarification)`, `Modal(Alias Clarification)`.
- **Data & API Dependencies:** `GET /api/v1/profile` (`EP-P01`), `PATCH /api/v1/profile` (`EP-P02` → returns `existing_skills[]` and `unresolved_skills[]`), `POST /api/v1/profile/skill-alias-interpretations` (`EP-P05`: `SkillAliasInterpretationDTO`).
- **User Actions:**
  - Toggle `"আমার এখনো কোনো টেক স্কিল নেই (None — Complete Beginner)"` (`existing_skills_none: true`, which clears skill tags and creates no artificial skills per `PRD §14`), **OR**
  - Add up to 100 skill tags (`React.js`, `SQL`, etc.) and submit `EP-P02`.
  - If `unresolved_skills[]` is non-empty, select the matching canonical skill in the clarification modal (`EP-P05`), which atomically stores the user-scoped mapping in `public.user_skill_aliases`, appends the `skill_id` to `user_profiles.self_reported_skill_ids`, and defers level-scoped progress until a confirmed Career Level exists (`ADR-019`).
- **Loading / Empty / Error States:** Tag chip skeleton; prevents submitting `existing_skills_none: true` together with skill tags (`VALIDATION_FAILED 422`); handles `SKILL_NOT_FOUND (404)`.
- **Permission State:** `AZ-USER` (`Gate: none`).
- **Responsive & Accessibility Behavior:** Keyboard-removable skill chips (`Backspace` / `Delete` with `aria-label="Remove skill"`).
- **Analytics Events:** `onboarding_started`.
- **Security Rules:** User alias answers remain scoped to `user_skill_aliases` and never redefine global shared truth (`PRD §17`).
- **Navigation Rules:** `"Next"` → `/onboarding/preferences`; `"Back"` → `/onboarding/profile`.

### Screen 09: Learning Preferences (`/onboarding/preferences`)
- **Purpose & User Goal:** Select preferred learning style (`reading`, `hands_on`, `visual`, `mixed`) (`PRD §14`).
- **Components:** `StepIndicator(Step 3 of 5)`, `MultiStepFormWrapper`, 4 selectable radio cards (`reading`, `hands_on`, `visual`, `mixed`).
- **Data & API Dependencies:** `PATCH /api/v1/profile/preferences` (`EP-P03`: `ProfilePreferencesDTO` → `ProfileResponseDTO`).
- **User Actions:** Choose preference card and click `"সংরক্ষণ ও পরবর্তী (Save & Next)"`.
- **Loading / Empty / Error States:** Highlights current selection from `EP-P01`; handles `VALIDATION_FAILED (422)`.
- **Permission / Responsive / A11y:** `AZ-USER`; 1-column on mobile, 2x2 grid on desktop; `role="radiogroup"`.
- **Analytics Events:** `profile_completed`.
- **Navigation Rules:** `"Next"` → `/onboarding/goal`; `"Back"` → `/onboarding/skills`.

### Screen 10: Career Goal Analysis (`/onboarding/goal`)
- **Purpose:** Capture a dynamic technology career goal in Bangla, English, or Mixed language (`PRD §3, §15`).
- **User Goal:** State the target technology role (up to 3 active goals/roadmaps).
- **Components:** `StepIndicator(Step 4 of 5)`, `MultiStepFormWrapper`, `Input(goal_text, 3..300 chars)`, Example Technology Role Chips, `Toast`.
- **Data & API Dependencies:** `POST /api/v1/career/goals` (`EP-C01`: `CareerGoalCreateDTO` → `CareerGoalResponseDTO`), `PATCH /api/v1/career/goals/{id}` (`EP-C06`).
- **User Actions:** Enter goal text (e.g., `"Backend developer, mainly Node.js"` or `"আমি AI Engineer হতে চাই"`) and submit.
- **Loading State:** Synchronous AI analysis state (`< 10 s` target) with progress message.
- **Empty State:** Textarea with examples inside the technology boundary (`PRD §3`).
- **Error State:** `OUT_OF_SCOPE_GOAL (422)` (explains that only technology roles are supported in MVP per `PRD §3`); `ROADMAP_LIMIT_REACHED (409)` (prompts user to archive one of their 3 active roadmaps first); `AI_TIMEOUT (504, retryable)` (preserves input text and offers retry); `FEATURE_DISABLED (403)`.
- **Permission State:** `AZ-USER`, **Gate: write (`roadmap_generator`)**.
- **Responsive & Accessibility Behavior:** Auto-expanding textarea; character counter (`3–300`).
- **Analytics Events:** `career_goal_submitted`, `ai_request_started`, `ai_response_completed`.
- **Security Rules:** `goal_text` wrapped as untrusted user data (`PRD §44`).
- **Navigation Rules:** On `201` → `/onboarding/clarify?goalId={id}`.

### Screen 11: AI Interpretation & Career Level Confirmation (`/onboarding/clarify`)
- **Purpose:** Resolve ambiguous career goals through up to 2 AI clarification rounds and confirm the canonical role and target Career Level (`Junior`, `Mid`, `Senior`) (`PRD §15, §18`).
- **User Goal:** Confirm the exact technology role and intended seniority before generating a Draft Roadmap.
- **Components:** `StepIndicator(Step 5 of 5)`, `CareerCard`, `Input(clarification answer)`, `Select(target_level: junior|mid|senior)`, `Toast`.
- **Data & API Dependencies:** `GET /api/v1/career/goals/{id}` (`EP-C03`), `POST /api/v1/career/goals/{id}/clarifications` (`EP-C04`), `POST /api/v1/career/goals/{id}/confirm` (`EP-C05`), `POST /api/v1/roadmaps/generate` (`EP-R01` with `H-IDEM`).
- **User Actions:**
  - If `status === 'clarifying'` (rounds `1` or `2`), submit answer (`EP-C04`).
  - When `status === 'awaiting_confirmation'`, review `proposed_role` (or select from `alternative_roles`), review AI's `suggested_level`, explicitly confirm `target_level` (`junior`, `mid`, or `senior` via `EP-C05`), and click `"রোডম্যাপ তৈরি করুন (Generate Roadmap Draft)"` (`EP-R01`).
- **Loading / Empty / Error States:** Handles `CLARIFICATION_LIMIT_REACHED (409)`, `ROLE_MISMATCH (422)`, `PROFILE_INCOMPLETE (422)` (links directly to missing profile fields), `ROADMAP_LIMIT_REACHED (409)`.
- **Permission State:** `AZ-USER`, **Gate: write (`roadmap_generator`)**.
- **Analytics Events:** `ai_request_started`, `ai_response_completed`.
- **Navigation Rules:** On `202 JobAcceptedDTO` remain at `/onboarding/clarify?goalId={id}&jobId={job_id}`; poll EP-J01 and navigate only after succeeded with valid roadmap result_ref.id.

### Screen 12: Roadmap Confirmation — Draft Review, Revision & Lock (`/roadmaps/[id]/draft`)
- **Purpose:** Review the AI-generated Draft Roadmap, request conversational AI revisions, and Lock the roadmap (`PRD §19–§21`).
- **User Goal:** Inspect phases (`Core`, `Supporting`, `Optional`), verify skill gaps, optionally ask AI to adjust the draft, and lock it to build a Daily Plan.
- **Components:** `AILoadingState(full_section_skeleton)`, `AIRecommendationCard(roadmap_summary)`, `RoadmapPhaseCard(draft)`, `SkillBadge`, `Input(revision instruction)`, `Checkbox(acknowledge_stale)`, `Modal(Confirm Lock & Daily Hours)`, `AIFeedbackComponent(rating_1_5)`.
- **Data & API Dependencies:** `GET /api/v1/jobs/{id}` (`EP-J01`), `GET /api/v1/roadmaps/{id}?version=draft` (`EP-R03`), `POST /api/v1/roadmaps/{id}/revision` (`EP-R04`, `H-IDEM`), `POST /api/v1/roadmaps/{id}/lock` (`EP-R05`, `H-IDEM`), `POST /api/v1/learning/daily-plans` (`EP-L02`, `H-IDEM`), `POST /api/v1/ratings` (`EP-F01`).
- **User Actions:**
  - Poll `EP-J01` until `succeeded`, then load draft (`EP-R03`).
  - Enter revision instruction (`3–1000` chars) and submit `EP-R04` (or `refresh_stale: true` if draft is stale) → polls new job and loads new immutable draft version.
  - Rate draft quality 1–5 stars (`EP-F01`, `target_type: 'roadmap_draft'`).
  - Click `"রোডম্যাপ লক করুন (Lock Roadmap)"` (`EP-R05`) → opens modal pre-filled with `preferred_daily_hours` (`PRD §14, §27`) → confirms hours and calls `POST /api/v1/learning/daily-plans` (`EP-L02`).
- **Loading / Empty / Error States:** Non-blocking `Preparing` state during `EP-J01`; stale-draft warning banner when `stale === true` (`DRAFT_STALE 409`); soft-size guardrail banner when `warnings[]` is non-empty (`PRD §20`).
- **Permission State:** `AZ-USER`, **Gate: write (`roadmap_generator`)** for `EP-R04`/`EP-R05`; existing draft remains readable even if feature is later disabled (`PRD §7`).
- **Security & Product Rules:** Users cannot manually drag, add, or delete roadmap topics directly (`PRD §21`).
- **Analytics Events:** `roadmap_viewed`, `roadmap_updated`, `ai_feedback_submitted`.
- **Navigation Rules:** After `EP-R05` Lock + `EP-L02` Daily Plan creation → `/today`.

## 3.4 Main Application Screens (Screens 13–22)

### Screen 13: Dashboard (`/dashboard`)
- **Purpose:** Unified learner home displaying Focus Roadmap status, Today's learning unit preview, active roadmaps (`<= 3`), and skill progress summary.
- **User Goal:** Resume daily learning in one tap or switch Focus Roadmap.
- **Components:** `Header`, `Sidebar`, `BottomNavigation`, `DailyTaskCard(today_hero)`, `RoadmapPhaseCard(summary)`, `SkillProgressBadge`, `AIExplanationCard(technology_update preview)`.
- **Data & API Dependencies:** `GET /api/v1/auth/me` (`EP-A13`), `GET /api/v1/learning/today` (`EP-L04`), `GET /api/v1/roadmaps` (`EP-R02`), `GET /api/v1/progress` (`EP-G01`).
- **User Actions:** Click `"আজকের পাঠ শুরু করুন (Continue Today)"` → `/today`; switch Focus Roadmap (`EP-R14`); click `"Complete Profile"` if `profile_complete === false`.
- **Loading / Empty / Error States:**
  - If `profile_complete === false`: shows welcoming banner to complete profile before generating a roadmap (`PRD §7`).
  - If `today.status === 'no_focus_roadmap'`: prompts user to lock or select a Focus Roadmap.
  - If `today.status === 'no_daily_plan'`: opens hours confirmation modal (`EP-L02`).
  - If `today.status === 'preparing'`: renders `AILoadingState` polling `EP-J01`.
- **Permission State:** `AZ-USER` (`Gate: none`).
- **Analytics Events:** `roadmap_viewed`, `learning_started`.
- **Navigation Rules:** Links to `/today`, `/roadmaps/{id}`, `/daily-plan`, `/progress`, `/mentor`.

### Screen 14: Career Profile (`/career-profile`)
- **Purpose & User Goal:** View and update professional background, existing skills, user-scoped alias mappings, and active/discontinued career goals (`PRD §14–§17`).
- **Components:** `Header`, `Sidebar`, `BottomNavigation`, `CareerCard`, `SkillCard`, `Modal(Discontinue Career Goal)`.
- **Data & API Dependencies:** `GET /api/v1/profile` (`EP-P01`), `PATCH /api/v1/profile` (`EP-P02`), `POST /api/v1/profile/skill-alias-interpretations` (`EP-P05`), `GET /api/v1/career/goals` (`EP-C02`), `DELETE /api/v1/career/goals/{id}` (`EP-C07`).
- **User Actions:** Edit role/education/skills; add a new career goal (if active roadmaps `< 3`); discontinue a goal (`EP-C07`, which archives its roadmap and auto-switches Focus if needed per `PRD §22`).
- **States & Rules:** Updating profile skills never silently alters a locked roadmap (`PRD §14, §21`); discontinuing a goal preserves all historical progress and shared skill evidence (`PRD §22`).
- **Analytics Events:** `profile_completed`.

### Screen 15: Roadmap View, Merge Diff & Undo (`/roadmaps/[id]`)
- **Purpose:** View a Locked or Archived Roadmap, switch Focus status, request post-lock changes or Career Level transitions (`Junior/Mid/Senior`), inspect/accept/reject `Roadmap Merge` proposals, or execute **Undo Last Merge** (`PRD §16, §18, §20–§22`).
- **User Goal:** Track roadmap structure and safely evolve a locked roadmap without losing history.
- **Components:** `Tabs(Active Roadmap | Level Outline | Merge Proposals | Version History)`, `RoadmapPhaseCard(locked)`, `RoadmapDiffViewer`, `MilestoneCard`, `Checkbox(acknowledge_large_expansion)`, `Modal(Request Change / Change Career Level)`, `AIFeedbackComponent(rating_1_5)`, `AILoadingState`.
- **Data & API Dependencies:** `GET /api/v1/roadmaps/{id}` (`EP-R03`), `GET /api/v1/roadmaps/{id}/versions` (`EP-R06`), `GET /api/v1/roadmaps/{id}/versions/{version_no}` (`EP-R07`), `POST /api/v1/roadmaps/{id}/merges` (`EP-R08`, `H-IDEM`), `GET /api/v1/roadmaps/{id}/merges` (`EP-R09`), `GET /api/v1/roadmaps/{id}/merges/{merge_id}` (`EP-R10`), `POST .../accept` (`EP-R11`, `H-IDEM`), `POST .../reject` (`EP-R12`), `POST .../merges/undo` (`EP-R13`, `H-IDEM`), `POST .../focus` (`EP-R14`), `POST .../archive` (`EP-R15`), `POST /api/v1/ratings` (`EP-F01`).
- **User Actions:**
  - **Set as Focus Roadmap (`EP-R14`):** Preserves prior Focus roadmap's Daily Plan; if this roadmap has `daily_plan.state === 'missing'`, opens hours modal and calls `EP-L02` (`PRD §16`).
  - **Request Change / Career Level Move (`EP-R08`):** Submit `origin: 'user_request'` or `origin: 'level_change'` (`target_level: 'junior'|'mid'|'senior'`) → polls `EP-J01` → opens `RoadmapDiffViewer` (`EP-R10`).
  - **Accept / Reject Merge (`EP-R11` / `EP-R12`):** If `size_impact.materially_large === true`, requires checking `acknowledge_large_expansion` (`MERGE_EXPANSION_ACK_REQUIRED 409`). Accepting creates a new immutable version and reconciles only future incomplete Daily Plan days (`PRD §21`).
  - **Undo Last Merge (`EP-R13`):** Active only when `undo_available === true` (before starting a quiz on any post-merge plan item, enforced by `trg_quiz_attempts_close_undo`). Restores previous locked version and previous future Daily Plan state (`PRD §21`).
- **Permission State:** `AZ-USER`. Existing locked roadmap and version history remain viewable even when `roadmap_generator` is globally or per-user disabled (`PRD §7`).
- **Analytics Events:** `roadmap_viewed`, `roadmap_updated`, `roadmap_change_accepted`, `ai_feedback_submitted`.

### Screen 16: Daily Tasks / Daily Plan (`/daily-plan`)
- **Purpose & User Goal:** Inspect the sequential learning-day plan (`Day 1..N`) for a locked roadmap and rebuild future incomplete days when daily study hours change (`PRD §27`).
- **Components:** `DailyTaskCard(plan_day_row)`, `Modal(Confirm / Rebuild Learning Hours)`, Pagination controls.
- **Data & API Dependencies:** `GET /api/v1/learning/daily-plan` (`EP-L01`), `POST /api/v1/learning/daily-plans` (`EP-L02`, `H-IDEM`), `POST /api/v1/learning/daily-plans/{id}/rebuild` (`EP-L03`).
- **User Actions:** Browse sequential completed and pending days; click `"দৈনিক সময় পরিবর্তন করুন (Rebuild Plan)"` (`EP-L03`, `hours_per_day: 0.5..12.0`).
- **States & Rules:** Missed calendar days never skip content or rewrite completed history (`PRD §27`). Rebuilding re-sequences only future incomplete days without modifying the locked roadmap (`PRD §27`).
- **Permission State:** `AZ-USER` (`Gate: none` for `EP-L01`; `Gate: write (daily_plan)` for `EP-L02`/`EP-L03`).

### Screen 17: Learning Hub — Today Experience (`/today`)
- **Purpose:** Deliver the active learning unit from the Focus Roadmap's next incomplete Daily Plan day (`PRD §28`).
- **User Goal:** Study today's topic explanation, review commonly asked/important questions and verified sources, and launch the Daily Practice Quiz.
- **Components:** `DailyTaskCard(today_hero)`, `AIExplanationCard(topic_explanation)`, `LearningResourceCard`, `AIFeedbackComponent(rating_1_5 & report_button)`, `AILoadingState`, Primary CTA `"দৈনিক কুইজ শুরু করুন (Start Practice Quiz)"`.
- **Data & API Dependencies:** `GET /api/v1/learning/today` (`EP-L04`), `GET /api/v1/learning/topics` (`EP-L05`), `GET /api/v1/learning/topics/{id}` (`EP-L06`), `GET /api/v1/learning/resources` (`EP-L07`), `POST /api/v1/quiz/generate` (`EP-Q01`, `H-IDEM`), `POST /api/v1/ratings` (`EP-F01`), `POST /api/v1/reports` (`EP-F02`).
- **User Actions:** Read mixed Bangla-English topic explanation and Q&A; open external source links; rate topic content 1–5 (`EP-F01`, `target_type: 'topic_content'`) or report content (`EP-F02`); click `"Start Practice Quiz"` (`EP-Q01`).
- **Loading / Empty / Error States:** Handles all 5 `today_status` values: `ready`, `preparing` (polls `EP-J01`), `no_focus_roadmap`, `no_daily_plan` (prompts for `hours_per_day` via `EP-L02`), and `plan_completed`.
- **Security & Product Rules:** There is **no** "Mark Complete" button; only submitting the required practice quiz unlocks the next plan day (`PRD §33`).
- **Analytics Events:** `learning_started`, `ai_feedback_submitted`.
- **Navigation Rules:** `"Start Practice Quiz"` → `/quiz/{attempt_id}` (or polls `EP-J01` if `202` returned).

### Screen 18: Quiz Practice & AI Practice Review (`/quiz/[attemptId]`)
- **Purpose:** Execute the structured daily practice quiz (`20` MCQs + `5–10` short free-response across `Basic`, `Application`, and `Analysis` difficulties), inspect graded answers and formative `AI Practice Review` feedback, or take the single allowed retry (`PRD §29–§33`).
- **User Goal:** Practice today's topic, receive rubric-based AI feedback, unlock the next Daily Plan day, and optionally retry once to improve.
- **Components:** `MultiStepFormWrapper(quiz_session)`, `QuizCard(mcq & free_response)`, `PracticeReviewCard`, `AILoadingState`, `Modal(Confirm Unanswered Questions)`, `AIFeedbackComponent(report_button)`, `Toast`.
- **Data & API Dependencies:** `POST /api/v1/quiz/generate` (`EP-Q01`, `H-IDEM`), `GET /api/v1/quiz/{id}` (`EP-Q02`), `POST /api/v1/quiz/{id}/start` (`EP-Q03`), `PATCH /api/v1/quiz/{id}/answers` (`EP-Q04`), `POST /api/v1/quiz/{id}/submit` (`EP-Q05`, `H-IDEM`), `GET /api/v1/quiz/{id}/result` (`EP-Q06`), `POST /api/v1/quiz/{id}/retry` (`EP-Q07`, `H-IDEM`), `GET /api/v1/practice-review` (`EP-PR01`), `GET /api/v1/practice-review/{id}/feedback` (`EP-PR02`), `POST /api/v1/practice-review/{id}/review` (`EP-PR03`), `POST /api/v1/reports` (`EP-F02`).
- **User Actions:**
  1. **Start & Autosave (`EP-Q03`, `EP-Q04`):** Starting the quiz transitions status to `started` (and closes any open merge Undo window on post-merge items per `PRD §21`). Selecting an MCQ option, typing a Bangla/English/Mixed short answer, or selecting `"I don't know"` triggers debounced autosave (`EP-Q04`) + local `sessionStorage` backup (`PRD §33, §54`).
  2. **Resume (`EP-Q02`):** Closing and reopening the app restores `saved_answers` with zero arbitrary expiry (`PRD §33`).
  3. **Submit (`EP-Q05`):** If unanswered questions remain, opens confirmation modal (`confirm_unanswered: true`). Submission grades MCQs immediately, **unlocks the next Daily Plan day regardless of score (`plan_day_unlocked: true`)**, and starts async `AI Practice Review` (`review_job_id`).
  4. **Inspect Results & Retry (`EP-Q06`, `EP-Q07`, `EP-PR02`, `EP-PR03`):** Views MCQ score, correct answers, explanations, and free-response rubric feedback (`Good / Needs Work`). Can report a flawed question or unfair AI scoring (`EP-F02`, `target_type: 'quiz_question' | 'practice_review'`), retry a failed AI review (`EP-PR03`), or click `"পুনরায় চেষ্টা করুন (Retry Quiz Once)"` (`EP-Q07` when `retry_available === true`).
- **Error States:** `NO_ANSWERS_SUBMITTED (422)`, `UNANSWERED_CONFIRMATION_REQUIRED (422)`, `RETRY_LIMIT_REACHED (409)`, `RAW_RESPONSE_EXPIRED (410)`.
- **Analytics Events:** `quiz_started`, `quiz_completed`, `ai_feedback_submitted`.

### Screen 19: Learning Progress (`/progress`)
- **Purpose:** Display skill and Career Level learning states (`Not Started`, `Learning`, `Practicing`, `Proficient`), cross-roadmap shared skills, weak areas, and explainable progress history (`PRD §17, §18, §34–§36`).
- **User Goal:** Understand current strengths, weak areas, and *why* each skill state changed.
- **Components:** `Tabs(Overview | Shared Skills | Weak Areas | History)`, `SkillProgressBadge`, `SkillCard`, `ProgressHistoryCard`, `Select(roadmap_id | career_level | learning_state)`.
- **Data & API Dependencies:** `GET /api/v1/progress` (`EP-G01`), `GET /api/v1/progress/skills/{skill_id}` (`EP-G02`), `GET /api/v1/progress/history` (`EP-G03`).
- **User Actions:** Filter skills by roadmap, Career Level (`Junior`, `Mid`, `Senior`), or state; click a skill to inspect evidence summary and roadmap-specific depth (`EP-G02`); browse chronological state transitions (`EP-G03`).
- **Security & Product Guardrails:**
  - **Never displays `"Job Ready"` or guaranteed employment copy (`PRD §36`).**
  - Explains every state transition via `state_reason` (`PRD §35`).
  - Preserves lower-level evidence when moving from `Mid` to `Senior` without automatically marking `Senior` as `Proficient` (`PRD §18`).

### Screen 20: AI Career Mentor Chat (`/mentor`)
- **Purpose:** Provide contextual technology-career and topic-learning guidance grounded in the user's Focus Roadmap and current topic (`PRD §37`).
- **User Goal:** Ask questions about topics, roadmap reasoning, practice feedback, or technology updates in Bangla, English, or Mixed language.
- **Components:** Conversation List Sidebar/Drawer, Context Pill (`focus_roadmap | topic | general`), `AIChatMessage`, Message Composer (`1–4000` chars), `Toast`.
- **Data & API Dependencies:** `POST /api/v1/mentor/conversations` (`EP-M01`), `GET /api/v1/mentor/conversations` (`EP-M02`), `POST /api/v1/mentor/messages` (`EP-M03`), `GET /api/v1/mentor/history` (`EP-M04`).
- **User Actions:** Start conversation with Focus Roadmap or current topic context (`EP-M01`); send message with `client_message_id` UUID (`EP-M03`); paginate history (`EP-M04`).
- **Loading / Empty / Error States:**
  - Uses synchronous JSON response (`< 10 s` target per `ADR-018`, or opt-in SSE via `Accept: text/event-stream`).
  - On `AI_TIMEOUT (504)` or `AI_SERVICE_ERROR (502)`, the user's message remains saved and the bubble shows a one-tap retry using the same `client_message_id`.
  - When `learning_claim_recorded === true` (user claims *"I studied this"*), shows a calm note that conversational statements are saved as context only and quiz practice is required for verified progress (`PRD §37`).
  - When `safety_mode === true` (personal distress detected), renders a safe, non-clinical support redirection banner (`PRD §37`).
- **Permission State:** `AZ-USER`, **Gate: write (`ai_mentor`)** for new messages; existing 90-day history (`EP-M04`) remains readable when feature is disabled (`PRD §7, §52`).
- **Analytics Events:** `mentor_message_sent`, `mentor_response_received` (message content is strictly excluded from telemetry).

### Screen 21: Personalized Daily Technology Updates (`/tech-updates`)
- **Purpose:** Surface at most one personalized, source-grounded technology update per local calendar day relevant to the user's Focus Roadmap and skills (`PRD §38–§46`).
- **User Goal:** Understand what changed in the ecosystem, why it matters to their Focus Roadmap, and whether to `Act now`, `Learn later`, or treat as `Awareness only`.
- **Components:** `AIExplanationCard(technology_update)`, `AIFeedbackComponent(rating_1_5)`, Filter Pills (`All | High Relevance | Unread`).
- **Data & API Dependencies:** `GET /api/v1/technology-updates` (`EP-T01`), `GET /api/v1/technology-updates/{id}` (`EP-T02`), `POST /api/v1/technology-updates/{id}/view` (`EP-T03`), `POST /api/v1/ratings` (`EP-F01`).
- **User Actions:** Read update details (`what_changed`, `why_it_matters`, `publisher`, `source_url`, `fetched_at`, `release_status`, `action_timing`); mark viewed (`EP-T03`); rate usefulness 1–5 (`EP-F01`, `target_type: 'technology_update'`).
- **Empty, Error & Permission States (`Gate: read`):**
  - **Default OFF for New Users (`PRD §7, §38`):** When `effective_access.technology_update === false` (`403 FEATURE_DISABLED`), displays a dedicated informational screen explaining that Daily Technology Updates are currently turned off for this account.
  - **`no_important_changes`:** Displays *"No important changes for your current learning path today."* (`PRD §39`).
  - **`temporarily_unavailable`:** Displays *"Technology updates are temporarily unavailable."* (`PRD §40, §46`).
- **Product Rules:** Updates are informational only and never silently modify a locked roadmap (`PRD §38`).

### Screen 22: Account & Settings (`/settings`)
- **Purpose:** Manage linked authentication identities, add a verified contact method, edit learning settings, or initiate **User Account Deletion** (`PRD §7, §11–§14`).
- **User Goal:** Link Google/Facebook/Phone/Email, update timezone/hours, or permanently delete the account.
- **Components:** Identity Linking Cards, `Input(contact)`, `Select(timezone)`, `Input(preferred_daily_hours)`, `Modal(destructive_delete requiring literal 'DELETE')`, Deletion Status Banner, `Toast`.
- **Data & API Dependencies:** `GET /api/v1/auth/me` (`EP-A13`), `POST /api/v1/auth/identities/link` (`EP-A11`), `POST /api/v1/auth/contact` (`EP-A12`), `PATCH /api/v1/profile/learning-settings` (`EP-P04`), `POST /api/v1/account/deletion-requests` (`EP-X01`, `H-IDEM`), `GET /api/v1/account/deletion-requests/current` (`EP-X02`), `POST /api/v1/auth/logout` (`EP-A06`).
- **User Actions & Business Rules:**
  - **Verified Contact Prompt (`PRD §11`):** If a Facebook login did not provide a verified email (`verified_contact === false`), prompts the user to add and verify an email or `+880` phone via `EP-A12` + `EP-A02`/`EP-A03` before identity-sensitive operations (`VERIFIED_CONTACT_REQUIRED 403`).
  - **Account Deletion:** AZ-SUSP remains available. Confirm DELETE plus reauthentication; temporarily save deletion_receipt and poll EP-X02 with Authorization: DeletionReceipt <receipt>. Only returned status=completed confirms local deletion. Clear private local state on sign-out without claiming success from401/404/network errors.

## 3.5 Administration Screens (Screens 23–25)

### Screen 23: Admin Dashboard & Usage Telemetry (`/admin`)
- **Purpose & User Goal:** Monitor aggregate platform usage counts, AI request/fallback/unit/cost metrics by feature and provider, and immutable admin audit logs (`PRD §50–§51`).
- **Components:** `Header(admin)`, `Sidebar(admin)`, Aggregate Metric Cards, Date Range & `group_by(day | feature | provider)` Filter, Audit Log Table (`EP-AD07`).
- **Data & API Dependencies:** `GET /api/v1/admin/usage` (`EP-AD08`: `UsageSummaryDTO`), `GET /api/v1/admin/audit-logs` (`EP-AD07`: `AuditLogDTO[]`).
- **Permission & Privacy Boundary (`AZ-ADMIN`, `PRD §51`):** Server-authorized against `public.admin_users`. Displays only aggregate counts and costs; **contains zero UI views or API bindings for private mentor messages, conversation summaries, AI context, or student practice answers**.

### Screen 24: Admin User Management (`/admin/users`)
- **Purpose & User Goal:** Search/filter users, inspect aggregate user counts and effective feature access, and suspend or reactivate accounts (`PRD §7, §51`).
- **Components:** Search Input (`q`), Status Filter (`active | suspended`), User Table, User Detail Drawer (`AdminUserDetailDTO`), `Modal(Suspend / Reactivate User with mandatory reason 3..300 chars)`.
- **Data & API Dependencies:** `GET /api/v1/admin/users` (`EP-AD01`), `GET /api/v1/admin/users/{id}` (`EP-AD02`), `PATCH /api/v1/admin/users/{id}` (`EP-AD03`: `AdminUserStatusDTO`).
- **Business Rules:** System suspension blocks all normal features while preserving user data and account-deletion access; reactivation restores all preserved roadmaps, plans, and progress (`PRD §7`). Admin accounts cannot be suspended via this endpoint (`CANNOT_MODIFY_ADMIN 403`).

### Screen 25: Admin Feature Controls (`/admin/features`)
- **Purpose & User Goal:** Control global feature availability and per-user feature overrides, including enabling `technology_update` per user (`PRD §7, §51`).
- **Components:** Global Feature Matrix (`7` `ToggleSwitch` rows), Per-User Feature Override Drawer (`enabled: true | false | null` to clear override), Effective Access Formula Preview.
- **Data & API Dependencies:** `GET /api/v1/admin/features` (`EP-AD04`), `PATCH /api/v1/admin/features` (`EP-AD05`: `FeatureToggleDTO`), `PATCH /api/v1/admin/users/{id}/features` (`EP-AD06`: `UserFeatureToggleDTO`).
- **Business Rules:** Visualizes `System User Status + Global Feature Status + User Feature Status = Effective Access` (`PRD §7`). Disabling a feature never deletes existing user data for that feature (`PRD §7`).

------------------------------------------------------------------------

# 4. Complete API Traceability Contract (All 12 Domains)

Frontend communication architecture:

```text
Component
    ↓
Feature Service (src/services/*)
    ↓
API Client (Bearer JWT + X-Request-Id + Idempotency-Key + 401 Refresh Interceptor)
    ↓
REST API v1.5.1 (/api/v1/*)
    ↓
TanStack Query Cache & Local Draft State Update
```

| Domain | Operation | Endpoint ID & Path (`API v1.5.1`) | Method | Request DTO | Response DTO | Loading & Cache Update Rule |
|---|---|---|---|---|---|---|
| **1. Authentication** | Register / Verify / Resend | `EP-A01` `/auth/register`<br>`EP-A02` `/auth/verify-email`<br>`EP-A03` `/auth/verify-phone`<br>`EP-A04` `/auth/resend-verification` | `POST` | `RegisterRequestDTO`<br>`VerifyCodeRequestDTO`<br>`ResendVerificationDTO` | `RegistrationPendingDTO`<br>`AuthSessionDTO` | Button spinner; on `EP-A02`/`A03` success, stores session and primes `['auth','me']`. |
| **1. Authentication** | Login / Logout / Refresh / Recovery / OAuth / Link / Contact / Me | `EP-A05` `/auth/login`<br>`EP-A06` `/auth/logout`<br>`EP-A07` `/auth/refresh`<br>`EP-A08` `/auth/forgot-password`<br>`EP-A09` `/auth/reset-password`<br>`EP-A10` `/auth/oauth/session`<br>`EP-A11` `/auth/identities/link`<br>`EP-A12` `/auth/contact`<br>`EP-A13` `/auth/me` | `POST`<br>`GET` | `LoginRequestDTO`<br>`RefreshTokenDTO`<br>`ForgotPasswordRequestDTO`<br>`ResetPasswordRequestDTO`<br>`OAuthSessionRequestDTO`<br>`LinkIdentityRequestDTO`<br>`AddContactRequestDTO` | `AuthSessionDTO`<br>`OAuthSessionResponseDTO`<br>`MeResponseDTO` | `['auth','me']` is fetched on app bootstrap and invalidated on login/logout/link/focus change. |
| **1. Account Deletion** | Request/Poll | `EP-X01` `/account/deletion-requests` / `EP-X02` `/account/deletion-requests/current` | POST / GET | AccountDeletionRequestDTO + H-IDEM; scoped receipt | AccountDeletionStatusDTO | Only status=completed confirms local deletion; errors remain unconfirmed. |
| **2. User Profile** | Get & Update Profile, Preferences, Learning Settings | `EP-P01` `/profile`<br>`EP-P02` `/profile`<br>`EP-P03` `/profile/preferences`<br>`EP-P04` `/profile/learning-settings` | `GET`<br>`PATCH` | `ProfileUpdateDTO`<br>`ProfilePreferencesDTO`<br>`LearningSettingsDTO` | `ProfileResponseDTO` | Invalidates `['profile']` and `['auth','me']` (`profile_complete`). |
| **3. Skill Analysis** | Resolve Uncertain Skill Alias | `EP-P05` `/profile/skill-alias-interpretations` | `POST` | `SkillAliasInterpretationDTO` | `{ input, skill_id, scope: 'user', added_to_profile: true }` | Server atomically updates `user_skill_aliases`, `user_profiles`, and `skill_progress` (`ADR-019`); invalidates `['profile']` and `['progress']`. |
| **4. Career Intelligence** | Create, List, Get, Clarify, Confirm, Edit, Discontinue Goal | `EP-C01` `/career/goals`<br>`EP-C02` `/career/goals`<br>`EP-C03` `/career/goals/{id}`<br>`EP-C04` `.../clarifications`<br>`EP-C05` `.../confirm`<br>`EP-C06` `/career/goals/{id}`<br>`EP-C07` `/career/goals/{id}` | `POST`<br>`GET`<br>`PATCH`<br>`DELETE` | `CareerGoalCreateDTO`<br>`GoalClarificationDTO`<br>`GoalConfirmDTO` | `CareerGoalResponseDTO` | Synchronous AI loader (`< 10 s`) on `EP-C01`/`C04`/`C06`; invalidates `['career-goals']`, `['roadmaps']`, and `['auth','me']`. |
| **5. Roadmap** | Generate Draft, List, Get, Revise, Lock, Versions, Focus, Archive | `EP-R01` `/roadmaps/generate`<br>`EP-R02` `/roadmaps`<br>`EP-R03` `/roadmaps/{id}`<br>`EP-R04` `.../revision`<br>`EP-R05` `.../lock`<br>`EP-R06` `.../versions`<br>`EP-R07` `.../versions/{no}`<br>`EP-R14` `.../focus`<br>`EP-R15` `.../archive` | `POST`<br>`GET` | `GenerateRoadmapRequestDTO`<br>`RevisionRequestDTO`<br>`LockRoadmapDTO` (`H-IDEM`) | `JobAcceptedDTO` (`202`)<br>`RoadmapSummaryDTO[]`<br>`RoadmapResponseDTO`<br>`RoadmapVersionDTO[]`<br>`FocusSwitchResponseDTO` | `EP-R01` & `EP-R04` return `202` and poll `EP-J01`; `EP-R05`/`R14`/`R15` invalidate `['roadmaps']`, `['daily-plan']`, `['today']`, and `['auth','me']`. |
| **5. Roadmap Merges** | Propose, List, Get, Accept, Reject, Undo Merge | `EP-R08` `/roadmaps/{id}/merges`<br>`EP-R09` `/roadmaps/{id}/merges`<br>`EP-R10` `.../merges/{mid}`<br>`EP-R11` `.../accept`<br>`EP-R12` `.../reject`<br>`EP-R13` `.../merges/undo` | `POST`<br>`GET` | `MergeRequestDTO`<br>`MergeAcceptDTO` (`H-IDEM`) | `JobAcceptedDTO` (`202`)<br>`MergeProposalSummaryDTO[]`<br>`MergeProposalDTO` | `EP-R08` polls `EP-J01`; `EP-R11` & `EP-R13` invalidate `['roadmap', id]`, `['roadmap-versions', id]`, `['daily-plan']`, and `['today']`. |
| **6. Learning** | Get/Create/Rebuild Daily Plan, Get Today, Topics & Resources | `EP-L01` `/learning/daily-plan`<br>`EP-L02` `/learning/daily-plans`<br>`EP-L03` `.../rebuild`<br>`EP-L04` `/learning/today`<br>`EP-L05` `/learning/topics`<br>`EP-L06` `/learning/topics/{id}`<br>`EP-L07` `/learning/resources` | `GET`<br>`POST` | `CreateDailyPlanDTO` (`H-IDEM`)<br>`RebuildDailyPlanDTO` | `DailyPlanResponseDTO`<br>`TodayResponseDTO`<br>`TopicSummaryDTO[]`<br>`TopicDetailDTO`<br>`LearningResourceDTO[]` | `EP-L02`/`L03` invalidate `['daily-plan']`, `['today']`, and `['profile']` (saved hours); `EP-L04` polls `EP-J01` when `status === 'preparing'`. |
| **7. Quiz** | Generate, Get, Start, Autosave, Submit, Result, Retry | `EP-Q01` `/quiz/generate`<br>`EP-Q02` `/quiz/{id}`<br>`EP-Q03` `/quiz/{id}/start`<br>`EP-Q04` `/quiz/{id}/answers`<br>`EP-Q05` `/quiz/{id}/submit`<br>`EP-Q06` `/quiz/{id}/result`<br>`EP-Q07` `/quiz/{id}/retry` | `POST`<br>`GET`<br>`PATCH` | `QuizGenerateDTO`<br>`QuizAnswersPatchDTO`<br>`QuizSubmissionDTO` (`H-IDEM`) | `QuizAttemptDTO`<br>`QuizSubmitResponseDTO`<br>`QuizResultDTO` | `EP-Q03` invalidates `['roadmap-merges']` (closes Undo window); `EP-Q05` invalidates `['today']`, `['daily-plan']`, `['progress']`, and polls `review_job_id` via `EP-J01`. |
| **8. Practice Review** | List Reviews, Get Feedback, Trigger/Retry Review | `EP-PR01` `/practice-review`<br>`EP-PR02` `.../{id}/feedback`<br>`EP-PR03` `.../{id}/review` | `GET`<br>`POST` | Query `quiz_attempt_id` | `PracticeReviewSummaryDTO[]`<br>`PracticeFeedbackDTO`<br>`JobAcceptedDTO` (`202`) | `EP-PR03` polls `EP-J01`, then invalidates `['practice-review', id]`, `['quiz-result']`, and `['progress']`. |
| **9. Progress & Evidence** | Get Progress, Skill Detail, Progress History (`EP-G04` internal) | `EP-G01` `/progress`<br>`EP-G02` `/progress/skills/{id}`<br>`EP-G03` `/progress/history` | `GET` | Query filters (`roadmap_id`, `career_level`, `learning_state`) | `ProgressResponseDTO`<br>`SkillProgressDetailDTO`<br>`ProgressHistoryItemDTO[]` | Read-only client queries (`EP-G04` is internal backend-only and never called by client). |
| **10. AI Mentor** | Create/List Conversations, Send Message, Get History | `EP-M01` `/mentor/conversations`<br>`EP-M02` `/mentor/conversations`<br>`EP-M03` `/mentor/messages`<br>`EP-M04` `/mentor/history` | `POST`<br>`GET` | `ConversationCreateDTO`<br>`MessageRequestDTO` | `ConversationDTO`<br>`MessageResponseDTO`<br>`MessageDTO[]` | Optimistic user message bubble keyed by `client_message_id`; updates `['mentor-history', convId]` and `['mentor-conversations']`. |
| **11. Technology Intelligence & Feedback** | List/Get/View Tech Updates, Submit Ratings & Reports | `EP-T01` `/technology-updates`<br>`EP-T02` `/technology-updates/{id}`<br>`EP-T03` `.../{id}/view`<br>`EP-F01` `/ratings`<br>`EP-F02` `/reports` | `GET`<br>`POST` | `RatingRequestDTO`<br>`ReportRequestDTO` | `TechnologyUpdateListDTO`<br>`TechnologyUpdateDTO`<br>`{ report_id, status }` | `EP-T03` updates `viewed: true` in cache; `EP-F01`/`F02` update local rating/report state. |
| **12. Admin & Jobs** | Poll Async Job, Admin Users, Features, Audit Logs, Usage | `EP-J01` `/jobs/{id}`<br>`EP-AD01` `/admin/users`<br>`EP-AD02` `/admin/users/{id}`<br>`EP-AD03` `/admin/users/{id}`<br>`EP-AD04` `/admin/features`<br>`EP-AD05` `/admin/features`<br>`EP-AD06` `.../users/{id}/features`<br>`EP-AD07` `/admin/audit-logs`<br>`EP-AD08` `/admin/usage`<br>`EP-H01` `/health` | `GET`<br>`PATCH` | `AdminUserStatusDTO`<br>`FeatureToggleDTO`<br>`UserFeatureToggleDTO` | `JobStatusDTO`<br>`AdminUserSummaryDTO[]`<br>`AdminUserDetailDTO`<br>`FeatureControlDTO[]`<br>`AuditLogDTO[]`<br>`UsageSummaryDTO` | `EP-J01` polls at `retry_after_seconds` until `succeeded` or `failed`; all admin `PATCH` calls invalidate `['admin-audit-logs']`. |

------------------------------------------------------------------------

# 5. Roadmap Mutation UX Contract

All post-lock roadmap modifications strictly follow this state machine (`PRD §21`):

```text
AI Proposal Generated (User Request / Level Change / Optional AI Proposal)
    ↓
User Review in RoadmapDiffViewer (EP-R10)
    ↓
Accept (EP-R11) or Reject (EP-R12)
    ↓
Atomic Merge & Future Daily Plan Reconciliation
    ↓
Immutable Version Update (version_no + 1)
    ↓
One-Step Undo Available (EP-R13 — Closes automatically when post-merge quiz starts)
```

Required UI states on Screen 15 (`/roadmaps/[id]`):

1. **AI Proposal Generated (`status: 'proposed'`):** Displays `origin` (`user_request`, `level_change`, or `ai_proposal`), `reason`, `size_impact` (`active_topics_before` → `active_topics_after`), and `daily_plan_impact` (`completed_days_unchanged` vs. `future_days_affected`).
2. **Large Expansion Guardrail (`size_impact.materially_large === true`):** Renders a prominent warning banner (`size_impact.warning`) and disables the `"Accept Merge"` button until the user checks the `acknowledge_large_expansion` `Checkbox` (`PRD §20, §21`).
3. **Merge Accepted State (`status: 'accepted'`):** Transitions roadmap to the new `version_no`, preserves all completed Daily Plan days and skill evidence, and reconciles only future incomplete plan days.
4. **One-Step Rollback State (`undo_available === true`):** Displays `"সর্বশেষ পরিবর্তন বাতিল করুন (Undo Last Merge)"` button (`EP-R13`). As soon as the user starts a quiz on any post-merge plan item (`EP-Q03` / `trg_quiz_attempts_close_undo`), `undo_available` becomes `false` and the button is hidden (`PRD §21`).
5. **Failed Update State:** Preserves the locked roadmap and Daily Plan untouched, displaying a retryable error `Toast` (`PRD §48`).

------------------------------------------------------------------------

# 6. Security UX Rules & Error Handling Contract

Security boundary chain:

```text
Next.js PWA Frontend → NestJS AccessGuard → Supabase Auth JWT → PostgreSQL Universal RLS (50 Tables)
```

Mandatory HTTP error-to-UX responses (`API Spec v1.5.1 §4 & §16`):

| HTTP Status & Error Code | Mandatory Frontend UX Response |
|---|---|
| **`401 AUTH_REQUIRED / TOKEN_EXPIRED`** | One silent refresh; failure signs out. During deletion use valid scoped receipt for EP-X02. 401/404/network error means unconfirmed, never success. |
| **`403 ACCOUNT_SUSPENDED`** | Redirect immediately to `/settings` (Screen 22), display the suspension notice, block all normal feature routes, and keep **only** Logout (`EP-A06`) and Account Deletion (`EP-X01`, `EP-X02`) active (`PRD §7, §13`). |
| **`403 FEATURE_DISABLED`** | Keep existing data readable (`Gate: none`: locked roadmaps, daily plans, progress, chat history remain viewable per `PRD §7`); disable new generation buttons (`Gate: write`) with a calm informational banner. |
| **`403 VERIFIED_CONTACT_REQUIRED`** | Open prompt directing the user to `/settings` to add and verify an email or `+880` phone number (`EP-A12`, `PRD §11`). |
| **`404 RESOURCE_NOT_FOUND`** | Display localized unavailable state with a button returning to `/dashboard`. |
| **`409 STALE_VERSION / DRAFT_STALE`** | Prompt the user to reload the latest version or refresh the stale draft (`EP-R04`). |
| **`422 VALIDATION_FAILED`** | Map each item in `error.details[]` (`field`, `code`, `message`) to the corresponding `Input`/`Select` field error state while preserving all valid user inputs (`PRD §8`). |
| **`423 ACCOUNT_LOCKED` / `429 RATE_LIMITED / RESEND_COOLDOWN_ACTIVE`** | Display `Toast` or inline banner with a live countdown timer driven by `error.retryAfterSeconds`. |
| **`500 / 502 / 503 / 504` (Server / AI / Provider Errors)** | Preserve all local form/quiz inputs (`MultiStepFormWrapper`), never corrupt existing state, and display retry action when `error.retryable === true` (`PRD §46, §48`). |

------------------------------------------------------------------------

# 7. Frontend Telemetry Contract

Telemetry captures product health and usability metrics without ever collecting sensitive personal or conversational content.

## 7.1 Required Event Metadata
- `timestamp` (ISO 8601)
- `anonymous_session_id` (rotated non-PII UUID)
- `feature_key` (`FeatureKey`)
- `screen_name`
- `event_name`
- `request_id` (`X-Request-Id` on API errors)

## 7.2 Strictly Forbidden in Telemetry Payloads
- AI Mentor message content (`content`)
- Free-text career goal descriptions (`goal_text`)
- Passwords, OTP codes, JWTs, or refresh tokens
- Quiz free-response student answers (`answer_text`)
- Personal email addresses, phone numbers, or real names

## 7.3 Required Telemetry Events
- **Authentication:** `auth_started`, `auth_completed`, `auth_failed`
- **Onboarding:** `onboarding_started`, `profile_completed`, `career_goal_submitted`
- **AI Operations:** `ai_request_started`, `ai_response_completed`, `ai_feedback_submitted`
- **Roadmap:** `roadmap_viewed`, `roadmap_updated`, `roadmap_change_accepted`
- **Learning & Quiz:** `learning_started`, `quiz_started`, `quiz_completed`
- **Mentor:** `mentor_message_sent`, `mentor_response_received`

------------------------------------------------------------------------

# 8. Developer Handoff Checklist

## Design System & Localization
- [ ] Design tokens (colors, spacing, radius, shadows) configured in Tailwind CSS — implementation/execution evidence pending.
- [ ] Bangla-first typography (`Hind Siliguri` / `Noto Sans Bengali` + `Inter` + `JetBrains Mono`) configured for natural Bangla-English mixed rendering (`PRD §4`) — implementation/execution evidence pending.
- [ ] Responsive breakpoints verified (`360px` mobile, `768px` tablet, `1024px+` desktop) — implementation/execution evidence pending.
- [ ] Reduced-motion support (`prefers-reduced-motion`) verified — implementation/execution evidence pending.

## Components (All 29 Production Components)
- [ ] Navigation components (`01`–`04`) implemented — implementation/execution evidence pending.
- [ ] Form & feedback primitives (`05`–`12`) with `+880` normalization and `sessionStorage` draft preservation implemented — implementation/execution evidence pending.
- [ ] Career, Roadmap, and Learning components (`13`–`22`) implemented — implementation/execution evidence pending.
- [ ] Progress components (`23` `SkillProgressBadge` & `24` `ProgressHistoryCard`) implemented with zero `"Job Ready"` or gamified badge elements (`PRD §34–§36`) — implementation/execution evidence pending.
- [ ] AI components (`25`–`29`) with `EP-J01` polling and `PRD §24` rating/report rules implemented — implementation/execution evidence pending.

## Screens (All 25 Production Screens)
- [ ] Public & Authentication screens (`01`–`06`) completed — implementation/execution evidence pending.
- [ ] Onboarding screens (`07`–`12`) with beginner `"None"` skill support (`existing_skills_none`) completed — implementation/execution evidence pending.
- [ ] Main Application screens (`13`–`22`) including `AZ-SUSP` account deletion access completed — implementation/execution evidence pending.
- [ ] Admin screens (`23`–`25`) with strict privacy exclusion of mentor/quiz content completed — implementation/execution evidence pending.

## API, Security, Accessibility & PWA
- [ ] Typed API client (`X-Request-Id`, `Idempotency-Key`, 401 refresh, `ADR-019` backend-mediated writes) implemented — implementation/execution evidence pending.
- [ ] WCAG 2.1 AA contrast, keyboard navigation, focus traps, and screen-reader labels verified (`PRD §54`) — implementation/execution evidence pending.
- [ ] PWA Web App Manifest configured and slow-network input preservation (`PRD §54`) verified (no offline learning mode or push notifications per `PRD §4, §58`) — implementation/execution evidence pending.
- [ ] Privacy-filtered telemetry events verified — implementation/execution evidence pending.

------------------------------------------------------------------------

# 9. Final UX & Frontend Readiness Assessment

## Alignment Verification

| Area | Status |
|---|---|
| PRD v1.4.1 Alignment | **SPECIFIED / NOT EXECUTED** |
| SAD v1.1.1 (ADRs 001–020) Alignment | **SPECIFIED / NOT EXECUTED** |
| API Specification v1.5.1 Alignment | **SPECIFIED / NOT EXECUTED** |
| DDD v1.2.2 & DIS v1.1.1 Alignment | **SPECIFIED / NOT EXECUTED** |
| DMS v1.2.2 (50 Tables) Alignment | **SPECIFIED / NOT EXECUTED** |
| AI System Design v1.1.1 Alignment | **SPECIFIED / NOT EXECUTED** |
| WCAG 2.1 AA Accessibility & Bangla-First UX Alignment | **SPECIFIED / NOT EXECUTED** |

## Final Scorecard

| Category | Score | Status |
|---|---|---|
| Product UX Readiness | NOT AN EXECUTION SCORE | SPECIFIED / NOT EXECUTED |
| Frontend Architecture | SPECIFIED; NOT EXECUTED | SPECIFIED / NOT EXECUTED |
| API Integration & Traceability | NOT AN EXECUTION SCORE | SPECIFIED / NOT EXECUTED |
| Domain & Component Alignment (29 Components) | NOT AN EXECUTION SCORE | SPECIFIED / NOT EXECUTED |
| Database & Security Boundary Alignment | SPECIFIED; NOT EXECUTED | SPECIFIED / NOT EXECUTED |
| AI Experience & Polling Readiness | NOT AN EXECUTION SCORE | SPECIFIED / NOT EXECUTED |
| Screen Contract Completeness (25 Screens) | SPECIFIED; NOT EXECUTED | SPECIFIED / NOT EXECUTED |
| Accessibility, Network Resilience & Analytics | NOT AN EXECUTION SCORE | SPECIFIED / NOT EXECUTED |
| **FINAL SCORE** | **NOT AN EXECUTION SCORE** | **ENTERPRISE RUNTIME NOT EXECUTED (GO)** |

## Accepted R10 implementation contract

Direct authenticated reads of ordinary owner/shared rows require an active account; technology_updates, user_update_relevance and update_delivery_history also require effective technology_update access. Settings exceptions are own users row, linked identities, minimal feature-control display metadata, and deletion status through EP-X02. The users policy must not recursively query itself. Active users retain existing roadmap/plan/progress/chat reads when generation flags are OFF. service_role queries enforce the same rules. Never add a permissive alternative that ORs away these restrictions.

## Accepted R11 implementation contract

Human quality review uses synthetic benchmark conversations/practice answers and
approved shared non-personal learning content. It must not sample production
users' private mentor turns, memory, summaries or raw practice answers.
Production quality monitoring uses content-free latency/failure/report metrics.
Do not add a staff/admin content-reading role or use service_role as a human
review exception. Any later consent-based research access is a separate product
and privacy decision, outside this correction.

## Accepted R08 implementation contract

Raw mentor text expires at the earlier of expires_at and created_at+90d; API/service/direct reads apply both predicates. Prepare summaries before expiry; a failed summarizer never delays purge or fabricates memory. Physical purge lag must be measured under R32: the daily cron alone is not a strict boundary guarantee. Production requires a monitored purge runner at the declared cutoff, outage recovery and oldest-retained-text alerts. No retention grace is approved.

## Accepted R05 implementation contract

The worker never pre-completes a request in a separate transaction. It calls the supported Auth deletion operation; BEFORE DELETE ON public.users invokes private.complete_deletion_on_user_delete() before SET NULL. Auth/application deletion and completed status commit or roll back together. completed means LOCAL deletion; provider acknowledgement is separate. JWT bytes need not expire cryptographically immediately; backend account existence/status and R06 receipt enforce access. Inject failure before/during cascade and before commit under R32.

## Accepted R06 implementation contract

EP-X01 202 adds deletion_receipt and receipt_expires_at to the response.
Receipt claims: typ=deletion_receipt, request_id, aud=account-deletion-status,
iat, exp; signed with a dedicated server key; no user/contact/name data.
Proposed default validity: 24h (operational choice to review, not a PRD mandate).
EP-X02 accepts either the existing account JWT or
Authorization: DeletionReceipt <receipt> (never in a URL).
Receipt auth bypasses only account-token lookup for this route. It validates
signature, type, audience and expiry, then looks up only that request_id through
the backend. It grants no other API/RLS access and no anonymous table SELECT.
Return 200 AccountDeletionStatusDTO for scheduled/in_progress/completed,
including a completed null-owner tombstone. status=completed is success evidence.
401/404/network failure alone means unconfirmed, never completed.
An expired receipt requires recovery while the account still exists, or displays
'Unable to confirm completion' after local sign-out. Do not promise recovery
after the receipt lifetime without an additional approved mechanism.
EP-X01 idempotent retry returns the same request and a valid request-bound receipt.

## Accepted R35 implementation contract

Before the local cascade, persist only the minimal supported provider-object
deletion references encrypted at rest, provider key, retry attempt and next retry
time in provider_cleanup; no password/token/message/answer/contact copy. References
can be pseudonymous personal data: do not call this row anonymized while present.
Expiry is explicitly at most requested_at+30 days (proposed policy under PRD §13).
The deletion worker retries pending entries after local completed status, using
the row as workflow state, not Redis as a durable queue. Provider request acceptance
removes that entry; a successful provider request is not proof the provider erased
every backup. provider_deletion_requested is true only when all applicable requests
were accepted; no applicable provider keeps it false with no pending entries.
At expiry clear remaining encrypted references and record only a content-free
unconfirmed/failed outcome in bounded operational evidence. Never retain retry
inputs indefinitely or block local account deletion forever on provider failure.
Only backend code reads/writes provider_cleanup; status reads are mediated by
EP-X02 rather than whole-table direct SELECT. Omit it from status DTOs, direct
client grants, admin screens and logs. The initial 202 example uses false until
the worker actually has provider acknowledgements. After references are removed, the retained
tombstone has no account identifier. Status=completed means local deletion only.

Outbox entry={provider_key,encrypted_object_ref,attempts,next_retry_at,state:'pending'}; reject unknown fields, plaintext references and credentials. AEAD managed server key/version uses request_id+provider_key as authenticated data. Max5 attempts,10s calls and exponential backoff before requested_at+30d deadline. Serialize worker ownership by request row lock, capture entry identity, call outside transaction, then conditionally remove that entry. Use provider-supported request+entry idempotency; crash after acknowledgement can replay the same external call. No exactly-once billing/deletion claim. Scrub expired references before use and in retention runner; content-free failed/unconfirmed operational outcome expires within30d. Do not optimistically mark provider acknowledgements.

## Accepted R07 implementation contract

Under one user-scoped transaction lock, EP-P02/P05 save canonical self-reported
skill IDs, deduplicate, enforce the total 100-skill cap, and set None=false when
the resulting list is nonempty. EP-P05 also upserts only this user's alias.
Before a confirmed goal level exists, profile skills are explicitly represented
as self-reported Learning context; do not insert an unkeyed skill_progress row.
Return progress_initialization='deferred_until_level_confirmation'.
On EP-C05 confirmation, initialize each self-reported skill for that confirmed
Career Level in the same goal-confirmation transaction. For existing confirmed
goals, initialize their distinct target levels during EP-P02/P05.
Insert missing rows at learning with state_reason='Self-reported skill'; change
not_started to learning with a new explanatory reason. Preserve learning,
practicing, proficient and all stronger evidence; never copy lower-level
Proficient into another level. Repeated resolution is idempotent.
None with an empty list creates no artificial skills. Removing a profile skill
does not erase prior evidence or mutate a locked roadmap.

## Accepted R24 implementation contract

Advance last_active_at for successful explicit login/verification/OAuth session
establishment and successful foreground user actions: profile/goal edits,
roadmap/plan selection or inspection, learning/topic interaction, quiz autosave/
submit, mentor send and technology-update open. Use authenticated server identity
and server time. Coalesce writes to at most once per five minutes per user,
with last_active_at=GREATEST(last_active_at, observed_server_time).
Do not advance it for silent token refresh, job polling, health checks, scheduler
work, background prefetch or passive telemetry. Session refresh timestamps are
separate. A foreground action can record activity while using a refreshed session.

## Accepted R25 implementation contract

For each candidate, acquire a session advisory lock keyed by user ID and captured
local date on a dedicated backend DB connection; if unavailable, skip this pass.
Recheck account, feature, meaningful activity, profile timezone and existing date
outcome after acquiring it. Capture timezone/local_date once for this attempt.
Keep the connection pinned and lock held through the bounded external attempt;
release in finally; a lost DB session invalidates ownership, so discard its result.
Before inserting, recheck the captured date/timezone. If they changed, discard
this attempt and let a subsequent pass handle the current date; do not relabel it.
Use the existing unique user/date constraint as the final stored-outcome guard.
Do not invent a delivered/no-change/unavailable outcome merely to reserve work.
Every external attempt has a deadline/concurrency cap; monitor pinned connection
capacity. A crashed call may incur cost twice on retry; no exactly-once billing
claim is made. PostgreSQL remains authoritative; Redis is not a durable reservation.

Edits apply on next pass; never rewrite prior local_date or backfill dates. Use a dedicated direct/session connection, never transaction-pool session locks. Defaults:60s external deadline, concurrency2 and max2 pinned scheduler connections per instance. Capture timezone/date and check after call on same still-owned session; session loss invalidates result. Recheck activity/account/access before commit. Advisory lock prevents concurrent live attempts; provider cost may repeat after crash. Hourly cadence is best effort from first eligible hour>=06, no fixed delivery-time or rolling24h guarantee. When no committed outcome exists, EP-T01 returns today_state:null,generation_pending:true; do not invent no_important_changes/outage rows to reserve work. Completed outcomes return generation_pending:false and one existing update_state value.

## Accepted R18 implementation contract

Before navigating, retain a short-lived verification draft in sessionStorage:
{channel, normalized_identifier, contact_masked, expires_at, context}.
Use the entered normalized email/+880 phone for verify/resend; contact_masked
is display only. Navigate /verify?channel=<channel>, with no contact in the URL.
Never store password, OTP, JWT or refresh token in this draft. On reload restore
it until expiry; if absent/expired ask the user to re-enter the identifier using
the existing Input component. Clear on verified/expired/cancelled sign-out.
Apply the same no-PII-in-URL pattern to /reset-password; do not pass identifier
in the query string or analytics. Use a fresh user-entered identifier if recovery
draft state is unavailable.

## Accepted R18 implementation contract

Screen02 UNVERIFIED_ACCOUNT and settings secondary-contact verification create the same draft from the entered normalized identifier. If a fresh tab lacks it, request the identifier again. Expiry is min(challenge expiry,10min); resend updates expiry from server. Passwords/codes/session tokens never enter this draft.

## Accepted R17 implementation contract

After 202 remain on the existing clarification screen:
/onboarding/clarify?goalId=<confirmed-goal-id>&jobId=<job-id>.
Render AILoadingState and poll EP-J01 using retry_after_seconds. The URL stores
only resource IDs, never goal text/token. On succeeded, validate result_ref.type
and navigate replace to /roadmaps/<result_ref.id>/draft. On failed show the
documented error/retry action while retaining the confirmed goal. Reload resumes
the same job; it must not issue EP-R01 automatically again. Missing/foreign jobs
use the API's unavailable state, not a guessed roadmap route.

## Accepted R15 implementation contract

Default Accept:application/json → 201 JSON, unchanged.
Opt-in Accept:text/event-stream → 200 text/event-stream; Cache-Control:no-store.
Use POST fetch streaming; native EventSource's GET is not the transport here.
Generate, validate and commit the assistant message before emitting its content.
Then chunk that validated reply as display deltas; this is not raw model streaming.
Before headers, normal JSON errors/statuses apply. After headers, emit a typed
error event if possible and close; never attempt to change the HTTP status.
The same client_message_id retrieves the committed response on retry, with no
second model call. No automatic reconnect/repost that creates a new message ID.

```typescript
type MentorStreamEvent =
  | { event: 'message.delta'; data: {
      message_id: string; seq: number; text: string } }
  | { event: 'message.completed'; data: MessageResponseDTO }
  | { event: 'message.error'; data: {
      code: string; retryable: boolean; request_id: string } };
```

SSE frames use event:<name> followed by data:<JSON> and a blank line; seq starts at0. message.completed is authoritative, EOF is not. JSON remains201 by default; opt-in transport is200. Same client_message_id replays the committed validated reply without another model call. Disconnect preserves draft/client ID; reconcile with history or same-ID retry. No automatic new-ID repost. The application chunks the already validated committed output, never unvalidated provider deltas.

## Accepted R29 implementation contract

Use the complete RoleOptionDTO, UnresolvedSkillDTO, SkillProgressDetailDTO and ProgressHistoryItemDTO schemas in C05. Properties are required unless optional is explicit; preserve null source IDs. History navigation uses source_attempt_id, never a guessed review-to-attempt UUID.

## Accepted R30 implementation contract

from/to are inclusive UTC calendar dates; require from<=to. Default to the last
30 UTC dates including today (an operational default, not a new retention rule).
Keep existing totals/by_feature/by_provider. Add series={group_by,buckets}:
day buckets use YYYY-MM-DD UTC and fill zero dates; feature/provider buckets
use their existing aggregate keys. Default group_by=day. Counts/costs only;
no private text. Document the available source-retention window for AI metrics.

UsageSummaryDTO retains range/users/counts/ai and adds required series={group_by:'day'|'feature'|'provider',buckets:UsageBucketDTO[]}. Bucket={key:string,requests:int,estimated_cost_usd:number,failures:int|null,fallbacks_used:int|null,input_units:int|null,output_units:int|null}; day keys are ISO UTC dates with all numeric fields; feature/provider keys use existing aggregates and null unavailable extra dimensions. ai.by_day contains day,requests,failures,fallbacks_used,input_units,output_units,estimated_cost_usd. Backend maps selected ai array to series. Validate range <=366 inclusive UTC dates to bound work; return422 on invalid range. AI source history is only available within retained request window and must be labelled accordingly; do not imply permanent metrics from raw logs.
Example empty day bucket={"key":"2026-10-19","requests":0,"estimated_cost_usd":0,"failures":0,"fallbacks_used":0,"input_units":0,"output_units":0}; zero is valid, not unavailable.

## Accepted R34 implementation contract

Independent capabilities: ratingTarget?:{type:RatingTarget,id:UUID}; reportTarget?:{type:ReportTarget,id:UUID}. Render only supplied permitted capabilities after visibility verification.
Draft rating=roadmap_draft/roadmap_versions.id; draft/locked report=roadmap_content/roadmaps.id.
Merge rating=roadmap_merge/roadmap_merges.id. Topic rating AND report=topic_content/topics.id.
Quiz question report=quiz_question/quiz_questions.id only. Practice review report=practice_review/practice_reviews.id only.
Technology rating=technology_update/technology_updates.id only; mentor neither.
EP-F01/F02 validate owner/delivery/exposure; polymorphic IDs are not proof of access. Report enums must never be inferred from rating enums. Roadmap-content reports retain the chosen roadmap ID, not a version UUID. A hidden shared question/topic must still be reportable when the caller's stored attempt/roadmap shows prior exposure. Duplicate report=>409.

## Accepted R34 implementation contract

Screens12/15 add EP-F02 roadmap_content report action with roadmaps.id. Screen17 topic card supplies both topic_content capabilities. Screen18 supplies report only for question/review IDs. AIExplanationCard delegates feedback through these explicit capabilities and omits report for technology updates.

## Accepted N01 implementation contract

Screen13 data dependency: after EP-A13 effective_access.technology_update=true optionally call EP-T01. False means omit preview and make no gated fetch. Loading/generation_pending/no-change/unavailable/failure are card-local; they never block Today/roadmaps/progress. Card opens /tech-updates; existing EP-T03 marks actual viewing. Invalidate/clear preview when access changes.

## Accepted R16 implementation contract

Every screen inherits component responsive/keyboard behavior (§2), global auth/HTTP handling (§6), privacy-filtered telemetry (§7) and §4 query invalidation. Lists show labelled first-load skeletons; refresh keeps known data/filters. Empty filtered lists offer Clear filters. Failed mutations preserve server state and local edits.

| Screen | Required local behavior |
|---|---|
|14 Career Profile|No goals→explanation + Create goal to /onboarding/goal. Add goal uses same route/server cap. Discontinue confirms affected roadmap, then refreshes goals/roadmaps/Focus; failures preserve edits.|
|19 Progress|No evidence→explain quiz practice; no goal→Create goal; no filter match→Clear filters. Accessible EP-G02 drawer; source_attempt_id opens /quiz/{id}; null/expired sources show retained derived history without invented content.|
|23 Admin usage|API defaults for dates/selector; use C05 series; zero counts valid; no matching audit activity has an empty state. Range errors inline; retry aggregate-only.|
|24 Admin users|Search/status calls EP-AD01; reset cursor on changes; Clear filters on empty. Drawer EP-AD02. Confirm reason before EP-AD03, prevent repeat submission; reload list/detail/access on success; CANNOT_MODIFY_ADMIN preserves state.|
|25 Admin features|EP-AD04 global list; existing user search + EP-AD02 for user. Pessimistic toggles; success EP-AD05/06 reloads access. Override choices enabled/disabled/inherit(null); rejected save restores server value.|

Admin screens explicitly use AZ-ADMIN. Wide admin tables use labelled horizontally scrollable regions; inherit44px targets/focus/keyboard and responsive shell. No user search string, identifier or reason is telemetry. These are local states within existing screens, not additional routes.

## Accepted R28 implementation contract

Inventory:82 catalog entries,81 HTTP operations including GET /health,1 internal-only EP-G04. No POST /progress/evidence exists. Twelve UI service groups are not endpoint/controller counts; do not add endpoints to satisfy an old headline.

## Evidence scope and readiness (R21)

Evidence dimensions are separate: SPECIFIED; STATICALLY CHECKED (named method/evidence); IMPLEMENTED (repository/commit); EXECUTED (command/environment/result); ACCEPTED (review gate).
This correction pack provides specifications and finite static checks, not implemented software or a production certificate. Tests are defined, not passed. R32 remains NOT EXECUTED for database fresh install, rollback/reapply, pgTAP, deletion/RLS/retention/concurrency, API/UI/AI contracts, performance and PITR. C01 product scope remains frozen. Existing numerical latency/RPO/RTO and quality values are targets until measured. Agent review is not owner sign-off.

# END OF UI/UX SPECIFICATION DOCUMENT v2.0.2