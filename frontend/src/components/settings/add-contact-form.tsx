'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { addContactAction, type AuthActionResult } from '@/lib/auth/actions';
import {
  saveVerificationDraft,
  clearVerificationDraft,
} from '@/lib/auth/verification-draft';
import { AuthAlert } from '@/components/auth/auth-alert';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CheckCircleIcon } from '@/components/ui/icons';
import {
  validateBdPhone,
  validateBdPhoneOnChange,
  validateEmail,
  validateEmailLive,
} from '@/lib/validation/auth-schemas';

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
  const [contact, setContact] = useState('');
  const [contactError, setContactError] = useState<string | undefined>();
  const [dismissedServerState, setDismissedServerState] =
    useState<AuthActionResult | null>(null);
  const phoneBlurredRef = useRef(false);

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
      <section
        aria-labelledby="add-contact-heading"
        className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
      >
        <h3 id="add-contact-heading" className="text-heading-sm text-text-primary">
          যোগাযোগ তথ্য যোগ করুন (Add Contact Method)
        </h3>
        <p className="mt-2 text-body-sm text-text-secondary">
          স্থগিত অ্যাকাউন্ট থেকে নতুন যোগাযোগ মাধ্যম যোগ করা সম্ভব নয়।
        </p>
      </section>
    );
  }

  if (alreadyVerified) {
    return (
      <section
        aria-labelledby="add-contact-heading"
        className="flex gap-3 rounded-xl border border-feedback-success-border bg-feedback-success-background p-6 shadow-xs"
      >
        <CheckCircleIcon className="mt-0.5 shrink-0 text-feedback-success-icon" />
        <div>
          <h3
            id="add-contact-heading"
            className="text-heading-sm text-feedback-success-text"
          >
            যোগাযোগের মাধ্যম যাচাইকৃত (Verified Contact Method)
          </h3>
          <p className="mt-1 text-body-sm text-feedback-success-text">
            আপনার অ্যাকাউন্টের প্রাথমিক যোগাযোগের মাধ্যম ইতিমধ্যে যাচাই করা হয়েছে (Your account already has a verified primary contact method).
          </p>
        </div>
      </section>
    );
  }

  const visibleState = dismissedServerState === state ? null : state;

  return (
    <section
      aria-labelledby="add-contact-heading"
      className="flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
    >
      <div>
        <h3 id="add-contact-heading" className="text-heading-sm text-text-primary">
          যোগাযোগ তথ্য যোগ করুন (Add Contact Method)
        </h3>
        <p className="mt-1 text-body-sm text-text-secondary">
          আপনার অ্যাকাউন্ট সুরক্ষিত করতে এবং পরিচয়-সংবেদনশীল কাজের জন্য একটি যোগাযোগের তথ্য যোগ করুন।
        </p>
      </div>

      <div className="flex w-full rounded-lg bg-surface-sunken p-1">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setActiveTab('email');
            setContact('');
            setContactError(undefined);
            setDismissedServerState(state);
            phoneBlurredRef.current = false;
          }}
          className={`flex min-h-11 flex-1 items-center justify-center rounded-md px-3 py-2 text-center text-label font-medium transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled) ${
            activeTab === 'email'
              ? 'bg-surface-default text-text-primary shadow-xs'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-pressed={activeTab === 'email'}
        >
          ইমেইল (Email)
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setActiveTab('phone');
            setContact('');
            setContactError(undefined);
            setDismissedServerState(state);
            phoneBlurredRef.current = false;
          }}
          className={`flex min-h-11 flex-1 items-center justify-center rounded-md px-3 py-2 text-center text-label font-medium transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled) ${
            activeTab === 'phone'
              ? 'bg-surface-default text-text-primary shadow-xs'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-pressed={activeTab === 'phone'}
        >
          ফোন নম্বর (Phone)
        </button>
      </div>

      <AuthAlert result={visibleState} />

      <form
        action={formAction}
        noValidate
        onSubmit={(e) => {
          const form = e.currentTarget;
          const check =
            activeTab === 'email'
              ? validateEmail(contact)
              : validateBdPhone(contact);
          if (!check.ok) {
            e.preventDefault();
            if (activeTab === 'phone' && contact.trim()) {
              phoneBlurredRef.current = true;
            }
            setContactError(check.error);
            return;
          }
          setContactError(undefined);
          if (activeTab === 'email') {
            const contactInput = form.elements.namedItem('contact') as HTMLInputElement | null;
            if (contactInput) contactInput.value = check.value;
          }
          saveVerificationDraft({
            channel: activeTab,
            identifier: check.value,
            context: 'secondary_contact',
          });
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="channel" value={activeTab} />

        <Input
          key={activeTab}
          id="contact"
          name="contact"
          variant={activeTab === 'email' ? 'email' : 'phone_bd'}
          label={
            activeTab === 'email'
              ? 'ইমেইল ঠিকানা (Email Address)'
              : 'বাংলাদেশি মোবাইল নম্বর (BD Mobile Number)'
          }
          autoComplete={activeTab === 'email' ? 'email' : 'tel'}
          required
          readOnly={isPending}
          value={contact}
          error={
            contactError ?? visibleState?.fieldErrors?.contact
          }
          onChange={(e) => {
            const v = e.target.value;
            setContact(v);
            if (state?.error || state?.fieldErrors?.contact) {
              setDismissedServerState(state);
            }
            if (activeTab === 'email') {
              const check = validateEmailLive(v);
              setContactError(check.ok ? undefined : check.error);
            } else {
              const check = validateBdPhoneOnChange(v, phoneBlurredRef.current);
              if (check.resetBlurred) phoneBlurredRef.current = false;
              setContactError(check.error);
            }
          }}
          onBlur={(e) => {
            if (!e.target.value.trim()) {
              phoneBlurredRef.current = false;
              return;
            }
            if (activeTab === 'phone') phoneBlurredRef.current = true;
            const check =
              activeTab === 'email'
                ? validateEmail(e.target.value)
                : validateBdPhone(e.target.value);
            if (!check.ok) setContactError(check.error);
            else {
              if (activeTab === 'email') setContact(check.value);
              setContactError(undefined);
            }
          }}
          placeholder={activeTab === 'email' ? 'you@example.com' : '01712-345678'}
          hint={
            activeTab === 'phone'
              ? 'শুধুমাত্র বাংলাদেশি মোবাইল নম্বর সমর্থিত (যেমন 01712-345678 বা +8801712345678)।'
              : undefined
          }
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isPending}
          loadingText="কোড পাঠানো হচ্ছে..."
        >
          যাচাইকরণ কোড পাঠান (Send Code)
        </Button>
      </form>
    </section>
  );
}
