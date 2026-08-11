export const IDLE_MS = 15000;
export const IDLE_BUFFER_MS = 8000;
export const IDLE_REPEAT_MS = 15000;

export type IdleTickState = {
  now: number;
  lastActivity: number;
  lastIdleAt: number;
  lastIdleStart: number;
  bubbleUp: boolean;
};

export type IdleTickDecision = 'pause' | 'wait' | 'fire';

export function idleTick(state: IdleTickState): IdleTickDecision {
  if (state.bubbleUp) return 'pause';
  if (state.now - state.lastActivity < IDLE_MS) return 'wait';
  if (state.now - state.lastIdleAt < IDLE_BUFFER_MS) return 'wait';
  if (state.now - state.lastIdleStart < IDLE_REPEAT_MS) return 'wait';
  return 'fire';
}
