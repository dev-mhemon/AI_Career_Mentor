-- supabase/rollbacks/026_seed_ai_prompts_and_synthetic_model_down.sql
BEGIN;

-- Preserve ai_generations / ai_requests FK history: deactivate referenced rows, delete only unreferenced rows.
UPDATE public.ai_models m
SET is_active = false
WHERE m.provider_key = 'synthetic'
  AND m.model_identifier = 'synthetic-offline-v1'
  AND (
    EXISTS (SELECT 1 FROM public.ai_generations g WHERE g.model_id = m.id)
    OR EXISTS (SELECT 1 FROM public.ai_requests r WHERE r.model_id = m.id)
  );

DELETE FROM public.ai_models m
WHERE m.provider_key = 'synthetic'
  AND m.model_identifier = 'synthetic-offline-v1'
  AND NOT EXISTS (SELECT 1 FROM public.ai_generations g WHERE g.model_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM public.ai_requests r WHERE r.model_id = m.id);

UPDATE public.prompt_versions pv
SET is_active = false
WHERE pv.version = 1
  AND (pv.task, pv.name) IN (
    ('goal_interpretation'::public.ai_task, 'prompts/goal-interpretation.v1'),
    ('roadmap_generate'::public.ai_task,    'prompts/roadmap-generate.v1'),
    ('roadmap_revision'::public.ai_task,    'prompts/roadmap-revision.v1'),
    ('merge_proposal'::public.ai_task,      'prompts/merge-proposal.v1'),
    ('topic_content'::public.ai_task,       'prompts/topic-content.v1'),
    ('quiz_generate'::public.ai_task,       'prompts/quiz-generate.v1'),
    ('practice_review'::public.ai_task,     'prompts/practice-review.v1'),
    ('mentor_chat'::public.ai_task,         'prompts/mentor-chat.v1'),
    ('technology_update'::public.ai_task,   'prompts/technology-update.v1')
  )
  AND (
    EXISTS (SELECT 1 FROM public.ai_generations g WHERE g.prompt_version_id = pv.id)
    OR EXISTS (SELECT 1 FROM public.ai_requests r WHERE r.prompt_version_id = pv.id)
  );

DELETE FROM public.prompt_versions pv
WHERE pv.version = 1
  AND (pv.task, pv.name) IN (
    ('goal_interpretation'::public.ai_task, 'prompts/goal-interpretation.v1'),
    ('roadmap_generate'::public.ai_task,    'prompts/roadmap-generate.v1'),
    ('roadmap_revision'::public.ai_task,    'prompts/roadmap-revision.v1'),
    ('merge_proposal'::public.ai_task,      'prompts/merge-proposal.v1'),
    ('topic_content'::public.ai_task,       'prompts/topic-content.v1'),
    ('quiz_generate'::public.ai_task,       'prompts/quiz-generate.v1'),
    ('practice_review'::public.ai_task,     'prompts/practice-review.v1'),
    ('mentor_chat'::public.ai_task,         'prompts/mentor-chat.v1'),
    ('technology_update'::public.ai_task,   'prompts/technology-update.v1')
  )
  AND NOT EXISTS (SELECT 1 FROM public.ai_generations g WHERE g.prompt_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM public.ai_requests r WHERE r.prompt_version_id = pv.id);

COMMIT;
