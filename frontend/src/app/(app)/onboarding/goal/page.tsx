import { redirect } from 'next/navigation';
import { getAppUserResult } from '@/lib/auth/user';
import { withSingleSessionRefresh } from '@/lib/auth/actions';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  ApiError,
  dispatchM05Operation,
  type M05OperationInput,
  type M05OperationName,
  type M05OperationOutput,
} from '@/lib/api/client';
import { toActionFailure, type ActionResult } from '@/lib/api/error-mapper';
import { GoalSetupForm } from '@/components/onboarding/goal-setup-form';
import { AppShellSync } from '@/components/ui/app-shell-context';

/** Operations this screen may run through its server action (EP-C01). */
const ALLOWED_OPERATIONS: ReadonlySet<M05OperationName> = new Set(['createCareerGoal']);

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

/** Server Action handed to the client form; keeps the access token on the server. */
async function invoke<K extends M05OperationName>(
  op: K,
  input: M05OperationInput<K>,
): Promise<ActionResult<M05OperationOutput<K>>> {
  'use server';
  if (!ALLOWED_OPERATIONS.has(op)) {
    return toActionFailure(new ApiError(403, 'Operation not allowed', 'INVALID_OPERATION'));
  }
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) redirect('/login');
    const data = await withSingleSessionRefresh(supabase, session, (token) =>
      dispatchM05Operation(token, op, input),
    );
    return { ok: true, data };
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return toActionFailure(err);
  }
}

/**
 * Screen 10 (`/onboarding/goal`) — Step 4 of 5. Submits `goal_text` via EP-C01.
 */
export default async function OnboardingGoalPage() {
  const userResult = await getAppUserResult();
  if (userResult.status === 'unauthenticated') redirect('/login');
  const user = userResult.data;
  if (user && user.status === 'suspended') redirect('/settings');

  return (
    <>
      <AppShellSync variant={user?.role === 'ADMIN' ? 'admin' : 'authenticated'} />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <div className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
          <GoalSetupForm invoke={invoke} />
        </div>
      </main>
    </>
  );
}
