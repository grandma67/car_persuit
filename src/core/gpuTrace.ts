// GPU leak hunting (?gputrace): which textures, geometries, materials and render targets the
// renderer still holds, each named by its three.js id and the game code that created it, with the
// meshes still pointing at it. Exposed as `window.gpuTrace`; see knowledge/LEAKS.md.
//
// How: three.js registers a 'dispose' listener on a resource exactly when it uploads it to the GPU
// and drops it when the resource is disposed, so those listeners are the live set. The creation
// site comes from a setter on `uuid`, which every constructor (and clone) assigns first thing.
// Install before the game builds anything; objects made at import time show as "before trace".
import * as THREE from 'three';

type Kind = 'texture' | 'geometry' | 'material' | 'target';
type Resource = THREE.Texture | THREE.BufferGeometry | THREE.Material | THREE.RenderTarget;

export interface GpuEntry {
  /** e.g. "texture#12 CanvasTexture 512×512 \"atlas\"" */
  label: string;
  kind: Kind;
  id: number;
  /** The game code that created it: up to two `function file:line` frames, innermost first. */
  site: string;
  /** Meshes that still reference it (only what GC hasn't collected), each with its own site. */
  users: string[];
}

const sites = new WeakMap<object, string>();
const live = new Set<Resource>();
const meshes = new Set<WeakRef<THREE.Object3D>>(); // drawables and lights, to name a resource's users
let installed = false;

function kindOf(o: object): Kind | null {
  if (o instanceof THREE.Texture) return 'texture';
  if (o instanceof THREE.BufferGeometry) return 'geometry';
  if (o instanceof THREE.Material) return 'material';
  if (o instanceof THREE.RenderTarget) return 'target';
  return null;
}

/** The first two stack frames in the game's own source (not three.js, not this file). */
function creationSite(): string {
  const V8 = Error as { stackTraceLimit?: number }; // Chrome's: frames kept in a stack
  const limit = V8.stackTraceLimit;
  V8.stackTraceLimit = 30;
  const stack = new Error().stack ?? '';
  V8.stackTraceLimit = limit;
  const frames = stack
    .split('\n')
    .filter((l) => l.includes('/src/') && !l.includes('gpuTrace'))
    .slice(0, 2)
    .map((l) => {
      const m = /at (?:new )?(\S+)? ?\(?.*\/src\/([^?:)]+)(?:\?[^:]*)?:(\d+)/.exec(l);
      return m ? `${m[1] && !m[1].startsWith('http') ? m[1] + ' ' : ''}${m[2]}:${m[3]}` : l.trim();
    });
  return frames.join(' < ') || 'unknown';
}

/** A `uuid` setter on the prototype runs inside the constructor: note the site, then store it on the instance. */
function traceCreation(proto: object, onCreate?: (o: object) => void): void {
  Object.defineProperty(proto, 'uuid', {
    configurable: true,
    set(this: object, value: string) {
      Object.defineProperty(this, 'uuid', {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      sites.set(this, creationSite());
      onCreate?.(this);
    },
  });
}

export function installGpuTrace(): void {
  if (installed) return;
  installed = true;
  for (const proto of [THREE.Texture.prototype, THREE.BufferGeometry.prototype, THREE.Material.prototype]) traceCreation(proto);
  traceCreation(THREE.Object3D.prototype, (o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Sprite || o instanceof THREE.Points || o instanceof THREE.Line || o instanceof THREE.Light) {
      meshes.add(new WeakRef(o));
    }
  });
  // RenderTarget has no uuid: its site is taken when the renderer first uploads it.
  const add = THREE.EventDispatcher.prototype.addEventListener;
  const dispatch = THREE.EventDispatcher.prototype.dispatchEvent;
  THREE.EventDispatcher.prototype.addEventListener = function (this: object, type: string, listener: never) {
    if (type === 'dispose' && kindOf(this)) {
      live.add(this as Resource);
      if (!sites.has(this)) sites.set(this, creationSite());
    }
    return add.call(this, type as never, listener);
  } as typeof add;
  THREE.EventDispatcher.prototype.dispatchEvent = function (this: object, event: { type: string }) {
    if (event.type === 'dispose') live.delete(this as Resource);
    return dispatch.call(this, event as never);
  } as typeof dispatch;
  (window as unknown as { gpuTrace: typeof gpuTrace }).gpuTrace = gpuTrace;
}

function describe(r: Resource): string {
  const kind = kindOf(r)!;
  const id = (r as { id?: number }).id;
  const name = (r as { name?: string }).name ? ` "${(r as { name: string }).name}"` : '';
  let detail = r.constructor.name;
  if (r instanceof THREE.Texture) {
    const img = r.image as { width?: number; height?: number } | undefined;
    if (img?.width) detail += ` ${img.width}×${img.height}`;
  } else if (r instanceof THREE.BufferGeometry) {
    detail += ` ${r.getAttribute('position')?.count ?? 0} verts`;
  } else if (r instanceof THREE.RenderTarget) {
    detail += ` ${r.width}×${r.height}`;
  }
  return `${kind}${id === undefined ? '' : '#' + id} ${detail}${name}`;
}

function meshLabel(o: THREE.Object3D): string {
  let root = o;
  while (root.parent) root = root.parent;
  const where = root instanceof THREE.Scene ? 'in a scene' : 'detached';
  return `${o.type}#${o.id}${o.name ? ` "${o.name}"` : ''} ${where} (${sites.get(o) ?? 'before trace'})`;
}

/** What a mesh draws with: its geometry, materials, their textures (and the render targets behind them). */
function resourcesOf(o: THREE.Object3D, targets: Map<THREE.Texture, THREE.RenderTarget>): unknown[] {
  if (o instanceof THREE.Light) {
    const map = (o as THREE.DirectionalLight).shadow?.map; // a shadow-casting light's map and its depth
    return [map, map?.depthTexture];
  }
  const mesh = o as THREE.Mesh;
  if (!mesh.geometry) return [];
  const out: unknown[] = [mesh.geometry];
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    out.push(m);
    if (!m) continue;
    const uniforms = [...Object.values((m as THREE.ShaderMaterial).uniforms ?? {}), ...Object.values(m.userData.uniforms ?? {})] as THREE.IUniform[];
    const values = [...Object.values(m), ...uniforms.map((u) => u.value)];
    for (const v of values) if (v instanceof THREE.Texture) out.push(v, targets.get(v));
  }
  return out;
}

/** Meshes (still alive) that use each live resource, at most 3 named per resource. */
function usersOf(): Map<Resource, string[]> {
  const targets = new Map([...live].filter((r) => r instanceof THREE.RenderTarget).map((t) => [t.texture, t]));
  const users = new Map<Resource, string[]>();
  for (const ref of meshes) {
    const o = ref.deref();
    if (!o) {
      meshes.delete(ref);
      continue;
    }
    for (const r of resourcesOf(o, targets)) {
      if (!r || !live.has(r as Resource)) continue;
      const list = users.get(r as Resource) ?? [];
      if (list.length < 3) list.push(meshLabel(o));
      users.set(r as Resource, list);
    }
  }
  return users;
}

function entries(resources: Resource[]): GpuEntry[] {
  const users = usersOf();
  return resources.map((r) => ({
    label: describe(r),
    kind: kindOf(r)!,
    id: (r as { id?: number }).id ?? -1,
    site: sites.get(r) ?? 'before trace',
    users: users.get(r) ?? [],
  }));
}

export const gpuTrace: {
  live(): GpuEntry[];
  mark(): Set<Resource>;
  since(mark: Set<Resource>): GpuEntry[];
  orphans(roots: THREE.Object3D[]): GpuEntry[];
  bySite(entries?: GpuEntry[]): { site: string; kind: Kind; count: number }[];
} = {
  /** Everything the renderer holds now. */
  live(): GpuEntry[] {
    return entries([...live]);
  },
  /** The live set now, to compare against later with `since`. */
  mark(): Set<Resource> {
    return new Set(live);
  },
  /** What has been uploaded since `mark` and is still held. */
  since(mark: Set<Resource>): GpuEntry[] {
    return entries([...live].filter((r) => !mark.has(r)));
  },
  /**
   * Held by the renderer but drawn by nothing under `roots` (pass the game's scene): after a
   * restart, the leaks. Module caches made once and reused (sign atlases…) show here too.
   */
  orphans(roots: THREE.Object3D[]): GpuEntry[] {
    const targets = new Map([...live].filter((r) => r instanceof THREE.RenderTarget).map((t) => [t.texture, t]));
    const used = new Set<unknown>();
    for (const root of roots) root.traverse((o) => resourcesOf(o, targets).forEach((r) => used.add(r)));
    return entries([...live].filter((r) => !used.has(r)));
  },
  /** Live counts per creation site and kind, most first. */
  bySite(entries = gpuTrace.live()): { site: string; kind: Kind; count: number }[] {
    const counts = new Map<string, { site: string; kind: Kind; count: number }>();
    for (const e of entries) {
      const key = `${e.kind} ${e.site}`;
      const c = counts.get(key) ?? { site: e.site, kind: e.kind, count: 0 };
      c.count++;
      counts.set(key, c);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  },
};
