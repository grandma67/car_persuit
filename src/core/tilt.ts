// Tilt steering: the phone held like a steering wheel. deviceorientation gives the phone's
// attitude as Euler angles; from them the "up" direction in the phone's own frame, turned into the
// screen's frame (portrait or either landscape), and its sideways part is how far the phone is
// rolled. That holds whether the phone is held upright or tipped back towards flat.
import { TILT } from '../gameplay/balance';

const RAD = Math.PI / 180;

/** Roll of the screen in degrees, positive turned clockwise (steer right). */
export function screenRoll(beta: number, gamma: number, screenAngle: number): number {
  const b = beta * RAD;
  const g = gamma * RAD;
  // World up in the device frame (x right, y top, z out of the screen, in portrait).
  const ux = -Math.sin(g) * Math.cos(b);
  const uy = Math.sin(b);
  const a = screenAngle * RAD;
  const sx = ux * Math.cos(a) - uy * Math.sin(a); // up along the screen's current right
  return Math.asin(Math.max(-1, Math.min(1, -sx))) / RAD;
}

/** Steer -1..1 from a roll in degrees: dead zone, then linear to full lock. */
export function tiltSteer(rollDeg: number, cfg = TILT): number {
  const over = Math.abs(rollDeg) - cfg.deadZone;
  if (over <= 0) return 0;
  return Math.sign(rollDeg) * Math.min(1, over / (cfg.fullLock - cfg.deadZone));
}

type PermissionEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export function tiltSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/**
 * iOS asks the player before a page reads the sensors; the ask must come from a tap. Elsewhere
 * there is nothing to ask. Resolves whether tilt may be read.
 */
export async function requestTiltPermission(): Promise<boolean> {
  const ev = (window as { DeviceOrientationEvent?: PermissionEvent }).DeviceOrientationEvent;
  if (!ev) return false;
  if (typeof ev.requestPermission !== 'function') return true;
  try {
    return (await ev.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Listens to the sensor while enabled; `steer` is the smoothed value, 0 when off or without data. */
export class TiltInput {
  private roll = 0;
  private target = 0;
  private enabled = false;
  private last = 0;

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    const angle = screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
    this.target = screenRoll(e.beta, e.gamma, angle);
  };

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.roll = this.target = 0;
    if (on) window.addEventListener('deviceorientation', this.onOrientation);
    else window.removeEventListener('deviceorientation', this.onOrientation);
  }

  get active(): boolean {
    return this.enabled;
  }

  steer(): number {
    if (!this.enabled) return 0;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.roll += (this.target - this.roll) * (1 - Math.exp(-TILT.smoothing * dt));
    return tiltSteer(this.roll);
  }
}
