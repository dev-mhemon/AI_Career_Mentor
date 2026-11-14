import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI Career Mentor",
  description:
    "Your personal AI-powered career mentor for personalized guidance and structured learning.",
};

/**
 * Layout for auth routes (/login, /register, /verify, /forgot-password, /reset-password).
 * Brand header + elevated card on a subtle canvas.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-surface-canvas px-4 py-8 sm:py-12">
      <div className="flex w-full flex-col gap-6" style={{ maxWidth: "var(--size-form-max)" }}>
        <header className="flex flex-col items-center gap-1.5 text-center">
          <Link
            href="/"
            className="group flex flex-col items-center gap-2 rounded-md px-3 py-1 transition-opacity hover:opacity-90"
          >
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-lg bg-action-primary-background text-action-primary-foreground shadow-md"
            >
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 2 8l10 5 10-5-10-5z" />
                <path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" />
              </svg>
            </span>
            <span className="text-heading-md text-text-primary transition-colors group-hover:text-text-brand">
              AI Career Mentor
            </span>
          </Link>
          <p className="text-body-sm text-text-secondary">
            Your personal guide to a structured learning path.
          </p>
        </header>
        <div className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
          {children}
        </div>
        <Link
          href="/"
          className="mx-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-label-lg text-text-secondary transition-colors hover:text-text-brand hover:underline"
        >
          <span aria-hidden="true">←</span>
          Back to Home
        </Link>
      </div>
    </div>
  );
}
