'use client';

import { useState } from 'react';
import { linkIdentityAction } from '@/lib/auth/actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckCircleIcon, WarningIcon } from '@/components/ui/icons';

/**
 * Properties for the IdentityLinkingCards component.
 */
export interface IdentityLinkingCardsProps {
  /** Array of provider names currently linked to the user account (e.g. ['email', 'google']). */
  linkedProviders: string[];
  /** Whether the user account has at least one verified primary contact. */
  verifiedContact: boolean;
  /** Whether the user account is currently suspended. */
  isSuspended?: boolean;
  /** Optional initial success notification message. */
  initialSuccess?: string;
  /** Optional initial error notification message. */
  initialError?: string;
}

interface ProviderMeta {
  id: 'google' | 'facebook';
  name: string;
  bengaliName: string;
  icon: (className?: string) => React.ReactNode;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'google',
    name: 'Google',
    bengaliName: 'গুগল',
    icon: (className = 'h-5 w-5') => (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
    ),
  },
  {
    id: 'facebook',
    name: 'Facebook',
    bengaliName: 'ফেসবুক',
    icon: (className = 'h-5 w-5') => (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
          fill="#1877F2"
        />
      </svg>
    ),
  },
];

/**
 * Compares two provider string lists for content equality regardless of order.
 * @param a - First provider list.
 * @param b - Second provider list.
 */
function areProviderListsEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Screen 22: Identity Linking Cards component.
 * Allows authenticated users to connect Google and Facebook social identities per EP-A11.
 * Enforces verified contact requirement and handles account collision rejection.
 */
export function IdentityLinkingCards({
  linkedProviders,
  verifiedContact,
  isSuspended = false,
  initialSuccess,
  initialError,
}: IdentityLinkingCardsProps) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [success, setSuccess] = useState<string | null>(initialSuccess ?? null);
  const [pendingProvider, setPendingProvider] = useState<'google' | 'facebook' | null>(null);
  const [prevLinkedProviders, setPrevLinkedProviders] = useState(linkedProviders);
  const [linkedOverride, setLinkedOverride] = useState<string[] | null>(null);

  if (!areProviderListsEqual(linkedProviders, prevLinkedProviders)) {
    setPrevLinkedProviders(linkedProviders);
    setLinkedOverride(null);
  }

  const linked = linkedOverride ?? linkedProviders;

  /**
   * Initiates linking of a social provider (Google or Facebook) via server action.
   * @param provider - Social identity provider to link.
   */
  const handleLink = async (provider: 'google' | 'facebook') => {
    setError(null);
    setSuccess(null);

    if (isSuspended) {
      setError('স্থগিত অ্যাকাউন্ট থেকে সোশ্যাল অ্যাকাউন্ট লিঙ্ক করা সম্ভব নয় (Cannot link accounts while suspended).');
      return;
    }

    if (!verifiedContact) {
      setError('সোশ্যাল অ্যাকাউন্ট যুক্ত করার জন্য একটি যাচাইকৃত ইমেইল বা ফোন নম্বর প্রয়োজন (Verified contact required).');
      return;
    }

    setPendingProvider(provider);
    try {
      const res = await linkIdentityAction(provider);
      if (res?.error) {
        setError(res.error);
      } else if (res?.success) {
        if (res.linked_providers) {
          setLinkedOverride(res.linked_providers);
        } else {
          setLinkedOverride((prev) => {
            const base = prev ?? linkedProviders;
            return base.includes(provider) ? base : [...base, provider];
          });
        }
        setSuccess(`${provider === 'google' ? 'Google' : 'Facebook'} অ্যাকাউন্ট সফলভাবে যুক্ত করা হয়েছে।`);
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'NEXT_REDIRECT') {
        return;
      }
      setError('সোশ্যাল অ্যাকাউন্ট লিঙ্ক করতে ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।');
    } finally {
      setPendingProvider(null);
    }
  };

  return (
    <section
      aria-labelledby="identity-linking-heading"
      className="flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
    >
      <div>
        <h3 id="identity-linking-heading" className="text-heading-sm text-text-primary">
          সোশ্যাল অ্যাকাউন্ট সংযোগ (Linked Identities)
        </h3>
        <p className="mt-1 text-body-sm text-text-secondary">
          আপনার অ্যাকাউন্টে Google বা Facebook যুক্ত করুন যাতে সহজে লগইন করা যায়।
        </p>
      </div>

      {error && (
        <Alert variant="error_retryable" role="alert">
          {error}
        </Alert>
      )}

      {success && (
        <Alert variant="success" role="status">
          {success}
        </Alert>
      )}

      {!verifiedContact && (
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border border-feedback-warning-border bg-feedback-warning-background p-3 text-caption text-feedback-warning-text"
        >
          <WarningIcon className="mt-0.5 shrink-0 text-feedback-warning-icon" />
          <span>
            সোশ্যাল অ্যাকাউন্ট যুক্ত করতে আপনার অ্যাকাউন্টে একটি যাচাইকৃত যোগাযোগ তথ্য (ইমেইল বা ফোন) থাকতে হবে।
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PROVIDERS.map((prov) => {
          const isLinked = linked.includes(prov.id);
          const isPending = pendingProvider === prov.id;

          return (
            <div
              key={prov.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-default p-4"
            >
              <div className="flex items-center gap-3">
                {prov.icon()}
                <div>
                  <p className="text-label-lg text-text-primary">{prov.name}</p>
                  <p className="text-caption text-text-muted">{prov.bengaliName}</p>
                </div>
              </div>

              {isLinked ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-feedback-success-border bg-feedback-success-background px-3 py-1 text-caption font-medium text-feedback-success-text">
                  <CheckCircleIcon className="h-3.5 w-3.5 text-feedback-success-icon" />
                  সংযুক্ত
                </span>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  isLoading={isPending}
                  loadingText="সংযোগ হচ্ছে..."
                  disabled={isSuspended || !verifiedContact}
                  onClick={() => handleLink(prov.id)}
                  aria-label={`Link ${prov.name} account`}
                >
                  যুক্ত করুন
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
