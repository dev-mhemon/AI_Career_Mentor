import { redirect } from 'next/navigation';
import { getAppUserResult } from '@/lib/auth/user';
import { withSingleSessionRefresh } from '@/lib/auth/actions';
import {
  readLiveAuthUser,
  resolveContactChannels,
  type ChannelConfirmationUser,
} from '@/lib/auth/workspace-profile';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  loadProfileForSetup,
  type ProfileContactInfo,
} from '@/lib/profile/actions';
import { extractMetadataProfile } from '@/lib/profile/metadata';
import {
  ApiError,
  dispatchM05Operation,
  type M05OperationInput,
  type M05OperationName,
  type M05OperationOutput,
} from '@/lib/api/client';
import { toActionFailure, type ActionResult } from '@/lib/api/error-mapper';
import { computeProfileCompletion } from '@/lib/onboarding/completion';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';

export const dynamic = 'force-dynamic';

/** Operations allowed by the unified onboarding wizard (EP-P01..P05, EP-C01..C06). */
const ALLOWED_OPERATIONS: ReadonlySet<M05OperationName> = new Set([
  'getProfile',
  'updateProfile',
  'updateSkills',
  'interpretSkillAlias',
  'updatePreferences',
  'updateLearningSettings',
  'createCareerGoal',
  'listCareerGoals',
  'getCareerGoal',
  'submitGoalClarification',
  'confirmCareerGoal',
  'updateCareerGoal',
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
    return toActionFailure(
      new ApiError(403, 'Operation not allowed', 'INVALID_OPERATION'),
    );
  }
  try {
    const supabase = await createSupabaseServerClient(
      readOnly ? { readOnly: true } : undefined,
    );
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

/** Unified Server Action handed to `<OnboardingWizard />`; keeps the access token on the server. */
async function invoke<K extends M05OperationName>(
  op: K,
  input: M05OperationInput<K>,
): Promise<ActionResult<M05OperationOutput<K>>> {
  'use server';
  return runOperation(op, input, false);
}

/**
 * Unified Multi-Step Onboarding Wizard (`/onboarding`) — Screens 07–11.
 *
 * - Fetches live profile (`EP-P01`) and non-discontinued career goals (`EP-C02`) server-side (`cache: 'no-store'`).
 * - **100% Lock Rule:** Completed users immediately redirect to `/dashboard`.
 * - **Smart Resume Rule:** Incomplete users resume directly on `completion.firstIncompleteStep`.
 */
export default async function OnboardingPage() {
  const userResult = await getAppUserResult();
  if (userResult.status === 'unauthenticated') {
    redirect('/login');
  }
  const user = userResult.data;
  if (user?.status === 'suspended') {
    redirect('/settings');
  }

  const [profileSnapshot, goalsResult, liveAuthUser] = await Promise.all([
    loadProfileForSetup(),
    runOperation('listCareerGoals', undefined, true),
    readLiveAuthUser(),
  ]);

  if (
    profileSnapshot.unauthorized ||
    (!goalsResult.ok && goalsResult.error.requiresSignIn)
  ) {
    redirect('/login');
  }

  if (profileSnapshot.suspended) {
    redirect('/settings');
  }

  const meta = extractMetadataProfile(liveAuthUser?.user_metadata);
  const resolvedFullName = meta.fullName ?? profileSnapshot.fullName ?? '';
  const contactChannels = resolveContactChannels({
    user: (user ?? {}) as ChannelConfirmationUser,
    liveAuthUser,
    profileContactEmail: meta.contactEmail ?? profileSnapshot.contactEmail,
    profileContactPhone: meta.contactPhone ?? profileSnapshot.contactPhone,
  });

  const initialContact: ProfileContactInfo = {
    email: contactChannels.displayedEmail ?? '',
    emailVerified: contactChannels.emailVerified,
    phone: contactChannels.rawDisplayedPhone ?? '',
    phoneVerified: contactChannels.phoneVerified,
  };

  const nonDiscontinuedGoals = goalsResult.ok
    ? goalsResult.data.items.filter((g) => g.status !== 'discontinued')
    : [];

  const completion = computeProfileCompletion(
    profileSnapshot.profile,
    nonDiscontinuedGoals,
    resolvedFullName,
  );

  // 100% Lock Rule: completed users never re-enter the onboarding wizard.
  if (completion.isComplete) {
    redirect('/dashboard');
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <OnboardingWizard
        initialStep={completion.firstIncompleteStep}
        initialProfile={profileSnapshot.profile}
        initialGoals={nonDiscontinuedGoals}
        initialContact={initialContact}
        initialFullName={resolvedFullName}
        userId={profileSnapshot.userId ?? user?.id}
        profileLoadError={profileSnapshot.loadError ?? null}
        goalsLoadError={goalsResult.ok ? null : goalsResult.error.message}
        invoke={invoke}
      />
    </main>
  );
}
