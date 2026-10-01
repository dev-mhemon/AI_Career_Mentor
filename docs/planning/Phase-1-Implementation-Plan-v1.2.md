# Phase 1 Implementation Plan v1.2

This document defines the implementation plan for **Phase 1 — Authentication & Access Control** of the AI Career Intelligence Mentor MVP. It has been updated to reflect the final architectural decisions regarding synchronization strategies and temporary MVP workflows.

---

## 1. Authentication Requirements

Supabase Auth is the designated Identity Provider. Responsibility boundaries are strictly defined to prevent duplication:

### Supabase Responsibility
*   Email/password authentication
*   Google OAuth login
*   Facebook OAuth login
*   Session management (Token issuance and rotation)
*   Phone authentication (If free/available within project constraints. Otherwise, falls back to the SAD decision: WhatsApp OTP or low-cost SMS provider).

### NestJS (Backend) Responsibility
*   JWT validation using Custom Guard
*   User synchronization (from Supabase to local PostgreSQL)
*   Role-based authorization (RBAC)
*   Invitation code verification and application logic
*   Application access rules

### Next.js (Frontend) Responsibility
*   Render authentication UI forms (Login, Registration, OTP, Social Buttons)
*   Integrate Supabase Client SDK for direct authentication flows
*   Handle client-side sessions and attach JWTs to backend API requests
*   Route protection based on authentication state

---

## 2. Authentication Flow

### User Synchronization Strategy (Frontend-Triggered)
*Decision: We avoid Supabase webhook-based sync for the MVP to keep architecture simple, easy to debug, and free of infrastructure webhook dependencies.*

User completes authentication in Supabase
↓
Frontend receives Supabase session/JWT
↓
Frontend calls: POST /api/auth/sync
↓
NestJS validates JWT
↓
Create/update local PostgreSQL User record
↓
Return application user information

### Email/password:
User
↓
Supabase Auth
↓
JWT
↓
NestJS Guard
↓
User sync (Frontend triggers POST /api/auth/sync)
↓
Access decision

### Social Login:
User
↓
Google/Facebook
↓
Supabase OAuth
↓
JWT
↓
NestJS Guard
↓
User sync (Frontend triggers POST /api/auth/sync)
↓
Access decision

### Invitation:
Authenticated user
↓
NestJS invitation verification API (POST /api/auth/invitation/verify)
↓
Update local user status
↓
Application access

---

## 3. Database Design

Data is split between the managed identity provider and the local application database.

### Supabase Storage
*   Raw user credentials (securely hashed passwords)
*   OAuth provider connections and claims
*   Authentication audit logs

### PostgreSQL (Application Database)

#### Entity: `User`
*   **Purpose**: Stores application-level identity, authorization role, and profile state.
*   **Fields**:
    *   `id` (UUID, Primary Key)
    *   `supabase_uid` (UUID, Unique) - Maps directly to Supabase user ID
    *   `email` (String, Unique, Nullable)
    *   `phone` (String, Unique, Nullable)
    *   `role` (Enum: `USER`, `ADMIN`) - Default: `USER`
    *   `status` (Enum: `PENDING_INVITE`, `ACTIVE`, `SUSPENDED`) - Default: `PENDING_INVITE`
    *   `created_at` (Timestamp)
    *   `updated_at` (Timestamp)

#### Entity: `InvitationCode`
*   **Purpose**: Controls private access to the platform.
*   **Phase 1 Creation Method**: *Because the Admin UI is deferred to Phase 6, Phase 1 will utilize a **database seed script and documented manual database insertion** to generate initial invite codes without adding scope.*
*   **Fields**:
    *   `id` (UUID, Primary Key)
    *   `code` (String, Unique)
    *   `creator_id` (UUID, Foreign Key to `User`, Nullable for seeded codes)
    *   `usage_limit` (Integer)
    *   `used_count` (Integer) - Default: 0
    *   `expiration_date` (Timestamp, Nullable)
    *   `status` (Enum: `ACTIVE`, `EXHAUSTED`, `EXPIRED`, `REVOKED`)
    *   `created_at` (Timestamp)

---

## 4. API Design

Backend APIs strictly focus on application-level logic. Authentication endpoints handled natively by Supabase (e.g., register, login) are omitted from the NestJS API.

| Endpoint | Method | Purpose | Authentication | Request/Response Overview |
| :--- | :--- | :--- | :--- | :--- |
| `/api/auth/sync` | `POST` | Frontend-triggered endpoint. Syncs authenticated Supabase user to local DB. | Valid Supabase JWT | **Req**: `{}` <br> **Res**: `User` object |
| `/api/auth/invitation/verify` | `POST` | Verifies invite code and activates the user account. | Valid Supabase JWT | **Req**: `{ code }` <br> **Res**: `User` object (Status updated to `ACTIVE`) |
| `/api/auth/me` | `GET` | Retrieves current application-level user session, role, and status. | Valid Supabase JWT | **Req**: `{}` <br> **Res**: `User` object |

---

## 5. Security Considerations

*   **Supabase JWT Validation**: The NestJS backend must verify the signature of Supabase-issued ES256 JWTs using the Supabase JWKS endpoint. It must also validate token expiry, issuer, and audience.
*   **NestJS Guards**:
    *   `AuthGuard`: Validates the JWT and attaches the `supabase_uid` to the request.
    *   `RoleGuard`: Ensures the user possesses the required application role.
    *   `StatusGuard`: Ensures the user's status is `ACTIVE` before permitting access to core platform features (bypassed for `/sync` and `/invitation/verify`).
*   **Role Verification**: The source of truth for Roles is the local PostgreSQL `User` table, not the Supabase JWT claims (unless synchronized explicitly).
*   **Invitation Protection**:
    *   Rate limiting applied to the `/api/auth/invitation/verify` endpoint via NestJS Throttler.
    *   Atomic transactions required when incrementing the `used_count` on `InvitationCode` to prevent concurrency exploits.

---

## 6. Implementation Order

1.  **Supabase project configuration**: Create project, configure OAuth providers, obtain project URL for JWKS, and evaluate phone OTP constraints.
2.  **Backend Auth Guard**: Implement NestJS JWT validation guard and request context population.
3.  **Database entities**: Create Prisma/TypeORM schemas for `User` and `InvitationCode` and run migrations.
4.  **Database Seeding (Temp Method)**: Create database seed scripts to generate initial `InvitationCode` records.
5.  **User synchronization**: Implement the frontend-triggered `/api/auth/sync` endpoint.
6.  **Invitation system**: Implement the `/api/auth/invitation/verify` API, concurrency controls, and role/status Guards.
7.  **Frontend authentication flows**: Implement Next.js Supabase Auth UI, OAuth redirects, Sync triggering, and Invitation Verification screens.
8.  **Testing**: Execute testing suite across the completed flows.

---

## 7. Testing Requirements

*   **Supabase authentication flow testing**: E2E testing of the client-side login/signup forms bridging to Supabase.
*   **Frontend-triggered Sync Testing**: Verify that successful auth flows correctly call `/api/auth/sync` and create/update local DB records.
*   **JWT validation tests**: Unit/integration tests in NestJS ensuring invalid, expired, or malformed JWTs are rejected with `401 Unauthorized`.
*   **Guard authorization tests**: Ensure route protection blocks unauthenticated requests and correctly enforces `PENDING_INVITE` vs `ACTIVE` states.
*   **Invitation verification tests**:
    *   Successful activation flow.
    *   Rejection of exhausted/expired codes.
    *   Atomic increment verification.
*   **Social login flow tests**: E2E validation of Google/Facebook OAuth redirects and subsequent user sync.

---

## 8. Out of Scope

The following items are strictly **NOT** part of Phase 1 and must be deferred to later phases:

*   User profile creation (skills, experience, goals)
*   AI features (Roadmap generation, Daily tasks, Mentor chat, Memory)
*   Dashboard features
*   Learning features (Progress tracking, readiness evaluations)
*   Admin UI dashboards (Roles and DB entities for admins are built, but the UI is not. Invite codes will be manually seeded).

---

## Architecture Decision Summary

*   **Authentication Provider**: Supabase Auth.
*   **Token Strategy**: Supabase-issued ES256 JWTs passed to the backend via `Authorization: Bearer` headers.
*   **JWT Verification Method**: Supabase JWKS endpoint/public key verification. Validates ES256 signatures, token expiry, issuer, and audience.
*   **OAuth Approach**: Google and Facebook OAuth implemented natively through Supabase Auth (no custom OAuth implementation).
*   **Phone OTP Approach**: Use Supabase phone authentication if it aligns with project constraints. If not, fallback to the SAD decision (WhatsApp OTP as primary, low-cost SMS OTP provider as fallback). No new providers.
*   **User Synchronization Strategy**: Frontend-triggered synchronization (`POST /api/auth/sync`) to simplify MVP architecture and reduce webhook dependencies.
*   **Invitation Code Creation Method**: Database seed script and documented manual insertion (Temporary MVP method to avoid scope creep into Phase 6 Admin UI).
*   **NestJS Responsibility**: Strict gatekeeper enforcing JWT validation, user synchronization, role-based application authorization, and invitation business logic.

---

## Phase 1 Implementation Readiness Checklist

- [x] Authentication architecture confirmed
- [x] User sync approach confirmed
- [x] Phone authentication approach confirmed
- [x] Invitation creation approach confirmed
- [x] Database entities ready
- [x] API contracts ready
- [x] Testing strategy ready
