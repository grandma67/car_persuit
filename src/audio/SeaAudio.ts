// Water you can hear: surf breaking against the quay when you drive along the shore, and a quieter
// slap and gurgle beside a canal. Filtered noise, no samples. The surf follows the swell the sea
// shader draws (see swellAtWall), so each crash lands with the splash you see at the wall.

/** Metres from the water at which each sound fades in. */
const SEA_RANGE = 80;
const CANAL_RANGE = 40;
const WASH_DRAIN = 1.4; // seconds the foam fizz takes to die away after a crest breaks

export interface WaterSound {
  sea: number; // metres to the quay edge
  surge: number; // 0..1, the swell arriving at the nearest bit of wall
  canal: number; // metres to canal water
}

export class SeaAudio {
  private surfFilter: BiquadFilterNode;
  private surfGain: GainNode;
  private washGain: GainNode;
  private lapFilter: BiquadFilterNode;
  private lapGain: GainNode;
  private wash = 0;
  private t = 0;

  constructor(
    private ctx: AudioContext,
    master: GainNode,
    loopNoise: () => AudioBufferSourceNode,
  ) {
    // Surf: the low roar of a breaking crest; the filter opens as it hits.
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = 'lowpass';
    this.surfFilter.Q.value = 0.4;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    loopNoise().connect(this.surfFilter).connect(this.surfGain).connect(master);

    // Wash: the hiss of foam draining back off the wall, trailing each crest.
    const washFilter = ctx.createBiquadFilter();
    washFilter.type = 'bandpass';
    washFilter.frequency.value = 2400;
    washFilter.Q.value = 0.5;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    loopNoise().connect(washFilter).connect(this.washGain).connect(master);

    // Canal: small wavelets slapping the quay wall, a hollow narrow-band gurgle.
    this.lapFilter = ctx.createBiquadFilter();
    this.lapFilter.type = 'bandpass';
    this.lapFilter.Q.value = 2.5;
    this.lapGain = ctx.createGain();
    this.lapGain.gain.value = 0;
    loopNoise().connect(this.lapFilter).connect(this.lapGain).connect(master);
  }

  /** Call every frame; `on` false fades everything out (menu, paused engine). */
  update(dt: number, w: WaterSound, on: boolean): void {
    const now = this.ctx.currentTime;
    this.t += dt;
    const near = (d: number, range: number) => (on ? Math.max(0, 1 - d / range) ** 2 : 0);
    const sea = near(w.sea, SEA_RANGE);
    const canal = near(w.canal, CANAL_RANGE);

    // Foam builds as the crest hits and drains slowly after it.
    this.wash = Math.max(w.surge, this.wash - dt / WASH_DRAIN);
    this.surfGain.gain.setTargetAtTime(sea * (0.08 + 0.42 * w.surge), now, 0.08);
    this.surfFilter.frequency.setTargetAtTime(220 + 900 * w.surge, now, 0.08);
    this.washGain.gain.setTargetAtTime(sea * (0.01 + 0.07 * this.wash), now, 0.1);

    // Irregular lapping: two slow waves beating so the slaps don't tick like a clock.
    const lap = 0.5 + 0.5 * Math.sin(this.t * 2.3 + Math.sin(this.t * 0.7) * 1.6);
    this.lapGain.gain.setTargetAtTime(canal * (0.03 + 0.12 * lap * lap), now, 0.06);
    this.lapFilter.frequency.setTargetAtTime(380 + 260 * lap, now, 0.06);
  }
}
