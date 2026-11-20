-- supabase/rollbacks/027_seed_gemini_real_user_models_down.sql
BEGIN;

-- Preserve ai_generations / ai_requests FK history: deactivate referenced rows, delete only unreferenced rows.
UPDATE public.ai_models m
SET is_active = false
WHERE m.provider_key = 'google'
  AND m.model_identifier IN (
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite'
  )
  AND (
    EXISTS (SELECT 1 FROM public.ai_generations g WHERE g.model_id = m.id)
    OR EXISTS (SELECT 1 FROM public.ai_requests r WHERE r.model_id = m.id)
  );

DELETE FROM public.ai_models m
WHERE m.provider_key = 'google'
  AND m.model_identifier IN (
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite'
  )
  AND NOT EXISTS (SELECT 1 FROM public.ai_generations g WHERE g.model_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM public.ai_requests r WHERE r.model_id = m.id);

COMMIT;
