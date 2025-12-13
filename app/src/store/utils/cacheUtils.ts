/**
 * Cache utility functions for managing data freshness
 */

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Check if cached data is still valid based on timestamp and TTL
 */
export const isCacheValid = (timestamp: number | null, ttl: number = DEFAULT_TTL): boolean => {
  if (!timestamp) return false;
  return Date.now() - timestamp < ttl;
};

/**
 * Get the default cache TTL
 */
export const getCacheTTL = (): number => DEFAULT_TTL;

/**
 * Get current timestamp for cache tracking
 */
export const getCacheTimestamp = (): number => Date.now();
