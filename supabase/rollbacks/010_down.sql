BEGIN;
DROP TABLE IF EXISTS public.ai_generations, public.ai_requests,
  public.prompt_versions, public.ai_models;
COMMIT;
