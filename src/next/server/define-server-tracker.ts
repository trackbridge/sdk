import { createServerTracker, type ServerTracker, type ServerTrackerConfig } from '../../server/index.js';

export type ServerTrackerFactory = () => ServerTracker;

/**
 * Wraps `createServerTracker` in a module-level singleton suitable for
 * Next.js route handlers and Server Actions. The first call to the
 * returned getter invokes `configFn` and creates the tracker; later
 * calls return the cached instance. If `configFn` throws, the error
 * is cached and re-thrown on subsequent calls without re-invoking the
 * factory.
 */
export function defineServerTracker(configFn: () => ServerTrackerConfig): ServerTrackerFactory {
  let cached: ServerTracker | null = null;
  let cachedError: Error | null = null;

  return function getServerTracker(): ServerTracker {
    if (cached !== null) return cached;
    if (cachedError !== null) throw cachedError;
    try {
      cached = createServerTracker(configFn());
      return cached;
    } catch (err) {
      cachedError = err instanceof Error ? err : new Error(String(err));
      throw cachedError;
    }
  };
}
