// Debug helpers for headless browser checks (exposed as `window.dbg` with ?debug): put the car on
// a road with something in view, find a district's pieces, drive, and measure. Used from
// `npm run check:browser -- --eval …`; see CLAUDE.md.
import type { CityData, Rect } from '../world/CityGenerator';
import type { District, DistrictKind } from '../world/districts/District';
import { inRect } from '../world/lots';
import type { Game } from './Game';
import { createStudio, type StudioShot } from './debugStudio';

type P = { x: number; z: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CAMERA_BACK = 7; // the chase camera sits about this far behind the car

/** Only what the helpers need from the (private) game internals. */
interface Internals {
  city: CityData;
  player: {
    teleport(x: number, y: number, z: number, yaw: number, speed?: number): void;
    position: P & { y: number };
    speed: number;
    body: { rotation(): { x: number; y: number; z: number; w: number } };
  };
  policeOff: boolean;
  director: { cops: { vehicle: { position: P } }[] };
  ground: (x: number, z: number) => number;
  renderer: { info: { programs: unknown[] | null; render: { calls: number; triangles: number } } };
  overview: boolean;
  overviewCamera(): { position: { set(x: number, y: number, z: number): void }; lookAt(x: number, y: number, z: number): void; near: number; updateProjectionMatrix(): void };
  debugView: unknown;
  health: { repair(share: number): number; destroyed: boolean; ratio: number };
  scene: { traverse(f: (o: { isMesh?: boolean; isInstancedMesh?: boolean; geometry?: { index: { count: number } | null; attributes: { position: { count: number } } } }) => void): void };
}

export function debugTools(game: Game) {
  const g = game as unknown as Internals;
  const city = () => g.city;
  let roadPoints: P[] | null = null;
  /** Points every 4 m along every road's centre line and on every junction. */
  const roads = () =>
    (roadPoints ??= [
      ...city().roads.flatMap(({ rect: r }) => {
        const alongX = r.w > r.d;
        const len = alongX ? r.w : r.d;
        return Array.from({ length: Math.max(1, Math.floor(len / 4)) }, (_, i) => {
          const t = -len / 2 + 2 + i * 4;
          return alongX ? { x: r.x + t, z: r.z } : { x: r.x, z: r.z + t };
        });
      }),
      ...city().intersections.map((r) => ({ x: r.x, z: r.z })),
    ]);
  /** Everything solid that blocks a view: buildings and district solids, minus what holds `target`. */
  const blockers = (target: P): Rect[] =>
    [
      ...city().buildings,
      ...city().districts.flatMap((q) => q.dressing.solids.map((s) => ({ x: s.x, z: s.z, w: s.hx * 2, d: s.hz * 2 }))),
    ].filter((r) => !inRect(r, target, 1));
  const clear = (a: P, b: P, walls: Rect[]) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
      if (walls.some((r) => inRect(r, p, 0.3))) return false;
    }
    return true;
  };
  const at = (t: P | [number, number]): P => (Array.isArray(t) ? { x: t[0], z: t[1] } : t);
  let aerialUsed = false;
  const studio = createStudio(city);

  const api = {
    sleep,
    city,
    /** A placed district (the first, or of this kind). */
    district: (kind?: DistrictKind): District | undefined => city().districts.find((q) => !kind || q.kind === kind),
    /** Put the car at (x, z) facing yaw (0 = +Z), optionally already moving. */
    place(x: number, z: number, yaw: number, speed = 0) {
      g.player.teleport(x, g.ground(x, z) + 1.2, z, yaw, speed);
      return { x, z, yaw };
    },
    /**
     * Frame a point: put the car on a road as near `dist` m away as it can (8–120 m), facing it,
     * where neither the car's nor the camera's line to it crosses a building or a wall. Waits for
     * the camera to settle. Returns where it stood, or null if no road spot sees it.
     */
    async view(target: P | [number, number], { dist = 25, wait = 1200 } = {}) {
      const t = at(target);
      const walls = blockers(t);
      const spots = roads()
        .map((p) => ({ p, d: Math.hypot(p.x - t.x, p.z - t.z) }))
        .filter(({ d }) => d > 8 && d < 120)
        .sort((a, b) => Math.abs(a.d - dist) - Math.abs(b.d - dist));
      for (const { p, d } of spots) {
        const cam = { x: p.x - ((t.x - p.x) / d) * CAMERA_BACK, z: p.z - ((t.z - p.z) / d) * CAMERA_BACK };
        if (walls.some((r) => inRect(r, cam, 0.5)) || !clear(p, t, walls) || !clear(cam, p, walls)) continue;
        api.place(p.x, p.z, Math.atan2(t.x - p.x, t.z - p.z));
        await sleep(wait);
        return { x: Math.round(p.x), z: Math.round(p.z), dist: Math.round(d) };
      }
      return null;
    },
    /**
     * Look at a point from above (the overview camera, C), from `dist` m away on the side `from`
     * (a heading, default the camera's south-west) and `height` m up. `false` goes back to the chase.
     */
    async aerial(target: P | [number, number] | false, { dist = 90, height = 60, from = Math.PI * 1.25, look = 8, wait = 600 } = {}) {
      const on = target !== false;
      if (on) aerialUsed = true;
      if (g.overview !== on) await api.hold('KeyC', 50);
      if (!on) return;
      const t = at(target);
      const cam = g.overviewCamera();
      // A near plane of 1 m: at 10 m (the overview's own) a roof close to the lens is cut into
      // stray triangles that look like broken geometry.
      cam.near = 1;
      cam.updateProjectionMatrix();
      cam.position.set(t.x + Math.sin(from) * dist, g.ground(t.x, t.z) + height, t.z + Math.cos(from) * dist);
      cam.lookAt(t.x, g.ground(t.x, t.z) + look, t.z);
      await sleep(wait);
    },
    /**
     * The studio: prop models, vehicles, zone and district lot buildings on a plain floor, labelled, away from the
     * city (names: `dumpster`, prefixes like `wreck-`, tints `couch~6a3a2a`, lots `lot:slums/tenement`
     * or `lot:slums/tenement@18`). Returns what it laid out; `false` closes it. Then `studioShot`.
     */
    async studio(names: string[] | false) {
      // The HUD (toasts, minimap, speed) hides while the studio is up.
      const hud: HTMLElement[] = [];
      for (let el: Element | null = document.querySelector('canvas'); el && el !== document.body; el = el.parentElement) {
        for (const sib of el.parentElement?.children ?? []) if (sib !== el) hud.push(sib as HTMLElement);
      }
      if (names === false) {
        studio.close();
        g.debugView = null;
        for (const el of hud) el.style.visibility = '';
        return null;
      }
      for (const el of hud) el.style.visibility = 'hidden';
      const laid = studio.open(names);
      studio.shoot();
      g.debugView = studio.view();
      await sleep(300);
      return laid;
    },
    /** Aim the studio camera: the whole grid, or `focus` (an item's index), `from` an angle (radians). */
    async studioShot(shot: StudioShot = {}) {
      const name = studio.shoot(shot);
      await sleep(150);
      return name;
    },
    /** Patch the car back to full health between test drives (a wreck stays wrecked). Returns the health share now. */
    repair() {
      g.health.repair(1);
      return g.health.destroyed ? 0 : +g.health.ratio.toFixed(2);
    },
    /** Police on or off (O toggles; this sets it). */
    async police(on: boolean) {
      if (g.policeOff === on) await api.hold('KeyO', 50);
    },
    /** The nearest road centre-line point (or junction) to (x, z): a safe place to start a drive. */
    road(x: number, z: number): P {
      return roads().reduce((best, p) => (Math.hypot(p.x - x, p.z - z) < Math.hypot(best.x - x, best.z - z) ? p : best));
    },
    /**
     * Everything within r m of (x, z): district structures and solids, landmarks, street props and
     * buildings, nearest first. For "what did the car hit?".
     */
    near(x: number, z: number, r = 6) {
      const c = city();
      const d = (p: P) => Math.round(Math.hypot(p.x - x, p.z - z) * 10) / 10;
      const out: { what: string; d: number; x: number; z: number }[] = [];
      for (const q of c.districts) {
        for (const s of q.dressing.structures) for (const f of s.footprints) if (Math.hypot(f.x - x, f.z - z) < r + Math.hypot(f.hx, f.hz)) out.push({ what: `${q.kind}:${s.kind}`, d: d(f), x: f.x, z: f.z });
      }
      for (const l of c.landmarks) if (d(l) < r + l.radius) out.push({ what: `landmark:${l.kind}`, d: d(l), x: l.x, z: l.z });
      for (const p of c.streetProps) if (d(p) < r) out.push({ what: `prop:${p.kind}${p.style ? '-' + p.style : ''}`, d: d(p), x: p.x, z: p.z });
      for (const b of c.buildings) if (inRect(b, { x, z }, r)) out.push({ what: `building:${b.lot ?? b.zone}`, d: d(b), x: b.x, z: b.z });
      for (const site of c.roadworks) for (const it of site.items) if (d(it) < r + Math.max(it.hw, it.hl)) out.push({ what: `roadworks:${it.kind}`, d: d(it), x: it.x, z: it.z });
      return out.sort((a, b) => a.d - b.d).slice(0, 20);
    },
    /**
     * Drive: put the car on the road nearest `from` (never off it: a start on a sidewalk or in a
     * lot snags kerbs and clutter), heading `yaw`, at `speed`, then hold W for `ms`, sampling every
     * `every` ms. Stops early on a hit (speed halves in one sample) and reports what was there.
     * Police are switched off unless `police`.
     */
    async drive({ from, yaw, speed = 15, ms = 6000, every = 250, police = false, snap = true }: { from: P | [number, number]; yaw: number; speed?: number; ms?: number; every?: number; police?: boolean; snap?: boolean }) {
      await api.police(police);
      const start = snap ? api.road(at(from).x, at(from).z) : at(from);
      api.place(start.x, start.z, yaw, speed);
      const samples: { x: number; z: number; speed: number; tilt: number }[] = [];
      let hit: { at: P; speedBefore: number; near: ReturnType<typeof api.near> } | null = null;
      for (let t = 0; t < ms; t += every) {
        await api.hold('KeyW', every);
        const p = g.player.position;
        const r = g.player.body.rotation();
        const tilt = Math.round((Math.asin(Math.min(1, 2 * Math.hypot(r.x, r.z) * Math.abs(r.w))) * 180) / Math.PI);
        const s = { x: Math.round(p.x), z: Math.round(p.z), speed: +g.player.speed.toFixed(1), tilt };
        const prev = samples[samples.length - 1];
        samples.push(s);
        if (prev && prev.speed > 6 && s.speed < prev.speed / 2) {
          hit = { at: { x: s.x, z: s.z }, speedBefore: prev.speed, near: api.near(p.x, p.z, 5) };
          break;
        }
      }
      return { start, samples: samples.map((s) => `${s.x},${s.z} ${s.speed}m/s${s.tilt > 15 ? ` tilt${s.tilt}` : ''}`).join(' | '), hit };
    },
    /** Line up `back` m outside a district gate, facing in (optionally moving). */
    async gate(i = 0, { back = 30, speed = 0, lateral = 0, kind = undefined as DistrictKind | undefined, wait = 1200 } = {}) {
      const g0 = api.district(kind)?.gates[i];
      if (!g0) return null;
      const ix = Math.sin(g0.yaw), iz = Math.cos(g0.yaw);
      api.place(g0.x - ix * back + iz * lateral, g0.z - iz * back - ix * lateral, g0.yaw, speed);
      await sleep(wait);
      return g0;
    },
    /** First landmark, structure, district prop or street prop of a kind (in a district, if any). */
    find(kind: string): (P & { kind: string }) | undefined {
      const c = city();
      return (
        c.landmarks.find((l) => l.kind === kind) ??
        c.districts.flatMap((q) => q.dressing.structures).find((s) => s.kind === kind) ??
        c.streetProps.find((p) => p.kind === kind) ??
        c.buildings.filter((b) => b.lot === kind).map((b) => ({ ...b, kind }))[0]
      );
    },
    /** Hold a key (KeyW, KeyK …) for ms. */
    async hold(code: string, ms = 100) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      await sleep(ms);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    },
    /** Raise the wanted level by n stars. */
    async stars(n = 5) {
      for (let i = 0; i < n; i++) (await api.hold('KeyK', 60), await sleep(60));
    },
    /** Frames per second over ms of real time. */
    async fps(ms = 3000) {
      let frames = 0;
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const tick = () => (frames++, performance.now() - t0 < ms ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      });
      return +(frames / ((performance.now() - t0) / 1000)).toFixed(1);
    },
    /** Shader programs, draw calls and triangles this frame, and the scene's static triangles. */
    stats() {
      let staticTris = 0;
      g.scene.traverse((o) => {
        if (o.isMesh && !o.isInstancedMesh && o.geometry) staticTris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      });
      const { calls, triangles } = g.renderer.info.render;
      // The overview camera turns the fog off, which recompiles every material: programs read high
      // for the rest of the run. Measure before any aerial().
      const warn = aerialUsed ? 'aerial() ran: fog was off, programs not comparable' : undefined;
      return { programs: g.renderer.info.programs?.length ?? 0, calls, triangles, staticTris: Math.round(staticTris), ...(warn ? { warn } : {}) };
    },
    /** The car's position and speed. */
    car: () => ({ x: Math.round(g.player.position.x), z: Math.round(g.player.position.z), speed: +g.player.speed.toFixed(1) }),
  };
  return api;
}
