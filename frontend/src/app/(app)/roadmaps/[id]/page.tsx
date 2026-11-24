import Link from 'next/link';
import { redirect } from 'next/navigation';
import { logoutAction } from '@/lib/auth/actions';
import { getAuthenticatedShellUser } from '@/lib/auth/shell-user';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  RoadmapDetailView,
  type RoadmapDetailTab,
} from '@/components/roadmap/roadmap-detail-view';
import { Alert } from '@/components/ui/alert';
import { AppShellSync } from '@/components/ui/app-shell-context';
import { Button } from '@/components/ui/button';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-5 text-label-lg font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

function resolveInitialTab(raw?: string | string[]): RoadmapDetailTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    value === 'active' ||
    value === 'outline' ||
    value === 'merges' ||
    value === 'versions'
  ) {
    return value;
  }
  return 'active';
}

/**
 * Screen 15 (`/roadmaps/[id]`): Locked / Archived Roadmap viewer, Merge Proposals / Diff / Undo,
 * Version History, Focus Switcher (`EP-R14`), and Archive flow (`EP-R15`).
 */
export default async function RoadmapDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;
  const initialTab = resolveInitialTab(resolvedSearch?.tab);
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
                We could not load this roadmap right now. Please try again in a moment.
              </Alert>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href={`/roadmaps/${encodeURIComponent(id)}`}
                  className={primaryLinkClass}
                >
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

  return (
    <>
      <AppShellSync
        variant={state.user.role === 'ADMIN' ? 'admin' : 'authenticated'}
        user={shellUser}
      />
      <RoadmapDetailView
        accessToken={accessToken}
        roadmapId={id}
        initialTab={initialTab}
        roadmapGeneratorEnabled={
          state.effective_access.roadmap_generator !== false
        }
      />
    </>
  );
}
