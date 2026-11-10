'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { addContactAction, type AuthActionResult } from '@/lib/auth/actions';
import {
  saveVerificationDraft,
  clearVerificationDraft,
} from '@/lib/auth/verification-draft';

/**
 * Properties for the AddContactForm component.
 */
export interface AddContactFormProps {
  /** Whether the user account is currently suspended. */
  isSuspended?: boolean;
  /** Whether the user already has a verified primary contact method. */
  alreadyVerified?: boolean;
}

/**
 * Screen 22: Add Contact Form component.
 * Allows authenticated users to add and initiate verification for an email or Bangladesh phone contact per EP-A12.
 * Pre-saves R18 verification draft with context 'secondary_contact' and clears on submission errors.
 */
export function AddContactForm({
  isSuspended = false,
  alreadyVerified = false,
}: AddContactFormProps) {
  const [state, formAction, isPending] = useActionState<AuthActionResult, FormData>(
    addContactAction,
    {},
  );

  const [activeTab, setActiveTab] = useState<'email' | 'phone'>('email');

  const router = useRouter();
  const handledStateRef = useRef<AuthActionResult | null>(null);

  useEffect(() => {
    if (handledStateRef.current === state) {
      return;
    }
    handledStateRef.current = state;

    if (state?.error && !state?.redirectTo) {
      clearVerificationDraft();
    }
    if (state?.redirectTo) {
      const isVerificationRedirect = state.redirectTo.startsWith('/verify');
      if (!isVerificationRedirect) {
        clearVerificationDraft();
      }
      router.push(state.redirectTo);
    }
  }, [state, router]);

  if (isSuspended) {
    return (
      <section aria-labelledby="add-contact-heading" className="rounded-lg border border-foreground/15 p-5">
        <h3 id="add-contact-heading" className="text-base font-semibold text-foreground">
          যোগাযোগ তথ্য যোগ করুন (Add Contact Method)
        </h3>
        <p className="mt-2 text-sm text-foreground/60">
          স্থগিত অ্যাকাউন্ট থেকে নতুন যোগাযোগ মাধ্যম যোগ করা সম্ভব নয়।
        </p>
      </section>
    );
  }

  if (alreadyVerified) {
    return (
      <section
        aria-labelledby="add-contact-heading"
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5"
      >
        <h3
          id="add-contact-heading"
          className="text-base font-semibold text-emerald-950 dark:text-emerald-100"
        >
          যোগাযোগের মাধ্যম যাচাইকৃত (Verified Contact Method)
        </h3>
        <p className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-200/90">
          আপনার অ্যাকাউন্টের প্রাথমিক যোগাযোগের মাধ্যম ইতিমধ্যে যাচাই করা হয়েছে (Your account already has a verified primary contact method).
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="add-contact-heading" className="flex flex-col gap-4">
      <div>
        <h3 id="add-contact-heading" className="text-base font-semibold text-foreground">
          যোগাযোগ তথ্য যোগ করুন (Add Contact Method)
        </h3>
        <p className="mt-1 text-sm text-foreground/60">
          {alreadyVerified
            ? 'আপনার অ্যাকাউন্টে একটি দ্বিতীয় যোগাযোগের তথ্য যোগ করুন।'
            : 'আপনার অ্যাকাউন্ট সুরক্ষিত করতে এবং পরিচয়-সংবেদনশীল কাজের জন্য একটি যোগাযোগের তথ্য যোগ করুন।'}
        </p>
      </div>

      <div className="flex w-full rounded-lg bg-foreground/5 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('email')}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            activeTab === 'email'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-foreground/60 hover:text-foreground'
          }`}
          aria-pressed={activeTab === 'email'}
        >
          ইমেইল (Email)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('phone')}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            activeTab === 'phone'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-foreground/60 hover:text-foreground'
          }`}
          aria-pressed={activeTab === 'phone'}
        >
          ফোন নম্বর (Phone)
        </button>
      </div>

      {state?.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {state.error}
        </div>
      )}

      <form
        action={formAction}
        onSubmit={(e) => {
          const form = e.currentTarget;
          const contactInput = form.elements.namedItem('contact') as HTMLInputElement;
          const contact = contactInput?.value?.trim();
          if (contact) {
            saveVerificationDraft({
              channel: activeTab,
              identifier: contact,
              context: 'secondary_contact',
            });
          }
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="channel" value={activeTab} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact" className="text-sm font-medium text-foreground">
            {activeTab === 'email' ? 'ইমেইল ঠিকানা (Email Address)' : 'বাংলাদেশি মোবাইল নম্বর (BD Mobile Number)'}
          </label>
          <input
            id="contact"
            name="contact"
            type={activeTab === 'email' ? 'email' : 'tel'}
            autoComplete={activeTab === 'email' ? 'email' : 'tel'}
            required
            disabled={isPending}
            placeholder={activeTab === 'email' ? 'you@example.com' : '+8801XXXXXXXXX'}
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
          />
          {activeTab === 'phone' && (
            <p className="text-xs text-foreground/50">
              শুধুমাত্র বাংলাদেশি মোবাইল নম্বর সমর্থিত (যেমন +8801712345678 বা 01712345678)।
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
        >
          {isPending ? 'কোড পাঠানো হচ্ছে...' : 'যাচাইকরণ কোড পাঠান (Send Code)'}
        </button>
      </form>
    </section>
  );
}
