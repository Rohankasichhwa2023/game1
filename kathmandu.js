// kathmandu.js — Kathmandu, north of Midtown: an organically grown street
// network modelled on a real Kathmandu street map.
//
//   • a few wide arterials: a long SW→NE diagonal that meets a north road and a
//     south-east road at a big star junction, two north-south arterials and a
//     cross road; they link to Midtown's avenues and to Paris
//   • collector roads branch off the arterials (and cross what they meet)
//   • then hundreds of narrow lanes (galli) are grown: each sprouts from an
//     existing street, wanders a little and ends in a T-junction where it runs
//     into another street (sometimes crossing it), or as a dead end. Some come
//     in parallel "ladders" (the grid-like residential patches on the map).
//     Lanes are densest in the old core and thin out toward the edges.
//   • open squares (tole) with pagoda temples, and Durbar Square with the
//     palace complex, are kept clear; lanes stop at their edges
//
// Streets are grown as polylines; every T-junction / crossing records a joint
// on both streets, and at the end each street is cut at its joints into the
// real road graph (roads.js nodes / edges). Kathmandu has its own RNG so it
// never reshuffles the rest of the world.
import { clamp } from "./engine.js";

export const KTM = { x0: -140, x1: 520, z0: 620, z1: 1140 };
export const KTM_CORE = { x: 200, z: 900 };
export const inKathmandu = (x, z) => x >= KTM.x0 && x <= KTM.x1 && z >= KTM.z0 && z <= KTM.z1;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const krand = mulberry32(977271);
export const krr = (a, b) => a + (b - a) * krand();
export const kpick = (arr) => arr[Math.floor(krand() * arr.length)];

// width, sidewalk — a compact town: even the main roads are narrow, and the
// lanes (galli) are alleys barely wider than a car
export const KTM_WIDTH = { artery: [9, 2.2], collector: [7, 1.4], galli: [4.6, 0.8] };

// ---------------------------------------------------------------- geometry helpers
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
// Intersection of segments ab and cd → [t along ab, u along cd] or null.
function segHit(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t > 1e-3 && t <= 1 && u >= -1e-6 && u <= 1 + 1e-6 ? [t, clamp(u, 0, 1)] : null;
}
const polyLen = (P) => { let l = 0; for (let i = 1; i < P.length; i++) l += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return l; };

// ---------------------------------------------------------------- streets + spatial index
const streets = [];    // { pts, cum, len, kind, a, b, joints: [{ s, J }] }
const SG = 24, sgrid = new Map();
const skey = (ix, iz) => (ix + 4000) * 16384 + (iz + 4000);
let stamp = 0;
function junction(x, z, node = null) { return { x, z, node }; }
function indexSeg(st, i) {
  const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1];
  const item = { st, i, stamp: 0 };
  for (let ix = Math.floor(Math.min(ax, bx) / SG); ix <= Math.floor(Math.max(ax, bx) / SG); ix++) {
    for (let iz = Math.floor(Math.min(az, bz) / SG); iz <= Math.floor(Math.max(az, bz) / SG); iz++) {
      const k = skey(ix, iz);
      let c = sgrid.get(k);
      if (!c) { c = []; sgrid.set(k, c); }
      c.push(item);
    }
  }
}
function forSegs(x0, z0, x1, z1, cb) {
  stamp++;
  for (let ix = Math.floor(x0 / SG); ix <= Math.floor(x1 / SG); ix++) {
    for (let iz = Math.floor(z0 / SG); iz <= Math.floor(z1 / SG); iz++) {
      const c = sgrid.get(skey(ix, iz));
      if (!c) continue;
      for (const it of c) { if (it.stamp === stamp) continue; it.stamp = stamp; cb(it); }
    }
  }
}
// First street the segment a→b runs into (nearest along it), or null.
function firstHit(ax, az, bx, bz) {
  let best = null;
  forSegs(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (it) => {
    const [cx, cz] = it.st.pts[it.i], [dx, dz] = it.st.pts[it.i + 1];
    const r = segHit(ax, az, bx, bz, cx, cz, dx, dz);
    if (r && (!best || r[0] < best.t)) best = { t: r[0], u: r[1], st: it.st, i: it.i };
  });
  if (best) { best.x = ax + (bx - ax) * best.t; best.z = az + (bz - az) * best.t; }
  return best;
}
// Nearest street point within r (skip(n) can veto a candidate), or null.
function nearestSeg(x, z, r, skip) {
  let best = null;
  if (r <= 0) return null;
  forSegs(x - r, z - r, x + r, z + r, (it) => {
    const [ax, az] = it.st.pts[it.i], [bx, bz] = it.st.pts[it.i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const u = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const px = ax + dx * u, pz = az + dz * u, d = Math.hypot(x - px, z - pz);
    if (d >= r || (best && d >= best.d)) return;
    const n = { d, st: it.st, i: it.i, u, x: px, z: pz };
    if (skip && skip(n)) return;
    best = n;
  });
  return best;
}
const arcAt = (st, i, u) => st.cum[i] + u * (st.cum[i + 1] - st.cum[i]);
function pointAt(st, s) {
  let i = 0;
  while (i < st.cum.length - 2 && st.cum[i + 1] < s) i++;
  const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1];
  const l = st.cum[i + 1] - st.cum[i] || 1, u = clamp((s - st.cum[i]) / l, 0, 1);
  return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, tx: (bx - ax) / l, tz: (bz - az) / l };
}
// Junction on street st at arc length s: reuse an end / joint close by.
function attach(st, s, x, z) {
  if (s < 10) return st.a;
  if (st.len - s < 10) return st.b;
  for (const j of st.joints) if (Math.abs(j.s - s) < 10) return j.J;
  const J = junction(x, z);
  st.joints.push({ s, J });
  return J;
}
function commit(pts, kind, a, b) {
  pts[0] = [a.x, a.z];
  if (b) pts[pts.length - 1] = [b.x, b.z];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const last = pts[pts.length - 1];
  const st = { pts, cum, len: cum[cum.length - 1], kind, a, b: b || junction(last[0], last[1]), joints: [] };
  streets.push(st);
  for (let i = 0; i < pts.length - 1; i++) indexSeg(st, i);
  return st;
}

// ---------------------------------------------------------------- tracing a fixed route
// Walks a predetermined path; every street it crosses becomes a junction (the
// route carries on), or with stopAtHit: n it ends in a T at the n-th one.
function trace(path, kind, a, o = {}) {
  let start = a, cur = [[a.x, a.z]], k = 1, guard = 0, hits = 0;
  while (k < path.length && guard++ < 8000) {
    const [px, pz] = cur[cur.length - 1], [qx, qz] = path[k];
    if (Math.hypot(qx - px, qz - pz) < 0.5) { k++; continue; }
    const h = firstHit(px, pz, qx, qz);
    if (h) {
      const J = attach(h.st, arcAt(h.st, h.i, h.u), h.x, h.z);
      if (J === start) { cur.push([qx, qz]); k++; continue; }
      cur.push([J.x, J.z]);
      commit(cur, kind, start, J);
      if (o.stopAtHit && ++hits >= o.stopAtHit) return J;
      start = J; cur = [[J.x, J.z]];
      continue;
    }
    cur.push([qx, qz]); k++;
  }
  const end = o.end || null;
  if (end) {
    const l = cur[cur.length - 1];
    if (Math.hypot(l[0] - end.x, l[1] - end.z) < 0.5) cur.pop();
    cur.push([end.x, end.z]);
  }
  if (cur.length >= 2 && polyLen(cur) > 3) return commit(cur, kind, start, end).b;
  return start;
}

// ---------------------------------------------------------------- growing a street
const reservedK = [];   // squares + Durbar Square: lanes stop at their edge
const insideK = (x, z, m) => x > KTM.x0 + m && x < KTM.x1 - m && z > KTM.z0 + m && z < KTM.z1 - m;
const blockedK = (x, z) => reservedK.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + 3);
let galliLen = 0;

// from: { J } an existing junction, or { st, s } a point on a street.
// o: { len, curve, gap, through, minDead, minLink, step }
function grow(from, heading, kind, o) {
  let x, z;
  if (from.J) { x = from.J.x; z = from.J.z; } else { const p = pointAt(from.st, from.s); x = p.x; z = p.z; }
  const step = o.step || 6, pts = [[x, z]];
  let h = heading, tr = 0, len = 0, hit = null;
  // ignore streets right at the start point (the one we sprout from / cross)
  const nearStart = (n) => len < 30 && Math.hypot(n.x - x, n.z - z) < 16;
  while (len < o.len) {
    if (o.curve) { tr = clamp(tr + krr(-1, 1) * o.curve, -o.curve * 2.5, o.curve * 2.5); h += tr; }
    const [px, pz] = pts[pts.length - 1];
    const qx = px + Math.sin(h) * step, qz = pz + Math.cos(h) * step;
    if (!insideK(qx, qz, 10) || blockedK(qx, qz)) break;
    const fh = firstHit(px, pz, qx, qz);
    if (fh) { hit = fh; break; }
    if (len > 8) {
      const n = nearestSeg(qx, qz, o.gap, nearStart);
      if (n) {
        // heading into it → run on into it (a T); alongside it → stop short (dead end)
        const dx = n.x - qx, dz = n.z - qz, dl = Math.hypot(dx, dz) || 1;
        if ((Math.sin(h) * dx + Math.cos(h) * dz) / dl > 0.55) {
          pts.push([qx, qz]); len += step;
          hit = firstHit(qx, qz, n.x + (dx / dl) * 0.6, n.z + (dz / dl) * 0.6);
        }
        break;
      }
    }
    pts.push([qx, qz]); len += step;
  }
  if (hit) {
    // a very oblique meeting makes a sliver junction: stop short instead
    const [cx, cz] = hit.st.pts[hit.i], [dx, dz] = hit.st.pts[hit.i + 1];
    const sl = Math.hypot(dx - cx, dz - cz) || 1;
    const [lx, lz] = pts[pts.length - 1];
    let ax = hit.x - lx, az = hit.z - lz, al = Math.hypot(ax, az);
    if (al < 0.01) { ax = Math.sin(h); az = Math.cos(h); al = 1; }
    if (Math.abs((ax * (dz - cz) - az * (dx - cx)) / (al * sl)) < 0.5) hit = null;
    else len += Math.hypot(hit.x - lx, hit.z - lz);
  }
  if (len < (hit ? o.minLink ?? 14 : o.minDead ?? 24) || pts.length < 2 && !hit) return null;
  const Ja = from.J || attach(from.st, from.s, x, z);
  let Jb = null;
  if (hit) {
    Jb = attach(hit.st, arcAt(hit.st, hit.i, hit.u), hit.x, hit.z);
    if (Jb === Ja) return null;
    pts.push([Jb.x, Jb.z]);
  }
  const st = commit(pts, kind, Ja, Jb);
  if (kind === "galli") galliLen += st.len;
  // sometimes carry straight on across the street we met (a crossroads)
  if (hit && o.through && krand() < o.through) {
    grow({ J: Jb }, h, kind, { ...o, len: o.len * krr(0.5, 1), through: o.through * 0.6 });
  }
  return st;
}
// Sprout a street at arc s of st, at right angles (± jitter), if there's room.
function sproutFrom(st, s, side, kind, o) {
  if (s < o.space || s > st.len - o.space) return null;
  if (st.joints.some((j) => Math.abs(j.s - s) < o.space)) return null;
  const p = pointAt(st, s);
  const base = Math.atan2(p.tx, p.tz) + side * Math.PI / 2;
  return grow({ st, s }, base + (o.jitter ? krr(-o.jitter, o.jitter) : 0), kind, o);
}

// ---------------------------------------------------------------- the network
// H: { node, edge, reserved, landmarks, gates: [city nodes on Midtown's north edge], parisNode }
export function generateKathmanduRoads(H) {
  const S = (P) => spline(P, 4);
  const gate = (n) => junction(n.x, n.z, n);
  const [g0, g1, g3, g5, g7] = H.gates.map(gate);
  // the route layout was drawn on an 860 × 680 m plan; squeeze it into the (compact) district
  const mx = (x) => KTM.x0 + ((x + 200) / 860) * (KTM.x1 - KTM.x0);
  const mz = (z) => KTM.z0 + ((z - 620) / 680) * (KTM.z1 - KTM.z0);
  const M = (P) => P.map(([x, z]) => [mx(x), mz(z)]);

  // ---- arterials
  const west = junction(mx(-200), mz(700));
  trace(S([[H.parisNode.x, H.parisNode.z], [-470, 470], [-340, 612], [west.x, west.z]]), "collector", gate(H.parisNode), { end: west });
  const star = trace(S(M([[-200, 700], [-80, 810], [60, 930], [190, 1050], [300, 1150]])), "artery", west);
  trace(S([[star.x, star.z], ...M([[312, 1230], [322, 1300]])]), "artery", star);
  trace(S([[star.x, star.z], ...M([[380, 1060], [460, 950], [530, 840], [575, 740], [600, 640]])]), "artery", star, { end: g7 });
  const n5 = M([[-40, 1300]])[0];
  trace(S(M([[-40, 1300], [-30, 1130], [-60, 960], [-80, 800], [-95, 640]])), "artery", junction(n5[0], n5[1]), { end: g0 });
  const n4 = M([[620, 1300]])[0];
  trace(S(M([[620, 1300], [610, 1120], [590, 960], [560, 800]])), "artery", junction(n4[0], n4[1]), { stopAtHit: 1 });
  // the cross road: over the west arterial and the diagonal, ends in a T at the south-east one
  const n6 = M([[-200, 1010]])[0];
  trace(S(M([[-200, 1010], [-20, 990], [170, 905], [380, 870], [560, 830]])), "artery", junction(n6[0], n6[1]), { stopAtHit: 3 });
  // Midtown's avenues run on north into the town
  for (const g of [g1, g3, g5]) {
    trace(S([[g.x, g.z], [g.x + krr(-6, 10), mz(700)], [g.x + krr(-10, 10), mz(900)], [g.x + krr(-10, 10), mz(1100)]]), "collector", g, { stopAtHit: 1 });
  }

  // ---- collectors branching off the arterials
  const of = (k) => streets.filter((s) => s.kind === k);
  for (let t = 0, n = 0; t < 600 && n < 12; t++) {
    const src = krand() < 0.7 ? of("artery") : of("collector");
    const st = kpick(src);
    if (!st || st.len < 100) continue;
    if (sproutFrom(st, krr(30, st.len - 30), krand() < 0.5 ? -1 : 1, "collector",
      { len: krr(120, 280), curve: 0.012, gap: 26, space: 30, jitter: 0.15, through: 0.55, minDead: 50, minLink: 30 })) n++;
  }

  // ---- the only open spaces: Basantapur Durbar Square (the big one, with the
  // palace) near the core, and three temple squares (tole)
  const DR = 50;
  const roadNear = (x, z, r) => nearestSeg(x, z, r);
  const durbar = (() => {
    let best = null;
    for (let t = 0; t < 5000; t++) {
      const x = krr(KTM_CORE.x - 140, KTM_CORE.x + 140), z = krr(KTM_CORE.z - 120, KTM_CORE.z + 120);
      if (!insideK(x, z, DR + 20)) continue;
      const n = roadNear(x, z, DR + 34);
      if (!n || n.d < DR + 6 || n.d > DR + 30) continue;
      const score = Math.hypot(x - KTM_CORE.x, z - KTM_CORE.z) + n.d;
      if (!best || score < best.score) best = { x, z, n, score };
    }
    return best;
  })();
  if (durbar) {
    const yaw = Math.atan2(-(durbar.n.x - durbar.x), -(durbar.n.z - durbar.z));   // courtyard faces the road
    reservedK.push({ x: durbar.x, z: durbar.z, r: DR });
    H.landmarks.ktmDurbar = { x: durbar.x, z: durbar.z, yaw, r: DR };
  }
  const squares = [];
  for (let t = 0; t < 4000 && squares.length < 3; t++) {
    const x = krr(KTM.x0 + 45, KTM.x1 - 45), z = krr(KTM.z0 + 45, KTM.z1 - 45), r = krr(16, 20);
    const n = roadNear(x, z, r + 40);
    if (!n || n.d < r + 8) continue;
    if (reservedK.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r + 110)) continue;
    const sq = { x, z, r, n };
    squares.push(sq);
    reservedK.push(sq);
  }
  // a lane from the nearest road straight into each square
  for (const q of [...squares, ...(durbar ? [{ ...durbar, r: DR }] : [])]) {
    const s = arcAt(q.n.st, q.n.i, q.n.u);
    grow({ st: q.n.st, s }, Math.atan2(q.x - q.n.x, q.z - q.n.z), "galli",
      { len: q.n.d + 6, curve: 0, gap: 0, minDead: 3, minLink: 3 });
  }

  // ---- the maze: London-style organic streets between the main roads.
  // Junction points are scattered unevenly (denser in the old core), joined to
  // their neighbours (relative-neighbourhood graph + some Gabriel links) so the
  // blocks are irregular and streets meet at odd angles; sharp angles are
  // pruned, every street gets a gentle bend, and dead-end alleys poke into the
  // blocks. Blocks come out big enough to be filled with houses.
  const spacing = (x, z) => 34 + 14 * clamp(Math.hypot(x - KTM_CORE.x, z - KTM_CORE.z) / 380, 0, 1);
  const P = [], PG = 24, pgrid = new Map();
  const around = (x, z, r, cb) => {
    for (let ix = Math.floor((x - r) / PG); ix <= Math.floor((x + r) / PG); ix++) {
      for (let iz = Math.floor((z - r) / PG); iz <= Math.floor((z + r) / PG); iz++) {
        const c = pgrid.get(skey(ix, iz));
        if (c) for (const p of c) if (cb(p) === false) return false;
      }
    }
    return true;
  };
  for (let t = 0; t < 40000; t++) {
    const x = krr(KTM.x0 + 8, KTM.x1 - 8), z = krr(KTM.z0 + 8, KTM.z1 - 8);
    if (reservedK.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 9)) continue;
    if (nearestSeg(x, z, 15)) continue;                      // keep clear of the main roads
    const sp = spacing(x, z);
    if (!around(x, z, sp, (p) => (Math.hypot(p.x - x, p.z - z) < sp ? false : undefined))) continue;
    const p = { x, z, i: P.length, adj: [] };
    P.push(p);
    const k = skey(Math.floor(x / PG), Math.floor(z / PG));
    if (!pgrid.has(k)) pgrid.set(k, []);
    pgrid.get(k).push(p);
  }
  const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  const other = (e, p) => (e.a === p ? e.b : e.a);
  const L = [];
  for (const p of P) {
    const maxL = 2.3 * spacing(p.x, p.z);
    around(p.x, p.z, maxL, (q) => {
      if (q.i <= p.i) return;
      const d = dist(p, q);
      if (d > maxL) return;
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      let gab = true, rng = true;
      around(p.x, p.z, d, (o) => {
        if (o === p || o === q) return;
        if (Math.hypot(o.x - mx, o.z - mz) < d / 2) { gab = false; return false; }
        if (Math.max(dist(o, p), dist(o, q)) < d) rng = false;
      });
      if (!gab || !(rng || krand() < 0.33)) return;
      const e = { a: p, b: q, len: d, alive: true };
      p.adj.push(e); q.adj.push(e); L.push(e);
    });
  }
  const segD = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
    return Math.hypot(px - ax - dx * t, pz - az - dz * t);
  };
  for (const e of L) {
    // never through a square
    if (reservedK.some((q) => segD(q.x, q.z, e.a.x, e.a.z, e.b.x, e.b.z) < q.r + 5)) { e.alive = false; continue; }
    // no street running right alongside a main road (it would leave a sliver)
    const dx = (e.b.x - e.a.x) / e.len, dz = (e.b.z - e.a.z) / e.len;
    for (const t of [0.25, 0.5, 0.75]) {
      const n = nearestSeg(e.a.x + (e.b.x - e.a.x) * t, e.a.z + (e.b.z - e.a.z) * t, 16);
      if (!n) continue;
      const [ax, az] = n.st.pts[n.i], [bx, bz] = n.st.pts[n.i + 1], sl = Math.hypot(bx - ax, bz - az) || 1;
      if (Math.abs((dx * (bx - ax) + dz * (bz - az)) / sl) > 0.75) { e.alive = false; break; }
    }
  }
  // prune junction angles under 40° (drop the longer street)
  const angOf = (p, e) => { const o = other(e, p); return Math.atan2(o.z - p.z, o.x - p.x); };
  for (let changed = true; changed;) {
    changed = false;
    for (const p of P) {
      const items = p.adj.filter((e) => e.alive).map((e) => ({ e, a: angOf(p, e) }));
      if (items.length < 2) continue;
      items.sort((u, v) => u.a - v.a);
      for (let k = 0; k < items.length; k++) {
        const u = items[k], v = items[(k + 1) % items.length];
        const gap = v.a - u.a + (k === items.length - 1 ? Math.PI * 2 : 0);
        if (gap >= 0.7) continue;
        (u.e.len > v.e.len ? u.e : v.e).alive = false;
        changed = true;
        break;
      }
    }
  }
  // every street bends a little (straightened where a curve would clip another)
  const curve = (e) => {
    const { a, b, len } = e, n = Math.max(2, Math.ceil(len / 3));
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len, pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, s1 = Math.sin(Math.PI * t);
      const off = e.amp1 * s1 * s1 + e.amp2 * Math.sin(2 * Math.PI * t) * s1;
      pts.push([a.x + (b.x - a.x) * t + nx * off, a.z + (b.z - a.z) * t + nz * off]);
    }
    return pts;
  };
  const LE = L.filter((e) => e.alive);
  for (const e of LE) {
    e.amp1 = krr(-1, 1) * Math.min(0.08 * e.len, 5);
    e.amp2 = e.len < 55 ? 0 : krr(-1, 1) * Math.min(0.05 * e.len, 3.5);
    e.pts = curve(e);
    e.bb = [Math.min(e.a.x, e.b.x) - 6, Math.max(e.a.x, e.b.x) + 6, Math.min(e.a.z, e.b.z) - 6, Math.max(e.a.z, e.b.z) + 6];
  }
  for (let i = 0; i < LE.length; i++) {
    for (let j = i + 1; j < LE.length; j++) {
      const e = LE[i], f = LE[j];
      if (e.bb[1] < f.bb[0] || f.bb[1] < e.bb[0] || e.bb[3] < f.bb[2] || f.bb[3] < e.bb[2]) continue;
      if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
      let clip = false;
      for (let u = 0; u < e.pts.length - 1 && !clip; u++) {
        for (let v = 0; v < f.pts.length - 1; v++) {
          const [a, b] = [e.pts[u], e.pts[u + 1]], [c, d] = [f.pts[v], f.pts[v + 1]];
          if (segHit(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]) || segD(a[0], a[1], c[0], c[1], d[0], d[1]) < 9) { clip = true; break; }
        }
      }
      if (clip) for (const g of [e, f]) { g.amp1 = g.amp2 = 0; g.pts = curve(g); }
    }
  }
  // lay the streets down (crossing a main road makes a junction on it)
  for (const p of P) if (p.adj.some((e) => e.alive)) p.J = junction(p.x, p.z);
  for (const e of LE) trace(e.pts, "galli", e.a.J, { end: e.b.J });
  // hook the maze onto the main roads: a short street from a quiet junction
  // to the road next to it
  for (const p of P) {
    if (!p.J) continue;
    const deg = p.adj.filter((e) => e.alive).length;
    if (deg > 2) continue;
    const n = nearestSeg(p.x, p.z, 34, (c) => Math.hypot(c.x - p.x, c.z - p.z) < 6);
    if (!n) continue;
    const a = Math.atan2(n.z - p.z, n.x - p.x);
    if (p.adj.some((e) => e.alive && Math.abs(Math.atan2(Math.sin(angOf(p, e) - a), Math.cos(angOf(p, e) - a))) < 0.7)) continue;
    const ux = (n.x - p.x) / n.d, uz = (n.z - p.z) / n.d;
    trace([[p.x, p.z], [n.x + ux * 1.5, n.z + uz * 1.5]], "galli", p.J, { stopAtHit: 1 });
  }
  // dead-end alleys poking into the blocks
  for (let t = 0, made = 0; t < 4000 && made < 70; t++) {
    const st = kpick(streets);
    if (st.len < 40) continue;
    if (sproutFrom(st, krr(14, st.len - 14), krand() < 0.5 ? -1 : 1, "galli",
      { len: krr(16, 30), curve: 0.03, gap: 13, space: 14, jitter: 0.25, through: 0, minDead: 14, minLink: 1e9 })) made++;
  }

  // ---- drop anything that didn't end up connected to the main roads
  {
    const adj = new Map();
    const link = (J, st) => { let l = adj.get(J); if (!l) { l = []; adj.set(J, l); } l.push(st); };
    for (const st of streets) { link(st.a, st); link(st.b, st); for (const j of st.joints) link(j.J, st); }
    const seen = new Set(), stack = [g1];
    const reached = new Set();
    while (stack.length) {
      const J = stack.pop();
      if (seen.has(J)) continue;
      seen.add(J);
      for (const st of adj.get(J) || []) {
        if (reached.has(st)) continue;
        reached.add(st);
        for (const K of [st.a, st.b, ...st.joints.map((j) => j.J)]) if (!seen.has(K)) stack.push(K);
      }
    }
    for (let i = streets.length - 1; i >= 0; i--) if (!reached.has(streets[i])) streets.splice(i, 1);
  }

  // ---- cut every street at its joints into the real road graph
  const nodeOf = (J) => J.node || (J.node = H.node(J.x, J.z));
  const slice = (st, s0, s1) => {
    const out = [[pointAt(st, s0).x, pointAt(st, s0).z]];
    for (let i = 1; i < st.pts.length - 1; i++) if (st.cum[i] > s0 + 0.3 && st.cum[i] < s1 - 0.3) out.push(st.pts[i].slice());
    const pe = pointAt(st, s1);
    out.push([pe.x, pe.z]);
    return out;
  };
  for (const st of streets) {
    const stops = [{ s: 0, J: st.a }, ...st.joints.slice().sort((p, q) => p.s - q.s), { s: st.len, J: st.b }];
    const [w, sw] = KTM_WIDTH[st.kind];
    for (let k = 0; k < stops.length - 1; k++) {
      const A = stops[k], B = stops[k + 1];
      if (A.J === B.J) continue;
      const pts = slice(st, A.s, B.s);
      const mid = pts[Math.floor(pts.length / 2)];
      H.edge(nodeOf(A.J), nodeOf(B.J), pts, w, sw, st.kind, inKathmandu(mid[0], mid[1]) ? "kathmandu" : "park");
    }
  }
  for (const q of squares) H.reserved.push({ x: q.x, z: q.z, r: q.r });
  if (durbar) H.reserved.push({ x: durbar.x, z: durbar.z, r: DR });
  H.landmarks.ktmSquares = squares.map((q) => ({ x: q.x, z: q.z, r: q.r }));
}
