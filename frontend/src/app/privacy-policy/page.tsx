import type { Metadata } from "next";
import Link from "next/link";

const PRIVACY_CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL?.trim() ||
  "privacy@aicareermentor.app";

const LAST_UPDATED_DATE = "November 26, 2026";

export const metadata: Metadata = {
  title: "Privacy Policy | AI Career Mentor",
  description:
    "How AI Career Mentor collects, uses, protects, retains, and deletes personal data, including Facebook Login, Google Sign-In, and user data deletion instructions.",
};

function BrandMark() {
  return (
    <svg
      width={19}
      height={19}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9L12 2.5Z" />
      <path d="M12 7v10" />
      <path d="m7.5 10.5 4.5-3.5 4.5 3.5" />
      <circle cx="12" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const QUICK_LINKS = [
  { href: "#information-we-collect", label: "Information We Collect" },
  { href: "#how-we-use-information", label: "How We Use Information" },
  { href: "#third-party-services", label: "Third-Party Services" },
  { href: "#cookies-and-sessions", label: "Cookies & Sessions" },
  { href: "#data-deletion", label: "Retention & Data Deletion" },
  { href: "#rights-and-contact", label: "Your Rights & Contact" },
] as const;

export default function PrivacyPolicyPage() {
  return (
    <div className="flex flex-1 flex-col bg-surface-canvas text-text-primary">
      <header className="sticky top-0 z-(--z-header) border-b border-border-subtle bg-surface-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 w-full max-w-4xl items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 rounded-md px-1 text-heading-sm font-semibold tracking-tight text-text-primary transition-colors duration-(--duration-fast) ease-standard hover:text-text-brand"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-600 to-accent-600 text-static-white shadow-sm"
            >
              <BrandMark />
            </span>
            <span>AI Career Mentor</span>
          </Link>

          <nav aria-label="Privacy policy navigation" className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-label font-medium text-text-secondary transition-colors duration-(--duration-fast) ease-standard hover:bg-action-ghost-background-hover hover:text-text-primary"
            >
              Home
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-action-primary-background px-4 text-label font-semibold text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active"
            >
              Sign In
            </Link>
          </nav>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 outline-none focus:outline-none focus-visible:outline-none sm:px-6 sm:py-14 lg:px-8"
      >
        <article className="flex flex-col gap-8">
          <div className="rounded-2xl border border-border-default bg-surface-raised p-6 shadow-sm sm:p-8">
            <span className="text-overline uppercase text-text-brand">
              Legal &amp; Data Protection
            </span>
            <h1 className="mt-2 text-heading-xl text-text-primary sm:text-display">
              Privacy Policy
            </h1>
            <p className="mt-2 text-body-sm text-text-secondary">
              Last updated: <time dateTime="2026-11-26">{LAST_UPDATED_DATE}</time>
            </p>
            <p className="mt-4 text-body leading-relaxed text-text-secondary">
              This Privacy Policy explains how{" "}
              <strong className="font-semibold text-text-primary">
                AI Career Mentor
              </strong>{" "}
              collects, uses, stores, protects, and deletes your personal
              information when you visit our website, create an account, sign in
              using Email, Phone OTP, Google Sign-In, or Facebook Login, or use
              our personalized career roadmap, daily study plan, quiz, and AI
              mentor features.
            </p>

            <nav
              aria-label="Policy sections"
              className="mt-6 flex flex-wrap gap-2 border-t border-border-subtle pt-5"
            >
              {QUICK_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-10 items-center rounded-full border border-border-default bg-surface-subtle px-3.5 text-caption font-medium text-text-secondary transition-colors duration-(--duration-fast) ease-standard hover:border-border-strong hover:text-text-primary"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>

          <div className="flex flex-col gap-6 rounded-2xl border border-border-default bg-surface-raised p-6 shadow-sm sm:p-8">
            <section
              id="information-we-collect"
              aria-labelledby="heading-information-we-collect"
              className="scroll-mt-24 flex flex-col gap-3"
            >
              <h2
                id="heading-information-we-collect"
                className="text-heading-md text-text-primary"
              >
                1. Information We Collect
              </h2>
              <p className="text-body leading-relaxed text-text-secondary">
                We collect only the information needed to authenticate your
                account, personalize your structured learning path, and keep the
                platform secure:
              </p>
              <ul className="flex list-disc flex-col gap-2.5 pl-5 text-body leading-relaxed text-text-secondary">
                <li>
                  <strong className="font-semibold text-text-primary">
                    Account &amp; Authentication Data:
                  </strong>{" "}
                  Your email address, mobile phone number (for SMS one-time
                  passcode verification), account verification status, and basic
                  profile information supplied when you choose to sign in with
                  third-party OAuth providers—specifically{" "}
                  <strong className="font-semibold text-text-primary">
                    Facebook Login
                  </strong>{" "}
                  and{" "}
                  <strong className="font-semibold text-text-primary">
                    Google Sign-In
                  </strong>{" "}
                  (such as your name, email address if permitted, and
                  provider-scoped account ID). Passwords are handled securely by
                  our authentication service and are never stored in plaintext.
                </li>
                <li>
                  <strong className="font-semibold text-text-primary">
                    Learning &amp; Profile Data:
                  </strong>{" "}
                  Your career goals, target role levels, self-reported skill
                  levels (including explicit beginner selections), timezone and
                  daily study-hour preferences, generated and locked career
                  roadmaps, daily study plans, quiz attempts and responses,
                  practice reviews, and AI mentor conversation history.
                </li>
                <li>
                  <strong className="font-semibold text-text-primary">
                    Technical &amp; Security Data:
                  </strong>{" "}
                  Essential session cookies, IP address, and basic HTTP request
                  metadata used strictly for authentication, session integrity,
                  rate limiting, and abuse prevention.
                </li>
              </ul>
            </section>

            <hr className="border-border-subtle" />

            <section
              id="how-we-use-information"
              aria-labelledby="heading-how-we-use-information"
              className="scroll-mt-24 flex flex-col gap-3"
            >
              <h2
                id="heading-how-we-use-information"
                className="text-heading-md text-text-primary"
              >
                2. How We Use Your Information
              </h2>
              <p className="text-body leading-relaxed text-text-secondary">
                We use the information we collect exclusively to deliver and
                protect AI Career Mentor:
              </p>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-body leading-relaxed text-text-secondary">
                <li>
                  Authenticating your account, linking chosen OAuth sign-in
                  methods (Facebook Login or Google Sign-In), and verifying your
                  email address or phone number.
                </li>
                <li>
                  Generating personalized skill-gap diagnostics, phased career
                  roadmaps, timezone-calibrated daily study plans, quizzes,
                  practice feedback, and AI mentor responses in English or
                  Bangla.
                </li>
                <li>
                  Tracking your learning progress, skill state transitions, and
                  roadmap history across your workspace.
                </li>
                <li>
                  Protecting accounts and infrastructure against brute-force
                  attempts, automated abuse, and unauthorized access.
                </li>
              </ul>
            </section>

            <hr className="border-border-subtle" />

            <section
              id="third-party-services"
              aria-labelledby="heading-third-party-services"
              className="scroll-mt-24 flex flex-col gap-3"
            >
              <h2
                id="heading-third-party-services"
                className="text-heading-md text-text-primary"
              >
                3. Third-Party Services &amp; Data Sharing
              </h2>
              <div className="rounded-xl border border-feedback-info-border bg-feedback-info-background px-4 py-3 text-body-sm text-feedback-info-text">
                <strong className="font-semibold">
                  We do not sell your personal data.
                </strong>{" "}
                Your private learning records, quiz responses, and AI mentor
                conversations are isolated to your account and are never sold to
                data brokers or advertisers.
              </div>
              <p className="text-body leading-relaxed text-text-secondary">
                To operate AI Career Mentor reliably, we rely on a limited set
                of infrastructure and service providers that process data only
                on our behalf:
              </p>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-body leading-relaxed text-text-secondary">
                <li>
                  <strong className="font-semibold text-text-primary">
                    Authentication &amp; Database Hosting:
                  </strong>{" "}
                  Managed authentication and PostgreSQL database infrastructure
                  (Supabase) to store accounts and tenant-isolated learning
                  records securely.
                </li>
                <li>
                  <strong className="font-semibold text-text-primary">
                    OAuth Identity Providers:
                  </strong>{" "}
                  Meta (Facebook Login) and Google (Google Sign-In), solely when
                  you initiate sign-in or account linking through those
                  providers.
                </li>
                <li>
                  <strong className="font-semibold text-text-primary">
                    AI Content Processing:
                  </strong>{" "}
                  Configured AI model services used to generate personalized
                  roadmaps, study guidance, quiz evaluations, and mentor
                  answers.
                </li>
                <li>
                  <strong className="font-semibold text-text-primary">
                    SMS &amp; Email Verification Delivery:
                  </strong>{" "}
                  Transactional SMS and email providers used solely to deliver
                  one-time verification and password-recovery codes.
                </li>
                <li>
                  <strong className="font-semibold text-text-primary">
                    Security &amp; Rate-Limiting Cache:
                  </strong>{" "}
                  Short-lived abuse-control and idempotency storage using
                  hashed identifiers (never storing raw OTP codes or passwords).
                </li>
              </ul>
            </section>

            <hr className="border-border-subtle" />

            <section
              id="cookies-and-sessions"
              aria-labelledby="heading-cookies-and-sessions"
              className="scroll-mt-24 flex flex-col gap-3"
            >
              <h2
                id="heading-cookies-and-sessions"
                className="text-heading-md text-text-primary"
              >
                4. Cookies &amp; Session Management
              </h2>
              <p className="text-body leading-relaxed text-text-secondary">
                AI Career Mentor uses essential authentication, OAuth PKCE
                callback, and session-preference cookies to keep you signed in
                securely, validate third-party sign-in callbacks (Facebook Login
                or Google Sign-In), and respect your &ldquo;Keep Signed
                In&rdquo; preference. Cookies are protected with{" "}
                <code className="font-mono text-code text-text-primary">
                  SameSite
                </code>{" "}
                restrictions (
                <code className="font-mono text-code text-text-primary">
                  Lax
                </code>{" "}
                or{" "}
                <code className="font-mono text-code text-text-primary">
                  Strict
                </code>
                ),{" "}
                <code className="font-mono text-code text-text-primary">
                  Secure
                </code>{" "}
                attributes over HTTPS in production, and{" "}
                <code className="font-mono text-code text-text-primary">
                  HttpOnly
                </code>{" "}
                on server-only verification cookies where browser script access
                is not required (standard Supabase authentication session and
                remember-me preference cookies remain readable by our browser
                client to maintain your session). We do not set third-party
                advertising or cross-site behavioral tracking cookies.
              </p>
            </section>

            <hr className="border-border-subtle" />

            <section
              id="data-deletion"
              aria-labelledby="heading-data-deletion"
              className="scroll-mt-24 flex flex-col gap-4"
            >
              <h2
                id="heading-data-deletion"
                className="text-heading-md text-text-primary"
              >
                5. Data Retention &amp; User Data Deletion
              </h2>
              <p className="text-body leading-relaxed text-text-secondary">
                We retain your account profile, career roadmaps, and learning
                progress while your account remains active and until you delete
                your account. Raw free-response quiz text and AI mentor messages
                are subject to a 90-day retention window (expired items are no
                longer surfaced in the product and are eligible for periodic
                database cleanup where scheduled), and operational AI request
                logs are subject to a 30-day retention window and periodic
                cleanup, or removed when your account is deleted.
              </p>

              <div className="rounded-xl border border-border-default bg-surface-subtle p-5">
                <h3 className="text-heading-sm text-text-primary">
                  Option A: Delete Your Account Directly In-App
                </h3>
                <p className="mt-1.5 text-body-sm leading-relaxed text-text-secondary">
                  Active users—as well as suspended users who have a verified
                  contact and can sign in—can permanently delete their AI Career
                  Mentor account and associated personal data directly inside
                  the application:
                </p>
                <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-body-sm leading-relaxed text-text-secondary">
                  <li>
                    Sign in to{" "}
                    <Link
                      href="/login"
                      className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
                    >
                      AI Career Mentor
                    </Link>{" "}
                    and navigate to{" "}
                    <strong className="font-semibold text-text-primary">
                      Settings &rarr; Account Deletion
                    </strong>
                    .
                  </li>
                  <li>
                    Select{" "}
                    <strong className="font-semibold text-text-primary">
                      Delete Account
                    </strong>{" "}
                    and complete the re-authentication confirmation step.
                  </li>
                  <li>
                    Our account deletion workflow revokes active sessions and
                    permanently removes your account profile, linked OAuth
                    identities, career roadmaps, study plans, quiz records, and
                    AI mentor conversations.
                  </li>
                </ol>
                <p className="mt-3 text-body-sm leading-relaxed text-text-secondary">
                  If your account is suspended without a verified contact or you
                  are otherwise unable to sign in to reach{" "}
                  <strong className="font-semibold text-text-primary">
                    Settings
                  </strong>
                  , email{" "}
                  <a
                    href={`mailto:${PRIVACY_CONTACT_EMAIL}?subject=Account%20Deletion%20Request%20-%20AI%20Career%20Mentor`}
                    className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
                  >
                    {PRIVACY_CONTACT_EMAIL}
                  </a>{" "}
                  and we will process your permanent deletion request.
                </p>
              </div>

              <div className="rounded-xl border border-border-default bg-surface-subtle p-5">
                <h3 className="text-heading-sm text-text-primary">
                  Option B: Facebook Login Users (Revoking Access &amp; Deletion
                  Requests)
                </h3>
                <p className="mt-1.5 text-body-sm leading-relaxed text-text-secondary">
                  If you signed in with Facebook, you can disconnect AI Career
                  Mentor from your Facebook account at any time:
                </p>
                <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-body-sm leading-relaxed text-text-secondary">
                  <li>
                    Open your Facebook account and go to{" "}
                    <strong className="font-semibold text-text-primary">
                      Settings &amp; Privacy &rarr; Settings &rarr; Apps and
                      Websites
                    </strong>
                    .
                  </li>
                  <li>
                    Locate{" "}
                    <strong className="font-semibold text-text-primary">
                      AI Career Mentor
                    </strong>{" "}
                    and choose{" "}
                    <strong className="font-semibold text-text-primary">
                      Remove
                    </strong>{" "}
                    to revoke app permissions.
                  </li>
                  <li>
                    To permanently delete all data stored inside AI Career
                    Mentor, either use{" "}
                    <strong className="font-semibold text-text-primary">
                      Settings &rarr; Account Deletion
                    </strong>{" "}
                    in the app or email{" "}
                    <a
                      href={`mailto:${PRIVACY_CONTACT_EMAIL}?subject=Data%20Deletion%20Request%20-%20AI%20Career%20Mentor`}
                      className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
                    >
                      {PRIVACY_CONTACT_EMAIL}
                    </a>{" "}
                    with the email address associated with your account (or your
                    Facebook App-Scoped User ID) so we can verify and complete
                    deletion promptly.
                  </li>
                </ol>
              </div>
            </section>

            <hr className="border-border-subtle" />

            <section
              id="rights-and-contact"
              aria-labelledby="heading-rights-and-contact"
              className="scroll-mt-24 flex flex-col gap-3"
            >
              <h2
                id="heading-rights-and-contact"
                className="text-heading-md text-text-primary"
              >
                6. Your Rights &amp; Contact Information
              </h2>
              <p className="text-body leading-relaxed text-text-secondary">
                Depending on your jurisdiction, you have the right to access the
                personal data we hold about you, update or correct inaccurate
                profile and learning details in your Settings, revoke
                third-party OAuth permissions, and request permanent deletion of
                your account and personal data.
              </p>
              <p className="text-body leading-relaxed text-text-secondary">
                We may update this Privacy Policy from time to time to reflect
                product or legal changes. Any updates will be posted on this
                page with a revised &ldquo;Last updated&rdquo; date.
              </p>
              <p className="text-body leading-relaxed text-text-secondary">
                If you have questions about this Privacy Policy or wish to
                submit a privacy or data deletion request, please contact us at{" "}
                <a
                  href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
                  className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
                >
                  {PRIVACY_CONTACT_EMAIL}
                </a>
                .
              </p>
            </section>
          </div>
        </article>
      </main>

      <footer className="border-t border-border-default bg-surface-default">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-start justify-between gap-3 px-4 py-6 text-caption text-text-secondary sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <p>&copy; 2026 AI Career Mentor. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center hover:text-text-primary"
            >
              Back to Home
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center hover:text-text-primary"
            >
              Sign In
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
