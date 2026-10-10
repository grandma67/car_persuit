// Procedural car audio with Web Audio — no sound files. Browsers only allow audio after a user
// gesture, so the context is created on the first key/pointer press.

// Upper speed (m/s) of each gear; rpm sweeps within the band, dropping on each upshift.
const GEAR_TOP_SPEEDS = [9, 17, 25, 33, 39, 46];

/** Soft-clip curve: warms the engine with low-order harmonics instead of harsh buzz. */
function createSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export interface CarSoundState {
  speed: number; // signed m/s
  throttle: number; // 0..1
  skid: number; // 0..1
  maxSpeed: number;
}

export class CarAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engineOscs!: OscillatorNode[]; // two detuned saws
  private engineSub!: OscillatorNode;
  private firingLfo!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private shiftGain!: GainNode;
  private engineGain!: GainNode;
  private gear = 0;
  private screechFilter!: BiquadFilterNode;
  private screechGain!: GainNode;
  private windGain!: GainNode;
  private jingleBus!: GainNode; // short echo for musical cues
  private rpm = 0.15;
  private engineOff = false;
  private muted = false;
  private lastImpactTime = 0;

  constructor() {
    const unlock = () => {
      this.init();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  private init(): void {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.noise = createNoiseBuffer(ctx);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    // Gentle high-cut on everything takes the edge off.
    const masterTone = ctx.createBiquadFilter();
    masterTone.type = 'lowpass';
    masterTone.frequency.value = 5000;
    masterTone.Q.value = 0.5;
    const compressor = ctx.createDynamicsCompressor();
    this.master.connect(masterTone).connect(compressor).connect(ctx.destination);

    // Engine: two detuned saws + sine sub-octave → soft saturation → two un-resonant lowpasses
    // (steep, so no buzz) → "firing" amplitude pulse for a V8-style burble.
    const mix = ctx.createGain();
    mix.gain.value = 0.35;
    this.engineOscs = [0, 7].map((cents) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = cents;
      osc.connect(mix);
      osc.start();
      return osc;
    });
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'sine';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.7;
    this.engineSub.connect(subGain).connect(mix);
    this.engineSub.start();

    const saturate = ctx.createWaveShaper();
    saturate.curve = createSaturationCurve(2.5);
    saturate.oversample = '2x';
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 0.7;
    const engineHighCut = ctx.createBiquadFilter();
    engineHighCut.type = 'lowpass';
    engineHighCut.frequency.value = 1200;
    engineHighCut.Q.value = 0.5;

    const firing = ctx.createGain();
    firing.gain.value = 0.7;
    this.firingLfo = ctx.createOscillator();
    this.firingLfo.type = 'triangle';
    const firingDepth = ctx.createGain();
    firingDepth.gain.value = 0.3;
    this.firingLfo.connect(firingDepth).connect(firing.gain);
    this.firingLfo.start();

    this.shiftGain = ctx.createGain();
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    mix
      .connect(saturate)
      .connect(this.engineFilter)
      .connect(engineHighCut)
      .connect(firing)
      .connect(this.shiftGain)
      .connect(this.engineGain)
      .connect(this.master);

    // Musical cues go through a little feedback echo so they ring out.
    this.jingleBus = ctx.createGain();
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.16;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.jingleBus.connect(this.master);
    this.jingleBus.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.master);

    // Tyre screech: band-passed noise.
    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 1100;
    this.screechFilter.Q.value = 3;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    this.loopNoise().connect(this.screechFilter).connect(this.screechGain).connect(this.master);

    // Wind: low band-passed noise rising with speed.
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(windFilter).connect(this.windGain).connect(this.master);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  update(dt: number, s: CarSoundState): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const absSpeed = Math.abs(s.speed);

    // Engine rpm from simulated gears; revs toward the redline when throttling at a standstill.
    let gear = GEAR_TOP_SPEEDS.findIndex((top) => absSpeed < top);
    if (gear < 0) gear = GEAR_TOP_SPEEDS.length - 1;
    const low = gear === 0 ? 0 : GEAR_TOP_SPEEDS[gear - 1];
    const bandRatio = (absSpeed - low) / (GEAR_TOP_SPEEDS[gear] - low);
    let targetRpm = 0.25 + 0.7 * Math.min(bandRatio, 1);
    if (absSpeed < 1) targetRpm = 0.15 + s.throttle * 0.35;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 10);

    // Upshift: brief throttle cut, like a real gear change.
    if (gear > this.gear && s.throttle > 0) {
      this.shiftGain.gain.cancelScheduledValues(now);
      this.shiftGain.gain.setValueAtTime(0.4, now);
      this.shiftGain.gain.linearRampToValueAtTime(1, now + 0.16);
    }
    this.gear = gear;

    const freq = 42 + this.rpm * 110;
    for (const osc of this.engineOscs) osc.frequency.setTargetAtTime(freq, now, 0.03);
    this.engineSub.frequency.setTargetAtTime(freq / 2, now, 0.03);
    this.firingLfo.frequency.setTargetAtTime(freq / 4, now, 0.03);
    // Opens up under throttle (growl), closes when lifting off (mellow burble).
    this.engineFilter.frequency.setTargetAtTime(260 + s.throttle * 520 + this.rpm * 450, now, 0.06);
    this.engineGain.gain.setTargetAtTime(this.engineOff ? 0 : 0.18 + s.throttle * 0.14, now, this.engineOff ? 0.02 : 0.06);

    this.screechGain.gain.setTargetAtTime(this.engineOff ? 0 : s.skid * 0.12, now, 0.04);
    this.screechFilter.frequency.setTargetAtTime(950 + s.skid * 250 + Math.random() * 80, now, 0.05);

    const speedRatio = Math.min(absSpeed / s.maxSpeed, 1);
    this.windGain.gain.setTargetAtTime(speedRatio * speedRatio * 0.18, now, 0.1);
  }

  /** Silence everything while the game is paused. */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Cut the engine and tyres (the car is wrecked). */
  stopEngine(): void {
    this.engineOff = true;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.engineGain.gain.cancelScheduledValues(now);
    this.engineGain.gain.setTargetAtTime(0, now, 0.02);
    this.screechGain.gain.setTargetAtTime(0, now, 0.02);
  }

  /** Short musical cue: destination reached, mission won or lost. */
  jingle(kind: 'reached' | 'won' | 'lost', delay = 0): void {
    if (!this.ctx) return;
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

  /** Car explosion: deep boom with a falling sub and a crackling tail. */
  explosion(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    sub.frequency.setValueAtTime(70, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 1.2);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(1.1, now);
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
    boomGain.gain.setValueAtTime(1.0, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    boom.connect(boomFilter).connect(boomGain).connect(this.master);
    boom.start(now, Math.random() * 0.2);
    boom.stop(now + 1.9);
  }

  /** Knocked-loose street furniture: metal clang (lamps, hydrants) or wood crack (benches, fences). */
  propBreak(kind: 'lamp' | 'hydrant' | 'bench' | 'fence', strength: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gain = 0.15 + strength * 0.3;
    const metal = kind === 'lamp' || kind === 'hydrant';

    if (metal) {
      // Inharmonic partials ring like struck metal.
      const base = kind === 'lamp' ? 380 : 520;
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

  /** One-shot crash: a low thump plus a burst of crunch noise. strength is 0..1. */
  impact(strength: number): void {
    if (!this.ctx || strength <= 0) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastImpactTime < 0.12) return;
    this.lastImpactTime = now;

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
