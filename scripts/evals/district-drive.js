// A district's driving check in one run, for the district forced on in the URL:
//   npm run check:browser -- --query "seed=N&debug&<kind>=1" --start 2000 --out-dir <dir> \
//     --no-final --eval-file scripts/evals/district-drive.js
// Police off, stats and FPS first. Then (1) a 5★ chase in through the first gate under an overhead
// piece (else gate 0): car and cops sampled every 1.2 s, cops that sat still twice running more than
// 30 m from the player listed as `stuck`. (2) Every gate driven in from 70 m out at speed (30 m/s,
// `&gateSpeed=`), gates under an overhead first. (3) Each off-road drivable rect (corridors, lots,
// fields; at most `&drives=6`) end to end along its long side from just inside. The car is repaired
// before every drive. Per drive: top speed, and `hit` (what stood there) if it stopped inside what
// it was testing, `exit` if it only stopped past the end, `stuck` if it never got going. Shots:
// `chase`, and `hit-<n>` where each drive stopped. Stops on traffic or a 5★ roadblock are expected:
// read `near` before blaming the district.
(async () => {
  const params = new URLSearchParams(location.search);
  const kinds = ['oldtown', 'chinatown', 'harbor', 'farm', 'slums'];
  const kind = kinds.find((k) => params.get(k) === '1');
  const q = dbg.district(kind);
  if (!q) return { error: `no ${kind ?? 'district'} placed on this seed` };
  await dbg.police(false);
  const out = { kind: q.kind, stats: dbg.stats(), fps: await dbg.fps(2000) };
  const speeds = (r) => r.samples.split(' | ').map((s) => parseFloat(s.split(' ')[1]) || 0);
  const near = (h) => h.near.slice(0, 3).map((n) => `${n.what}@${n.d}`);
  let shots = 0;
  /** A drive's row: `inside(p)` says whether a stop at p is inside what's being tested. */
  const report = async (what, r, inside) => {
    const top = Math.max(...speeds(r));
    const row = { what, top };
    if (top < 2) row.stuck = { at: r.start, near: near({ near: dbg.near(r.start.x, r.start.z, 6) }) };
    else if (r.hit) row[inside(r.hit.at) ? 'hit' : 'exit'] = { at: r.hit.at, speedBefore: r.hit.speedBefore, near: near(r.hit) };
    if (row.hit || row.stuck) await shot(`hit-${shots++}`);
    row.health = dbg.repair();
    return row;
  };
  // Gates under an overhead piece that crosses their road (a deck, an arch, a wire across), first.
  const crosses = (g) => {
    const ax = Math.sin(g.yaw), az = Math.cos(g.yaw); // along the road in
    return [...new Set(q.dressing.overhead.filter((o) => o.points.some((p, i) => {
      const n = o.points[(i + 1) % o.points.length];
      const side = (pt) => (pt.x - g.x) * az - (pt.z - g.z) * ax; // across the road
      const ahead = (pt) => (pt.x - g.x) * ax + (pt.z - g.z) * az;
      return o.points.length > 1 && side(p) * side(n) < 0 && Math.abs((ahead(p) + ahead(n)) / 2) < 30;
    })).map((o) => o.kind))].join(',');
  };
  // Big pieces (decks, arches, gantries) before wires and lines.
  const rank = (over) => (!over ? 0 : over.split(',').some((k) => k !== 'wire' && k !== 'laundry') ? 2 : 1);
  const order = q.gates.map((g, i) => ({ g, i, over: crosses(g) })).sort((a, b) => rank(b.over) - rank(a.over));

  // (1) The chase, while the car is whole.
  dbg.repair();
  const first = order[0];
  await dbg.police(true);
  await dbg.gate(first.i, { back: 80, speed: 25, kind: q.kind, wait: 300 });
  await dbg.stars(5);
  const cops = () => game.director.cops.map((c) => ({ x: Math.round(c.vehicle.position.x), z: Math.round(c.vehicle.position.z), s: +c.vehicle.speed.toFixed(1) }));
  const samples = [];
  for (let k = 0; k < 8; k++) {
    await dbg.hold('KeyW', 1200);
    samples.push({ car: dbg.car(), cops: cops() });
  }
  await shot('chase');
  const stuck = [];
  for (let k = 1; k < samples.length; k++) {
    const car = samples[k].car;
    for (const c of samples[k].cops) {
      const before = samples[k - 1].cops.find((o) => Math.hypot(o.x - c.x, o.z - c.z) < 1.5);
      if (before && Math.abs(c.s) < 1 && Math.abs(before.s) < 1 && Math.hypot(c.x - car.x, c.z - car.z) > 30) stuck.push({ at: [c.x, c.z], sample: k });
    }
  }
  out.chase = { gate: first.i, car: samples.map((s) => `${s.car.x},${s.car.z} ${s.car.speed}m/s`).join(' | '), copsMax: Math.max(...samples.map((s) => s.cops.length)), stuck };
  await dbg.police(false);
  dbg.repair();

  // (2) Every gate, in from 70 m out.
  const speed = Number(params.get('gateSpeed') ?? 30);
  out.gates = [];
  for (const { g, i, over } of order) {
    const ix = Math.sin(g.yaw), iz = Math.cos(g.yaw);
    // The longest run-up that still starts on the gate's own street (not round a corner on the ring road).
    // and clear of roadworks.
    const back = [70, 50, 35, 20].find((b) => {
      const p = dbg.road(g.x - ix * b, g.z - iz * b);
      return Math.abs((p.x - g.x) * iz - (p.z - g.z) * ix) < 3 && !dbg.near(p.x, p.z, 8).some((n) => n.what.startsWith('roadworks:'));
    }) ?? 20;
    const r = await dbg.drive({ from: { x: g.x - ix * back, z: g.z - iz * back }, yaw: g.yaw, speed, ms: 4500 });
    // A stop counts until 40 m in past the gate line.
    out.gates.push(await report(`gate ${i}${over ? ` (under ${over})` : ''}, ${back} m run-up`, r, (p) => (p.x - g.x) * ix + (p.z - g.z) * iz < 40));
  }

  // (3) Off-road drivable rects, end to end.
  out.drivable = [];
  for (const r of q.dressing.drivable.slice(0, Number(params.get('drives') ?? 6))) {
    const alongX = r.w > r.d, len = alongX ? r.w : r.d;
    const from = alongX ? { x: r.x - len / 2 + 2, z: r.z } : { x: r.x, z: r.z - len / 2 + 2 };
    const res = await dbg.drive({ from, yaw: alongX ? Math.PI / 2 : 0, speed: 15, ms: Math.min(8000, (len / 18) * 1000 + 1500), snap: false });
    const inside = (p) => Math.abs(p.x - r.x) <= r.w / 2 - 1 && Math.abs(p.z - r.z) <= r.d / 2 - 1;
    out.drivable.push(await report(`${Math.round(r.w)}x${Math.round(r.d)} at ${Math.round(r.x)},${Math.round(r.z)}`, res, inside));
  }
  return out;
})()
