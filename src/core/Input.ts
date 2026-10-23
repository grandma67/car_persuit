// Keyboard state, merged with on-screen touch controls and tilt steering into one DriveInput.
import type { TiltInput } from './tilt';

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, or reverse when nearly stopped)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
}

/** Held state of the on-screen touch buttons. */
export interface TouchDrive {
  left: boolean;
  right: boolean;
  gas: boolean;
  brake: boolean;
  handbrake: boolean;
}

export class Input {
  private down = new Set<string>();
  touch: TouchDrive | null = null;
  tilt: TiltInput | null = null;
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  drive(): DriveInput {
    const t = this.touch;
    const left = this.any('KeyA', 'ArrowLeft') || !!t?.left;
    const right = this.any('KeyD', 'ArrowRight') || !!t?.right;
    return {
      throttle: this.any('KeyW', 'ArrowUp') || t?.gas ? 1 : 0,
      brake: this.any('KeyS', 'ArrowDown') || t?.brake ? 1 : 0,
      steer: Math.max(-1, Math.min(1, (right ? 1 : 0) - (left ? 1 : 0) + (this.tilt?.steer() ?? 0))),
      handbrake: this.any('Space') || !!t?.handbrake,
    };
  }

  /** B held: look behind the car. Keyboard only, so desktop only. */
  lookBack(): boolean {
    return this.down.has('KeyB');
  }

  /** H held: sound the horn. Keyboard only, so desktop only. */
  horn(): boolean {
    return this.down.has('KeyH');
  }

  /** Keys pressed since the last endFrame(), each once per press. */
  pressedKeys(): string[] {
    return [...this.pressed];
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
