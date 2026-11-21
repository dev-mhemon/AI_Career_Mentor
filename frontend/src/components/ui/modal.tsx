'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button } from './button';
import { cn } from './cn';
import { CloseIcon } from './icons';
import { Input } from './input';

/**
 * Returns backdrop mouse/click handlers that close a modal only when a click begins
 * and ends on the backdrop itself (ignoring drags started inside the dialog).
 */
export function useBackdropDismiss(onDismiss: () => void, disabled = false) {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const mouseUpTargetRef = useRef<EventTarget | null>(null);

  return {
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      mouseDownTargetRef.current = e.target;
      mouseUpTargetRef.current = null;
    },
    onMouseUp: (e: MouseEvent<HTMLElement>) => {
      mouseUpTargetRef.current = e.target;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const downTarget = mouseDownTargetRef.current;
      const upTarget = mouseUpTargetRef.current;
      mouseDownTargetRef.current = null;
      mouseUpTargetRef.current = null;

      if (disabled || e.target !== e.currentTarget) {
        return;
      }

      const clickedBackdrop =
        downTarget === e.currentTarget &&
        (upTarget === null || upTarget === e.currentTarget);
      const keyboardActivation =
        downTarget === null && upTarget === null && e.detail === 0;

      if (clickedBackdrop || keyboardActivation) {
        onDismiss();
      }
    },
  };
}

export type ModalVariant =
  | 'confirm'
  | 'hours_prompt'
  | 'destructive_delete'
  | 'report_dialog';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalContextValue {
  onClose: () => void;
  titleId: string;
  descriptionId: string;
  disableClose: boolean;
  registerTitleId: (id: string | null) => void;
  registerDescriptionId: (id: string | null) => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function useModalContext(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error('Modal compound components must be rendered within <Modal>.');
  }
  return ctx;
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface ModalBaseProps {
  open: boolean;
  onClose: () => void;
  /** Disables closing via Escape key, backdrop click, or Modal.Close button. */
  disableClose?: boolean;
  /** Dialog width preset: `'sm'` (max-w-md), `'md'` (max-w-lg), `'lg'` (max-w-xl). */
  size?: ModalSize;
  /** Explicit accessible name when rendering a dialog without a visible title. */
  ariaLabel?: string;
  /** Optional explicit element ref to restore focus to when the modal closes. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** Optional fallback focus target when the original opener has been removed or disabled on close. */
  fallbackReturnFocusTo?: RefObject<HTMLElement | null>;
  className?: string;
  loading?: boolean;
}

export interface CompoundModalProps extends ModalBaseProps {
  /** Compound component children (`Modal.Header`, `Modal.Body`, `Modal.Footer`). */
  children: ReactNode;
  variant?: never;
  title?: never;
  description?: never;
  confirmLabel?: never;
  cancelLabel?: never;
  onConfirm?: never;
  requireLiteral?: never;
}

interface LegacyModalBaseProps extends ModalBaseProps {
  children?: undefined;
  /** Legacy preset variant props kept for backwards compatibility with existing callers. */
  variant?: ModalVariant;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Receives hours (hours_prompt) or reason text (report_dialog). */
  onConfirm: (value?: string) => void;
  /** destructive_delete: user must type this literal (e.g. 'DELETE'). */
  requireLiteral?: string;
}

export type LegacyModalProps =
  | (LegacyModalBaseProps & { title: string; ariaLabel?: string })
  | (LegacyModalBaseProps & { title?: undefined; ariaLabel: string });

export type ModalProps = CompoundModalProps | LegacyModalProps;

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
};

const FOCUSABLE =
  'a[href]:not([tabindex="-1"]),button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),select:not([disabled]):not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])';

function getSequentialTabStops(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute('disabled') || el.tabIndex < 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[inert], [hidden]')) return false;
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
    return true;
  });
}

function isFocusableRestoreTarget(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.closest('[inert], [hidden]')) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Compound Subcomponents                                                     */
/* -------------------------------------------------------------------------- */

export interface ModalSectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function ModalHeader({
  children,
  className,
  ...rest
}: ModalSectionProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border-subtle px-6 pt-5 pb-4',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface ModalTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
}

export function ModalTitle({
  children,
  className,
  id,
  ...rest
}: ModalTitleProps) {
  const { titleId, registerTitleId } = useModalContext();
  const resolvedId = id ?? titleId;
  useIsomorphicLayoutEffect(() => {
    registerTitleId(resolvedId);
    return () => registerTitleId(null);
  }, [registerTitleId, resolvedId]);

  return (
    <h2
      id={resolvedId}
      dir="auto"
      className={cn(
        'text-[18px] font-semibold tracking-[-0.015em] text-text-primary',
        className,
      )}
      {...rest}
    >
      {children}
    </h2>
  );
}

export interface ModalDescriptionProps
  extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
}

export function ModalDescription({
  children,
  className,
  id,
  ...rest
}: ModalDescriptionProps) {
  const { descriptionId, registerDescriptionId } = useModalContext();
  const resolvedId = id ?? descriptionId;
  useIsomorphicLayoutEffect(() => {
    registerDescriptionId(resolvedId);
    return () => registerDescriptionId(null);
  }, [registerDescriptionId, resolvedId]);

  return (
    <p
      id={resolvedId}
      dir="auto"
      className={cn(
        'mt-1 text-[13.5px] leading-relaxed text-text-secondary',
        className,
      )}
      {...rest}
    >
      {children}
    </p>
  );
}

export interface ModalCloseProps
  extends HTMLAttributes<HTMLButtonElement> {
  disabled?: boolean;
}

export function ModalClose({
  className,
  'aria-label': ariaLabel = 'Close dialog',
  disabled,
  onClick,
  ...rest
}: ModalCloseProps) {
  const { onClose, disableClose } = useModalContext();
  const isDisabled = Boolean(disableClose || disabled);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={isDisabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented && !isDisabled) {
          onClose();
        }
      }}
      className={cn(
        '-mt-1 -mr-1.5 inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      <CloseIcon className="h-4 w-4" />
    </button>
  );
}

export function ModalBody({
  children,
  className,
  ...rest
}: ModalSectionProps) {
  return (
    <div
      className={cn('flex-1 overflow-visible px-6 py-5', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ModalFooter({
  children,
  className,
  ...rest
}: ModalSectionProps) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2.5 rounded-b-2xl border-t border-border-default bg-surface-subtle px-6 py-4 sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Root Modal Component                                                       */
/* -------------------------------------------------------------------------- */

function ModalRoot(props: ModalProps) {
  return props.open ? <ModalInner {...props} /> : null;
}

function ModalInner({
  onClose,
  disableClose: disableCloseProp = false,
  size,
  ariaLabel,
  returnFocusTo,
  fallbackReturnFocusTo,
  children,
  className,
  variant = 'confirm',
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  requireLiteral,
  loading = false,
}: ModalProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = `${uid}-desc`;
  const panel = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');

  // Capture the previously focused opener element during render BEFORE React commits
  // and applies any `autoFocus` attribute on a descendant inside the modal.
  const [openerElement] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  const returnFocusToRef = useRef(returnFocusTo);
  const fallbackReturnFocusToRef = useRef(fallbackReturnFocusTo);
  const openerElementRef = useRef(openerElement);
  useEffect(() => {
    returnFocusToRef.current = returnFocusTo;
    fallbackReturnFocusToRef.current = fallbackReturnFocusTo;
    openerElementRef.current = openerElement;
  }, [returnFocusTo, fallbackReturnFocusTo, openerElement]);

  const isCompound = children !== undefined;
  const resolvedSize: ModalSize = size ?? (isCompound ? 'md' : 'sm');
  const disableClose = Boolean(disableCloseProp || loading);

  const [registeredTitleId, setRegisteredTitleId] = useState<string | null>(
    null,
  );
  const registeredTitleIdRef = useRef<string | null>(null);
  const registerTitleId = useCallback((id: string | null) => {
    registeredTitleIdRef.current = id;
    if (panel.current) {
      if (id) {
        panel.current.setAttribute('aria-labelledby', id);
        panel.current.removeAttribute('aria-label');
      }
    }
    setRegisteredTitleId(id);
  }, []);
  const [registeredDescriptionId, setRegisteredDescriptionId] = useState<
    string | null
  >(null);

  const onCloseRef = useRef(onClose);
  const disableCloseRef = useRef(disableClose);
  useEffect(() => {
    onCloseRef.current = onClose;
    disableCloseRef.current = disableClose;
  }, [onClose, disableClose]);

  useEffect(() => {
    const panelNode = panel.current;
    if (panelNode) {
      // Ensure accessible name attribute is applied BEFORE focusing the dialog panel.
      if (
        registeredTitleIdRef.current &&
        panelNode.getAttribute('aria-labelledby') !== registeredTitleIdRef.current
      ) {
        panelNode.setAttribute('aria-labelledby', registeredTitleIdRef.current);
        panelNode.removeAttribute('aria-label');
      }
      if (!panelNode.contains(document.activeElement)) {
        panelNode.focus();
      }
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onDocKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        e.stopPropagation();
        if (!disableCloseRef.current) {
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const nodes = getSequentialTabStops(panel.current);
      if (!nodes.length) {
        e.preventDefault();
        panel.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const onPanelOrOutside =
        active === panel.current || !panel.current.contains(active);
      if (e.shiftKey && (active === first || onPanelOrOutside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || onPanelOrOutside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onDocKeyDown);

    return () => {
      document.removeEventListener('keydown', onDocKeyDown);
      document.body.style.overflow = overflow;
      // Restore opener focus ONLY when the dialog actually unmounts/closes (DOM detached),
      // NOT during React Strict Mode effect replay while `panelNode` remains connected.
      if (!panelNode || !panelNode.isConnected) {
        const explicitTarget = returnFocusToRef.current?.current;
        const opener = openerElementRef.current;
        const fallbackTarget = fallbackReturnFocusToRef.current?.current;
        const restoreTarget = isFocusableRestoreTarget(explicitTarget)
          ? explicitTarget
          : isFocusableRestoreTarget(opener)
            ? opener
            : isFocusableRestoreTarget(fallbackTarget)
              ? fallbackTarget
              : null;
        restoreTarget?.focus?.();
      }
    };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation?.();
      if (!disableClose) {
        onClose();
      }
    }
  };

  const literal =
    variant === 'destructive_delete' ? (requireLiteral ?? 'DELETE') : undefined;
  const hoursValid =
    variant !== 'hours_prompt' ||
    (/^\d+(\.\d+)?$/.test(text) && Number(text) > 0 && Number(text) <= 168);
  const reportValid = variant !== 'report_dialog' || text.trim().length >= 3;
  const canConfirm =
    (literal === undefined || text === literal) && hoursValid && reportValid;

  const backdropDismiss = useBackdropDismiss(() => {
    if (!disableClose) onClose();
  }, disableClose);

  const defaultLabel = {
    confirm: 'Confirm',
    hours_prompt: 'Save',
    destructive_delete: 'Delete',
    report_dialog: 'Send report',
  }[variant];

  const contextValue = useMemo<ModalContextValue>(
    () => ({
      onClose,
      titleId,
      descriptionId,
      disableClose,
      registerTitleId,
      registerDescriptionId: setRegisteredDescriptionId,
    }),
    [onClose, titleId, descriptionId, disableClose, registerTitleId],
  );

  const activeTitleId = isCompound
    ? registeredTitleId
    : (registeredTitleId ?? (title ? titleId : null));
  const activeDescriptionId = isCompound
    ? registeredDescriptionId
    : (registeredDescriptionId ?? (description ? descriptionId : null));
  const trimmedAriaLabel = ariaLabel?.trim() || undefined;
  const resolvedAriaLabel = !activeTitleId
    ? (trimmedAriaLabel ?? 'Dialog')
    : undefined;

  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' &&
      isCompound &&
      !registeredTitleIdRef.current &&
      !trimmedAriaLabel
    ) {
      console.error(
        '<Modal> compound dialogs must render a <Modal.Title> or provide a non-empty ariaLabel prop for accessibility.',
      );
    }
  }, [isCompound, registeredTitleId, trimmedAriaLabel]);

  const hasLegacyBodyInputs =
    variant === 'hours_prompt' ||
    variant === 'report_dialog' ||
    literal !== undefined;

  return (
    <ModalContext.Provider value={contextValue}>
      <div
        {...backdropDismiss}
        className="fixed inset-0 z-(--z-modal) flex min-h-full items-center justify-center overflow-y-auto bg-slate-900/45 p-4 backdrop-blur-[1px] sm:p-6"
      >
        <div
          ref={panel}
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-labelledby={activeTitleId ?? undefined}
          aria-describedby={activeDescriptionId ?? undefined}
          aria-label={resolvedAriaLabel}
          onKeyDown={onKey}
          className={cn(
            'relative z-10 my-auto flex w-full flex-col overflow-visible rounded-2xl border border-border-default bg-surface-raised text-text-primary shadow-xl outline-none focus:outline-none focus-visible:outline-none',
            SIZE_CLASS[resolvedSize],
            className,
          )}
        >
          {isCompound ? (
            children
          ) : (
            <>
              <ModalHeader>
                <div className="min-w-0">
                  {title && <ModalTitle>{title}</ModalTitle>}
                  {description && (
                    <ModalDescription>{description}</ModalDescription>
                  )}
                </div>
                <ModalClose />
              </ModalHeader>

              {hasLegacyBodyInputs && (
                <ModalBody className="flex flex-col gap-4">
                  {variant === 'hours_prompt' && (
                    <Input
                      label="Hours per week"
                      variant="text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      hint="Between 1 and 168."
                    />
                  )}
                  {variant === 'report_dialog' && (
                    <Input
                      label="What went wrong?"
                      variant="textarea"
                      value={text}
                      maxLength={500}
                      onChange={(e) => setText(e.target.value)}
                    />
                  )}
                  {literal !== undefined && (
                    <Input
                      label={`Type ${literal} to confirm`}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  )}
                </ModalBody>
              )}

              <ModalFooter>
                <Button
                  variant="secondary"
                  onClick={onClose}
                  disabled={disableClose}
                >
                  {cancelLabel}
                </Button>
                {typeof onConfirm === 'function' && (
                  <Button
                    variant={
                      variant === 'destructive_delete'
                        ? 'destructive'
                        : 'primary'
                    }
                    disabled={!canConfirm}
                    loading={loading}
                    onClick={() =>
                      onConfirm(
                        variant === 'confirm' ||
                          variant === 'destructive_delete'
                          ? undefined
                          : text.trim(),
                      )
                    }
                  >
                    {confirmLabel ?? defaultLabel}
                  </Button>
                )}
              </ModalFooter>
            </>
          )}
        </div>
      </div>
    </ModalContext.Provider>
  );
}

export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Title: ModalTitle,
  Description: ModalDescription,
  Close: ModalClose,
  Body: ModalBody,
  Footer: ModalFooter,
});
