export async function withRetry<T>(
  operation: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000,
  context: string = "Operation"
): Promise<T> {
  let lastError: any;

  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const isNetworkError =
        error?.code === 'ECONNRESET' ||
        error?.message?.includes('socket hang up') ||
        error?.message?.includes('fetch failed') ||
        error?.code === 'ETIMEDOUT';

      if (i < retries - 1 && isNetworkError) {
        const backoff = delay * Math.pow(2, i);
        console.warn(`[${context}] Failed (attempt ${i + 1}/${retries}). Retrying in ${backoff}ms...`, error.message);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        if (i < retries - 1) {
          // If it's not a network error, maybe we shouldn't retry? 
          // For now, let's retry anyway to be safe, or just rethrow if it's clearly a logic error.
          // But Supabase errors often come as { data: null, error: ... } objects which are NOT thrown.
          // The caller handles those. This helper handles THROWN errors (network crashes).
          throw error;
        }
      }
    }
  }

  console.error(`[${context}] All ${retries} retry attempts failed.`);
  throw lastError;
}
