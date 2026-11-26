// roadcar.js — the missions' own vehicles, driven along the road graph.
//
// A road car follows the streets lane by lane (it can't leave the road, so it
// never gets stuck on a wall), slowing for corners and choosing its turn at
// every junction:
//   goal   — the shortest way to a destination (a getaway car, a truck run)
//   chase  — toward you (hunters: they close in, and their gunmen fire from
//            the windows; on foot they pull up near you and shoot)
// Getaway cars "rubber-band": they ease off when you fall far behind, so a
// determined driver always catches them, and push on when you're close.
//
// They shove traffic aside, knock down anyone in the road, and can be shot
// (each bullet 1 damage) or rammed (the harder, the more). Out of health a
// hunter explodes; a getaway car is "disabled" and grinds to a stop, smoking.
import { nodes, edges, pathAt, otherEnd } from "./roads.js";
import { terrainH, angDiff, clamp } from "./engine.js";
import { missionTemplate, SPECS, specOf, slopePitch, traffic, knockTraffic, swapToBurnt, vehicles, vehicleSolid } from "./vehicles.js";
import { removeSolid } from "./engine.js";
import { peds, knockDown, scare } from "./people.js";
import { C } from "./combat.js";
import * as sfx from "./sound.js";

export let cars = [];
const PA = { x: 0, z: 0, tx: 0, tz: 1 };
const KEYSPEC = { sedan: "car", grey: "car", suv: "suv", van: "van", truck: "truck", supercar: "supercar" };
const PEN = { galli: 2.6, mews: 3, lane: 1.4 };       // tiny lanes: only if there's no other way

// ---------------------------------------------------------------- road maths
// The closest point on any road to (x, z): { e, s, d }
export function nearestOnRoad(x, z, filter = null) {
  let best = null, bd = Infinity;
  for (const e of edges) {
    if (filter && !filter(e)) continue;
    // cheap reject: bounding box of the edge's points
    const xs = e.xs, zs = e.zs;
    for (let i = 0; i < xs.length - 1; i++) {
      const ax = xs[i], az = zs[i], bx = xs[i + 1], bz = zs[i + 1];
      if (Math.min(ax, bx) - x > bd || x - Math.max(ax, bx) > bd || Math.min(az, bz) - z > bd || z - Math.max(az, bz) > bd) continue;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < bd) { bd = d; best = { e, s: e.cum[i] + (e.cum[i + 1] - e.cum[i]) * t, d }; }
    }
  }
  return best;
}
// A spot on the pavement next to the road nearest (x, z), on the side facing
// (x, z): { x, z, yaw (along the road), face (toward the buildings) }
export function kerbSpot(x, z, lat = 0.6) {
  const r = nearestOnRoad(x, z);
  if (!r) return { x, z, yaw: 0, face: 0 };
  const q = pathAt(r.e, r.s, { x: 0, z: 0, tx: 0, tz: 1 });
  const side = (x - q.x) * q.tz - (z - q.z) * q.tx >= 0 ? 1 : -1;
  const off = (r.e.w / 2 + r.e.sw * lat) * side;
  return { x: q.x + q.tz * off, z: q.z - q.tx * off, yaw: Math.atan2(q.tx, q.tz), face: Math.atan2(q.tz * side, -q.tx * side), e: r.e, s: r.s, side };
}
// Distance along the roads from every junction to (x, z) (Dijkstra).
export function fieldTo(x, z) {
  const r = nearestOnRoad(x, z);
  const D = new Float32Array(nodes.length).fill(1e9);
  if (!r) return { D, e: null, s: 0, x, z };
  const heap = [];
  const push = (n, d) => {
    if (d >= D[n.id]) return;
    D[n.id] = d;
    heap.push([d, n]);
    let i = heap.length - 1;
    while (i > 0) { const pi = (i - 1) >> 1; if (heap[pi][0] <= heap[i][0]) break; [heap[pi], heap[i]] = [heap[i], heap[pi]]; i = pi; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, rr = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  push(r.e.a, r.s);
  push(r.e.b, r.e.len - r.s);
  while (heap.length) {
    const [d, n] = pop();
    if (d > D[n.id]) continue;
    for (const e of n.edges) push(otherEnd(e, n), d + e.len * (PEN[e.kind] || 1));
  }
  return { D, e: r.e, s: r.s, x, z };
}
// road distance from car c to its goal
function goalDist(c, f) {
  if (!f || !f.e) return 1e9;
  if (c.e === f.e) return Math.abs(c.s - f.s);
  const toB = c.dir > 0 ? c.e.len - c.s : c.s;
  return toB + f.D[(c.dir > 0 ? c.e.b : c.e.a).id];
}

// ---------------------------------------------------------------- spawning
// o: { mode: "goal" | "chase" | "parked", goal: field, hp, top, gunners, label, rubber, onDisabled, onWrecked, onArrive, onEscape, explodes }
export function spawnCar(key, x, z, o = {}) {
  const r = o.at || nearestOnRoad(x, z);
  const tpl = missionTemplate(key);
  const spec = SPECS[KEYSPEC[key] || "car"];
  const mesh = tpl.createInstance("missionCar");
  const v = { kind: spec.kind, spec, tpl, mesh, heading: 0, speed: 0, hits: 0, wrecked: false, lean: 0, solid: null, locked: true };
  const c = {
    key, v, spec, e: r.e, s: r.s, dir: 1, speed: o.speed || 0, top: o.top || 26, hp: o.hp || 10, max: o.hp || 10,
    mode: o.mode || "goal", goal: o.goal || null, next: null, state: o.mode === "parked" ? "parked" : "drive",
    gunners: o.gunners || 0, gunCool: 1.5 + Math.random(), label: o.label || "Car", rubber: o.rubber ?? o.mode === "goal",
    explodes: o.explodes ?? o.mode === "chase", hitCool: 0, runCool: 0, scareT: 0, farT: 0, smoke: null,
    onDisabled: o.onDisabled, onWrecked: o.onWrecked, onArrive: o.onArrive, onEscape: o.onEscape, stopAt: o.stopAt ?? 13,
    lane: o.lane ?? null, wob: 0,
  };
  // face the way that gets us there (or the given heading)
  if (o.heading !== undefined) {
    const q = pathAt(c.e, c.s, PA);
    c.dir = q.tx * Math.sin(o.heading) + q.tz * Math.cos(o.heading) >= 0 ? 1 : -1;
  } else if (c.goal && c.goal.e) {
    c.dir = c.goal.D[c.e.b.id] + (c.e.len - c.s) <= c.goal.D[c.e.a.id] + c.s ? 1 : -1;
    if (c.goal.e === c.e) c.dir = c.goal.s >= c.s ? 1 : -1;
  }
  c.box = { rot: { cx: 0, cz: 0, c: 1, s: 0 }, lx0: -spec.hw - 0.05, lx1: spec.hw + 0.05, lz0: -spec.hd - 0.1, lz1: spec.hd + 0.1, minY: 0, maxY: spec.ht };
  c.shoot = { box: c.box, onHit: () => damage(c, 1, "shot") };
  place(c, 0, true);
  cars.push(c);
  return c;
}
export function removeCar(c) {
  const i = cars.indexOf(c);
  if (i >= 0) cars.splice(i, 1);
  if (c.smoke) { c.smoke.dispose(); c.smoke = null; }
  if (c.v.solid) { removeSolid(c.v.solid); c.v.solid = null; }
  const j = vehicles.indexOf(c.v);
  if (j >= 0) vehicles.splice(j, 1);
  c.v.mesh.dispose();
}
export function clearCars() { for (const c of cars.slice()) removeCar(c); }
// Hand a stopped car over to the player (the truck with the arch in it).
export function releaseCar(c) {
  const i = cars.indexOf(c);
  if (i >= 0) cars.splice(i, 1);
  const v = c.v;
  if (v.solid) removeSolid(v.solid);
  v.speed = 0; v.locked = false;
  v.mesh.rotation.z = 0;
  v.solid = vehicleSolid(v);
  v.mesh.freezeWorldMatrix();
  vehicles.push(v);
  return v;
}
export const shootables = () => cars.filter((c) => c.state !== "wrecked").map((c) => c.shoot);
export const healthBar = (c) => {
  const n = Math.max(0, Math.ceil((c.hp / c.max) * 8));
  return `${c.label} ${"█".repeat(n)}${"░".repeat(8 - n)}`;
};

// ---------------------------------------------------------------- damage
export function damage(c, n, how) {
  if (c.state === "wrecked" || c.state === "stopping" || c.state === "stopped") return;
  if (c.state === "parked") {
    // (a parked getaway car can't be finished off before the chase begins)
    c.hp = Math.max(1, c.hp - n);
    if (c.onShotParked) c.onShotParked(c);
    return;
  }
  c.hp -= n;
  if (c.hp > 0) {
    if (c.hp <= c.max * 0.4 && !c.smoke && C.smokeOn) c.smoke = C.smokeOn(c.v.mesh);
    return;
  }
  if (c.explodes) wreck(c);
  else disable(c);
}
function wreck(c) {
  c.state = "wrecked";
  if (c.smoke) { c.smoke.dispose(); c.smoke = null; }
  const v = c.v, p = v.mesh.position;
  swapToBurnt(v);
  if (C.explode) C.explode(new BABYLON.Vector3(p.x, p.y + 0.6, p.z), 1);
  v.solid = vehicleSolid(v);
  if (c.onWrecked) c.onWrecked(c);
}
function disable(c) {
  c.state = "stopping";
  if (!c.smoke && C.smokeOn) c.smoke = C.smokeOn(c.v.mesh);
  sfx.crash(14, "vehicle");
}

// ---------------------------------------------------------------- per frame
let chaseField = null, chaseT = 0;
export function updateCars(dt, ctx) {
  if (!cars.length) return;
  const me = ctx.pos, pv = ctx.vehicle;
  // hunters share one map of "the way to you", refreshed now and then
  if (cars.some((c) => c.mode === "chase" && c.state === "drive")) {
    chaseT -= dt;
    if (chaseT <= 0 || !chaseField) { chaseT = 1.4; chaseField = fieldTo(me.x, me.z); }
  }
  for (const c of cars.slice()) updateCar(c, dt, me, pv);
}
function updateCar(c, dt, me, pv) {
  const v = c.v, p = v.mesh.position;
  const d = Math.hypot(p.x - me.x, p.z - me.z);
  if (c.state === "wrecked" || c.state === "stopped" || c.state === "parked") { if (c.state !== "wrecked") ram(c, me, pv, d, dt); return; }
  if (c.state === "stopping") {
    c.speed = Math.max(0, c.speed - 14 * dt);
    c.wob += dt * 9;
    advance(c, c.speed * dt);
    place(c, dt);
    v.mesh.rotation.z = Math.sin(c.wob) * 0.03 * (c.speed / 10);
    if (c.speed <= 0) {
      c.state = "stopped";
      v.solid = vehicleSolid(v);
      v.mesh.freezeWorldMatrix();
      if (c.onDisabled) c.onDisabled(c);
    }
    return;
  }
  const f = c.mode === "chase" ? chaseField : c.goal;
  // ---- how fast
  let want = c.top;
  if (c.mode === "goal" && c.rubber) {
    // ease off when you've fallen behind, push on when you're right there
    want *= d > 220 ? 0.42 : d > 140 ? 0.6 : d > 80 ? 0.8 : d < 30 ? 1.08 : 1;
  }
  if (c.mode === "chase") {
    const onFoot = !pv;
    if (onFoot && d < c.stopAt) want = 0;                         // pull up and let the gunmen work
    else if (onFoot && d < c.stopAt + 25) want = Math.min(want, 6 + (d - c.stopAt) * 0.8);
    else if (pv) want = Math.max(16, Math.min(c.top, Math.abs(pv.speed) + 9));
  }
  // corners: slow for the turn coming up
  if (!c.next) c.next = chooseNext(c, f, me);
  const rem = c.dir > 0 ? c.e.len - c.s : c.s;
  if (c.next && rem < 30) {
    const nd = c.dir > 0 ? c.e.b : c.e.a;
    const q1 = pathAt(c.e, c.dir > 0 ? c.e.len - 0.5 : 0.5, { x: 0, z: 0, tx: 0, tz: 1 });
    const ex = q1.tx * c.dir, ez = q1.tz * c.dir;
    const nb = c.next.a === nd, q2 = pathAt(c.next, nb ? 0.5 : c.next.len - 0.5, { x: 0, z: 0, tx: 0, tz: 1 });
    const nx = q2.tx * (nb ? 1 : -1), nz = q2.tz * (nb ? 1 : -1);
    const ang = Math.acos(clamp(ex * nx + ez * nz, -1, 1));
    const corner = ang < 0.3 ? c.top : clamp(c.top * (1 - ang / 2.2), 8, c.top);
    want = Math.min(want, corner + rem * 0.7);
  }
  // arrived?
  if (c.mode === "goal" && f && f.e) {
    const gd = goalDist(c, f);
    if (gd < 40) want = Math.min(want, 4 + gd * 0.6);
    if (gd < 6) {
      c.speed = 0;
      if (c.onArrive) { const cb = c.onArrive; c.onArrive = null; cb(c); }
      return;
    }
  }
  c.speed += clamp(want - c.speed, -18 * dt, 9 * dt);
  advance(c, c.speed * dt, f, me);
  place(c, dt);
  // ---- the street reacts
  c.scareT -= dt;
  if (c.scareT <= 0 && c.speed > 6) { c.scareT = 0.5; scare(p.x + Math.sin(v.heading) * 10, p.z + Math.cos(v.heading) * 10, 14); }
  if (c.speed > 4) shoveTraffic(c);
  if (c.speed > 5) runDown(c);
  ram(c, me, pv, d, dt);
  // ---- gunmen at the windows
  if (c.gunners > 0) guns(c, me, pv, d, dt);
  // ---- lost them?
  if (c.mode === "goal" && c.onEscape) {
    c.farT = d > 330 ? c.farT + dt : 0;
    if (c.farT > 9) { const cb = c.onEscape; c.farT = 0; cb(c); }
  }
}
// move s along the road, turning onto the next road at junctions
function advance(c, ds, f, me) {
  let left = ds;
  for (let guard = 0; guard < 8 && left > 0; guard++) {
    const rem = c.dir > 0 ? c.e.len - c.s : c.s;
    if (left < rem) { c.s += left * c.dir; return; }
    left -= rem;
    const nd = c.dir > 0 ? c.e.b : c.e.a;
    const nx = c.next || chooseNext(c, f, me);
    c.next = null;
    if (!nx) { c.s = c.dir > 0 ? c.e.len : 0; c.speed = 0; return; }
    if (nx === c.e) c.dir = -c.dir;                      // dead end: turn round
    else { c.e = nx; c.dir = nx.a === nd ? 1 : -1; }
    c.s = c.dir > 0 ? 0 : c.e.len;
    if (f || c.mode === "chase") c.next = chooseNext(c, c.mode === "chase" ? chaseField : f, me);
  }
}
// which road to take at the junction ahead
function chooseNext(c, f, me) {
  const nd = c.dir > 0 ? c.e.b : c.e.a;
  const opts = nd.edges.filter((o) => o !== c.e);
  if (!opts.length) return c.e;
  if (!f || !f.e) return opts[Math.floor(Math.random() * opts.length)];
  let best = null, bc = Infinity;
  for (const o of opts) {
    const far = otherEnd(o, nd);
    let cost;
    if (o === f.e) cost = nd === o.a ? f.s : o.len - f.s;
    else cost = o.len * (PEN[o.kind] || 1) + f.D[far.id];
    if (far.edges.length === 1 && o !== f.e) cost += 400;   // dead ends
    if (cost < bc) { bc = cost; best = o; }
  }
  return best;
}
const TMP = { x: 0, z: 0, tx: 0, tz: 1 };
function place(c, dt, snap = false) {
  const v = c.v, q = pathAt(c.e, c.s, TMP);
  const fx = q.tx * c.dir, fz = q.tz * c.dir;
  // (pulling out from the kerb: ease across to the driving lane)
  const want = c.lane ?? c.e.lane;
  c.laneNow = snap || c.laneNow === undefined ? want : c.laneNow + (want - c.laneNow) * Math.min(1, dt * 1.5);
  const lane = c.laneNow;
  const x = q.x + fz * lane, z = q.z - fx * lane;
  const h = Math.atan2(fx, fz);
  v.heading = snap ? h : v.heading + angDiff(h, v.heading) * Math.min(1, dt * 7);
  v.speed = c.speed;
  const m = v.mesh;
  m.position.set(x, terrainH(x, z), z);
  m.rotation.y = v.heading;
  m.rotation.x = slopePitch(x, z, v.heading, Math.min(2.5, c.spec.hd));
  updBox(c);
}
function updBox(c) {
  const p = c.v.mesh.position, r = c.box.rot;
  r.cx = p.x; r.cz = p.z; r.c = Math.cos(c.v.heading); r.s = Math.sin(c.v.heading);
  c.box.minY = p.y; c.box.maxY = p.y + c.spec.ht;
}
// traffic in the way gets shunted aside
function shoveTraffic(c) {
  const p = c.v.mesh.position, fx = Math.sin(c.v.heading), fz = Math.cos(c.v.heading);
  const reach = c.spec.hd + 3;
  for (const t of traffic) {
    const dx = t.vx - p.x, dz = t.vz - p.z;
    if (Math.abs(dx) > reach + 2 || Math.abs(dz) > reach + 2) continue;
    const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
    if (ahead < -c.spec.hd || ahead > reach || Math.abs(side) > c.spec.hw + t.spec.hw + 0.2) continue;
    if (t.knockT > 0.5) continue;
    const sgn = side >= 0 ? 1 : -1;
    knockTraffic(t, fx * 0.6 + fz * sgn, fz * 0.6 - fx * sgn, Math.max(8, c.speed), (c.spec.hd * c.spec.hw) / 2.1);
    c.speed *= c.key === "truck" ? 0.93 : 0.82;
    sfx.bump(Math.max(5, c.speed * 0.6), "vehicle");
  }
}
// anyone in the road is knocked flying
function runDown(c) {
  const p = c.v.mesh.position, fx = Math.sin(c.v.heading), fz = Math.cos(c.v.heading);
  const r = c.spec.hd + 1;
  for (const q of peds) {
    if (q.goon || q.char || q.dead || q.state === "down" || q.state === "away" || q.dormant) continue;
    const dx = q.x - p.x, dz = q.z - p.z;
    if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
    const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
    if (Math.abs(ahead) < c.spec.hd + 0.3 && Math.abs(side) < c.spec.hw + 0.35) knockDown(q, fx * c.speed * 0.5 + fz * Math.sign(side) * 3, fz * c.speed * 0.5 - fx * Math.sign(side) * 3);
  }
}
// you ramming it (in a vehicle), or it hitting you (on foot)
function ram(c, me, pv, d, dt) {
  c.hitCool -= dt;
  c.runCool -= dt;
  const v = c.v, p = v.mesh.position, sp = c.spec;
  if (d > sp.hd + 8) return;
  const h = v.heading, fx = Math.sin(h), fz = Math.cos(h);
  if (pv && pv.kind !== "boat") {
    const ps = specOf(pv), q = pv.mesh.position, pfx = Math.sin(pv.heading), pfz = Math.cos(pv.heading);
    let pen = 0, nx = 0, nz = 0;
    for (const a of sp.circles) for (const b of ps.circles) {
      const ax = p.x + fx * a, az = p.z + fz * a, bx = q.x + pfx * b, bz = q.z + pfz * b;
      const dd = Math.hypot(bx - ax, bz - az) || 0.01, o = sp.r + ps.r - dd;
      if (o > pen) { pen = o; nx = (bx - ax) / dd; nz = (bz - az) / dd; }
    }
    if (pen <= 0) return;
    // push your vehicle clear of it
    q.x += nx * pen; q.z += nz * pen;
    const pvx = pfx * pv.speed, pvz = pfz * pv.speed, cvx = fx * c.speed, cvz = fz * c.speed;
    const rel = -((pvx - cvx) * nx + (pvz - cvz) * nz);          // closing speed
    if (rel > 0.5) pv.speed *= 0.72;
    if (c.hitCool > 0 || rel < 3) return;
    c.hitCool = 0.5;
    sfx.crash(rel * 1.5, "vehicle");
    if (C.shake) C.shake(Math.min(0.5, rel * 0.03));
    if (c.state === "drive") {
      c.speed *= 0.75;
      // a hard hit from the side shoves it across its lane
      c.wob = 0;
    }
    if (rel > 4.5) damage(c, Math.round(clamp((rel - 2) / 4, 1, 6)), "ram");
    return;
  }
  if (pv || c.speed < 4 || c.runCool > 0) return;
  // on foot, in its path
  const dx = me.x - p.x, dz = me.z - p.z;
  if (me.y - terrainH(me.x, me.z) > 1.6) return;
  const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
  if (Math.abs(ahead) < sp.hd + 0.4 && Math.abs(side) < sp.hw + 0.4) {
    c.runCool = 1.2;
    if (C.hurtPlayer) C.hurtPlayer(Math.min(55, 10 + c.speed * 1.6), fx * 0.7 + fz * Math.sign(side) * 0.7, fz * 0.7 - fx * Math.sign(side) * 0.7);
    sfx.crash(c.speed, "vehicle");
  }
}
// the passengers lean out and fire
function guns(c, me, pv, d, dt) {
  c.gunCool -= dt;
  if (c.gunCool > 0 || d > 60) return;
  const v = c.v, p = v.mesh.position, h = v.heading;
  const sx = Math.cos(h), sz = -Math.sin(h);
  const side = (me.x - p.x) * sx + (me.z - p.z) * sz >= 0 ? 1 : -1;
  const from = { x: p.x + sx * side * (c.spec.hw + 0.2), y: p.y + 1.35, z: p.z + sz * side * (c.spec.hw + 0.2) };
  const to0 = { x: me.x, y: me.y + 1.2, z: me.z };
  if (C.shotClear && !C.shotClear(from, to0)) { c.gunCool = 0.4; return; }
  c.gunCool = (0.9 + Math.random() * 0.8) / Math.min(2, c.gunners);
  const moving = Math.abs(pv ? pv.speed : 0) > 8;
  const hit = Math.random() < 0.26 * Math.max(0.15, 1 - d / 62) * (moving ? 0.6 : 1) * (c.speed > 8 ? 0.7 : 1);
  const to = hit ? to0 : { x: me.x + (Math.random() - 0.5) * 4, y: me.y + Math.random() * 2.2, z: me.z + (Math.random() - 0.5) * 4 };
  const V = BABYLON.Vector3;
  if (C.spark) C.spark(new V(from.x, from.y, from.z), 0.2, 0.05);
  if (C.tracer) C.tracer(new V(from.x, from.y, from.z), new V(to.x, to.y, to.z));
  if (C.shotSound) C.shotSound(from.x, from.z);
  if (hit && C.hurtPlayer) C.hurtPlayer(7 + Math.random() * 3, (me.x - p.x) / (d || 1), (me.z - p.z) / (d || 1));
}
// A road point about `dist` metres from (x, z) (for spawning hunters out of
// sight): the junction whose distance is closest to that, optionally only in
// some districts.
export function roadPointAround(x, z, dist, filter = null) {
  let best = null, bs = Infinity;
  for (const n of nodes) {
    if (!n.edges.length) continue;
    if (filter && !n.edges.some(filter)) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    const s = Math.abs(d - dist) + Math.random() * 10;
    if (s < bs) { bs = s; best = n; }
  }
  if (!best) return null;
  const e = best.edges.find((q) => q.len > 20 && (!filter || filter(q))) || best.edges[0];
  return { e, s: e.a === best ? Math.min(8, e.len / 2) : Math.max(e.len - 8, e.len / 2), d: 0 };
}
