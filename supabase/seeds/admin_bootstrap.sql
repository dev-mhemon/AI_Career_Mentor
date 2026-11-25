-- ============================================================================
-- Dedicated Platform Administrator Bootstrap Seed (Idempotent)
-- ============================================================================
-- Provisions the standalone Platform Administrator account for M13 Admin
-- Operations (C01 §50, C05 §14.14, C06 012_administration.sql).
--
-- Default bootstrap credentials (local dev / UAT only):
--   Email:    admin@mentor.com
--   Password: set via `SET app.admin_bootstrap_password = '<STRONG_PASSWORD>'`
--             (falls back to local-only default `admin1234` ONLY when unset).
--
-- Run via Supabase SQL Editor or psql:
--   psql "$DATABASE_URL" -f supabase/seeds/admin_bootstrap.sql
--
-- Security notes:
--   - Zero hardcoded credentials exist in backend or frontend runtime code.
--   - Server-side AZ-ADMIN authorization checks public.admin_users
--     (role = 'platform_admin') AND public.users (status = 'active').
--   - Refuses to promote an existing non-admin public.users account and refuses
--     to create a duplicate admin@mentor.com account if a platform_admin already
--     exists (e.g., after email rotation).
--   - In staging/production, ALWAYS supply `app.admin_bootstrap_password` before
--     running or rotate immediately using the SQL procedures below.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_admin_email      constant text := 'admin@mentor.com';
  v_initial_password text := COALESCE(
    NULLIF(current_setting('app.admin_bootstrap_password', true), ''),
    'admin1234'
  );
  v_admin_id         uuid;
  v_existing_admin   uuid;
BEGIN
  -- 1. Check if the bootstrap account already exists by email
  SELECT id
    INTO v_admin_id
    FROM auth.users
   WHERE lower(email) = lower(v_admin_email)
     AND deleted_at IS NULL
   LIMIT 1;

  -- If ANY auth.users row already holds this email without already being a
  -- platform_admin in public.admin_users (regardless of whether public.users
  -- exists yet), fail closed to prevent any pre-registration hijack path.
  IF v_admin_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.admin_users
        WHERE user_id = v_admin_id
          AND role = 'platform_admin'
     ) THEN
    RAISE EXCEPTION 'Refusing to promote existing non-admin auth.users account % to platform_admin', v_admin_email;
  END IF;

  -- If the bootstrap email is absent because an existing platform_admin rotated
  -- its email, preserve that rotated identity rather than creating a duplicate admin.
  IF v_admin_id IS NULL THEN
    SELECT user_id
      INTO v_existing_admin
      FROM public.admin_users
     WHERE role = 'platform_admin'
     LIMIT 1;

    IF v_existing_admin IS NOT NULL THEN
      RAISE NOTICE 'Platform administrator (%) already exists; skipping default bootstrap creation.', v_existing_admin;
      RETURN;
    END IF;
  END IF;

  IF v_admin_id IS NULL THEN
    v_admin_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      is_sso_user,
      is_anonymous
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      v_admin_email,
      extensions.crypt(v_initial_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Platform Admin"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    );
  ELSE
    UPDATE auth.users
       SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
             || '{"full_name":"Platform Admin"}'::jsonb,
           updated_at = now()
     WHERE id = v_admin_id;
  END IF;

  -- 2. Ensure matching email identity exists in auth.identities
  IF NOT EXISTS (
    SELECT 1
      FROM auth.identities
     WHERE user_id = v_admin_id
       AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      id,
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_admin_id::text,
      v_admin_id,
      jsonb_build_object(
        'sub', v_admin_id::text,
        'email', v_admin_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );
  END IF;

  -- 3. Ensure active, verified application account in public.users
  INSERT INTO public.users (
    id,
    email,
    status,
    verified_contact
  ) VALUES (
    v_admin_id,
    v_admin_email,
    'active',
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email            = EXCLUDED.email,
        status           = 'active',
        status_reason    = NULL,
        suspended_at     = NULL,
        suspended_by     = NULL,
        verified_contact = true,
        updated_at       = now();

  -- 4. Ensure verified email provider row in public.user_auth_providers
  --    (Required by EP-A05 password login and private.approve_auth_session)
  INSERT INTO public.user_auth_providers (
    user_id,
    provider,
    provider_subject,
    contact_value,
    verified_at,
    is_primary
  ) VALUES (
    v_admin_id,
    'email',
    v_admin_id::text,
    v_admin_email,
    now(),
    true
  )
  ON CONFLICT (user_id, provider) DO UPDATE
    SET contact_value = EXCLUDED.contact_value,
        verified_at   = COALESCE(public.user_auth_providers.verified_at, now()),
        is_primary    = true,
        updated_at    = now();

  -- 5. Grant server-side platform_admin privilege in public.admin_users
  INSERT INTO public.admin_users (
    user_id,
    role
  ) VALUES (
    v_admin_id,
    'platform_admin'
  )
  ON CONFLICT (user_id) DO UPDATE
    SET role = 'platform_admin';
END $$;

COMMIT;

-- ============================================================================
-- Manual Credential Rotation (SQL) — Run in Supabase SQL Editor when rotating
-- ============================================================================
-- Session Revocation Scope:
--   - Marking `private.approved_auth_sessions.revoked_at = now()` and deleting
--     `auth.sessions` + `auth.refresh_tokens` revokes ALL NestJS backend API
--     access immediately (enforced server-side by `AccessGuard` ->
--     `private.has_approved_session`) and blocks Supabase token refresh.
--   - Direct Supabase PostgREST/Storage RLS (`017_rls.sql`) evaluates stateless
--     JWT claims via `auth.uid()` / `private.is_admin()` without checking
--     `auth.sessions`, so a previously minted short-lived Supabase JWT remains
--     accepted by direct PostgREST/Storage until its `exp` unless the Supabase
--     JWT secret is rotated or session-checked RLS is applied.
--
-- A) Rotate Admin Password Only (revokes backend sessions & refresh tokens):
--
-- BEGIN;
-- DO $$
-- DECLARE
--   v_admin_email  constant text := 'admin@mentor.com';
--   v_new_password constant text := '<NEW_STRONG_PASSWORD>';
--   v_admin_id     uuid;
-- BEGIN
--   SELECT u.id
--     INTO v_admin_id
--     FROM auth.users u
--     JOIN public.admin_users au ON au.user_id = u.id
--    WHERE lower(u.email) = lower(v_admin_email)
--      AND u.deleted_at IS NULL
--    LIMIT 1;
--
--   IF v_admin_id IS NULL THEN
--     RAISE EXCEPTION 'Platform admin account not found for email: %', v_admin_email;
--   END IF;
--
--   UPDATE auth.users
--      SET encrypted_password = extensions.crypt(v_new_password, extensions.gen_salt('bf')),
--          recovery_token = '',
--          recovery_sent_at = NULL,
--          updated_at = now()
--    WHERE id = v_admin_id;
--
--   -- Invalidate pending recovery/one-time tokens, revoke approved backend
--   -- sessions immediately (AccessGuard), and purge Supabase auth sessions +
--   -- refresh tokens (see revocation scope note above).
--   DELETE FROM auth.one_time_tokens WHERE user_id = v_admin_id;
--   UPDATE private.approved_auth_sessions
--      SET revoked_at = now()
--    WHERE user_id = v_admin_id
--      AND revoked_at IS NULL;
--   DELETE FROM auth.refresh_tokens WHERE user_id = v_admin_id::text;
--   DELETE FROM auth.sessions WHERE user_id = v_admin_id;
-- END $$;
-- COMMIT;
--
-- B) Rotate Admin Email (and optionally Password) consistently across
--    auth.users, auth.identities, public.users, and public.user_auth_providers:
--
-- BEGIN;
-- DO $$
-- DECLARE
--   v_old_email    constant text := 'admin@mentor.com';
--   v_new_email    constant text := 'new-admin@mentor.com';
--   v_new_password constant text := NULL; -- set to '<NEW_STRONG_PASSWORD>' to rotate password too
--   v_admin_id     uuid;
-- BEGIN
--   SELECT u.id
--     INTO v_admin_id
--     FROM auth.users u
--     JOIN public.admin_users au ON au.user_id = u.id
--    WHERE lower(u.email) = lower(v_old_email)
--      AND u.deleted_at IS NULL
--    LIMIT 1;
--
--   IF v_admin_id IS NULL THEN
--     RAISE EXCEPTION 'Platform admin account not found for email: %', v_old_email;
--   END IF;
--
--   UPDATE auth.users
--      SET email = v_new_email,
--          encrypted_password = CASE
--            WHEN v_new_password IS NOT NULL
--              THEN extensions.crypt(v_new_password, extensions.gen_salt('bf'))
--            ELSE encrypted_password
--          END,
--          email_confirmed_at = now(),
--          recovery_token = '',
--          recovery_sent_at = NULL,
--          email_change = '',
--          email_change_token_new = '',
--          updated_at = now()
--    WHERE id = v_admin_id;
--
--   UPDATE auth.identities
--      SET identity_data = COALESCE(identity_data, '{}'::jsonb)
--            || jsonb_build_object('email', v_new_email, 'email_verified', true),
--          updated_at = now()
--    WHERE user_id = v_admin_id
--      AND provider = 'email';
--
--   UPDATE public.users
--      SET email = v_new_email,
--          updated_at = now()
--    WHERE id = v_admin_id;
--
--   UPDATE public.user_auth_providers
--      SET contact_value = v_new_email,
--          verified_at = COALESCE(verified_at, now()),
--          updated_at = now()
--    WHERE user_id = v_admin_id
--      AND provider = 'email';
--
--   -- Invalidate pending recovery/one-time tokens, revoke approved backend
--   -- sessions immediately (AccessGuard), and purge Supabase auth sessions +
--   -- refresh tokens (see revocation scope note above).
--   DELETE FROM auth.one_time_tokens WHERE user_id = v_admin_id;
--   UPDATE private.approved_auth_sessions
--      SET revoked_at = now()
--    WHERE user_id = v_admin_id
--      AND revoked_at IS NULL;
--   DELETE FROM auth.refresh_tokens WHERE user_id = v_admin_id::text;
--   DELETE FROM auth.sessions WHERE user_id = v_admin_id;
-- END $$;
-- COMMIT;
-- ============================================================================
