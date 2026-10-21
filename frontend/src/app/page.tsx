import Link from "next/link";

/**
 * Landing page — explains the product value.
 * UI/UX Spec §5 Landing: Introduction, Benefits, Register/Login.
 */
export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-4">
      <main className="flex w-full max-w-lg flex-col items-center gap-8 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          AI Career Mentor
        </h1>
        <p className="max-w-md text-lg leading-8 text-foreground/70">
          Your personal AI-powered career mentor. Get personalized career
          guidance, structured learning plans, and track your professional
          growth.
        </p>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/register"
            className="inline-flex h-12 items-center justify-center rounded-lg bg-foreground px-6 text-base font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-lg border border-foreground/20 px-6 text-base font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Sign In
          </Link>
        </div>
      </main>
    </div>
  );
}
