// Procedural car audio with Web Audio — no sound files. Browsers only allow audio after a user
// gesture, so the context is created on the first key/pointer press.

// Upper speed (m/s) of each gear; rpm sweeps within the band, dropping on each upshift.
const GEAR_TOP_SPEEDS = [9, 17, 25, 33, 39, 46];

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
  private engineOsc!: OscillatorNode;
  private engineSub!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private screechFilter!: BiquadFilterNode;
  private screechGain!: GainNode;
  private windGain!: GainNode;
  private rpm = 0.15;
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
    const compressor = ctx.createDynamicsCompressor();
    this.master.connect(compressor).connect(ctx.destination);

    // Engine: sawtooth + square sub-octave through a throttle-controlled lowpass.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(subGain).connect(this.engineFilter);
    this.engineOsc.start();
    this.engineSub.start();

    // Tyre screech: band-passed noise.
    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 1700;
    this.screechFilter.Q.value = 6;
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

    const freq = 38 + this.rpm * 150;
    this.engineOsc.frequency.setTargetAtTime(freq, now, 0.03);
    this.engineSub.frequency.setTargetAtTime(freq / 2, now, 0.03);
    this.engineFilter.frequency.setTargetAtTime(300 + s.throttle * 1500 + this.rpm * 900, now, 0.05);
    this.engineGain.gain.setTargetAtTime(0.12 + s.throttle * 0.1, now, 0.05);

    this.screechGain.gain.setTargetAtTime(s.skid * 0.22, now, 0.04);
    this.screechFilter.frequency.setTargetAtTime(1500 + s.skid * 500 + Math.random() * 150, now, 0.05);

    const speedRatio = Math.min(absSpeed / s.maxSpeed, 1);
    this.windGain.gain.setTargetAtTime(speedRatio * speedRatio * 0.18, now, 0.1);
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
