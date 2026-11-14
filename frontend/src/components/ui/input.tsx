'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FocusEvent,
  type Ref,
} from 'react';
import { cn } from './cn';
import { AlertCircleIcon, EyeIcon, EyeOffIcon } from './icons';
import { IconButton } from './icon-button';
import { normalizeBdPhone, sanitizeBdPhoneDisplay } from '@/lib/validation/auth-schemas';

export type InputVariant = 'text' | 'number' | 'textarea' | 'email' | 'password' | 'phone_bd' | 'otp_6';

export interface InputProps {
  variant?: InputVariant;
  label: string;
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** Error text. Sets aria-invalid + danger icon + text. */
  error?: string;
  hint?: string;
  disabled?: boolean;
  /** Use during submission so FormData still includes the value. */
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  minLength?: number;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  rows?: number;
  className?: string;
  ref?: Ref<HTMLInputElement | HTMLTextAreaElement>;
}

const control =
  'w-full rounded-md border bg-surface-default text-body text-text-primary placeholder:text-text-muted ' +
  'transition-colors duration-(--duration-fast) ease-standard ' +
  'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled disabled:text-text-disabled ' +
  'read-only:bg-surface-subtle';

function borderFor(error?: string) {
  return error ? 'border-border-danger border-2' : 'border-border-default hover:border-border-strong focus:border-border-focus';
}

/** Set value natively and notify React so controlled + uncontrolled inputs both update. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, next: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export interface FieldShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  counter?: React.ReactNode;
  labelFor?: boolean;
}

export function FieldShell({
  id,
  label,
  error,
  hint,
  required,
  children,
  counter,
  labelFor = true,
}: FieldShellProps) {
  const requiredMarker = required ? (
    <span aria-hidden="true" className="ml-0.5 font-medium text-text-danger">
      *
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline">
        {labelFor ? (
          <label htmlFor={id} className="text-label-lg text-text-primary">
            {label}
          </label>
        ) : (
          <span id={`${id}-label`} className="text-label-lg text-text-primary">
            {label}
          </span>
        )}
        {requiredMarker}
      </div>
      {children}
      {(error || hint || counter) && (
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            {error ? (
              <p
                id={`${id}-error`}
                className="flex items-center gap-1.5 pl-0 text-caption leading-snug text-text-danger"
              >
                <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
                <span dir="auto">{error}</span>
              </p>
            ) : hint ? (
              <p id={`${id}-hint`} className="text-caption text-text-muted" dir="auto">
                {hint}
              </p>
            ) : null}
          </div>
          {counter}
        </div>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

/**
 * otp_6: one real numeric input (so FormData, label, paste and autofill work natively) drawn as
 * six 48x56 boxes via the segmented background. Non-digits are stripped; max 6 chars.
 */
function OtpInput({ id, name, label, error, hint, disabled, readOnly, value, defaultValue, onChange, onBlur, required, ref }: InputProps & { id: string }) {
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (clean !== e.target.value) e.target.value = clean;
    onChange?.(e);
  };
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (readOnly || disabled) return;
    const raw = e.clipboardData?.getData('text') ?? '';
    const clean = raw.replace(/\D/g, '').slice(0, 6);
    if (!clean) return;
    e.preventDefault();
    setNativeValue(e.currentTarget, clean);
  };
  const boxW = 'var(--size-otp-box-width)';
  const gap = '8px';
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required}>
      <input
        ref={ref as Ref<HTMLInputElement>}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, error, hint)}
        onChange={handle}
        onPaste={handlePaste}
        onBlur={onBlur}
        style={{
          width: `calc(6 * ${boxW} + 5 * ${gap})`,
          maxWidth: '100%',
          height: 'var(--size-otp-box-height)',
          letterSpacing: `calc(${boxW} + ${gap} - 1ch)`,
          paddingLeft: `calc((${boxW} - 1ch) / 2)`,
          backgroundImage: `repeating-linear-gradient(90deg, var(--surface-sunken) 0 ${boxW}, transparent ${boxW} calc(${boxW} + ${gap}))`,
          backgroundClip: 'padding-box',
        }}
        className={cn(
          'rounded-md border-0 font-mono text-heading-md tabular-nums text-text-primary outline-offset-4',
          'disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)',
          error && 'outline-2 outline-border-danger',
        )}
      />
    </FieldShell>
  );
}
export function Input(props: InputProps) {
  const autoId = useId();
  const id = props.id ?? autoId;
  const { variant = 'text' } = props;

  if (variant === 'otp_6') return <OtpInput {...props} id={id} />;
  return <FieldInput {...props} id={id} variant={variant} />;
}

function FieldInput({
  id,
  variant,
  label,
  name,
  value,
  defaultValue,
  onChange,
  onBlur,
  error,
  hint,
  disabled,
  readOnly,
  required,
  placeholder,
  autoComplete,
  maxLength,
  minLength,
  min,
  max,
  step,
  rows = 3,
  className,
  ref,
}: InputProps & { id: string; variant: Exclude<InputVariant, 'otp_6'> }) {
  const [showPw, setShowPw] = useState(false);
  const [length, setLength] = useState((value ?? defaultValue ?? '').length);
  const initialPhoneDisplay =
    variant === 'phone_bd' ? sanitizeBdPhoneDisplay(String(defaultValue ?? '')) : '';
  const [phoneDisplay, setPhoneDisplay] = useState(() =>
    variant === 'phone_bd' ? sanitizeBdPhoneDisplay(String(value ?? defaultValue ?? '')) : '',
  );
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);

  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (variant === 'textarea') grow();
  }, [variant, value]);

  useEffect(() => {
    if (variant !== 'phone_bd' || value !== undefined) return;
    const form = phoneInputRef.current?.form;
    if (!form) return;
    const handleReset = () => {
      setPhoneDisplay(initialPhoneDisplay);
      setLength(initialPhoneDisplay.length);
    };
    form.addEventListener('reset', handleReset);
    return () => form.removeEventListener('reset', handleReset);
  }, [variant, value, initialPhoneDisplay]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (variant === 'phone_bd') {
      const sanitized = sanitizeBdPhoneDisplay(e.target.value);
      if (sanitized !== e.target.value) {
        e.target.value = sanitized;
      }
      if (value === undefined) {
        setPhoneDisplay(sanitized);
      }
    }
    setLength(e.target.value.length);
    if (variant === 'textarea') grow();
    onChange?.(e);
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onBlur?.(e);
  };

  const controlProps = {
    id,
    disabled,
    readOnly,
    required,
    placeholder,
    maxLength,
    minLength,
    'aria-invalid': error ? ('true' as const) : undefined,
    'aria-describedby': describedBy(id, error, hint),
    dir: 'auto' as const,
    onChange: handleChange,
    onBlur: handleBlur,
  };

  const common = {
    ...controlProps,
    name,
    value,
    defaultValue,
  };

  const cls = cn(control, borderFor(error), 'min-h-11 px-3 py-2', className);

  let field: React.ReactNode;
  if (variant === 'textarea') {
    field = (
      <textarea
        {...common}
        rows={rows}
        ref={(el) => {
          taRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        className={cn(cls, 'resize-none overflow-hidden')}
      />
    );
  } else if (variant === 'password') {
    field = (
      <div className="relative">
        <input
          {...common}
          ref={ref as Ref<HTMLInputElement>}
          type={showPw ? 'text' : 'password'}
          autoComplete={autoComplete ?? 'current-password'}
          className={cn(cls, 'pr-12')}
        />
        <IconButton
          aria-label={showPw ? 'Hide password' : 'Show password'}
          aria-pressed={showPw}
          onClick={() => setShowPw((s) => !s)}
          disabled={disabled}
          className="absolute right-0 top-0"
        >
          {showPw ? <EyeOffIcon /> : <EyeIcon />}
        </IconButton>
      </div>
    );
  } else if (variant === 'phone_bd') {
    const visiblePhone =
      value !== undefined ? sanitizeBdPhoneDisplay(String(value)) : phoneDisplay;
    const submittedPhone = normalizeBdPhone(visiblePhone) ?? visiblePhone;
    field = (
      <div className="relative">
        <span
          aria-hidden="true"
          dir="ltr"
          className={cn(
            'pointer-events-none absolute inset-y-[2px] left-[2px] flex select-none items-center gap-1.5 rounded-l-[calc(var(--radius-md)-2px)] border-r border-border-subtle bg-surface-subtle px-2.5 text-label-lg font-medium',
            disabled ? 'text-text-disabled' : 'text-text-secondary',
          )}
        >
          <svg
            viewBox="0 0 20 12"
            width="20"
            height="12"
            className="shrink-0 rounded-[2px]"
            role="presentation"
          >
            <rect width="20" height="12" fill="#006a4e" />
            <circle cx="9" cy="6" r="4" fill="#f42a41" />
          </svg>
          <span className="tabular-nums">+880</span>
        </span>
        <input
          {...controlProps}
          value={visiblePhone}
          dir="ltr"
          placeholder={placeholder ?? '01712-345678'}
          ref={(el) => {
            phoneInputRef.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          type="tel"
          inputMode="numeric"
          autoComplete={autoComplete ?? 'tel'}
          className={cn(cls, 'pl-24')}
        />
        {name ? <input type="hidden" name={name} value={submittedPhone} disabled={disabled} /> : null}
      </div>
    );
  } else {
    const t = {
      text: { type: 'text' },
      number: { type: 'number', inputMode: 'decimal' as const, min, max, step },
      email: { type: 'email', inputMode: 'email' as const, autoComplete: 'email' },
    }[variant];
    field = (
      <input
        {...common}
        ref={ref as Ref<HTMLInputElement>}
        {...t}
        autoComplete={autoComplete ?? ('autoComplete' in t ? t.autoComplete : undefined)}
        className={cls}
      />
    );
  }

  const counter =
    variant === 'textarea' && maxLength ? (
      <span className="text-caption text-text-muted tabular-nums" aria-live="polite">
        {length}/{maxLength}
      </span>
    ) : null;

  return (
    <FieldShell
      id={id}
      label={label}
      error={error}
      hint={hint}
      required={required}
      counter={counter}
    >
      {field}
    </FieldShell>
  );
}
