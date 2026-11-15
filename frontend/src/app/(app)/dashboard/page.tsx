import Link from 'next/link';
import { redirect } from 'next/navigation';
import { logoutAction } from '@/lib/auth/actions';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { getUserDisplayName } from '@/lib/auth/user-display';
import { resolveWorkspaceProfile } from '@/lib/auth/workspace-profile';
import { EXPERIENCE_LEVEL_LABELS } from '@/lib/profile/metadata';
import { Alert } from '@/components/ui/alert';
import { AppShellSync } from '@/components/ui/app-shell-context';
import { Button } from '@/components/ui/button';
import {
  BookOpenIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  CompassIcon,
  GlobeIcon,
  SparklesIcon,
  UserCheckIcon,
} from '@/components/ui/icons';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center gap-2 rounded-lg bg-action-primary-background px-5 text-label-lg font-medium text-action-primary-foreground shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-lg border border-action-secondary-border bg-action-secondary-background px-5 text-label-lg font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active';

function StatusBadge({
  ready,
  readyLabel,
  pendingLabel,
}: {
  ready: boolean;
  readyLabel: string;
  pendingLabel: string;
}) {
  return (
    <span
      className={
        ready
          ? 'inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300'
          : 'inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
      }
    >
      {ready && <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />}
      <span>{ready ? readyLabel : pendingLabel}</span>
    </span>
  );
}

/**
 * Dashboard page — English-only SaaS workspace overview synced with live
 * EP-A13 session state, EP-P01 profile data, and Supabase user metadata.
 */
export default async function DashboardPage() {
  const result = await getAppSessionStateResult();

  if (result.status === 'unauthenticated') {
    redirect('/login');
  }

  if (result.status === 'transient_error') {
    return (
      <>
        <AppShellSync disabled />
        <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
          <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
            <div className="flex flex-col gap-5 rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
              <h1 className="text-heading-lg text-text-primary">
                Service Temporarily Unavailable
              </h1>
              <Alert variant="error_retryable" role="alert">
                We could not load your workspace summary right now. Please try again in a moment.
              </Alert>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href="/dashboard" className={primaryLinkClass}>
                  Try Again
                </Link>
                <Link href="/" className={secondaryLinkClass}>
                  Back to Home
                </Link>
                <form action={logoutAction}>
                  <Button type="submit" variant="secondary" size="md">
                    Sign Out
                  </Button>
                </form>
              </div>
            </div>
          </main>
        </div>
      </>
    );
  }

  const state = result.data;
  const workspace = await resolveWorkspaceProfile(state);

  if (workspace.unauthorized) {
    redirect('/login');
  }

  const { user, effective_access } = state;

  if (workspace.isSuspended) {
    return (
      <>
        <AppShellSync disabled />
        <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
          <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
            <div className="flex flex-col gap-5 rounded-xl border border-feedback-warning-border bg-surface-raised p-6 shadow-md sm:p-8">
              <h1 className="text-heading-lg text-text-primary">
                Your account is suspended
              </h1>
              <p className="text-body-sm text-text-secondary">
                Learning features are currently disabled. You can still review your account or request permanent account deletion in Settings.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/settings" className={primaryLinkClass}>
                  Account Settings
                </Link>
                <Link href="/" className={secondaryLinkClass}>
                  Back to Home
                </Link>
                <form action={logoutAction}>
                  <Button type="submit" variant="secondary" size="md">
                    Sign Out
                  </Button>
                </form>
              </div>
            </div>
          </main>
        </div>
      </>
    );
  }

  const welcomeName = getUserDisplayName({
    fullName: workspace.fullName,
    email: workspace.displayedEmail,
    phone: workspace.displayedPhone,
  });

  const dailyHours = workspace.preferredDailyHours;
  const weeklyHours =
    dailyHours !== null ? Number((dailyHours * 7).toFixed(1)) : null;
  const experienceLabel = workspace.experienceLevel
    ? EXPERIENCE_LEVEL_LABELS[workspace.experienceLevel]
    : 'Not set';

  const moduleCards = [
    {
      title: 'Learning Roadmap',
      description:
        'Personalized milestone sequencing built around your role, baseline skills, and weekly schedule.',
      icon: CompassIcon,
      ready:
        workspace.isProfileComplete &&
        (effective_access.roadmap_generator ??
          effective_access.roadmap_generation ??
          true),
      primaryHref: '/onboarding/profile',
      primaryLabel: 'Review Profile',
      secondaryHref: '/settings',
      secondaryLabel: 'Schedule Settings',
    },
    {
      title: 'Daily Practice & Quizzes',
      description:
        'Focused daily tasks and adaptive checkpoints paced to match your preferred study hours.',
      icon: BookOpenIcon,
      ready:
        workspace.isProfileComplete &&
        (effective_access.daily_plan ?? effective_access.quiz_practice ?? true),
      primaryHref: '/settings',
      primaryLabel: 'Study Preferences',
      secondaryHref: '/onboarding/profile',
      secondaryLabel: 'Update Skills',
    },
    {
      title: 'AI Career Mentor',
      description:
        'Targeted technical coaching and feedback anchored in your onboarding goals and evidence.',
      icon: SparklesIcon,
      ready: workspace.isProfileComplete && (effective_access.ai_mentor ?? true),
      primaryHref: '/onboarding/profile',
      primaryLabel: workspace.isProfileComplete
        ? 'Edit Career Profile'
        : 'Continue Setup',
      secondaryHref: '/settings',
      secondaryLabel: 'Account Settings',
    },
  ];

  return (
    <>
      <AppShellSync
        variant={user.role === 'ADMIN' ? 'admin' : 'authenticated'}
        user={{
          fullName: workspace.fullName,
          currentRole: workspace.currentRole,
          email: workspace.displayedEmail,
          phone: workspace.displayedPhone,
        }}
      />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* Top Page Header & Breadcrumb Row */}
        <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"
            >
              <Link
                href="/dashboard"
                className="transition-colors hover:text-slate-800 dark:hover:text-slate-200"
              >
                AI Career Mentor
              </Link>
              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="text-slate-700 dark:text-slate-200">
                Dashboard
              </span>
            </nav>
            <h1 className="mt-1.5 text-heading-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Dashboard
            </h1>
          </div>

          <Link href="/onboarding/profile" className={primaryLinkClass}>
            {workspace.isProfileComplete ? 'Edit Profile' : 'Continue Setup'}
          </Link>
        </div>

        {/* Row 1: Welcome & KPI Summary Cards */}
        <section
          aria-label="Workspace overview"
          className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4"
        >
          {/* Welcome Card */}
          <article className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                GOOD DAY,
              </p>
              <h2 className="mt-1 truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                {welcomeName}!
              </h2>
              <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                {workspace.currentRole ?? 'Role not set'}
              </p>
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <GlobeIcon className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                <span>{workspace.timezone ?? 'Timezone not set'}</span>
              </span>
            </div>
          </article>

          {/* Profile Status Card */}
          <article className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Profile Status
                </p>
                <p className="mt-1.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {workspace.isProfileComplete
                    ? '100% Complete'
                    : 'Step 1 of 5 • 20%'}
                </p>
              </div>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
                <UserCheckIcon className="h-4 w-4" />
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <StatusBadge
                ready={workspace.isProfileComplete}
                readyLabel="Complete"
                pendingLabel="In Progress"
              />
              <Link
                href="/onboarding/profile"
                className="text-xs font-semibold text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-300"
              >
                {workspace.isProfileComplete ? 'Update Profile' : 'Complete Setup'}
              </Link>
            </div>
          </article>

          {/* Daily Study Target Card */}
          <article className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Daily Study Target
                </p>
                <p className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {dailyHours !== null
                    ? `${dailyHours} ${dailyHours === 1 ? 'hr' : 'hrs'} / day`
                    : 'Not set'}
                </p>
              </div>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <ClockIcon className="h-4 w-4" />
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
              <span className="tabular-nums text-slate-500 dark:text-slate-400">
                {weeklyHours !== null
                  ? `${weeklyHours} hrs / week`
                  : 'Set schedule in Settings'}
              </span>
              <Link
                href="/settings"
                className="font-semibold text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-300"
              >
                Manage
              </Link>
            </div>
          </article>

          {/* Experience & Track Card */}
          <article className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Experience &amp; Track
                </p>
                <p className="mt-1.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {experienceLabel}
                </p>
              </div>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <CompassIcon className="h-4 w-4" />
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
              <span className="truncate text-slate-500 dark:text-slate-400">
                {workspace.currentRole ?? 'Profession not set'}
              </span>
              <Link
                href="/onboarding/profile"
                className="shrink-0 font-semibold text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-300"
              >
                Change
              </Link>
            </div>
          </article>
        </section>

        {/* Row 2: Career Intelligence & Learning Modules */}
        <section aria-label="Career intelligence and learning modules">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Career Intelligence &amp; Learning Modules
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {moduleCards.map((mod) => {
              const Icon = mod.icon;
              return (
                <article
                  key={mod.title}
                  className="flex flex-col justify-between gap-5 rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-shadow hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal-500/20 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                        <Icon className="h-5 w-5" />
                      </span>
                      <StatusBadge
                        ready={mod.ready}
                        readyLabel="Ready"
                        pendingLabel="Unlocks after full onboarding"
                      />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {mod.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {mod.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 text-xs font-semibold dark:border-slate-800">
                    <Link
                      href={mod.primaryHref}
                      className="inline-flex items-center gap-1 text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-300"
                    >
                      <span>{mod.primaryLabel}</span>
                      <ChevronRightIcon className="h-3.5 w-3.5" />
                    </Link>
                    <Link
                      href={mod.secondaryHref}
                      className="text-slate-500 transition-colors hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      {mod.secondaryLabel}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
}
