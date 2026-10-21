BEGIN;
-- 013_constraints.sql
ALTER TABLE public.users
  ADD CONSTRAINT fk_users_suspended_by FOREIGN KEY (suspended_by) REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.roadmaps
  ADD CONSTRAINT fk_roadmaps_current_version FOREIGN KEY (current_version_id)
  REFERENCES public.roadmap_versions (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.roadmap_versions
  ADD CONSTRAINT fk_roadmap_versions_base   FOREIGN KEY (base_version_id)  REFERENCES public.roadmap_versions (id),
  ADD CONSTRAINT fk_roadmap_versions_merge  FOREIGN KEY (merge_id)         REFERENCES public.roadmap_merges (id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT fk_roadmap_versions_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.roadmap_items
  ADD CONSTRAINT fk_roadmap_items_topic FOREIGN KEY (topic_id) REFERENCES public.topics (id);

ALTER TABLE public.roadmap_merges
  ADD CONSTRAINT fk_roadmap_merges_base   FOREIGN KEY (base_version_id)   REFERENCES public.roadmap_versions (id),
  ADD CONSTRAINT fk_roadmap_merges_result FOREIGN KEY (result_version_id) REFERENCES public.roadmap_versions (id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT fk_roadmap_merges_ai_gen FOREIGN KEY (ai_generation_id)  REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.roadmap_merge_items
  ADD CONSTRAINT fk_roadmap_merge_items_topic FOREIGN KEY (topic_id) REFERENCES public.topics (id);

ALTER TABLE public.daily_plans
  ADD CONSTRAINT fk_daily_plans_version FOREIGN KEY (roadmap_version_id) REFERENCES public.roadmap_versions (id);

ALTER TABLE public.daily_plan_items
  ADD CONSTRAINT fk_daily_plan_items_merge FOREIGN KEY (reconciled_by_merge_id) REFERENCES public.roadmap_merges (id) ON DELETE SET NULL;

ALTER TABLE public.topics
  ADD CONSTRAINT fk_topics_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.quizzes
  ADD CONSTRAINT fk_quizzes_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.practice_reviews
  ADD CONSTRAINT fk_practice_reviews_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.messages
  ADD CONSTRAINT fk_messages_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.conversation_summaries
  ADD CONSTRAINT fk_conversation_summaries_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

COMMIT;
