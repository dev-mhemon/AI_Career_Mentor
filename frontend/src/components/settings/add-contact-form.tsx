'use client';

import {
  memo,
  type ChangeEvent,
  type FocusEvent,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
  /** Verified primary email address, if available for compact status display. */
  verifiedEmail?: string | null;
  /** Verified primary phone number, if available for compact status display. */
  verifiedPhone?: string | null;
}

const TAB_BUTTON_BASE_CLASS =
  'flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md px-3 py-2 text-center text-label font-medium transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

const AddContactHeader = memo(function AddContactHeader() {
  return (
    <div>
      <h2 id="add-contact-heading" className="text-heading-sm text-text-primary">
        Contact Channels
      </h2>
      <p className="mt-1 text-body-sm text-text-secondary">
        Add and verify an email address or Bangladesh mobile number to secure your account.
      </p>
    </div>
  );
});

/**
 * Screen 22: Contact Channels / Add Contact Form component (`EP-A12`).
 * Shows a compact verified status row when a verified contact is present, or allows
 * unverified active users to add and initiate verification for an email or Bangladesh phone contact.
 * Pre-saves R18 verification draft with context 'secondary_contact' and clears on submission errors.
 */
export function AddContactForm({
  isSuspended = false,
  alreadyVerified = false,
  verifiedEmail = null,
  verifiedPhone = null,
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
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  const switchTab = useCallback((nextTab: 'email' | 'phone') => {
    setActiveTab(nextTab);
    setContact('');
    setContactError(undefined);
    setDismissedServerState(stateRef.current);
    phoneBlurredRef.current = false;
  }, []);

  const handleSelectEmailTab = useCallback(() => switchTab('email'), [switchTab]);
  const handleSelectPhoneTab = useCallback(() => switchTab('phone'), [switchTab]);

  const handleContactChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value;
      setContact(v);
      const currentState = stateRef.current;
      if (currentState?.error || currentState?.fieldErrors?.contact) {
        setDismissedServerState(currentState);
      }
      if (activeTab === 'email') {
        const check = validateEmailLive(v);
        setContactError(check.ok ? undefined : check.error);
      } else {
        const check = validateBdPhoneOnChange(v, phoneBlurredRef.current);
        if (check.resetBlurred) phoneBlurredRef.current = false;
        setContactError(check.error);
      }
    },
    [activeTab],
  );

  const handleContactBlur = useCallback(
    (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
    },
    [activeTab],
  );

  if (isSuspended) {
    return (
      <section
        aria-labelledby="add-contact-heading"
        className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
      >
        <h2 id="add-contact-heading" className="text-heading-sm text-text-primary">
          Contact Channels
        </h2>
        <p className="mt-2 text-body-sm text-text-secondary">
          Adding or verifying contact methods is unavailable while your account is suspended.
        </p>
      </section>
    );
  }

  if (alreadyVerified) {
    const verifiedContacts = [verifiedEmail, verifiedPhone]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));
    const contactSummary =
      verifiedContacts.length > 0
        ? verifiedContacts.join(' · ')
        : 'Primary contact method';

    return (
      <section
        aria-labelledby="add-contact-heading"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-surface-raised px-6 py-4 shadow-xs"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2
            id="add-contact-heading"
            className="text-heading-sm text-text-primary"
          >
            Contact Channels
          </h2>
          <span className="truncate text-body-sm text-text-secondary">
            {contactSummary}
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-0.5 text-caption font-medium text-feedback-success-text">
          <CheckCircleIcon className="h-3.5 w-3.5 text-feedback-success-icon" />
          Verified
        </span>
      </section>
    );
  }

  const visibleState = dismissedServerState === state ? null : state;

  return (
    <section
      aria-labelledby="add-contact-heading"
      className="flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
    >
      <AddContactHeader />

      <div className="flex w-full rounded-lg bg-surface-sunken p-1">
        <button
          type="button"
          disabled={isPending}
          onClick={handleSelectEmailTab}
          className={`${TAB_BUTTON_BASE_CLASS} ${
            activeTab === 'email'
              ? 'bg-surface-default text-text-primary shadow-xs'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-pressed={activeTab === 'email'}
        >
          Email
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleSelectPhoneTab}
          className={`${TAB_BUTTON_BASE_CLASS} ${
            activeTab === 'phone'
              ? 'bg-surface-default text-text-primary shadow-xs'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-pressed={activeTab === 'phone'}
        >
          Phone
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
              ? 'Email Address'
              : 'Bangladesh Mobile Number'
          }
          autoComplete={activeTab === 'email' ? 'email' : 'tel'}
          required
          readOnly={isPending}
          value={contact}
          error={
            contactError ?? visibleState?.fieldErrors?.contact
          }
          onChange={handleContactChange}
          onBlur={handleContactBlur}
          placeholder={activeTab === 'email' ? 'Enter your email' : '01XXXXXXXXX'}
          hint={
            activeTab === 'phone'
              ? 'Bangladesh mobile numbers only (e.g. 01XXXXXXXXX).'
              : undefined
          }
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isPending}
          loadingText="Sending code..."
        >
          Send Verification Code
        </Button>
      </form>
    </section>
  );
}
