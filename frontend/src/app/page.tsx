import Link from "next/link";
import type { SVGProps } from "react";
import { CheckCircleIcon, CheckIcon } from "@/components/ui/icons";

type IconProps = SVGProps<SVGSVGElement>;

const iconBase = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.85,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

function BrandGeometricMark(props: IconProps) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9L12 2.5Z" />
      <path d="M12 7v10" />
      <path d="m7.5 10.5 4.5-3.5 4.5 3.5" />
      <circle cx="12" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...iconBase} width={18} height={18} {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function LockIcon(props: IconProps) {
  return (
    <svg {...iconBase} width={13} height={13} {...props}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function SparkCompassIcon(props: IconProps) {
  return (
    <svg {...iconBase} {...props}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="15.5 8.5 13.4 13.4 8.5 15.5 10.6 10.6 15.5 8.5" />
    </svg>
  );
}

function ClockIcon(props: IconProps) {
  return (
    <svg {...iconBase} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ChartBarIcon(props: IconProps) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M4 19h16" />
      <path d="M7 16v-4" />
      <path d="M12 16V7" />
      <path d="M17 16v-6" />
    </svg>
  );
}

function GlobeMessageIcon(props: IconProps) {
  return (
    <svg {...iconBase} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9h17" />
      <path d="M3.5 15h17" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18" />
      <path d="M12 3a13.5 13.5 0 0 0 0 18" />
    </svg>
  );
}

function FlameStreakIcon(props: IconProps) {
  return (
    <svg {...iconBase} width={15} height={15} {...props}>
      <path d="M12 3c1.5 3 4.5 4.8 4.5 8.5a4.5 4.5 0 1 1-9 0c0-1.9.9-3.6 2-5 .3 1.4 1.2 2.2 2 2.4C11 6.7 11.4 4.7 12 3Z" />
    </svg>
  );
}

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#preview", label: "Interactive Preview" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#tracks", label: "Career Tracks" },
];

const heroMetrics = [
  { label: "5-Tier Gap Analysis", detail: "Existing to Missing" },
  { label: "Sequential Day 1..N", detail: "Zero Missed-Day Skips" },
  { label: "4 Verified States", detail: "Not Started to Proficient" },
];

const roadmapMilestones = [
  {
    status: "COMPLETED",
    title: "Testing Fundamentals & HTTP APIs",
    percent: 100,
    badgeClass:
      "border-learning-proficient-border bg-learning-proficient-background text-learning-proficient-text",
    dotClass: "bg-learning-proficient-dot",
    barClass: "bg-learning-proficient-dot",
    stateLabel: "Proficient",
    tasks: [
      { label: "REST contract & status code assertions", done: true },
      { label: "Quiz: 20 MCQs + 6 Free-Response (Good)", done: true },
    ],
  },
  {
    status: "IN PROGRESS",
    title: "Playwright & CI Pipeline Automation — 65%",
    percent: 65,
    badgeClass:
      "border-learning-practicing-border bg-learning-practicing-background text-learning-practicing-text",
    dotClass: "bg-learning-practicing-dot",
    barClass: "bg-primary-500",
    stateLabel: "Practicing",
    tasks: [
      { label: "Page Object isolation & deterministic fixtures", done: true },
      { label: "GitHub Actions headless matrix & retry triage", done: false },
    ],
  },
  {
    status: "UPCOMING",
    title: "Multi-Tenant System Test Strategy",
    percent: 0,
    badgeClass:
      "border-learning-not-started-border bg-learning-not-started-background text-learning-not-started-text",
    dotClass: "bg-learning-not-started-dot",
    barClass: "bg-learning-not-started-dot",
    stateLabel: "Not Started",
    tasks: [
      { label: "Tenant isolation & RLS boundary checks", done: false },
      { label: "Auth lockout & rate-limit regression suite", done: false },
    ],
  },
];

const skillComparisonRows = [
  {
    skill: "System Design",
    baseline: 32,
    target: 78,
    gap: "Missing",
    gapClass:
      "border-gap-missing-border bg-gap-missing-background text-gap-missing-text",
  },
  {
    skill: "Testing & QA",
    baseline: 68,
    target: 86,
    gap: "Strengthen",
    gapClass:
      "border-gap-strengthen-border bg-gap-strengthen-background text-gap-strengthen-text",
  },
  {
    skill: "TypeScript",
    baseline: 82,
    target: 80,
    gap: "Existing",
    gapClass:
      "border-gap-existing-border bg-gap-existing-background text-gap-existing-text",
  },
];

const scheduleSlots = [
  {
    slot: "45m",
    title: "Concept Study & Official Docs",
    meta: "Day 18 · Focus Topic",
  },
  {
    slot: "45m",
    title: "20 MCQs + Short Free-Response",
    meta: "Basic / Application / Analysis",
  },
  {
    slot: "30m",
    title: "AI Practice Review & Mentor Q&A",
    meta: "Rubric Feedback & Retry",
  },
];

const masteryLadder = [
  {
    state: "Not Started",
    note: "Beginner None or unstarted topic",
    pillClass:
      "border-learning-not-started-border bg-learning-not-started-background text-learning-not-started-text",
    dotClass: "bg-learning-not-started-dot",
  },
  {
    state: "Learning",
    note: "Self-reported context or active study",
    pillClass:
      "border-learning-learning-border bg-learning-learning-background text-learning-learning-text",
    dotClass: "bg-learning-learning-dot",
  },
  {
    state: "Practicing",
    note: "Quiz submissions & rubric attempts",
    pillClass:
      "border-learning-practicing-border bg-learning-practicing-background text-learning-practicing-text",
    dotClass: "bg-learning-practicing-dot",
  },
  {
    state: "Proficient",
    note: "Repeated strong evidence at target level",
    pillClass:
      "border-learning-proficient-border bg-learning-proficient-background text-learning-proficient-text",
    dotClass: "bg-learning-proficient-dot",
  },
];

const pipelineStages = [
  {
    step: "01",
    title: "Baseline Calibration",
    description:
      'Set your current role, experience level, IANA timezone, daily study hours, and existing skills—or select explicit "None" if starting from zero.',
    deliverable: "Timezone + Hours + Skill Profile",
  },
  {
    step: "02",
    title: "Gap Analysis & Architecture",
    description:
      "Describe any tech goal in English or বাংলা. Resolve ambiguity in ≤2 AI clarification rounds, confirm Junior/Mid/Senior level, and Lock your phased roadmap.",
    deliverable: "Locked DAG Roadmap (Core / Supporting)",
  },
  {
    step: "03",
    title: "Daily Paced Execution",
    description:
      "Follow sequential Day 1..N units on Today. Missed calendar days never skip content—complete study notes, sources, 20 MCQs, and short free-response prompts.",
    deliverable: "Sequential Daily Study & Quiz Log",
  },
  {
    step: "04",
    title: "Progress Verification",
    description:
      "Inspect rubric-based AI Practice Review feedback, track explainable skill-state shifts, reuse shared skills across ≤3 roadmaps, or evolve via diff-reviewed Merge + Undo.",
    deliverable: "Explainable Evidence & Merge History",
  },
];

const careerTracks = [
  "Software QA & SDET",
  "Frontend Development",
  "Backend Development",
  "Full-Stack Engineering",
  "DevOps & SRE",
  "Cloud Engineering",
  "Cybersecurity",
  "Mobile Development",
  "Data Engineering",
  "AI / LLM Engineering",
];

const personaHighlights = [
  {
    title: "Complete Beginners & Students",
    detail: 'Explicit "None" skill toggle, Core-first ordering, zero fake prerequisites.',
  },
  {
    title: "Career Switchers & Self-Taught",
    detail: "Transferable & Refresh gap tags turn scattered learning into one sequence.",
  },
  {
    title: "Advancing Mid & Senior Engineers",
    detail: "Up to 3 active roadmaps with Shared Skill carryover and Merge level upgrades.",
  },
];

const ctaHighlights = [
  "Instant Email & +880 Phone OTP",
  "Personalized Daily Study Slots",
  "Honest Readiness Scoring",
];

const ctaAuthChannels = ["Email", "🇧🇩 +880 Phone", "Google", "Facebook"];

/**
 * Landing page — public flagship SaaS showcase for AI Career Mentor.
 * Grounded in PRD v1.4.1 & UI/UX Specification v2.0.2 (Screen 01).
 */
export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col bg-surface-canvas text-text-primary">
      {/* 1. Sticky Glass Navbar */}
      <header className="sticky top-0 z-(--z-header) border-b border-border-subtle bg-surface-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 rounded-md px-1 text-heading-sm font-semibold tracking-tight text-text-primary transition-colors duration-(--duration-fast) ease-standard hover:text-text-brand"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-600 to-accent-600 text-static-white shadow-sm"
            >
              <BrandGeometricMark width={19} height={19} />
            </span>
            <span>AI Career Mentor</span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-1 rounded-full border border-border-default/80 bg-surface-default/85 p-1 shadow-xs backdrop-blur-sm md:inline-flex"
          >
            {navLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-full px-3.5 text-label font-medium text-text-secondary transition-colors duration-(--duration-fast) ease-standard hover:bg-action-ghost-background-hover hover:text-text-primary"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-md px-3.5 text-label font-medium text-text-secondary transition-colors duration-(--duration-fast) ease-standard hover:bg-action-ghost-background-hover hover:text-text-primary"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-action-primary-background px-4 text-label font-semibold text-action-primary-foreground shadow-[0_0_24px_-4px_color-mix(in_oklab,var(--color-primary-500)_55%,transparent)] transition-all duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {/* 2. Atmospheric Hero Section + Live 3-Panel Product Showcase */}
        <section className="relative overflow-hidden border-b border-border-subtle">
          {/* Fine Architectural Grid with Bottom Fade Mask */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border-subtle)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-subtle)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_90%_72%_at_50%_0%,#000_52%,transparent_100%)]"
          />
          {/* Teal-Indigo Atmospheric Radial Glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-8%,color-mix(in_oklab,var(--color-primary-500)_18%,transparent),transparent_70%),radial-gradient(ellipse_48%_42%_at_82%_14%,color-mix(in_oklab,var(--color-accent-500)_15%,transparent),transparent_70%)]"
          />

          <div className="relative mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-16 lg:px-8">
            {/* Hero Editorial Header */}
            <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-ai-border bg-ai-surface/90 px-4 py-1.5 text-caption font-medium text-ai-text shadow-xs backdrop-blur-sm">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-500 opacity-75 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
                </span>
                <span>AI-Powered Career Intelligence &amp; Adaptive Roadmaps</span>
              </div>

              <h1 className="mt-6 text-display text-text-primary sm:text-display-lg">
                Architect Your Tech Career on{" "}
                <span className="bg-gradient-to-r from-text-brand to-ai-text bg-clip-text text-transparent">
                  Verified Skill Evidence
                </span>
              </h1>

              <p className="mt-5 max-w-2xl text-body-lg text-text-secondary">
                Diagnose existing, transferable, and missing skills across any
                technology goal. Lock a phased Junior, Mid, or Senior roadmap,
                execute timezone-calibrated daily plans, and track honest
                learning states from beginner to proficient.
              </p>

              <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
                <Link
                  href="/register"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-action-primary-background px-6 text-label-lg font-semibold text-action-primary-foreground shadow-[0_8px_28px_-6px_color-mix(in_oklab,var(--color-primary-500)_55%,transparent)] transition-all duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active"
                >
                  <span>Start Your Career Roadmap</span>
                  <ArrowRightIcon />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-12 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background/90 px-6 text-label-lg font-medium text-action-secondary-foreground backdrop-blur-sm transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active"
                >
                  Sign In to Workspace
                </Link>
              </div>

              <ul
                aria-label="Platform highlights"
                className="mt-7 flex flex-wrap items-center justify-center gap-2.5"
              >
                {heroMetrics.map((chip) => (
                  <li
                    key={chip.label}
                    className="inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-raised/85 px-3.5 py-1.5 text-caption backdrop-blur-sm"
                  >
                    <CheckCircleIcon
                      width={14}
                      height={14}
                      className="shrink-0 text-feedback-success-icon"
                    />
                    <span className="font-semibold text-text-primary">
                      {chip.label}
                    </span>
                    <span className="text-text-secondary">· {chip.detail}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Live Multi-Panel App Window Mockup (#preview) */}
            <div id="preview" className="scroll-mt-24 mt-12 sm:mt-14">
              <div className="rounded-2xl border border-border-subtle bg-surface-raised/90 shadow-2xl overflow-hidden backdrop-blur-md">
                {/* Window Chrome */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-subtle/90 px-4 py-3">
                  <div className="flex items-center gap-2" aria-hidden="true">
                    <span className="h-3 w-3 rounded-full bg-danger-400/80" />
                    <span className="h-3 w-3 rounded-full bg-warning-400/80" />
                    <span className="h-3 w-3 rounded-full bg-success-400/80" />
                  </div>

                  <div className="flex items-center gap-2 rounded-md border border-border-default bg-surface-default px-3 py-1 font-mono text-caption text-text-secondary">
                    <LockIcon className="text-feedback-success-icon" />
                    <span>mentor.app/roadmap/sqa-engineer</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-priority-core-border bg-priority-core-background px-2.5 py-0.5 text-caption font-medium text-priority-core-text">
                      Mid Level
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-0.5 text-caption font-medium text-feedback-success-text">
                      <CheckIcon width={12} height={12} />
                      Locked v2
                    </span>
                  </div>
                </div>

                {/* 3-Panel Interior */}
                <div className="grid grid-cols-1 divide-y divide-border-subtle lg:grid-cols-12 lg:divide-x lg:divide-y-0">
                  {/* Left Sidebar */}
                  <aside
                    aria-label="Active career goal summary"
                    className="flex flex-col justify-between gap-5 bg-surface-subtle/55 p-5 lg:col-span-3"
                  >
                    <div>
                      <span className="text-overline uppercase text-text-brand">
                        Focus Roadmap
                      </span>
                      <h2 className="mt-1.5 text-heading-sm text-text-primary">
                        Software QA &amp; Automation Engineer
                      </h2>
                      <p className="mt-1 text-caption text-text-secondary">
                        1 of 3 active roadmaps · Shared skills synced
                      </p>

                      {/* Progress Ring & Bar (74% Core Progress — PRD §36 compliant, zero Job Ready claims) */}
                      <div className="mt-5 rounded-xl border border-border-subtle bg-surface-raised p-4 shadow-xs">
                        <div className="flex items-center gap-3.5">
                          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
                            <svg
                              viewBox="0 0 64 64"
                              className="h-16 w-16 -rotate-90"
                              aria-hidden="true"
                            >
                              <circle
                                cx="32"
                                cy="32"
                                r="26"
                                fill="none"
                                stroke="var(--surface-sunken)"
                                strokeWidth="6"
                              />
                              <circle
                                cx="32"
                                cy="32"
                                r="26"
                                fill="none"
                                stroke="var(--chart-series-1)"
                                strokeWidth="6"
                                strokeLinecap="round"
                                strokeDasharray="163.36"
                                strokeDashoffset="42.47"
                              />
                            </svg>
                            <span className="absolute font-mono text-label font-semibold text-text-primary">
                              74%
                            </span>
                          </div>
                          <div>
                            <p className="text-label font-semibold text-text-primary">
                              Core Progress
                            </p>
                            <p className="text-caption text-text-secondary">
                              74% Practicing+ across Mid-level competencies
                            </p>
                          </div>
                        </div>
                        <div
                          role="progressbar"
                          aria-label="Core skill progress"
                          aria-valuenow={74}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
                        >
                          <div className="h-full w-[74%] rounded-full bg-gradient-to-r from-primary-600 to-accent-500" />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2.5 text-caption">
                      <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-raised px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
                          <FlameStreakIcon className="text-warning-500" />
                          Weekly Streak
                        </span>
                        <span className="font-mono font-semibold text-text-brand">
                          5/5 days
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-raised px-3 py-2">
                        <span className="font-medium text-text-primary">
                          Schedule
                        </span>
                        <span className="font-mono text-text-secondary">
                          Asia/Dhaka • 2h/day
                        </span>
                      </div>
                    </div>
                  </aside>

                  {/* Center Roadmap Canvas */}
                  <div className="flex flex-col gap-3.5 p-5 lg:col-span-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-overline uppercase text-text-secondary">
                          Roadmap Canvas · Sequential Day 18
                        </span>
                        <h3 className="text-heading-sm text-text-primary">
                          Milestone Execution Path
                        </h3>
                      </div>
                      <span className="rounded-md border border-border-subtle bg-surface-subtle px-2.5 py-1 font-mono text-caption text-text-secondary">
                        Core &amp; Supporting DAG
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {roadmapMilestones.map((milestone) => (
                        <div
                          key={milestone.title}
                          className="rounded-xl border border-border-default bg-surface-default p-4 shadow-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-semibold ${milestone.badgeClass}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${milestone.dotClass}`}
                              />
                              {milestone.status}
                            </span>
                            <span className="text-caption font-medium text-text-secondary">
                              State: {milestone.stateLabel}
                            </span>
                          </div>

                          <p className="mt-2 text-label-lg font-semibold text-text-primary">
                            {milestone.title}
                          </p>

                          <div
                            role="progressbar"
                            aria-label={`${milestone.title} completion`}
                            aria-valuenow={milestone.percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
                          >
                            <div
                              className={`h-full rounded-full ${milestone.barClass}`}
                              style={{ width: `${milestone.percent}%` }}
                            />
                          </div>

                          <ul className="mt-3 flex flex-col gap-1.5">
                            {milestone.tasks.map((task) => (
                              <li
                                key={task.label}
                                className="flex items-center gap-2 text-caption text-text-secondary"
                              >
                                <span
                                  aria-hidden="true"
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    task.done
                                      ? "border-feedback-success-border bg-feedback-success-background text-feedback-success-icon"
                                      : "border-border-strong bg-surface-subtle"
                                  }`}
                                >
                                  {task.done && (
                                    <CheckIcon width={11} height={11} />
                                  )}
                                </span>
                                <span className="sr-only">
                                  {task.done ? "Completed: " : "Not completed: "}
                                </span>
                                <span>{task.label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right AI Mentor Insight Panel */}
                  <aside
                    aria-label="AI Mentor diagnostic panel"
                    className="flex flex-col justify-between gap-4 bg-ai-surface/55 p-5 lg:col-span-3"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-overline uppercase text-ai-text">
                          <SparkCompassIcon
                            width={14}
                            height={14}
                            className="text-ai-icon"
                          />
                          AI Mentor Insight
                        </span>
                        <span className="rounded border border-ai-border bg-surface-raised px-2 py-0.5 text-caption font-medium text-ai-text">
                          EN / বাংলা
                        </span>
                      </div>

                      <div className="mt-3.5 rounded-xl border border-ai-border bg-surface-raised p-3.5 shadow-xs">
                        <p className="text-caption font-semibold text-text-primary">
                          Skill-Gap Diagnostic
                        </p>
                        <ul className="mt-2 flex flex-col gap-2 text-caption">
                          <li className="flex items-center justify-between gap-2">
                            <span className="text-text-secondary">
                              HTTP Assertions
                            </span>
                            <span className="rounded-full border border-gap-existing-border bg-gap-existing-background px-2 py-0.5 font-medium text-gap-existing-text">
                              Existing
                            </span>
                          </li>
                          <li className="flex items-center justify-between gap-2">
                            <span className="text-text-secondary">
                              CI Matrix Retries
                            </span>
                            <span className="rounded-full border border-gap-strengthen-border bg-gap-strengthen-background px-2 py-0.5 font-medium text-gap-strengthen-text">
                              Strengthen
                            </span>
                          </li>
                          <li className="flex items-center justify-between gap-2">
                            <span className="text-text-secondary">
                              RLS Test Design
                            </span>
                            <span className="rounded-full border border-gap-missing-border bg-gap-missing-background px-2 py-0.5 font-medium text-gap-missing-text">
                              Missing
                            </span>
                          </li>
                        </ul>
                      </div>

                      <div className="mt-3 rounded-xl border border-ai-border bg-surface-raised p-3.5 shadow-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-caption font-semibold text-ai-text">
                            Recommended Today
                          </span>
                          <span className="font-mono text-caption font-semibold text-text-brand">
                            45 min
                          </span>
                        </div>
                        <p className="mt-1.5 text-label font-medium text-text-primary">
                          Flaky CI Retry Isolation Lab
                        </p>
                        <p className="mt-1 text-caption text-text-secondary">
                          Review trace-artifact patterns, then complete 20 MCQs
                          + 5 debugging free-response prompts.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-ai-border bg-ai-surface p-3.5">
                      <p className="text-caption font-semibold text-ai-text">
                        Mentor Note
                      </p>
                      <p
                        className="mt-1 text-caption leading-relaxed text-text-primary"
                        dir="auto"
                      >
                        তোমার API contract testing ভিত্তি শক্ত—আজ CI retry
                        isolation অনুশীলন করে উত্তরগুলো জমা দাও।
                      </p>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. True 12-Column Asymmetric Bento Grid Features (#features) */}
        <section
          id="features"
          className="scroll-mt-24 border-b border-border-subtle py-16 sm:py-24"
        >
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <span className="text-overline uppercase text-text-brand">
                Core Capabilities
              </span>
              <h2 className="mt-2 text-heading-xl text-text-primary sm:text-display">
                Precision Architecture for Real Technical Growth
              </h2>
              <p className="mt-3 text-body-lg text-text-secondary">
                Every workflow connects diagnostic skill gaps, timezone-aware
                study slots, rubric-checked practice, and bilingual mentoring.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-12">
              {/* Span-7 Card: Honest Skill-Gap Diagnostics */}
              <article className="flex flex-col justify-between gap-6 rounded-2xl border border-border-default bg-surface-raised p-6 shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:border-border-strong md:col-span-12 lg:col-span-7">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-surface-accent text-text-brand">
                      <ChartBarIcon />
                    </span>
                    <span className="rounded-full border border-border-subtle bg-surface-subtle px-3 py-1 text-caption font-medium text-text-secondary">
                      Diagnostic Engine
                    </span>
                  </div>
                  <h3 className="mt-4 text-heading-md text-text-primary">
                    Honest Skill-Gap Diagnostics
                  </h3>
                  <p className="mt-2 text-body-sm leading-relaxed text-text-secondary">
                    Maps your background against target role depth (Junior, Mid,
                    Senior) across Existing, Transferable, Refresh, Strengthen,
                    and Missing skills—supporting explicit{" "}
                    <span className="font-mono text-code text-text-primary">
                      None
                    </span>{" "}
                    for complete beginners without creating fake baselines.
                  </p>
                </div>

                {/* Mini Visual Comparison Bar Chart */}
                <div className="rounded-xl border border-border-subtle bg-surface-subtle p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-caption">
                    <span className="font-semibold text-text-primary">
                      Current Baseline vs Target Role Requirement
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 text-text-secondary">
                        <span className="h-2 w-2 rounded-full bg-primary-500" />
                        Baseline
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-text-secondary">
                        <span className="h-2 w-2 rounded-full bg-accent-500/70" />
                        Target
                      </span>
                    </div>
                  </div>

                  <div className="mt-3.5 flex flex-col gap-3">
                    {skillComparisonRows.map((row) => (
                      <div key={row.skill} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2 text-caption">
                          <span className="font-medium text-text-primary">
                            {row.skill}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-text-secondary">
                              {row.baseline}% / {row.target}%
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 font-medium ${row.gapClass}`}
                            >
                              {row.gap}
                            </span>
                          </div>
                        </div>
                        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-accent-500/35"
                            style={{ width: `${row.target}%` }}
                          />
                          <div
                            className="relative h-full rounded-full bg-primary-500"
                            style={{ width: `${row.baseline}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>

              {/* Span-5 Card: Timezone & Schedule Calibration */}
              <article className="flex flex-col justify-between gap-6 rounded-2xl border border-border-default bg-surface-raised p-6 shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:border-border-strong md:col-span-6 lg:col-span-5">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-surface-accent text-text-brand">
                      <ClockIcon />
                    </span>
                    <span className="rounded-full border border-border-subtle bg-surface-subtle px-3 py-1 text-caption font-medium text-text-secondary">
                      Daily Pacing
                    </span>
                  </div>
                  <h3 className="mt-4 text-heading-md text-text-primary">
                    Timezone &amp; Schedule Calibration
                  </h3>
                  <p className="mt-2 text-body-sm leading-relaxed text-text-secondary">
                    Converts your locked roadmap into sequential{" "}
                    <span className="font-mono text-code text-text-primary">
                      Day 1..N
                    </span>{" "}
                    units calibrated to your local timezone and daily hours.
                    Missed calendar days never skip lessons or alter history.
                  </p>
                </div>

                {/* Mini Daily Schedule Widget */}
                <div className="rounded-xl border border-border-subtle bg-surface-subtle p-4">
                  <div className="flex items-center justify-between border-b border-border-subtle pb-2.5 text-caption">
                    <span className="font-mono font-semibold text-text-primary">
                      Asia/Dhaka (UTC+6)
                    </span>
                    <span className="rounded-md border border-priority-core-border bg-priority-core-background px-2 py-0.5 font-mono font-semibold text-priority-core-text">
                      120 mins/day
                    </span>
                  </div>
                  <ul className="mt-3 flex flex-col gap-2">
                    {scheduleSlots.map((item) => (
                      <li
                        key={item.title}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-caption font-medium text-text-primary">
                            {item.title}
                          </p>
                          <p className="text-caption text-text-secondary">
                            {item.meta}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-caption font-semibold text-text-brand">
                          {item.slot}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>

              {/* Span-5 Card: Evidence-Based Skill Progress */}
              <article className="flex flex-col justify-between gap-6 rounded-2xl border border-border-default bg-surface-raised p-6 shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:border-border-strong md:col-span-6 lg:col-span-5">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-surface-accent text-text-brand">
                      <CheckCircleIcon />
                    </span>
                    <span className="rounded-full border border-border-subtle bg-surface-subtle px-3 py-1 text-caption font-medium text-text-secondary">
                      Zero Fake Inflation
                    </span>
                  </div>
                  <h3 className="mt-4 text-heading-md text-text-primary">
                    Evidence-Based Skill Progress
                  </h3>
                  <p className="mt-2 text-body-sm leading-relaxed text-text-secondary">
                    Progression from beginner through{" "}
                    <span className="font-medium text-text-primary">
                      Proficient
                    </span>{" "}
                    is earned from 20-MCQ + free-response quizzes and rubric AI
                    Practice Review—never single-threshold tricks or job
                    guarantees.
                  </p>
                </div>

                {/* 4-State Progression Ladder */}
                <div className="rounded-xl border border-border-subtle bg-surface-subtle p-4">
                  <div className="flex flex-col gap-2">
                    {masteryLadder.map((step) => (
                      <div
                        key={step.state}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-caption"
                      >
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium ${step.pillClass}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${step.dotClass}`}
                          />
                          {step.state}
                        </span>
                        <span className="text-right text-text-secondary">
                          {step.note}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>

              {/* Span-7 Card: Bilingual & Regional Career Context */}
              <article className="flex flex-col justify-between gap-6 rounded-2xl border border-border-default bg-surface-raised p-6 shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:border-border-strong md:col-span-12 lg:col-span-7">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-surface-accent text-text-brand">
                      <GlobeMessageIcon />
                    </span>
                    <span className="rounded-full border border-border-subtle bg-surface-subtle px-3 py-1 text-caption font-medium text-text-secondary">
                      Global + Bangladesh Context
                    </span>
                  </div>
                  <h3 className="mt-4 text-heading-md text-text-primary">
                    Bilingual &amp; Regional Career Context
                  </h3>
                  <p className="mt-2 text-body-sm leading-relaxed text-text-secondary">
                    Tailored guidance for both global remote engineering roles
                    and Bangladesh technology teams. Enter goals, quiz answers,
                    and AI Mentor questions naturally in English, বাংলা, or
                    mixed language—with source-cited Daily Tech Updates and{" "}
                    <span className="font-mono text-code text-text-primary">
                      +880
                    </span>{" "}
                    SMS OTP support.
                  </p>
                </div>

                {/* Bilingual + Regional Context Snippet */}
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-border-subtle bg-surface-subtle p-4 sm:grid-cols-2">
                  <div className="flex flex-col justify-between gap-3 rounded-lg border border-border-subtle bg-surface-raised p-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-ai-border bg-ai-surface px-2.5 py-0.5 text-caption font-semibold text-ai-text">
                        English
                      </span>
                      <span className="rounded-full border border-ai-border bg-ai-surface px-2.5 py-0.5 text-caption font-semibold text-ai-text">
                        বাংলা
                      </span>
                      <span className="rounded-full border border-ai-border bg-ai-surface px-2.5 py-0.5 text-caption font-semibold text-ai-text">
                        Bangla-English Mixed
                      </span>
                    </div>
                    <p
                      className="text-caption leading-relaxed text-text-primary"
                      dir="auto"
                    >
                      &ldquo;আমি Mid-level Backend Engineer হতে চাই, Node.js ও
                      PostgreSQL নিয়ে কাজ করতে চাই।&rdquo;
                    </p>
                  </div>

                  <div className="flex flex-col justify-between gap-2 rounded-lg border border-border-subtle bg-surface-raised p-3.5 text-caption">
                    <p className="font-semibold text-text-primary">
                      Regional &amp; Ecosystem Grounding
                    </p>
                    <ul className="flex flex-col gap-1.5 text-text-secondary">
                      <li className="flex items-center gap-1.5">
                        <CheckIcon
                          width={13}
                          height={13}
                          className="shrink-0 text-text-brand"
                        />
                        <span>Global remote &amp; Bangladesh market notes</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <CheckIcon
                          width={13}
                          height={13}
                          className="shrink-0 text-text-brand"
                        />
                        <span>Email, +880 Phone, Google &amp; Facebook auth</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <CheckIcon
                          width={13}
                          height={13}
                          className="shrink-0 text-text-brand"
                        />
                        <span>Official docs &amp; release-note tech updates</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* 4. Interactive-Looking 4-Stage Pipeline (#how-it-works) */}
        <section
          id="how-it-works"
          className="scroll-mt-24 border-b border-border-subtle bg-surface-subtle/60 py-16 sm:py-24"
        >
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <span className="text-overline uppercase text-text-brand">
                4-Stage Pipeline
              </span>
              <h2 className="mt-2 text-heading-xl text-text-primary sm:text-display">
                How Career Intelligence Turns Goals into Daily Mastery
              </h2>
              <p className="mt-3 text-body-lg text-text-secondary">
                A deterministic flow where you confirm every career goal, lock
                every roadmap change, and earn verified progress step by step.
              </p>
            </div>

            <div className="relative mt-12">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-8 right-8 top-11 hidden h-px bg-gradient-to-r from-primary-500/40 via-accent-500/40 to-primary-500/40 lg:block"
              />

              <ol className="relative grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
                {pipelineStages.map((stage) => (
                  <li
                    key={stage.step}
                    className="group flex flex-col justify-between gap-5 rounded-2xl border border-border-default bg-surface-raised p-6 shadow-xs transition-all duration-(--duration-fast) ease-standard hover:border-primary-500/60 hover:shadow-md"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-lg bg-action-primary-background px-2.5 font-mono text-label font-semibold text-action-primary-foreground shadow-xs transition-transform duration-(--duration-fast) ease-standard group-hover:scale-105">
                          {stage.step}
                        </span>
                        <span className="font-mono text-caption text-text-muted">
                          Stage {stage.step}
                        </span>
                      </div>
                      <h3 className="mt-5 text-heading-sm text-text-primary">
                        {stage.title}
                      </h3>
                      <p className="mt-2 text-body-sm leading-relaxed text-text-secondary">
                        {stage.description}
                      </p>
                    </div>

                    <div className="border-t border-border-subtle pt-3.5">
                      <span className="text-caption font-medium text-text-brand">
                        Output: {stage.deliverable}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Career Tracks & Personas Band (#tracks) */}
        <section
          id="tracks"
          className="scroll-mt-24 border-b border-border-subtle py-16 sm:py-20"
        >
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
              <div className="lg:col-span-5">
                <span className="text-overline uppercase text-text-brand">
                  Career Tracks &amp; Personas
                </span>
                <h2 className="mt-2 text-heading-xl text-text-primary">
                  Built for Every Technical Starting Point
                </h2>
                <p className="mt-3 text-body-sm leading-relaxed text-text-secondary">
                  Whether you are starting from zero or maintaining up to three
                  active roadmaps across specializations, dynamic goal resolution
                  maps your exact role without hardcoded list limits.
                </p>

                <ul className="mt-6 flex flex-col gap-3">
                  {personaHighlights.map((persona) => (
                    <li
                      key={persona.title}
                      className="rounded-xl border border-border-subtle bg-surface-raised p-4 shadow-xs"
                    >
                      <p className="text-label font-semibold text-text-primary">
                        {persona.title}
                      </p>
                      <p className="mt-1 text-caption text-text-secondary">
                        {persona.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-border-default bg-surface-raised p-6 shadow-xs sm:p-8 lg:col-span-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-heading-md text-text-primary">
                    Technology Tracks Inside MVP Scope
                  </h3>
                  <Link
                    href="/register"
                    className="inline-flex min-h-11 items-center gap-1.5 text-label font-semibold text-text-link underline underline-offset-4 hover:text-text-link-hover"
                  >
                    <span>Define custom goal</span>
                    <ArrowRightIcon width={15} height={15} />
                  </Link>
                </div>
                <p className="mt-2 text-body-sm text-text-secondary">
                  Covers roles across software, testing, systems, cloud,
                  security, mobile, data, and applied AI engineering.
                </p>

                <ul
                  aria-label="Supported technology career tracks"
                  className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2"
                >
                  {careerTracks.map((track) => (
                    <li
                      key={track}
                      className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-surface-subtle px-3.5 py-2.5 text-body-sm font-medium text-text-primary"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full bg-primary-500"
                      />
                      <span>{track}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Flagship Tier-1 SaaS Bottom Conversion CTA Card */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="rounded-3xl bg-gradient-to-b from-teal-400/30 via-slate-700/40 to-slate-900/80 p-px shadow-2xl">
              <div className="relative overflow-hidden rounded-[23px] bg-slate-950 px-8 py-12 text-white sm:px-14 sm:py-16">
                {/* Specular Top Edge Highlight */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-teal-400/40 to-transparent"
                />
                {/* Masked Geometric Grid Overlay */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_85%_80%_at_50%_50%,#000_55%,transparent_100%)]"
                />
                {/* Radial Ambient Glow Behind Right Action Cluster */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-10 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-teal-500/15 blur-3xl"
                />

                <div className="relative z-10 grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
                  {/* Left Editorial Column */}
                  <div className="lg:col-span-7">
                    <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/10 px-3.5 py-1.5 text-[11px] font-semibold tracking-wider text-teal-300 uppercase">
                      <span className="relative flex h-2 w-2" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]" />
                      </span>
                      <span>OPEN SELF-REGISTRATION • NO INVITE CODE REQUIRED</span>
                    </div>

                    <h2 className="mt-5 text-heading-xl text-white sm:text-display">
                      Build Your Career Roadmap With Verified Direction
                    </h2>

                    <p className="mt-4 max-w-xl text-body-lg leading-relaxed text-slate-300">
                      Create an account with Email, Bangladesh +880 Phone,
                      Google, or Facebook. Lock your first roadmap, calibrate your
                      daily hours, and let practice evidence guide your growth.
                    </p>

                    <ul
                      aria-label="Core workspace guarantees"
                      className="mt-7 flex flex-wrap items-center gap-2.5"
                    >
                      {ctaHighlights.map((highlight) => (
                        <li
                          key={highlight}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-caption font-medium text-slate-200"
                        >
                          <CheckIcon
                            width={14}
                            height={14}
                            className="shrink-0 text-teal-400"
                          />
                          <span>{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Right Quick-Start Action Card */}
                  <div className="lg:col-span-5">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-inner backdrop-blur-md sm:p-7">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-label font-semibold text-white">
                          Get started in under 2 minutes
                        </p>
                        <span className="rounded-full border border-teal-400/25 bg-teal-400/10 px-2.5 py-0.5 text-[11px] font-medium text-teal-300">
                          Free baseline access
                        </span>
                      </div>

                      <div className="mt-5 flex flex-col gap-3">
                        <Link
                          href="/register"
                          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-400 px-5 text-label-lg font-semibold text-slate-950 shadow-lg shadow-teal-500/20 transition hover:bg-teal-300 active:bg-teal-200"
                        >
                          <span>Start Your Career Roadmap</span>
                          <ArrowRightIcon width={17} height={17} />
                        </Link>

                        <Link
                          href="/login"
                          className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 text-label-lg font-medium text-white transition hover:bg-white/10 active:bg-white/15"
                        >
                          Sign In to Existing Account
                        </Link>
                      </div>

                      <div className="mt-5 border-t border-white/10 pt-4">
                        <div className="flex flex-wrap items-center justify-center gap-1.5">
                          {ctaAuthChannels.map((channel, index) => (
                            <span
                              key={channel}
                              className="inline-flex items-center gap-1.5"
                            >
                              <span className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-slate-200">
                                {channel}
                              </span>
                              {index < ctaAuthChannels.length - 1 ? (
                                <span
                                  aria-hidden="true"
                                  className="text-slate-500"
                                >
                                  •
                                </span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Modern Multi-Column Footer */}
      <footer className="border-t border-border-default bg-surface-default">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
            <div className="md:col-span-5">
              <Link
                href="/"
                className="inline-flex items-center gap-2.5 text-heading-sm font-semibold text-text-primary"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-600 to-accent-600 text-static-white"
                >
                  <BrandGeometricMark width={17} height={17} />
                </span>
                <span>AI Career Mentor</span>
              </Link>
              <p className="mt-3 max-w-sm text-body-sm text-text-secondary">
                Personal AI-powered technology career mentor combining
                skill-gap diagnostics, locked roadmaps, timezone-calibrated daily
                study, and evidence-backed practice review.
              </p>
            </div>

            <div className="md:col-span-2">
              <h2 className="text-label font-semibold text-text-primary">
                Platform
              </h2>
              <ul className="mt-2 flex flex-col gap-0.5 text-body-sm text-text-secondary">
                {navLinks.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="inline-flex min-h-11 items-center hover:text-text-primary"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-2">
              <h2 className="text-label font-semibold text-text-primary">
                Workspace
              </h2>
              <ul className="mt-2 flex flex-col gap-0.5 text-body-sm text-text-secondary">
                <li>
                  <Link
                    href="/register"
                    className="inline-flex min-h-11 items-center hover:text-text-primary"
                  >
                    Get Started
                  </Link>
                </li>
                <li>
                  <Link
                    href="/login"
                    className="inline-flex min-h-11 items-center hover:text-text-primary"
                  >
                    Sign In
                  </Link>
                </li>
                <li>
                  <Link
                    href="/forgot-password"
                    className="inline-flex min-h-11 items-center hover:text-text-primary"
                  >
                    Reset Password
                  </Link>
                </li>
              </ul>
            </div>

            <div className="md:col-span-3">
              <h2 className="text-label font-semibold text-text-primary">
                Trust &amp; Guardrails
              </h2>
              <ul className="mt-3 flex flex-col gap-2 text-caption text-text-secondary">
                <li>Open registration, zero invite codes</li>
                <li>Private mentor &amp; practice isolation</li>
                <li>Zero empty employment guarantees</li>
                <li>Full user-initiated account deletion</li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border-subtle pt-6 text-caption text-text-secondary sm:flex-row sm:items-center">
            <p>&copy; 2026 AI Career Mentor. All rights reserved.</p>
            <p>English · বাংলা · Mixed Language · Mobile-Responsive PWA</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
