import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMetronome } from '../src/hooks/useMetronome';
import { useRemixEngine } from '../src/hooks/useRemixEngine';
import { useRemixStore } from '../src/store/useRemixStore';

const mockResume = vi.fn().mockResolvedValue();
const mockClose = vi.fn().mockResolvedValue();
const mockDecodeAudioData = vi.fn().mockResolvedValue({});

class MockAudioContext {
  state = 'suspended';
  resume = mockResume;
  close = mockClose;
  decodeAudioData = mockDecodeAudioData;
}

vi.stubGlobal('AudioContext', MockAudioContext);
vi.stubGlobal('webkitAudioContext', MockAudioContext);

global.fetch = vi.fn().mockResolvedValue({
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
});

const createdAudioInstances: MockAudio[] = [];

if (typeof window.HTMLAudioElement === 'undefined') {
  Object.defineProperty(window, 'HTMLAudioElement', {
    value: class HTMLAudioElement {
      src = '';
      volume = 1;
      currentTime = 0;
      duration = 0;
      paused = true;
      readyState = 0;
      preload = '';
      // skipcq: JS-W1042
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      removeAttribute = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  });
}

// intercept Audio
class MockAudio {
  src = '';
  volume = 1;
  currentTime = 0;
  duration = 100;
  paused = true;
  readyState = 0;
  preload = '';
  // skipcq: JS-W1042
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();

  // mock events
  listeners: Record<string, Array<() => void>> = {};

  addEventListener = vi.fn((event: string, cb: () => void) => {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  });

  removeEventListener = vi.fn((event: string, cb: () => void) => {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== cb);
    }
  });

  // trigger event
  trigger(event: string) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb());
    }
  }

  constructor() {
    createdAudioInstances.push(this);
    // auto-resolve metadata
    setTimeout(() => this.trigger('loadedmetadata'), 0);
  }
}

global.Audio = MockAudio as unknown as typeof Audio;

describe('Audio Autoplay Policy Resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resume AudioContext correctly on user gesture', async () => {
    const { result } = renderHook(() => useMetronome());

    await act(async () => {
      await result.current.resumeAudioContext();
    });

    expect(mockResume).toHaveBeenCalledTimes(1);
  });

  it('should force AudioContext resumption when enabling metronome', async () => {
    const { result } = renderHook(() => useMetronome());

    await act(async () => {
      await result.current.setIsMetronome(true);
    });

    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(result.current.isMetronome).toBe(true);
  });
});

describe('useRemixEngine', () => {
  beforeEach(() => {
    useRemixStore.getState().resetStore();
    vi.clearAllMocks();
  });

  it('should set isReady to true immediately to prevent mobile autoplay deadlock', async () => {
    const mockPlayTick = vi.fn();
    const { result } = renderHook(() =>
      useRemixEngine([], false, mockPlayTick, 0)
    );

    expect(useRemixStore.getState().isReady).toBe(false);

    const testSources = {
      vocals: 'http://localhost:5000/vocals.wav',
      drums: 'http://localhost:5000/drums.wav',
    };

    await act(async () => {
      await result.current.loadAudioSources(testSources);
    });

    // handle mobile autoplay
    expect(useRemixStore.getState().isReady).toBe(true);
  });

  it('should strictly set audio preload to "metadata" to prevent 6-connection browser deadlock', async () => {
    createdAudioInstances.length = 0; // reset
    const mockPlayTick = vi.fn();
    const { result } = renderHook(() =>
      useRemixEngine([], false, mockPlayTick, 0)
    );

    const testSources = {
      vocals: 'http://localhost:5000/vocals.wav',
      drums: 'http://localhost:5000/drums.wav',
      bass: 'http://localhost:5000/bass.wav',
      guitar: 'http://localhost:5000/guitar.wav',
      other: 'http://localhost:5000/other.wav',
      piano: 'http://localhost:5000/piano.wav',
    };

    await act(async () => {
      await result.current.loadAudioSources(testSources);
    });

    // check instances
    expect(createdAudioInstances).toHaveLength(6);

    // check preload
    createdAudioInstances.forEach((audio) => {
      expect(audio.preload).toBe('metadata');
    });
  });
});

describe('useRemixEngine animation loop', () => {
  let pending: ((t: number) => void) | null = null;
  const realRaf = global.requestAnimationFrame;
  const realCaf = global.cancelAnimationFrame;

  // fire a frame: a scheduled callback runs once and is only
  // re-armed if the code calls requestAnimationFrame again
  const tick = (t: number) => {
    const cb = pending;
    pending = null;
    cb?.(t);
  };

  beforeEach(() => {
    useRemixStore.getState().resetStore();
    vi.clearAllMocks();
    pending = null;
    global.requestAnimationFrame = ((cb: (t: number) => void) => {
      pending = cb;
      return 1;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    global.requestAnimationFrame = realRaf;
    global.cancelAnimationFrame = realCaf;
  });

  it('keeps rescheduling after an empty start so currentTime advances once playing', async () => {
    createdAudioInstances.length = 0;
    const { result } = renderHook(() => useRemixEngine([], false, vi.fn(), 0));

    // empty-state frames must not kill the loop
    act(() => {
      for (let t = 16; t <= 80; t += 16) tick(t);
    });
    expect(pending).not.toBeNull();

    await act(async () => {
      await result.current.loadAudioSources({ vocals: 'a', drums: 'b' });
    });
    createdAudioInstances.forEach((a) => {
      a.paused = false;
      a.currentTime = 5;
    });
    act(() => {
      result.current.togglePlay();
    });
    expect(useRemixStore.getState().currentTime).toBe(0);

    // a live loop advances currentTime
    act(() => {
      tick(96);
    });
    expect(useRemixStore.getState().currentTime).toBeGreaterThan(0);
  });
});
