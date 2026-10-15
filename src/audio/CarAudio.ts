// Procedural game audio with Web Audio — no sound files. Owns the context, the continuous engine,
// tyre and siren sounds and the music; one-shot sounds live in SoundEffects. Browsers only allow
// audio after a user gesture, so the context is created on the first key/pointer press.
import { MenuMusic, WIN_SONG } from './MenuMusic';
import { SeaAudio, type WaterSound } from './SeaAudio';
import { SoundEffects } from './SoundEffects';
import { gearFor, GEAR_TOP_SPEEDS } from '../vehicles/gears';
import type { TreeKind } from '../world/Climate';
import type { PropKind } from '../world/StreetProps';


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
  private sirenOsc!: OscillatorNode;
  private sirenLfo!: OscillatorNode;
  private sirenFilter!: BiquadFilterNode;
  private sirenGain!: GainNode;
  private sfx: SoundEffects | null = null;
  private water: SeaAudio | null = null;
  private rpm = 0.15;
  private engineOff = false; // wrecked
  private engineRunning = false; // silent on the menu until the mission starts
  private music: MenuMusic | null = null;
  private winMusic: MenuMusic | null = null;
  private wantMusic = false;
  private muted = false;

  constructor() {
    const unlock = () => {
      this.init();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  /** Create the audio context now (call from a user gesture). */
  unlock(): void {
    this.init();
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

    this.sfx = new SoundEffects(ctx, this.master, this.noise);

    // Tyre screech: band-passed noise.
    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 1100;
    this.screechFilter.Q.value = 3;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    this.loopNoise().connect(this.screechFilter).connect(this.screechGain).connect(this.master);

    // Police siren: a triangle wave whose pitch an LFO sweeps up and down (the classic wail).
    // Distance muffles it through a lowpass.
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 950;
    this.sirenLfo = ctx.createOscillator();
    this.sirenLfo.frequency.value = 0.32;
    const sweep = ctx.createGain();
    sweep.gain.value = 380;
    this.sirenLfo.connect(sweep).connect(this.sirenOsc.frequency);
    this.sirenFilter = ctx.createBiquadFilter();
    this.sirenFilter.type = 'lowpass';
    this.sirenFilter.frequency.value = 3000;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenFilter).connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
    this.sirenLfo.start();

    this.water = new SeaAudio(ctx, this.master, () => this.loopNoise());

    this.music = new MenuMusic(ctx, this.master);
    if (this.wantMusic) this.music.start();
  }

  /** Menu music on/off (starts once audio is unlocked if requested earlier). */
  menuMusic(on: boolean): void {
    this.wantMusic = on;
    if (on) this.music?.start();
    else this.music?.stop();
  }

  /** Victory loop for the win screen, fading in after the win jingle. */
  playWinMusic(delay = 1.2): void {
    if (!this.ctx || this.winMusic) return;
    this.winMusic = new MenuMusic(this.ctx, this.master, WIN_SONG);
    this.winMusic.start(delay);
  }

  /** Start the engine sound (mission start). */
  startEngine(): void {
    this.engineRunning = true;
  }

  /** Short UI blip for menu buttons. */
  uiBlip(kind: 'hover' | 'click'): void {
    this.sfx?.uiBlip(kind);
  }

  /** Siren from the nearest cop: distance in metres, or null for no cops. */
  setSiren(distance: number | null): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const near = distance === null ? 0 : clamp(1 - distance / 250, 0, 1);
    this.sirenGain.gain.setTargetAtTime(near * near * 0.13, now, 0.15);
    this.sirenFilter.frequency.setTargetAtTime(700 + near * 3500, now, 0.15);
    // Close in, it switches to the faster "yelp".
    this.sirenLfo.frequency.setTargetAtTime(distance !== null && distance < 40 ? 3.2 : 0.32, now, 0.3);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  update(dt: number, s: CarSoundState): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const absSpeed = Math.abs(s.speed);

    // Engine rpm from simulated gears; revs toward the redline when throttling at a standstill.
    const gear = gearFor(absSpeed);
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
    const silent = this.engineOff || !this.engineRunning;
    this.engineGain.gain.setTargetAtTime(silent ? 0 : 0.18 + s.throttle * 0.14, now, this.engineOff ? 0.02 : 0.25);

    this.screechGain.gain.setTargetAtTime(silent ? 0 : s.skid * 0.12, now, 0.04);
    this.screechFilter.frequency.setTargetAtTime(950 + s.skid * 250 + Math.random() * 80, now, 0.05);
  }

  /** Surf and canal water near the player (heard once the run has started). */
  setWater(dt: number, w: WaterSound): void {
    this.water?.update(dt, w, this.engineRunning);
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
    this.sfx?.jingle(kind, delay);
  }

  /** Wanted level went up to `stars`. */
  wantedUp(stars: number): void {
    this.sfx?.wantedUp(stars);
  }

  /** Car explosion. volume 0..1 (distance). */
  explosion(volume = 1): void {
    this.sfx?.explosion(volume);
  }

  /** Knocked-loose street furniture. */
  propBreak(kind: PropKind, strength: number, tree?: TreeKind): void {
    this.sfx?.propBreak(kind, strength, tree);
  }

  /** A car flashing past close (see PassBy). */
  whoosh(strength: number, pan: number, heavy: number): void {
    if (!this.engineOff) this.sfx?.whoosh(strength, pan, heavy);
  }

  /** One-shot crash. strength 0..1. */
  impact(strength: number): void {
    this.sfx?.impact(strength);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
