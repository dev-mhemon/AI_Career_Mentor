# Component Inventory — AI Career Intelligence Mentor Platform

**Status:** Design-system architecture deliverable, derived from PRD v1.4.1 (Final Freeze) and UI/UX Specification v2.0.2
**Companion artifact:** `design-tokens.json` (W3C DTCG) + `design-tokens.audit.json` (WCAG verification record)
**Stack contract:** Next.js + TypeScript + React + Tailwind CSS (Spec §1)

---

## 1. How to read this inventory

Every component carries a **provenance marker**:

| Marker | Meaning |
|---|---|
| **SPEC** | Contracted in UI/UX Spec §2 (the 29 production components). Name, variants, states, and A11y rules are binding. |
| **DERIVED** | Referenced or visually required by Spec §3 screen contracts (e.g. "OAuth Buttons", "User Table", "Pagination controls") but with **no component-level contract**. This inventory supplies the missing contract; it requires design sign-off. |

Two significant gaps are flagged for sign-off before implementation:

1. **There is no Button contract in the spec.** Screens reference submit buttons, OAuth buttons, "Resend Cooldown" buttons, and a Primary CTA, but no variant/state/size contract exists. Section 6.1 supplies one.
2. **There is no Data Table contract.** Admin screens (23–25) require User Table, Audit Log Table, and a Global Feature Matrix, plus pagination and search/filter controls. Section 6.9 supplies one.

All token paths in this document resolve against `design-tokens.json`. Semantic colors are written as `{theme.<theme>.<path>}`; components consume the semantic layer only — never primitives directly.

**Path conventions in this document:**
- Semantic color refs (e.g. `action.primary.background`, `text.secondary`, `border.focus`, `feedback.danger.*`) are **theme-relative** — they resolve identically under `theme.light.*` and `theme.dark.*` because the two themes share the same 159 keys.
- A trailing `.*` selects the whole token group (e.g. `learning.*` = the four-key set `{background, border, text, dot}`).
- Non-color tokens always carry their full root (`dimension.space.4`, `typography.textStyle.body`, `shadow.md`, `zIndex.modal`, `motion.duration.normal`, `opacity.disabled`, `focusRing.width`).

---

## 2. Foundations snapshot

| Foundation | Value | Token path |
|---|---|---|
| Brand primary | Teal-cyan ramp, steps 50–950 | `color.primitive.primary.*` |
| Accent (AI surfaces) | Indigo ramp, steps 50–950 | `color.primitive.accent.*` |
| Neutrals | Warm slate ramp, steps 50–950 | `color.primitive.neutral.*` |
| Semantics | success / warning / danger / info, 11 steps each | `color.primitive.{success,warning,danger,info}.*` |
| Themes | `light` (default) and `dark`, 159 semantic keys each, key parity enforced | `theme.light.*`, `theme.dark.*` |
| Contrast | WCAG 2.1 AA — 82 usage pairs machine-verified, 0 failures | `design-tokens.audit.json` |
| Bangla-first type | Hind Siliguri → Noto Sans Bengali → Inter; mono JetBrains Mono (Spec §8) | `typography.fontFamily.sans` / `mono` |
| Type scale | 11 / 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48 px | `typography.fontSize.*` |
| Composite text styles | display → overline → code (15 styles) | `typography.textStyle.*` |
| Spacing | 4-px base grid, 0–96 | `dimension.space.*` |
| Radius | xs 2 → sm 4 → md 8 → lg 12 → xl 16 → full | `dimension.radius.*` |
| Border widths | 0 / 1 / 2 / 4 px | `dimension.borderWidth.*` |
| Elevation | xs → xl shadow composites | `shadow.*` |
| Focus ring | 2 px ring + 2 px offset, solid | `focusRing.*`, `theme.*.focus.ring` |
| Touch targets | 44×44 px minimum (Spec §2, WCAG 2.5.5) | `dimension.sizing.touch-target-min` |
| Breakpoints | 360 (mobile) / 768 (tablet, sidebar appears) / 1024+ (desktop 12-col) | `dimension.breakpoint.*` |
| Header / bottom nav | 64 px each | `dimension.sizing.header-height` / `bottom-nav-height` |
| Motion | 120 / 200 / 320 ms; suppressed under `prefers-reduced-motion` (Spec §8) | `motion.duration.*` |

---

## 3. Global interaction-state contract

All interactive components implement this vocabulary. Components add domain states on top (e.g. `saved_local`, `preparing`, `graded_review`). Two rules override everything: **state is never conveyed by color alone** (PRD §54, Spec §2 preamble), and **error states preserve valid user input** (PRD §8, Spec §6).

### 3.1 Common state treatments

| State | Treatment | Tokens |
|---|---|---|
| **Default** | Resting surface, 1 px border | `border.default`, `surface.default`, `text.primary` |
| **Hover** | Surface tint or border darken; pointer devices only (`@media (hover: hover)`) | `action.*.background-hover`, `action.secondary.border-hover` |
| **Focus-visible** | 2 px ring, 2 px offset; keyboard-triggered only; never removed | `focusRing.width/offset/style`, `theme.*.focus.ring`, `focus.ring-offset` |
| **Active / Pressed** | One step darker than hover | `action.*.background-active` |
| **Disabled** | Non-interactive, `aria-disabled` or `disabled`; 50% opacity reserved for icons only — text/border use dedicated tokens | `surface.disabled`, `text.disabled`, `border.disabled`, `opacity.disabled` |
| **Error / Invalid** | Danger border + icon + text message; `aria-invalid="true"`; `aria-describedby` points to message | `border.danger`, `text.danger`, `feedback.danger.*` |
| **Loading / Submitting** | Inline spinner + `aria-busy="true"`; label replaced with progress copy (e.g. "অ্যাকাউন্ট তৈরি হচ্ছে...") | `motion.duration.normal`, `text.secondary` |
| **Selected / Checked / On** | Brand fill or brand border + check/indicator mark | `action.primary.*`, `theme.*.text.brand` |

### 3.2 State coverage matrix (interactive families)

Columns: Default · Hover · Focus · Pressed · Disabled · Error · Loading · Selected. ● = required, ○ = not applicable.

| Family | D | H | F | P | X | E | L | S |
|---|---|---|---|---|---|---|---|---|
| Button | ● | ● | ● | ● | ● | ○ | ● | ○ |
| Icon Button | ● | ● | ● | ● | ● | ○ | ● | ○ |
| Input (all types) | ● | ○ | ● | ○ | ● | ● | ○ | ○ (filled/readonly instead) |
| Select / Combobox | ● | ● | ● | ● | ● | ● | ● | ○ |
| Checkbox | ● | ● | ● | ● | ● | ● | ○ | ● |
| ToggleSwitch | ● | ● | ● | ● | ● | ○ | ● (saving) | ● (on) |
| RadioCard | ● | ● | ● | ● | ● | ○ | ○ | ● |
| Tabs | ● | ● | ● | ○ | ● | ○ | ○ | ● (active) |
| Modal | ● | ○ | ● (trap) | ○ | ○ | ● | ● (submitting) | ○ |
| Toast | ● (enter) | ○ | ○ | ○ | ○ | ● (error variant) | ○ | ○ |
| Data Table row | ● | ● | ● | ○ | ○ | ○ | ● (skeleton) | ● (row select) |
| Pagination | ● | ● | ● | ● | ● | ○ | ○ | ● (current page) |
| Star Rating | ● | ● | ● | ○ | ● | ○ | ○ | ● |
| Chip / Tag | ● | ● | ● | ○ | ● | ○ | ○ | ● |
| Drawer | ● | ○ | ● (trap) | ○ | ○ | ● | ○ | ○ |

### 3.3 Domain-states carried from the Spec (not visual states)

`multi_step_form`: editing · autosaving · saved_local · submitting · network_error (Spec 09)
`job_polling`: queued · preparing · succeeded · failed_retryable (Spec 28, PRD §48)
`quiz`: unanswered · answered · i_dont_know · autosaving · graded_review (Spec 21)
`learning_state`: not_started · learning · practicing · proficient (PRD §34)
`merge`: proposed · large_expansion_warning · accepting · rejecting · undo_available (Spec 17)

---
## 4. Component specifications (Spec §2 — the 29 contracted components)

Format per component: **Variants** · **States** (visual/domain) · **Token bindings** · **A11y & behavior notes** · **Screens** (Spec §3 references). All are SPEC contracts; quality gates from Spec §2 apply (WCAG 2.1 AA, visible focus, 44 px targets, non-color-only status).

### 4.1 Navigation components (01–04)

#### 01 `Header` — SPEC
- **Variants:** `public`, `authenticated`, `admin`
- **States:** `default`, `focus_switching`, `offline_banner`
- **Token bindings:** height `dimension.sizing.header-height` (64); surface `theme.*.surface.default`; bottom divider `theme.*.border.default`; text `theme.*.text.primary`; z `zIndex.header`; sticky offset `zIndex.sticky`
- **Behavior:** sticky top; hidden "Skip to main content" link as first focusable; Focus Roadmap switcher `aria-haspopup="listbox"` + `aria-expanded`; language hint chip; account menu. `offline_banner` state renders the reconnection banner (PRD §54) — info styling `feedback.info.*`, never blocking.
- **Screens:** 01–25 (all), variant by zone: public (01–06), authenticated (07–22), admin (23–25)

#### 02 `Sidebar` — SPEC
- **Variants:** `expanded`, `collapsed`, `admin`
- **States:** `active_route`, `feature_disabled`, `suspended`
- **Token bindings:** width `dimension.sizing.sidebar-expanded` (256) / `sidebar-collapsed` (72); surface `theme.*.surface.default`; active item background `theme.*.action.ghost.background-hover`, text `theme.*.text.brand`, left indicator `theme.*.border.focus`; disabled item text `theme.*.text.disabled` + lock icon
- **Behavior:** visible `>= 768px` only (`md:flex`); `aria-current="page"` on active link; lock icon + `aria-label` suffix for `effectiveAccess[key] === false` (PRD §7 — read-only features remain navigable); `suspended` renders all normal items locked except Settings.
- **Screens:** 13–22, 23–25

#### 03 `BottomNavigation` — SPEC
- **Variants:** `learner_5_tab` (Today, Roadmap, Daily Plan, Progress, Mentor)
- **States:** `active_tab`, `today_ready_dot`, `disabled`
- **Token bindings:** height `dimension.sizing.bottom-nav-height` (64); surface `theme.*.surface.default`; top divider `theme.*.border.default`; active icon/label `theme.*.text.brand`; inactive `theme.*.text.secondary`; ready dot `theme.*.learning.learning.dot` + count text (never dot alone)
- **Behavior:** `< 768px` only (`md:hidden`); fixed bottom; each tab min 44×44; `role="navigation"` + `aria-label="Primary Mobile Navigation"`; safe-area inset padding.
- **Screens:** 13–22

#### 04 `StepIndicator` — SPEC
- **Variants:** `horizontal_labeled`, `compact_bar`
- **States:** `completed`, `current`, `upcoming`
- **Token bindings:** completed mark `theme.*.action.primary.background`; current `theme.*.text.brand` + 2 px underline `theme.*.border.focus`; upcoming `theme.*.text.muted`; connector line `theme.*.border.default`; numbers `typography.textStyle.label`
- **Behavior:** `role="progressbar"`, `aria-valuenow/min/max`; collapses labels to active title `< 640px`; completed steps clickable backwards only (onboarding never allows skipping ahead).
- **Screens:** 07–12 (5-step onboarding)

### 4.2 Form & feedback primitives (05–12)

#### 05 `Input` — SPEC
- **Variants:** `text`, `textarea`, `email`, `password`, `phone_bd`, `otp_6`
- **States:** `default`, `focused`, `filled`, `error`, `disabled`, `readonly`
- **Token bindings:** surface `theme.*.surface.default`; border `theme.*.border.strong`; focus border `theme.*.border.focus` + focus ring; error border `theme.*.border.danger` + `theme.*.text.danger` message; disabled surface `theme.*.surface.disabled`, text `theme.*.text.disabled`; radius `dimension.radius.md`; control height `dimension.sizing.control-lg` (48) on mobile, `control-md` (40) desktop; label `typography.textStyle.label`; body `body`
- **Variants detail:** `phone_bd` auto-normalizes `01[3-9]xxxxxxxx` → `+8801[3-9]xxxxxxxx` (PRD §10), `inputMode="tel"`; `otp_6` renders 6 boxes at `dimension.sizing.otp-box-width/height` (48×56), `inputMode="numeric"`, `autocomplete="one-time-code"` (Screen 04); `password` has visibility toggle with `aria-label`; `textarea` auto-grows with char counter (goal text 3–300).
- **A11y:** `htmlFor` label binding; `aria-invalid="true"` + `aria-describedby` → error text; errors announced; readonly distinguishable from disabled via surface, not opacity alone; `dir="auto"` for Bangla/English mixed input.
- **Screens:** 02–12, 14, 18, 20, 22, 24

#### 06 `Select` — SPEC
- **Variants:** `native_mobile`, `custom_dropdown`, `searchable_combobox`
- **States:** `closed`, `open`, `loading`, `error`, `disabled`
- **Token bindings:** trigger mirrors Input (border `border.strong`, focus ring); popover `surface.raised` + `shadow.md` + radius `md`; option hover `action.secondary.background-hover`; selected option text `text.brand` + check icon; option sublabel `typography.textStyle.caption`, `text.secondary`; empty-result text `text.muted`
- **Behavior:** full keyboard (↑ ↓ Enter Esc Home End); `role="combobox"`, `aria-expanded`, `aria-activedescendant`; `searchable_combobox` used for IANA timezone and skill tags, with `onSearch(query)`.
- **Screens:** 07, 08, 11, 19, 22 (timezone, career level, skill tags, progress filters)

#### 07 `Checkbox` — SPEC
- **Variants:** `standard`, `warning_callout`
- **States:** `unchecked`, `checked`, `indeterminate`, `error`, `disabled`
- **Token bindings:** box border `border.strong`; checked fill `action.primary.background`, mark `action.primary.foreground`; error border `border.danger`; `warning_callout` variant uses `feedback.warning.*` container (used for `acknowledge_large_expansion`, `acknowledge_stale`)
- **Behavior:** 44×44 tap area; `aria-checked="mixed"` for indeterminate; the `acknowledge_large_expansion` instance gates the Accept Merge button (Spec §5).
- **Screens:** 03 (privacy consent), 12 (`acknowledge_stale`), 15 (`acknowledge_large_expansion`)

#### 08 `ToggleSwitch` — SPEC
- **Variants:** `standard`, `beginner_none`, `admin_override`
- **States:** `on`, `off`, `saving`, `disabled`
- **Token bindings:** off track `color.primitive.neutral.300`/dark `color.primitive.neutral.600`; on track `action.primary.background`; thumb `color.primitive.static.white`/dark `color.primitive.neutral.50`; `saving` → `aria-busy` + reduced-salience track `opacity.muted`
- **Behavior:** `role="switch"`, `aria-checked`; `beginner_none` variant carries explanatory copy and mutual exclusion with skill tags (PRD §14: enabling clears tags; adding a tag flips it off); `admin_override` shows inherit state (null) via indeterminate visual + label.
- **Screens:** 08 (`existing_skills_none`), 25 (global + per-user feature flags)

#### 09 `MultiStepFormWrapper` — SPEC
- **Variants:** `onboarding_wizard`, `quiz_session`
- **States:** `editing`, `autosaving`, `saved_local`, `submitting`, `network_error`
- **Token bindings:** `saved_local` chip `feedback.success.*` subdued; `network_error` banner `feedback.warning.*`; `submitting` overlay `surface.overlay` + `opacity.overlay`
- **Behavior:** persists drafts to `sessionStorage` under `storageKey` (PRD §54); `saved_local` shows "ড্রাফট সংরক্ষিত (Saved locally)"; restores via `onRestoreDraft()`; never loses text on 502/503/504 (Spec §6). `quiz_session` variant pairs with per-answer debounced autosave (EP-Q04).
- **Screens:** 07–12, 18

#### 10 `Modal` — SPEC
- **Variants:** `confirm`, `hours_prompt`, `destructive_delete`, `report_dialog`
- **States:** `open`, `submitting`, `error`, `closed`
- **Token bindings:** surface `surface.raised`; overlay `surface.overlay`; radius `dimension.radius.xl`; shadow `shadow.xl`; z `zIndex.modal`; destructive confirm button uses `action.destructive.*`; title `typography.textStyle.heading-sm`; body `typography.textStyle.body`
- **Behavior:** focus trap (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`); Esc closes unless `submitting`; focus returns to invoker on close; `< 640px` renders as bottom sheet (slide-up, `motion.duration.slow`, drag handle); `destructive_delete` requires literal `DELETE` typed (`requireLiteral: 'DELETE'`, Screen 22); `hours_prompt` contains a numeric Input 0.5–12.0 step 0.5.
- **Screens:** 08 (alias clarification), 12 (lock + hours), 14 (discontinue goal), 15 (request change / level change), 16 (rebuild hours), 18 (confirm unanswered), 22 (delete account), 24 (suspend with reason), 29-instances of `report_dialog` across 17/18/21

#### 11 `Toast` — SPEC
- **Variants:** `info`, `success`, `warning`, `error_retryable`
- **States:** `entering`, `visible`, `countdown`, `dismissed`
- **Token bindings:** container per variant `feedback.{info|success|warning|danger}.*`; live countdown text `typography.textStyle.label` in mono tabular numerals; z `zIndex.toast`
- **Behavior:** `role="status"` + `aria-live="polite"`; errors use `role="alert"`; `countdown` renders second-by-second when `retryAfterSeconds` present (423/429, PRD §53); `error_retryable` shows Retry action; auto-dismiss paused while focused; max one stacked visible (newest replaces), except a rate-limit countdown which persists until expiry.
- **Screens:** 02, 04–06, 10–12, 18, 20, 22

#### 12 `Tabs` — SPEC
- **Variants:** `underline`, `segmented_pill`
- **States:** `active`, `inactive`, `disabled`
- **Token bindings:** `underline`: active text `text.primary` + 2 px bar `border.focus`, inactive `text.secondary`; `segmented_pill`: container `surface.sunken`, active thumb `surface.raised` + `shadow.xs`; counts `typography.textStyle.caption`
- **Behavior:** `role="tablist"` / `role="tab"` / `aria-selected` / `role="tabpanel"`; ← → Home End keyboard; horizontal scroll on mobile without clipping (`scroll-snap-type: x`), edge fade masks.
- **Screens:** 03 (Email|Phone signup), 15 (Active | Level Outline | Merge Proposals | Version History), 19 (Overview | Shared Skills | Weak Areas | History)

### 4.3 Career domain (13–15)

#### 13 `CareerCard` — SPEC
- **Variants:** `clarifying`, `awaiting_confirmation`, `confirmed`, `discontinued`
- **States:** `default`, `answering`, `confirming`, `error`
- **Token bindings:** card `surface.default` + `border.default` + `shadow.xs` + `dimension.radius.lg`; round counter chip (`1/2`, `2/2`) `feedback.info.*`; canonical role name `typography.textStyle.heading-sm`; level selector chips Junior/Mid/Senior — selected `priority.core.*` treatment; `discontinued` → `diff.retired.*` styling with strikethrough-off (avoid line-through on Bangla), badge "বন্ধ / Discontinued"
- **Behavior:** shows clarification prompt, `alternative_roles` list, and `suggested_level`; explicit user confirm of level is mandatory before lock (PRD §18); stacks actions vertically `< 640px`; ambiguity-cap copy at round 2 ("best interpretation — please confirm", PRD §15).
- **Screens:** 11 (onboarding clarify), 14 (career profile)

#### 14 `SkillCard` — SPEC
- **Variants:** `profile_skill`, `roadmap_skill`, `weak_area`, `alias_clarification`
- **States:** `self_reported`, `evidence_backed`, `unresolved_alias`
- **Token bindings:** card base as CareerCard; state chip via `learning.*` tokens; "Shared across N roadmaps" badge `ai.surface`/`ai.text` with link icon; `unresolved_alias` → `feedback.warning.*` inline banner + resolve action; depth line `typography.textStyle.caption`, `text.secondary`
- **Behavior:** shows `required_depth` for the current roadmap context (PRD §17); `onResolveAlias` opens `Modal` (Spec 10); `weak_area` variant surfaces evidence summary link (EP-G02).
- **Screens:** 08, 14, 19

#### 15 `SkillBadge` — SPEC
- **Variants:** `priority` (core | supporting | optional), `gap_type` (existing | transferable | refresh | strengthen | missing)
- **States:** `active`, `retired`
- **Token bindings:** priority → `priority.{core|supporting|optional}.*`; gap → `gap.{existing|transferable|refresh|strengthen|missing}.*`; retired → `diff.retired.*` + `opacity.muted`
- **Behavior:** **always** icon + text label (e.g. "Core / মূল") — never color alone (PRD §54); pill radius `dimension.radius.full`; size sm; truncation never hides the label text, wraps instead.
- **Screens:** 12, 15, 19

### 4.4 Roadmap domain (16–18)

#### 16 `RoadmapPhaseCard` — SPEC
- **Variants:** `draft`, `locked`, `level_outline`
- **States:** `expanded`, `collapsed`, `stale_warning`
- **Token bindings:** header surface `surface.subtle`; chevron `text.secondary`; effort helper text `caption` + `text.muted`; `stale_warning` banner `feedback.warning.*`; `level_outline` variant at `opacity.muted` with "outline only" chip; retired items hidden
- **Behavior:** collapsible (`aria-expanded` + `aria-controls`); shows `estimated_effort_hours` with mandatory disclaimer "আনুমানিক সময় — গ্যারান্টি নয় (Guidance only)" (PRD §20); draft variant read-only — no drag/reorder handles (PRD §21 forbids manual structure editing).
- **Screens:** 12 (draft), 13 (summary), 15 (locked/outline)

#### 17 `RoadmapDiffViewer` — SPEC
- **Variants:** `user_request`, `level_change`, `ai_proposal`
- **States:** `proposed`, `large_expansion_warning`, `accepting`, `rejecting`, `undo_available`
- **Token bindings:** diff rows `diff.{added|updated|reprioritized|retired}.*`; row prefix glyphs `+ ~ ↑ -` in mono; size-impact meter `chart.series-1` vs `chart.grid`; warning container `feedback.warning.*`; undo button `action.secondary.*`
- **Behavior:** four diff classes always carry icon + prefix + label (never color alone); shows `daily_plan_impact` (`completed_days_unchanged` vs `future_days_affected`) as two labeled stats; `large_expansion_warning` disables Accept until Checkbox ack (Spec §5); `undo_available` shows "সর্বশেষ পরিবর্তন বাতিল করুন (Undo Last Merge)" and hides instantly when a post-merge quiz starts (EP-Q03).
- **Screens:** 15

#### 18 `MilestoneCard` — SPEC
- **Variants:** `phase_milestone`
- **States:** `pending`, `in_progress`, `completed`
- **Token bindings:** progress bar `learning.proficient.dot` fill on `chart.grid` track; labels `label`; completed check `color.primitive.success.*`; pending `color.primitive.neutral.*`
- **Behavior:** accessible `<progress>` semantics with text equivalent ("3 / 7 topics"); encouraging copy only — no employment guarantees, no trophy imagery (PRD §36).
- **Screens:** 15
### 4.5 Learning & assessment domain (19–22)

#### 19 `DailyTaskCard` — SPEC
- **Variants:** `today_hero`, `plan_day_row`
- **States:** `pending`, `in_progress`, `completed`, `preparing`
- **Token bindings:** `today_hero` uses `surface.raised` + `shadow.md` + left accent bar `border.focus`; day number chip `color.primitive.neutral.100` / dark `color.primitive.neutral.800`; completed chip `learning.proficient.*`; `preparing` shows `AILoadingState` inline; CTA inside hero uses Button primary
- **Behavior:** sequential "Day N (দিন N)" labels — never calendar dates (PRD §27: missed days never skip content); `plan_day_row` shows topic title, state icon, duration hint; whole row is the hit target (min 44 px height); completed rows are navigable to history.
- **Screens:** 13 (`today_hero`), 16 (`plan_day_row`), 17 (`today_hero`)

#### 20 `LearningResourceCard` — SPEC
- **Variants:** `official_docs`, `release_notes`, `article`, `standard`, `video`
- **States:** `default`, `visited`
- **Token bindings:** type icon per variant colored from `info`/`primary`/`neutral` sets (icon + label "Official docs / অফিসিয়াল ডকুমেন্টেশন"); publisher + `retrieved_at` in `caption`/`text.muted`; external-link glyph `text.secondary`
- **Behavior:** `target="_blank" rel="noopener noreferrer"` plus screen-reader "opens in new tab" announcement; `visited` state at `opacity.muted` on the icon only; shows source attribution required by PRD §41.
- **Screens:** 17, 12 (sources per topic)

#### 21 `QuizCard` — SPEC
- **Variants:** `mcq`, `free_response` (sql | code | config | test_case | debug | command | design | text)
- **States:** `unanswered`, `answered`, `i_dont_know`, `autosaving`, `graded_review`
- **Token bindings:** option row default `surface.default` + `border.default`; hover `action.secondary.background-hover`; selected `action.ghost.background-hover` + `border.focus` + radio/check mark; `i_dont_know` row dashed `border.strong`; graded correct `feedback.success.*`, graded incorrect `feedback.danger.*` + not just color: ✓/✗ icon + label; explanation panel `surface.subtle`; code textarea `typography.textStyle.code-block`, mono, line-number gutter on `surface.sunken`, radius `md`
- **Behavior:** mixed Bangla/English/Mixed input supported in all text answers; explicit "জানি না (I don't know)" action (PRD §29); **no code execution** — code/SQL editors are plain text areas with syntax font, tab-key inserts two spaces, line count indicator (PRD §29, non-goal §58); answer edits trigger debounced autosave indicator "সংরক্ষিত হচ্ছে…"; `graded_review` locks input, shows correct answer + explanation + report action; question counter "প্রশ্ন 7 / 25" persistent.
- **Screens:** 18

#### 22 `PracticeReviewCard` — SPEC
- **Variants:** `rubric_feedback`
- **States:** `pending`, `reviewed`, `failed_retryable`, `not_evidence`
- **Token bindings:** card `ai.surface` + `ai.border` (AI-generated content framing); verdict chip Good → `feedback.success.*`, Needs Work → `feedback.warning.*`; three dimension rows (correctness, understanding, reasoning) as labeled meters `chart.series-1`; strengths list ✓ `color.primitive.success.*`, mistakes ✗ `color.primitive.danger.*`, weaknesses `color.primitive.warning.*`; improvement list `color.primitive.info.*`; `not_evidence` notice `color.primitive.neutral.*` with explanatory copy
- **Behavior:** labeled "AI Practice Review (অনুশীলন পর্যালোচনা)" — never "assessment" (PRD §31, §61); `failed_retryable` shows Retry (EP-PR03) + Report scoring; `not_evidence` explains junk/non-answer detection without shaming copy; performance level shown as text, no percentage pass/fail (PRD §35).
- **Screens:** 18

### 4.6 Progress domain (23–24)

#### 23 `SkillProgressBadge` — SPEC
- **Variants/states:** exactly the four learning states — `not_started`, `learning`, `practicing`, `proficient`
- **Token bindings:** `learning.{state}.background|border|text|dot`
- **Behavior:** **never** "Job Ready", never pass/fail %, never gamified tier (PRD §34–§36); always shows state name in Bangla+English ("শিখছি / Learning") plus the dotted icon; pairs with `careerLevel` label (Junior/Mid/Senior) so the same skill at two levels is unambiguous; `updated_with_reason` adds "কেন?" (why) affordance opening state reason (PRD §35).
- **Screens:** 13, 19

#### 24 `ProgressHistoryCard` — SPEC
- **Variants:** `state_change`, `evidence_added`
- **States:** `default`
- **Token bindings:** timeline rail `border.default`; node colored by destination state (`learning.*`); from→to rendered as two badges with arrow glyph (not color alone); `occurred_at` `caption`/`text.muted`; reason block `surface.subtle`, `body-sm`
- **Behavior:** shows `from_state → to_state`, `career_level`, timestamp, and AI `reason` (PRD §35, EP-G03); `onOpenSourceAttempt(sourceId)` navigates to source; null/expired source shows retained derived evidence without invented content (Spec R16); no trophy/badge/confetti imagery.
- **Screens:** 19

### 4.7 AI domain (25–29)

#### 25 `AIExplanationCard` — SPEC
- **Variants:** `topic_explanation`, `technology_update`
- **States:** `ready`, `preparing`, `no_important_changes`, `temporarily_unavailable`
- **Token bindings:** `topic_explanation` body on `surface.default` with `body-lg`; section headings `typography.textStyle.heading-sm`; inline code `surface.sunken` + mono; blockquote/Q&A `surface.subtle` + left rule `border.strong`; `technology_update` variant adds metadata chips — `release.{status}.*` and `timing.{action}.*` and `relevance.{level}.*`; publisher/`fetched_at` in `caption`
- **Behavior:** renders mixed Bangla-English Markdown + code blocks; tech-update header shows publisher, fetch time, release status, relevance, action timing (PRD §41–§43); `no_important_changes` renders the exact copy "No important changes for your current learning path today." with a calm illustration slot; `temporarily_unavailable` renders "Technology updates are temporarily unavailable." + Retry where retryable; `preparing` embeds AILoadingState; delegates rating/report to AIFeedbackComponent capabilities (Spec R34).
- **Screens:** 12 (roadmap summary context), 13 (update preview), 17 (topic), 21 (tech updates)

#### 26 `AIRecommendationCard` — SPEC
- **Variants:** `roadmap_summary`, `optional_merge_banner`
- **States:** `default`, `dismissed`
- **Token bindings:** `ai.surface`/`ai.border` frame; sparkle/AI icon `ai.icon`; rationale text `body`; "why this?" disclosure `text.link`; merge banner border-left 4 px `border.info`, dismiss `text.muted`
- **Behavior:** explains *why* the AI recommended a path (PRD §26); merge banner explicitly marked "optional suggestion — requires your acceptance" (PRD §21); dismissed state collapses to a one-line "AI suggestion dismissed — undo" affordance; never auto-applies anything.
- **Screens:** 12, 15

#### 27 `AIChatMessage` — SPEC
- **Variants:** `user`, `assistant`, `safety_redirection`
- **States:** `sending`, `sent`, `failed_retryable`
- **Token bindings:** user bubble `action.primary.background` + `action.primary.foreground`, radius `dimension.radius.lg` (bottom-right `dimension.radius.xs`); assistant bubble `surface.raised` + `border.default`; `sending` → three-dot pulse `text.muted`; `failed_retryable` → inline error strip `feedback.danger.*` + Retry; `learningClaimRecorded` info note `feedback.info.*` with lightning-off icon; `safetyMode` card `feedback.warning.*` (calm, non-alarming) + support resources
- **Behavior:** preserves Bangla/English/Mixed formatting incl. code fences; the "I studied this" note states claims are chat context only, quiz needed for progress (PRD §37); safety mode copy is supportive, non-clinical, redirects appropriately (PRD §37); timestamp + delivery state on long-press; message content never enters telemetry (Spec §7).
- **Screens:** 20

#### 28 `AILoadingState` — SPEC
- **Variants:** `inline_banner`, `full_section_skeleton`
- **States:** `queued`, `preparing`, `succeeded`, `failed_retryable`
- **Token bindings:** skeleton blocks `skeleton.base` shimmering to `skeleton.highlight` (1.6 s loop, disabled under reduced motion); status text `body-sm`/`text.secondary`; progress hint chip `feedback.info.*`; retry button secondary
- **Behavior:** non-blocking `Preparing` state (PRD §48); polls `GET /api/v1/jobs/{id}` at `retry_after_seconds`; `aria-busy="true"` on container; navigation away never cancels or blocks; skeleton count matches expected content shape to prevent layout shift; `failed_retryable` shows what was preserved ("Your information has been saved", PRD §46).
- **Screens:** 12, 13, 15, 17, 18, 21

#### 29 `AIFeedbackComponent` — SPEC
- **Variants:** `rating_1_5`, `report_button`, or both — capabilities rendered independently per target
- **States:** `idle`, `modal_open`, `submitting`, `submitted`, `already_reported`
- **Token bindings:** stars filled `rating.filled`, empty `rating.empty`, hover `rating.hover`; star ≥ 24 px glyph in 44 px hit area; report icon `text.secondary` → `text.danger` on hover; submitted confirmation `feedback.success.*`
- **Behavior:** **per-target capability matrix is binding** (PRD §24, Spec R34): topic content → rating + report; roadmap draft/merge → rating (via mapped target); quiz question + practice review → report only; technology update → rating only; mentor → neither. `already_reported` → disabled "রিপোর্ট করা হয়েছে" state.
- **Screens:** 12, 15, 17, 18, 21
## 5. Component inventory summary (all 29 SPEC components)

| # | Component | Family | Variants | Interaction states | Domains served | Screens |
|---|---|---|---|---|---|---|
| 01 | Header | Navigation | public, authenticated, admin | default, focus_switching, offline_banner | all | 25 |
| 02 | Sidebar | Navigation | expanded, collapsed, admin | active_route, feature_disabled, suspended | all | 13 |
| 03 | BottomNavigation | Navigation | learner_5_tab | active_tab, today_ready_dot, disabled | learning | 10 |
| 04 | StepIndicator | Navigation | horizontal_labeled, compact_bar | completed, current, upcoming | onboarding | 6 |
| 05 | Input | Form | text, textarea, email, password, phone_bd, otp_6 | default, focused, filled, error, disabled, readonly | auth, profile, quiz, settings | 15 |
| 06 | Select | Form | native_mobile, custom_dropdown, searchable_combobox | closed, open, loading, error, disabled | profile, filters | 5 |
| 07 | Checkbox | Form | standard, warning_callout | unchecked, checked, indeterminate, error, disabled | auth, roadmap | 3 |
| 08 | ToggleSwitch | Form | standard, beginner_none, admin_override | on, off, saving, disabled | profile, admin | 2 |
| 09 | MultiStepFormWrapper | Form | onboarding_wizard, quiz_session | editing, autosaving, saved_local, submitting, network_error | onboarding, quiz | 7 |
| 10 | Modal | Feedback | confirm, hours_prompt, destructive_delete, report_dialog | open, submitting, error, closed | all | 10 |
| 11 | Toast | Feedback | info, success, warning, error_retryable | entering, visible, countdown, dismissed | all | 12 |
| 12 | Tabs | Navigation | underline, segmented_pill | active, inactive, disabled | auth, roadmap, progress | 3 |
| 13 | CareerCard | Career | clarifying, awaiting_confirmation, confirmed, discontinued | default, answering, confirming, error | goals | 2 |
| 14 | SkillCard | Career | profile_skill, roadmap_skill, weak_area, alias_clarification | self_reported, evidence_backed, unresolved_alias | skills | 3 |
| 15 | SkillBadge | Career | priority, gap_type | active, retired | roadmap | 3 |
| 16 | RoadmapPhaseCard | Roadmap | draft, locked, level_outline | expanded, collapsed, stale_warning | roadmap | 3 |
| 17 | RoadmapDiffViewer | Roadmap | user_request, level_change, ai_proposal | proposed, large_expansion_warning, accepting, rejecting, undo_available | merge | 1 |
| 18 | MilestoneCard | Roadmap | phase_milestone | pending, in_progress, completed | roadmap | 1 |
| 19 | DailyTaskCard | Learning | today_hero, plan_day_row | pending, in_progress, completed, preparing | daily plan | 3 |
| 20 | LearningResourceCard | Learning | official_docs, release_notes, article, standard, video | default, visited | learning | 2 |
| 21 | QuizCard | Assessment | mcq, free_response(×8 kinds) | unanswered, answered, i_dont_know, autosaving, graded_review | quiz | 1 |
| 22 | PracticeReviewCard | Assessment | rubric_feedback | pending, reviewed, failed_retryable, not_evidence | AI review | 1 |
| 23 | SkillProgressBadge | Progress | not_started, learning, practicing, proficient | default, updated_with_reason | progress | 2 |
| 24 | ProgressHistoryCard | Progress | state_change, evidence_added | default | progress | 1 |
| 25 | AIExplanationCard | AI | topic_explanation, technology_update | ready, preparing, no_important_changes, temporarily_unavailable | learning, updates | 4 |
| 26 | AIRecommendationCard | AI | roadmap_summary, optional_merge_banner | default, dismissed | roadmap, AI | 2 |
| 27 | AIChatMessage | AI | user, assistant, safety_redirection | sending, sent, failed_retryable | mentor | 1 |
| 28 | AILoadingState | AI | inline_banner, full_section_skeleton | queued, preparing, succeeded, failed_retryable | jobs | 6 |
| 29 | AIFeedbackComponent | AI | rating_1_5, report_button, both | idle, modal_open, submitting, submitted, already_reported | feedback | 5 |

Distinct variant count: **77** · distinct state count across families: **84**

---

## 6. Gap components — DERIVED contracts (spec-referenced but uncontracted)

These appear in screen contracts or are structurally unavoidable, but §2 gives them no contract. Each follows the global state vocabulary in §3. **Requires design sign-off.**

### 6.1 Button — DERIVED (highest priority gap)
Referenced everywhere: "Submit Button", OAuth buttons, "Resend Cooldown Button", Primary CTA (Screens 02–06, 10, 12, 16–18, 22, 24). No contract exists.

- **Variants:** `primary`, `secondary` (outline), `ghost` (tertiary), `destructive`, `oauth` (Google/Facebook brand buttons), `link`
- **Sizes:** `sm` (32 px), `md` (40 px), `lg` (48 px mobile default)
- **States:** default, hover, focus-visible, active, disabled, loading, full-width (layout modifier)
- **Token bindings:** primary → `action.primary.*`; secondary → `action.secondary.*`; ghost → `action.ghost.*`; destructive → `action.destructive.*`; radius `dimension.radius.md`; label `typography.textStyle.label-lg`; icon gap `dimension.space.2`; loading spinner `currentColor` with label swapped to progress copy
- **A11y:** native `<button>`; never icon-only without `aria-label`; loading sets `aria-busy` and blocks double-submit; min hit area 44 px (use pseudo-element expansion when visual size is sm/md).
- **OAuth variant note:** uses provider-mandated branding (Google "G" four-color mark, Facebook blue `#1877F2` container) with a neutral `border.strong` frame; provider marks are the single documented exception to the brand palette.

### 6.2 IconButton — DERIVED
Dismiss toasts, close modals/drawers, password visibility, overflow menus.

- **Variants:** `ghost`, `outline`, `danger`
- **States:** global vocabulary; always `aria-label`; 44×44 target; icon 20–24 px.
- **Tokens:** `action.ghost.*` default; danger → `text.danger`.

### 6.3 RadioCard — DERIVED (Screen 09)
Four selectable learning-preference cards (`reading`, `hands_on`, `visual`, `mixed`), `role="radiogroup"`.

- **States:** unselected, hover, focus-visible, selected, disabled
- **Tokens:** unselected `surface.default` + `border.strong`; selected `action.ghost.background-hover` fill + 2 px `border.focus` + check mark `action.primary.background`; 1-col mobile, 2×2 `>= 1024px` (Screen 09).

### 6.4 SearchInput — DERIVED (Screens 08, 19, 24, 25)
Extends Input: leading search icon, clear button, debounce `300ms`, `role="searchbox"`, `aria-label` per context ("Search users", "Search skills"). Results-count announcement via polite live region.

### 6.5 Pagination — DERIVED (Screen 16, admin tables)
"Pagination controls" named for Daily Plan; cursor-based in admin APIs.

- **Variants:** `numbered` (client lists), `cursor` (Prev/Next + page-size select for admin)
- **States:** current page (`action.primary.*` fill), disabled prev/next, focus ring; `aria-current="page"`.
- **Tokens:** `dimension.sizing.control-md`; gap `dimension.space.1`.

### 6.6 FilterPills — DERIVED (Screen 21: All | High Relevance | Unread)
Single-select segmented chips distinct from Tabs (no panel semantics).

- **States:** selected `priority.core.*`, unselected `surface.default` + `border.default`; `aria-pressed`.

### 6.7 UserTable / DataTable — DERIVED (Screens 23–25)
Admin-only. Covers User Table, Audit Log Table, and Global Feature Matrix.

- **Variants:** `default`, `dense` (audit logs), `matrix` (feature rows)
- **States:** row hover `action.secondary.background-hover`; selected row `action.ghost.background-hover`; skeleton first load (Spec R16 — labelled skeleton, refresh keeps known data); empty filtered → "Clear filters" action; error inline + retry aggregate-only (R16 Screen 23)
- **Tokens:** header `surface.subtle` + `label`/`text.secondary`; row divider `border.subtle`; numeric cells `typography.textStyle.code` tabular; sticky header `zIndex.sticky`; horizontal scroll wrapper with `role="region"` + `aria-label` + `tabindex="0"` (R16 wide admin tables).
- **A11y:** semantic `<table>` with `scope="col"`; sort buttons `aria-sort`; row actions keyboard reachable.

### 6.8 Drawer — DERIVED (Screens 20, 24)
Conversation list drawer (mobile mentor), User Detail Drawer (admin).

- **Variants:** `side_sheet` (right, desktop admin), `bottom_sheet` (mobile, shares Modal behavior)
- **States:** open/closed/submitting; focus trap; Esc close; `aria-modal`; overlay `surface.overlay`; z `zIndex.drawer`.

### 6.9 StarRating — DERIVED
The 1–5 control inside `AIFeedbackComponent` variant `rating_1_5`.

- **States:** idle, hover preview, selected, submitted, disabled
- **Tokens:** `rating.filled|empty|hover`; 44 px hit targets; `role="radiogroup"` with "১–৫ এর মধ্যে রেট করুন" labeling; numeric value announced; comment box optional except where target requires (roadmap mapping per R34).

### 6.10 Chip / Tag — DERIVED (Screens 08, 10)
Skill tags and example-role chips.

- **Variants:** `removable` (skill tag, Backspace/Delete with `aria-label="Remove skill"` — Screen 08), `suggestion` (example role chips, tappable), `static`
- **States:** default `surface.sunken`, hover `border.strong`, focus ring; remove icon 44 px target zone.

### 6.11 EmptyState — DERIVED
Every list/filter in R16 needs one: no goals, no evidence, no filter match, no audit activity.

- **Variants:** `first_use` (explanation + primary CTA), `no_results` (Clear filters), `feature_off` (calm informational, e.g. tech updates OFF screen)
- **Tokens:** illustration slot `color.primitive.neutral.200` line art; title `typography.textStyle.heading-sm`; body `typography.textStyle.body-sm`/`text.secondary`; CTA Button.

### 6.12 ContextPill — DERIVED (Screen 20)
Mentor chat context indicator (`focus_roadmap | topic | general`).

- **States:** default, switching; `ai.surface`/`ai.text` pill + context icon; `aria-label` describes active context.

### 6.13 IdentityLinkingCard — DERIVED (Screen 22)
Google / Facebook / Phone / Email linking cards with linked/unlinked/verifying states.

- **States:** unlinked (`action.secondary.*`), linked (`gap.existing.*` + check), verifying (spinner), error (`feedback.danger.*`); shows masked identifier (`contact_masked`, R18 — never full PII).

### 6.14 AggregateMetricCard — DERIVED (Screen 23)
Admin usage KPIs with `group_by(day|feature|provider)` selector.

- Numeric value `typography.textStyle.heading-lg` tabular-mono; delta chip `feedback.*`; zero values render `0` explicitly (R30: zero is valid, not unavailable); sparkline optional using `chart.series-1`.

### 6.15 Avatar / AccountMenu — DERIVED (Header 01 composition)
Initials avatar with menu (`onOpenSettings`, `onLogout`); `aria-haspopup="menu"`; menu items 44 px rows.

### 6.16 SkipLink — DERIVED
Named explicitly in Header contract ("Skip to main content"): visually hidden until focused, then `action.primary.background` fill; first tab stop on every page.

### 6.17 OfflineBanner — DERIVED
Header state `offline_banner`; full-width strip below header; `feedback.warning.*`; `role="status"`; reconnect → success flash then dismiss (PRD §54; no offline learning mode).

---

## 7. Feature → Screen → Component traceability (PRD §6, all 20 features)

Legend: ● primary surface · ○ supporting · — absent

| # | PRD Feature | Screens | Primary components | Supporting |
|---|---|---|---|---|
| 1 | Registration & Authentication | 02–06 | Input(05), Button(6.1), Toast(11) | Header(01), Tabs(12), Checkbox(07), Modal(10) |
| 2 | User Profile | 07, 14 | Input(05), Select(06), MultiStepFormWrapper(09) | ToggleSwitch(08), SkillCard(14), Modal(10), Button |
| 3 | Dynamic Technology Career Goals | 10, 11, 14 | CareerCard(13), Input(05) | StepIndicator(04), Toast(11), Modal(10), Chip(6.10) |
| 4 | Multiple Career Roadmaps | 13, 14, 15 | RoadmapPhaseCard(16), Header switcher(01) | Tabs(12), Modal(10), EmptyState(6.11) |
| 5 | Shared Skill System | 08, 14, 19 | SkillCard(14), SkillBadge(15) | Modal(10), Tabs(12), Select(06) |
| 6 | AI-Generated Career Knowledge | 11, 12 | AIRecommendationCard(26), AILoadingState(28) | CareerCard(13), RoadmapPhaseCard(16) |
| 7 | Roadmap Draft, Lock & Merge | 12, 15 | RoadmapDiffViewer(17), RoadmapPhaseCard(16), Checkbox(07) | Modal(10), AIRecommendationCard(26), Toast(11), AIFeedbackComponent(29), Button |
| 8 | Career Levels J/M/S | 11, 15, 19 | CareerCard(13) level selector, SkillProgressBadge(23) | Tabs(12) Level Outline, RoadmapDiffViewer(17) |
| 9 | Daily Learning Plan | 16 | DailyTaskCard(19), Pagination(6.5) | Modal(10), EmptyState(6.11) |
| 10 | Daily Topic / Today | 17 | DailyTaskCard(19), AIExplanationCard(25) | LearningResourceCard(20), AILoadingState(28), Button CTA |
| 11 | Daily Practice Quiz | 18 | QuizCard(21), MultiStepFormWrapper(09) | Modal(10), Toast(11), Progress indicator |
| 12 | AI Practice Review | 18 | PracticeReviewCard(22) | AILoadingState(28), AIFeedbackComponent(29) |
| 13 | Learning Progress Tracking | 19 | SkillProgressBadge(23), ProgressHistoryCard(24), SkillCard(14) | Tabs(12), Select(06), Drawer(6.8), EmptyState |
| 14 | AI Career Mentor Chat | 20 | AIChatMessage(27) | ContextPill(6.12), Drawer(6.8), Toast(11), Input composer |
| 15 | Personalized Daily Tech Update | 21 | AIExplanationCard(25), AIFeedbackComponent(29) | FilterPills(6.6), EmptyState(6.11 — feature_off) |
| 16 | User Account Deletion | 22 | Modal(10, destructive_delete) | Input(05), Button(6.1), IdentityLinkingCard(6.13), Toast(11) |
| 17 | Admin User Management | 24 | DataTable(6.7), Drawer(6.8) | SearchInput(6.4), Modal(10), Tabs(12) |
| 18 | Global Feature Controls | 25 | ToggleSwitch(08, admin_override), DataTable(6.7 matrix) | SearchInput(6.4), EmptyState(6.11) |
| 19 | Per-User Feature Controls | 25 | ToggleSwitch(08), Drawer(6.8) | DataTable(6.7), SearchInput(6.4) |
| 20 | AI Usage & Failure Controls | 12–21 passthrough, 23 | AILoadingState(28), Toast(11) | AIExplanationCard(25) states, AggregateMetricCard(6.14) |

### 7.1 PWA / Resilience cross-cutting requirements

Preserved unsaved input (`MultiStepFormWrapper` + `sessionStorage`), offline banner (Header state), retryable error toasts with preserved state (Spec §6), reduced-motion variants for every animation, and Bangla-first typography with English technical terms inline — these apply to **all** components above and are not repeated per row.

### 7.2 Guardrail checklist (enforced in component contracts)

| Guardrail | Where enforced |
|---|---|
| Never show "Job Ready" / employment guarantees | SkillProgressBadge(23), ProgressHistoryCard(24), MilestoneCard(18), AIExplanationCard(25) copy slots |
| Status never by color alone | SkillBadge(15), RoadmapDiffViewer(17), SkillProgressBadge(23), QuizCard(21) graded states |
| Effort estimates labeled as guidance | RoadmapPhaseCard(16) |
| No manual roadmap structure editing | RoadmapPhaseCard(16) — no drag handles |
| No code execution | QuizCard(21) code variants |
| AI content visibly attributed | AIRecommendationCard(26), AIExplanationCard(25), PracticeReviewCard(22) AI framing (`ai.*` tokens) |
| Rating/report capability matrix | AIFeedbackComponent(29) |
| Telemetry excludes content/PII | all interactive components (Spec §7) |
