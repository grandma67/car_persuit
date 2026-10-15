// Debug helpers for headless browser checks (exposed as `window.dbg` with ?debug): put the car on
// a road with something in view, find a district's pieces, drive, and measure. Used from
// `npm run check:browser -- --eval …`; see CLAUDE.md.
import type { CityData, Rect } from '../world/CityGenerator';
import type { District, DistrictKind } from '../world/districts/District';
import { inRect } from '../world/lots';
import type { Game } from './Game';

type P = { x: number; z: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CAMERA_BACK = 7; // the chase camera sits about this far behind the car

/** Only what the helpers need from the (private) game internals. */
interface Internals {
  city: CityData;
  player: { teleport(x: number, y: number, z: number, yaw: number, speed?: number): void; position: P & { y: number }; speed: number };
  ground: (x: number, z: number) => number;
  renderer: { info: { programs: unknown[] | null; render: { calls: number; triangles: number } } };
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
      return { programs: g.renderer.info.programs?.length ?? 0, calls, triangles, staticTris: Math.round(staticTris) };
    },
    /** The car's position and speed. */
    car: () => ({ x: Math.round(g.player.position.x), z: Math.round(g.player.position.z), speed: +g.player.speed.toFixed(1) }),
  };
  return api;
}
