BEGIN;
-- 018_seed.sql
INSERT INTO public.feature_controls (feature_key, enabled, default_user_enabled) VALUES
  ('roadmap_generator',  true, true),
  ('daily_plan',         true, true),
  ('quiz_practice',      true, true),
  ('ai_practice_review', true, true),
  ('progress_tracking',  true, true),
  ('ai_mentor',          true, true),
  ('technology_update',  true, false)
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO public.system_configurations (config_key, config_value, description) VALUES
  ('roadmap.max_active',                   '3'::jsonb,  'PRD §16: maximum non-archived roadmaps per user'),
  ('career_goal.max_clarification_rounds', '2'::jsonb,  'PRD §15'),
  ('quiz.retry_limit',                     '1'::jsonb,  'PRD §32: one retry per topic quiz'),
  ('quiz.standard_mcq_count',              '20'::jsonb, 'PRD §29'),
  ('quiz.standard_free_response_min',      '5'::jsonb,  'PRD §29'),
  ('quiz.standard_free_response_max',      '10'::jsonb, 'PRD §29'),
  ('retention.raw_response_days',          '90'::jsonb, 'PRD §52: raw short free-response text'),
  ('retention.mentor_message_days',        '90'::jsonb, 'PRD §52: full mentor messages'),
  ('retention.ai_operational_log_days',    '30'::jsonb, 'PRD §52: AI / operational logs (maximum)'),
  ('career_knowledge.review_days',         '90'::jsonb, 'PRD §23: default review target'),
  ('technology_update.active_window_days', '7'::jsonb,  'PRD §39: eligibility activity window')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO public.career_roles (slug, name, description) VALUES
  ('frontend-development',          'Frontend Development',              'Builds user-facing web interfaces'),
  ('backend-development',           'Backend Development',               'Builds server-side services and APIs'),
  ('full-stack-development',        'Full-Stack Development',            'Builds both frontend and backend'),
  ('qa-software-testing',           'QA / Software Testing',             'Designs and runs software tests'),
  ('qa-automation-sdet',            'QA Automation / SDET',              'Builds automated test systems'),
  ('devops',                        'DevOps',                            'Automates delivery and operations'),
  ('site-reliability-engineering',  'Site Reliability Engineering',      'Operates reliable production systems'),
  ('cloud-engineering',             'Cloud Engineering',                 'Designs and operates cloud infrastructure'),
  ('cybersecurity',                 'Cybersecurity',                     'Secures software and systems'),
  ('mobile-development',            'Mobile Development',                'Builds mobile applications'),
  ('data-engineering',              'Data Engineering',                  'Builds data pipelines and platforms'),
  ('ai-ml-engineering',             'AI / Machine Learning Engineering', 'Builds machine learning systems'),
  ('ai-application-llm-engineering','AI Application / LLM Engineering',  'Builds applications on language models')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.skill_categories (slug, name) VALUES
  ('software-engineering-fundamentals','Software Engineering Fundamentals'),
  ('programming-languages','Programming Languages'),
  ('web-development','Web Development'),
  ('databases','Databases'),
  ('cloud-infrastructure','Cloud and Infrastructure'),
  ('devops-tooling','DevOps Tooling'),
  ('testing-quality','Testing and Quality'),
  ('security','Security'),
  ('mobile-development','Mobile Development'),
  ('data-engineering','Data Engineering'),
  ('ai-machine-learning','AI and Machine Learning')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.technology_categories (slug, name) VALUES
  ('languages-runtimes','Languages and Runtimes'),
  ('frameworks-libraries','Frameworks and Libraries'),
  ('databases-storage','Databases and Storage'),
  ('cloud-platforms','Cloud Platforms'),
  ('devops-tooling','DevOps Tooling'),
  ('security-tooling','Security Tooling'),
  ('ai-ml-platforms','AI and ML Platforms')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
