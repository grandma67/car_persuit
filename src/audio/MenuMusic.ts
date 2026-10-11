// Synthwave loops (menu, win screen): soft pad chords, a plucked bass and a 16th-note arpeggio.
// Scheduled slightly ahead on the audio clock so timing stays tight regardless of frame rate.

export interface Song {
  bpm: number;
  chords: number[][]; // MIDI notes (root, third, fifth), one bar each
  arp: number[]; // index into chord tones; 3 = root an octave up
  kickEvery: number; // in 16th notes
  padCutoff: number; // Hz; higher is brighter
}

/** Gentle and moody: Am – F – C – G. */
export const MENU_SONG: Song = {
  bpm: 96,
  chords: [
    [57, 60, 64],
    [53, 57, 60],
    [60, 64, 67],
    [55, 59, 62],
  ],
  arp: [0, 1, 2, 1, 2, 3, 2, 1],
  kickEvery: 8,
  padCutoff: 900,
};

/** Upbeat victory lap: C – G – F – G, rising arpeggio and a four-on-the-floor kick. */
export const WIN_SONG: Song = {
  bpm: 124,
  chords: [
    [60, 64, 67],
    [55, 59, 62],
    [53, 57, 60],
    [55, 59, 62],
  ],
  arp: [0, 1, 2, 3, 2, 3, 1, 3],
  kickEvery: 4,
  padCutoff: 1800,
};

const STEPS_PER_CHORD = 16;
const LOOKAHEAD = 0.2; // seconds of notes scheduled ahead

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class MenuMusic {
  private out: GainNode;
  private padFilter: BiquadFilterNode;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;

  private readonly stepLength: number; // a 16th note, seconds

  constructor(private ctx: AudioContext, destination: AudioNode, private song: Song = MENU_SONG) {
    this.stepLength = 60 / song.bpm / 4;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = song.padCutoff;
    this.padFilter.connect(this.out);
  }

  /** Fade in, starting `delay` seconds from now. */
  start(delay = 0): void {
    if (this.timer !== null) return;
    const now = this.ctx.currentTime + delay;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0.5, now + 1.5);
    this.nextTime = now + 0.05;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  stop(): void {
    if (this.timer === null) return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 0.8);
    const timer = this.timer;
    this.timer = null;
    window.setTimeout(() => window.clearInterval(timer), 900);
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % (STEPS_PER_CHORD * this.song.chords.length);
      this.nextTime += this.stepLength;
    }
  }

  private playStep(step: number, t: number): void {
    const { chords, arp, kickEvery } = this.song;
    const chord = chords[Math.floor(step / STEPS_PER_CHORD)];
    const inChord = step % STEPS_PER_CHORD;

    if (inChord === 0) for (const n of chord) this.pad(midi(n - 12), t, this.stepLength * STEPS_PER_CHORD);
    if (inChord % 4 === 0) this.bass(midi(chord[0] - 24), t);
    if (inChord % kickEvery === 0) this.kick(t);
    const tone = arp[inChord % arp.length];
    this.pluck(midi(tone === 3 ? chord[0] + 12 : chord[tone]), t, inChord % 2 === 0 ? 0.07 : 0.045);
  }

  private voice(type: OscillatorType, freq: number, t: number, attack: number, hold: number, release: number, level: number, to: AudioNode): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    osc.connect(g).connect(to);
    osc.start(t);
    osc.stop(t + attack + hold + release + 0.05);
  }

  private pad(freq: number, t: number, length: number): void {
    // Two slightly detuned saws per note give a wide, soft pad.
    for (const detune of [-0.004, 0.004]) this.voice('sawtooth', freq * (1 + detune), t, 0.4, length - 0.6, 0.8, 0.025, this.padFilter);
  }

  private bass(freq: number, t: number): void {
    this.voice('triangle', freq, t, 0.005, 0.05, 0.25, 0.18, this.out);
  }

  private pluck(freq: number, t: number, level: number): void {
    this.voice('triangle', freq, t, 0.004, 0.0, 0.22, level, this.out);
  }

  private kick(t: number): void {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.15);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}
