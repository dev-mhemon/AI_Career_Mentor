-- supabase/migrations/026_seed_ai_prompts_and_synthetic_model.sql
BEGIN;

INSERT INTO public.prompt_versions (
  task,
  name,
  version,
  template_ref,
  template_hash,
  output_schema_id,
  is_active
) VALUES
  (
    'goal_interpretation'::public.ai_task,
    'prompts/goal-interpretation.v1',
    1,
    'prompts/goal-interpretation.v1',
    '301fbf868fa3e8b594179d07aa380a2315e838c1c4c4c4f1861e749ea8b7b1bd',
    'goal_interpretation.v1',
    true
  ),
  (
    'roadmap_generate'::public.ai_task,
    'prompts/roadmap-generate.v1',
    1,
    'prompts/roadmap-generate.v1',
    '31ea42c7c2a9629cad62f9646f3627c24c80b97c618a9741c860cb7a01eda660',
    'roadmap.v1',
    true
  ),
  (
    'roadmap_revision'::public.ai_task,
    'prompts/roadmap-revision.v1',
    1,
    'prompts/roadmap-revision.v1',
    'b149133d1bba77c74e5c30a61109feb5c0ec7a70ff6b9113160cd78eab033d21',
    'roadmap.v1',
    true
  ),
  (
    'merge_proposal'::public.ai_task,
    'prompts/merge-proposal.v1',
    1,
    'prompts/merge-proposal.v1',
    '410bf8609aee4a10c6140aa5aa553b70dd61302dc3fe1ffe25d6df8cf06e90d5',
    'merge_proposal.v1',
    true
  ),
  (
    'topic_content'::public.ai_task,
    'prompts/topic-content.v1',
    1,
    'prompts/topic-content.v1',
    'c8c140ad8e2a7417bd7f98dba35dacab7dcee2a4969bbc9540038d567217a846',
    'topic_content.v1',
    true
  ),
  (
    'quiz_generate'::public.ai_task,
    'prompts/quiz-generate.v1',
    1,
    'prompts/quiz-generate.v1',
    '2f36e0a4e3eae41b81e43dafa8a86e956471078ac8d3942a77477f4364023407',
    'quiz_generate.v1',
    true
  ),
  (
    'practice_review'::public.ai_task,
    'prompts/practice-review.v1',
    1,
    'prompts/practice-review.v1',
    '3c89273c31d543c9c868f8b73678483c6335907b36d638575294f9ac9fd1884f',
    'practice_review.v1',
    true
  ),
  (
    'mentor_chat'::public.ai_task,
    'prompts/mentor-chat.v1',
    1,
    'prompts/mentor-chat.v1',
    'e1367bb922d9034a9045c4c449725cd1c2877e75c9f991d4d486b860d1a31d83',
    'mentor_chat.v1',
    true
  ),
  (
    'technology_update'::public.ai_task,
    'prompts/technology-update.v1',
    1,
    'prompts/technology-update.v1',
    '29df8903b9b72c7fc82a9d2b7fb603aedfe65b76a40bba8440c0f814e148fd39',
    'technology_update.v1',
    true
  )
ON CONFLICT (task, name, version) DO UPDATE SET
  is_active = true;

-- Synthetic-only offline model row: real_user_data_approved=false guarantees ModelRouterService
-- NEVER selects this row when AI_EXECUTION_MODE=real_user (defense-in-depth with AiModule).
INSERT INTO public.ai_models (
  provider_key,
  model_identifier,
  display_name,
  input_price_per_m_units,
  output_price_per_m_units,
  approved_tasks,
  real_user_data_approved,
  fallback_rank,
  is_active
) VALUES (
  'synthetic',
  'synthetic-offline-v1',
  'Synthetic Offline Model (v1)',
  0,
  0,
  ARRAY[
    'goal_interpretation',
    'roadmap_generate',
    'roadmap_revision',
    'merge_proposal',
    'topic_content',
    'quiz_generate',
    'practice_review',
    'mentor_chat',
    'technology_update'
  ]::public.ai_task[],
  false,
  1,
  true
)
ON CONFLICT (provider_key, model_identifier) DO UPDATE SET
  is_active = true,
  updated_at = now();

COMMIT;
