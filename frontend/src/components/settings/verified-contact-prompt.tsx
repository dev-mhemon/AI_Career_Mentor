'use client';

import { memo } from 'react';
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
 * Prompts users without a verified contact method to add and verify an email
 * or Bangladesh phone number before performing identity-sensitive actions.
 */
export const VerifiedContactPrompt = memo(function VerifiedContactPrompt({
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
      title="Verified Contact Required"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm">
          Your account does not have a verified email or phone number yet. Add and verify a contact channel below before performing security-sensitive actions such as account deletion.
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
              Add Contact
            </Button>
          ) : (
            <a
              href="#add-contact-heading"
              className="inline-flex h-8 min-h-11 shrink-0 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-3 text-label font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover"
            >
              Add Contact
            </a>
          ))}
      </div>
    </Alert>
  );
});
