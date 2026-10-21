import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DatabaseService } from '../auth/services/database.service.js';
import { missingFields } from '../auth/services/auth.service.js';
import { fail } from '../common/http.js';
import type {
  AliasInput,
  ConfirmGoal,
  LearningPatch,
  PreferencesPatch,
  ProfilePatch,
} from './profile.dto.js';
@Injectable()
export class ProfileService {
  constructor(private readonly database: DatabaseService) {}
  async read(id: string) {
    return this.database.transaction(id, (db) => this.view(db, id));
  }
  private async view(
    db: EntityManager,
    id: string,
    progress?: string,
    unresolved_skills: unknown[] = [],
  ) {
    const [p] = await db.query(
      'SELECT p.*,pr.learning_preference FROM public.user_profiles p JOIN public.user_preferences pr USING(user_id) WHERE p.user_id=$1',
      [id],
    );
    if (!p) fail(404, 'RESOURCE_NOT_FOUND', 'Profile not found');
    const skills = await db.query(
      `SELECT s.id AS skill_id,s.canonical_name AS name,
      EXISTS(SELECT 1 FROM public.user_skill_aliases a WHERE a.user_id=$2 AND a.skill_id=s.id) AS alias_resolved,
      COALESCE((SELECT sp.learning_state::text FROM public.skill_progress sp WHERE sp.user_id=$2 AND sp.skill_id=s.id ORDER BY CASE sp.learning_state WHEN 'proficient' THEN 3 WHEN 'practicing' THEN 2 WHEN 'learning' THEN 1 ELSE 0 END DESC LIMIT 1),'learning') AS learning_state,
      CASE WHEN EXISTS(SELECT 1 FROM public.skill_progress sp WHERE sp.user_id=$2 AND sp.skill_id=s.id AND sp.evidence_count>0) THEN 'evidence' ELSE 'self_reported' END AS source FROM public.skills s WHERE s.id=ANY($1::uuid[]) ORDER BY s.canonical_name`,
      [p.self_reported_skill_ids, id],
    );
    const goals = await db.query(
      "SELECT id FROM public.career_goals WHERE user_id=$1 AND status='confirmed'",
      [id],
    );
    return {
      current_role: p.current_role_title,
      education: p.education,
      experience_level: p.experience_level,
      existing_skills: skills,
      existing_skills_none: p.existing_skills_none,
      learning_preference: p.learning_preference,
      preferred_daily_hours:
        p.preferred_daily_hours === null
          ? null
          : Number(p.preferred_daily_hours),
      timezone: p.timezone,
      timezone_detected: p.timezone_detected,
      active_career_goal_ids: goals.map((g: any) => g.id),
      profile_complete: missingFields(p).length === 0,
      missing_fields: missingFields(p),
      unresolved_skills,
      progress_initialization:
        progress ||
        (goals.length ? 'unchanged' : 'deferred_until_level_confirmation'),
      updated_at: p.updated_at,
    };
  }
  async initializeProgress(db: EntityManager, id: string) {
    const levels = await db.query(
      "SELECT DISTINCT target_level FROM public.career_goals WHERE user_id=$1 AND status='confirmed'",
      [id],
    );
    if (!levels.length) return 'deferred_until_level_confirmation';
    let changed = false;
    for (const { target_level } of levels) {
      const rows = await db.query(
        `INSERT INTO public.skill_progress(user_id,skill_id,career_level,learning_state,state_reason)
        SELECT user_id,unnest(self_reported_skill_ids),$2,'learning','Self-reported skill; confirmed goal level'
        FROM public.user_profiles WHERE user_id=$1
        ON CONFLICT(user_id,skill_id,career_level) DO UPDATE SET learning_state='learning',state_reason=CASE WHEN skill_progress.state_reason IS DISTINCT FROM 'Self-reported skill; confirmed goal level' THEN 'Self-reported skill; confirmed goal level' ELSE 'Reconfirmed self-reported skill; confirmed goal level' END
        WHERE skill_progress.learning_state='not_started' RETURNING id`,
        [id, target_level],
      );
      changed ||= rows.length > 0;
    }
    return changed ? 'initialized' : 'unchanged';
  }
  async patch(id: string, input: ProfilePatch) {
    return this.database.transaction(id, async (db) => {
      const [old] = await db.query(
        'SELECT * FROM public.user_profiles WHERE user_id=$1 FOR UPDATE',
        [id],
      );
      let skillIds: string[] = old.self_reported_skill_ids;
      const unresolved: unknown[] = [];
      if (input.existing_skills) {
        skillIds = [];
        for (const { name } of input.existing_skills) {
          const resolved = await db.query(
            `SELECT DISTINCT s.id FROM public.skills s WHERE s.status='approved' AND s.deleted_at IS NULL AND (
          lower(s.canonical_name)=lower($2) OR EXISTS(SELECT 1 FROM public.skill_aliases a WHERE a.skill_id=s.id AND a.status='validated' AND a.alias_normalized=lower($2)) OR EXISTS(SELECT 1 FROM public.user_skill_aliases a WHERE a.user_id=$1 AND a.skill_id=s.id AND a.alias_normalized=lower($2)))`,
            [id, name],
          );
          if (resolved.length === 1) skillIds.push(resolved[0].id);
          else {
            const candidates = await db.query(
              "SELECT id AS skill_id,canonical_name AS name FROM public.skills WHERE status='approved' AND deleted_at IS NULL AND canonical_name ILIKE $1 ORDER BY canonical_name LIMIT 5",
              [`%${name.replace(/[%_\\]/g, '\\$&')}%`],
            );
            unresolved.push({ input: name, candidates });
          }
        }
        skillIds = [...new Set(skillIds)];
      }
      if (input.existing_skills_none && input.existing_skills?.length)
        fail(
          422,
          'VALIDATION_FAILED',
          'None cannot be combined with existing skills',
        );
      if (input.existing_skills_none) skillIds = [];
      const none =
        input.existing_skills_none ??
        (input.existing_skills?.length ? false : old.existing_skills_none);
      await db.query(
        `UPDATE public.user_profiles SET current_role_title=$2,education=$3,experience_level=$4,self_reported_skill_ids=$5,existing_skills_none=$6 WHERE user_id=$1`,
        [
          id,
          input.current_role ?? old.current_role_title,
          input.education ?? old.education,
          input.experience_level ?? old.experience_level,
          skillIds,
          none,
        ],
      );
      const progress = await this.initializeProgress(db, id);
      return this.view(db, id, progress, unresolved);
    });
  }
  async preferences(id: string, input: PreferencesPatch) {
    return this.database.transaction(id, async (db) => {
      await db.query(
        'UPDATE public.user_preferences SET learning_preference=$2 WHERE user_id=$1',
        [id, input.learning_preference],
      );
      return this.view(db, id);
    });
  }
  async learning(id: string, input: LearningPatch) {
    return this.database.transaction(id, async (db) => {
      await db.query(
        'UPDATE public.user_profiles SET timezone=COALESCE($2,timezone),preferred_daily_hours=COALESCE($3,preferred_daily_hours),timezone_detected=CASE WHEN $2::text IS NULL THEN timezone_detected ELSE false END WHERE user_id=$1',
        [id, input.timezone ?? null, input.preferred_daily_hours ?? null],
      );
      return this.view(db, id);
    });
  }
  async alias(id: string, input: AliasInput) {
    return this.database.transaction(id, async (db) => {
      const [skill] = await db.query(
        "SELECT id FROM public.skills WHERE id=$1 AND status='approved' AND deleted_at IS NULL",
        [input.skill_id],
      );
      if (!skill) fail(404, 'RESOURCE_NOT_FOUND', 'Skill not found');
      const [p] = await db.query(
        'SELECT self_reported_skill_ids FROM public.user_profiles WHERE user_id=$1 FOR UPDATE',
        [id],
      );
      const ids = [
        ...new Set<string>([...p.self_reported_skill_ids, input.skill_id]),
      ];
      if (ids.length > 100)
        fail(422, 'VALIDATION_FAILED', 'At most 100 skills');
      await db.query(
        `INSERT INTO public.user_skill_aliases(user_id,input_alias,alias_normalized,skill_id) VALUES($1,$2,lower($2),$3) ON CONFLICT(user_id,alias_normalized) DO UPDATE SET skill_id=excluded.skill_id,input_alias=excluded.input_alias`,
        [id, input.input, input.skill_id],
      );
      await db.query(
        'UPDATE public.user_profiles SET self_reported_skill_ids=$2,existing_skills_none=false WHERE user_id=$1',
        [id, ids],
      );
      return {
        input: input.input,
        skill_id: input.skill_id,
        scope: 'user',
        added_to_profile: true,
        progress_initialization: await this.initializeProgress(db, id),
      };
    });
  }
  async goal(db: EntityManager, id: string, goalId: string) {
    const [g] = await db.query(
      `SELECT g.*,r.name AS role_name,(SELECT id FROM public.roadmaps WHERE career_goal_id=g.id LIMIT 1) AS roadmap_id FROM public.career_goals g LEFT JOIN public.career_roles r ON r.id=g.proposed_role_id WHERE g.user_id=$1 AND g.id=$2`,
      [id, goalId],
    );
    if (!g) fail(404, 'RESOURCE_NOT_FOUND', 'Career goal not found');
    const alternatives = await db.query(
      'SELECT id AS canonical_role_id,name FROM public.career_roles WHERE id=ANY($1::uuid[])',
      [g.alternative_role_ids],
    );
    return {
      id: g.id,
      goal_text: g.goal_text,
      status: g.status,
      clarification_round: g.clarification_round,
      clarification_question: g.clarification_question,
      proposed_role: g.proposed_role_id
        ? { canonical_role_id: g.proposed_role_id, name: g.role_name }
        : null,
      alternative_roles: alternatives.map(
        (role: { canonical_role_id: string; name: string }) => ({
          canonical_role_id: role.canonical_role_id,
          name: role.name,
          // The role catalog has no authoritative goal-specific rationale.
          rationale: null,
        }),
      ),
      suggested_level: g.suggested_level,
      target_level: g.target_level,
      roadmap_id: g.roadmap_id,
      created_at: g.created_at,
    };
  }
  async readGoal(id: string, goalId: string) {
    return this.database.transaction(id, (db) => this.goal(db, id, goalId));
  }
  async confirm(id: string, goalId: string, input: ConfirmGoal) {
    return this.database.transaction(id, async (db) => {
      const [g] = await db.query(
        'SELECT * FROM public.career_goals WHERE id=$2 AND user_id=$1 FOR UPDATE',
        [id, goalId],
      );
      if (!g) fail(404, 'RESOURCE_NOT_FOUND', 'Career goal not found');
      if (g.status !== 'awaiting_confirmation')
        fail(409, 'INVALID_STATE_TRANSITION', 'Goal must await confirmation');
      if (
        g.proposed_role_id !== input.canonical_role_id &&
        !g.alternative_role_ids.includes(input.canonical_role_id)
      )
        fail(422, 'ROLE_MISMATCH', 'Choose a proposed role');
      const [count] = await db.query(
        "SELECT count(*)::int AS count FROM public.career_goals WHERE user_id=$1 AND status='confirmed'",
        [id],
      );
      if (count.count >= 3)
        fail(409, 'ROADMAP_LIMIT_REACHED', 'At most 3 active career goals');
      await db.query(
        "UPDATE public.career_goals SET confirmed_role_id=$2,target_level=$3,status='confirmed',confirmed_at=now() WHERE id=$1",
        [goalId, input.canonical_role_id, input.target_level],
      );
      await this.initializeProgress(db, id);
      return this.goal(db, id, goalId);
    });
  }
}
