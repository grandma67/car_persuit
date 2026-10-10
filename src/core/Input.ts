// Keyboard state. Touch controls (M7) will feed the same DriveInput.

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, or reverse when nearly stopped)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
}

export class Input {
  private down = new Set<string>();
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
    const left = this.any('KeyA', 'ArrowLeft');
    const right = this.any('KeyD', 'ArrowRight');
    return {
      throttle: this.any('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.any('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake: this.any('Space'),
    };
  }

  /** True once per key press; call endFrame() after reading. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
