import { logger } from '../infra/logger.util.js';
export type State = 'idle' | 'fetching' | 'processing' | 'done' | 'error';

export interface Transition {
  target: State;
  action?: () => void | Promise<void>;
}

export class FSM {
  private currentState: State = 'idle';
  private transitions: Map<string, Transition> = new Map();

  constructor(initialState: State = 'idle') {
    this.currentState = initialState;
  }

  addTransition(from: State, to: State, action?: () => void | Promise<void>) {
    this.transitions.set(`${from}->${to}`, { target: to, action });
  }

  async transition(to: State) {
    const key = `${this.currentState}->${to}`;
    const transitionData = this.transitions.get(key);

    if (transitionData) {
      logger.info(`[FSM] Transition: ${this.currentState} to ${to}`);
      if (transitionData.action) await transitionData.action();
      this.currentState = to;
    } else {
      const errorMsg = `Invalid transition from ${this.currentState} to ${to}`;
      logger.warn(`[FSM] Error: ${errorMsg}`);
    }
  }

  getState() {
    return this.currentState;
  }
}
