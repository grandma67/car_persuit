// One-shot procedural sounds: crashes, explosions, breaking props, musical cues and UI blips.
// Each builds its own short-lived nodes and lets them stop; nothing here runs continuously.
import type { TreeKind } from '../world/Climate';
import type { PropKind } from '../world/StreetProps';

export class SoundEffects {
  private jingleBus: GainNode; // short echo for musical cues
  private lastImpactTime = 0;
  private lastImpactStrength = 0;

  constructor(
    private ctx: AudioContext,
    private master: GainNode,
    private noise: AudioBuffer,
  ) {
    // Musical cues go through a little feedback echo so they ring out.
    this.jingleBus = ctx.createGain();
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.16;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.jingleBus.connect(master);
    this.jingleBus.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(master);
  }

  /** Short UI blip for menu buttons. */
  uiBlip(kind: 'hover' | 'click'): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(kind === 'hover' ? 880 : 660, now);
    if (kind === 'click') osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(kind === 'hover' ? 0.05 : 0.12, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'hover' ? 0.06 : 0.14));
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /** Short musical cue: destination reached, mission won or lost. */
  jingle(kind: 'reached' | 'won' | 'lost', delay = 0): void {
    const start = this.ctx.currentTime + delay;
    // [frequency, start offset, duration] — won: rising major arpeggio landing on a held octave;
    // lost: a soft two-step "womp-womp" fall.
    const cues = {
      reached: [[659, 0, 0.25], [988, 0.09, 0.4]],
      won: [[523, 0, 0.2], [659, 0.09, 0.2], [784, 0.18, 0.2], [1047, 0.27, 0.9]],
      lost: [[392, 0, 0.35], [370, 0.32, 0.35], [311, 0.64, 0.8]],
    }[kind];
    const bell = kind !== 'lost';
    for (const [freq, offset, duration] of cues) {
      const t = start + offset;
      // Triangle body plus a quiet sine an octave up gives a soft bell tone.
      for (const [type, mult, level] of [['triangle', 1, 0.22], ['sine', 2, bell ? 0.08 : 0]] as const) {
        if (level === 0) continue;
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq * mult, t);
        if (kind === 'lost') osc.frequency.linearRampToValueAtTime(freq * mult * 0.97, t + duration); // sag
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.connect(gain).connect(this.jingleBus);
        osc.start(t);
        osc.stop(t + duration + 0.05);
      }
    }
  }

  /**
   * Wanted level up: a tense brassy "dun-DUN" stab, a tritone apart, unlike the bright bell cues.
   * Each star pitches it a semitone higher, so the heat audibly climbs.
   */
  wantedUp(stars: number): void {
    const ctx = this.ctx;
    const start = ctx.currentTime;
    const root = 110 * Math.pow(2, Math.max(0, stars - 1) / 12);
    // [frequency, start offset, duration]: a short low hit, then the higher held one.
    for (const [freq, offset, duration] of [[root, 0, 0.16], [root * Math.SQRT2, 0.14, 0.55]]) {
      const t = start + offset;
      // Sawtooth through a lowpass that opens then closes: a muted brass swell.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(300, t);
      filter.frequency.exponentialRampToValueAtTime(2200, t + 0.05);
      filter.frequency.exponentialRampToValueAtTime(400, t + duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      filter.connect(gain).connect(this.jingleBus);
      // Two slightly detuned saws an octave apart thicken it.
      for (const [mult, detune] of [[1, -8], [2, 7]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * mult, t);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + duration + 0.05);
      }
    }
  }

  /** Car explosion: deep boom with a falling sub and a crackling tail. volume 0..1 (distance). */
  explosion(volume = 1): void {
    if (volume <= 0) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    sub.frequency.setValueAtTime(70, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 1.2);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(1.1 * volume, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    sub.connect(subGain).connect(this.master);
    sub.start(now);
    sub.stop(now + 1.5);

    const boom = ctx.createBufferSource();
    boom.buffer = this.noise;
    const boomFilter = ctx.createBiquadFilter();
    boomFilter.type = 'lowpass';
    boomFilter.frequency.setValueAtTime(1800, now);
    boomFilter.frequency.exponentialRampToValueAtTime(120, now + 1.5);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(1.0 * volume, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    boom.connect(boomFilter).connect(boomGain).connect(this.master);
    boom.start(now, Math.random() * 0.2);
    boom.stop(now + 1.9);
  }

  /** Filtered noise burst starting `at` seconds from now: the building block of cracks and rustles. */
  private burst(at: number, duration: number, type: BiquadFilterType, freq: number, q: number, gain: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + duration + 0.02);
  }

  /**
   * Wood breaking: a sharp snap, a hollow knock from the timber, then a run of splinter crackles.
   * `size`: 0.3 (umbrella pole, fence) … 1 (tree trunk) — bigger is deeper, longer and splintier.
   */
  private woodBreak(size: number, gain: number): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.burst(0, 0.03 + size * 0.02, 'highpass', 1600, 0.7, gain * 1.6); // the snap
    this.burst(0, 0.12 + size * 0.2, 'bandpass', 520 - size * 220, 5, gain * 1.3); // woody knock
    // Splinters: tiny bright cracks, denser and longer for a trunk.
    const splinters = 4 + Math.round(size * 8);
    for (let i = 0; i < splinters; i++) {
      const at = 0.02 + Math.random() * (0.12 + size * 0.35);
      this.burst(at, 0.012 + Math.random() * 0.025, 'bandpass', 1800 + Math.random() * 2800, 2.5, gain * (0.35 + Math.random() * 0.6));
    }
    // A trunk giving way groans first: a low, falling, buzzy creak.
    if (size > 0.6) {
      const creak = ctx.createOscillator();
      creak.type = 'sawtooth';
      creak.frequency.setValueAtTime(95, now);
      creak.frequency.exponentialRampToValueAtTime(48, now + 0.35);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(gain * 0.5, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      creak.connect(lp).connect(cg).connect(this.master);
      creak.start(now);
      creak.stop(now + 0.42);
    }
  }

  /** Knocked-loose street furniture: metal clang (lamps, hydrants), wood breaking (benches, fences, trees, umbrellas). */
  propBreak(kind: PropKind, strength: number, tree?: TreeKind): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gain = 0.15 + strength * 0.3;

    if (kind === 'tree' && tree === 'cactus') {
      // Not wood: a wet, fibrous crunch and a dull thump.
      this.burst(0, 0.18, 'lowpass', 700, 1, gain * 1.6);
      this.burst(0.01, 0.1, 'bandpass', 1400, 1.5, gain * 0.8);
      this.impact(Math.min(0.5, strength));
      return;
    }
    if (kind === 'tree' || kind === 'umbrella' || kind === 'bench' || kind === 'fence') {
      const size = kind === 'tree' ? (tree === 'palm' ? 0.8 : 1) : kind === 'bench' ? 0.55 : 0.35;
      this.woodBreak(size, gain);
      // Leaves or canvas thrashing as it goes over.
      if (kind === 'tree') this.burst(0.05, 0.9, 'highpass', 3200, 0.5, gain * 0.5);
      if (kind === 'umbrella') this.burst(0.03, 0.35, 'bandpass', 900, 0.8, gain * 0.6);
      return;
    }
    const metal = kind !== 'cone';

    if (metal) {
      // Inharmonic partials ring like struck metal.
      const base = kind === 'lamp' || kind === 'signal' ? 380 : kind === 'sign' ? 700 : 520;
      for (const ratio of [1, 2.76, 5.4]) {
        const osc = ctx.createOscillator();
        osc.frequency.value = base * ratio * (0.95 + Math.random() * 0.1);
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain / ratio, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.7 / Math.sqrt(ratio));
        osc.connect(g).connect(this.master);
        osc.start(now);
        osc.stop(now + 0.8);
      }
    }

    // Crack/crunch burst for everything.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = metal ? 2500 : 1100;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * 1.4, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (metal ? 0.12 : 0.18));
    noise.connect(filter).connect(g).connect(this.master);
    noise.start(now, Math.random() * 1.5);
    noise.stop(now + 0.25);

    if (kind === 'hydrant') {
      // Water gushing, fading over a few seconds.
      const water = ctx.createBufferSource();
      water.buffer = this.noise;
      water.loop = true;
      const wf = ctx.createBiquadFilter();
      wf.type = 'highpass';
      wf.frequency.value = 1800;
      const wg = ctx.createGain();
      wg.gain.setValueAtTime(0.12, now);
      wg.gain.exponentialRampToValueAtTime(0.001, now + 6);
      water.connect(wf).connect(wg).connect(this.master);
      water.start(now);
      water.stop(now + 6);
    }
  }

  /**
   * One-shot crash: a low thump plus a burst of crunch noise. strength is 0..1 — from the collision
   * speed (and distance, for other cars' crashes); quieter hits are also duller and shorter.
   */
  impact(strength: number): void {
    if (strength <= 0.01) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Rate-limit, but don't let a small knock swallow a much bigger crash right after it.
    if (now - this.lastImpactTime < 0.12 && strength < this.lastImpactStrength * 1.5) return;
    this.lastImpactTime = now;
    this.lastImpactStrength = strength;

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(90, now);
    thump.frequency.exponentialRampToValueAtTime(35, now + 0.25);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.9 * strength, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    thump.connect(thumpGain).connect(this.master);
    thump.start(now);
    thump.stop(now + 0.3);

    const crunch = ctx.createBufferSource();
    crunch.buffer = this.noise;
    const crunchFilter = ctx.createBiquadFilter();
    crunchFilter.type = 'lowpass';
    crunchFilter.frequency.value = 900 + strength * 2500;
    const crunchGain = ctx.createGain();
    crunchGain.gain.setValueAtTime(0.7 * strength, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15 + strength * 0.35);
    crunch.connect(crunchFilter).connect(crunchGain).connect(this.master);
    crunch.start(now, Math.random() * 1.5);
    crunch.stop(now + 0.5 + strength * 0.3);
  }
}
