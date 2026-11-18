// people.js — pedestrians walking the sidewalks of the road graph. They pick
// a new street at every junction, side-step the player, run from gunfire and
// get knocked down by bullets or cars (then get back up and flee).
import { scene, rand, rr, pick, clamp, hex, litMat, mergedTemplate, angDiff } from "./engine.js";
import { edges, pathAt } from "./roads.js";

export const peds = [];
const MB = BABYLON.MeshBuilder;
let torsoTs = [], legTs = [];

function initTemplates() {
  const skins = ["#e0b08c", "#c08462", "#8d5a3c", "#5c3a26"].map((h, i) => litMat("skin" + i, hex(h), 0.15));
  const hairs = ["#2a1d14", "#5a3a20", "#b08a50", "#111111", "#7a7a7a"].map((h, i) => litMat("hair" + i, hex(h)));
  const shirts = ["#c0392b", "#2c3e50", "#ecf0f1", "#27ae60", "#f1c40f", "#8e44ad", "#3d6fa8", "#d35400", "#1d1d1d", "#7f8c8d"]
    .map((h, i) => litMat("shirt" + i, hex(h), 0.05));
  for (let i = 0; i < 18; i++) {
    const shirt = pick(shirts), skin = pick(skins), hair = pick(hairs);
    const parts = [];
    const torso = MB.CreateCapsule("t", { radius: 0.19, height: 0.66, tessellation: 10, subdivisions: 1 }, scene);
    torso.position.y = 1.2; torso.scaling.set(1.1, 1, 0.72);
    parts.push({ mesh: torso, mat: shirt });
    const head = MB.CreateSphere("h", { diameter: 0.23, segments: 8 }, scene);
    head.position.y = 1.64; parts.push({ mesh: head, mat: skin });
    const hairM = MB.CreateSphere("hr", { diameter: 0.25, segments: 8, slice: 0.55 }, scene);
    hairM.position.y = 1.66; parts.push({ mesh: hairM, mat: hair });
    for (const sx of [-0.25, 0.25]) {
      const arm = MB.CreateCapsule("a", { radius: 0.058, height: 0.6, tessellation: 8, subdivisions: 1 }, scene);
      arm.position.set(sx, 1.17, 0); arm.rotation.z = -sx * 0.18; parts.push({ mesh: arm, mat: shirt });
      const hand = MB.CreateSphere("hd", { diameter: 0.1, segments: 6 }, scene);
      hand.position.set(sx * 1.12, 0.86, 0); parts.push({ mesh: hand, mat: skin });
    }
    torsoTs.push(mergedTemplate("ped" + i, parts));
  }
  legTs = ["#2b3a55", "#1d1d1d", "#b8a27a", "#4a4a4a"].map((h, i) => {
    const leg = MB.CreateCapsule("leg", { radius: 0.082, height: 0.88, tessellation: 8, subdivisions: 1 }, scene);
    leg.position.y = -0.44;
    leg.bakeCurrentTransformIntoVertices();
    leg.material = litMat("pants" + i, hex(h));
    leg.setEnabled(false);
    return leg;
  });
}

function pickEdge() {
  const list = edges.filter((e) => e.district !== "park" || rand() < 0.3);
  const total = list.reduce((a, e) => a + e.len, 0);
  let r = rand() * total;
  for (const e of list) { r -= e.len; if (r <= 0) return e; }
  return list[0];
}

export function spawnPeds(count = 190) {
  initTemplates();
  for (let i = 0; i < count; i++) {
    const e = pickEdge();
    const root = new BABYLON.TransformNode("ped", scene);
    const body = pick(torsoTs).createInstance("pt");
    body.parent = root;
    const legT = pick(legTs);
    const legs = [-0.1, 0.1].map((x) => { const l = legT.createInstance("pl"); l.parent = root; l.position.set(x, 0.9, 0); return l; });
    const p = {
      root, body, legs, e, dir: rand() < 0.5 ? 1 : -1, s: rr(2, e.len - 2),
      lat: rr(0.35, 0.65), walk: rr(1.1, 1.6), speed: 0, phase: rand() * 6,
      state: "walk", timer: 0, x: 0, z: 0, heading: 0, vx: 0, vz: 0, push: 0,
    };
    p.speed = p.walk;
    place(p, 0, true);
    peds.push(p);
  }
}

function sideOffset(p) { return p.e.w / 2 + p.e.sw * p.lat + p.push; }
function place(p, dt, snap = false) {
  const q = pathAt(p.e, p.s);
  const fx = q.tx * p.dir, fz = q.tz * p.dir;
  const off = sideOffset(p);
  const x = q.x + fz * off, z = q.z - fx * off;
  if (snap || Math.hypot(x - p.x, z - p.z) < 0.5) { p.x = x; p.z = z; }
  else { const k = Math.min(1, dt * 4); p.x += (x - p.x) * k; p.z += (z - p.z) * k; }
  const h = Math.atan2(fx, fz);
  p.heading = snap ? h : p.heading + angDiff(h, p.heading) * Math.min(1, dt * 8);
}
function nextEdge(p, overflow) {
  const nd = p.dir > 0 ? p.e.b : p.e.a;
  const opts = nd.edges.filter((e) => e !== p.e);
  const e = opts.length && rand() < 0.92 ? pick(opts) : p.e;
  if (e === p.e) { p.dir = -p.dir; p.s = p.dir > 0 ? overflow : e.len - overflow; return; }
  p.e = e;
  if (e.a === nd) { p.dir = 1; p.s = overflow; } else { p.dir = -1; p.s = e.len - overflow; }
}

// Knock a pedestrian down (bullet or car), optionally flinging them.
export function knockDown(p, fx = 0, fz = 0) {
  if (p.state === "down") return;
  p.state = "down";
  p.timer = rr(3.5, 5.5);
  p.vx = fx; p.vz = fz;
}
export function scare(x, z, r) {
  for (const p of peds) {
    if (p.state === "down") continue;
    if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r) {
      p.state = "flee"; p.timer = rr(5, 8);
      if (rand() < 0.5) p.dir = -p.dir;
    }
  }
}

// Is pedestrian p inside the footprint of vehicle v (plus a small margin)?
function underVehicle(v, p) {
  const s = v.spec || { hw: 0.95, hd: 2.2 };
  const h = v.heading, q = v.mesh.position;
  const dx = p.x - q.x, dz = p.z - q.z;
  const fwd = dx * Math.sin(h) + dz * Math.cos(h), lat = dx * Math.cos(h) - dz * Math.sin(h);
  return Math.abs(fwd) < s.hd + 0.4 && Math.abs(lat) < s.hw + 0.45;
}
// ctx: { pos, vehicle, vehicleSpeed }
export function updatePeds(dt, ctx) {
  for (const p of peds) {
    if (p.state === "down") {
      p.timer -= dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      const k = Math.exp(-5 * dt); p.vx *= k; p.vz *= k;
      p.root.position.set(p.x, 0.1, p.z);
      p.root.rotation.x += (-Math.PI / 2 + 0.08 - p.root.rotation.x) * Math.min(1, dt * 10);
      if (p.timer <= 0) { p.state = "flee"; p.timer = rr(4, 6); p.root.rotation.x = 0; }
      continue;
    }
    if (p.state === "flee") { p.timer -= dt; if (p.timer <= 0) p.state = "walk"; }
    const target = p.state === "flee" ? 4.6 : p.walk;
    p.speed += clamp(target - p.speed, -4 * dt, 4 * dt);

    // side-step the player
    const dx = ctx.pos.x - p.x, dz = ctx.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (!ctx.vehicle && d < 1.1 && ctx.pos.y < 1.5) p.push = clamp(p.push + dt * 2.5 * (p.lat > 0.5 ? -1 : 1), -1.4, 1.4);
    else p.push *= Math.exp(-dt);

    // run over by the player's vehicle
    if (ctx.vehicle && Math.abs(ctx.vehicleSpeed) > 3.5 && ctx.pos.y < 2 && underVehicle(ctx.vehicle, p)) {
      const h = ctx.vehicle.heading, sp = ctx.vehicleSpeed;
      knockDown(p, Math.sin(h) * sp * 0.6 - (dx / (d || 1)) * 3, Math.cos(h) * sp * 0.6 - (dz / (d || 1)) * 3);
      scare(p.x, p.z, 25);
      continue;
    }

    p.s += p.dir * p.speed * dt;
    let guard = 0;
    while ((p.s > p.e.len || p.s < 0) && guard++ < 4) nextEdge(p, p.s > p.e.len ? p.s - p.e.len : -p.s);
    place(p, dt);
    p.phase += dt * p.speed * 4.2;
    const sw = Math.sin(p.phase) * (p.state === "flee" ? 0.75 : 0.45);
    p.legs[0].rotation.x = sw;
    p.legs[1].rotation.x = -sw;
    p.root.position.set(p.x, Math.abs(Math.cos(p.phase)) * 0.04, p.z);
    p.root.rotation.y = p.heading;
    p.root.rotation.x = p.state === "flee" ? 0.12 : 0;
  }
}
