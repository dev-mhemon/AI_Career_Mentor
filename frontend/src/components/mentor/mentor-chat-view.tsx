'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  createMentorConversation,
  getMentorHistory,
  getObservedServerTimeAnchor,
  listMentorConversations,
  sendMentorMessage,
  type ConversationDTO,
  type MentorContextType,
  type MessageDTO,
  type ServerTimeAnchor,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { trackEvent } from '@/lib/telemetry/telemetry';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  CompassIcon,
  MenuIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
  SpinnerIcon,
} from '@/components/ui/icons';
import { AIChatMessage, type ChatMessageItem } from './ai-chat-message';

export type MentorChatViewProps = {
  accessToken: string;
  aiMentorEnabled?: boolean;
  initialContext?: MentorContextType;
  initialTopicId?: string;
};

type ConversationsLoadState = {
  key: string;
  status: 'loading' | 'loaded' | 'error';
  items: ConversationDTO[];
  nextCursor: string | null;
  error: MappedError | null;
};

type HistoryLoadState =
  | {
      status: 'loaded';
      messages: ChatMessageItem[];
      nextCursor: string | null;
    }
  | {
      status: 'error';
      error: MappedError;
    };

const MAX_MESSAGE_CHARS = 4_000;
const WARN_MESSAGE_CHARS = 3_600;
const RETENTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;
const RETENTION_SWEEP_INTERVAL_MS = 60_000;
const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

function getMonotonicNowMs(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function estimateServerNowMs(
  anchor: ServerTimeAnchor | null,
  monotonicNowMs: number,
): number | null {
  if (!anchor) {
    return null;
  }
  return anchor.serverMs + Math.max(0, monotonicNowMs - anchor.monotonicMs);
}

function computeServerTimeAnchor(
  currentAnchor: ServerTimeAnchor | null,
  retainedTimestamps: readonly string[],
  monotonicNowMs: number,
): ServerTimeAnchor | null {
  const headerAnchor = getObservedServerTimeAnchor();
  let candidateServerMs =
    headerAnchor !== null
      ? headerAnchor.serverMs +
        Math.max(0, monotonicNowMs - headerAnchor.monotonicMs)
      : currentAnchor !== null
        ? currentAnchor.serverMs +
          Math.max(0, monotonicNowMs - currentAnchor.monotonicMs)
        : null;

  // Never evict server-confirmed messages using browser wall clock when server time is unknown.
  if (candidateServerMs === null) {
    return null;
  }

  // Never let a stale server clock sample advance the retention cutoff ahead of rows
  // the server just confirmed as retained.
  for (const ts of retainedTimestamps) {
    const parsedMs = Date.parse(ts);
    if (!Number.isFinite(parsedMs)) {
      continue;
    }
    const maxSafeServerNowMs = parsedMs + RETENTION_WINDOW_MS - 1_000;
    if (candidateServerMs > maxSafeServerNowMs) {
      candidateServerMs = Math.min(candidateServerMs, maxSafeServerNowMs);
    }
  }
  return {
    serverMs: candidateServerMs,
    monotonicMs: monotonicNowMs,
  };
}

type ConversationGroup = {
  key: string;
  label: string;
  items: ConversationDTO[];
};

function groupConversationsByContext(
  conversations: readonly ConversationDTO[],
): ConversationGroup[] {
  const focusItems: ConversationDTO[] = [];
  const topicItems: ConversationDTO[] = [];
  const generalItems: ConversationDTO[] = [];

  for (const conv of conversations) {
    if (conv.context_type === 'focus_roadmap') {
      focusItems.push(conv);
    } else if (conv.context_type === 'topic') {
      topicItems.push(conv);
    } else {
      generalItems.push(conv);
    }
  }

  const groups: ConversationGroup[] = [];
  if (focusItems.length > 0) {
    groups.push({
      key: 'focus_roadmap',
      label: 'Focus Roadmap',
      items: focusItems,
    });
  }

  if (topicItems.length > 0) {
    const topicBuckets = new Map<
      string,
      { label: string; items: ConversationDTO[] }
    >();
    for (const conv of topicItems) {
      const bucketKey = conv.topic_id ?? conv.title?.trim().toLowerCase() ?? conv.id;
      const existing = topicBuckets.get(bucketKey);
      if (existing) {
        existing.items.push(conv);
      } else {
        topicBuckets.set(bucketKey, {
          label: conv.title?.trim() || 'Topic Chat',
          items: [conv],
        });
      }
    }

    if (topicBuckets.size <= 1) {
      groups.push({
        key: 'topic',
        label: 'Topic Chats',
        items: topicItems,
      });
    } else {
      for (const [bucketKey, bucket] of topicBuckets.entries()) {
        groups.push({
          key: `topic:${bucketKey}`,
          label: bucket.label,
          items: bucket.items,
        });
      }
    }
  }

  if (generalItems.length > 0) {
    groups.push({
      key: 'general',
      label: 'General',
      items: generalItems,
    });
  }

  return groups;
}

const CONTEXT_LABELS: Record<MentorContextType, string> = {
  focus_roadmap: 'Focus Roadmap',
  topic: 'Topic',
  general: 'General',
};

const CONTEXT_BADGE_CLASSES: Record<MentorContextType, string> = {
  focus_roadmap:
    'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200',
  topic:
    'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-200',
  general:
    'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

function createClientMessageId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function toChatItem(msg: MessageDTO): ChatMessageItem {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    language: msg.language,
    created_at: msg.created_at,
    deliveryState: 'sent',
  };
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function extractTokenSubject(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    const decoded =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { sub?: unknown };
    return typeof parsed?.sub === 'string' && parsed.sub.trim().length > 0
      ? parsed.sub.trim()
      : null;
  } catch {
    return null;
  }
}

function isWithinRetentionWindow(
  createdAt: string,
  retentionCutoffMs: number | null,
): boolean {
  if (retentionCutoffMs === null) {
    return true;
  }
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return parsed > retentionCutoffMs;
}

function isDesktopViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DESKTOP_MEDIA_QUERY).matches
  );
}

function matchesRequestedContext(
  conv: ConversationDTO,
  requestedContext?: MentorContextType,
  requestedTopicId?: string,
): boolean {
  if (requestedContext === 'topic' || requestedTopicId) {
    return (
      conv.context_type === 'topic' &&
      (!requestedTopicId || conv.topic_id === requestedTopicId)
    );
  }
  if (requestedContext === 'focus_roadmap') {
    return conv.context_type === 'focus_roadmap';
  }
  if (requestedContext === 'general') {
    return conv.context_type === 'general';
  }
  return false;
}

const DRAWER_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(
    container.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR),
  ).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      !el.closest('[inert]'),
  );
}

function sortChronologically(items: readonly ChatMessageItem[]): ChatMessageItem[] {
  return [...items].sort((a, b) => {
    const timeDiff =
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (!Number.isNaN(timeDiff) && timeDiff !== 0) {
      return timeDiff;
    }
    if (a.role !== b.role) {
      return a.role === 'user' ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function mergeConversationMessages(
  serverMessages: readonly ChatMessageItem[],
  localMessages: readonly ChatMessageItem[],
  retentionCutoffMs: number | null,
): ChatMessageItem[] {
  const indexById = new Map<string, number>();
  const committed: ChatMessageItem[] = [];
  const uncommitted: ChatMessageItem[] = [];

  for (const item of serverMessages) {
    if (!isWithinRetentionWindow(item.created_at, retentionCutoffMs)) {
      continue;
    }
    const existingIdx = indexById.get(item.id);
    if (existingIdx !== undefined) {
      committed[existingIdx] = item;
    } else {
      indexById.set(item.id, committed.length);
      committed.push(item);
    }
  }

  for (const local of localMessages) {
    if (
      local.deliveryState === 'sending' ||
      local.deliveryState === 'failed_retryable' ||
      local.deliveryState === 'failed_permanent'
    ) {
      uncommitted.push(local);
      continue;
    }
    if (!isWithinRetentionWindow(local.created_at, retentionCutoffMs)) {
      continue;
    }
    const existingIdx = indexById.get(local.id);
    if (existingIdx !== undefined) {
      committed[existingIdx] = {
        ...committed[existingIdx],
        safetyMode: local.safetyMode ?? committed[existingIdx].safetyMode,
        learningClaimRecorded:
          local.learningClaimRecorded ??
          committed[existingIdx].learningClaimRecorded,
        clientMessageId:
          local.clientMessageId ?? committed[existingIdx].clientMessageId,
      };
      continue;
    }
    indexById.set(local.id, committed.length);
    committed.push(local);
  }

  return [...sortChronologically(committed), ...uncommitted];
}

/**
 * Screen 20 (`/mentor`): Contextual AI Career Mentor Chat (`C09` §3.4 / `C05` §14.10).
 *
 * - Owns conversation list (`EP-M02`), conversation creation (`EP-M01`), paginated 90-day history (`EP-M04`),
 *   and synchronous `201` JSON messaging (`EP-M03`) with optimistic `client_message_id` retry preservation.
 * - Aborts and scopes all async fetches by `(conversationId, accessToken)` so rapid switches never bleed threads.
 * - Preserves full 90-day history read access when `aiMentorEnabled === false` (`PRD` §7 / §52).
 * - Never writes raw message content into URLs, telemetry payloads, or console logs (`C09` §7 / `R11`).
 */
export function MentorChatView({
  accessToken,
  aiMentorEnabled = true,
  initialContext,
  initialTopicId,
}: MentorChatViewProps) {
  const sessionScopeKey = useMemo(
    () => extractTokenSubject(accessToken) ?? accessToken,
    [accessToken],
  );

  const [convReloadTick, setConvReloadTick] = useState(0);
  const [conversationsState, setConversationsState] =
    useState<ConversationsLoadState | null>(null);
  const [loadingMoreConvs, setLoadingMoreConvs] = useState(false);
  const [loadMoreConvsError, setLoadMoreConvsError] = useState<{
    key: string;
    error: MappedError;
  } | null>(null);

  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const [creatingContext, setCreatingContext] =
    useState<MentorContextType | null>(null);
  const [createError, setCreateError] = useState<MappedError | null>(null);

  const [historyByKey, setHistoryByKey] = useState<
    Record<string, HistoryLoadState>
  >({});
  const [historyReloadTickByConvId, setHistoryReloadTickByConvId] = useState<
    Record<string, number>
  >({});
  const [loadingOlderByKey, setLoadingOlderByKey] = useState<
    Record<string, boolean>
  >({});
  const [olderErrorByKey, setOlderErrorByKey] = useState<
    Record<string, string | null>
  >({});

  const [localTurnsByScope, setLocalTurnsByScope] = useState<
    Record<string, ChatMessageItem[]>
  >({});
  const [sendingTurn, setSendingTurn] = useState<{
    convId: string;
    token: string;
  } | null>(null);
  const [draftsByScope, setDraftsByScope] = useState<Record<string, string>>(
    {},
  );
  const [composerErrorByScope, setComposerErrorByScope] = useState<
    Record<string, string | null>
  >({});

  const [cooldownUntilByClientId, setCooldownUntilByClientId] = useState<
    Record<string, number>
  >({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [monotonicNowMs, setMonotonicNowMs] = useState(() =>
    getMonotonicNowMs(),
  );
  const [serverTimeAnchor, setServerTimeAnchor] =
    useState<ServerTimeAnchor | null>(() => getObservedServerTimeAnchor());

  const convRequestKey = `${accessToken}:${convReloadTick}`;

  const convGenRef = useRef(0);
  const historyGenRef = useRef(0);
  const mountedRef = useRef(true);
  const accessTokenRef = useRef(accessToken);
  const sessionScopeKeyRef = useRef(sessionScopeKey);
  const convRequestKeyRef = useRef(convRequestKey);
  const serverTimeAnchorRef = useRef<ServerTimeAnchor | null>(serverTimeAnchor);
  const historyByKeyRef = useRef<Record<string, HistoryLoadState>>(historyByKey);
  const historyReloadTickByConvIdRef = useRef<Record<string, number>>(
    historyReloadTickByConvId,
  );
  const draftsByScopeRef = useRef<Record<string, string>>({});
  const latestAttemptByClientIdRef = useRef<Map<string, number>>(new Map());
  const nextAttemptSeqRef = useRef(0);
  const createdDuringLoadRef = useRef<Map<string, ConversationDTO[]>>(
    new Map(),
  );
  const olderInFlightRef = useRef<
    Map<string, { cursor: string; controller: AbortController }>
  >(new Map());
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const lastScrolledNewestKeyRef = useRef<string>('');
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);
  const mobileCloseBtnRef = useRef<HTMLButtonElement>(null);
  const wasMobileDrawerOpenRef = useRef(false);

  useEffect(() => {
    accessTokenRef.current = accessToken;
    sessionScopeKeyRef.current = sessionScopeKey;
    convRequestKeyRef.current = convRequestKey;
    serverTimeAnchorRef.current = serverTimeAnchor;
    historyByKeyRef.current = historyByKey;
    historyReloadTickByConvIdRef.current = historyReloadTickByConvId;
  }, [
    accessToken,
    sessionScopeKey,
    convRequestKey,
    serverTimeAnchor,
    historyByKey,
    historyReloadTickByConvId,
  ]);

  useEffect(() => {
    draftsByScopeRef.current = draftsByScope;
  }, [draftsByScope]);

  const setScopedDraft = useCallback((scopeConvKey: string, value: string) => {
    draftsByScopeRef.current = {
      ...draftsByScopeRef.current,
      [scopeConvKey]: value,
    };
    setDraftsByScope((prev) => ({
      ...prev,
      [scopeConvKey]: value,
    }));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const inFlightMap = olderInFlightRef.current;
    return () => {
      mountedRef.current = false;
      for (const entry of inFlightMap.values()) {
        entry.controller.abort();
      }
      inFlightMap.clear();
    };
  }, []);

  // Accessible mobile Conversations modal dialog: focus inside on open, Escape close, Tab trap,
  // auto-close on crossing to desktop lg breakpoint, and restore focus to trigger on mobile close.
  useEffect(() => {
    const wasOpen = wasMobileDrawerOpenRef.current;
    wasMobileDrawerOpenRef.current = mobileDrawerOpen;

    if (!mobileDrawerOpen) {
      if (wasOpen && !isDesktopViewport()) {
        mobileTriggerRef.current?.focus();
      }
      return;
    }

    const focusTarget =
      mobileCloseBtnRef.current ??
      getFocusableElements(mobileDrawerRef.current)[0];
    focusTarget?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileDrawerOpen(false);
        return;
      }
      if (event.key === 'Tab') {
        const focusables = getFocusableElements(mobileDrawerRef.current);
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey) {
          if (
            !active ||
            active === first ||
            !mobileDrawerRef.current?.contains(active)
          ) {
            event.preventDefault();
            last.focus();
          }
        } else if (
          !active ||
          active === last ||
          !mobileDrawerRef.current?.contains(active)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(DESKTOP_MEDIA_QUERY)
        : null;
    const handleMediaChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setMobileDrawerOpen(false);
      }
    };
    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleMediaChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleMediaChange);
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (mediaQuery) {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', handleMediaChange);
        } else if (typeof mediaQuery.removeListener === 'function') {
          mediaQuery.removeListener(handleMediaChange);
        }
      }
    };
  }, [mobileDrawerOpen]);

  const hasActiveCooldown = useMemo(
    () => Object.values(cooldownUntilByClientId).some((until) => until > nowMs),
    [cooldownUntilByClientId, nowMs],
  );

  useEffect(() => {
    if (!hasActiveCooldown) {
      return;
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasActiveCooldown]);

  // Periodic monotonic server-anchored 90-day retention sweep (independent of browser wall-clock jumps)
  // so expired messages are evicted from both active and cached threads while mounted once server time is known.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentMonotonic = getMonotonicNowMs();
      setMonotonicNowMs(currentMonotonic);
      const estimatedServerNow = estimateServerNowMs(
        serverTimeAnchorRef.current,
        currentMonotonic,
      );
      if (estimatedServerNow === null) {
        return;
      }
      const alignedCutoffMs = estimatedServerNow - RETENTION_WINDOW_MS;
      setHistoryByKey((prev) => {
        let changed = false;
        const next: Record<string, HistoryLoadState> = {};
        for (const [key, entry] of Object.entries(prev)) {
          if (entry.status !== 'loaded') {
            next[key] = entry;
            continue;
          }
          const kept = entry.messages.filter((m) =>
            isWithinRetentionWindow(m.created_at, alignedCutoffMs),
          );
          if (kept.length !== entry.messages.length) {
            changed = true;
            next[key] = { ...entry, messages: kept };
          } else {
            next[key] = entry;
          }
        }
        return changed ? next : prev;
      });
      setLocalTurnsByScope((prev) => {
        let changed = false;
        const next: Record<string, ChatMessageItem[]> = {};
        for (const [key, items] of Object.entries(prev)) {
          const kept = items.filter(
            (m) =>
              m.deliveryState === 'sending' ||
              m.deliveryState === 'failed_retryable' ||
              m.deliveryState === 'failed_permanent' ||
              isWithinRetentionWindow(m.created_at, alignedCutoffMs),
          );
          if (kept.length !== items.length) {
            changed = true;
            next[key] = kept;
          } else {
            next[key] = items;
          }
        }
        return changed ? next : prev;
      });
    }, RETENTION_SWEEP_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // Load conversations (EP-M02) without synchronous setState in useEffect,
  // reconciling any conversations created while this initial fetch was in flight.
  useEffect(() => {
    const gen = ++convGenRef.current;
    const controller = new AbortController();
    const requestToken = accessToken;

    listMentorConversations(
      requestToken,
      { limit: 20 },
      { signal: controller.signal },
    )
      .then((res) => {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          gen !== convGenRef.current ||
          accessTokenRef.current !== requestToken
        ) {
          return;
        }
        const createdLocally =
          createdDuringLoadRef.current.get(convRequestKey) ?? [];
        createdDuringLoadRef.current.delete(convRequestKey);
        setConversationsState((prev) => {
          const prevItems = prev && prev.key === convRequestKey ? prev.items : [];
          const fetchedIds = new Set(res.items.map((c) => c.id));
          const localCombined: ConversationDTO[] = [];
          const seenLocal = new Set<string>();
          for (const item of [...createdLocally, ...prevItems]) {
            if (!fetchedIds.has(item.id) && !seenLocal.has(item.id)) {
              seenLocal.add(item.id);
              localCombined.push(item);
            }
          }
          return {
            key: convRequestKey,
            status: 'loaded',
            items: [...localCombined, ...res.items],
            nextCursor: res.meta.next_cursor,
            error: null,
          };
        });
      })
      .catch((err) => {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          gen !== convGenRef.current ||
          accessTokenRef.current !== requestToken
        ) {
          return;
        }
        const createdLocally =
          createdDuringLoadRef.current.get(convRequestKey) ?? [];
        const mapped = mapApiError(err, { feature: 'mentor' });
        setConversationsState((prev) => {
          const prevItems = prev && prev.key === convRequestKey ? prev.items : [];
          const preserved: ConversationDTO[] = [];
          const seen = new Set<string>();
          for (const item of [...createdLocally, ...prevItems]) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              preserved.push(item);
            }
          }
          return {
            key: convRequestKey,
            status: 'error',
            items: preserved,
            nextCursor: null,
            error: mapped,
          };
        });
      });

    return () => {
      controller.abort();
    };
  }, [accessToken, convRequestKey]);

  const activeConvListState =
    conversationsState && conversationsState.key === convRequestKey
      ? conversationsState
      : null;

  const loadingConversations =
    activeConvListState === null || activeConvListState.status === 'loading';
  const conversations = useMemo(
    () => (activeConvListState ? activeConvListState.items : []),
    [activeConvListState],
  );
  const conversationsNextCursor =
    activeConvListState?.status === 'loaded'
      ? activeConvListState.nextCursor
      : null;
  const conversationsError =
    activeConvListState?.status === 'error' ? activeConvListState.error : null;
  const activeLoadMoreConvsError =
    loadMoreConvsError && loadMoreConvsError.key === convRequestKey
      ? loadMoreConvsError.error
      : null;

  const requestedContext: MentorContextType | undefined =
    initialContext ?? (initialTopicId ? 'topic' : undefined);
  const hasRequestedContext = requestedContext !== undefined;

  const activeConversation = useMemo(() => {
    if (selectedConvId) {
      const matched = conversations.find((c) => c.id === selectedConvId);
      if (matched) {
        return matched;
      }
    }
    if (hasRequestedContext) {
      return (
        conversations.find((c) =>
          matchesRequestedContext(c, requestedContext, initialTopicId),
        ) ?? null
      );
    }
    return conversations[0] ?? null;
  }, [
    conversations,
    hasRequestedContext,
    initialTopicId,
    requestedContext,
    selectedConvId,
  ]);

  const activeConversationId = activeConversation?.id ?? null;
  const activeHistoryReloadTick = activeConversationId
    ? (historyReloadTickByConvId[activeConversationId] ?? 0)
    : 0;
  const activeHistoryKey = activeConversationId
    ? `${accessToken}:${activeConversationId}:${activeHistoryReloadTick}`
    : null;

  const activeHistoryEntry = activeHistoryKey
    ? (historyByKey[activeHistoryKey] ?? null)
    : null;

  // Load history (EP-M04) scoped & aborted on (conversationId, accessToken) change.
  useEffect(() => {
    if (!activeConversationId || !activeHistoryKey) {
      return;
    }
    if (Object.hasOwn(historyByKey, activeHistoryKey)) {
      return;
    }

    const gen = ++historyGenRef.current;
    const controller = new AbortController();
    const targetConvId = activeConversationId;
    const targetKey = activeHistoryKey;

    getMentorHistory(
      accessToken,
      { conversation_id: targetConvId, limit: 20 },
      { signal: controller.signal },
    )
      .then((res) => {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          gen !== historyGenRef.current
        ) {
          return;
        }
        const currentMonotonic = getMonotonicNowMs();
        const nextAnchor = computeServerTimeAnchor(
          serverTimeAnchorRef.current,
          res.items.map((m) => m.created_at),
          currentMonotonic,
        );
        serverTimeAnchorRef.current = nextAnchor;
        const estimatedServerNow = estimateServerNowMs(
          nextAnchor,
          currentMonotonic,
        );
        const cutoffMs =
          estimatedServerNow !== null
            ? estimatedServerNow - RETENTION_WINDOW_MS
            : null;
        const chronological = sortChronologically(
          res.items
            .map(toChatItem)
            .filter((item) => isWithinRetentionWindow(item.created_at, cutoffMs)),
        );
        setMonotonicNowMs(currentMonotonic);
        setServerTimeAnchor(nextAnchor);
        setHistoryByKey((prev) => ({
          ...prev,
          [targetKey]: {
            status: 'loaded',
            messages: chronological,
            nextCursor: res.meta.next_cursor,
          },
        }));
      })
      .catch((err) => {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          gen !== historyGenRef.current
        ) {
          return;
        }
        setHistoryByKey((prev) => ({
          ...prev,
          [targetKey]: {
            status: 'error',
            error: mapApiError(err, { feature: 'mentor' }),
          },
        }));
      });

    return () => {
      controller.abort();
    };
  }, [accessToken, activeConversationId, activeHistoryKey, historyByKey]);

  const loadingHistory =
    activeConversationId !== null && activeHistoryEntry === null;

  const activeScopeConvKey = activeConversationId
    ? `${sessionScopeKey}:${activeConversationId}`
    : null;

  const displayedMessages = useMemo(() => {
    if (!activeConversationId || !activeScopeConvKey) {
      return [];
    }
    const estimatedServerNow = estimateServerNowMs(
      serverTimeAnchor,
      monotonicNowMs,
    );
    const retentionCutoffMs =
      estimatedServerNow !== null
        ? estimatedServerNow - RETENTION_WINDOW_MS
        : null;
    const serverMessages =
      activeHistoryEntry?.status === 'loaded'
        ? activeHistoryEntry.messages
        : [];
    const rawLocalMessages = localTurnsByScope[activeScopeConvKey] ?? [];
    // If accessToken refreshed within the same user session while a turn was in flight,
    // immediately surface an actionable Retry state preserving the exact client_message_id.
    const reconciledLocalMessages = rawLocalMessages.map((item) => {
      if (
        item.deliveryState === 'sending' &&
        item.sentWithToken &&
        item.sentWithToken !== accessToken
      ) {
        return {
          ...item,
          deliveryState: 'failed_retryable' as const,
          errorMessage:
            item.errorMessage ??
            'Your session refreshed while sending. Tap Retry to safely complete this message.',
        };
      }
      return item;
    });
    const merged = mergeConversationMessages(
      serverMessages,
      reconciledLocalMessages,
      retentionCutoffMs,
    );
    return merged.map((item) => {
      if (
        item.deliveryState === 'failed_retryable' &&
        item.clientMessageId &&
        cooldownUntilByClientId[item.clientMessageId]
      ) {
        const remaining = Math.max(
          0,
          Math.ceil(
            (cooldownUntilByClientId[item.clientMessageId] - nowMs) / 1_000,
          ),
        );
        return {
          ...item,
          retryCooldownSeconds: remaining,
        };
      }
      return item;
    });
  }, [
    accessToken,
    activeConversationId,
    activeScopeConvKey,
    activeHistoryEntry,
    localTurnsByScope,
    cooldownUntilByClientId,
    nowMs,
    monotonicNowMs,
    serverTimeAnchor,
  ]);

  const newestMessage =
    displayedMessages.length > 0
      ? displayedMessages[displayedMessages.length - 1]
      : null;
  const newestScrollKey = activeConversationId
    ? `${activeConversationId}:${newestMessage?.id ?? ''}:${newestMessage?.deliveryState ?? ''}`
    : '';

  // Auto-scroll message thread to newest message on initial thread load, send, or reply
  // without yanking scroll position when older messages are prepended at the top.
  useEffect(() => {
    if (!newestMessage || !newestScrollKey) {
      return;
    }
    if (lastScrolledNewestKeyRef.current === newestScrollKey) {
      return;
    }
    lastScrolledNewestKeyRef.current = newestScrollKey;
    const container = messagesScrollRef.current;
    if (!container) {
      return;
    }
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [newestMessage, newestScrollKey]);

  const handleLoadMoreConversations = useCallback(async () => {
    if (
      !conversationsNextCursor ||
      loadingMoreConvs ||
      activeConvListState?.status !== 'loaded'
    ) {
      return;
    }
    const requestToken = accessToken;
    const requestKey = convRequestKey;
    setLoadingMoreConvs(true);
    setLoadMoreConvsError((prev) => (prev?.key === requestKey ? null : prev));
    try {
      const res = await listMentorConversations(requestToken, {
        limit: 20,
        cursor: conversationsNextCursor,
      });
      if (
        !mountedRef.current ||
        accessTokenRef.current !== requestToken ||
        convRequestKeyRef.current !== requestKey
      ) {
        return;
      }
      setConversationsState((prev) => {
        if (!prev || prev.status !== 'loaded' || prev.key !== requestKey) {
          return prev;
        }
        const existingIds = new Set(prev.items.map((c) => c.id));
        const appended = res.items.filter((c) => !existingIds.has(c.id));
        return {
          ...prev,
          items: [...prev.items, ...appended],
          nextCursor: res.meta.next_cursor,
        };
      });
    } catch (err) {
      if (
        mountedRef.current &&
        accessTokenRef.current === requestToken &&
        convRequestKeyRef.current === requestKey
      ) {
        setLoadMoreConvsError({
          key: requestKey,
          error: mapApiError(err, { feature: 'mentor' }),
        });
      }
    } finally {
      if (mountedRef.current) {
        setLoadingMoreConvs(false);
      }
    }
  }, [
    accessToken,
    activeConvListState,
    convRequestKey,
    conversationsNextCursor,
    loadingMoreConvs,
  ]);

  const handleLoadOlderHistory = useCallback(async () => {
    if (
      !activeConversationId ||
      !activeHistoryKey ||
      activeHistoryEntry?.status !== 'loaded' ||
      !activeHistoryEntry.nextCursor ||
      olderInFlightRef.current.has(activeHistoryKey)
    ) {
      return;
    }
    const requestToken = accessToken;
    const targetConvId = activeConversationId;
    const targetKey = activeHistoryKey;
    const expectedCursor = activeHistoryEntry.nextCursor;
    const controller = new AbortController();

    olderInFlightRef.current.set(targetKey, {
      cursor: expectedCursor,
      controller,
    });
    setLoadingOlderByKey((prev) => ({ ...prev, [targetKey]: true }));
    setOlderErrorByKey((prev) => ({ ...prev, [targetKey]: null }));

    try {
      const res = await getMentorHistory(
        requestToken,
        {
          conversation_id: targetConvId,
          limit: 20,
          cursor: expectedCursor,
        },
        { signal: controller.signal },
      );
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        accessTokenRef.current !== requestToken
      ) {
        return;
      }
      const latestEntry = historyByKeyRef.current[targetKey];
      if (
        !latestEntry ||
        latestEntry.status !== 'loaded' ||
        latestEntry.nextCursor !== expectedCursor
      ) {
        return;
      }
      const currentMonotonic = getMonotonicNowMs();
      const nextAnchor = computeServerTimeAnchor(
        serverTimeAnchorRef.current,
        res.items.map((m) => m.created_at),
        currentMonotonic,
      );
      serverTimeAnchorRef.current = nextAnchor;
      const estimatedServerNow = estimateServerNowMs(
        nextAnchor,
        currentMonotonic,
      );
      const cutoffMs =
        estimatedServerNow !== null
          ? estimatedServerNow - RETENTION_WINDOW_MS
          : null;
      const olderItems = res.items
        .map(toChatItem)
        .filter((item) => isWithinRetentionWindow(item.created_at, cutoffMs));
      setMonotonicNowMs(currentMonotonic);
      setServerTimeAnchor(nextAnchor);
      setHistoryByKey((prev) => {
        const current = prev[targetKey];
        if (
          !current ||
          current.status !== 'loaded' ||
          current.nextCursor !== expectedCursor
        ) {
          return prev;
        }
        const keptCurrent = current.messages.filter((m) =>
          isWithinRetentionWindow(m.created_at, cutoffMs),
        );
        const seen = new Set(keptCurrent.map((m) => m.id));
        const dedupedOlder = olderItems.filter((m) => !seen.has(m.id));
        return {
          ...prev,
          [targetKey]: {
            status: 'loaded',
            messages: sortChronologically([
              ...dedupedOlder,
              ...keptCurrent,
            ]),
            nextCursor: res.meta.next_cursor,
          },
        };
      });
      setOlderErrorByKey((prev) => ({ ...prev, [targetKey]: null }));
    } catch (err) {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        accessTokenRef.current !== requestToken
      ) {
        return;
      }
      // Preserve loaded messages & nextCursor and show thread-scoped inline error.
      const mapped = mapApiError(err, { feature: 'mentor' });
      setOlderErrorByKey((prev) => ({
        ...prev,
        [targetKey]: mapped.message,
      }));
    } finally {
      const activeEntry = olderInFlightRef.current.get(targetKey);
      if (activeEntry?.controller === controller) {
        olderInFlightRef.current.delete(targetKey);
      }
      if (mountedRef.current) {
        setLoadingOlderByKey((prev) => ({ ...prev, [targetKey]: false }));
      }
    }
  }, [
    accessToken,
    activeConversationId,
    activeHistoryEntry,
    activeHistoryKey,
  ]);

  const handleCreateConversation = useCallback(
    async (contextType: MentorContextType, topicId?: string) => {
      if (!aiMentorEnabled || creatingContext !== null) {
        return;
      }
      const requestToken = accessToken;
      const requestSessionScope = sessionScopeKey;
      setCreatingContext(contextType);
      setCreateError(null);

      try {
        const created = await createMentorConversation(requestToken, {
          context_type: contextType,
          ...(contextType === 'topic' && topicId ? { topic_id: topicId } : {}),
        });
        if (
          !mountedRef.current ||
          sessionScopeKeyRef.current !== requestSessionScope
        ) {
          return;
        }
        const currentKey = convRequestKeyRef.current;
        const currentToken = accessTokenRef.current;
        const existingCreated =
          createdDuringLoadRef.current.get(currentKey) ?? [];
        createdDuringLoadRef.current.set(currentKey, [
          created,
          ...existingCreated.filter((c) => c.id !== created.id),
        ]);

        setConversationsState((prev) => {
          if (prev && prev.key === currentKey) {
            return {
              ...prev,
              items: [
                created,
                ...prev.items.filter((c) => c.id !== created.id),
              ],
            };
          }
          return {
            key: currentKey,
            status: 'loading',
            items: [created],
            nextCursor: null,
            error: null,
          };
        });
        const createdReloadTick =
          historyReloadTickByConvIdRef.current[created.id] ?? 0;
        const newKey = `${currentToken}:${created.id}:${createdReloadTick}`;
        setHistoryByKey((prev) => ({
          ...prev,
          [newKey]: {
            status: 'loaded',
            messages: [],
            nextCursor: null,
          },
        }));
        setSelectedConvId(created.id);
        setMobileDrawerOpen(false);
      } catch (err) {
        if (
          mountedRef.current &&
          sessionScopeKeyRef.current === requestSessionScope
        ) {
          setCreateError(mapApiError(err, { feature: 'mentor' }));
        }
      } finally {
        if (mountedRef.current) {
          setCreatingContext(null);
        }
      }
    },
    [accessToken, aiMentorEnabled, creatingContext, sessionScopeKey],
  );

  const dispatchMessageTurn = useCallback(
    async (conversationId: string, content: string, clientMessageId: string) => {
      const requestToken = accessToken;
      const requestSessionScope = sessionScopeKey;
      const scopeConvKey = `${requestSessionScope}:${conversationId}`;
      const attemptId = ++nextAttemptSeqRef.current;
      latestAttemptByClientIdRef.current.set(clientMessageId, attemptId);

      setSendingTurn({ convId: conversationId, token: requestToken });
      setComposerErrorByScope((prev) => ({ ...prev, [scopeConvKey]: null }));

      try {
        const response = await sendMentorMessage(requestToken, {
          conversation_id: conversationId,
          content,
          client_message_id: clientMessageId,
        });
        trackEvent({
          event_name: 'mentor_message_sent',
          feature_key: 'ai_mentor',
          screen_name: 'mentor',
        });
        if (
          !mountedRef.current ||
          sessionScopeKeyRef.current !== requestSessionScope ||
          latestAttemptByClientIdRef.current.get(clientMessageId) !== attemptId
        ) {
          return;
        }

        // Clock-skew-safe turn ordering & monotonic server-anchored retention:
        // anchor committed user message strictly before server-timestamped assistant reply
        // and never let browser wall-clock jumps evict the freshly committed turn.
        const currentMonotonic = getMonotonicNowMs();
        const nextAnchor = computeServerTimeAnchor(
          serverTimeAnchorRef.current,
          [response.assistant_message.created_at],
          currentMonotonic,
        );
        serverTimeAnchorRef.current = nextAnchor;
        setMonotonicNowMs(currentMonotonic);
        setServerTimeAnchor(nextAnchor);

        const assistantMs = Date.parse(response.assistant_message.created_at);
        const anchoredUserCreatedAt = Number.isFinite(assistantMs)
          ? new Date(assistantMs - 1).toISOString()
          : null;

        setLocalTurnsByScope((prev) => {
          const existing = prev[scopeConvKey] ?? [];
          const updatedUser = existing.map((item) =>
            item.clientMessageId === clientMessageId
              ? {
                  ...item,
                  id: response.user_message_id,
                  created_at: anchoredUserCreatedAt ?? item.created_at,
                  sentWithToken: undefined,
                  deliveryState: 'sent' as const,
                  errorMessage: undefined,
                  retryCooldownSeconds: undefined,
                }
              : item,
          );
          const assistantItem: ChatMessageItem = {
            id: response.assistant_message.id,
            role: 'assistant',
            content: response.assistant_message.content,
            language: response.assistant_message.language,
            created_at: response.assistant_message.created_at,
            deliveryState: 'sent',
            safetyMode: response.safety_mode,
            learningClaimRecorded: response.learning_claim_recorded,
          };
          const withoutDupAssistant = updatedUser.filter(
            (m) => m.id !== assistantItem.id,
          );
          return {
            ...prev,
            [scopeConvKey]: [...withoutDupAssistant, assistantItem],
          };
        });

        setCooldownUntilByClientId((prev) => {
          if (!(clientMessageId in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[clientMessageId];
          return next;
        });

        // Bubble active conversation to top of current list generation.
        const currentKey = convRequestKeyRef.current;
        setConversationsState((prev) => {
          if (!prev || prev.key !== currentKey) {
            return prev;
          }
          const target = prev.items.find((c) => c.id === conversationId);
          if (!target) {
            return prev;
          }
          return {
            ...prev,
            items: [
              target,
              ...prev.items.filter((c) => c.id !== conversationId),
            ],
          };
        });
      } catch (err) {
        if (
          !mountedRef.current ||
          sessionScopeKeyRef.current !== requestSessionScope ||
          latestAttemptByClientIdRef.current.get(clientMessageId) !== attemptId
        ) {
          return;
        }
        const mapped = mapApiError(err, { feature: 'mentor' });

        if (!mapped.retryable) {
          const existingDraft = draftsByScopeRef.current[scopeConvKey] ?? '';
          if (existingDraft.trim().length > 0) {
            // Preserve existing draft B and keep rejected message A visible as non-retryable permanent-error bubble.
            setLocalTurnsByScope((prev) => ({
              ...prev,
              [scopeConvKey]: (prev[scopeConvKey] ?? []).map((item) =>
                item.clientMessageId === clientMessageId
                  ? {
                      ...item,
                      sentWithToken: undefined,
                      deliveryState: 'failed_permanent' as const,
                      errorMessage: mapped.message,
                      retryCooldownSeconds: undefined,
                    }
                  : item,
              ),
            }));
          } else {
            // Composer is empty: restore rejected message into editable draft for a fresh turn.
            setLocalTurnsByScope((prev) => ({
              ...prev,
              [scopeConvKey]: (prev[scopeConvKey] ?? []).filter(
                (item) => item.clientMessageId !== clientMessageId,
              ),
            }));
            setScopedDraft(scopeConvKey, content);
            setComposerErrorByScope((prev) => ({
              ...prev,
              [scopeConvKey]: mapped.message,
            }));
          }
          return;
        }

        const retryWait =
          typeof mapped.retryAfterSeconds === 'number' &&
          mapped.retryAfterSeconds > 0
            ? mapped.retryAfterSeconds
            : 0;

        if (retryWait > 0) {
          const now = Date.now();
          setNowMs(now);
          setCooldownUntilByClientId((prev) => ({
            ...prev,
            [clientMessageId]: now + retryWait * 1_000,
          }));
        }

        setLocalTurnsByScope((prev) => {
          const existing = prev[scopeConvKey] ?? [];
          return {
            ...prev,
            [scopeConvKey]: existing.map((item) =>
              item.clientMessageId === clientMessageId
                ? {
                    ...item,
                    sentWithToken: undefined,
                    deliveryState: 'failed_retryable' as const,
                    errorMessage: mapped.message,
                    retryCooldownSeconds: retryWait > 0 ? retryWait : undefined,
                  }
                : item,
            ),
          };
        });
      } finally {
        if (mountedRef.current) {
          setSendingTurn((prev) =>
            prev &&
            prev.convId === conversationId &&
            prev.token === requestToken
              ? null
              : prev,
          );
        }
      }
    },
    [accessToken, sessionScopeKey, setScopedDraft],
  );

  const composerText = activeScopeConvKey
    ? (draftsByScope[activeScopeConvKey] ?? '')
    : '';
  const composerError = activeScopeConvKey
    ? (composerErrorByScope[activeScopeConvKey] ?? null)
    : null;
  const isSending = sendingTurn !== null && sendingTurn.token === accessToken;

  const handleSendNewMessage = useCallback(async () => {
    if (
      !aiMentorEnabled ||
      !activeConversationId ||
      !activeScopeConvKey ||
      isSending
    ) {
      return;
    }
    const convId = activeConversationId;
    const scopeConvKey = activeScopeConvKey;
    const trimmed = (draftsByScopeRef.current[scopeConvKey] ?? '').trim();
    if (trimmed.length === 0) {
      setComposerErrorByScope((prev) => ({
        ...prev,
        [scopeConvKey]: 'Write a question before sending.',
      }));
      return;
    }
    if (Array.from(trimmed).length > MAX_MESSAGE_CHARS) {
      setComposerErrorByScope((prev) => ({
        ...prev,
        [scopeConvKey]: `Messages must be ${formatCount(MAX_MESSAGE_CHARS)} characters or fewer.`,
      }));
      return;
    }

    const clientMessageId = createClientMessageId();
    const optimisticTurn: ChatMessageItem = {
      id: `pending-${clientMessageId}`,
      role: 'user',
      content: trimmed,
      language: 'mixed',
      created_at: new Date().toISOString(),
      clientMessageId,
      sentWithToken: accessToken,
      deliveryState: 'sending',
    };

    setScopedDraft(scopeConvKey, '');
    setComposerErrorByScope((prev) => ({ ...prev, [scopeConvKey]: null }));
    setLocalTurnsByScope((prev) => ({
      ...prev,
      [scopeConvKey]: [...(prev[scopeConvKey] ?? []), optimisticTurn],
    }));

    await dispatchMessageTurn(convId, trimmed, clientMessageId);
  }, [
    accessToken,
    activeConversationId,
    activeScopeConvKey,
    aiMentorEnabled,
    dispatchMessageTurn,
    isSending,
    setScopedDraft,
  ]);

  const handleRetryFailedMessage = useCallback(
    async (clientMessageId: string) => {
      if (
        !aiMentorEnabled ||
        !activeConversationId ||
        !activeScopeConvKey ||
        isSending
      ) {
        return;
      }
      const convId = activeConversationId;
      const scopeConvKey = activeScopeConvKey;
      const existing = (localTurnsByScope[scopeConvKey] ?? []).find(
        (m) => m.clientMessageId === clientMessageId,
      );
      if (!existing || existing.deliveryState === 'failed_permanent') {
        return;
      }

      setLocalTurnsByScope((prev) => ({
        ...prev,
        [scopeConvKey]: (prev[scopeConvKey] ?? []).map((item) =>
          item.clientMessageId === clientMessageId
            ? {
                ...item,
                sentWithToken: accessToken,
                deliveryState: 'sending' as const,
                errorMessage: undefined,
                retryCooldownSeconds: undefined,
              }
            : item,
        ),
      }));

      // Reuse the EXACT same client_message_id (R15 / C05 §14.10).
      await dispatchMessageTurn(convId, existing.content, clientMessageId);
    },
    [
      accessToken,
      activeConversationId,
      activeScopeConvKey,
      aiMentorEnabled,
      dispatchMessageTurn,
      isSending,
      localTurnsByScope,
    ],
  );

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as globalThis.KeyboardEvent & {
      keyCode?: number;
    };
    if (
      native.isComposing ||
      event.key === 'Process' ||
      native.keyCode === 229
    ) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendNewMessage();
    }
  };

  const toggleConversationGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  }, []);

  const conversationGroups = useMemo(
    () => groupConversationsByContext(conversations),
    [conversations],
  );

  const trimmedCharCount = Array.from(composerText.trim()).length;
  const isNearLimit = trimmedCharCount >= WARN_MESSAGE_CHARS;
  const isOverLimit = trimmedCharCount > MAX_MESSAGE_CHARS;
  const composerDisabled =
    !aiMentorEnabled || !activeConversationId || isSending;

  const renderCreateErrorAlert = () => {
    if (!createError) {
      return null;
    }
    return (
      <div className="flex flex-col gap-2">
        {createError.code === 'NO_FOCUS_ROADMAP' ? (
          <Alert
            variant="info"
            role="status"
            title="No Focus Roadmap selected"
          >
            <div className="flex flex-col gap-2">
              <p>{createError.message}</p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <Link
                  href="/roadmaps"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold leading-tight text-teal-800 hover:bg-teal-50 dark:border-teal-700 dark:bg-slate-900 dark:text-teal-200"
                >
                  <CompassIcon className="block h-3.5 w-3.5 shrink-0 -translate-y-[0.5px]" />
                  <span className="translate-y-[0.5px] leading-tight">
                    Open Roadmaps
                  </span>
                </Link>
                <button
                  type="button"
                  disabled={!aiMentorEnabled || creatingContext !== null}
                  onClick={() => void handleCreateConversation('general')}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold leading-tight text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <span className="translate-y-[0.5px] leading-tight">
                    Start General Chat
                  </span>
                </button>
              </div>
            </div>
          </Alert>
        ) : (
          <Alert variant="warning" role="alert">
            {createError.message}
          </Alert>
        )}
      </div>
    );
  };

  const conversationListContent = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-100 p-4 dark:border-slate-800">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            New Conversation
          </p>
          <div className="flex flex-col gap-2">
            {initialTopicId && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                fullWidth
                disabled={!aiMentorEnabled || creatingContext !== null}
                loading={creatingContext === 'topic'}
                loadingText="Starting topic chat..."
                onClick={() =>
                  void handleCreateConversation('topic', initialTopicId)
                }
                className="flex h-11 min-h-11 w-full items-center justify-center gap-2 leading-tight"
              >
                <SparklesIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                <span className="translate-y-[0.5px] leading-tight">
                  Start Current Topic Chat
                </span>
              </Button>
            )}

            <Button
              type="button"
              variant={
                initialContext === 'focus_roadmap' || !initialTopicId
                  ? 'primary'
                  : 'secondary'
              }
              size="sm"
              fullWidth
              disabled={!aiMentorEnabled || creatingContext !== null}
              loading={creatingContext === 'focus_roadmap'}
              loadingText="Starting..."
              onClick={() => void handleCreateConversation('focus_roadmap')}
              className="flex h-11 min-h-11 w-full items-center justify-center gap-2 leading-tight"
            >
              <CompassIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
              <span className="translate-y-[0.5px] leading-tight">
                Focus Roadmap Chat
              </span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              fullWidth
              disabled={!aiMentorEnabled || creatingContext !== null}
              loading={creatingContext === 'general'}
              loadingText="Starting..."
              onClick={() => void handleCreateConversation('general')}
              className="flex h-11 min-h-11 w-full items-center justify-center gap-2 leading-tight"
            >
              <PlusIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
              <span className="translate-y-[0.5px] leading-tight">
                General Career Chat
              </span>
            </Button>
          </div>
        </div>

        {createError && <div className="mt-3">{renderCreateErrorAlert()}</div>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-4">
        <p className="shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Conversations
        </p>

        {loadingConversations && conversations.length === 0 && (
          <div
            aria-busy="true"
            aria-label="Loading conversations"
            className="flex flex-col gap-2"
          >
            <div className="h-10 rounded-lg bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="h-10 rounded-lg bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
        )}

        {!loadingConversations && conversationsError && (
          <div
            data-testid="conversations-list-error"
            className="flex flex-col gap-2"
          >
            <Alert variant="error_retryable" role="alert">
              {conversationsError.message}
            </Alert>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConvReloadTick((t) => t + 1)}
              className="inline-flex h-11 min-h-11 items-center justify-center gap-1.5 leading-tight"
            >
              <RefreshCwIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
              <span className="translate-y-[0.5px] leading-tight">Retry</span>
            </Button>
          </div>
        )}

        {!loadingConversations &&
          !conversationsError &&
          conversations.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
              No conversations yet. Start a Focus Roadmap or General chat above
              to ask questions in Bangla, English, or Mixed language.
            </div>
          )}

        {conversationGroups.length > 0 && (
          <div
            role="region"
            aria-label="Mentor conversations"
            className="flex flex-col gap-2"
          >
            {conversationGroups.map((group) => {
              const isExpanded = !collapsedGroups[group.key];
              return (
                <div
                  key={group.key}
                  data-testid={`conversation-group-${group.key}`}
                  className="flex flex-col"
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleConversationGroup(group.key)}
                    className="flex w-full items-center gap-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                  >
                    <ChevronRightIcon
                      className={cn(
                        'block h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                        isExpanded ? 'rotate-90' : 'rotate-0',
                      )}
                    />
                    <span className="min-w-0 truncate leading-snug">
                      {group.label}
                    </span>
                  </button>

                  <div
                    data-testid={`conversation-group-panel-${group.key}`}
                    aria-hidden={!isExpanded}
                    inert={!isExpanded ? true : undefined}
                    className={cn(
                      'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                      isExpanded
                        ? 'grid-rows-[1fr] opacity-100'
                        : 'grid-rows-[0fr] opacity-0',
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <ul className="space-y-1 pb-1 pt-1">
                        {group.items.map((conv) => {
                          const isSelected = conv.id === activeConversationId;
                          return (
                            <li key={conv.id}>
                              <button
                                type="button"
                                aria-current={isSelected ? 'true' : undefined}
                                onClick={() => {
                                  setSelectedConvId(conv.id);
                                  setMobileDrawerOpen(false);
                                }}
                                className={cn(
                                  'group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors',
                                  isSelected
                                    ? 'bg-teal-50 font-medium text-teal-900 dark:bg-teal-950/60 dark:text-teal-100'
                                    : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-100',
                                )}
                              >
                                <MessageCircleIcon
                                  className={cn(
                                    'block h-4 w-4 shrink-0 transition-colors',
                                    isSelected
                                      ? 'text-teal-600 dark:text-teal-300'
                                      : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300',
                                  )}
                                />
                                <span
                                  className="min-w-0 flex-1 truncate leading-snug"
                                  dir="auto"
                                >
                                  {conv.title ||
                                    CONTEXT_LABELS[conv.context_type]}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {conversationsNextCursor && (
          <div className="mt-1 flex shrink-0 flex-col gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              fullWidth
              loading={loadingMoreConvs}
              loadingText="Loading..."
              onClick={() => void handleLoadMoreConversations()}
              className="flex h-11 min-h-11 w-full items-center justify-center gap-2 leading-tight"
            >
              <span className="translate-y-[0.5px] leading-tight">Load more</span>
            </Button>
            {activeLoadMoreConvsError && (
              <p
                role="alert"
                data-testid="load-more-convs-error"
                className="text-center text-xs font-medium text-rose-700 dark:text-rose-300"
              >
                {activeLoadMoreConvsError.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const activeLoadingOlder = activeHistoryKey
    ? Boolean(loadingOlderByKey[activeHistoryKey])
    : false;
  const activeOlderError = activeHistoryKey
    ? (olderErrorByKey[activeHistoryKey] ?? null)
    : null;

  const mobileConversationsToggle = (
    <button
      ref={mobileTriggerRef}
      type="button"
      aria-label="Open conversations drawer"
      aria-expanded={mobileDrawerOpen}
      onClick={() => setMobileDrawerOpen((open) => !open)}
      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium leading-tight text-slate-700 hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <MenuIcon className="block h-4 w-4 shrink-0" />
      <span className="leading-snug">Conversations</span>
    </button>
  );

  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] min-h-[520px] w-full max-w-7xl flex-col gap-3 overflow-hidden px-4 py-4 sm:px-6 lg:px-6 lg:py-5">
      <h1 className="sr-only">AI Career Mentor</h1>

      {!aiMentorEnabled && (
        <div
          className="shrink-0"
          inert={mobileDrawerOpen ? true : undefined}
          aria-hidden={mobileDrawerOpen || undefined}
        >
          <Alert
            variant="info"
            role="status"
            title="AI Mentor is currently disabled"
          >
            Sending new messages and starting new conversations are temporarily
            turned off for your account. Your existing conversations and 90-day
            chat history remain readable.
          </Alert>
        </div>
      )}

      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            aria-hidden="true"
            onClick={() => setMobileDrawerOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px]"
          />
          <div
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Conversations"
            className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col overflow-hidden border-r border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
              <span className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">
                <MessageSquareIcon className="block h-4 w-4 shrink-0 text-teal-600" />
                <span className="leading-snug">Mentor Conversations</span>
              </span>
              <button
                ref={mobileCloseBtnRef}
                type="button"
                aria-label="Close conversations drawer"
                onClick={() => setMobileDrawerOpen(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <CloseIcon className="block h-4 w-4 shrink-0" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {conversationListContent}
            </div>
          </div>
        </div>
      )}

      <div
        inert={mobileDrawerOpen ? true : undefined}
        aria-hidden={mobileDrawerOpen || undefined}
        className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]"
      >
        <aside
          aria-label="Mentor conversations sidebar"
          className="hidden h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs lg:flex dark:border-slate-800 dark:bg-slate-900"
        >
          {conversationListContent}
        </aside>

        <section
          aria-label="Mentor chat thread"
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900"
        >
          {activeConversation ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5 sm:py-3.5 dark:border-slate-800 dark:bg-slate-900/80">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {mobileConversationsToggle}
                  <h2
                    className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                    dir="auto"
                  >
                    {activeConversation.title ||
                      CONTEXT_LABELS[activeConversation.context_type]}
                  </h2>
                  <span
                    data-testid="active-context-pill"
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium leading-tight',
                      CONTEXT_BADGE_CLASSES[activeConversation.context_type],
                    )}
                  >
                    <SparklesIcon className="block h-3.5 w-3.5 shrink-0 -translate-y-[0.5px]" />
                    <span className="translate-y-[0.5px] leading-tight">
                      {CONTEXT_LABELS[activeConversation.context_type]}
                    </span>
                  </span>
                </div>
                <span className="text-2xs text-slate-500 dark:text-slate-400">
                  Messages retained up to 90 days
                </span>
              </div>

              <div
                ref={messagesScrollRef}
                role="log"
                aria-label="Mentor conversation"
                data-testid="mentor-messages-scroll"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
              >
                <div className="flex min-h-full flex-col gap-4">
                  {activeHistoryEntry?.status === 'loaded' &&
                    activeHistoryEntry.nextCursor && (
                      <div className="flex flex-col items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={activeLoadingOlder}
                          loadingText="Loading older messages..."
                          onClick={() => void handleLoadOlderHistory()}
                          className="inline-flex h-11 min-h-11 items-center justify-center gap-1.5 leading-tight"
                        >
                          <ClockIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                          <span className="translate-y-[0.5px] leading-tight">
                            Load older messages
                          </span>
                        </Button>
                        {activeOlderError && (
                          <p
                            role="alert"
                            data-testid="older-history-error"
                            className="text-center text-xs font-medium text-rose-700 dark:text-rose-300"
                          >
                            {activeOlderError}
                          </p>
                        )}
                      </div>
                    )}

                  {loadingHistory && (
                    <div
                      aria-busy="true"
                      aria-label="Loading conversation history"
                      className="flex flex-col gap-3"
                    >
                      <div className="h-16 w-2/3 rounded-2xl bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                      <div className="ml-auto h-12 w-1/2 rounded-2xl bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                    </div>
                  )}

                  {!loadingHistory && activeHistoryEntry?.status === 'error' && (
                    <div className="flex flex-col items-start gap-2.5">
                      <Alert variant="error_retryable" role="alert">
                        {activeHistoryEntry.error.message}
                      </Alert>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          if (!activeConversationId) {
                            return;
                          }
                          setHistoryReloadTickByConvId((prev) => ({
                            ...prev,
                            [activeConversationId]:
                              (prev[activeConversationId] ?? 0) + 1,
                          }));
                        }}
                        className="inline-flex h-11 min-h-11 items-center justify-center gap-1.5 leading-tight"
                      >
                        <RefreshCwIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                        <span className="translate-y-[0.5px] leading-tight">
                          Retry loading history
                        </span>
                      </Button>
                    </div>
                  )}

                  {!loadingHistory &&
                    activeHistoryEntry?.status === 'loaded' &&
                    displayedMessages.length === 0 && (
                      <div className="my-auto flex flex-col items-center gap-2 py-8 text-center">
                        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                          <MessageSquareIcon className="block h-6 w-6 shrink-0" />
                        </span>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Ask your AI Career Mentor
                        </p>
                        <p className="max-w-md text-xs text-slate-600 dark:text-slate-400">
                          Ask questions about your roadmap, technical topics, or
                          learning path in Bangla, English, or Mixed language.
                        </p>
                      </div>
                    )}

                  {displayedMessages.map((msg) => (
                    <AIChatMessage
                      key={msg.clientMessageId ?? msg.id}
                      message={msg}
                      onRetrySend={
                        msg.role === 'user'
                          ? (cid) => void handleRetryFailedMessage(cid)
                          : undefined
                      }
                      retryDisabled={!aiMentorEnabled || isSending}
                    />
                  ))}
                </div>
              </div>

              <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                {composerError && (
                  <p
                    role="alert"
                    className="mb-2 text-xs font-medium text-rose-700 dark:text-rose-300"
                  >
                    {composerError}
                  </p>
                )}

                <div
                  data-testid="mentor-composer-card"
                  className={cn(
                    'rounded-2xl border border-slate-200 bg-slate-50/90 p-3 transition focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-950/80 dark:focus-within:border-teal-500 dark:focus-within:bg-slate-950',
                    composerDisabled && 'opacity-75',
                  )}
                >
                  <label htmlFor="mentor-message-input" className="sr-only">
                    Message AI Career Mentor
                  </label>
                  <textarea
                    id="mentor-message-input"
                    rows={2}
                    dir="auto"
                    value={composerText}
                    disabled={composerDisabled}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      if (!activeScopeConvKey) {
                        return;
                      }
                      setScopedDraft(activeScopeConvKey, nextValue);
                      if (composerError) {
                        setComposerErrorByScope((prev) => ({
                          ...prev,
                          [activeScopeConvKey]: null,
                        }));
                      }
                    }}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={
                      aiMentorEnabled
                        ? 'Ask about your roadmap or topic in Bangla, English, or Mixed...'
                        : 'AI Mentor is read-only while disabled for your account.'
                    }
                    aria-invalid={isOverLimit || Boolean(composerError)}
                    className="block min-h-[48px] w-full resize-none bg-transparent text-sm leading-5 text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-500 dark:text-slate-100"
                  />

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'font-mono text-xs tabular-nums text-slate-400 dark:text-slate-500',
                        isNearLimit &&
                          !isOverLimit &&
                          'font-medium text-amber-600 dark:text-amber-400',
                        isOverLimit &&
                          'font-semibold text-rose-600 dark:text-rose-400',
                      )}
                    >
                      {formatCount(trimmedCharCount)} /{' '}
                      {formatCount(MAX_MESSAGE_CHARS)}
                    </span>

                    <button
                      type="button"
                      aria-label="Send message"
                      disabled={
                        composerDisabled ||
                        trimmedCharCount === 0 ||
                        isOverLimit
                      }
                      onClick={() => void handleSendNewMessage()}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-semibold leading-tight text-white shadow-xs transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSending ? (
                        <SpinnerIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                      ) : (
                        <SendIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                      )}
                      <span className="hidden translate-y-[0.5px] leading-tight sm:inline">
                        Send
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 lg:hidden dark:border-slate-800 dark:bg-slate-900/80">
                {mobileConversationsToggle}
                <span className="text-2xs text-slate-500 dark:text-slate-400">
                  Messages retained up to 90 days
                </span>
              </div>
              {loadingConversations && hasRequestedContext ? (
                <div
                  aria-busy="true"
                  aria-label="Loading contextual conversation"
                  className="flex flex-1 flex-col gap-3 p-6"
                >
                  <div className="h-6 w-48 rounded-lg bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                  <div className="h-16 w-2/3 rounded-2xl bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                </div>
              ) : (
                <div
                  data-testid={
                    hasRequestedContext
                      ? 'contextual-start-card'
                      : 'empty-start-card'
                  }
                  className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-12 text-center"
                >
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                    {requestedContext === 'topic' ? (
                      <SparklesIcon className="block h-7 w-7 shrink-0" />
                    ) : (
                      <MessageSquareIcon className="block h-7 w-7 shrink-0" />
                    )}
                  </span>
                  <div className="space-y-1.5">
                    <h2 className="text-heading-md font-semibold text-slate-900 dark:text-slate-100">
                      {requestedContext === 'topic'
                        ? 'Start a Topic Conversation'
                        : requestedContext === 'focus_roadmap'
                          ? 'Start a Focus Roadmap Conversation'
                          : requestedContext === 'general'
                            ? 'Start a General Career Conversation'
                            : 'Start a Mentor Conversation'}
                    </h2>
                    <p className="max-w-md text-body-sm text-slate-600 dark:text-slate-400">
                      {requestedContext === 'topic'
                        ? conversationsNextCursor
                          ? 'No matching chat for this topic was found in the currently loaded conversations. Load more conversations to keep searching, or start a topic-scoped conversation below.'
                          : 'No existing chat was found for this topic yet. Start a topic-scoped conversation below, or select a saved thread from Conversations.'
                        : requestedContext === 'focus_roadmap'
                          ? conversationsNextCursor
                            ? 'No matching Focus Roadmap chat was found in the currently loaded conversations. Load more conversations to keep searching, or start one grounded in your active roadmap below.'
                            : 'No existing chat was found for your Focus Roadmap yet. Start one grounded in your active roadmap below, or select another saved thread.'
                          : requestedContext === 'general'
                            ? conversationsNextCursor
                              ? 'No matching General Career chat was found in the currently loaded conversations. Load more conversations to keep searching, or start one below.'
                              : 'No existing chat was found for General Career yet. Start one below, or pick an existing thread from Conversations.'
                            : 'Get guidance grounded in your Focus Roadmap, current learning topic, or general technology career path.'}
                    </p>
                  </div>
                  {hasRequestedContext && conversationsNextCursor && (
                    <div className="flex flex-col items-center gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={loadingMoreConvs}
                        loadingText="Loading more conversations..."
                        onClick={() => void handleLoadMoreConversations()}
                        className="inline-flex h-11 min-h-11 items-center justify-center gap-1.5 leading-tight"
                      >
                        <RefreshCwIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                        <span className="translate-y-[0.5px] leading-tight">
                          Load more conversations
                        </span>
                      </Button>
                      {activeLoadMoreConvsError && (
                        <p
                          role="alert"
                          className="text-center text-xs font-medium text-rose-700 dark:text-rose-300"
                        >
                          {activeLoadMoreConvsError.message}
                        </p>
                      )}
                    </div>
                  )}
                  {createError && (
                    <div
                      data-testid="main-panel-create-error"
                      className="w-full max-w-md text-left"
                    >
                      {renderCreateErrorAlert()}
                    </div>
                  )}
                  {aiMentorEnabled && (
                    <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                      {initialTopicId && (
                        <Button
                          type="button"
                          variant="primary"
                          size="md"
                          loading={creatingContext === 'topic'}
                          disabled={creatingContext !== null}
                          onClick={() =>
                            void handleCreateConversation(
                              'topic',
                              initialTopicId,
                            )
                          }
                          className="inline-flex h-11 min-h-11 items-center justify-center gap-2 leading-tight"
                        >
                          <SparklesIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                          <span className="translate-y-[0.5px] leading-tight">
                            Ask About Current Topic
                          </span>
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant={
                          requestedContext === 'focus_roadmap' ||
                          (!initialTopicId && requestedContext !== 'general')
                            ? 'primary'
                            : 'secondary'
                        }
                        size="md"
                        loading={creatingContext === 'focus_roadmap'}
                        disabled={creatingContext !== null}
                        onClick={() =>
                          void handleCreateConversation('focus_roadmap')
                        }
                        className="inline-flex h-11 min-h-11 items-center justify-center gap-2 leading-tight"
                      >
                        <CompassIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                        <span className="translate-y-[0.5px] leading-tight">
                          Focus Roadmap Chat
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant={
                          requestedContext === 'general'
                            ? 'primary'
                            : 'secondary'
                        }
                        size="md"
                        loading={creatingContext === 'general'}
                        disabled={creatingContext !== null}
                        onClick={() => void handleCreateConversation('general')}
                        className="inline-flex h-11 min-h-11 items-center justify-center gap-2 leading-tight"
                      >
                        <PlusIcon className="block h-4 w-4 shrink-0 -translate-y-[0.5px]" />
                        <span className="translate-y-[0.5px] leading-tight">
                          General Career Chat
                        </span>
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
