-- supabase/migrations/027_seed_gemini_real_user_models.sql
BEGIN;

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
) VALUES
  (
    'google',
    'gemini-3.8-flash',
    'Google Gemini 3.8 Flash',
    0.750000,
    3.750000,
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
    true,
    1,
    true
  ),
  (
    'google',
    'gemini-3.5-flash-lite',
    'Google Gemini 3.5 Flash-Lite',
    0.300000,
    2.500000,
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
    true,
    2,
    true
  ),
  (
    'google',
    'gemini-3.1-flash-lite',
    'Google Gemini 3.1 Flash-Lite',
    0.250000,
    1.500000,
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
    true,
    3,
    true
  )
ON CONFLICT (provider_key, model_identifier) DO UPDATE SET
  input_price_per_m_units = EXCLUDED.input_price_per_m_units,
  output_price_per_m_units = EXCLUDED.output_price_per_m_units,
  approved_tasks = EXCLUDED.approved_tasks,
  real_user_data_approved = true,
  fallback_rank = EXCLUDED.fallback_rank,
  is_active = true,
  updated_at = now();

COMMIT;
