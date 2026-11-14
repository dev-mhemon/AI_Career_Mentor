'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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
    <Alert
      variant="warning"
      role="alert"
      title="যাচাইকৃত যোগাযোগ মাধ্যম প্রয়োজন (Verified Contact Required)"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm">
          আপনার অ্যাকাউন্টটিতে কোনো যাচাইকৃত যোগাযোগ তথ্য (ইমেইল বা ফোন) নেই। সোশ্যাল অ্যাকাউন্ট লিঙ্ক বা অ্যাকাউন্ট মুছে ফেলার মতো পরিচয়-সংবেদনশীল কাজের জন্য অনুগ্রহ করে নিচে একটি যোগাযোগ তথ্য যোগ ও যাচাই করুন।
        </p>
        {!isSuspended &&
          (onAddContactClick ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onAddContactClick}
              className="shrink-0"
            >
              যোগাযোগ যোগ করুন
            </Button>
          ) : (
            <a
              href="#add-contact-heading"
              className="inline-flex h-8 min-h-11 shrink-0 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-3 text-label font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover"
            >
              যোগাযোগ যোগ করুন
            </a>
          ))}
      </div>
    </Alert>
  );
}
