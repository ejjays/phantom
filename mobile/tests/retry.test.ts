import { describe, it, expect } from 'vitest';
import { withRetry } from '../src/lib/download/retry';

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    let calls = 0;
    const out = await withRetry(
      () => {
        calls += 1;
        return Promise.resolve('ok');
      },
      { retries: 3 }
    );
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries until a later attempt succeeds', async () => {
    let calls = 0;
    const out = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(new Error('flaky'));
        return Promise.resolve(calls);
      },
      { retries: 3 }
    );
    expect(out).toBe(3);
    expect(calls).toBe(3);
  });

  it('throws the last error after exhausting retries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          return Promise.reject(new Error(`fail ${calls}`));
        },
        { retries: 2 }
      )
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });

  it('passes a zero-based attempt index to the task', async () => {
    const seen: number[] = [];
    await withRetry(
      (attempt) => {
        seen.push(attempt);
        if (attempt < 2) return Promise.reject(new Error('again'));
        return Promise.resolve(true);
      },
      { retries: 5 }
    );
    expect(seen).toEqual([0, 1, 2]);
  });

  it('does not run the task when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          return Promise.resolve('x');
        },
        { retries: 3, signal: controller.signal }
      )
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it('stops retrying once the signal aborts', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          controller.abort();
          return Promise.reject(new Error('boom'));
        },
        { retries: 5, signal: controller.signal }
      )
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});
