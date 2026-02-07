// Cache utility functions

export const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const getCacheTimestamp = (): number => Date.now();

export const isCacheValid = (lastFetch: number | null, duration: number = CACHE_DURATION): boolean => {
  if (!lastFetch) return false;
  return Date.now() - lastFetch < duration;
};
