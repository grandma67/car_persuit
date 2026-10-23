// One-shot procedural sounds: crashes, explosions, breaking props, musical cues and UI blips.
// Each builds its own short-lived nodes and lets them stop; only the player's held horn runs on
// until let go.
import type { Honk } from '../ai/horn';
import type { TreeKind } from '../world/Climate';
import type { PropKind } from '../world/StreetProps';

export class SoundEffects {
  private jingleBus: GainNode; // short echo for musical cues
  private lastImpactTime = 0;
  private lastImpactStrength = 0;
  private held: { gain: GainNode; oscs: OscillatorNode[] } | null = null; // the player's horn, while H is down

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
    // Chinatown breakables.
    if (kind === 'firecrackerCrate') {
      // A ripple of little bangs.
      for (let k = 0; k < 14; k++) this.burst(k * 0.035 + Math.random() * 0.02, 0.04, 'bandpass', 1800 + Math.random() * 1500, 1, gain * 0.9);
      return;
    }
    if (kind === 'lanternStand' || kind === 'menuBoard' || kind === 'lionDance' || kind === 'dragonFloat') {
      this.burst(0, 0.2, 'highpass', 2200, 0.6, gain * 0.7); // paper and thin wood
      return;
    }
    if (kind === 'mahjongTable') {
      for (let k = 0; k < 8; k++) this.burst(k * 0.03, 0.03, 'bandpass', 3200, 2, gain * 0.5); // tiles clattering
      return;
    }
    if (kind === 'parkedVan') {
      this.impact(Math.min(1, strength + 0.3));
      return;
    }
    // Harbor breakables (drums, the forklift, boom gates and crossing posts clang as metal, below).
    if (kind === 'pallet' || kind === 'crates' || kind === 'cableReel') {
      this.woodBreak(kind === 'crates' ? 0.7 : 0.5, gain);
      return;
    }
    if (kind === 'lifebuoy') {
      this.burst(0, 0.2, 'lowpass', 900, 0.7, gain);
      return;
    }
    if (kind === 'forklift') {
      this.impact(Math.min(1, strength + 0.3));
      return;
    }
    if (kind === 'produceStall' || kind === 'dimSumCart' || kind === 'fishCrate') {
      this.woodBreak(0.4, gain);
      return;
    }
    // Farm breakables (churns, troughs and the mailbox clang as metal, below).
    if (kind === 'parkedTractor' || kind === 'baler' || kind === 'plough' || kind === 'seedDrill' || kind === 'hayRake') {
      this.impact(Math.min(1, strength + (kind === 'parkedTractor' || kind === 'baler' ? 0.3 : 0.15)));
      return;
    }
    if (kind === 'pumpkin' || kind === 'jackOLantern' || kind === 'fruitBin') {
      this.burst(0, 0.12, 'lowpass', 500, 1, gain * 1.5); // a wet squash
      this.burst(0.01, 0.08, 'bandpass', 1600, 1.2, gain * 0.6);
      if (kind === 'fruitBin') this.woodBreak(0.5, gain);
      return;
    }
    if (kind === 'scarecrow' || kind === 'feedSacks') {
      this.burst(0, 0.3, 'lowpass', 800, 0.7, gain * 1.2);
      this.burst(0.02, 0.5, 'highpass', 2600, 0.5, gain * 0.45);
      return;
    }
    if (kind === 'farmStand' || kind === 'toolRack' || kind === 'wheelbarrow' || kind === 'hayWagon' || kind === 'woodLamp' || kind === 'utilityPole') {
      this.woodBreak(kind === 'hayWagon' || kind === 'utilityPole' ? 0.85 : kind === 'woodLamp' ? 0.6 : 0.55, gain);
      if (kind === 'hayWagon') this.burst(0.03, 0.5, 'lowpass', 900, 0.7, gain);
      return;
    }
    // Old City breakables.
    if (kind === 'haybale' || kind === 'roundBale') {
      this.burst(0, 0.35, 'lowpass', 900, 0.7, gain * 1.4); // a soft whump of straw
      this.burst(0.02, 0.6, 'highpass', 2500, 0.5, gain * 0.4);
      return;
    }
    if (kind === 'pot' || kind === 'amphora') {
      // Terracotta: a dull knock and a bright scatter of shards.
      this.burst(0, 0.06, 'bandpass', 700, 1.2, gain * 1.2);
      this.burst(0.02, 0.25, 'bandpass', 3800, 1.5, gain * 0.9);
      return;
    }
    // Slums junk: heavy metal for the dumpster and wrecks, soft thumps for bags and furniture.
    if (kind === 'dumpster' || kind === 'wreck') {
      this.impact(Math.min(1, strength + 0.3));
      return;
    }
    if (kind === 'trashBags' || kind === 'mattress' || kind === 'couch') {
      this.burst(0, 0.3, 'lowpass', 700, 0.7, gain * 1.3);
      this.burst(0.02, 0.4, 'highpass', 2400, 0.5, gain * (kind === 'trashBags' ? 0.7 : 0.35)); // plastic rustle
      return;
    }
    if (kind === 'tyres') {
      this.burst(0, 0.18, 'lowpass', 400, 1, gain * 1.4); // rubber thud
      return;
    }
    if (kind === 'payphone') this.burst(0.01, 0.2, 'highpass', 5000, 0.6, gain * 0.8); // the booth glass, then the metal ring below
    if (kind === 'cannonballs' || kind === 'rubble') {
      this.impact(Math.min(0.6, strength + 0.2));
      return;
    }
    if (kind === 'cart' || kind === 'stall' || kind === 'barrels' || kind === 'pillory' || kind === 'signpost') {
      this.woodBreak(kind === 'signpost' ? 0.35 : kind === 'barrels' ? 0.6 : 0.8, gain);
      if (kind === 'stall') this.burst(0.03, 0.35, 'bandpass', 900, 0.8, gain * 0.6); // the awning
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
      const base = kind === 'lamp' || kind === 'signal' ? 380 : kind === 'sign' ? 700 : kind === 'oilLamp' || kind === 'dragonLamp' ? 620 : 520;
      if (kind === 'oilLamp' || kind === 'dragonLamp') this.burst(0.01, 0.2, 'highpass', 5000, 0.6, gain * 0.8); // lantern glass
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
  /** A church-tower bell: `strikes` deep strokes, a couple of seconds apart. */
  bell(strikes: number, volume = 0.25): void {
    const ctx = this.ctx;
    for (let k = 0; k < strikes; k++) {
      const at = ctx.currentTime + k * 2.2;
      // A bell's partials: hum, prime, tierce (minor third), quint, nominal.
      for (const [ratio, level, decay] of [[0.5, 0.5, 4.5], [1, 0.8, 3.5], [1.19, 0.45, 2.5], [1.5, 0.3, 2], [2, 0.35, 1.6], [2.66, 0.15, 1]]) {
        const osc = ctx.createOscillator();
        osc.frequency.value = 220 * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(volume * level, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
        osc.connect(g).connect(this.master);
        osc.start(at);
        osc.stop(at + decay + 0.05);
      }
    }
  }

  /**
   * Tyres drumming over a cattle grid: a quick run of low thuds, one per bar, faster the faster
   * the car goes. `speed` in m/s.
   */
  rattle(speed: number): void {
    const ctx = this.ctx;
    const bars = 12;
    const gap = Math.max(0.012, 0.2 / Math.max(speed, 1)); // a bar every 20 cm
    const gain = Math.min(0.5, 0.15 + speed * 0.012);
    for (let k = 0; k < bars; k++) {
      const t = ctx.currentTime + k * gap;
      const thud = ctx.createOscillator();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(110 + (k % 3) * 18, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      thud.connect(g).connect(this.master);
      thud.start(t);
      thud.stop(t + 0.07);
      this.burst(k * gap, 0.04, 'bandpass', 1800, 2, gain * 0.35); // the steel's clank
    }
  }

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

  /**
   * A civilian's horn (see hornVoice). 'beep' is a quick double toot, 'blast' a long lean; a bus
   * or truck's air horn toots longer and louder, building up as the air comes and scooping up to pitch.
   * `pitch` ~0.9..1.1 gives each car its own horn.
   */
  horn(kind: Honk, volume: number, pan: number, heavy: boolean, pitch: number): void {
    const now = this.ctx.currentTime;
    const { gain, oscs, freqs } = this.hornVoice(heavy, pitch, pan * 0.8);
    // [start offset, duration] of each toot.
    const toots = heavy
      ? kind === 'beep' ? [[0, 0.28], [0.42, 0.34]] : [[0, 1.6]]
      : kind === 'beep' ? [[0, 0.13], [0.22, 0.16]] : [[0, 0.8]];
    const level = (heavy ? 0.14 : 0.16) * volume;
    const attack = heavy ? 0.05 : 0.012;
    for (const [at, duration] of toots) {
      const t = now + at;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + attack);
      gain.gain.setValueAtTime(level, t + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0, t + duration);
      if (!heavy) continue;
      oscs.forEach((osc, i) => {
        osc.frequency.setValueAtTime(freqs[i] * 0.88, t);
        osc.frequency.exponentialRampToValueAtTime(freqs[i], t + 0.09);
      });
    }
    const end = now + toots[toots.length - 1][0] + toots[toots.length - 1][1];
    for (const osc of oscs) osc.stop(end + 0.05);
  }

  /** The player's own horn: sounds from `on` until let go. */
  holdHorn(on: boolean): void {
    if (on === !!this.held) return;
    const now = this.ctx.currentTime;
    if (on) {
      this.held = this.hornVoice(false, 1.05, 0);
      this.held.gain.gain.linearRampToValueAtTime(0.2, now + 0.012);
      return;
    }
    const { gain, oscs } = this.held!;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, 0.012);
    for (const osc of oscs) osc.stop(now + 0.1);
    this.held = null;
  }

  /**
   * A car's twin horns: two buzzy tones about a major third apart through a nasal band. A bus or
   * truck's air horn: a low three-trumpet major chord through a wide lowpass, over a sine an
   * octave below for weight. Started, silent until the caller shapes `gain`, left to it to stop.
   */
  private hornVoice(heavy: boolean, pitch: number, pan: number): { gain: GainNode; oscs: OscillatorNode[]; freqs: number[] } {
    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const filter = ctx.createBiquadFilter();
    filter.type = heavy ? 'lowpass' : 'bandpass';
    filter.frequency.value = heavy ? 1400 : 1500;
    filter.Q.value = heavy ? 1.2 : 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(panner).connect(this.master);
    const root = (heavy ? 140 : 400) * pitch;
    // [frequency ratio, wave, level]
    const tones: [number, OscillatorType, number][] = heavy
      ? [[1, 'sawtooth', 1], [1.26, 'sawtooth', 0.8], [1.5, 'sawtooth', 0.7], [0.5, 'sine', 1.8]]
      : [[1, 'sawtooth', 1], [1.26, 'sawtooth', 1]];
    const freqs = tones.map(([ratio]) => root * ratio);
    const oscs = tones.map(([, type, level], i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freqs[i];
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(type === 'sine' ? gain : filter); // the sub skips the filter
      osc.start();
      return osc;
    });
    return { gain, oscs, freqs };
  }

  /**
   * A car flashing past (see PassBy): a noise swish swept from bright to dull as it goes by (the
   * Doppler drop), panned to its side, with a low buffet from the bow wave of a bus or truck.
   * `speed` is the closing speed in m/s: the faster, the shorter, brighter and steeper the sweep.
   */
  whoosh(strength: number, pan: number, heavy: number, speed: number): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const fast = Math.max(0, Math.min(1, (speed - 14) / 26)); // ~50 .. ~145 km/h
    const peak = now + 0.12; // PassBy's LEAD: the peak lands as the car draws level
    const end = peak + Math.max(0.18, Math.min(0.6, 8 / Math.max(speed, 1))); // ~8 m of travel
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan * 0.8, now);
    panner.pan.linearRampToValueAtTime(pan * 0.5, end); // drifting behind
    panner.connect(this.master);

    const swish = ctx.createBufferSource();
    swish.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(1100 + 1500 * fast + 400 * strength, now);
    band.frequency.exponentialRampToValueAtTime(650 - 200 * fast, end); // bigger Doppler drop when fast
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.32 * strength), peak); // an exponential ramp can't reach 0
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    swish.connect(band).connect(gain).connect(panner);
    swish.start(now, Math.random() * 1.5);
    swish.stop(end + 0.05);

    if (heavy <= 0) return;
    const buffet = ctx.createBufferSource();
    buffet.buffer = this.noise;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 160;
    const lowGain = ctx.createGain();
    lowGain.gain.setValueAtTime(0.0001, now);
    lowGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.6 * heavy * strength), peak + 0.05);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, end + 0.2);
    buffet.connect(low).connect(lowGain).connect(panner);
    buffet.start(now, Math.random() * 1.5);
    buffet.stop(end + 0.25);
  }
}
