'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
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
          <label id={`${id}-label`} htmlFor={id} className="text-label-lg text-text-primary">
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

function sanitizeOtp(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

/**
 * otp_6: six individually rounded full-width cells synchronized with one canonical input
 * (so FormData, label, required, paste, and autofill work seamlessly).
 */
function OtpInput({
  id,
  name,
  label,
  error,
  hint,
  disabled,
  readOnly,
  value,
  defaultValue,
  onChange,
  onBlur,
  required,
  className,
  ref,
}: InputProps & { id: string }) {
  const initialDefault = sanitizeOtp(String(defaultValue ?? ''));
  const [internalCode, setInternalCode] = useState(initialDefault);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef<Array<HTMLInputElement | null>>([]);

  const currentCode =
    value !== undefined ? sanitizeOtp(String(value)) : internalCode;

  useEffect(() => {
    if (value !== undefined) return;
    const form = primaryRef.current?.form;
    if (!form) return;
    const handleReset = () => {
      if (primaryRef.current) {
        primaryRef.current.value = initialDefault;
      }
      setInternalCode(initialDefault);
    };
    form.addEventListener('reset', handleReset);
    return () => form.removeEventListener('reset', handleReset);
  }, [value, initialDefault]);

  const commitCode = (nextRaw: string) => {
    const clean = sanitizeOtp(nextRaw);
    const primary = primaryRef.current;
    if (primary) {
      setNativeValue(primary, clean);
    } else if (value === undefined) {
      setInternalCode(clean);
    }
  };

  const focusCell = (index: number) => {
    const bounded = Math.max(0, Math.min(5, index));
    cellRefs.current[bounded]?.focus();
  };

  const handlePrimaryChange = (e: ChangeEvent<HTMLInputElement>) => {
    const clean = sanitizeOtp(e.target.value);
    if (clean !== e.target.value) e.target.value = clean;
    if (value === undefined) setInternalCode(clean);
    onChange?.(e);
  };

  const handlePrimaryPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (readOnly || disabled) return;
    const raw = e.clipboardData?.getData('text') ?? '';
    const clean = sanitizeOtp(raw);
    if (!clean) return;
    e.preventDefault();
    commitCode(clean);
  };

  const handleCellChange = (index: number, rawInput: string) => {
    if (readOnly || disabled) return;
    const digitsOnly = rawInput.replace(/\D/g, '');
    const currentDigit = currentCode[index] ?? '';

    if (!digitsOnly) {
      const chars = currentCode.split('');
      if (index < chars.length) {
        chars.splice(index, 1);
        commitCode(chars.join(''));
      }
      return;
    }

    if (digitsOnly.length >= 6) {
      const clean = digitsOnly.slice(0, 6);
      commitCode(clean);
      focusCell(5);
      return;
    }

    if (digitsOnly.length > 1) {
      let nextChar = digitsOnly.slice(-1);
      if (currentDigit && digitsOnly.length === 2) {
        nextChar =
          digitsOnly[0] === currentDigit
            ? digitsOnly[1]
            : digitsOnly[1] === currentDigit
              ? digitsOnly[0]
              : digitsOnly.slice(-1);
      } else if (digitsOnly.length <= 6 - index && !currentDigit) {
        const chars = currentCode.split('');
        const insertAt = Math.min(index, chars.length);
        chars.splice(insertAt, digitsOnly.length, ...digitsOnly.split(''));
        const next = chars.join('').slice(0, 6);
        commitCode(next);
        focusCell(Math.min(insertAt + digitsOnly.length, 5));
        return;
      }
      const chars = currentCode.split('');
      const targetIdx = Math.min(index, chars.length);
      chars[targetIdx] = nextChar;
      commitCode(chars.join('').slice(0, 6));
      focusCell(Math.min(targetIdx + 1, 5));
      return;
    }

    const chars = currentCode.split('');
    const targetIdx = Math.min(index, chars.length);
    chars[targetIdx] = digitsOnly;
    commitCode(chars.join('').slice(0, 6));
    focusCell(Math.min(targetIdx + 1, 5));
  };

  const handleCellKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusCell(index - 1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusCell(index + 1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      focusCell(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      focusCell(Math.min(currentCode.length, 5));
      return;
    }
    if (readOnly || disabled) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      const chars = currentCode.split('');
      if (chars[index]) {
        chars.splice(index, 1);
        commitCode(chars.join(''));
        focusCell(index);
      } else if (index > 0) {
        const removeIdx = Math.min(index - 1, chars.length - 1);
        if (removeIdx >= 0) {
          chars.splice(removeIdx, 1);
          commitCode(chars.join(''));
        }
        focusCell(index - 1);
      }
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      const chars = currentCode.split('');
      if (chars[index]) {
        chars.splice(index, 1);
        commitCode(chars.join(''));
      }
    }
  };

  const handleCellPaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    if (readOnly || disabled) return;
    const raw = e.clipboardData?.getData('text') ?? '';
    const pasted = sanitizeOtp(raw);
    if (!pasted) return;
    e.preventDefault();
    if (pasted.length === 6 || index === 0) {
      commitCode(pasted);
      focusCell(Math.min(pasted.length, 5));
      return;
    }
    const chars = currentCode.split('');
    const startIdx = Math.min(index, chars.length);
    const nextChars = [
      ...chars.slice(0, startIdx),
      ...pasted.split(''),
      ...chars.slice(startIdx + pasted.length),
    ].slice(0, 6);
    const nextCode = nextChars.join('');
    commitCode(nextCode);
    focusCell(Math.min(startIdx + pasted.length, 5));
  };

  const handleGroupBlur = (e: FocusEvent<HTMLInputElement>) => {
    const nextFocused = e.relatedTarget as Node | null;
    if (nextFocused && groupRef.current?.contains(nextFocused)) return;
    setActiveIndex(null);
    if (!onBlur) return;
    const primary = primaryRef.current;
    if (primary && e.target !== primary) {
      onBlur({
        ...e,
        target: primary,
        currentTarget: primary,
      } as FocusEvent<HTMLInputElement>);
    } else {
      onBlur(e);
    }
  };

  const otpDescribedBy =
    [label ? `${id}-label` : undefined, describedBy(id, error, hint)]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required}>
      <div ref={groupRef} className="relative w-full">
        <input
          ref={(el) => {
            primaryRef.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          tabIndex={-1}
          value={currentCode}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy(id, error, hint)}
          onChange={handlePrimaryChange}
          onPaste={handlePrimaryPaste}
          onFocus={() => {
            if (disabled) return;
            const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
            if (activeEl && cellRefs.current.includes(activeEl as HTMLInputElement)) return;
            focusCell(Math.min(currentCode.length, 5));
          }}
          onBlur={handleGroupBlur}
          className="sr-only"
        />
        <div
          role="group"
          aria-describedby={otpDescribedBy}
          className={cn('grid w-full grid-cols-6 gap-2 sm:gap-3', className)}
        >
          {Array.from({ length: 6 }, (_, index) => {
            const digit = currentCode[index] ?? '';
            const isActive = activeIndex === index && !disabled;
            return (
              <input
                key={index}
                ref={(el) => {
                  cellRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? 'one-time-code' : 'off'}
                maxLength={6}
                value={digit}
                disabled={disabled}
                readOnly={readOnly}
                aria-label={`Digit ${index + 1} of 6`}
                aria-describedby={otpDescribedBy}
                aria-invalid={error ? 'true' : undefined}
                data-otp-cell={index}
                onChange={(e) => handleCellChange(index, e.target.value)}
                onKeyDown={(e) => handleCellKeyDown(index, e)}
                onPaste={(e) => handleCellPaste(index, e)}
                onFocus={(e) => {
                  setActiveIndex(index);
                  e.currentTarget.select();
                }}
                onBlur={handleGroupBlur}
                className={cn(
                  'w-full h-12 sm:h-13 rounded-xl border text-center font-mono text-lg font-semibold tabular-nums text-text-primary',
                  'transition-colors duration-(--duration-fast) ease-standard outline-none focus:outline-none',
                  'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled disabled:text-text-disabled',
                  'read-only:bg-surface-subtle',
                  error
                    ? 'border-border-danger border-2 bg-surface-sunken focus:ring-2 focus:ring-border-danger focus:border-border-danger'
                    : isActive
                      ? 'border-border-focus bg-surface-raised ring-2 ring-focus-ring'
                      : 'border-border-default bg-surface-sunken hover:border-border-strong focus:ring-2 focus:ring-focus-ring focus:border-border-focus focus:bg-surface-raised',
                )}
              />
            );
          })}
        </div>
      </div>
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
