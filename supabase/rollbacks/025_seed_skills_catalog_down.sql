-- supabase/rollbacks/025_seed_skills_catalog_down.sql
BEGIN;

-- Delete strictly the exact skill_aliases and unreferenced skills inserted by
-- migration 025, as recorded in private.seed_025_skills_ownership.
DO $$
BEGIN
  IF to_regclass('private.seed_025_skills_ownership') IS NOT NULL THEN
    DELETE FROM public.skill_aliases sa
    USING private.seed_025_skills_ownership own
    WHERE own.entity_type = 'skill_alias'
      AND sa.id = own.entity_id;

    DELETE FROM public.skills s
    USING private.seed_025_skills_ownership own
    WHERE own.entity_type = 'skill'
      AND s.id = own.entity_id
      AND NOT EXISTS (SELECT 1 FROM public.skill_aliases sa WHERE sa.skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.skill_dependencies sd WHERE sd.skill_id = s.id OR sd.depends_on_skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.user_skill_aliases usa WHERE usa.skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.roadmap_items ri WHERE ri.skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.topics t WHERE t.skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.learning_evidence le WHERE le.skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.skill_progress sp WHERE sp.skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.achievement_history ah WHERE ah.skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.technologies tech WHERE tech.skill_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE s.id = ANY(up.self_reported_skill_ids));
  END IF;
END $$;

DROP TABLE IF EXISTS private.seed_025_skills_ownership;

COMMIT;
