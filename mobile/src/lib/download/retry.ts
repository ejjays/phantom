export const ABORT_MESSAGE = 'aborted';

type RetryOptions = {
  retries: number;
  delayMs?: number;
  signal?: AbortSignal;
};

export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  { retries, delayMs = 0, signal }: RetryOptions
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new Error(ABORT_MESSAGE);
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt < retries && delayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, delayMs * (attempt + 1));
        });
      }
    }
  }
  throw lastError;
}
