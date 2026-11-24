import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { MentorContextType } from '@/lib/api/client';
import { logoutAction } from '@/lib/auth/actions';
import { getAuthenticatedShellUser } from '@/lib/auth/shell-user';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MentorChatView } from '@/components/mentor/mentor-chat-view';
import { Alert } from '@/components/ui/alert';
import { AppShellSync } from '@/components/ui/app-shell-context';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

type MentorPageProps = {
  searchParams?: Promise<{
    context?: string | string[];
    topicId?: string | string[];
  }>;
};

function parseFirstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].trim() || undefined;
  }
  return undefined;
}

function parseInitialContext(raw?: string): MentorContextType | undefined {
  if (raw === 'focus_roadmap' || raw === 'topic' || raw === 'general') {
    return raw;
  }
  return undefined;
}

function parseInitialTopicId(raw?: string): string | undefined {
  if (raw && UUID_PATTERN.test(raw)) {
    return raw.toLowerCase();
  }
  return undefined;
}

function buildMentorRetryHref(
  context?: MentorContextType,
  topicId?: string,
): string {
  const params = new URLSearchParams();
  if (context) {
    params.set('context', context);
  }
  if (topicId) {
    params.set('topicId', topicId);
  }
  const qs = params.toString();
  return qs ? `/mentor?${qs}` : '/mentor';
}

/**
 * Screen 20 (`/mentor`): Contextual AI Career Mentor Chat (`C09` §3.4, `C05` §14.10).
 */
export default async function MentorPage({ searchParams }: MentorPageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialContext = parseInitialContext(
    parseFirstString(resolvedParams?.context),
  );
  const initialTopicId = parseInitialTopicId(
    parseFirstString(resolvedParams?.topicId),
  );
  const retryHref = buildMentorRetryHref(initialContext, initialTopicId);

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
                We could not load your AI Career Mentor right now. Please try
                again in a moment.
              </Alert>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href={retryHref} className={primaryLinkClass}>
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
  const aiMentorEnabled = state.effective_access.ai_mentor ?? true;

  return (
    <>
      <AppShellSync
        variant={state.user.role === 'ADMIN' ? 'admin' : 'authenticated'}
        user={shellUser}
      />
      <MentorChatView
        accessToken={accessToken}
        aiMentorEnabled={aiMentorEnabled}
        initialContext={initialContext}
        initialTopicId={initialTopicId}
      />
    </>
  );
}
