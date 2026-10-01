import { SetMetadata } from '@nestjs/common';

export const SKIP_STATUS_CHECK_KEY = 'skipStatusCheck';

/**
 * Route-level decorator that opts a route out of the StatusGuard.
 * Applied to endpoints accessible by PENDING_INVITE users:
 *   - POST /api/auth/sync
 *   - GET  /api/auth/me
 *   - POST /api/auth/invitation/verify
 *
 * Plan v1.2 §5: StatusGuard bypassed for /sync and /invitation/verify.
 */
export const SkipStatusCheck = () => SetMetadata(SKIP_STATUS_CHECK_KEY, true);
