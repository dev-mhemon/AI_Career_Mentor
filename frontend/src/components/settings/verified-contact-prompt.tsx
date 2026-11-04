'use client';

/**
 * Properties for the VerifiedContactPrompt component.
 */
export interface VerifiedContactPromptProps {
  /** Whether the user already has a verified primary contact method. */
  verifiedContact: boolean;
  /** Whether the user account is suspended. */
  isSuspended?: boolean;
  /** Optional callback or target anchor id to scroll to add-contact section. */
  onAddContactClick?: () => void;
}

/**
 * Screen 22: Verified Contact Prompt banner per PRD §11.
 * Prompts users authenticated via social providers without a verified email
 * to add and verify an email or Bangladesh phone contact before identity-sensitive actions.
 */
export function VerifiedContactPrompt({
  verifiedContact,
  isSuspended = false,
  onAddContactClick,
}: VerifiedContactPromptProps) {
  if (verifiedContact) {
    return null;
  }

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">
            যাচাইকৃত যোগাযোগ মাধ্যম প্রয়োজন (Verified Contact Required)
          </h2>
          <p className="mt-1 text-xs text-foreground/80 sm:text-sm">
            আপনার অ্যাকাউন্টটিতে কোনো যাচাইকৃত যোগাযোগ তথ্য (ইমেইল বা ফোন) নেই। সোশ্যাল অ্যাকাউন্ট লিঙ্ক বা অ্যাকাউন্ট মুছে ফেলার মতো পরিচয়-সংবেদনশীল কাজের জন্য অনুগ্রহ করে নিচে একটি যোগাযোগ তথ্য যোগ ও যাচাই করুন।
          </p>
        </div>
        {!isSuspended && (
          onAddContactClick ? (
            <button
              type="button"
              onClick={onAddContactClick}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-amber-600 px-3 text-xs font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:bg-amber-500 dark:text-black dark:hover:bg-amber-400"
            >
              যোগাযোগ যোগ করুন
            </button>
          ) : (
            <a
              href="#add-contact-heading"
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-amber-600 px-3 text-xs font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:bg-amber-500 dark:text-black dark:hover:bg-amber-400"
            >
              যোগাযোগ যোগ করুন
            </a>
          )
        )}
      </div>
    </div>
  );
}
