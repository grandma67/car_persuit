// The witch house and its boardwalk, as merged vertex-coloured parts (the district structures'
// settings). The house: posts up to a floor over the island, a weathered ground storey, a skewed
// upper storey hanging over it, a steep four-sided shingle roof bent off true with patches, a
// chimney twisting as it climbs, crooked and round windows (glow panes), a porch with a lean-to
// roof, hanging bottles and herb bundles, a broom by the door and a cauldron. The boardwalk: loose
// planks on two stringers and posts, following the deck's height. No new shader programs.
import * as THREE from 'three';
import { SWAMP } from '../../gameplay/balance';
import { deckHeight, deckPoint, type Deck } from '../../world/Deck';
import { groundHeight, type Terrain } from '../../world/Terrain';
import type { Structure } from '../../world/districts/District';
import { part } from '../geometry';

const WOOD_DARK = 0x4a3d30;
const WOOD = 0x655242;
const WOOD_GREY = 0x6a665a;
const PLANK = 0x7a6248;
const PLANK_DARK = 0x5a4836;
const ROTTEN = 0x5c5a46;
const SHINGLE = 0x38323e;
const PATCHES = [0x5a4632, 0x4a5638, 0x6a5a4a];
const BRICK = 0x5e4636;
const IRON = 0x1e2022;
const FRAME = 0x2a221a;
const DOOR = 0x2c2018;
const STRAW = 0xb89a5a;
const BOTTLES = [0x3a7a4a, 0x6a3a7a, 0x7a5a2a, 0x2a5a7a, 0x5a8a3a];
const HERBS = [0x6a7a3a, 0x7a6a3a, 0x5a6a4a];
const MUD = 0x4d4232;
const SNOW = 0xe8ecf0;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
/** A box without the faces named (BoxGeometry's order: px nx py ny pz nz), for faces never seen. */
const openBox = (w: number, h: number, d: number, drop: ('px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz')[]) => {
  const g = new THREE.BoxGeometry(w, h, d);
  const all = Array.from(g.index!.array);
  g.setIndex(['px', 'nx', 'py', 'ny', 'pz', 'nz'].flatMap((f, k) => (drop.includes(f as never) ? [] : all.slice(k * 6, k * 6 + 6))));
  g.clearGroups();
  return g;
};
/**
 * A deck plank: no front and back faces (the 7 cm edges facing the next plank across a 6 cm gap:
 * never seen), 8 triangles instead of 12. Its underside stays: the shadow pass draws back faces, so
 * the plank's shadow comes from it.
 */
const plank = (w: number, h: number, d: number) => openBox(w, h, d, ['pz', 'nz']);

/** A glowing pane: where, which way it faces (yaw), its size, round or not, a crooked tilt. */
export interface Pane {
  pos: THREE.Vector3;
  yaw: number;
  w: number;
  h: number;
  round: boolean;
  tilt: number;
}

export interface WitchParts {
  solid: THREE.BufferGeometry[];
  panes: Pane[];
  cauldron: THREE.Vector3; // the brew's surface
}

/** A tiny repeatable random stream from the house's seed. */
const stream = (seed: number) => {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

/** The house in its local frame (+Z the porch side, y = 0 the island's ground), then placed. */
export function witchHouse(s: Structure, y: number, snowy: boolean): WitchParts {
  const d = s.data as { w: number; d: number; porch: number; stilts: number; h: number; chimneySide: number; patches: number; seed: number };
  const W = d.w, D = d.d, P = d.porch, S = d.stilts;
  const rnd = stream(d.seed);
  const g: THREE.BufferGeometry[] = [];
  const panes: Pane[] = [];
  const floor = S + 0.11; // the floor's top
  const g1 = 3.3; // the ground storey's height
  const g2 = 3.0;
  // Posts under the floor and the porch, each leaning its own way.
  for (const u of [-W / 2 + 0.3, 0, W / 2 - 0.3]) {
    for (const v of [-D / 2 + 0.3, 0, D / 2 - 0.3, D / 2 + P - 0.3]) {
      const post = box(0.24, S + 0.5, 0.24).rotateZ((rnd() - 0.5) * 0.12).rotateX((rnd() - 0.5) * 0.12);
      g.push(part(post, WOOD_GREY, u, (S + 0.5) / 2 - 0.45, v));
    }
  }
  // The floor and porch deck.
  g.push(part(box(W + 0.3, 0.22, D + P), PLANK_DARK, 0, S, P / 2));
  // Steps down from the porch's front, in the middle.
  for (let k = 0; k < 3; k++) {
    const h = S - (k + 1) * (S / 4);
    g.push(part(box(1.6, 0.14, 0.38), PLANK, 0, h, D / 2 + P + 0.2 + k * 0.36));
  }
  // The ground storey (upright) with corner battens.
  g.push(part(box(W, g1, D), WOOD_DARK, 0, floor + g1 / 2, 0));
  for (const u of [-1, 1]) for (const v of [-1, 1]) g.push(part(box(0.16, g1, 0.16), WOOD_GREY, u * (W / 2 + 0.02), floor + g1 / 2, v * (D / 2 + 0.02)));
  // The upper storey: wider, shifted and leaning (its front and back faces stay square to Z).
  const side = d.chimneySide;
  const up = floor + g1 + g2 / 2;
  const upper = box(W + 0.5, g2, D + 0.4).rotateZ(-0.045 * side);
  g.push(part(upper, WOOD, 0.25 * side, up, 0));
  g.push(part(box(W + 0.7, 0.18, D + 0.6), WOOD_GREY, 0.2 * side, floor + g1 + 0.05, 0)); // the jetty beam between them
  // The roof: a steep four-sided cone, its top bent sideways.
  const y0 = floor + g1 + g2 + 0.05;
  const H = 5.2;
  const bw = (W + 1.1) / 2, bd = (D + 0.9) / 2;
  const roof = new THREE.ConeGeometry(Math.SQRT2, H, 4, 3).rotateY(Math.PI / 4).scale(bw, 1, bd).translate(0, H / 2, 0);
  const pos = roof.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + Math.pow(pos.getY(i) / H, 2) * 1.1 * side);
  g.push(part(roof, snowy ? SNOW : SHINGLE, 0.25 * side, y0, 0));
  // Patches on the front and back faces (lying on the slope, a little proud).
  const slope = Math.atan2(H, bd);
  for (let k = 0; k < d.patches; k++) {
    const t = 0.15 + rnd() * 0.4, face = k % 2 ? -1 : 1;
    const x = (rnd() - 0.5) * bw * (1 - t) + Math.pow(t, 2) * 1.1 * side + 0.25 * side;
    const p = box(0.9 + rnd() * 0.5, 0.05, 0.7).rotateX(face * slope);
    g.push(part(p, snowy ? 0xcfd4da : PATCHES[k % PATCHES.length], x, y0 + H * t + 0.06, face * (bd * (1 - t) + 0.05)));
  }
  // The chimney: brick blocks turning as they climb out of the roof's side.
  const cx = -side * (W / 2 - 0.9), cz = -D / 4;
  for (let k = 0; k < 6; k++) {
    const blk = box(0.75, 0.95, 0.75).rotateY(k * 0.22).rotateZ(-side * 0.04 * k);
    g.push(part(blk, BRICK, cx - side * k * 0.07, y0 - 0.6 + k * 0.9, cz));
  }
  g.push(part(box(0.95, 0.16, 0.95).rotateY(6 * 0.22), IRON, cx - side * 0.45, y0 - 0.6 + 6 * 0.9 - 0.35, cz));
  // The door, ajar a crack, and its frame.
  g.push(part(box(1.3, 2.3, 0.08), FRAME, 0.7, floor + 1.15, D / 2 + 0.04));
  g.push(part(box(1.05, 2.1, 0.08).rotateY(0.25), DOOR, 0.62, floor + 1.05, D / 2 + 0.2));
  // Windows: two crooked ones by the door, one on each side, a round one up front, one up back.
  const pane = (u: number, v: number, yy: number, w: number, h: number, yaw: number, round: boolean, tilt: number, depth: number) => {
    const n = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const frame = round ? cyl(w / 2 + 0.12, w / 2 + 0.12, 0.06, 14).rotateX(Math.PI / 2) : box(w + 0.22, h + 0.22, 0.06).rotateZ(tilt);
    g.push(part(frame.rotateY(yaw), FRAME, u + n.x * (depth + 0.03), yy, v + n.z * (depth + 0.03)));
    panes.push({ pos: new THREE.Vector3(u + n.x * (depth + 0.075), yy, v + n.z * (depth + 0.075)), yaw, w, h, round, tilt });
  };
  pane(-1.9, D / 2, floor + 1.7, 0.95, 1.15, 0, false, 0.12, 0);
  pane(-W / 2, -0.6, floor + 1.6, 0.9, 1.0, -Math.PI / 2, false, -0.1, 0);
  pane(W / 2, 0.8, floor + 1.7, 0.8, 1.1, Math.PI / 2, false, 0.14, 0);
  pane(0.25 * side, (D + 0.4) / 2, up, 1.1, 1.1, 0, true, 0, 0);
  pane(0.25 * side - 1.2, -(D + 0.4) / 2, up + 0.2, 0.8, 0.9, Math.PI, false, -0.15, 0);
  // The porch's lean-to roof on two posts, sloping down to the front.
  const pr = floor + 2.6;
  g.push(part(box(W + 0.3, 0.12, P + 0.4).rotateX(0.2), snowy ? SNOW : SHINGLE, 0, pr, D / 2 + P / 2 + 0.1));
  for (const u of [-1, 1]) g.push(part(box(0.16, pr - floor + 0.1, 0.16), WOOD_GREY, u * (W / 2 - 0.1), floor + (pr - floor) / 2 - 0.15, D / 2 + P - 0.1));
  // Hanging bottles and herb bundles along the porch roof's front edge (not over the steps).
  const edge = D / 2 + P + 0.1, hang = pr - 0.28;
  for (let k = 0; k < 7; k++) {
    const u = -W / 2 + 0.5 + k * ((W - 1) / 6);
    if (Math.abs(u) < 1) continue;
    const len = 0.35 + rnd() * 0.35;
    g.push(part(box(0.02, len, 0.02), FRAME, u, hang - len / 2, edge - 0.15));
    if (k % 2) g.push(part(cyl(0.07, 0.09, 0.28, 6), BOTTLES[k % BOTTLES.length], u, hang - len - 0.14, edge - 0.15));
    else g.push(part(new THREE.ConeGeometry(0.16, 0.42, 6).rotateX(Math.PI), HERBS[k % HERBS.length], u, hang - len - 0.2, edge - 0.15));
  }
  // A broom leaning by the door.
  g.push(part(cyl(0.03, 0.03, 1.5, 5).rotateZ(-0.25), WOOD, 1.75, floor + 0.85, D / 2 + 0.25));
  g.push(part(new THREE.ConeGeometry(0.2, 0.5, 7).rotateZ(-0.25), STRAW, 1.58, floor + 0.2, D / 2 + 0.25));
  // A low railing along the porch's front, open at the steps.
  for (const u of [-1, 1]) {
    g.push(part(box(W / 2 - 1, 0.08, 0.08), WOOD_GREY, u * (W / 4 + 0.5), floor + 0.85, D / 2 + P - 0.12));
    g.push(part(box(0.1, 0.9, 0.1), WOOD_GREY, u * 1, floor + 0.45, D / 2 + P - 0.12));
  }
  // The cauldron on the porch: a round iron pot on three legs, a thick rim.
  const ca = new THREE.Vector3(-(W / 2 - 1.0), floor, D / 2 + P / 2);
  g.push(part(new THREE.SphereGeometry(0.55, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.95, 1), IRON, ca.x, ca.y + 0.65, ca.z));
  g.push(part(new THREE.TorusGeometry(0.53, 0.07, 5, 14).rotateX(Math.PI / 2), IRON, ca.x, ca.y + 0.66, ca.z));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    g.push(part(box(0.08, 0.3, 0.08), IRON, ca.x + Math.cos(a) * 0.35, ca.y + 0.15, ca.z + Math.sin(a) * 0.35));
  }
  // Place everything.
  const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), new THREE.Vector3(1, 1, 1));
  for (const p of g) p.applyMatrix4(m);
  for (const p of panes) {
    p.pos.applyMatrix4(m);
    p.yaw += s.yaw;
  }
  return { solid: g, panes, cauldron: new THREE.Vector3(ca.x, ca.y + 0.62, ca.z).applyMatrix4(m) };
}

/** The island: a mud disc over the bog (2 cm above its patch), roots poking out round its shore. */
export function witchIsland(x: number, z: number, y: number, snowy: boolean, seed: number): THREE.BufferGeometry[] {
  const I = SWAMP.witchIsland;
  const rnd = stream(seed ^ 0x51);
  const g = [part(new THREE.CircleGeometry(I, 28).rotateX(-Math.PI / 2), snowy ? SNOW : MUD, x, y + 0.09, z)];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + rnd() * 0.3;
    const root = cyl(0.06, 0.12, 1.4, 5).rotateZ(1.1).rotateY(-a);
    g.push(part(root, WOOD_DARK, x + Math.cos(a) * (I + 0.1), y + 0.15, z + Math.sin(a) * (I + 0.1)));
  }
  return g;
}

/** The boardwalk: loose planks following the deck's surface, two stringers, posts down into the water. */
export function boardwalk(d: Deck, terrain: Terrain, snowy: boolean, seed: number): THREE.BufferGeometry[] {
  const rnd = stream(seed ^ 0xb0a);
  const g: THREE.BufferGeometry[] = [];
  const W = d.hx * 2;
  const step = 0.34;
  const [r0, r1] = d.ramps;
  const place = (geo: THREE.BufferGeometry, color: number, u: number, y: number, v: number) => {
    const p = deckPoint(d, u, v);
    g.push(part(geo.rotateY(d.yaw), color, p.x, y, p.z));
  };
  for (let v = -d.hz + step / 2; v < d.hz; v += step) {
    const flat = v > -d.hz + r0 && v < d.hz - r1;
    if (flat && rnd() < 0.03) continue; // a missing plank
    const y = deckHeight(d, terrain, v);
    const ahead = deckHeight(d, terrain, Math.min(d.hz, v + 0.1)) - deckHeight(d, terrain, Math.max(-d.hz, v - 0.1));
    const tilt = -Math.atan2(ahead, 0.2);
    const roll = flat ? (rnd() - 0.5) * 0.03 : 0;
    const colour = snowy ? SNOW : [PLANK, PLANK_DARK, ROTTEN][Math.floor(rnd() * 3)];
    place(plank(W - (rnd() * 0.2), 0.07, 0.28).rotateX(tilt).rotateZ(roll), colour, (rnd() - 0.5) * 0.1, y - 0.04, v);
  }
  // Stringers under the flat run, posts in pairs (no foot face: it stands 30 cm into the mud).
  const v0 = -d.hz + r0, v1 = d.hz - r1;
  const top = deckHeight(d, terrain, 0);
  for (const u of [-1, 1]) place(box(0.14, 0.2, v1 - v0), WOOD_GREY, u * (d.hx - 0.2), top - 0.18, (v0 + v1) / 2);
  for (let v = v0 + 0.3; v <= v1; v += 2.4) {
    for (const u of [-1, 1]) {
      const p = deckPoint(d, u * (d.hx - 0.15), v);
      const foot = groundHeight(terrain, p.x, p.z) - 0.3, head = top - 0.25; // into the mud, up to the stringers
      place(openBox(0.16, head - foot, 0.16, ['ny']).rotateZ((rnd() - 0.5) * 0.1), WOOD_GREY, u * (d.hx - 0.15), (head + foot) / 2, v);
    }
  }
  return g;
}

const frameOf = (x: number, y: number, z: number, yaw: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));

/** The landing's rotting jetty: loose planks (a few gone, some sagging) on crooked posts. Local Z along it. */
export function swampJetty(s: Structure, y: number, snowy: boolean): THREE.BufferGeometry[] {
  const L = s.data!.length as number, W = s.data!.width as number, H = s.data!.height as number;
  const rnd = stream((s.data!.seed as number) ?? 1);
  const g: THREE.BufferGeometry[] = [];
  for (let z = -L / 2 + 0.17; z < L / 2; z += 0.34) {
    if (z > -L / 2 + 1 && rnd() < 0.08) continue;
    const sag = -Math.pow((z + L / 2) / L, 2) * 0.12; // droops towards the far end
    g.push(part(box(W - rnd() * 0.25, 0.07, 0.28).rotateZ((rnd() - 0.5) * 0.06), snowy ? SNOW : [PLANK, PLANK_DARK, ROTTEN][Math.floor(rnd() * 3)], (rnd() - 0.5) * 0.1, H - 0.035 + sag, z));
  }
  for (const x of [-1, 1]) g.push(part(box(0.14, 0.18, L), WOOD_GREY, x * (W / 2 - 0.15), H - 0.16, 0));
  for (let z = -L / 2 + 0.4; z <= L / 2; z += 2.3) {
    for (const x of [-1, 1]) g.push(part(cyl(0.11, 0.13, H + 0.9, 6).rotateZ((rnd() - 0.5) * 0.12), WOOD_GREY, x * (W / 2 - 0.1), (H + 0.9) / 2 - 0.5, z));
  }
  const m = frameOf(s.x, y, s.z, s.yaw);
  return g.map((p) => p.applyMatrix4(m));
}

const ALU = 0xa8aeb2;
const CAGE = 0x3a3e42;

/** An airboat: a flat aluminium hull, a raised seat, an engine and a big caged propeller at the stern. Local +Z the bow. */
export function airboat(s: Structure, y: number, frozen: boolean): THREE.BufferGeometry[] {
  const g: THREE.BufferGeometry[] = [];
  const hull = box(2.3, 0.45, 4.6);
  const pos = hull.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > 0 && pos.getY(i) < 0) pos.setY(i, pos.getY(i) + Math.max(0, pos.getZ(i) - 1.4) * 0.25); // the bow rises
  g.push(part(hull, ALU, 0, 0.22, 0));
  g.push(part(box(2.35, 0.08, 4.65), 0x2a5a7a, 0, 0.42, 0)); // a painted gunwale stripe
  g.push(part(box(0.9, 0.12, 0.8), 0x3a3a3a, 0, 1.25, -0.9)); // the seat up on its frame
  for (const x of [-0.35, 0.35]) for (const z of [-1.2, -0.6]) g.push(part(box(0.06, 0.8, 0.06), CAGE, x, 0.85, z));
  g.push(part(box(0.7, 0.6, 0.8), 0x5a2a22, 0, 0.75, -1.65)); // the engine
  // The propeller cage: a ring of struts round a two-blade prop.
  const cz = -2.15, cy = 1.35;
  g.push(part(new THREE.TorusGeometry(0.95, 0.04, 4, 16), CAGE, 0, cy, cz));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    g.push(part(box(1.9, 0.03, 0.03).rotateZ(a), CAGE, 0, cy, cz - 0.05));
  }
  g.push(part(box(1.7, 0.16, 0.05).rotateZ(0.6), 0x8a6a4a, 0, cy, cz + 0.08));
  for (const x of [-0.6, 0.6]) g.push(part(box(0.05, 1.0, 0.05), CAGE, x, 0.95, cz + 0.2));
  const m = frameOf(s.x, y + (frozen ? 0.05 : -0.12), s.z, s.yaw);
  return g.map((p) => p.applyMatrix4(m));
}

/** A half-sunk log: a long trunk lying in the water, one end lower, a stub of a branch, the cut end pale. */
export function sunkLog(s: Structure, y: number): THREE.BufferGeometry[] {
  const L = s.data!.length as number, sink = s.data!.sink as number;
  const tilt = 0.08;
  const g = [
    part(cyl(0.32, 0.38, L, 8).rotateX(Math.PI / 2 + tilt), WOOD_DARK, 0, 0.38 - sink, 0),
    part(cyl(0.3, 0.3, 0.03, 8).rotateX(Math.PI / 2 + tilt), 0xb89a72, 0, 0.38 - sink + Math.sin(tilt) * (L / 2), L / 2 + 0.01),
    part(cyl(0.06, 0.11, 0.8, 5).rotateZ(0.9), WOOD_DARK, 0.35, 0.6 - sink, -L / 5),
  ];
  const m = frameOf(s.x, y, s.z, s.yaw);
  return g.map((p) => p.applyMatrix4(m));
}
