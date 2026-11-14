import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { getAppUserResult } from "@/lib/auth/user";
import { Button } from "@/components/ui/button";
import { CheckCircleIcon } from "@/components/ui/icons";

const primaryLinkClass =
  "inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-6 text-label-lg font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active";

const secondaryLinkClass =
  "inline-flex h-10 min-h-11 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-6 text-label-lg font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active";

/**
 * Dashboard page — MVP overview for authenticated + ACTIVE users.
 *
 * The layout already enforces the ACTIVE status guard.
 * Profile completion is never required to access the dashboard (C01 §7);
 * users can navigate to `/onboarding/profile` or `/settings` at any time.
 */
export default async function DashboardPage() {
  const result = await getAppUserResult();
  const user = result.data;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <section className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-feedback-success-border bg-feedback-success-background px-3 py-1 text-caption font-medium text-feedback-success-text">
            <CheckCircleIcon className="h-3.5 w-3.5 text-feedback-success-icon" />
            Active Account
          </span>
        </div>

        <h1 className="mt-4 text-heading-xl text-text-primary">Dashboard</h1>
        <p className="mt-2 text-body text-text-secondary">
          Welcome{user?.email ? `, ${user.email}` : ""}! Your account is active.
        </p>
        <p className="mt-1 text-body-sm text-text-muted">
          Career guidance features will be available in upcoming phases.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Link href="/onboarding/profile" className={primaryLinkClass}>
            প্রোফাইল সেটআপ (Profile Setup)
          </Link>
          <Link href="/settings" className={secondaryLinkClass}>
            অ্যাকাউন্ট ও সেটিংস (Settings)
          </Link>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="md">
              Sign Out
            </Button>
          </form>
        </div>
      </section>

      <section
        aria-label="Workspace shortcuts"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-border-subtle bg-surface-raised p-5 shadow-xs">
          <div>
            <h2 className="text-heading-sm text-text-primary">
              প্রোফাইল ও অভিজ্ঞতা (Profile Setup)
            </h2>
            <p className="mt-1.5 text-body-sm text-text-secondary">
              আপনার বর্তমান পেশা, অভিজ্ঞতার স্তর এবং দৈনিক অধ্যয়নের লক্ষ্যমাত্রা আপডেট করুন।
            </p>
          </div>
          <Link
            href="/onboarding/profile"
            className="inline-flex min-h-11 w-fit items-center text-label-lg text-text-link underline underline-offset-4 hover:text-text-link-hover"
          >
            প্রোফাইল সম্পাদনা করুন &rarr;
          </Link>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-xl border border-border-subtle bg-surface-raised p-5 shadow-xs">
          <div>
            <h2 className="text-heading-sm text-text-primary">
              অ্যাকাউন্ট ও সেটিংস (Settings)
            </h2>
            <p className="mt-1.5 text-body-sm text-text-secondary">
              যোগাযোগের মাধ্যম যাচাই, সোশ্যাল অ্যাকাউন্ট সংযোগ এবং টাইমজোন পরিচালনা করুন।
            </p>
          </div>
          <Link
            href="/settings"
            className="inline-flex min-h-11 w-fit items-center text-label-lg text-text-link underline underline-offset-4 hover:text-text-link-hover"
          >
            সেটিংস দেখুন &rarr;
          </Link>
        </div>
      </section>
    </main>
  );
}
