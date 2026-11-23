import Link from 'next/link';
import { redirect } from 'next/navigation';
import { logoutAction } from '@/lib/auth/actions';
import { getAuthenticatedShellUser } from '@/lib/auth/shell-user';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { TodayView } from '@/components/learning/today-view';
import { Alert } from '@/components/ui/alert';
import { AppShellSync } from '@/components/ui/app-shell-context';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

/**
 * Today Learning Hub (`/today`, Screen 17): active Focus Roadmap current sequential day,
 * grounded AI lesson explanation, verified learning resources, and M08 quiz handoff readiness.
 */
export default async function TodayPage() {
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
                We could not load today&apos;s lesson right now. Please try again in a moment.
              </Alert>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href="/today" className={primaryLinkClass}>
                  Try Again
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
  if (state.user.status === 'suspended') {
    redirect('/settings');
  }

  const supabase = await createSupabaseServerClient({ readOnly: true });
  const sessionRes = await supabase.auth.getSession();
  const accessToken = sessionRes?.data?.session?.access_token;
  if (!accessToken) {
    redirect('/login');
  }

  const shellUser = await getAuthenticatedShellUser(state.user);
  const dailyPlanEnabled = state.effective_access.daily_plan ?? true;
  const quizPracticeEnabled = state.effective_access.quiz_practice ?? true;

  return (
    <>
      <AppShellSync
        variant={state.user.role === 'ADMIN' ? 'admin' : 'authenticated'}
        user={shellUser}
      />
      <TodayView
        accessToken={accessToken}
        dailyPlanEnabled={dailyPlanEnabled}
        quizPracticeEnabled={quizPracticeEnabled}
      />
    </>
  );
}
