import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { UiLanguage } from '../../ai/ai.types.js';
import {
  readTechnologyUpdateConfiguration,
  type TechnologyUpdateSourceMode,
} from '../../config.js';
import {
  RELEASE_STATUS_VALUES,
  type ReleaseStatus,
  type TechnologySourceType,
} from '../dto/technology-update.dto.js';

const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

export const TECH_UPDATE_SOURCE_FETCHER = Symbol('TECH_UPDATE_SOURCE_FETCHER');

export interface ActiveTechnologySourceRecord {
  id: string;
  name: string;
  publisher: string;
  base_url: string;
  source_type: TechnologySourceType;
  trust_tier: number;
}

export interface TechnologyUpdateLearnerContext {
  userId: string;
  localDate: string;
  timezone: string;
  language: UiLanguage;
  focusRoadmap: {
    id: string;
    roleName: string;
    targetLevel: string;
    activeTopics: string[];
  } | null;
  skills: string[];
  sources: ActiveTechnologySourceRecord[];
  deliveredContentHashes: ReadonlySet<string>;
}

export interface RawExternalFeedItem {
  sourceId?: string | null;
  technologyId?: string | null;
  title: string;
  summary: string;
  publisher: string;
  sourceUrl: string;
  fetchedAt?: string;
  publishedAt?: string | null;
  releaseStatus?: ReleaseStatus;
}

export interface ExternalUpdateCandidate {
  sourceId: string | null;
  technologyId: string | null;
  title: string;
  summary: string;
  publisher: string;
  sourceUrl: string;
  fetchedAt: string;
  publishedAt: string | null;
  releaseStatus: ReleaseStatus;
  contentHash: string;
}

export interface FetchFreshCandidatesOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type ExternalSourceFetcherFn = (
  context: TechnologyUpdateLearnerContext,
  options: { timeoutMs: number; signal: AbortSignal },
) => Promise<RawExternalFeedItem[]>;

/**
 * Typed error thrown when fresh external technology update sources cannot be reached
 * or fail validation (`PRD` §40, §46 -> transitions delivery outcome to `temporarily_unavailable`).
 */
export class TechnologySourceFetchError extends Error {
  readonly code: 'SOURCE_TIMEOUT' | 'SOURCE_UNAVAILABLE' | 'SOURCE_INVALID';

  constructor(
    code: 'SOURCE_TIMEOUT' | 'SOURCE_UNAVAILABLE' | 'SOURCE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'TechnologySourceFetchError';
    this.code = code;
  }
}

function normalizeCanonicalSourceUrlForHash(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    return `${protocol}//${host}${parsed.pathname}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

function isValidHttpSourceUrl(rawUrl: string): boolean {
  if (!HTTP_URL_PATTERN.test(rawUrl)) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.hostname.trim().length > 0
    );
  } catch {
    return false;
  }
}

function normalizeValidIsoTimestamp(
  rawValue: unknown,
  fallbackIso: string | null,
): { valid: boolean; value: string | null } {
  if (rawValue === undefined || rawValue === null) {
    return { valid: true, value: fallbackIso };
  }
  if (typeof rawValue !== 'string') {
    return { valid: false, value: null };
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { valid: true, value: fallbackIso };
  }
  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) {
    return { valid: false, value: null };
  }
  return { valid: true, value: new Date(parsedMs).toISOString() };
}

/**
 * Computes a deterministic SHA-256 content hash (`public.technology_updates.content_hash`,
 * `uq_technology_updates_hash`) across canonical `sourceUrl` (lowercasing scheme & host while
 * preserving case-sensitive path/query components per RFC 3986), `title`, and `summary` (`PRD` §45).
 */
export function computeTechnologyUpdateContentHash(input: {
  sourceUrl: string;
  title: string;
  summary: string;
}): string {
  const canonicalUrl = normalizeCanonicalSourceUrlForHash(input.sourceUrl);
  const canonicalTitle = input.title.trim().toLowerCase().replace(/\s+/g, ' ');
  const canonicalSummary = input.summary
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return createHash('sha256')
    .update(`${canonicalUrl}\n${canonicalTitle}\n${canonicalSummary}`, 'utf8')
    .digest('hex');
}

function decodeXmlEntitySegment(segment: string): string {
  return segment
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _m;
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Decodes standard XML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, numeric entities)
 * in non-CDATA XML text while preserving literal `<!\[CDATA\[...\]\]>` content untouched.
 */
export function decodeXmlEntitiesOutsideCdata(raw: string): string {
  const cdataPattern = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let result = '';
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = cdataPattern.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      result += decodeXmlEntitySegment(raw.slice(lastIdx, match.index));
    }
    result += match[1];
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < raw.length) {
    result += decodeXmlEntitySegment(raw.slice(lastIdx));
  }
  return result;
}

function isReleaseStatus(val: unknown): val is ReleaseStatus {
  return (
    typeof val === 'string' &&
    (RELEASE_STATUS_VALUES as readonly string[]).includes(val)
  );
}

/**
 * Service that retrieves fresh external technology release/announcement facts (`PRD` §40–§41, `C08` §7.5)
 * within the bounded `R25` external deadline (`60s` default) and computes `SHA-256` `content_hash` values.
 *
 * Never fabricates updates from stale model memory on fetch failure (`PRD` §40, §46).
 */
@Injectable()
export class TechnologyUpdateSourceService {
  readonly defaultTimeoutMs: number;
  readonly sourceMode: TechnologyUpdateSourceMode;

  constructor(
    @Optional()
    @Inject(ConfigService)
    configService?: ConfigService,
    @Optional()
    @Inject(TECH_UPDATE_SOURCE_FETCHER)
    private readonly customFetcher?: ExternalSourceFetcherFn,
  ) {
    const cfg = readTechnologyUpdateConfiguration(configService ?? {});
    this.defaultTimeoutMs = cfg.externalTimeoutMs;
    this.sourceMode = cfg.sourceMode;
  }

  /**
   * Fetches and normalizes fresh external update candidates within `timeoutMs`,
   * deduplicating by `contentHash`. Throws `TechnologySourceFetchError` on timeout or source failure.
   */
  async fetchFreshCandidates(
    context: TechnologyUpdateLearnerContext,
    options: FetchFreshCandidatesOptions = {},
  ): Promise<ExternalUpdateCandidate[]> {
    const timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : this.defaultTimeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new TechnologySourceFetchError(
          'SOURCE_TIMEOUT',
          `Technology update source fetch timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    const onParentAbort = () => {
      controller.abort(
        new TechnologySourceFetchError(
          'SOURCE_TIMEOUT',
          'Technology update source fetch aborted by caller deadline',
        ),
      );
    };
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        throw new TechnologySourceFetchError(
          'SOURCE_TIMEOUT',
          'Technology update source fetch aborted before start',
        );
      }
      options.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    let onAbortReject: (() => void) | null = null;
    const abortRejectionPromise = new Promise<never>((_resolve, reject) => {
      onAbortReject = () => {
        reject(
          new TechnologySourceFetchError(
            'SOURCE_TIMEOUT',
            `Technology update source fetch timed out after ${timeoutMs}ms`,
          ),
        );
      };
      if (controller.signal.aborted) {
        onAbortReject();
        return;
      }
      controller.signal.addEventListener('abort', onAbortReject, {
        once: true,
      });
    });

    try {
      const rawItems = await Promise.race([
        this.executeSourceFetch(context, {
          timeoutMs,
          signal: controller.signal,
        }),
        abortRejectionPromise,
      ]);

      if (controller.signal.aborted) {
        throw new TechnologySourceFetchError(
          'SOURCE_TIMEOUT',
          `Technology update source fetch timed out after ${timeoutMs}ms`,
        );
      }

      const nowIso = new Date().toISOString();
      const candidates: ExternalUpdateCandidate[] = [];
      const seenHashes = new Set<string>();

      for (const item of rawItems) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const summary =
          typeof item.summary === 'string' ? item.summary.trim() : '';
        const publisher =
          typeof item.publisher === 'string' ? item.publisher.trim() : '';
        const sourceUrl =
          typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : '';

        if (
          !title ||
          !summary ||
          !publisher ||
          !sourceUrl ||
          !isValidHttpSourceUrl(sourceUrl)
        ) {
          continue;
        }

        const fetchedAtNorm = normalizeValidIsoTimestamp(
          item.fetchedAt,
          nowIso,
        );
        const publishedAtNorm = normalizeValidIsoTimestamp(
          item.publishedAt,
          null,
        );
        if (!fetchedAtNorm.valid || !publishedAtNorm.valid) {
          continue;
        }

        const contentHash = computeTechnologyUpdateContentHash({
          sourceUrl,
          title,
          summary,
        });
        if (seenHashes.has(contentHash)) {
          continue;
        }
        seenHashes.add(contentHash);

        const releaseStatus: ReleaseStatus = isReleaseStatus(item.releaseStatus)
          ? item.releaseStatus
          : 'released';

        candidates.push({
          sourceId:
            typeof item.sourceId === 'string' && item.sourceId.trim()
              ? item.sourceId.trim()
              : null,
          technologyId:
            typeof item.technologyId === 'string' && item.technologyId.trim()
              ? item.technologyId.trim()
              : null,
          title,
          summary,
          publisher,
          sourceUrl,
          fetchedAt: fetchedAtNorm.value ?? nowIso,
          publishedAt: publishedAtNorm.value,
          releaseStatus,
          contentHash,
        });
      }

      if (rawItems.length > 0 && candidates.length === 0) {
        throw new TechnologySourceFetchError(
          'SOURCE_INVALID',
          'External technology feed contained no valid update items',
        );
      }

      return candidates;
    } catch (error) {
      if (error instanceof TechnologySourceFetchError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new TechnologySourceFetchError(
          'SOURCE_TIMEOUT',
          `Technology update source fetch timed out after ${timeoutMs}ms`,
        );
      }
      throw new TechnologySourceFetchError(
        'SOURCE_UNAVAILABLE',
        error instanceof Error
          ? error.message
          : 'External technology sources are temporarily unavailable',
      );
    } finally {
      clearTimeout(timer);
      if (onAbortReject) {
        controller.signal.removeEventListener('abort', onAbortReject);
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  private async executeSourceFetch(
    context: TechnologyUpdateLearnerContext,
    options: { timeoutMs: number; signal: AbortSignal },
  ): Promise<RawExternalFeedItem[]> {
    if (this.customFetcher) {
      return this.customFetcher(context, options);
    }

    if (this.sourceMode === 'synthetic') {
      const primarySource = context.sources[0];
      const roleLabel = context.focusRoadmap?.roleName ?? 'Backend Development';
      return [
        {
          sourceId: primarySource?.id ?? null,
          technologyId: null,
          title: 'PostgreSQL 17 Performance Improvements',
          summary: `Official release notes covering vacuum memory management and query planning optimizations relevant to ${roleLabel}.`,
          publisher: primarySource?.publisher ?? 'PostgreSQL Release Team',
          sourceUrl:
            primarySource?.base_url ??
            'https://www.postgresql.org/docs/release/',
          fetchedAt: new Date().toISOString(),
          publishedAt: `${context.localDate}T00:00:00.000Z`,
          releaseStatus: 'released',
        },
      ];
    }

    if (context.sources.length === 0) {
      throw new TechnologySourceFetchError(
        'SOURCE_UNAVAILABLE',
        'No active technology sources configured for live ingestion',
      );
    }

    const items: RawExternalFeedItem[] = [];
    let anySourceSucceeded = false;

    for (const source of context.sources) {
      if (options.signal.aborted) {
        break;
      }
      try {
        const res = await fetch(source.base_url, {
          method: 'GET',
          redirect: 'error',
          signal: options.signal,
          headers: {
            Accept:
              'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8',
          },
        });
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          continue;
        }
        const bodyText = await res.text();
        const extracted = this.parseLiveSourcePayload(source, bodyText);
        anySourceSucceeded = true;
        items.push(...extracted);
      } catch {
        // Continue to next active source tier; throw below if all sources fail.
      }
    }

    if (!anySourceSucceeded) {
      throw new TechnologySourceFetchError(
        'SOURCE_UNAVAILABLE',
        'All configured live technology sources failed or were unreachable',
      );
    }

    return items;
  }

  private parseLiveSourcePayload(
    source: ActiveTechnologySourceRecord,
    bodyText: string,
  ): RawExternalFeedItem[] {
    const trimmed = bodyText.trim();
    if (!trimmed) {
      throw new TechnologySourceFetchError(
        'SOURCE_INVALID',
        'Empty response body from live technology source',
      );
    }
    const fetchedAt = new Date().toISOString();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new TechnologySourceFetchError(
          'SOURCE_INVALID',
          'Malformed JSON payload from live technology source',
        );
      }
      let list: unknown[];
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { items?: unknown }).items)
      ) {
        list = (parsed as { items: unknown[] }).items;
      } else {
        throw new TechnologySourceFetchError(
          'SOURCE_INVALID',
          'JSON feed payload lacks items array',
        );
      }
      return list
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === 'object',
        )
        .slice(0, 5)
        .map((entry) => ({
          sourceId: source.id,
          title: typeof entry.title === 'string' ? entry.title : source.name,
          summary:
            typeof entry.summary === 'string'
              ? entry.summary
              : typeof entry.description === 'string'
                ? entry.description
                : '',
          publisher: source.publisher,
          sourceUrl:
            typeof entry.url === 'string'
              ? entry.url
              : typeof entry.link === 'string'
                ? entry.link
                : source.base_url,
          fetchedAt,
          publishedAt:
            typeof entry.published_at === 'string'
              ? entry.published_at
              : typeof entry.date_published === 'string'
                ? entry.date_published
                : null,
          releaseStatus: 'released' as const,
        }));
    }

    if (!/<(?:rss|feed|rdf:RDF)\b/i.test(trimmed)) {
      throw new TechnologySourceFetchError(
        'SOURCE_INVALID',
        'Payload is not a valid RSS, Atom, or JSON feed',
      );
    }

    // Parse RSS <item> or Atom <entry> blocks safely without external XML dependencies
    const blockMatches =
      trimmed.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
    const results: RawExternalFeedItem[] = [];

    for (const block of blockMatches.slice(0, 5)) {
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block);
      const summaryMatch =
        /<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i.exec(
          block,
        );
      const linkHrefMatch = /<link[^>]+href=["']([^"']+)["']/i.exec(block);
      const linkTextMatch = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block);
      const pubDateMatch =
        /<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i.exec(
          block,
        );

      const stripXmlText = (val: string) =>
        decodeXmlEntitiesOutsideCdata(
          val.replace(/<(?!!\[CDATA\[)[^>]+>/g, ' '),
        )
          .replace(/\s+/g, ' ')
          .trim();

      const stripXmlLink = (val: string) =>
        decodeXmlEntitiesOutsideCdata(
          val.replace(/<(?!!\[CDATA\[)[^>]+>/g, ''),
        ).trim();

      const title = titleMatch ? stripXmlText(titleMatch[1]) : '';
      const summary = summaryMatch ? stripXmlText(summaryMatch[1]) : '';
      const rawLink = linkHrefMatch
        ? decodeXmlEntitiesOutsideCdata(linkHrefMatch[1].trim())
        : linkTextMatch
          ? stripXmlLink(linkTextMatch[1])
          : source.base_url;
      let resolvedUrl: string;
      try {
        resolvedUrl = new URL(rawLink, source.base_url).toString();
      } catch {
        resolvedUrl = source.base_url;
      }

      if (title && summary) {
        results.push({
          sourceId: source.id,
          title,
          summary,
          publisher: source.publisher,
          sourceUrl: resolvedUrl,
          fetchedAt,
          publishedAt: pubDateMatch ? stripXmlText(pubDateMatch[1]) : null,
          releaseStatus: 'released',
        });
      }
    }

    if (blockMatches.length > 0 && results.length === 0) {
      throw new TechnologySourceFetchError(
        'SOURCE_INVALID',
        'RSS/Atom feed items contained no usable title and summary',
      );
    }

    return results;
  }
}
