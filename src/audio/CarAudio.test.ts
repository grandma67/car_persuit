import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarAudio } from './CarAudio';

/** Any node: every property is a no-op function, a nested param, or a fake buffer's channel data. */
function fakeNode(): unknown {
  const params: Record<string | symbol, unknown> = {};
  return new Proxy(function () {}, {
    get(_, key) {
      if (key in params) return params[key];
      if (key === 'getChannelData') return () => new Float32Array(8);
      if (key === 'connect') return (next: unknown) => next;
      if (typeof key === 'symbol' || key === 'then') return undefined;
      return (params[key] = fakeNode());
    },
    set(_, key, value) {
      params[key] = value;
      return true;
    },
    apply: () => fakeNode(),
  });
}

describe('CarAudio context', () => {
  let made: { state: string; resume: ReturnType<typeof vi.fn> }[];
  let active: boolean;
  let listeners: Record<string, (() => void)[]>;
  let failing: boolean;

  beforeEach(() => {
    made = [];
    active = false;
    failing = false;
    listeners = {};
    vi.stubGlobal('AudioContext', function (this: unknown) {
      if (failing) throw new Error('no audio device');
      const ctx = new Proxy(
        { state: 'suspended', sampleRate: 48000, currentTime: 0, resume: vi.fn(async () => void (ctx.state = 'running')), suspend: vi.fn(async () => {}) },
        { get: (t, k) => (k in t ? t[k as keyof typeof t] : fakeNode()) },
      );
      made.push(ctx);
      return ctx;
    });
    vi.stubGlobal('navigator', { userActivation: { get isActive() { return active; } } });
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
      removeEventListener: (type: string, fn: () => void) => (listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const fire = (type: string) => [...(listeners[type] ?? [])].forEach((fn) => fn());

  it('prepare makes one empty context, left suspended', () => {
    const audio = new CarAudio();
    audio.prepare();
    audio.prepare();
    expect(made).toHaveLength(1);
    expect(made[0].resume).not.toHaveBeenCalled();
  });

  it('the first real gesture uses the prepared context and resumes it', () => {
    const audio = new CarAudio();
    audio.prepare();
    active = true;
    fire('keydown');
    expect(made).toHaveLength(1);
    expect(made[0].resume).toHaveBeenCalled();
  });

  it.each(['keydown', 'pointerdown'])('a %s without activation builds nothing, and a touch\'s pointerup then unlocks', (type) => {
    const audio = new CarAudio();
    audio.prepare();
    fire(type);
    audio.unlock(); // as "Tap to continue" does on a touch's pointerdown
    expect(made[0].resume).not.toHaveBeenCalled();
    active = true;
    fire('pointerup');
    expect(made[0].resume).toHaveBeenCalled();
  });

  it('calls before the unlock are safe', () => {
    const audio = new CarAudio();
    audio.prepare();
    expect(() => {
      audio.setSiren(10);
      audio.setPaused(true);
      audio.setPaused(false);
      audio.setMuted(true);
      audio.menuMusic(true);
      audio.uiBlip('click');
      audio.stopEngine();
      audio.reset();
    }).not.toThrow();
    expect(made[0].resume).not.toHaveBeenCalled();
  });

  it('a context that failed to prepare is tried again at the gesture', () => {
    const audio = new CarAudio();
    failing = true;
    audio.prepare();
    failing = false;
    expect(made).toHaveLength(0);
    active = true;
    audio.unlock();
    expect(made).toHaveLength(1);
  });
});
