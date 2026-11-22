// london.js — the London quarter east of Midtown: a meandering river and an
// organic, un-gridded street network you can actually get lost in.
//
//   • junctions are scattered unevenly (denser in the old core), then joined
//     by a proximity graph (relative-neighbourhood + some Gabriel links), so
//     blocks are irregular polygons and streets meet at odd angles
//   • sharp junction angles are pruned, short dead-end mews are sprouted
//   • a few junctions become circuses (small roundabouts with a fountain)
//   • garden squares are carved out of the network
//   • only a handful of bridges cross the river
//   • wider "high streets" are routed through the maze (shortest paths)
//   • every street bends: zero-slope sine bulges / S-curves, straightened
//     only where a curve would clip another street
//
// London uses its own RNG so adding it never reshuffles the rest of the world.
import { clamp } from "./engine.js";

export const LONDON = { x0: 770, x1: 1580, z0: -580, z1: 580 };
export const LON_CORE = { x: 1000, z: -40 };
export const RW = 20; // river half-width

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const lrand = mulberry32(18511851);
export const lrr = (a, b) => a + (b - a) * lrand();
export const lpick = (arr) => arr[Math.floor(lrand() * arr.length)];

function spline(P, step) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(P[P.length - 1].slice());
  return out;
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
// Proper intersection of segments ab and cd → t along ab, or -1.
function segHit(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? t : -1;
}

// ---------------------------------------------------------------- the river
// Enters from the north, swings east in a big bend, back west and out south.
const RIVER_CTRL = [
  [1240, 1000], [1236, 620], [1172, 440], [1250, 285], [1392, 212], [1440, 70], [1330, -36],
  [1188, -102], [1160, -252], [1268, -372], [1352, -482], [1336, -640], [1330, -1000],
];
export const river = spline(RIVER_CTRL, 4);
export const riverCum = [0];
for (let i = 1; i < river.length; i++) {
  riverCum.push(riverCum[i - 1] + Math.hypot(river[i][0] - river[i - 1][0], river[i][1] - river[i - 1][1]));
}
export function riverTangent(i) {
  const a = river[Math.max(0, i - 1)], b = river[Math.min(river.length - 1, i + 1)];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}
const RG = 24, REACH = RW + 70;
const rgrid = new Map();
const rkey = (ix, iz) => (ix + 4000) * 16384 + (iz + 4000);
for (let i = 0; i < river.length - 1; i++) {
  const [ax, az] = river[i], [bx, bz] = river[i + 1];
  for (let ix = Math.floor((Math.min(ax, bx) - REACH) / RG); ix <= Math.floor((Math.max(ax, bx) + REACH) / RG); ix++) {
    for (let iz = Math.floor((Math.min(az, bz) - REACH) / RG); iz <= Math.floor((Math.max(az, bz) + REACH) / RG); iz++) {
      const k = rkey(ix, iz);
      let c = rgrid.get(k);
      if (!c) { c = []; rgrid.set(k, c); }
      c.push(i);
    }
  }
}
// Distance from the river's centre line (999 when far away).
export function riverDist(x, z) {
  const c = rgrid.get(rkey(Math.floor(x / RG), Math.floor(z / RG)));
  if (!c) return 999;
  let best = 999;
  for (const i of c) {
    const d = segDist(x, z, river[i][0], river[i][1], river[i + 1][0], river[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}
export const inLondon = (x, z) => x >= LONDON.x0 - 10 && x <= LONDON.x1 + 40 && z > LONDON.z0 - 30 && z < LONDON.z1 + 30;

// ---------------------------------------------------------------- street network
// H: { node, edge, arcPts, linePts, eastNodes, reserved, landmarks }
export function generateLondonRoads(H) {
  const { X0, X1, Z0, Z1 } = { X0: LONDON.x0, X1: LONDON.x1, Z0: LONDON.z0, Z1: LONDON.z1 };
  const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);

  // ---- garden squares (holes the streets wrap around)
  const squares = [];
  for (let t = 0; t < 600 && squares.length < 5; t++) {
    const x = lrr(X0 + 100, X1 - 70), z = lrr(Z0 + 85, Z1 - 85);
    if (riverDist(x, z) < RW + 80) continue;
    if (squares.some((s) => Math.hypot(s.x - x, s.z - z) < 230)) continue;
    squares.push({ x, z, r: lrr(24, 33) });
  }

  // ---- junction points
  const P = [];
  const PG = 30, pgrid = new Map();
  const pk = (x, z) => rkey(Math.floor(x / PG), Math.floor(z / PG));
  const addP = (p) => {
    p.i = P.length; p.adj = [];
    P.push(p);
    const k = pk(p.x, p.z);
    if (!pgrid.has(k)) pgrid.set(k, []);
    pgrid.get(k).push(p);
    return p;
  };
  const around = (x, z, r, cb) => {
    for (let ix = Math.floor((x - r) / PG); ix <= Math.floor((x + r) / PG); ix++) {
      for (let iz = Math.floor((z - r) / PG); iz <= Math.floor((z + r) / PG); iz++) {
        const c = pgrid.get(rkey(ix, iz));
        if (c) for (const p of c) if (cb(p) === false) return false;
      }
    }
    return true;
  };
  const spacing = (x, z) => 42 + 28 * clamp(Math.hypot(x - LON_CORE.x, z - LON_CORE.z) / 450, 0, 1);

  for (const g of H.eastNodes) addP({ x: 792, z: g.z + lrr(-5, 5), gate: g });
  for (let t = 0; t < 40000; t++) {
    const x = lrr(X0 + 42, X1 - 22), z = lrr(Z0 + 22, Z1 - 22);
    if (riverDist(x, z) < RW + 24) continue;
    if (squares.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 10)) continue;
    const sp = spacing(x, z);
    const free = around(x, z, sp, (p) => (Math.hypot(p.x - x, p.z - z) < (p.gate ? 62 : sp) ? false : undefined));
    if (free) addP({ x, z });
  }

  // ---- graph: relative-neighbourhood graph + ~1/3 of the extra Gabriel links
  const E = [];
  const link = (a, b, extra = {}) => {
    const e = { a, b, len: dist(a, b), alive: true, ...extra };
    a.adj.push(e); b.adj.push(e); E.push(e);
    return e;
  };
  for (const p of P) {
    const maxL = 2.4 * spacing(p.x, p.z);
    around(p.x, p.z, maxL, (q) => {
      if (q.i <= p.i) return;
      const d = dist(p, q);
      if (d > maxL || (p.gate && q.gate)) return;
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      let gab = true, rng = true;
      around(p.x, p.z, d, (o) => {
        if (o === p || o === q) return;
        if (Math.hypot(o.x - mx, o.z - mz) < d / 2) { gab = false; return false; }
        if (Math.max(dist(o, p), dist(o, q)) < d) rng = false;
      });
      if (gab && (rng || lrand() < 0.33)) link(p, q);
    });
  }
  const alive = (e) => e.alive;
  const other = (e, p) => (e.a === p ? e.b : e.a);

  // ---- river crossings: keep a few near-perpendicular bridges, drop the rest
  const crossing = [];
  for (const e of E) {
    for (let i = 0; i < river.length - 1; i++) {
      const t = segHit(e.a.x, e.a.z, e.b.x, e.b.z, river[i][0], river[i][1], river[i + 1][0], river[i + 1][1]);
      if (t < 0) continue;
      const [tx, tz] = riverTangent(i);
      const dx = (e.b.x - e.a.x) / e.len, dz = (e.b.z - e.a.z) / e.len;
      e.cross = { s: riverCum[i], par: Math.abs(dx * tx + dz * tz), x: e.a.x + (e.b.x - e.a.x) * t, z: e.a.z + (e.b.z - e.a.z) * t };
      crossing.push(e);
      break;
    }
  }
  crossing.sort((p, q) => p.cross.par - q.cross.par);
  const bridges = [];
  for (const e of crossing) {
    if (e.cross.par > 0.45 || e.len > 150 || Math.abs(e.cross.z) > 540) continue;
    if (bridges.some((b) => Math.abs(b.cross.s - e.cross.s) < 165 || [b.a, b.b].includes(e.a) || [b.a, b.b].includes(e.b))) continue;
    e.bridge = true;
    bridges.push(e);
  }
  for (const e of crossing) if (!e.bridge) e.alive = false;

  // ---- squares: no street may cut through one
  for (const e of E) {
    if (!e.alive || e.bridge) continue;
    if (squares.some((s) => segDist(s.x, s.z, e.a.x, e.a.z, e.b.x, e.b.z) < s.r + 8)) e.alive = false;
  }

  // ---- prune junction angles under 40° (drop the longer street)
  const angOf = (p, e) => { const o = other(e, p); return Math.atan2(o.z - p.z, o.x - p.x); };
  for (let changed = true; changed;) {
    changed = false;
    for (const p of P) {
      const items = p.adj.filter(alive).map((e) => ({ e, a: angOf(p, e) }));
      if (p.gate) items.push({ e: null, a: Math.PI });
      if (items.length < 2) continue;
      items.sort((u, v) => u.a - v.a);
      for (let k = 0; k < items.length; k++) {
        const u = items[k], v = items[(k + 1) % items.length];
        const gap = v.a - u.a + (k === items.length - 1 ? Math.PI * 2 : 0);
        if (gap >= 0.7) continue;
        const opts = [u.e, v.e].filter((e) => e && !e.bridge);
        if (!opts.length) continue;
        opts.sort((x, y) => y.len - x.len)[0].alive = false;
        changed = true;
        break;
      }
    }
  }

  // ---- keep the largest connected piece
  const comp = new Map();
  let best = null, bestN = 0;
  for (const p of P) {
    if (comp.has(p) || !p.adj.some(alive)) continue;
    const id = {}, stack = [p];
    let n = 0;
    comp.set(p, id);
    while (stack.length) {
      const q = stack.pop(); n++;
      for (const e of q.adj) if (e.alive) { const o = other(e, q); if (!comp.has(o)) { comp.set(o, id); stack.push(o); } }
    }
    if (n > bestN) { bestN = n; best = id; }
  }
  for (const e of E) if (e.alive && comp.get(e.a) !== best) e.alive = false;
  const live = (p) => comp.get(p) === best && p.adj.some(alive);
  const deg = (p) => p.adj.filter(alive).length + (p.gate ? 1 : 0);

  // ---- dead-end mews sprouting into the biggest gap at a junction
  const liveEdges = () => E.filter(alive);
  let spurs = 0;
  for (let t = 0; t < 500 && spurs < 28; t++) {
    const p = lpick(P);
    if (!live(p) || p.gate || p.spur || deg(p) > 3) continue;
    const angs = p.adj.filter(alive).map((e) => angOf(p, e)).sort((a, b) => a - b);
    let gap = 0, mid = 0;
    for (let k = 0; k < angs.length; k++) {
      const g = (k === angs.length - 1 ? angs[0] + Math.PI * 2 : angs[k + 1]) - angs[k];
      if (g > gap) { gap = g; mid = angs[k] + g / 2; }
    }
    if (gap < 1.9) continue;
    const L = lrr(26, 42);
    const q = { x: p.x + Math.cos(mid) * L, z: p.z + Math.sin(mid) * L };
    if (q.x < X0 + 30 || q.x > X1 - 15 || q.z < Z0 + 15 || q.z > Z1 - 15) continue;
    if (riverDist(q.x, q.z) < RW + 18 || squares.some((s) => Math.hypot(s.x - q.x, s.z - q.z) < s.r + 14)) continue;
    let ok = true;
    for (const e of liveEdges()) {
      if (e.a === p || e.b === p) continue;
      const d1 = segDist(q.x, q.z, e.a.x, e.a.z, e.b.x, e.b.z);
      const d2 = segDist((p.x + q.x) / 2, (p.z + q.z) / 2, e.a.x, e.a.z, e.b.x, e.b.z);
      if (Math.min(d1, d2) < 27) { ok = false; break; }
    }
    if (!ok) continue;
    const qn = addP({ x: q.x, z: q.z, spur: true });
    comp.set(qn, best);
    link(p, qn, { mews: true });
    spurs++;
  }

  // ---- circuses at busy junctions
  const core = P.filter(live).sort((p, q) => Math.hypot(p.x - LON_CORE.x, p.z - LON_CORE.z) - Math.hypot(q.x - LON_CORE.x, q.z - LON_CORE.z));
  const circuses = [];
  for (const minDeg of [4, 3]) {
    for (const p of core) {
      if (circuses.length >= 4) break;
      if (p.circus || p.gate || p.spur || deg(p) < minDeg) continue;
      const es = p.adj.filter(alive);
      if (es.some((e) => e.bridge || e.mews || e.len < 52)) continue;
      if (circuses.some((c) => dist(c, p) < 210)) continue;
      p.circus = { R: 17, ring: [] };
      circuses.push(p);
    }
  }

  // ---- high streets: shortest paths through the maze
  const W8 = new Map(E.map((e) => [e, e.len * lrr(0.8, 1.3)]));
  const nearestLive = (x, z) => {
    let b = null, bd = Infinity;
    for (const p of P) if (live(p) && !p.spur) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; b = p; } }
    return b;
  };
  const route = (s, t) => {
    if (!s || !t || s === t) return;
    const D = new Map([[s, 0]]), prev = new Map(), done = new Set();
    for (;;) {
      let u = null, ud = Infinity;
      for (const [p, d] of D) if (!done.has(p) && d < ud) { ud = d; u = p; }
      if (!u || u === t) break;
      done.add(u);
      for (const e of u.adj) {
        if (!e.alive) continue;
        const o = other(e, u), nd = ud + W8.get(e);
        if (nd < (D.get(o) ?? Infinity)) { D.set(o, nd); prev.set(o, e); }
      }
    }
    for (let p = t; prev.has(p); p = other(prev.get(p), p)) prev.get(p).high = true;
  };
  const hub = core[0];
  for (const g of P) if (g.gate && live(g)) route(g, hub);
  for (const b of bridges) {
    if (!b.alive) continue;
    route(hub, b.a);
    route(b.b, nearestLive(LONDON.x1 - 20, b.b.z));
  }
  route(nearestLive(880, Z1), nearestLive(960, Z0));
  route(nearestLive(X1, Z1), nearestLive(X1 - 60, Z0));
  for (const c of circuses) route(c, hub);

  // ---- curve every street
  const curve = (e) => {
    const { a, b, len } = e;
    const n = Math.max(2, Math.ceil(len / 3));
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, s1 = Math.sin(Math.PI * t);
      const off = e.amp1 * s1 * s1 + e.amp2 * Math.sin(2 * Math.PI * t) * s1;
      pts.push([a.x + (b.x - a.x) * t + nx * off, a.z + (b.z - a.z) * t + nz * off]);
    }
    return pts;
  };
  const LE = E.filter(alive);
  for (const e of LE) {
    const straight = e.bridge || e.mews;
    const tame = lrand() < 0.2 ? 0.25 : 1;
    e.amp1 = straight ? 0 : lrr(-1, 1) * Math.min(0.09 * e.len, 8) * tame;
    e.amp2 = straight || e.len < 70 ? 0 : lrr(-1, 1) * Math.min(0.05 * e.len, 5) * tame;
    e.pts = curve(e);
    e.bb = [Math.min(...e.pts.map((p) => p[0])), Math.max(...e.pts.map((p) => p[0])), Math.min(...e.pts.map((p) => p[1])), Math.max(...e.pts.map((p) => p[1]))];
  }
  // a curve may not clip another street (or pass right beside a junction)
  const clash = (e, f) => {
    if (e.bb[1] + 14 < f.bb[0] || f.bb[1] + 14 < e.bb[0] || e.bb[3] + 14 < f.bb[2] || f.bb[3] + 14 < e.bb[2]) return false;
    const shared = e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b;
    for (let i = 0; i < e.pts.length - 1; i++) {
      for (let j = 0; j < f.pts.length - 1; j++) {
        const [a, b] = [e.pts[i], e.pts[i + 1]], [c, d] = [f.pts[j], f.pts[j + 1]];
        if (!shared && segHit(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]) >= 0) return true;
        if (!shared && segDist(a[0], a[1], c[0], c[1], d[0], d[1]) < 13) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < LE.length; i++) {
    for (let j = i + 1; j < LE.length; j++) {
      const e = LE[i], f = LE[j];
      if (!e.amp1 && !e.amp2 && !f.amp1 && !f.amp2) continue;
      if (!clash(e, f)) continue;
      for (const g of [e, f]) { g.amp1 = g.amp2 = 0; g.pts = curve(g); }
    }
  }

  // ---- emit the real road graph
  const W = { high: [12, 4], lane: [9, 3], mews: [7, 2.2], bridge: [13, 3.5] };
  const real = (p) => p.real || (p.real = H.node(p.x, p.z));
  const trimRing = (c, pts) => {
    const R = c.circus.R;
    let k = 0;
    while (k < pts.length && Math.hypot(pts[k][0] - c.x, pts[k][1] - c.z) < R) k++;
    const a = pts[k - 1], b = pts[k];
    const da = Math.hypot(a[0] - c.x, a[1] - c.z), db = Math.hypot(b[0] - c.x, b[1] - c.z);
    const t = (R - da) / (db - da);
    const ip = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const n = H.node(ip[0], ip[1]);
    n.ang = Math.atan2(ip[1] - c.z, ip[0] - c.x);
    c.circus.ring.push(n);
    return [n, [ip, ...pts.slice(k)]];
  };
  const bridgeEdges = [];
  for (const e of LE) {
    const kind = e.bridge ? "bridge" : e.mews ? "mews" : e.high ? "high" : "lane";
    let pts = e.pts, A, B;
    if (e.a.circus) [A, pts] = trimRing(e.a, pts); else A = real(e.a);
    if (e.b.circus) { let r; [B, r] = trimRing(e.b, pts.slice().reverse()); pts = r.reverse(); } else B = real(e.b);
    const re = H.edge(A, B, pts, W[kind][0], W[kind][1], kind, "london");
    if (e.bridge) { re.cross = e.cross; bridgeEdges.push(re); }
  }
  for (const c of circuses) {
    const ring = c.circus.ring.sort((p, q) => p.ang - q.ang);
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const a1 = b.ang + (k === ring.length - 1 ? Math.PI * 2 : 0);
      H.edge(a, b, H.arcPts(c.x, c.z, c.circus.R, a.ang, a1), 11, 4, "circus", "london");
    }
    H.reserved.push({ x: c.x, z: c.z, r: 7 });
  }
  // connectors from Midtown's east avenue to the London gates
  for (const g of P) {
    if (!g.gate || !live(g)) continue;
    H.edge(g.gate, real(g), H.linePts(g.gate.x, g.gate.z, g.x, g.z), 10, 4, "street", "city");
  }
  for (const s of squares) H.reserved.push({ x: s.x, z: s.z, r: s.r });
  H.landmarks.londonSquares = squares;
  H.landmarks.londonCircuses = circuses.map((c) => ({ x: c.x, z: c.z, r: c.circus.R }));
  H.landmarks.londonBridges = bridgeEdges;
}

// After the road index exists: a clock tower on the west bank next to a
// bridge, and an observation wheel on the east bank, both on clear ground.
export function placeLondonLandmarks(roadDist, reserved, landmarks) {
  const bridgePts = landmarks.londonBridges.map((b) => b.cross);
  const bankPoint = (i, east, off) => {
    const [tx, tz] = riverTangent(i);
    let nx = -tz, nz = tx;
    if ((nx > 0) !== east) { nx = -nx; nz = -nz; }
    return { x: river[i][0] + nx * off, z: river[i][1] + nz * off, tx, tz, nx, nz };
  };
  const okZ = (p) => Math.abs(p.z) < 470 && p.x > LONDON.x0 + 40 && p.x < LONDON.x1 - 30;

  let clock = null, cs = Infinity;
  for (let i = 0; i < river.length; i += 2) {
    const p = bankPoint(i, false, RW + 13);
    if (!okZ(p) || roadDist(p.x, p.z) < 6 || riverDist(p.x, p.z) < RW + 9) continue;
    const db = Math.min(...bridgePts.map((b) => Math.hypot(b.x - p.x, b.z - p.z)));
    const score = Math.abs(db - 45);
    if (score < cs) { cs = score; clock = p; }
  }
  if (clock) {
    reserved.push({ x: clock.x, z: clock.z, r: 11 });
    landmarks.clockTower = clock;
  }

  let wheel = null, ws = Infinity;
  for (let i = 0; i < river.length; i += 2) {
    const p = bankPoint(i, true, RW + 10);
    if (!okZ(p)) continue;
    if (clock && Math.hypot(clock.x - p.x, clock.z - p.z) < 140) continue;
    let ok = true;
    for (const k of [-28, -14, 0, 14, 28]) {
      const x = p.x + p.tx * k, z = p.z + p.tz * k;
      const rd = riverDist(x, z);
      if (roadDist(x, z) < 7 || rd < RW + 4 || rd > RW + 22) { ok = false; break; }
    }
    if (!ok) continue;
    const score = Math.hypot(p.x - LON_CORE.x, p.z - LON_CORE.z);
    if (score < ws) { ws = score; wheel = p; }
  }
  if (wheel) {
    for (const k of [-28, -14, 0, 14, 28]) reserved.push({ x: wheel.x + wheel.tx * k, z: wheel.z + wheel.tz * k, r: 11 });
    landmarks.wheel = wheel;
  }
}
