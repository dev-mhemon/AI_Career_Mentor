'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from './cn';

export type TabsVariant = 'underline' | 'segmented_pill';

export interface TabItem {
  id: string;
  label: string;
  panel: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  variant?: TabsVariant;
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  'aria-label': string;
  /** Stable id prefix so an external tabpanel can reference tabs via aria-labelledby. */
  idPrefix?: string;
  /** Skip rendering panels; caller renders one shared panel (keeps form state across tabs). */
  hidePanels?: boolean;
  /** Disable switching tabs (e.g. during submission). */
  disabled?: boolean;
}

export function Tabs({ items, variant = 'underline', value, defaultValue, onValueChange, 'aria-label': ariaLabel, idPrefix, hidePanels = false, disabled = false }: TabsProps) {
  const autoUid = useId();
  const uid = idPrefix ?? autoUid;
  const enabled = items.filter((i) => !i.disabled);
  const [inner, setInner] = useState(defaultValue ?? enabled[0]?.id ?? items[0]?.id);
  const active =
    value !== undefined
      ? value
      : enabled.some((i) => i.id === inner)
        ? inner
        : (enabled[0]?.id ?? items[0]?.id);
  if (value === undefined && active !== inner) {
    setInner(active);
  }
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string, focus = false) => {
    setInner(id);
    onValueChange?.(id);
    if (focus) tabRefs.current[id]?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const idx = enabled.findIndex((i) => i.id === active);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(enabled[next].id, true);
  };

  const pill = variant === 'segmented_pill';
  return (
    <div>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKey}
        className={cn(
          'flex',
          pill ? 'w-full gap-1 rounded-full bg-surface-sunken p-1' : 'border-b border-border-default gap-2',
        )}
      >
        {items.map((t) => {
          const sel = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              type="button"
              id={`${uid}-tab-${t.id}`}
              aria-selected={sel}
              aria-controls={hidePanels ? `${uid}-panel` : `${uid}-panel-${t.id}`}
              tabIndex={sel ? 0 : -1}
              disabled={disabled || t.disabled}
              onClick={() => select(t.id)}
              className={cn(
                'inline-flex min-h-11 items-center px-4 text-label-lg transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:text-text-disabled',
                pill
                  ? cn('flex-1 justify-center rounded-full text-center', sel ? 'bg-surface-default text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary')
                  : cn('-mb-px border-b-2', sel ? 'border-action-primary-background text-text-brand' : 'border-transparent text-text-secondary hover:text-text-primary'),
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {!hidePanels && items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${uid}-panel-${t.id}`}
          aria-labelledby={`${uid}-tab-${t.id}`}
          hidden={t.id !== active}
          tabIndex={0}
          className="pt-4"
        >
          {t.id === active ? t.panel : null}
        </div>
      ))}
    </div>
  );
}
