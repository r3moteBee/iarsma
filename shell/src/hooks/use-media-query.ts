/**
 * Responsive breakpoint hooks (Phase 4 responsive layout).
 *
 * `useMediaQuery` wraps `window.matchMedia` in a React hook with proper
 * SSR safety and listener cleanup. `useBreakpoint` composes two media
 * queries to return a discrete `'mobile' | 'tablet' | 'desktop'` value
 * that components can branch on.
 *
 * Breakpoints match the design tokens documented in
 * `shell/src/styles/global.css`:
 *   - Mobile:  < 640px  (default / base)
 *   - Tablet:  >= 640px && < 1024px
 *   - Desktop: >= 1024px
 */

import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 * Falls back to `false` when `window.matchMedia` is unavailable (SSR,
 * jsdom without mocks, etc.).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(query);
    // Sync in case the value changed between render and effect.
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

/**
 * Returns the current breakpoint as a discrete string. Components can
 * use this instead of raw media queries for cleaner branching.
 */
export function useBreakpoint(): Breakpoint {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isTablet = useMediaQuery('(min-width: 640px)');
  if (isDesktop) return 'desktop';
  if (isTablet) return 'tablet';
  return 'mobile';
}
