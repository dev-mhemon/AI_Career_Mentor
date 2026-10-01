# Phase 1 Database Schema Documentation

## Overview

Phase 1 implements the database foundation for Authentication & Access Control.
Two entities are created: **User** and **InvitationCode**.

Reference: SAD v1.1 §6, §9

---

## Entities

### User (`users`)

Stores identity, Supabase Auth reference, role, and account status.

| Column       | Type                       | Nullable | Default          | Constraints                  |
| ------------ | -------------------------- | -------- | ---------------- | ---------------------------- |
| id           | uuid                       | NO       | uuid_generate_v4 | PRIMARY KEY                  |
| supabase_uid | varchar(255)               | NO       |                  | UNIQUE                       |
| email        | varchar(255)               | YES      |                  | UNIQUE (nullable)            |
| phone        | varchar(50)                | YES      |                  | UNIQUE (nullable)            |
| role         | enum (USER, ADMIN)         | NO       | USER             |                              |
| status       | enum (PENDING_INVITE, ACTIVE, SUSPENDED) | NO | PENDING_INVITE |                    |
| created_at   | timestamptz                | NO       | now()            |                              |
| updated_at   | timestamptz                | NO       | now()            |                              |

**Indexes:**
- `PK` on `id`
- `IDX_users_email` — UNIQUE on `email`
- `IDX_users_phone` — UNIQUE on `phone`
- `UQ` on `supabase_uid`

**Referenced by:**
- `invitation_codes.creator_id` → `users.id` (ON DELETE CASCADE)

---

### InvitationCode (`invitation_codes`)

Gates account activation for the private platform. Admins create codes
with usage limits and optional expiration.

| Column          | Type                                  | Nullable | Default | Constraints         |
| --------------- | ------------------------------------- | -------- | ------- | ------------------- |
| id              | uuid                                  | NO       | uuid_generate_v4 | PRIMARY KEY |
| code            | varchar(100)                          | NO       |         | UNIQUE              |
| creator_id      | uuid                                  | YES      |         | FK → users.id (nullable for seeded codes) |
| usage_limit     | integer                               | NO       |         |                     |
| used_count      | integer                               | NO       | 0       |                     |
| expiration_date | timestamptz                           | YES      |         |                     |
| status          | enum (ACTIVE, EXHAUSTED, EXPIRED, REVOKED) | NO  | ACTIVE  |                     |
| created_at      | timestamptz                           | NO       | now()   |                     |

**Indexes:**
- `PK` on `id`
- `IDX_invitation_codes_code` — UNIQUE on `code`

**Foreign Keys:**
- `creator_id` → `users.id` (ON DELETE SET NULL, nullable)

---

## PostgreSQL Enum Types

| Type Name                      | Values                                     |
| ------------------------------ | ------------------------------------------ |
| `users_role_enum`              | USER, ADMIN                                |
| `users_status_enum`            | PENDING_INVITE, ACTIVE, SUSPENDED          |
| `invitation_codes_status_enum` | ACTIVE, EXHAUSTED, EXPIRED, REVOKED        |

---

## Entity Relationship Diagram

```
┌──────────────────────┐        ┌──────────────────────────┐
│       users          │        │    invitation_codes      │
├──────────────────────┤        ├──────────────────────────┤
│ id          UUID PK  │◄──?────│ creator_id    UUID FK?   │
│ supabase_uid VARCHAR │        │ id            UUID PK    │
│ email       VARCHAR? │        │ code          VARCHAR    │
│ phone       VARCHAR? │        │ usage_limit   INT        │
│ role        ENUM     │        │ used_count    INT        │
│ status      ENUM     │        │ expiration_date TSTZ?    │
│ created_at  TSTZ     │        │ status        ENUM       │
│ updated_at  TSTZ     │        │ created_at    TSTZ       │
└──────────────────────┘        └──────────────────────────┘
          1                  :                 N
```

---

## Migration

| Migration Name                                        | Timestamp     |
| ----------------------------------------------------- | ------------- |
| Phase1CreateUsersAndInvitationCodes1790852026539       | 1790852026539 |
| MakeInvitationCodeCreatorIdNullable1790852794320       | 1790852794320 |

Located at: `backend/src/migrations/`

---

## Design Decisions

1. **Supabase UID as separate field**: Authentication is delegated to Supabase Auth (SAD v1.1 §9). The `supabase_uid` links the local user record to the Supabase account. The `id` (UUID) is the internal primary key used for all foreign key relationships within the application.

2. **Nullable email/phone**: Both email-only and phone-only registration are supported (SAD v1.1 §9 lists email/password, phone/password, Google, Facebook as auth methods). At least one must be provided at the application level (enforced in business logic, not database).

3. **PostgreSQL native enums**: Used for `role`, `status`, and `invitation_codes.status` for type safety and storage efficiency. Values match exactly what SAD v1.1 specifies.

4. **Nullable `creator_id` with SET NULL**: Per Plan v1.2 §3, `creator_id` is nullable to support seeded invitation codes created before any admin user exists (Admin UI is deferred to Phase 6). ON DELETE SET NULL preserves codes if the creator is later removed.

5. **`used_count` default 0**: New codes start with zero usage. Business logic increments this and transitions status to EXHAUSTED when `used_count >= usage_limit`.

6. **`timestamptz` for all timestamps**: Ensures timezone-aware storage, critical for `expiration_date` comparisons and audit trails.

