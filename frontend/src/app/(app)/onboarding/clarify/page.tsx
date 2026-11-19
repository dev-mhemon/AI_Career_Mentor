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
import { GoalClarifyForm } from '@/components/onboarding/goal-clarify-form';
import { AppShellSync } from '@/components/ui/app-shell-context';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Operations this screen may run through its server action (EP-C03, EP-C04, EP-C05). */
const ALLOWED_OPERATIONS: ReadonlySet<M05OperationName> = new Set([
  'getCareerGoal',
  'submitGoalClarification',
  'confirmCareerGoal',
]);

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

async function runOperation<K extends M05OperationName>(
  op: K,
  input: M05OperationInput<K>,
  readOnly: boolean,
): Promise<ActionResult<M05OperationOutput<K>>> {
  if (!ALLOWED_OPERATIONS.has(op)) {
    return toActionFailure(new ApiError(403, 'Operation not allowed', 'INVALID_OPERATION'));
  }
  try {
    const supabase = await createSupabaseServerClient(readOnly ? { readOnly: true } : undefined);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) redirect('/login');
    const data = readOnly
      ? await dispatchM05Operation(session.access_token, op, input)
      : await withSingleSessionRefresh(supabase, session, (token) =>
          dispatchM05Operation(token, op, input),
        );
    return { ok: true, data };
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return toActionFailure(err);
  }
}

/** Server Action handed to the client form; keeps the access token on the server. */
async function invoke<K extends M05OperationName>(
  op: K,
  input: M05OperationInput<K>,
): Promise<ActionResult<M05OperationOutput<K>>> {
  'use server';
  return runOperation(op, input, false);
}

/**
 * Screen 11 (`/onboarding/clarify?goalId=<id>`) — Step 5 of 5.
 * Loads the goal (EP-C03), then the client form drives EP-C04 answers and EP-C05 confirmation.
 */
export default async function OnboardingClarifyPage({
  searchParams,
}: {
  searchParams: Promise<{ goalId?: string | string[] }>;
}) {
  const userResult = await getAppUserResult();
  if (userResult.status === 'unauthenticated') redirect('/login');
  const user = userResult.data;
  if (user && user.status === 'suspended') redirect('/settings');

  const params = await searchParams;
  const goalId = Array.isArray(params.goalId) ? params.goalId[0] : params.goalId;
  if (!goalId || !UUID_PATTERN.test(goalId.trim())) redirect('/onboarding/goal');

  const goalResult = await runOperation('getCareerGoal', { id: goalId.trim() }, true);
  if (!goalResult.ok && goalResult.error.requiresSignIn) redirect('/login');

  return (
    <>
      <AppShellSync variant={user?.role === 'ADMIN' ? 'admin' : 'authenticated'} />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <div className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
          <GoalClarifyForm
            key={goalId}
            goal={goalResult.ok ? goalResult.data : null}
            loadError={goalResult.ok ? null : goalResult.error.message}
            invoke={invoke}
          />
        </div>
      </main>
    </>
  );
}
