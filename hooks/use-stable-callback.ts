'use client';
import { useCallback, useEffect, useRef } from 'react';

/**
 * A callback with a stable identity that always invokes the newest version.
 *
 * Use it for handlers that are dependencies of something expensive to rebuild —
 * a memoized editor extension, a subscription — where a fresh closure on every
 * render would tear the result down (and drop keyboard focus) mid-interaction.
 */
export function useStableCallback<A extends unknown[], R>(
  callback: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `latest` is a ref
  // and never changes; re-creating this callback is exactly what we avoid.
  return useCallback((...args: A) => latest.current(...args), []);
}
