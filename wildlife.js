// wildlife.js — the forest on Swayambhu's hill is not safe.
//
//   wolves  packs of three, fast, bite often (and come at you from the sides)
//   tigers  stalk, then pounce from close range — a few hits and you're down
//   bears   slower, very tough, hit very hard
//
// They roam the forest. Step off the stairway into the trees and the nearest
// ones smell you and hunt you down. The stairway, the summit and anywhere
// outside the wall are safe: they won't follow you there (they stop at the
// edge and growl). Shoot them, or run for the stairs. Killed in the forest,
// you come round outside the gate.
//
// Bodies are vertex-coloured templates (one per species) with four legs on
// hip pivots — a handful of instanced draw calls for the lot. Nothing runs
// while you're far from the hill.
import { scene, hex, terrainH, colorTemplate, SWAY } from "./engine.js";
import { onStairs, swayR, inCourtyard } from "./swayambhu.js";
import * as sfx from "./sound.js";

const MB = BABYLON.MeshBuilder;
const K = {
  wolf: { hp: 3, run: 8.3, walk: 1.5, detect: 40, reach: 1.7, dmg: 11, bite: 0.8, gait: 6.5, len: 1.4, wid: 0.5, ht: 1.1, name: "Wolves" },
  tiger: { hp: 7, run: 9.4, walk: 1.3, detect: 48, reach: 2.4, dmg: 30, bite: 1.25, gait: 4.6, len: 2.4, wid: 0.75, ht: 1.4, pounce: true, name: "A tiger" },
  bear: { hp: 11, run: 7.0, walk: 1.0, detect: 30, reach: 2.4, dmg: 27, bite: 1.5, gait: 4.0, len: 2.1, wid: 1.0, ht: 1.6, name: "A bear" },
};
let H = {};           // hooks: hurtPlayer(n, fx, fz), playerDead(), toast(html, ms), pan(x, z)
const animals = [];
const shoot = [];
let ready = false, warnAt = 0;

// ---------------------------------------------------------------- models
const C = (h) => ({ diffuseColor: hex(h) });
function part(kind, o) {
  let m;
  if (kind === "s") m = MB.CreateSphere("s", { diameter: 1, segments: o.seg || 8 }, scene);
  else if (kind === "c") m = MB.CreateCylinder("c", { diameterTop: o.dt, diameterBottom: o.db, height: o.h, tessellation: o.t || 8 }, scene);
  else m = MB.CreateBox("b", { width: o.w, height: o.h, depth: o.d }, scene);
  if (o.s) m.scaling.set(...o.s);
  if (o.r) m.rotation.set(...o.r);
  m.position.set(...o.p);
  return { mesh: m, mat: o.c };
}
// species: [body parts], leg { dt, db, h, paw }, hips [x, y, z] (front ±z), leg colour
const SPECIES = {
  wolf: {
    body: [
      ["s", { s: [0.38, 0.42, 1.05], p: [0, 0.72, 0], c: C("#7d7770") }],
      ["s", { s: [0.3, 0.24, 0.85], p: [0, 0.6, 0], c: C("#b5ada0") }],
      ["s", { s: [0.42, 0.48, 0.5], p: [0, 0.78, 0.33], c: C("#86807a") }],
      ["s", { s: [0.26, 0.32, 0.32], p: [0, 0.92, 0.55], c: C("#7d7770") }],
      ["s", { s: [0.27, 0.26, 0.33], p: [0, 1.02, 0.7], c: C("#7d7770") }],
      ["b", { w: 0.13, h: 0.12, d: 0.24, p: [0, 0.96, 0.9], c: C("#5f5a54") }],
      ["b", { w: 0.06, h: 0.05, d: 0.05, p: [0, 0.99, 1.02], c: C("#111111") }],
      ["s", { s: [0.04, 0.04, 0.03], p: [-0.07, 1.06, 0.84], c: C("#d8b040") }],
      ["s", { s: [0.04, 0.04, 0.03], p: [0.07, 1.06, 0.84], c: C("#d8b040") }],
      ["c", { dt: 0, db: 0.1, h: 0.16, p: [-0.08, 1.18, 0.66], c: C("#6a645e") }],
      ["c", { dt: 0, db: 0.1, h: 0.16, p: [0.08, 1.18, 0.66], c: C("#6a645e") }],
      ["c", { dt: 0.05, db: 0.12, h: 0.55, r: [2.2, 0, 0], p: [0, 0.68, -0.72], c: C("#6e6861") }],
    ],
    leg: { dt: 0.1, db: 0.07, h: 0.56, paw: 0.1, c: "#6e6861" }, hips: [0.12, 0.6, 0.38],
  },
  tiger: {
    body: [
      ["s", { s: [0.58, 0.62, 1.65], p: [0, 1.0, 0], c: C("#d9822b"), stripes: true }],
      ["s", { s: [0.44, 0.32, 1.3], p: [0, 0.82, 0], c: C("#efe3cf") }],
      ["s", { s: [0.6, 0.66, 0.7], p: [0, 1.05, 0.55], c: C("#d9822b"), stripes: true }],
      ["s", { s: [0.44, 0.42, 0.44], p: [0, 1.18, 1.0], c: C("#d9822b"), stripes: true }],
      ["s", { s: [0.26, 0.2, 0.22], p: [0, 1.08, 1.2], c: C("#efe3cf") }],
      ["b", { w: 0.09, h: 0.06, d: 0.05, p: [0, 1.15, 1.3], c: C("#2a1a14") }],
      ["s", { s: [0.05, 0.04, 0.03], p: [-0.1, 1.27, 1.19], c: C("#c9d040") }],
      ["s", { s: [0.05, 0.04, 0.03], p: [0.1, 1.27, 1.19], c: C("#c9d040") }],
      ["s", { s: [0.12, 0.13, 0.06], p: [-0.15, 1.4, 0.95], c: C("#2a1a14") }],
      ["s", { s: [0.12, 0.13, 0.06], p: [0.15, 1.4, 0.95], c: C("#2a1a14") }],
      ["c", { dt: 0.07, db: 0.13, h: 1.05, r: [2.0, 0, 0], p: [0, 0.9, -1.2], c: C("#d9822b"), stripes: true }],
    ],
    leg: { dt: 0.21, db: 0.15, h: 0.8, paw: 0.2, c: "#d4782a" }, hips: [0.18, 0.82, 0.58],
  },
  bear: {
    body: [
      ["s", { s: [0.86, 0.86, 1.5], p: [0, 1.02, 0], c: C("#3b2a1e") }],
      ["s", { s: [0.62, 0.44, 0.62], p: [0, 1.38, 0.32], c: C("#3f2d20") }],
      ["s", { s: [0.46, 0.44, 0.5], p: [0, 1.16, 0.88], c: C("#3b2a1e") }],
      ["s", { s: [0.24, 0.2, 0.3], p: [0, 1.08, 1.12], c: C("#8a6a4a") }],
      ["b", { w: 0.1, h: 0.07, d: 0.06, p: [0, 1.12, 1.27], c: C("#141010") }],
      ["s", { s: [0.04, 0.04, 0.03], p: [-0.1, 1.24, 1.08], c: C("#111111") }],
      ["s", { s: [0.04, 0.04, 0.03], p: [0.1, 1.24, 1.08], c: C("#111111") }],
      ["s", { s: [0.13, 0.13, 0.08], p: [-0.18, 1.37, 0.85], c: C("#2f2118") }],
      ["s", { s: [0.13, 0.13, 0.08], p: [0.18, 1.37, 0.85], c: C("#2f2118") }],
      ["s", { s: [0.14, 0.14, 0.14], p: [0, 1.05, -0.72], c: C("#33251a") }],
    ],
    leg: { dt: 0.3, db: 0.25, h: 0.78, paw: 0.29, c: "#33251a" }, hips: [0.26, 0.78, 0.5],
  },
};
const tpls = {};
function makeTemplates() {
  for (const [name, sp] of Object.entries(SPECIES)) {
    const parts = sp.body.map(([k, o]) => part(k, o));
    const body = colorTemplate("animal_" + name, parts);
    // tiger stripes: dark bands painted into the vertex colours of the orange parts
    if (name === "tiger") {
      const pos = body.getVerticesData(BABYLON.VertexBuffer.PositionKind), col = body.getVerticesData(BABYLON.VertexBuffer.ColorKind);
      for (let i = 0; i < pos.length / 3; i++) {
        const r = col[i * 4], g = col[i * 4 + 1];
        if (!(r > 0.8 && g > 0.45 && g < 0.6)) continue;          // only the orange
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        if (Math.sin(z * 17 + Math.abs(x) * 6 + y * 4) > 0.45) { col[i * 4] = 0.12; col[i * 4 + 1] = 0.08; col[i * 4 + 2] = 0.06; }
      }
      body.setVerticesData(BABYLON.VertexBuffer.ColorKind, col);
    }
    const L = sp.leg;
    const leg = part("c", { dt: L.dt, db: L.db, h: L.h, p: [0, -L.h / 2, 0], c: C(L.c) });
    const paw = part("s", { s: [L.paw, L.paw * 0.7, L.paw * 1.3], p: [0, -L.h, L.paw * 0.2], c: C(L.c) });
    tpls[name] = { body, leg: colorTemplate("animalLeg_" + name, [leg, paw]), hips: sp.hips };
  }
}

// ---------------------------------------------------------------- where they live
const inForest = (x, z) => {
  const r = swayR(x, z);
  return r > SWAY.R0 + 3 && r < SWAY.RW - 1.5 && !inCourtyard(x, z) && !onStairs(x, z);
};
// you're fair game: inside the wall, off the stairways, below the summit
const huntable = (p) => { const r = swayR(p.x, p.z); return r < SWAY.RW - 0.5 && r > SWAY.R0 + 1 && !inCourtyard(p.x, p.z) && !onStairs(p.x, p.z); };
function forestSpot() {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2, r = SWAY.R0 + 10 + Math.random() * (SWAY.RB - SWAY.R0 - 14);
    const x = SWAY.x + Math.sin(a) * r, z = SWAY.z + Math.cos(a) * r;
    if (inForest(x, z)) return [x, z];
  }
  return [SWAY.x + 60, SWAY.z];
}

// ---------------------------------------------------------------- spawning
function spawn(kind, x, z, pack = null) {
  const t = tpls[kind];
  const root = new BABYLON.TransformNode("animal", scene);
  const body = t.body.createInstance("ab"); body.parent = root;
  const [hx, hy, hz] = t.hips;
  const legs = [[-hx, hz], [hx, hz], [-hx, -hz], [hx, -hz]].map(([lx, lz]) => {
    const l = t.leg.createInstance("al"); l.parent = root; l.position.set(lx, hy, lz); return l;
  });
  const a = {
    kind, k: K[kind], root, body, legs, x, z, h: Math.random() * 6.28, speed: 0, state: "roam", hp: K[kind].hp,
    tx: x, tz: z, idle: Math.random() * 3, cool: 0, phase: Math.random() * 6, pounce: 0, pounceCool: 0, deadT: 0, pack,
    side: Math.random() < 0.5 ? -1 : 1, growlT: 0,
  };
  a.box = { rot: { cx: x, cz: z, c: 1, s: 0 }, lx0: -a.k.wid / 2, lx1: a.k.wid / 2, lz0: -a.k.len / 2, lz1: a.k.len / 2, minY: 0, maxY: a.k.ht };
  a.target = { box: a.box, onHit: () => hit(a) };
  animals.push(a);
  return a;
}
export function initWildlife(hooks) {
  H = hooks || {};
  makeTemplates();
  // a big forest: six wolf packs, four tigers, four bears
  for (let p = 0; p < 6; p++) {
    const [x, z] = forestSpot();
    for (let i = 0; i < 3; i++) spawn("wolf", x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6, p);
  }
  for (let i = 0; i < 4; i++) spawn("tiger", ...forestSpot());
  for (let i = 0; i < 4; i++) spawn("bear", ...forestSpot());
  ready = true;
}

// ---------------------------------------------------------------- being shot
function hit(a) {
  if (a.state === "dead") return;
  a.hp--;
  a.provoked = 12;
  if (a.hp <= 0) {
    a.state = "dead"; a.deadT = 150; a.speed = 0;
    if (H.dist) sfx.npcDeath(H.dist(a.x, a.z), H.pan ? H.pan(a.x, a.z) : 0);
    return;
  }
  growl(a, true);
}
function growl(a, loud = false) {
  if (a.growlT > 0) return;
  a.growlT = 2.5 + Math.random() * 2;
  const d = H.dist ? H.dist(a.x, a.z) : 20;
  sfx.growl(d, H.pan ? H.pan(a.x, a.z) : 0, a.kind === "bear" ? 0.7 : a.kind === "tiger" ? 0.85 : 1.25, loud ? 1 : 0.7);
}

// ---------------------------------------------------------------- per frame
const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
export function updateWildlife(dt, ctx) {
  if (!ready) return;
  const me = ctx.pos;
  const far = swayR(me.x, me.z) > SWAY.RW + 260;
  if (far) {
    for (const a of animals) if (a.root.isEnabled()) a.root.setEnabled(false);
    return;
  }
  const dead = H.playerDead ? H.playerDead() : false;
  const prey = !dead && huntable(me);
  let alarm = null;
  for (const a of animals) {
    if (!a.root.isEnabled()) a.root.setEnabled(true);
    const k = a.k;
    a.growlT -= dt; a.cool -= dt; a.pounceCool -= dt;
    if (a.provoked > 0) a.provoked -= dt;
    if (a.state === "dead") {
      a.deadT -= dt;
      if (a.deadT <= 0 && Math.hypot(me.x - a.x, me.z - a.z) > 90) {
        const [x, z] = forestSpot();
        a.x = x; a.z = z; a.hp = k.hp; a.state = "roam"; a.root.rotation.z = 0;
      }
      place(a, 0);
      continue;
    }
    const dx = me.x - a.x, dz = me.z - a.z, d = Math.hypot(dx, dz) || 0.01;
    // hunt: you're in their forest and close enough (or you shot them)
    const hunting = (prey && (d < k.detect || (a.state !== "roam" && d < 85))) || (a.provoked > 0 && d < 70 && prey);
    if (hunting) {
      if (a.state === "roam") { a.state = "hunt"; alarm = alarm || a; growl(a, true); }
      // wolves fan out and come in from the sides
      let want = Math.atan2(dx, dz);
      if (a.kind === "wolf" && d > 6) want += a.side * 0.45 * Math.min(1, (d - 6) / 15);
      a.h = turn(a.h, want, dt * 7);
      let sp = k.run;
      if (k.pounce) {
        if (a.pounce > 0) { a.pounce -= dt; sp = 15; }
        else if (d < 9 && d > 3 && a.pounceCool <= 0) { a.pounce = 0.45; a.pounceCool = 4; growl(a, true); }
      }
      if (d < k.reach) {
        sp = 0;
        a.h = turn(a.h, Math.atan2(dx, dz), dt * 10);
        if (a.cool <= 0 && !dead) {
          a.cool = k.bite;
          if (H.hurtPlayer) H.hurtPlayer(k.dmg * (0.85 + Math.random() * 0.3), dx / d, dz / d);
          sfx.punch(true);
          growl(a);
          a.lunge = 0.25;
        }
      }
      a.speed += (sp - a.speed) * Math.min(1, dt * 6);
    } else if (!prey && a.state === "hunt" && d < 30) {
      // you've got out of reach: pace and growl at the edge
      a.state = "watch";
      growl(a);
    } else {
      if (a.state !== "roam" && (a.state !== "watch" || d > 40 || prey)) a.state = "roam";
      if (a.state === "watch") {
        a.speed += (0 - a.speed) * Math.min(1, dt * 5);
        a.h = turn(a.h, Math.atan2(dx, dz), dt * 3);
        if (Math.random() < dt * 0.4) growl(a);
      } else {
        // roam: amble to a spot nearby, stop a while, pick another
        const tdx = a.tx - a.x, tdz = a.tz - a.z, td = Math.hypot(tdx, tdz);
        if (td < 1.5) {
          a.speed += (0 - a.speed) * Math.min(1, dt * 4);
          a.idle -= dt;
          if (a.idle <= 0) {
            a.idle = 2 + Math.random() * 6;
            for (let i = 0; i < 8; i++) {
              const nx = a.x + (Math.random() - 0.5) * 50, nz = a.z + (Math.random() - 0.5) * 50;
              if (inForest(nx, nz)) { a.tx = nx; a.tz = nz; break; }
            }
          }
        } else {
          a.h = turn(a.h, Math.atan2(tdx, tdz), dt * 2.5);
          a.speed += (k.walk - a.speed) * Math.min(1, dt * 3);
        }
      }
    }
    // move, staying in the forest (they won't set foot on the stairs or the summit)
    if (a.speed > 0.01) {
      const step = a.speed * dt, n = Math.max(1, Math.ceil(step / 0.6));
      for (let i = 0; i < n; i++) {
        const nx = a.x + Math.sin(a.h) * (step / n), nz = a.z + Math.cos(a.h) * (step / n);
        if (inForest(nx, nz)) { a.x = nx; a.z = nz; }
        else {
          // slide along the edge
          const sx = a.x + Math.sin(a.h) * (step / n), sz = a.z;
          if (inForest(sx, sz)) a.x = sx;
          else if (inForest(a.x, a.z + Math.cos(a.h) * (step / n))) a.z += Math.cos(a.h) * (step / n);
          else { a.speed *= 0.5; if (a.state === "roam") a.tx = a.x, a.tz = a.z; }
          break;
        }
      }
    }
    place(a, dt);
  }
  // a warning, now and then
  if (alarm && performance.now() > warnAt && H.toast) {
    warnAt = performance.now() + 9000;
    H.toast(`<b>${alarm.k.name.toUpperCase()}</b> ${alarm.kind === "wolf" ? "are" : "is"} hunting you<small>Get back to the stairway — they won't follow you onto it</small>`, 3200);
  }
}
// pose: on the ground, tilted with the slope, legs trotting
function place(a, dt) {
  const k = a.k, gy = terrainH(a.x, a.z);
  const r = a.root;
  if (a.state === "dead") {
    r.position.set(a.x, gy + k.wid * 0.3, a.z);
    r.rotation.set(0, a.h, Math.PI / 2);
    for (const l of a.legs) l.rotation.x = 0.3;
    upd(a, gy);
    return;
  }
  const fx = Math.sin(a.h), fz = Math.cos(a.h), half = k.len * 0.4;
  const pitch = -Math.atan2(terrainH(a.x + fx * half, a.z + fz * half) - terrainH(a.x - fx * half, a.z - fz * half), half * 2);
  a.phase += dt * a.speed * (k.gait / Math.max(1, k.run * 0.5));
  const run = a.speed > k.walk * 1.5, amp = Math.min(0.85, 0.2 + a.speed * 0.09);
  const off = run ? [0, 0.6, Math.PI, Math.PI + 0.6] : [0, Math.PI, Math.PI, 0];   // gallop / trot
  a.legs.forEach((l, i) => { l.rotation.x = a.speed > 0.1 ? Math.sin(a.phase + off[i]) * amp : 0; });
  const bob = a.speed > 0.1 ? Math.abs(Math.sin(a.phase)) * 0.05 * Math.min(1, a.speed / 3) : 0;
  r.position.set(a.x, gy + bob + (a.pounce > 0 ? 0.35 : 0), a.z);
  if (a.lunge > 0) a.lunge -= dt;
  r.rotation.set(pitch + (a.lunge > 0 ? -0.18 : 0), a.h, 0);
  upd(a, gy);
}
function upd(a, gy) {
  const b = a.box;
  b.rot.cx = a.x; b.rot.cz = a.z; b.rot.c = Math.cos(a.h); b.rot.s = Math.sin(a.h);
  b.minY = gy; b.maxY = gy + a.k.ht;
}

// ---------------------------------------------------------------- hooks for main.js
// things a bullet can hit
export function wildlifeShootables() {
  shoot.length = 0;
  if (!ready) return shoot;
  for (const a of animals) if (a.state !== "dead" && a.root.isEnabled()) shoot.push(a.target);
  return shoot;
}
// killed on the hill: come round just outside the gate
export function wildlifeRespawn(p) {
  const r = swayR(p.x, p.z);
  if (r > SWAY.RW + 2 || r < SWAY.R0 - 1 || onStairs(p.x, p.z)) return null;
  return { x: SWAY.x, z: SWAY.z - SWAY.RW - 10, yaw: 0 };
}
export function wildlifeOnRespawn() {
  for (const a of animals) if (a.state !== "dead") { a.state = "roam"; a.provoked = 0; a.speed = 0; a.tx = a.x; a.tz = a.z; }
}
