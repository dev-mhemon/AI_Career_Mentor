'use client';

import * as nextNavigation from 'next/navigation';

function resolvePathnameHook(): () => string {
  try {
    if (typeof nextNavigation.usePathname === 'function') {
      const hook = nextNavigation.usePathname;
      return () => hook() ?? '';
    }
  } catch {
    // Partial Vitest mocks of next/navigation may throw when reading missing exports.
  }
  return () => '';
}

/**
 * Resolves `next/navigation`'s `usePathname` hook at module load time, falling back
 * cleanly when unit tests mock `next/navigation` without `usePathname`.
 */
export const useSafePathname: () => string = resolvePathnameHook();
