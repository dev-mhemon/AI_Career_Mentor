import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AIRequestDTO,
  AIResponseDTO,
  GoalInterpretationOutput,
  UiLanguage,
} from '../../ai/ai.types.js';
import { AiGatewayService } from '../../ai/services/ai-gateway.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import type { CareerLevel, RoleOptionDTO } from '../../profile/profile.dto.js';
import {
  ProfileService,
  type TransactionalQueryExecutor,
} from '../../profile/profile.service.js';
import {
  CAREER_LEVEL_VALUES,
  GOAL_STATUS_VALUES,
  hasNulOrUnpairedSurrogate,
  type CareerGoalCreateDTO,
  type CareerGoalListQueryDTO,
  type CareerGoalListResponseDTO,
  type CareerGoalResponseDTO,
  type DiscontinueCareerGoalResponseDTO,
  type GoalClarificationDTO,
  type GoalConfirmDTO,
  type GoalStatus,
} from '../dto/career-goal.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GOAL_INTERPRETATION_SCHEMA_ID = 'goal_interpretation.v1';
const GOAL_INTERPRETATION_TIMEOUT_MS = 9_500;
const GOAL_INTERPRETATION_MAX_INPUT_UNITS = 4_000;
const GOAL_INTERPRETATION_MAX_OUTPUT_UNITS = 1_500;
const MAX_ACTIVE_GOALS_AND_ROADMAPS = 3;
const MAX_CLARIFICATION_ROUNDS = 2;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

const BANGLA_CHAR_PATTERN = /[\u0980-\u09ff]/;
const LATIN_LETTER_PATTERN = /[a-zA-Z]/;

interface CareerRoleRow {
  id: string;
  slug?: string;
  name: string;
  aliases?: string[];
}

interface ClarificationHistoryEntry {
  round: number;
  question: string | null;
  answer: string;
  rationales?: Record<string, string | null>;
}

interface CareerGoalRow {
  id: string;
  user_id?: string;
  goal_text: string;
  status: GoalStatus;
  clarification_round: number;
  clarification_question: string | null;
  clarifications?: unknown;
  proposed_role_id: string | null;
  role_name?: string | null;
  alternative_role_ids: string[] | null;
  suggested_level: CareerLevel | null;
  target_level: CareerLevel | null;
  confirmed_role_id?: string | null;
  confirmed_at?: Date | string | null;
  discontinued_at?: Date | string | null;
  roadmap_id?: string | null;
  created_at: Date | string;
  created_at_cursor?: string | null;
  updated_at?: Date | string;
}

interface ActiveCountRow {
  active_count?: number | string;
  count?: number | string;
}

interface ResolvedGoalInterpretation {
  status: 'clarifying' | 'awaiting_confirmation';
  clarificationRound: number;
  clarificationQuestion: string | null;
  proposedRoleId: string | null;
  proposedRoleName: string | null;
  alternativeRoleIds: string[];
  alternativeRoles: RoleOptionDTO[];
  suggestedLevel: CareerLevel | null;
  rationalesByRoleId: Record<string, string | null>;
}

function toIsoTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return new Date(0).toISOString();
}

export function detectUiLanguage(text: string): UiLanguage {
  const hasBangla = BANGLA_CHAR_PATTERN.test(text);
  const hasLatin = LATIN_LETTER_PATTERN.test(text);
  if (hasBangla && hasLatin) {
    return 'mixed';
  }
  if (hasBangla) {
    return 'bn';
  }
  return 'en';
}

function encodeGoalCursor(createdAt: Date | string, id: string): string {
  const iso = toIsoTimestamp(createdAt);
  return Buffer.from(
    JSON.stringify({ created_at: iso, id: id.toLowerCase() }),
    'utf8',
  ).toString('base64url');
}

function decodeGoalCursor(rawCursor: string): {
  createdAt: string;
  id: string;
} {
  try {
    const json = Buffer.from(rawCursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as {
      created_at?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed?.created_at !== 'string' ||
      !parsed.created_at.trim() ||
      Number.isNaN(Date.parse(parsed.created_at)) ||
      typeof parsed?.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id.trim())
    ) {
      throw new Error('Malformed cursor payload');
    }
    return {
      createdAt: parsed.created_at.trim(),
      id: parsed.id.trim().toLowerCase(),
    };
  } catch {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor', [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: 'cursor must be a valid opaque pagination token',
      },
    ]);
  }
}

function normalizeClarificationsArray(
  raw: unknown,
): ClarificationHistoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: ClarificationHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const round =
      typeof rec.round === 'number' && Number.isInteger(rec.round)
        ? rec.round
        : entries.length + 1;
    const question = typeof rec.question === 'string' ? rec.question : null;
    const answer = typeof rec.answer === 'string' ? rec.answer : '';
    const rationales: Record<string, string | null> | undefined =
      rec.rationales &&
      typeof rec.rationales === 'object' &&
      !Array.isArray(rec.rationales)
        ? (rec.rationales as Record<string, string | null>)
        : undefined;
    entries.push({
      round,
      question,
      answer,
      ...(rationales ? { rationales } : {}),
    });
  }
  return entries;
}

function extractStoredRationales(
  rawClarifications: unknown,
): Record<string, string | null> {
  if (!Array.isArray(rawClarifications)) {
    return {};
  }
  const merged: Record<string, string | null> = {};
  for (const entry of rawClarifications) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    if (
      rec.rationales &&
      typeof rec.rationales === 'object' &&
      !Array.isArray(rec.rationales)
    ) {
      for (const [roleId, rationale] of Object.entries(
        rec.rationales as Record<string, unknown>,
      )) {
        if (typeof rationale === 'string' && rationale.trim().length > 0) {
          merged[roleId.toLowerCase()] = rationale.trim();
        }
      }
    }
  }
  return merged;
}

/**
 * Service implementing `C05` §14.4 Career Goal API (`EP-C01`–`EP-C07`).
 *
 * Enforces:
 * - Zero AI calls inside open database transactions.
 * - Deadlock-safe lock ordering (`public.users FOR UPDATE` via `DatabaseService.transaction` before `career_goals`/`roadmaps`).
 * - Write-boundary `private.effective_feature_access(user_id, 'roadmap_generator')` recheck inside the commit transaction.
 * - Approved-only `public.career_roles` resolution (`status = 'approved' AND deleted_at IS NULL`).
 * - 2-round clarification ceiling (`PRD` §15) with coercion to `awaiting_confirmation` on round 2.
 * - Single-transaction `EP-C05` confirmation + `ProfileService.initializeProgress` (`R07`).
 * - Safe `uq_roadmaps_one_focus` handling on `EP-C07` discontinue (`is_focus = false` cleared before promoting another active `locked` roadmap).
 */
@Injectable()
export class CareerGoalService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AiGatewayService) private readonly aiGateway: AiGatewayService,
    @Inject(ProfileService) private readonly profileService: ProfileService,
  ) {}

  private assertValidUserId(userId: string): string {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
      fail(401, 'AUTH_REQUIRED', 'Valid authenticated user ID is required');
    }
    return userId.trim();
  }

  private assertValidGoalId(goalId: string): string {
    if (typeof goalId !== 'string' || !UUID_PATTERN.test(goalId.trim())) {
      fail(400, 'INVALID_FORMAT', 'Career goal id must be a valid UUID', [
        {
          field: 'id',
          code: 'INVALID_FORMAT',
          message: 'id must be a valid UUID',
        },
      ]);
    }
    return goalId.trim();
  }

  private validateGoalText(rawText: unknown): string {
    if (typeof rawText !== 'string') {
      fail(
        422,
        'VALIDATION_FAILED',
        'goal_text must be between 3 and 300 characters',
        [
          {
            field: 'goal_text',
            code: 'VALIDATION_FAILED',
            message: 'goal_text must be a string between 3 and 300 characters',
          },
        ],
      );
    }
    const trimmed = rawText.trim();
    const codePointCount = Array.from(trimmed).length;
    if (
      codePointCount < 3 ||
      codePointCount > 300 ||
      hasNulOrUnpairedSurrogate(trimmed)
    ) {
      fail(
        422,
        'VALIDATION_FAILED',
        'goal_text must be between 3 and 300 characters',
        [
          {
            field: 'goal_text',
            code: 'VALIDATION_FAILED',
            message: 'goal_text must be between 3 and 300 characters',
          },
        ],
      );
    }
    return trimmed;
  }

  private validateClarificationAnswer(rawAnswer: unknown): string {
    if (typeof rawAnswer !== 'string') {
      fail(
        422,
        'VALIDATION_FAILED',
        'answer must be between 1 and 300 characters',
        [
          {
            field: 'answer',
            code: 'VALIDATION_FAILED',
            message: 'answer must be a string between 1 and 300 characters',
          },
        ],
      );
    }
    const trimmed = rawAnswer.trim();
    const codePointCount = Array.from(trimmed).length;
    if (
      codePointCount < 1 ||
      codePointCount > 300 ||
      hasNulOrUnpairedSurrogate(trimmed)
    ) {
      fail(
        422,
        'VALIDATION_FAILED',
        'answer must be between 1 and 300 characters',
        [
          {
            field: 'answer',
            code: 'VALIDATION_FAILED',
            message: 'answer must be between 1 and 300 characters',
          },
        ],
      );
    }
    return trimmed;
  }

  private validateConfirmDto(dto: GoalConfirmDTO): {
    canonicalRoleId: string;
    targetLevel: CareerLevel;
  } {
    const rawRoleId =
      typeof dto?.canonical_role_id === 'string'
        ? dto.canonical_role_id.trim().toLowerCase()
        : '';
    if (!UUID_PATTERN.test(rawRoleId)) {
      fail(422, 'VALIDATION_FAILED', 'canonical_role_id must be a valid UUID', [
        {
          field: 'canonical_role_id',
          code: 'VALIDATION_FAILED',
          message: 'canonical_role_id must be a valid UUID',
        },
      ]);
    }
    const rawLevel =
      typeof dto?.target_level === 'string'
        ? (dto.target_level.trim() as CareerLevel)
        : ('' as CareerLevel);
    if (!CAREER_LEVEL_VALUES.includes(rawLevel)) {
      fail(
        422,
        'INVALID_ENUM_VALUE',
        'target_level must be junior, mid, or senior',
        [
          {
            field: 'target_level',
            code: 'INVALID_ENUM_VALUE',
            message: 'target_level must be junior, mid, or senior',
          },
        ],
      );
    }
    return {
      canonicalRoleId: rawRoleId,
      targetLevel: rawLevel,
    };
  }

  private async assertRoadmapGeneratorAccess(
    db: TransactionalQueryExecutor,
    userId: string,
  ): Promise<void> {
    const rows = await db.query<Array<{ enabled?: boolean }>>(
      "SELECT private.effective_feature_access($1, 'roadmap_generator') AS enabled",
      [userId],
    );
    const access = Array.isArray(rows) ? rows[0] : undefined;
    if (!access?.enabled) {
      fail(403, 'FEATURE_DISABLED', 'Roadmap generation access is disabled');
    }
  }

  private async countActiveGoalsAndRoadmaps(
    db: TransactionalQueryExecutor,
    userId: string,
    excludeGoalId?: string,
  ): Promise<number> {
    const rows = excludeGoalId
      ? await db.query<ActiveCountRow[]>(
          `SELECT count(*)::int AS active_count
             FROM (
               SELECT id AS goal_id
                 FROM public.career_goals
                WHERE user_id = $1
                  AND status = 'confirmed'
                  AND id <> $2
               UNION
               SELECT career_goal_id AS goal_id
                 FROM public.roadmaps
                WHERE user_id = $1
                  AND status <> 'archived'
                  AND career_goal_id <> $2
             ) active_units`,
          [userId, excludeGoalId],
        )
      : await db.query<ActiveCountRow[]>(
          `SELECT count(*)::int AS active_count
             FROM (
               SELECT id AS goal_id
                 FROM public.career_goals
                WHERE user_id = $1
                  AND status = 'confirmed'
               UNION
               SELECT career_goal_id AS goal_id
                 FROM public.roadmaps
                WHERE user_id = $1
                  AND status <> 'archived'
             ) active_units`,
          [userId],
        );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const rawCount = row?.active_count ?? row?.count ?? 0;
    return Number(rawCount) || 0;
  }

  private async loadApprovedCareerRoles(
    db: TransactionalQueryExecutor,
  ): Promise<CareerRoleRow[]> {
    const rows = await db.query<CareerRoleRow[]>(
      `SELECT id, slug, name, aliases
         FROM public.career_roles
        WHERE status = 'approved'
          AND deleted_at IS NULL
        ORDER BY name ASC, id ASC`,
    );
    return Array.isArray(rows) ? rows : [];
  }

  private matchApprovedCareerRole(
    roles: readonly CareerRoleRow[],
    candidate: { canonicalRoleId?: string | null; name?: string | null } | null,
  ): CareerRoleRow | null {
    if (!candidate || roles.length === 0) {
      return null;
    }
    const candidateId =
      typeof candidate.canonicalRoleId === 'string'
        ? candidate.canonicalRoleId.trim().toLowerCase()
        : '';
    if (candidateId) {
      const byId = roles.find(
        (r) => String(r.id).trim().toLowerCase() === candidateId,
      );
      if (byId) {
        return byId;
      }
      const bySlug = roles.find(
        (r) =>
          typeof r.slug === 'string' &&
          r.slug.trim().toLowerCase() === candidateId,
      );
      if (bySlug) {
        return bySlug;
      }
    }
    const candidateName =
      typeof candidate.name === 'string'
        ? candidate.name.trim().toLowerCase()
        : '';
    if (candidateName) {
      const byName = roles.find(
        (r) => String(r.name).trim().toLowerCase() === candidateName,
      );
      if (byName) {
        return byName;
      }
      const byAlias = roles.find(
        (r) =>
          Array.isArray(r.aliases) &&
          r.aliases.some(
            (alias) =>
              typeof alias === 'string' &&
              alias.trim().toLowerCase() === candidateName,
          ),
      );
      if (byAlias) {
        return byAlias;
      }
      const bySubstring = roles.find((r) => {
        const roleName = String(r.name).trim().toLowerCase();
        return (
          candidateName.includes(roleName) || roleName.includes(candidateName)
        );
      });
      if (bySubstring) {
        return bySubstring;
      }
    }
    return null;
  }

  private resolveInterpretationAgainstCatalog(
    aiOutput: GoalInterpretationOutput,
    approvedRoles: readonly CareerRoleRow[],
    targetRound: number,
    forceConfirmation = false,
  ): ResolvedGoalInterpretation {
    if (!aiOutput.isTechnologyGoal) {
      fail(
        422,
        'OUT_OF_SCOPE_GOAL',
        'Career goal is outside technology career scope',
      );
    }

    const rationalesByRoleId: Record<string, string | null> = {};
    let proposedRole = this.matchApprovedCareerRole(
      approvedRoles,
      aiOutput.proposedRole,
    );

    const alternativeRoles: RoleOptionDTO[] = [];
    const seenRoleIds = new Set<string>();
    if (proposedRole) {
      seenRoleIds.add(String(proposedRole.id).toLowerCase());
    }

    for (const alt of Array.isArray(aiOutput.alternativeRoles)
      ? aiOutput.alternativeRoles
      : []) {
      const matched = this.matchApprovedCareerRole(approvedRoles, alt);
      if (!matched) {
        continue;
      }
      const roleId = String(matched.id);
      const lowerId = roleId.toLowerCase();
      const rationale =
        typeof alt.matchReason === 'string' && alt.matchReason.trim().length > 0
          ? alt.matchReason.trim()
          : null;
      rationalesByRoleId[lowerId] = rationale;

      if (!proposedRole) {
        proposedRole = matched;
        seenRoleIds.add(lowerId);
        continue;
      }
      if (seenRoleIds.has(lowerId)) {
        continue;
      }
      seenRoleIds.add(lowerId);
      alternativeRoles.push({
        canonical_role_id: roleId,
        name: String(matched.name),
        rationale,
      });
    }

    const suggestedLevel: CareerLevel | null =
      aiOutput.suggestedLevel &&
      CAREER_LEVEL_VALUES.includes(aiOutput.suggestedLevel)
        ? aiOutput.suggestedLevel
        : forceConfirmation
          ? 'junior'
          : null;

    if (approvedRoles.length === 0) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI output did not resolve to an approved canonical career role',
        undefined,
        true,
      );
    }

    const wantsClarification =
      !forceConfirmation &&
      targetRound < MAX_CLARIFICATION_ROUNDS &&
      (aiOutput.clarificationNeeded || !proposedRole);

    if (wantsClarification) {
      const round = Math.min(
        MAX_CLARIFICATION_ROUNDS,
        Math.max(1, targetRound || aiOutput.clarificationRound || 1),
      );
      const question =
        typeof aiOutput.clarificationQuestion === 'string' &&
        aiOutput.clarificationQuestion.trim().length > 0
          ? aiOutput.clarificationQuestion.trim()
          : 'Could you clarify which technology specialization best matches your goal?';
      return {
        status: 'clarifying',
        clarificationRound: round,
        clarificationQuestion: question,
        proposedRoleId: null,
        proposedRoleName: null,
        alternativeRoleIds: [],
        alternativeRoles: [],
        suggestedLevel: null,
        rationalesByRoleId: {},
      };
    }

    if (!proposedRole) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI output did not resolve to an approved canonical career role',
        undefined,
        true,
      );
    }

    return {
      status: 'awaiting_confirmation',
      clarificationRound: Math.min(
        MAX_CLARIFICATION_ROUNDS,
        Math.max(0, targetRound),
      ),
      clarificationQuestion: null,
      proposedRoleId: String(proposedRole.id),
      proposedRoleName: String(proposedRole.name),
      alternativeRoleIds: alternativeRoles.map((r) => r.canonical_role_id),
      alternativeRoles,
      suggestedLevel: suggestedLevel ?? 'junior',
      rationalesByRoleId,
    };
  }

  private async executeGoalInterpretationWithDeadline(
    request: AIRequestDTO,
  ): Promise<AIResponseDTO<GoalInterpretationOutput>> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, GOAL_INTERPRETATION_TIMEOUT_MS);
    try {
      return await this.aiGateway.execute<GoalInterpretationOutput>(request, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async mapGoalRowToDto(
    db: TransactionalQueryExecutor,
    row: CareerGoalRow,
    rationalesOverride?: Record<string, string | null>,
    preloadedAlternativesById?: ReadonlyMap<
      string,
      { canonical_role_id: string; name: string }
    >,
  ): Promise<CareerGoalResponseDTO> {
    const altIds = Array.isArray(row.alternative_role_ids)
      ? row.alternative_role_ids
      : [];
    let byId: ReadonlyMap<string, { canonical_role_id: string; name: string }>;
    if (preloadedAlternativesById) {
      byId = preloadedAlternativesById;
    } else {
      const fetchedMap = new Map<
        string,
        { canonical_role_id: string; name: string }
      >();
      if (altIds.length > 0) {
        const queried = await db.query<
          Array<{ canonical_role_id: string; name: string }>
        >(
          `SELECT id AS canonical_role_id, name
             FROM public.career_roles
            WHERE id = ANY($1::uuid[])
              AND status = 'approved'
              AND deleted_at IS NULL`,
          [altIds],
        );
        for (const alt of Array.isArray(queried) ? queried : []) {
          fetchedMap.set(String(alt.canonical_role_id).toLowerCase(), {
            canonical_role_id: String(alt.canonical_role_id),
            name: String(alt.name),
          });
        }
      }
      byId = fetchedMap;
    }

    const storedRationales = {
      ...extractStoredRationales(row.clarifications),
      ...(rationalesOverride ?? {}),
    };

    const orderedAlternatives: RoleOptionDTO[] = [];
    for (const rawId of altIds) {
      const found = byId.get(String(rawId).toLowerCase());
      if (found) {
        orderedAlternatives.push({
          canonical_role_id: found.canonical_role_id,
          name: found.name,
          rationale:
            storedRationales[found.canonical_role_id.toLowerCase()] ?? null,
        });
      }
    }

    const activeRoleId = row.confirmed_role_id ?? row.proposed_role_id ?? null;
    let activeRoleName =
      typeof row.role_name === 'string' && row.role_name.trim().length > 0
        ? row.role_name
        : null;

    if (activeRoleId && !activeRoleName) {
      const roleRows = await db.query<Array<{ name: string }>>(
        `SELECT name
           FROM public.career_roles
          WHERE id = $1
            AND status = 'approved'
            AND deleted_at IS NULL`,
        [activeRoleId],
      );
      activeRoleName =
        Array.isArray(roleRows) && roleRows[0]?.name
          ? String(roleRows[0].name)
          : null;
    }

    return {
      id: String(row.id),
      goal_text: String(row.goal_text),
      status: row.status,
      clarification_round: Number(row.clarification_round) || 0,
      clarification_question:
        row.status === 'clarifying'
          ? (row.clarification_question ?? null)
          : null,
      proposed_role:
        activeRoleId && activeRoleName
          ? {
              canonical_role_id: String(activeRoleId),
              name: String(activeRoleName),
            }
          : null,
      alternative_roles: orderedAlternatives,
      suggested_level: row.suggested_level ?? null,
      target_level: row.target_level ?? null,
      roadmap_id: row.roadmap_id ?? null,
      created_at: toIsoTimestamp(row.created_at),
    };
  }

  private async queryOwnedGoal(
    db: TransactionalQueryExecutor,
    userId: string,
    goalId: string,
  ): Promise<CareerGoalRow> {
    const rows = await db.query<CareerGoalRow[]>(
      `SELECT g.*,
              r.name AS role_name,
              (SELECT id FROM public.roadmaps rm WHERE rm.career_goal_id = g.id AND rm.user_id = g.user_id LIMIT 1) AS roadmap_id
         FROM public.career_goals g
         LEFT JOIN public.career_roles r
           ON r.id = COALESCE(g.confirmed_role_id, g.proposed_role_id)
          AND r.status = 'approved'
          AND r.deleted_at IS NULL
        WHERE g.user_id = $1
          AND g.id = $2`,
      [userId, goalId],
    );
    const goal = Array.isArray(rows) ? rows[0] : undefined;
    if (!goal) {
      fail(404, 'RESOURCE_NOT_FOUND', 'Career goal not found');
    }
    return goal;
  }

  /**
   * `EP-C01` (`POST /api/v1/career/goals`, `201 Created`):
   * 1. Validates `goal_text` (3..300 trimmed chars, no NUL/unpaired surrogates).
   * 2. Pre-checks `private.effective_feature_access` and active goal/roadmap count < 3 before AI call.
   * 3. Calls `AiGatewayService.execute` (`goal_interpretation`, `< 10s` timeout) strictly OUTSIDE any DB transaction.
   * 4. Rejects non-tech goals with `422 OUT_OF_SCOPE_GOAL` and resolves roles strictly against approved `public.career_roles`.
   * 5. Opens ONE DB transaction (`public.users FOR UPDATE` first), rechecks `effective_feature_access` and active count `< 3`,
   *    inserts `public.career_goals`, and advances `last_active_at` (`R24` `foreground = true`).
   */
  async createGoal(
    userId: string,
    dto: CareerGoalCreateDTO,
  ): Promise<CareerGoalResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const goalText = this.validateGoalText(dto?.goal_text);

    // Pre-check feature access, active limit < 3, and load approved roles in a short read transaction
    const preflight = await this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);
        const activeCount = await this.countActiveGoalsAndRoadmaps(
          db,
          normalizedUserId,
        );
        if (activeCount >= MAX_ACTIVE_GOALS_AND_ROADMAPS) {
          fail(
            409,
            'ROADMAP_LIMIT_REACHED',
            'At most 3 active career goals or roadmaps are allowed',
          );
        }
        const roles = await this.loadApprovedCareerRoles(db);
        return { roles };
      },
      true,
      false,
    );

    // Execute synchronous AI goal interpretation STRICTLY OUTSIDE any DB transaction
    const language = detectUiLanguage(goalText);
    const aiResponse = await this.executeGoalInterpretationWithDeadline({
      task: 'goal_interpretation',
      user_id: normalizedUserId,
      feature_key: 'roadmap_generator',
      context: {
        clarification_round: 0,
        approved_roles: preflight.roles.map((r) => ({
          canonical_role_id: r.id,
          slug: r.slug ?? null,
          name: r.name,
        })),
      },
      untrusted_inputs: [goalText],
      output_schema: GOAL_INTERPRETATION_SCHEMA_ID,
      language,
      idempotency_key: `ep-c01:${normalizedUserId}:${randomUUID()}`,
      budget: {
        max_input_units: GOAL_INTERPRETATION_MAX_INPUT_UNITS,
        max_output_units: GOAL_INTERPRETATION_MAX_OUTPUT_UNITS,
        timeout_ms: GOAL_INTERPRETATION_TIMEOUT_MS,
      },
    });

    if (!aiResponse.output) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI output failed validation and was discarded. Please try again.',
        undefined,
        true,
      );
    }
    const aiOutput = aiResponse.output;
    if (!aiOutput.isTechnologyGoal) {
      fail(
        422,
        'OUT_OF_SCOPE_GOAL',
        'Career goal is outside technology career scope',
      );
    }

    // Open single write transaction: lock users row first (via DatabaseService.transaction),
    // recheck effective_feature_access and active limit < 3, resolve approved roles, and insert career_goals
    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);
        const activeCount = await this.countActiveGoalsAndRoadmaps(
          db,
          normalizedUserId,
        );
        if (activeCount >= MAX_ACTIVE_GOALS_AND_ROADMAPS) {
          fail(
            409,
            'ROADMAP_LIMIT_REACHED',
            'At most 3 active career goals or roadmaps are allowed',
          );
        }

        const approvedRoles = await this.loadApprovedCareerRoles(db);
        const resolved = this.resolveInterpretationAgainstCatalog(
          aiOutput,
          approvedRoles,
          aiOutput.clarificationNeeded ? 1 : 0,
          false,
        );

        const initialClarifications =
          Object.keys(resolved.rationalesByRoleId).length > 0
            ? [
                {
                  round: 0,
                  question: null,
                  answer: '',
                  rationales: resolved.rationalesByRoleId,
                },
              ]
            : [];

        const insertedRows = await db.query<CareerGoalRow[]>(
          `INSERT INTO public.career_goals (
             user_id,
             goal_text,
             status,
             clarification_round,
             clarification_question,
             clarifications,
             proposed_role_id,
             alternative_role_ids,
             suggested_level
           )
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::uuid[], $9)
           RETURNING *`,
          [
            normalizedUserId,
            goalText,
            resolved.status,
            resolved.clarificationRound,
            resolved.clarificationQuestion,
            JSON.stringify(initialClarifications),
            resolved.proposedRoleId,
            resolved.alternativeRoleIds,
            resolved.suggestedLevel,
          ],
        );

        const inserted = Array.isArray(insertedRows)
          ? insertedRows[0]
          : undefined;
        if (!inserted) {
          fail(500, 'DATABASE_ERROR', 'Failed to persist career goal');
        }
        inserted.role_name = resolved.proposedRoleName;
        inserted.roadmap_id = null;

        return this.mapGoalRowToDto(db, inserted, resolved.rationalesByRoleId);
      },
      true,
      true,
    );
  }

  /**
   * `EP-C02` (`GET /api/v1/career/goals`, `200 OK`, `Gate: none`):
   * Lists the authenticated user's career goals with optional `status` filter and
   * deterministic cursor pagination (`ORDER BY created_at DESC, id DESC`).
   * Does not advance `last_active_at` (`R24` `foreground = false`).
   */
  async listGoals(
    userId: string,
    query?: CareerGoalListQueryDTO,
  ): Promise<CareerGoalListResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);

    const status = query?.status;
    if (status !== undefined && !GOAL_STATUS_VALUES.includes(status)) {
      fail(422, 'INVALID_ENUM_VALUE', 'Invalid career goal status filter', [
        {
          field: 'status',
          code: 'INVALID_ENUM_VALUE',
          message:
            'status must be clarifying, awaiting_confirmation, confirmed, or discontinued',
        },
      ]);
    }

    const rawLimit = query?.limit ?? DEFAULT_PAGE_LIMIT;
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      fail(422, 'VALIDATION_FAILED', 'limit must be between 1 and 100', [
        {
          field: 'limit',
          code: 'VALIDATION_FAILED',
          message: 'limit must be an integer between 1 and 100',
        },
      ]);
    }

    const decodedCursor =
      typeof query?.cursor === 'string' && query.cursor.trim().length > 0
        ? decodeGoalCursor(query.cursor)
        : null;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const params: unknown[] = [normalizedUserId];
        const whereClauses: string[] = ['g.user_id = $1'];

        if (status) {
          params.push(status);
          whereClauses.push(`g.status = $${params.length}`);
        }
        if (decodedCursor) {
          params.push(decodedCursor.createdAt, decodedCursor.id);
          const createdIdx = params.length - 1;
          const idIdx = params.length;
          whereClauses.push(
            `(g.created_at < $${createdIdx}::timestamptz OR (g.created_at = $${createdIdx}::timestamptz AND g.id < $${idIdx}::uuid))`,
          );
        }
        params.push(limit + 1);
        const limitIdx = params.length;

        const rows = await db.query<CareerGoalRow[]>(
          `SELECT g.*,
                  g.created_at::text AS created_at_cursor,
                  r.name AS role_name,
                  (SELECT id FROM public.roadmaps rm WHERE rm.career_goal_id = g.id AND rm.user_id = g.user_id LIMIT 1) AS roadmap_id
             FROM public.career_goals g
             LEFT JOIN public.career_roles r
               ON r.id = COALESCE(g.confirmed_role_id, g.proposed_role_id)
              AND r.status = 'approved'
              AND r.deleted_at IS NULL
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY g.created_at DESC, g.id DESC
            LIMIT $${limitIdx}`,
          params,
        );

        const list = Array.isArray(rows) ? rows : [];
        const hasMore = list.length > limit;
        const pageRows = hasMore ? list.slice(0, limit) : list;

        const distinctAltIds = [
          ...new Set(
            pageRows.flatMap((row) =>
              Array.isArray(row.alternative_role_ids)
                ? row.alternative_role_ids.map((id) => String(id))
                : [],
            ),
          ),
        ];
        const preloadedAlternativesById = new Map<
          string,
          { canonical_role_id: string; name: string }
        >();
        if (distinctAltIds.length > 0) {
          const queriedAlts = await db.query<
            Array<{ canonical_role_id: string; name: string }>
          >(
            `SELECT id AS canonical_role_id, name
               FROM public.career_roles
              WHERE id = ANY($1::uuid[])
                AND status = 'approved'
                AND deleted_at IS NULL`,
            [distinctAltIds],
          );
          for (const alt of Array.isArray(queriedAlts) ? queriedAlts : []) {
            preloadedAlternativesById.set(
              String(alt.canonical_role_id).toLowerCase(),
              {
                canonical_role_id: String(alt.canonical_role_id),
                name: String(alt.name),
              },
            );
          }
        }

        const items: CareerGoalResponseDTO[] = [];
        for (const row of pageRows) {
          items.push(
            await this.mapGoalRowToDto(
              db,
              row,
              undefined,
              preloadedAlternativesById,
            ),
          );
        }

        const lastRow = pageRows[pageRows.length - 1];
        const nextCursor =
          hasMore && lastRow
            ? encodeGoalCursor(
                typeof lastRow.created_at_cursor === 'string' &&
                  lastRow.created_at_cursor.trim().length > 0
                  ? lastRow.created_at_cursor.trim()
                  : lastRow.created_at,
                String(lastRow.id),
              )
            : null;

        return {
          items,
          meta: {
            limit,
            next_cursor: nextCursor,
          },
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-C03` (`GET /api/v1/career/goals/:id`, `200 OK`, `Gate: none`):
   * Returns a single career goal owned by the caller (`404 RESOURCE_NOT_FOUND` on missing or foreign ID).
   * Does not advance `last_active_at` (`R24` `foreground = false`).
   */
  async getGoal(
    userId: string,
    goalId: string,
  ): Promise<CareerGoalResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedGoalId = this.assertValidGoalId(goalId);

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const goal = await this.queryOwnedGoal(
          db,
          normalizedUserId,
          normalizedGoalId,
        );
        return this.mapGoalRowToDto(db, goal);
      },
      true,
      false,
    );
  }

  /**
   * `EP-C04` (`POST /api/v1/career/goals/:id/clarifications`, `200 OK`):
   * 1. Validates `answer` (1..300 trimmed chars, untrusted input).
   * 2. Pre-checks owner, `status === 'clarifying'` (`409 INVALID_STATE_TRANSITION`), and `clarification_round < 2` (`409 CLARIFICATION_LIMIT_REACHED`).
   * 3. Calls `AiGatewayService.execute` OUTSIDE any DB transaction (`timeout_ms <= 10_000`).
   * 4. Re-locks `public.users` then `public.career_goals FOR UPDATE` in ONE transaction, rechecks `effective_feature_access`,
   *    `status === 'clarifying'`, and `clarification_round < 2`, increments `clarification_round`, and coerces to
   *    `awaiting_confirmation` with best canonical interpretation when round reaches 2.
   */
  async answerClarification(
    userId: string,
    goalId: string,
    dto: GoalClarificationDTO,
  ): Promise<CareerGoalResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedGoalId = this.assertValidGoalId(goalId);
    const answer = this.validateClarificationAnswer(dto?.answer);

    // Pre-check ownership, state, round ceiling, and feature access before AI call
    const preflight = await this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);
        const goal = await this.queryOwnedGoal(
          db,
          normalizedUserId,
          normalizedGoalId,
        );
        const currentRound = Number(goal.clarification_round) || 0;
        if (
          goal.status !== 'clarifying' &&
          currentRound >= MAX_CLARIFICATION_ROUNDS &&
          goal.status === 'awaiting_confirmation'
        ) {
          fail(
            409,
            'CLARIFICATION_LIMIT_REACHED',
            'Maximum of 2 clarification rounds reached',
          );
        }
        if (goal.status !== 'clarifying') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Career goal is not awaiting clarification',
          );
        }
        if (currentRound >= MAX_CLARIFICATION_ROUNDS) {
          fail(
            409,
            'CLARIFICATION_LIMIT_REACHED',
            'Maximum of 2 clarification rounds reached',
          );
        }
        const roles = await this.loadApprovedCareerRoles(db);
        return { goal, currentRound, roles };
      },
      true,
      false,
    );

    const nextRound = Math.min(
      MAX_CLARIFICATION_ROUNDS,
      preflight.currentRound + 1,
    );
    const history = normalizeClarificationsArray(preflight.goal.clarifications);
    const untrustedInputs = [
      preflight.goal.goal_text,
      ...history.map((h) => h.answer).filter((a) => a.length > 0),
      answer,
    ];
    const language = detectUiLanguage(`${preflight.goal.goal_text} ${answer}`);

    // Call AiGatewayService OUTSIDE any DB transaction
    const aiResponse = await this.executeGoalInterpretationWithDeadline({
      task: 'goal_interpretation',
      user_id: normalizedUserId,
      feature_key: 'roadmap_generator',
      context: {
        career_goal_id: normalizedGoalId,
        clarification_round: nextRound,
        previous_question: preflight.goal.clarification_question ?? null,
        approved_roles: preflight.roles.map((r) => ({
          canonical_role_id: r.id,
          slug: r.slug ?? null,
          name: r.name,
        })),
      },
      untrusted_inputs: untrustedInputs,
      output_schema: GOAL_INTERPRETATION_SCHEMA_ID,
      language,
      idempotency_key: `ep-c04:${normalizedUserId}:${normalizedGoalId}:r${nextRound}:${randomUUID()}`,
      budget: {
        max_input_units: GOAL_INTERPRETATION_MAX_INPUT_UNITS,
        max_output_units: GOAL_INTERPRETATION_MAX_OUTPUT_UNITS,
        timeout_ms: GOAL_INTERPRETATION_TIMEOUT_MS,
      },
    });

    if (!aiResponse.output) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI output failed validation and was discarded. Please try again.',
        undefined,
        true,
      );
    }
    const aiOutput = aiResponse.output;
    if (!aiOutput.isTechnologyGoal) {
      fail(
        422,
        'OUT_OF_SCOPE_GOAL',
        'Career goal is outside technology career scope',
      );
    }

    // Open ONE write transaction: lock users row first (via DatabaseService.transaction),
    // then lock career_goals FOR UPDATE, recheck effective_feature_access, status === 'clarifying', and round < 2
    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);

        const lockedRows = await db.query<CareerGoalRow[]>(
          `SELECT *
             FROM public.career_goals
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedGoalId],
        );
        const lockedGoal = Array.isArray(lockedRows)
          ? lockedRows[0]
          : undefined;
        if (!lockedGoal) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Career goal not found');
        }

        const currentRound = Number(lockedGoal.clarification_round) || 0;
        if (
          lockedGoal.status !== 'clarifying' &&
          currentRound >= MAX_CLARIFICATION_ROUNDS &&
          lockedGoal.status === 'awaiting_confirmation'
        ) {
          fail(
            409,
            'CLARIFICATION_LIMIT_REACHED',
            'Maximum of 2 clarification rounds reached',
          );
        }
        if (lockedGoal.status !== 'clarifying') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Career goal is not awaiting clarification',
          );
        }
        if (currentRound >= MAX_CLARIFICATION_ROUNDS) {
          fail(
            409,
            'CLARIFICATION_LIMIT_REACHED',
            'Maximum of 2 clarification rounds reached',
          );
        }

        const preflightUpdatedIso =
          preflight.goal.updated_at !== undefined &&
          preflight.goal.updated_at !== null
            ? toIsoTimestamp(preflight.goal.updated_at)
            : null;
        const lockedUpdatedIso =
          lockedGoal.updated_at !== undefined && lockedGoal.updated_at !== null
            ? toIsoTimestamp(lockedGoal.updated_at)
            : null;
        if (
          currentRound !== preflight.currentRound ||
          String(lockedGoal.goal_text) !== String(preflight.goal.goal_text) ||
          (lockedGoal.clarification_question ?? null) !==
            (preflight.goal.clarification_question ?? null) ||
          (preflightUpdatedIso !== null &&
            lockedUpdatedIso !== null &&
            preflightUpdatedIso !== lockedUpdatedIso)
        ) {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Career goal changed during clarification interpretation. Please reload and answer the current question.',
          );
        }

        const newRound = currentRound + 1;
        const forceConfirmation = newRound >= MAX_CLARIFICATION_ROUNDS;

        const approvedRoles = await this.loadApprovedCareerRoles(db);
        const resolved = this.resolveInterpretationAgainstCatalog(
          aiOutput,
          approvedRoles,
          newRound,
          forceConfirmation,
        );

        const finalStatus = forceConfirmation
          ? 'awaiting_confirmation'
          : resolved.status;
        const finalQuestion =
          finalStatus === 'clarifying' ? resolved.clarificationQuestion : null;

        const updatedClarifications: ClarificationHistoryEntry[] = [
          ...normalizeClarificationsArray(lockedGoal.clarifications),
          {
            round: newRound,
            question: lockedGoal.clarification_question ?? null,
            answer,
            ...(Object.keys(resolved.rationalesByRoleId).length > 0
              ? { rationales: resolved.rationalesByRoleId }
              : {}),
          },
        ];

        await db.query(
          `UPDATE public.career_goals
              SET status = $3,
                  clarification_round = $4,
                  clarification_question = $5,
                  clarifications = $6::jsonb,
                  proposed_role_id = $7,
                  alternative_role_ids = $8::uuid[],
                  suggested_level = $9
            WHERE user_id = $1
              AND id = $2`,
          [
            normalizedUserId,
            normalizedGoalId,
            finalStatus,
            newRound,
            finalQuestion,
            JSON.stringify(updatedClarifications),
            resolved.proposedRoleId,
            resolved.alternativeRoleIds,
            resolved.suggestedLevel,
          ],
        );

        const refreshed = await this.queryOwnedGoal(
          db,
          normalizedUserId,
          normalizedGoalId,
        );
        return this.mapGoalRowToDto(db, refreshed, resolved.rationalesByRoleId);
      },
      true,
      true,
    );
  }

  /**
   * `EP-C05` (`POST /api/v1/career/goals/:id/confirm`, `200 OK`):
   * Single DB transaction locking `public.users FOR UPDATE` (via `DatabaseService.transaction`) then
   * `public.career_goals FOR UPDATE`:
   * 1. Rechecks `private.effective_feature_access(user_id, 'roadmap_generator')`.
   * 2. Verifies confirmable status (`409 GOAL_ALREADY_CONFIRMED` if already confirmed, `409 INVALID_STATE_TRANSITION` if discontinued/clarifying).
   * 3. Verifies `canonical_role_id` is in `{proposed_role_id} ∪ alternative_role_ids` (`422 ROLE_MISMATCH`) and approved in `public.career_roles`.
   * 4. Enforces `< 3` active goals/roadmaps (`409 ROADMAP_LIMIT_REACHED`).
   * 5. Updates goal to `confirmed` (`confirmed_at = clock_timestamp()`, `proposed_role_id = canonical_role_id`, `confirmed_role_id = canonical_role_id`).
   * 6. Atomically calls `ProfileService.initializeProgress(db, userId)` inside the SAME transaction per `R07`.
   */
  async confirmGoal(
    userId: string,
    goalId: string,
    dto: GoalConfirmDTO,
  ): Promise<CareerGoalResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedGoalId = this.assertValidGoalId(goalId);
    const { canonicalRoleId, targetLevel } = this.validateConfirmDto(dto);

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);

        const lockedRows = await db.query<CareerGoalRow[]>(
          `SELECT *
             FROM public.career_goals
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedGoalId],
        );
        const goal = Array.isArray(lockedRows) ? lockedRows[0] : undefined;
        if (!goal) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Career goal not found');
        }

        if (goal.status === 'confirmed') {
          fail(
            409,
            'GOAL_ALREADY_CONFIRMED',
            'Career goal is already confirmed',
          );
        }
        if (goal.status !== 'awaiting_confirmation') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Career goal must be awaiting confirmation before confirming',
          );
        }

        const proposedRoleId =
          typeof goal.proposed_role_id === 'string'
            ? goal.proposed_role_id.trim().toLowerCase()
            : '';
        const alternativeIds = (
          Array.isArray(goal.alternative_role_ids)
            ? goal.alternative_role_ids
            : []
        ).map((id) => String(id).trim().toLowerCase());

        if (
          proposedRoleId !== canonicalRoleId &&
          !alternativeIds.includes(canonicalRoleId)
        ) {
          fail(
            422,
            'ROLE_MISMATCH',
            'Selected canonical role is not among the proposed options for this goal',
          );
        }

        const approvedRoleRows = await db.query<CareerRoleRow[]>(
          `SELECT id, name
             FROM public.career_roles
            WHERE id = $1
              AND status = 'approved'
              AND deleted_at IS NULL`,
          [canonicalRoleId],
        );
        const approvedRole = Array.isArray(approvedRoleRows)
          ? approvedRoleRows[0]
          : undefined;
        if (!approvedRole) {
          fail(
            422,
            'ROLE_MISMATCH',
            'Selected canonical role is not an approved career role',
          );
        }

        const activeCount = await this.countActiveGoalsAndRoadmaps(
          db,
          normalizedUserId,
          normalizedGoalId,
        );
        if (activeCount >= MAX_ACTIVE_GOALS_AND_ROADMAPS) {
          fail(
            409,
            'ROADMAP_LIMIT_REACHED',
            'At most 3 active career goals or roadmaps are allowed',
          );
        }

        await db.query(
          `UPDATE public.career_goals
              SET confirmed_role_id = $3,
                  proposed_role_id = $3,
                  target_level = $4,
                  status = 'confirmed',
                  confirmed_at = clock_timestamp()
            WHERE user_id = $1
              AND id = $2`,
          [normalizedUserId, normalizedGoalId, canonicalRoleId, targetLevel],
        );

        await this.profileService.initializeProgress(db, normalizedUserId);

        const refreshed = await this.queryOwnedGoal(
          db,
          normalizedUserId,
          normalizedGoalId,
        );
        return this.mapGoalRowToDto(db, refreshed);
      },
      true,
      true,
    );
  }

  /**
   * `EP-C06` (`PATCH /api/v1/career/goals/:id`, `200 OK`):
   * 1. Validates updated `goal_text` (3..300 trimmed chars).
   * 2. Pre-checks owner, rejects `confirmed` with `409 GOAL_ALREADY_CONFIRMED` and `discontinued` with `409 INVALID_STATE_TRANSITION`.
   * 3. Re-interprets via `AiGatewayService.execute` OUTSIDE any DB transaction (`422 OUT_OF_SCOPE_GOAL` on non-tech).
   * 4. Re-locks `public.users` + `public.career_goals FOR UPDATE` in ONE transaction, rechecks status & `effective_feature_access`,
   *    resets clarification history and `clarification_round` (`0` when `awaiting_confirmation`, `1` when `clarifying`), and persists updated interpretation.
   */
  async updateGoal(
    userId: string,
    goalId: string,
    dto: CareerGoalCreateDTO,
  ): Promise<CareerGoalResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedGoalId = this.assertValidGoalId(goalId);
    const goalText = this.validateGoalText(dto?.goal_text);

    // Pre-check ownership, editable status, and feature access before AI call
    const preflight = await this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);
        const goal = await this.queryOwnedGoal(
          db,
          normalizedUserId,
          normalizedGoalId,
        );
        if (goal.status === 'confirmed') {
          fail(
            409,
            'GOAL_ALREADY_CONFIRMED',
            'Confirmed career goal text cannot be edited',
          );
        }
        if (goal.status === 'discontinued') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Discontinued career goal cannot be edited',
          );
        }
        const roles = await this.loadApprovedCareerRoles(db);
        return { roles };
      },
      true,
      false,
    );

    const language = detectUiLanguage(goalText);
    // Execute AI interpretation STRICTLY OUTSIDE any DB transaction
    const aiResponse = await this.executeGoalInterpretationWithDeadline({
      task: 'goal_interpretation',
      user_id: normalizedUserId,
      feature_key: 'roadmap_generator',
      context: {
        career_goal_id: normalizedGoalId,
        clarification_round: 0,
        approved_roles: preflight.roles.map((r) => ({
          canonical_role_id: r.id,
          slug: r.slug ?? null,
          name: r.name,
        })),
      },
      untrusted_inputs: [goalText],
      output_schema: GOAL_INTERPRETATION_SCHEMA_ID,
      language,
      idempotency_key: `ep-c06:${normalizedUserId}:${normalizedGoalId}:${randomUUID()}`,
      budget: {
        max_input_units: GOAL_INTERPRETATION_MAX_INPUT_UNITS,
        max_output_units: GOAL_INTERPRETATION_MAX_OUTPUT_UNITS,
        timeout_ms: GOAL_INTERPRETATION_TIMEOUT_MS,
      },
    });

    if (!aiResponse.output) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI output failed validation and was discarded. Please try again.',
        undefined,
        true,
      );
    }
    const aiOutput = aiResponse.output;
    if (!aiOutput.isTechnologyGoal) {
      fail(
        422,
        'OUT_OF_SCOPE_GOAL',
        'Career goal is outside technology career scope',
      );
    }

    // Re-lock public.users then public.career_goals FOR UPDATE in ONE write transaction
    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);

        const lockedRows = await db.query<CareerGoalRow[]>(
          `SELECT *
             FROM public.career_goals
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedGoalId],
        );
        const lockedGoal = Array.isArray(lockedRows)
          ? lockedRows[0]
          : undefined;
        if (!lockedGoal) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Career goal not found');
        }
        if (lockedGoal.status === 'confirmed') {
          fail(
            409,
            'GOAL_ALREADY_CONFIRMED',
            'Confirmed career goal text cannot be edited',
          );
        }
        if (lockedGoal.status === 'discontinued') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Discontinued career goal cannot be edited',
          );
        }

        const approvedRoles = await this.loadApprovedCareerRoles(db);
        const resolved = this.resolveInterpretationAgainstCatalog(
          aiOutput,
          approvedRoles,
          aiOutput.clarificationNeeded ? 1 : 0,
          false,
        );

        const resetClarifications =
          Object.keys(resolved.rationalesByRoleId).length > 0
            ? [
                {
                  round: 0,
                  question: null,
                  answer: '',
                  rationales: resolved.rationalesByRoleId,
                },
              ]
            : [];

        await db.query(
          `UPDATE public.career_goals
              SET goal_text = $3,
                  status = $4,
                  clarification_round = $5,
                  clarification_question = $6,
                  clarifications = $7::jsonb,
                  proposed_role_id = $8,
                  alternative_role_ids = $9::uuid[],
                  suggested_level = $10,
                  target_level = NULL,
                  confirmed_role_id = NULL,
                  confirmed_at = NULL
            WHERE user_id = $1
              AND id = $2`,
          [
            normalizedUserId,
            normalizedGoalId,
            goalText,
            resolved.status,
            resolved.clarificationRound,
            resolved.clarificationQuestion,
            JSON.stringify(resetClarifications),
            resolved.proposedRoleId,
            resolved.alternativeRoleIds,
            resolved.suggestedLevel,
          ],
        );

        const refreshed = await this.queryOwnedGoal(
          db,
          normalizedUserId,
          normalizedGoalId,
        );
        return this.mapGoalRowToDto(db, refreshed, resolved.rationalesByRoleId);
      },
      true,
      true,
    );
  }

  /**
   * `EP-C07` (`DELETE /api/v1/career/goals/:id`, `200 OK`, `Gate: none`):
   * Single DB transaction locking `public.users FOR UPDATE` (via `DatabaseService.transaction`),
   * then `public.career_goals FOR UPDATE`:
   * 1. Returns `404 RESOURCE_NOT_FOUND` on missing/foreign goal, `409 INVALID_STATE_TRANSITION` if already discontinued.
   * 2. Sets `status = 'discontinued', discontinued_at = clock_timestamp()`.
   * 3. If a linked `public.roadmaps` row exists, archives it (`status = 'archived'`, `is_focus = false`, `archived_at = clock_timestamp()`)
   *    FIRST so `uq_roadmaps_one_focus` is never violated, and if it was the Focus roadmap, deterministically promotes another
   *    active `locked` roadmap for that user to `is_focus = true` (or leaves `null` if none).
   * 4. Preserves all `learning_evidence`, `skill_progress`, `achievement_history`, and `daily_plans` rows.
   */
  async discontinueGoal(
    userId: string,
    goalId: string,
  ): Promise<DiscontinueCareerGoalResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedGoalId = this.assertValidGoalId(goalId);

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const lockedGoals = await db.query<CareerGoalRow[]>(
          `SELECT id, user_id, status
             FROM public.career_goals
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedGoalId],
        );
        const goal = Array.isArray(lockedGoals) ? lockedGoals[0] : undefined;
        if (!goal) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Career goal not found');
        }
        if (goal.status === 'discontinued') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Career goal is already discontinued',
          );
        }

        await db.query(
          `UPDATE public.career_goals
              SET status = 'discontinued',
                  discontinued_at = clock_timestamp()
            WHERE user_id = $1
              AND id = $2`,
          [normalizedUserId, normalizedGoalId],
        );

        const linkedRoadmaps = await db.query<
          Array<{
            id: string;
            status: 'draft' | 'locked' | 'archived';
            is_focus: boolean;
          }>
        >(
          `SELECT id, status, is_focus
             FROM public.roadmaps
            WHERE user_id = $1
              AND career_goal_id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedGoalId],
        );
        const linkedRoadmap = Array.isArray(linkedRoadmaps)
          ? linkedRoadmaps[0]
          : undefined;

        let archivedRoadmapId: string | null = null;
        let wasFocus = false;

        if (linkedRoadmap) {
          archivedRoadmapId = String(linkedRoadmap.id);
          wasFocus = Boolean(linkedRoadmap.is_focus);
          if (linkedRoadmap.status !== 'archived' || linkedRoadmap.is_focus) {
            // Clear is_focus = false and set status = 'archived' FIRST so uq_roadmaps_one_focus is freed before promotion
            await db.query(
              `UPDATE public.roadmaps
                  SET status = 'archived',
                      is_focus = false,
                      archived_at = COALESCE(archived_at, clock_timestamp()),
                      archive_reason = COALESCE(archive_reason, 'Career goal discontinued')
                WHERE user_id = $1
                  AND id = $2`,
              [normalizedUserId, archivedRoadmapId],
            );
          }
        }

        let newFocusRoadmapId: string | null = null;

        if (wasFocus) {
          const candidates = await db.query<Array<{ id: string }>>(
            `SELECT id
               FROM public.roadmaps
              WHERE user_id = $1
                AND status = 'locked'
                AND id <> $2
              ORDER BY locked_at DESC NULLS LAST, created_at DESC, id DESC
              LIMIT 1
              FOR UPDATE`,
            [normalizedUserId, archivedRoadmapId],
          );
          const replacement = Array.isArray(candidates)
            ? candidates[0]
            : undefined;
          if (replacement?.id) {
            newFocusRoadmapId = String(replacement.id);
            await db.query(
              `UPDATE public.roadmaps
                  SET is_focus = true
                WHERE user_id = $1
                  AND id = $2
                  AND status = 'locked'`,
              [normalizedUserId, newFocusRoadmapId],
            );
          }
        } else {
          const existingFocusRows = await db.query<Array<{ id: string }>>(
            `SELECT id
               FROM public.roadmaps
              WHERE user_id = $1
                AND status = 'locked'
                AND is_focus = true
              LIMIT 1`,
            [normalizedUserId],
          );
          const existingFocus = Array.isArray(existingFocusRows)
            ? existingFocusRows[0]
            : undefined;
          newFocusRoadmapId = existingFocus?.id
            ? String(existingFocus.id)
            : null;
        }

        return {
          id: normalizedGoalId,
          status: 'discontinued',
          archived_roadmap_id: archivedRoadmapId,
          new_focus_roadmap_id: newFocusRoadmapId,
        };
      },
      true,
      true,
    );
  }
}
