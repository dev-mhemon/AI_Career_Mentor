import Link from 'next/link';
import { requireFastSessionShell } from '@/lib/auth/shell-user';

function BrandBadgeIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
    >
      <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9L12 2.5Z" />
      <path d="M12 7v10" />
      <path d="m7.5 10.5 4.5-3.5 4.5 3.5" />
      <circle cx="12" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Distraction-free layout for the sibling `(onboarding)` route group.
 * Guards access with the shared fast cookie session check, rendering only a
 * minimal brand bar and a clean "Go to Dashboard" escape link (no AppShell or Sidebar).
 */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireFastSessionShell();

  return (
    <div className="flex min-h-screen flex-col bg-surface-canvas text-text-primary">
      <header className="sticky top-0 z-20 border-b border-border-subtle bg-surface-default/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-600 to-teal-500 text-white shadow-xs">
              <BrandBadgeIcon />
            </span>
            <span className="text-sm font-semibold tracking-tight text-text-primary">
              AI Career Mentor
            </span>
          </Link>

          <Link
            href="/dashboard"
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-default bg-surface-default px-3.5 py-2 text-label-md font-medium text-text-primary transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            Go to Dashboard
          </Link>
        </div>
      </header>

      <div
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 flex-col outline-none focus:outline-none focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
