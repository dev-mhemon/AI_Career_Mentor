import { SetMetadata } from '@nestjs/common';

export const SKIP_STATUS_CHECK_KEY = 'skipStatusCheck';

/**
 * Route-level decorator that opts a route out of the StatusGuard.
 * Applied to endpoints accessible before full status validation:
 *   - POST /api/auth/sync
 *   - GET  /api/auth/me
 */
export const SkipStatusCheck = () => SetMetadata(SKIP_STATUS_CHECK_KEY, true);
