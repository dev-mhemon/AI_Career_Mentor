import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAppUser } from '@/lib/auth/user';
import { logoutAction } from '@/lib/auth/actions';
import { loadProfileForSetup } from '@/lib/profile/actions';
import { ProfileSetupForm } from '@/components/onboarding/profile-setup-form';

/**
 * Screen 07 (`/onboarding/profile`) — Server Component for initial profile setup.
 * Consumes EP-P01 (`GET /api/v1/profile`), EP-P02 (`PATCH /api/v1/profile`), and EP-P04 (`PATCH /api/v1/profile/learning-settings`).
 */
export default async function OnboardingProfilePage() {
  const user = await getAppUser();

  if (!user) {
    redirect('/login');
  }

  if (user.status === 'suspended') {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          আপনার অ্যাকাউন্ট স্থগিত আছে
        </h1>
        <p className="mb-6 text-sm text-foreground/70">
          অ্যাকাউন্ট মুছে ফেলার অধিকার বজায় আছে। এই foundation-এ deletion screen এখনো বাস্তবায়িত হয়নি।
        </p>
        <form action={logoutAction}>
          <button
            type="submit"
            className="h-11 rounded-lg border border-foreground/20 px-6 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Sign Out
          </button>
        </form>
      </main>
    );
  }

  const { profile, loadError, unauthorized, suspended } =
    await loadProfileForSetup();

  if (unauthorized) {
    redirect('/login');
  }

  if (suspended) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          আপনার অ্যাকাউন্ট স্থগিত আছে
        </h1>
        <p className="mb-6 text-sm text-foreground/70">
          অ্যাকাউন্ট মুছে ফেলার অধিকার বজায় আছে। এই foundation-এ deletion screen এখনো বাস্তবায়িত হয়নি।
        </p>
        <form action={logoutAction}>
          <button
            type="submit"
            className="h-11 rounded-lg border border-foreground/20 px-6 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Sign Out
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <span className="text-base font-semibold">AI Career Mentor</span>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-foreground/80 underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              ড্যাশবোর্ড (Dashboard)
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="h-9 rounded-md border border-foreground/20 px-3 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            প্রোফাইল সেটআপ (Profile Setup)
          </h1>
          <p className="mt-2 text-sm text-foreground/70">
            আপনার বর্তমান ভূমিকা, অভিজ্ঞতার স্তর এবং শেখার সময়সূচি দিন। শিক্ষাগত যোগ্যতা ঐচ্ছিক এবং প্রোফাইল সম্পূর্ণ না করেও ড্যাশবোর্ডে যাওয়া যাবে।
          </p>
        </div>

        <ProfileSetupForm initialProfile={profile} loadError={loadError} />
      </main>
    </div>
  );
}
