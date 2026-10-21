-- supabase/tests/database/005_ai_usage.test.sql
BEGIN;
SELECT plan(10);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('eeeeeeee-0000-0000-0000-000000000001', 'ai_tester@test.local');

INSERT INTO public.ai_models (id, provider_key, model_identifier, display_name, input_price_per_m_units, output_price_per_m_units)
  VALUES ('eeeeeeee-0000-0000-0000-0000000000a1', 'anthropic', 'claude-3-sonnet', 'Claude Sonnet', 2.50, 10.00);

INSERT INTO public.ai_requests (id, user_id, task, model_id, input_units, output_units, idempotency_key)
  VALUES ('eeeeeeee-0000-0000-0000-0000000000b1', 'eeeeeeee-0000-0000-0000-000000000001', 'mentor_chat',
          'eeeeeeee-0000-0000-0000-0000000000a1', 2000000, 500000, 'idem_key_001');

SELECT is((SELECT total_units FROM public.ai_requests WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
          2500000::bigint, 'total_units correctly computed by calculate_total_tokens trigger');

SELECT is((SELECT cost_usd FROM public.ai_requests WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
          10.00000000::numeric, 'cost_usd correctly derived from model prices by calculate_ai_cost trigger');

SELECT throws_ok(
  $$INSERT INTO public.ai_requests (user_id, task, idempotency_key)
    VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'mentor_chat', 'idem_key_001')$$,
  '23505', NULL, 'Duplicate idempotency key for same user is rejected');

SELECT lives_ok(
  $$UPDATE public.ai_requests SET status = 'preparing' WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'$$,
  'Transition queued -> preparing succeeds');

SELECT ok((SELECT started_at IS NOT NULL AND attempt_count = 1 FROM public.ai_requests WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
  'preparing state automatically sets started_at timestamp and increments attempt_count');

SELECT lives_ok(
  $$UPDATE public.ai_requests SET status = 'succeeded' WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'$$,
  'Transition preparing -> succeeded succeeds');

SELECT ok((SELECT finished_at IS NOT NULL AND locked_at IS NULL FROM public.ai_requests WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
  'succeeded state sets finished_at and clears lock');

SELECT throws_ok(
  $$UPDATE public.ai_requests SET status = 'queued' WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'$$,
  '23514', NULL, 'Terminal state succeeded cannot transition back to queued');

SELECT throws_ok(
  $$INSERT INTO public.ai_requests (user_id, task, status, finished_at)
    VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'roadmap_generate', 'failed', now())$$,
  '23514', NULL, 'Failed AI request without error_code is rejected');

INSERT INTO public.ai_requests (id, user_id, task, status, retryable, error_code, finished_at)
  VALUES ('eeeeeeee-0000-0000-0000-0000000000b2', 'eeeeeeee-0000-0000-0000-000000000001', 'quiz_generate', 'failed', true, 'UPSTREAM_503', now());

SELECT lives_ok(
  $$UPDATE public.ai_requests SET status = 'queued' WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b2'$$,
  'Retryable failed request can transition back to queued');

SELECT * FROM finish();
ROLLBACK;
