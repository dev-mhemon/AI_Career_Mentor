'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { cn } from './cn';
import { CloseIcon } from './icons';

export interface MultiSelectOption {
  id: string;
  label: string;
  keywords?: readonly string[];
}

export type MultiSelectPillTone = 'default' | 'warning' | 'pending';

export interface MultiSelectSelectedItem {
  id: string;
  label: string;
  tone?: MultiSelectPillTone;
  statusLabel?: string;
  secondaryLabel?: string;
}

export interface MultiSelectComboboxProps {
  id?: string;
  options: readonly MultiSelectOption[];
  selected: readonly MultiSelectSelectedItem[];
  /** Return `false` to reject the selection and keep the current input query for editing. */
  onSelectOption: (option: MultiSelectOption) => boolean | void;
  /** Return `false` to reject the custom entry and keep the current input query for editing. */
  onCreateCustom?: (rawLabel: string) => boolean | void;
  onRemove: (id: string) => void;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  secondaryPlaceholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  selectedListAriaLabel?: string;
  listboxAriaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  allowCustom?: boolean;
  openOnFocus?: boolean;
  emptyMessage?: string;
  className?: string;
}

function optionMatchesQuery(option: MultiSelectOption, queryLower: string): boolean {
  if (!queryLower) return true;
  if (option.label.trim().toLowerCase().includes(queryLower)) return true;
  return (
    option.keywords?.some((kw) => kw.trim().toLowerCase().includes(queryLower)) ??
    false
  );
}

function optionMatchRank(option: MultiSelectOption, queryLower: string): number {
  if (!queryLower) return 2;
  const labelLower = option.label.trim().toLowerCase();
  if (labelLower === queryLower) return 0;
  if (option.keywords?.some((kw) => kw.trim().toLowerCase() === queryLower)) return 0;
  if (labelLower.startsWith(queryLower)) return 1;
  if (option.keywords?.some((kw) => kw.trim().toLowerCase().startsWith(queryLower))) return 1;
  return 2;
}

function isExactOptionMatch(option: MultiSelectOption, queryLower: string): boolean {
  if (option.label.trim().toLowerCase() === queryLower) return true;
  return (
    option.keywords?.some((kw) => kw.trim().toLowerCase() === queryLower) ?? false
  );
}

const PILL_TONE_CLASSES: Record<MultiSelectPillTone, string> = {
  default:
    'border-teal-500 bg-teal-500/15 text-text-brand hover:bg-teal-500/20',
  warning:
    'border-amber-300 bg-amber-50/70 text-amber-900 hover:bg-amber-100/70',
  pending: 'border-slate-300 bg-slate-50 text-slate-700',
};

const STATUS_TONE_CLASSES: Record<MultiSelectPillTone, string> = {
  default: 'text-text-secondary',
  warning: 'text-amber-800',
  pending: 'text-slate-500',
};

/**
 * Pure, generic multi-select combobox with inline pills inside the input frame,
 * filterable dropdown suggestions, full keyboard navigation, and optional creatable entries.
 */
export function MultiSelectCombobox({
  id,
  options,
  selected,
  onSelectOption,
  onCreateCustom,
  onRemove,
  onQueryChange,
  placeholder = 'Select or type...',
  secondaryPlaceholder = 'Add another...',
  disabled = false,
  ariaLabel,
  selectedListAriaLabel = 'Selected items',
  listboxAriaLabel = 'Suggestions',
  ariaDescribedBy,
  ariaInvalid = false,
  allowCustom = false,
  openOnFocus = true,
  emptyMessage = 'No matching options',
  className,
}: MultiSelectComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const keyboardNavRef = useRef(false);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const queryLower = trimmedQuery.toLowerCase();

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of selected) {
      keys.add(item.id.toLowerCase());
      keys.add(item.label.trim().toLowerCase());
    }
    return keys;
  }, [selected]);

  const filteredOptions = useMemo(() => {
    const matches = options.filter(
      (opt) =>
        !selectedKeys.has(opt.id.toLowerCase()) &&
        !selectedKeys.has(opt.label.trim().toLowerCase()) &&
        optionMatchesQuery(opt, queryLower),
    );
    if (!queryLower) return matches;
    return [...matches].sort(
      (a, b) => optionMatchRank(a, queryLower) - optionMatchRank(b, queryLower),
    );
  }, [options, selectedKeys, queryLower]);

  const exactOptionMatch = useMemo(
    () =>
      queryLower
        ? filteredOptions.find((opt) => isExactOptionMatch(opt, queryLower))
        : undefined,
    [filteredOptions, queryLower],
  );

  const totalRows = filteredOptions.length;
  const effectiveActiveIndex = activeOptionId
    ? filteredOptions.findIndex((opt) => opt.id === activeOptionId)
    : -1;

  const showDropdown =
    open &&
    !disabled &&
    (openOnFocus
      ? totalRows > 0 || trimmedQuery.length > 0
      : trimmedQuery.length > 0);
  const showListbox = showDropdown && totalRows > 0;
  const showEmptyStatus = showDropdown && totalRows === 0 && trimmedQuery.length > 0;
  const showEnterHint = trimmedQuery.length > 0 && !disabled;

  useEffect(() => {
    if (!open) return;
    function handleOutsideMouseDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setActiveOptionId(null);
      }
    }
    document.addEventListener('mousedown', handleOutsideMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown);
    };
  }, [open]);

  useEffect(() => {
    if (!showListbox || effectiveActiveIndex < 0 || !keyboardNavRef.current) {
      return;
    }
    keyboardNavRef.current = false;
    const optionEl = optionRefs.current[effectiveActiveIndex];
    if (optionEl && typeof optionEl.scrollIntoView === 'function') {
      optionEl.scrollIntoView({ block: 'nearest' });
    }
  }, [showListbox, effectiveActiveIndex]);

  function updateQuery(next: string) {
    setQuery(next);
    setActiveOptionId(null);
    onQueryChange?.(next);
  }

  function handleSelect(option: MultiSelectOption) {
    const accepted = onSelectOption(option);
    if (accepted === false) {
      inputRef.current?.focus();
      return;
    }
    updateQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleCreate(raw: string) {
    if (!onCreateCustom) return;
    const accepted = onCreateCustom(raw);
    if (accepted === false) {
      inputRef.current?.focus();
      return;
    }
    updateQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!openOnFocus && trimmedQuery.length === 0) return;
      keyboardNavRef.current = true;
      if (!open) {
        setOpen(true);
        setActiveOptionId(totalRows > 0 ? filteredOptions[0].id : null);
        return;
      }
      if (totalRows > 0) {
        const nextIndex =
          effectiveActiveIndex < 0 ? 0 : (effectiveActiveIndex + 1) % totalRows;
        setActiveOptionId(filteredOptions[nextIndex].id);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!openOnFocus && trimmedQuery.length === 0) return;
      keyboardNavRef.current = true;
      if (!open) {
        setOpen(true);
        setActiveOptionId(
          totalRows > 0 ? filteredOptions[totalRows - 1].id : null,
        );
        return;
      }
      if (totalRows > 0) {
        const prevIndex =
          effectiveActiveIndex <= 0 ? totalRows - 1 : effectiveActiveIndex - 1;
        setActiveOptionId(filteredOptions[prevIndex].id);
      }
      return;
    }

    if (event.key === 'Escape') {
      if (showDropdown) {
        event.preventDefault();
        setOpen(false);
        setActiveOptionId(null);
      } else if (open) {
        setOpen(false);
        setActiveOptionId(null);
      }
      return;
    }

    if (event.key === 'Backspace' && query.length === 0 && selected.length > 0) {
      event.preventDefault();
      onRemove(selected[selected.length - 1].id);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (effectiveActiveIndex >= 0 && effectiveActiveIndex < filteredOptions.length) {
        handleSelect(filteredOptions[effectiveActiveIndex]);
        return;
      }
      if (exactOptionMatch) {
        handleSelect(exactOptionMatch);
        return;
      }
      if (allowCustom && onCreateCustom && trimmedQuery.length > 0) {
        handleCreate(trimmedQuery);
        return;
      }
      if (!allowCustom && filteredOptions.length > 0 && trimmedQuery.length > 0) {
        handleSelect(filteredOptions[0]);
      }
    }
  }

  const activeDescendantId =
    showListbox && effectiveActiveIndex >= 0
      ? `${listboxId}-opt-${effectiveActiveIndex}`
      : undefined;

  return (
    <div
      ref={containerRef}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setActiveOptionId(null);
        }
      }}
      className={cn('relative w-full', className)}
    >
      <div
        onClick={() => {
          if (!disabled) {
            inputRef.current?.focus();
            if (openOnFocus || trimmedQuery.length > 0) {
              setOpen(true);
            }
          }
        }}
        className={cn(
          'relative flex min-h-[44px] w-full flex-wrap items-center gap-1.5 rounded-lg border bg-surface-default px-3 py-1.5',
          showEnterHint ? 'pr-20' : 'pr-3',
          'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
          disabled
            ? 'cursor-not-allowed border-border-disabled bg-surface-disabled text-text-disabled'
            : ariaInvalid
              ? 'cursor-text border-2 border-border-danger focus-within:ring-2 focus-within:ring-border-danger/30'
              : 'cursor-text border-border-default hover:border-border-strong focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-500/20',
        )}
      >
        {selected.length > 0 && (
          <ul aria-label={selectedListAriaLabel} className="contents">
            {selected.map((item) => {
              const tone: MultiSelectPillTone = item.tone ?? 'default';
              return (
                <li
                  key={item.id}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-label font-medium shadow-2xs transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
                    PILL_TONE_CLASSES[tone],
                  )}
                >
                  <span dir="auto" className="truncate leading-snug">
                    {item.label}
                  </span>
                  {item.secondaryLabel && (
                    <span className="text-caption font-normal text-text-secondary">
                      ({item.secondaryLabel})
                    </span>
                  )}
                  {item.statusLabel && (
                    <span
                      className={cn(
                        'text-caption font-normal',
                        STATUS_TONE_CLASSES[tone],
                      )}
                    >
                      · {item.statusLabel}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(item.id);
                      inputRef.current?.focus();
                    }}
                    className="ml-0.5 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:text-text-disabled"
                  >
                    <CloseIcon className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          dir="auto"
          autoComplete="off"
          value={query}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={showListbox}
          aria-controls={showListbox ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendantId}
          aria-invalid={ariaInvalid ? 'true' : undefined}
          aria-describedby={ariaDescribedBy}
          placeholder={
            selected.length === 0 ? placeholder : secondaryPlaceholder
          }
          onFocus={() => {
            if (!disabled && (openOnFocus || trimmedQuery.length > 0)) {
              setOpen(true);
            }
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            updateQuery(nextValue);
            if (!openOnFocus && nextValue.trim().length === 0) {
              setOpen(false);
            } else if (!open) {
              setOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          className="min-w-[140px] flex-1 bg-transparent py-1 text-body text-text-primary outline-none placeholder:font-light placeholder:text-text-muted disabled:cursor-not-allowed disabled:text-text-disabled"
        />

        {showEnterHint && (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 shadow-2xs transition-opacity duration-150"
          >
            ↵ Enter
          </kbd>
        )}
      </div>

      {showListbox && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={listboxAriaLabel}
          className="absolute left-0 right-0 z-30 mt-1.5 max-h-60 overflow-y-auto rounded-lg border border-border-default bg-surface-raised p-1 shadow-lg [scrollbar-width:thin] [scrollbar-color:var(--color-border-strong)_transparent]"
        >
          {filteredOptions.map((option, index) => {
            const highlighted = effectiveActiveIndex === index;
            return (
              <li
                key={option.id}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                id={`${listboxId}-opt-${index}`}
                role="option"
                aria-selected={highlighted}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onMouseEnter={() => {
                  keyboardNavRef.current = false;
                  setActiveOptionId(option.id);
                }}
                onClick={() => handleSelect(option)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-body-sm transition-colors',
                  highlighted
                    ? 'bg-teal-50 text-teal-900'
                    : 'text-text-primary hover:bg-surface-subtle',
                )}
              >
                <span dir="auto" className="font-medium">
                  {option.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {showEmptyStatus && (
        <div
          role="status"
          aria-live="polite"
          className="absolute left-0 right-0 z-30 mt-1.5 rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-body-sm text-text-secondary shadow-lg"
        >
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
