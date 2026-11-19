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
import { CareerProfileView } from '@/components/career/career-profile-view';
import { AppShellSync } from '@/components/ui/app-shell-context';

/** Operations this screen may run through its server action (EP-C02, EP-C06, EP-C07). */
const ALLOWED_OPERATIONS: ReadonlySet<M05OperationName> = new Set([
  'listCareerGoals',
  'getProfile',
  'updateCareerGoal',
  'deleteCareerGoal',
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

/** Server Action handed to the client view; keeps the access token on the server. */
async function invoke<K extends M05OperationName>(
  op: K,
  input: M05OperationInput<K>,
): Promise<ActionResult<M05OperationOutput<K>>> {
  'use server';
  return runOperation(op, input, false);
}

/**
 * Screen 14 (`/career-profile`) — goals (EP-C02, EP-C06, EP-C07) plus skills and preferences (EP-P01).
 * Goals and profile load independently so one failing read never hides the other.
 */
export default async function CareerProfilePage() {
  const userResult = await getAppUserResult();
  if (userResult.status === 'unauthenticated') redirect('/login');
  const user = userResult.data;
  if (user && user.status === 'suspended') redirect('/settings');

  const [goalsResult, profileResult] = await Promise.all([
    runOperation('listCareerGoals', { limit: 100 }, true),
    runOperation('getProfile', undefined, true),
  ]);
  if (
    (!goalsResult.ok && goalsResult.error.requiresSignIn) ||
    (!profileResult.ok && profileResult.error.requiresSignIn)
  ) {
    redirect('/login');
  }

  return (
    <>
      <AppShellSync variant={user?.role === 'ADMIN' ? 'admin' : 'authenticated'} />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
        <CareerProfileView
          initialGoals={goalsResult.ok ? goalsResult.data.items : []}
          initialNextCursor={goalsResult.ok ? goalsResult.data.meta.next_cursor : null}
          goalsError={goalsResult.ok ? null : goalsResult.error.message}
          profile={profileResult.ok ? profileResult.data : null}
          profileError={profileResult.ok ? null : profileResult.error.message}
          invoke={invoke}
        />
      </main>
    </>
  );
}
