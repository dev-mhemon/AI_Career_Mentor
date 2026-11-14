'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './button';
import { Input } from './input';

export type ModalVariant = 'confirm' | 'hours_prompt' | 'destructive_delete' | 'report_dialog';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  variant?: ModalVariant;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Receives hours (hours_prompt) or reason text (report_dialog). */
  onConfirm: (value?: string) => void;
  /** destructive_delete: user must type this literal (e.g. 'DELETE'). */
  requireLiteral?: string;
  loading?: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal(props: ModalProps) {
  return props.open ? <ModalInner {...props} /> : null;
}

function ModalInner({
  onClose,
  variant = 'confirm',
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  requireLiteral,
  loading,
}: ModalProps) {
  const uid = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('input,textarea') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const literal = variant === 'destructive_delete' ? (requireLiteral ?? 'DELETE') : undefined;
  const hoursValid = variant !== 'hours_prompt' || (/^\d+(\.\d+)?$/.test(text) && Number(text) > 0 && Number(text) <= 168);
  const reportValid = variant !== 'report_dialog' || text.trim().length >= 3;
  const canConfirm = (literal === undefined || text === literal) && hoursValid && reportValid;

  const defaultLabel = { confirm: 'Confirm', hours_prompt: 'Save', destructive_delete: 'Delete', report_dialog: 'Send report' }[variant];

  return (
    <div className="fixed inset-0 z-(--z-modal) flex items-end justify-center bg-surface-overlay sm:items-center sm:p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        aria-describedby={description ? `${uid}-desc` : undefined}
        onKeyDown={onKey}
        className="flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto rounded-t-xl bg-surface-raised p-6 text-text-primary shadow-xl sm:max-w-md sm:rounded-xl"
      >
        <h2 id={`${uid}-title`} className="text-heading-md" dir="auto">{title}</h2>
        {description && <p id={`${uid}-desc`} className="text-body text-text-secondary" dir="auto">{description}</p>}

        {variant === 'hours_prompt' && (
          <Input label="Hours per week" variant="text" value={text} onChange={(e) => setText(e.target.value)} hint="Between 1 and 168." />
        )}
        {variant === 'report_dialog' && (
          <Input label="What went wrong?" variant="textarea" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        )}
        {literal !== undefined && (
          <Input label={`Type ${literal} to confirm`} value={text} onChange={(e) => setText(e.target.value)} />
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button
            variant={variant === 'destructive_delete' ? 'destructive' : 'primary'}
            disabled={!canConfirm}
            loading={loading}
            onClick={() => onConfirm(variant === 'confirm' || variant === 'destructive_delete' ? undefined : text.trim())}
          >
            {confirmLabel ?? defaultLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
