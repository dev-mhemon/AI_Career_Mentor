BEGIN;
-- 014_indexes.sql

-- Authentication
CREATE INDEX idx_users_status_created ON public.users (status, created_at DESC);
CREATE INDEX idx_users_last_active ON public.users (last_active_at) WHERE status = 'active';

-- Career
CREATE INDEX idx_career_roles_name_trgm ON public.career_roles USING gin (name extensions.gin_trgm_ops);
CREATE INDEX idx_skill_categories_parent ON public.skill_categories (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_skills_category ON public.skills (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_skills_name_trgm ON public.skills USING gin (canonical_name extensions.gin_trgm_ops);
CREATE INDEX idx_skill_aliases_norm_trgm ON public.skill_aliases USING gin (alias_normalized extensions.gin_trgm_ops);
CREATE INDEX idx_skill_dependencies_dep ON public.skill_dependencies (depends_on_skill_id);
CREATE INDEX idx_career_goals_user_status ON public.career_goals (user_id, status, created_at DESC);
CREATE INDEX idx_career_goals_proposed_role ON public.career_goals (proposed_role_id) WHERE proposed_role_id IS NOT NULL;
CREATE INDEX idx_career_goals_confirmed_role ON public.career_goals (confirmed_role_id) WHERE confirmed_role_id IS NOT NULL;

-- Roadmap
CREATE INDEX idx_roadmaps_user_status ON public.roadmaps (user_id, status);
CREATE INDEX idx_roadmaps_role ON public.roadmaps (canonical_role_id);
CREATE INDEX idx_roadmaps_current_version ON public.roadmaps (current_version_id) WHERE current_version_id IS NOT NULL;
CREATE INDEX idx_roadmap_versions_user ON public.roadmap_versions (user_id);
CREATE INDEX idx_roadmap_versions_merge ON public.roadmap_versions (merge_id) WHERE merge_id IS NOT NULL;
CREATE INDEX idx_roadmap_versions_base ON public.roadmap_versions (base_version_id) WHERE base_version_id IS NOT NULL;
CREATE INDEX idx_roadmap_items_user ON public.roadmap_items (user_id);
CREATE INDEX idx_roadmap_items_skill ON public.roadmap_items (skill_id);
CREATE INDEX idx_roadmap_items_topic ON public.roadmap_items (topic_id);
CREATE INDEX idx_roadmap_items_lineage ON public.roadmap_items (lineage_id);
CREATE INDEX idx_roadmap_merges_roadmap_status ON public.roadmap_merges (roadmap_id, status, created_at DESC);
CREATE INDEX idx_roadmap_merges_user ON public.roadmap_merges (user_id);
CREATE INDEX idx_roadmap_merges_base_version ON public.roadmap_merges (base_version_id);
CREATE INDEX idx_roadmap_merges_result_version ON public.roadmap_merges (result_version_id) WHERE result_version_id IS NOT NULL;
CREATE INDEX idx_roadmap_merge_items_user ON public.roadmap_merge_items (user_id);
CREATE INDEX idx_roadmap_merge_items_topic ON public.roadmap_merge_items (topic_id) WHERE topic_id IS NOT NULL;

-- Learning
CREATE INDEX idx_topics_skill_level_status ON public.topics (skill_id, career_level, status);
CREATE INDEX idx_learning_resources_topic ON public.learning_resources (topic_id);
CREATE INDEX idx_daily_plans_user ON public.daily_plans (user_id);
CREATE INDEX idx_daily_plans_version ON public.daily_plans (roadmap_version_id) WHERE roadmap_version_id IS NOT NULL;
CREATE INDEX idx_daily_plan_items_open ON public.daily_plan_items (plan_id, day_no, sort_order) WHERE status <> 'completed';
CREATE INDEX idx_daily_plan_items_user ON public.daily_plan_items (user_id);
CREATE INDEX idx_daily_plan_items_topic ON public.daily_plan_items (topic_id);
CREATE INDEX idx_daily_plan_items_merge ON public.daily_plan_items (reconciled_by_merge_id) WHERE reconciled_by_merge_id IS NOT NULL;
CREATE INDEX idx_quizzes_topic_status ON public.quizzes (topic_id, status);
CREATE INDEX idx_quiz_attempts_user_status ON public.quiz_attempts (user_id, status);
CREATE INDEX idx_quiz_attempts_user_submitted ON public.quiz_attempts (user_id, submitted_at DESC) WHERE submitted_at IS NOT NULL;
CREATE INDEX idx_quiz_attempts_quiz ON public.quiz_attempts (quiz_id);
CREATE INDEX idx_quiz_attempts_retry_of ON public.quiz_attempts (retry_of_attempt_id) WHERE retry_of_attempt_id IS NOT NULL;
CREATE INDEX idx_quiz_answers_user ON public.quiz_answers (user_id);
CREATE INDEX idx_quiz_answers_question ON public.quiz_answers (question_id);
CREATE INDEX idx_quiz_answers_raw_expiry ON public.quiz_answers (raw_text_expires_at) WHERE answer_text IS NOT NULL;
CREATE INDEX idx_practice_reviews_attempt ON public.practice_reviews (attempt_id);
CREATE INDEX idx_practice_reviews_user ON public.practice_reviews (user_id);
CREATE INDEX idx_practice_reviews_question ON public.practice_reviews (question_id);
CREATE INDEX idx_practice_reviews_open ON public.practice_reviews (review_status, created_at) WHERE review_status IN ('pending','failed');

-- Progress
CREATE INDEX idx_learning_evidence_user_skill_level ON public.learning_evidence (user_id, skill_id, career_level, occurred_at DESC);
CREATE INDEX idx_learning_evidence_skill ON public.learning_evidence (skill_id);
CREATE INDEX idx_learning_evidence_topic ON public.learning_evidence (topic_id);
CREATE INDEX idx_learning_evidence_roadmap ON public.learning_evidence (roadmap_id) WHERE roadmap_id IS NOT NULL;
CREATE INDEX idx_skill_progress_user_state ON public.skill_progress (user_id, learning_state);
CREATE INDEX idx_skill_progress_skill ON public.skill_progress (skill_id);
CREATE INDEX idx_achievement_history_user_time ON public.achievement_history (user_id, occurred_at DESC);
CREATE INDEX idx_achievement_history_user_skill_time ON public.achievement_history (user_id, skill_id, occurred_at DESC);
CREATE INDEX idx_achievement_history_skill ON public.achievement_history (skill_id);

-- AI conversations
CREATE INDEX idx_conversations_user_last ON public.conversations (user_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_conversations_roadmap ON public.conversations (roadmap_id) WHERE roadmap_id IS NOT NULL;
CREATE INDEX idx_conversations_topic ON public.conversations (topic_id) WHERE topic_id IS NOT NULL;
CREATE INDEX idx_messages_conversation_created ON public.messages (conversation_id, created_at);
CREATE INDEX idx_messages_expires ON public.messages (expires_at);
CREATE INDEX idx_messages_user ON public.messages (user_id);
CREATE INDEX idx_messages_reply_to ON public.messages (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX idx_conversation_summaries_user ON public.conversation_summaries (user_id);
CREATE INDEX idx_ai_context_records_valid_until ON public.ai_context_records (valid_until);

-- AI analytics
CREATE INDEX idx_ai_models_routing ON public.ai_models (fallback_rank) WHERE is_active AND real_user_data_approved;
CREATE INDEX idx_ai_requests_user_status ON public.ai_requests (user_id, status);
CREATE INDEX idx_ai_requests_queue ON public.ai_requests (available_at) WHERE status = 'queued';
CREATE INDEX idx_ai_requests_created ON public.ai_requests (created_at);
CREATE INDEX idx_ai_requests_feature_created ON public.ai_requests (feature_key, created_at) WHERE feature_key IS NOT NULL;
CREATE INDEX idx_ai_requests_finished ON public.ai_requests (finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX idx_ai_requests_model ON public.ai_requests (model_id) WHERE model_id IS NOT NULL;
CREATE INDEX idx_ai_requests_prompt ON public.ai_requests (prompt_version_id) WHERE prompt_version_id IS NOT NULL;
CREATE INDEX idx_ai_requests_subject ON public.ai_requests (subject_type, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX idx_ai_generations_task_created ON public.ai_generations (task, created_at);
CREATE INDEX idx_ai_generations_model ON public.ai_generations (model_id) WHERE model_id IS NOT NULL;
CREATE INDEX idx_ai_generations_prompt ON public.ai_generations (prompt_version_id) WHERE prompt_version_id IS NOT NULL;
CREATE INDEX idx_ai_generations_request ON public.ai_generations (request_id) WHERE request_id IS NOT NULL;

-- Technology
CREATE INDEX idx_technologies_category ON public.technologies (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_technologies_skill ON public.technologies (skill_id) WHERE skill_id IS NOT NULL;
CREATE INDEX idx_technology_updates_fetched ON public.technology_updates (fetched_at DESC);
CREATE INDEX idx_technology_updates_technology ON public.technology_updates (technology_id) WHERE technology_id IS NOT NULL;
CREATE INDEX idx_technology_updates_source ON public.technology_updates (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_user_update_relevance_user_computed ON public.user_update_relevance (user_id, computed_at DESC);
CREATE INDEX idx_user_update_relevance_update ON public.user_update_relevance (update_id);
CREATE INDEX idx_user_update_relevance_roadmap ON public.user_update_relevance (focus_roadmap_id) WHERE focus_roadmap_id IS NOT NULL;
CREATE INDEX idx_update_delivery_update ON public.update_delivery_history (update_id) WHERE update_id IS NOT NULL;

-- Administration
CREATE INDEX idx_user_access_overrides_feature ON public.user_access_overrides (feature_key, enabled);
CREATE INDEX idx_admin_audit_logs_actor_time ON public.admin_audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_target_time ON public.admin_audit_logs (target_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_action_time ON public.admin_audit_logs (action, created_at DESC);

-- R02: generation FK leading indexes, before 019.
CREATE INDEX idx_roadmap_versions_ai_generation ON public.roadmap_versions (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_roadmap_merges_ai_generation ON public.roadmap_merges (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_topics_ai_generation ON public.topics (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_quizzes_ai_generation ON public.quizzes (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_practice_reviews_ai_generation ON public.practice_reviews (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_messages_ai_generation ON public.messages (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_conversation_summaries_ai_generation ON public.conversation_summaries (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_technology_updates_ai_generation ON public.technology_updates (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
COMMIT;
