// torana.js — Mission 1: "The Golden Torana".
//
// Last night the gilded torana — the golden arch over the Taleju shrine in
// Durbar Square — was pried off and stolen. Laxmi Didi, who has kept the
// square all her life, is beside herself: her nephew Bikash, who works the
// docks, phoned to say he'd found the thieves at the old boat shed on the
// west shore and was going to stop them himself. Then nothing.
//
//   0  Laxmi Didi — the story, and a plea: bring Bikash home
//   1  The boat shed — get there (you overhear Rocco's crew)
//   2  Shootout — Rocco's crew among the crates
//   3  Find Bikash — tied up in the shed... or is he?
//   4  Ambush — he set you up. Survive the second wave while the boat waits
//   5  Boat chase — Rocco's speedboat, a gunman firing from the stern; ram it
//   6  They run aground on Saint-Clair's north beach
//   7  Showdown — Rocco "the Crab" Ferraro and his last two men
//   8  Bikash — what happens to him is your call
//   9  Bring the torana home to Laxmi Didi
//  10  Done — and a name from Rocco's phone: Grant Holloway (→ Mission 2)
//
// Die and you're back on your feet at the start of the fight you lost.
import {
  scene, glow, hex, terrainH, landH, removeSolid, makeAcc, litMat, addBox, solidBox, setXF, clearXF, makeXF, xfp, setLift,
  seaAt, query, pointIn,
} from "./engine.js";
import { landmarks } from "./roads.js";
import { vehicles, driveBoat, sinkMesh, SPECS, specOf, vehicleSolid } from "./vehicles.js";
import { charById, speakAs, addCash } from "./characters.js";
import { spawnGoon, removeGoon, knockDown } from "./people.js";
import * as sfx from "./sound.js";

const SAVE_KEY = "babylon.mission.torana.v2";
const GIVER = "laxmi";
let T = { stage: 0 };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); if (s) T = { ...T, ...s }; } catch { /* private mode */ }
// fights restart from their beginning after a reload
if (T.stage >= 1 && T.stage <= 4) T.stage = 1;
else if (T.stage >= 5 && T.stage <= 7) T.stage = 5;
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(T)); } catch { /* ignore */ } };

const STAGES = [
  { title: "Talk to Laxmi Didi", hint: "The caretaker of Durbar Square is pacing by the palace. Walk up and press T." },
  { title: "The old boat shed", hint: "West shore of Kathmandu, by the jetty. Bikash said the thieves are there." },
  { title: "Take out Rocco's crew", hint: "Use the crates for cover. Q to punch — three in a row is a kick. F switches gun / web." },
  { title: "Find Bikash", hint: "He should be inside the shed." },
  { title: "Ambush!", hint: "Bikash set you up. Survive — Rocco's boat won't leave without its cover." },
  { title: "Catch Rocco's boat", hint: "Take the other boat at the jetty and ram them. Watch the gunman on the stern." },
  { title: "They're running aground", hint: "Rocco's making for the Saint-Clair beach. Follow him in." },
  { title: "Showdown", hint: "Rocco \"the Crab\" Ferraro and his last men, on the beach." },
  { title: "Bikash", hint: "He's on his knees in the sand. Decide what happens to him." },
  { title: "Bring the torana home", hint: "Take it back to Laxmi Didi at Durbar Square." },
  { title: "Mission complete", hint: "The torana is home. And Rocco's phone had a buyer's name in it: Grant Holloway, London." },
];
export const toranaDone = () => T.stage >= 10;

let ui = { banner: () => {}, subs: () => {}, choice: () => {} };
let C = {};                     // combat hooks from main.js
let shed = null;                // { x, z, yaw, lift, n: [nx, nz], side: [sx, sz] }  local +z = toward the sea
let jetty = null;               // where Rocco's boat is moored
let beach = null;               // where it runs aground: { boatX, boatZ, landX, landZ, n }
let goons = [];                 // { p, hp, max, kind, state, cool, burst, burstT, strafe, flipT, react, anchor, guardYaw }
let bikash = null;              // { p, mode: "tied" | "twist" | "run" | "boat" | "beach" }
let boat = null;                // { v, hp, state, wp, stuck, swerve, hitCool, farT, gunCool }
let slowUntil = 0;
let overheard = false, triggered = false, lastPP = null, pSpeed = 0;
const shootables = [];

// ---------------------------------------------------------------- setup
export function initTorana(opts) {
  ui = opts;
  C = opts.combat || {};
  const ms = opts.moorings || [];
  // the Kathmandu jetty (pair of moorings off the west shore) and the Saint-Clair one
  const ktm = ms.filter((m) => m.x < -150 && m.z > 600);
  const par = ms.filter((m) => Math.hypot(m.x + 560, m.z - 377) < 60);
  if (ktm.length) {
    jetty = ktm[0];
    const n = [Math.sin(jetty.heading), Math.cos(jetty.heading)];
    const ax = ktm.reduce((a, m) => a + m.x, 0) / ktm.length, az = ktm.reduce((a, m) => a + m.z, 0) / ktm.length;
    const sx = ax - n[0] * 9, sz = az - n[1] * 9;                    // shore end of the jetty
    const cx = sx - n[0] * 17, cz = sz - n[1] * 17;                  // the shed, a little inland
    shed = { x: cx, z: cz, yaw: jetty.heading, lift: landH(cx, cz), n, side: [n[1], -n[0]], shoreX: sx, shoreZ: sz };
    buildShed();
  }
  if (par.length) {
    const m = par[0], n = [Math.sin(m.heading), Math.cos(m.heading)];
    const ax = par.reduce((a, q) => a + q.x, 0) / par.length, az = par.reduce((a, q) => a + q.z, 0) / par.length;
    const sx = ax - n[0] * 9 + n[1] * 32, sz = az - n[1] * 9 - n[0] * 32;   // a stretch of beach beside the jetty
    beach = { boatX: sx + n[0] * 7, boatZ: sz + n[1] * 7, landX: sx - n[0] * 7, landZ: sz - n[1] * 7, n };
  } else beach = { boatX: -560, boatZ: 385, landX: -560, landZ: 355, n: [0, 1] };
  enterStage(T.stage, true);
}
function setStage(s, title, sub) {
  T.stage = s;
  persist();
  enterStage(s, false);
  ui.banner(title || STAGES[s].title.toUpperCase(), sub ?? (s < 10 ? STAGES[s].hint : ""), 3600);
}
// what each stage needs in the world
function enterStage(s, loading) {
  const g = charById(GIVER);
  if (g) g.forceSlot = s < 10 ? { spot: "durbar", pose: s === 0 ? "inspect" : s === 9 ? "lean" : "lean", doing: s === 0 ? "pacing in front of the empty shrine" : "waiting for news of Bikash" } : null;
  if (s === 1) { clearGoons(); spawnWave1(); spawnBikashTied(); overheard = false; triggered = false; }
  if (s === 4) { clearGoons(true); spawnWave2(); }
  if (s === 5) { mooredBoat(); if (bikash) { removeGoon(bikash.p); bikash = null; } }
  if (s !== 5 && s !== 6) dropCrew();
  if (s === 7) { clearGoons(); spawnShowdown(); }
  if (s === 8 && loading) { clearGoons(); spawnBikashBeach(); }
}

// ---------------------------------------------------------------- the boat shed
function buildShed() {
  const metal = makeAcc("shedMetal", litMat("shedMetalM", hex("#5d6b70"), 0.15));
  const rust = makeAcc("shedRust", litMat("shedRustM", hex("#7a4a32"), 0.05));
  const roof = makeAcc("shedRoof", litMat("shedRoofM", hex("#454c50"), 0.1));
  const crate = makeAcc("shedCrate", litMat("shedCrateM", hex("#8a6a42"), 0.04));
  const floor = makeAcc("shedFloor", litMat("shedFloorM", hex("#6e6a62"), 0.02));
  const lampA = makeAcc("shedLamp", (() => { const m = new BABYLON.StandardMaterial("shedLampM", scene); m.disableLighting = true; m.emissiveColor = hex("#ffd58a"); return m; })());
  lampA.glow = true;
  const W = 16, D = 11, H = 5.5;
  setLift(shed.lift);
  setXF(makeXF(shed.x, shed.z, shed.yaw));
  solidBox(-W / 2, -1.2, -D / 2, W / 2, 0.12, D / 2, (d) => (d === "+y" ? floor : null));
  // walls: back (sea side) with a door to the jetty, the two sides; the front is a wide-open bay
  solidBox(-W / 2, -1, D / 2 - 0.25, -1.4, H, D / 2, metal);
  solidBox(1.4, -1, D / 2 - 0.25, W / 2, H, D / 2, metal);
  solidBox(-1.4, 2.6, D / 2 - 0.25, 1.4, H, D / 2, metal);
  solidBox(-W / 2, -1, -D / 2, -W / 2 + 0.25, H, D / 2, metal);
  solidBox(W / 2 - 0.25, -1, -D / 2, W / 2, H, D / 2, metal);
  solidBox(-W / 2, H - 1.2, -D / 2, W / 2, H, -D / 2 + 0.25, rust);                  // lintel over the bay
  solidBox(-W / 2 - 0.4, H, -D / 2 - 0.4, W / 2 + 0.4, H + 0.3, D / 2 + 0.4, roof);
  for (const x of [-4, 4]) addBox(x - 0.25, H - 0.55, -0.25, x + 0.25, H - 0.4, 0.25, lampA);
  // crates: cover in the yard and inside
  const C1 = [[-5.5, -D / 2 - 5, 1.3, 1.2], [-4.2, -D / 2 - 5.2, 1.2, 2.4], [3.5, -D / 2 - 3.5, 1.4, 1.3], [6.5, -D / 2 - 8.5, 1.3, 1.3],
    [-1, -D / 2 - 10, 1.4, 1.2], [0.4, -D / 2 - 10.2, 1.2, 2.3], [-9, -D / 2 - 9, 1.2, 1.2], [9.5, -D / 2 - 3, 1.2, 2.4],
    [-5.5, 1.5, 1.4, 1.3], [-5.3, 3.2, 1.2, 2.5], [5.5, -2, 1.3, 1.2]];
  for (const [x, z, s, h] of C1) {
    solidBox(x - s / 2, 0, z - s / 2, x + s / 2, h, z + s / 2, crate);
    addBox(x - s / 2 - 0.02, h * 0.45, z - s / 2 - 0.02, x + s / 2 + 0.02, h * 0.55, z + s / 2 + 0.02, rust);
  }
  clearXF();
  setLift(0);
  if (C.flushAccs) C.flushAccs();
}
const L = (lx, lz) => xfp(makeXF(shed.x, shed.z, shed.yaw), lx, lz);

// ---------------------------------------------------------------- gunmen
const KINDS = {
  crew: { hp: 3, acc: 0.3, dmg: 8, speed: 2.6, ring: [11, 19], burst: [1, 3], cool: [1.1, 2.0] },
  heavy: { hp: 8, acc: 0.26, dmg: 13, speed: 1.7, ring: [6, 11], burst: [3, 5], cool: [1.8, 2.6], look: { shirt: "#3a2a22", sleeve: "#3a2a22", skin: "#8d5a3c", hair: "#111111", pants: "#1c1c1c", build: 1.5, bald: true } },
  rocco: { hp: 16, acc: 0.36, dmg: 11, speed: 3.0, ring: [8, 14], burst: [2, 4], cool: [0.9, 1.5], look: { shirt: "#e8e4da", sleeve: "#e8e4da", skin: "#e0b08c", hair: "#2a1d14", pants: "#d9d4c8", build: 1.3, beard: true } },
};
// nearest free spot to (x, z) (not inside a house / crate, not in the sea)
function freeSpot(x, z) {
  if (!blocked(x, z, terrainH(x, z))) return [x, z];
  for (let r = 2; r <= 14; r += 2) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
    if (!blocked(nx, nz, terrainH(nx, nz))) return [nx, nz];
  }
  return [x, z];
}
function addGoon(x0, z0, kind = "crew", o = {}) {
  const K = KINDS[kind];
  const [x, z] = freeSpot(x0, z0);
  const p = spawnGoon(x, z, { key: kind, look: K.look, heading: o.heading || 0 });
  const g = { p, kind, hp: K.hp, max: K.hp, state: o.combat ? "combat" : "idle", cool: 0.6 + Math.random(), burst: 0, burstT: 0,
    strafe: Math.random() < 0.5 ? -1 : 1, flipT: 1 + Math.random() * 2, react: o.combat ? 0.3 : 0, anchor: { x, z }, guardYaw: o.heading || 0, roam: o.roam ?? 30 };
  goons.push(g);
  return g;
}
function clearGoons(keepDead = false) {
  goons = goons.filter((g) => {
    if (keepDead && g.p.dead) return true;
    removeGoon(g.p);
    return false;
  });
}
const alive = () => goons.filter((g) => !g.p.dead);
function spawnWave1() {
  if (!shed) return;
  const y = shed.yaw + Math.PI;                       // looking inland, toward the road
  for (const [lx, lz, h] of [[-6.5, -11, 0.4], [4.8, -9.5, -0.3], [8, -14, 0], [-2, -2, 0.2], [-11, -15, 0.6]]) {
    const [x, z] = L(lx, lz);
    addGoon(x, z, "crew", { heading: y + h });
  }
}
function spawnWave2() {
  if (!shed) return;
  // they come up the hill from the town side, already shooting
  for (const [lx, lz, k] of [[-14, -42, "crew"], [-5, -46, "crew"], [6, -44, "heavy"], [14, -40, "crew"], [0, -52, "crew"], [20, -30, "crew"]]) {
    const [x, z] = L(lx, lz);
    addGoon(x, z, k, { combat: true, roam: 60 });
  }
}
function spawnShowdown() {
  if (!beach) return;
  const n = beach.n, sx = n[1], sz = -n[0];
  addGoon(beach.landX - n[0] * 4, beach.landZ - n[1] * 4, "rocco", { combat: true, roam: 40 });
  addGoon(beach.landX - n[0] * 2 + sx * 7, beach.landZ - n[1] * 2 + sz * 7, "crew", { combat: true, roam: 40 });
  addGoon(beach.landX - n[0] * 2 - sx * 7, beach.landZ - n[1] * 2 - sz * 7, "crew", { combat: true, roam: 40 });
  spawnBikashBeach();
}

// ---- the gunmen's brains
function alertAll() {
  if (triggered) return;
  triggered = true;
  for (const g of goons) if (g.state === "idle") { g.state = "combat"; g.react = 0.3 + Math.random() * 0.9; }
  if (T.stage === 1) setStage(2, "THEY'VE SEEN YOU!", "Take out Rocco's crew.");
}
function blocked(x, z, y) {
  if (seaAt(x, z)) return true;
  for (const s of query(x - 0.4, x + 0.4, z - 0.4, z + 0.4)) {
    if (s.vehicle || s.off || s.maxY <= y + 0.45 || s.minY >= y + 1.7) continue;
    if (pointIn(s, x, y + 0.9, z, 0.35)) return true;
  }
  return false;
}
function updateGoons(dt, ctx) {
  const me = ctx.pos, pv = C.playerVehicle ? C.playerVehicle() : null;
  const dead = C.playerDead ? C.playerDead() : false;
  for (const g of goons) {
    const p = g.p;
    if (p.dead) continue;
    // run over / blown up / knocked down by anything = dead
    if (p.state === "down") { kill(g, 0, 0); continue; }
    if (pv && pv.kind !== "boat" && Math.abs(pv.speed) > 5) {
      const q = pv.mesh.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) < specOf(pv).hd + 0.5) { kill(g, Math.sin(pv.heading) * pv.speed * 0.6, Math.cos(pv.heading) * pv.speed * 0.6); continue; }
    }
    const K = KINDS[g.kind];
    const dx = me.x - p.x, dz = me.z - p.z, d = Math.hypot(dx, dz) || 0.01;
    const y = terrainH(p.x, p.z);
    if (g.stagger > 0) {
      g.stagger -= dt;
      p.state = "stagger"; p.speed = 0;
      if (g.stagger <= 0) p.state = "aim";
      continue;
    }
    p.state = "aim";
    if (g.state === "idle") {
      // standing guard, glancing about; spot you close up or in clear view
      p.speed = 0;
      p.heading = g.guardYaw + Math.sin(performance.now() / 1700 + g.anchor.x) * 0.5;
      const seen = d < 12 || (d < 30 && C.shotClear && C.shotClear({ x: p.x, y: y + 1.6, z: p.z }, { x: me.x, y: me.y + 1.4, z: me.z }));
      if (seen && !dead) alertAll();
      continue;
    }
    if (g.react > 0) { g.react -= dt; p.heading = turn(p.heading, Math.atan2(dx, dz), dt * 6); continue; }
    // move: hold a ring of distance round you, sidestepping; don't wander off
    g.flipT -= dt;
    if (g.flipT <= 0) { g.strafe = -g.strafe; g.flipT = 1.5 + Math.random() * 2.5; }
    const [r0, r1] = K.ring;
    let mx = 0, mz = 0;
    const ux = dx / d, uz = dz / d;
    if (d > r1) { mx += ux; mz += uz; } else if (d < r0) { mx -= ux; mz -= uz; }
    mx += -uz * g.strafe * 0.8; mz += ux * g.strafe * 0.8;
    const fromA = Math.hypot(p.x - g.anchor.x, p.z - g.anchor.z);
    if (fromA > g.roam) { mx += (g.anchor.x - p.x) / fromA; mz += (g.anchor.z - p.z) / fromA; }
    const ml = Math.hypot(mx, mz);
    let moved = 0;
    if (ml > 0.1 && !dead) {
      const sp = K.speed * (d > r1 + 15 ? 1.4 : 1), nx = p.x + (mx / ml) * sp * dt, nz = p.z + (mz / ml) * sp * dt;
      if (!blocked(nx, nz, y)) { p.x = nx; p.z = nz; moved = sp; }
      else { g.strafe = -g.strafe; g.flipT = 1.5; }
    }
    p.speed = moved;
    p.heading = turn(p.heading, Math.atan2(dx, dz), dt * 7);
    // shoot: bursts, when there's a line of fire
    if (dead) continue;
    if (g.burst > 0) {
      g.burstT -= dt;
      if (g.burstT <= 0) { g.burst--; g.burstT = 0.16; shoot(g, d, y); }
    } else {
      g.cool -= dt;
      if (g.cool <= 0 && d < 48) {
        g.cool = K.cool[0] + Math.random() * (K.cool[1] - K.cool[0]);
        const from = { x: p.x, y: y + 1.5, z: p.z }, to = { x: me.x, y: me.y + 1.3, z: me.z };
        if (!C.shotClear || C.shotClear(from, to)) { g.burst = K.burst[0] + Math.floor(Math.random() * (K.burst[1] - K.burst[0] + 1)); g.burstT = 0; }
      }
    }
  }
}
const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
// One shot from gunman g at you: likelier to hit up close, and when you're
// standing still on the ground. Misses still crack past.
function shoot(g, d, y) {
  const p = g.p, K = KINDS[g.kind], me = lastPP;
  if (!me) return;
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  const from = { x: p.x + fx * 0.6, y: y + 1.45, z: p.z + fz * 0.6 };
  let chance = K.acc * Math.max(0.15, 1 - d / 55);
  if (pSpeed > 6) chance *= 0.55;
  if (me.y - terrainH(me.x, me.z) > 2) chance *= 0.5;             // swinging / up high
  const hit = Math.random() < chance;
  const to = hit ? { x: me.x, y: me.y + 1.1 + Math.random() * 0.5, z: me.z }
    : { x: me.x + (Math.random() - 0.5) * 3.5, y: me.y + 0.2 + Math.random() * 2.2, z: me.z + (Math.random() - 0.5) * 3.5 };
  if (C.tracer) C.tracer(new BABYLON.Vector3(from.x, from.y, from.z), new BABYLON.Vector3(to.x, to.y, to.z));
  if (C.spark) C.spark(new BABYLON.Vector3(from.x, from.y, from.z), 0.2, 0.05);
  if (C.shotSound) C.shotSound(p.x, p.z);
  if (hit && C.hurtPlayer) C.hurtPlayer(K.dmg * (0.8 + Math.random() * 0.4), (me.x - p.x) / (d || 1), (me.z - p.z) / (d || 1));
}
// a gunman hit by you (bullets: 1, punches 1, kick 2)
export function toranaHitGoon(p, dmg, fx, fz, how) {
  if (crew && p === crew.gunner && !crew.gunnerDown) {
    crew.gunnerDown = true;
    removeGoon(p);
    crew.gunner = null;
    ui.banner("GUNMAN DOWN", "The stern's clear — ram them!", 1600);
    ui.subs([{ who: "ROCCO", text: "Marco?! MARCO! ...Just drive, kid, DRIVE!", dur: 2.6 }]);
    return;
  }
  const g = goons.find((q) => q.p === p);
  if (!g || p.dead) return;
  if (g.state === "idle") alertAll();
  g.react = 0;
  g.hp -= dmg;
  if (how === "kick" || how === "punch") {
    g.stagger = how === "kick" ? 0.9 : 0.35;
    p.x += fx * (how === "kick" ? 1.4 : 0.5); p.z += fz * (how === "kick" ? 1.4 : 0.5);
  } else if (g.kind !== "heavy" && g.kind !== "rocco") g.stagger = 0.18;
  if (g.hp <= 0) kill(g, fx * 5, fz * 5);
}
function kill(g, fx, fz) {
  const p = g.p;
  if (p.dead) return;
  if (p.state !== "down") knockDown(p, fx, fz);
  p.dead = true;
  p.speed = 0;
  if (g.kind === "rocco") {
    slowUntil = performance.now() + 2200;
    ui.subs([{ who: "ROCCO", text: "...Holloway... said this'd be... easy money...", dur: 3.2 }]);
    ui.banner("ROCCO IS DOWN", "", 2600);
  } else if (g.kind === "heavy") ui.banner("THE HEAVY'S DOWN", "", 1400);
}

// ---------------------------------------------------------------- Bikash
const BIKASH_LOOK = { shirt: "#2f6f9f", sleeve: "#2f6f9f", skin: "#a8724e", hair: "#111111", pants: "#2b3348", build: 1.0 };
function spawnBikashTied() {
  if (!shed) return;
  if (bikash) removeGoon(bikash.p);
  const [x, z] = L(3.5, 2.5);
  const p = spawnGoon(x, z, { key: "bikash", look: BIKASH_LOOK, heading: shed.yaw + Math.PI });
  p.gun.setEnabled(false);
  p.state = "cower";
  bikash = { p, mode: "tied" };
}
function spawnBikashBeach() {
  if (!beach) return;
  if (bikash) removeGoon(bikash.p);
  const p = spawnGoon(beach.landX + beach.n[0] * 2, beach.landZ + beach.n[1] * 2, { key: "bikash", look: BIKASH_LOOK });
  p.gun.setEnabled(false);
  p.state = "cower";
  bikash = { p, mode: "beach" };
}
// keep a scripted (non-shooting) person animating in place
function holdPose(p, state, heading) {
  p.state = state; p.speed = 0;
  if (heading !== undefined) p.heading = heading;
}
function updateBikash(dt, ctx) {
  if (!bikash) return;
  const p = bikash.p, me = ctx.pos, d = Math.hypot(me.x - p.x, me.z - p.z);
  if (bikash.mode === "tied") {
    holdPose(p, "cower", Math.atan2(me.x - p.x, me.z - p.z));
    if (T.stage === 3 && d < 3.2) twist();
  } else if (bikash.mode === "twist") {
    holdPose(p, "aim", Math.atan2(me.x - p.x, me.z - p.z));
  } else if (bikash.mode === "run") {
    // out the back door and down the jetty to the boat
    const tgt = bikash.path[0];
    if (!tgt) { bikash.mode = "boat"; p.root.setEnabled(false); return; }
    const dx = tgt[0] - p.x, dz = tgt[1] - p.z, dd = Math.hypot(dx, dz);
    if (dd < 0.6) { bikash.path.shift(); return; }
    p.state = "flee"; p.speed = 5.2;
    p.heading = Math.atan2(dx, dz);
    p.x += (dx / dd) * 5.2 * dt; p.z += (dz / dd) * 5.2 * dt;
  } else if (bikash.mode === "beach") {
    holdPose(p, "cower", Math.atan2(me.x - p.x, me.z - p.z));
    if (T.stage === 8 && d < 4 && !bikash.asked) askAboutBikash();
  }
}
// He was never tied up.
function twist() {
  bikash.mode = "twist";
  bikash.p.gun.setEnabled(true);
  ui.subs([
    { who: "BIKASH", text: "Didi sent you? ...Of course she did. She always sends someone.", dur: 3.4 },
    { who: "YOU", text: "Get up. Your aunt's been crying since last night.", dur: 2.8 },
    { who: "BIKASH", text: "You think I'm tied up? Look closer, hero.", dur: 2.6 },
    { who: "BIKASH", text: "The temple pays in blessings. Rocco pays in cash. Sorry, friend.", dur: 3.4 },
    { who: "BIKASH", text: "(into his phone) Now, Rocco! NOW!", dur: 2.2 },
  ]);
  setTimeout(() => {
    if (!bikash || T.stage !== 3) return;
    // he bolts for the boat while the second crew comes up the hill
    const [bx, bz] = L(0, 7.5), [jx, jz] = [jetty.x - shed.n[0] * 3, jetty.z - shed.n[1] * 3];
    bikash.mode = "run";
    bikash.path = [[bx, bz], [shed.shoreX, shed.shoreZ], [jx, jz]];
    setStage(4, "BETRAYED", "Bikash set you up. Survive the ambush!");
    sfx.door && sfx.door();
  }, 14400);
}
function askAboutBikash() {
  bikash.asked = true;
  ui.subs([
    { who: "BIKASH", text: "Don't— don't shoot. Please. It was only supposed to be the torana.", dur: 3.2 },
    { who: "BIKASH", text: "Rocco said nobody gets hurt. He said Didi would never even know it was me.", dur: 3.6 },
    { who: "YOU", text: "She knows. She sent me to bring you home.", dur: 2.6 },
  ]);
  setTimeout(() => {
    ui.choice("WHAT HAPPENS TO BIKASH?", ["\"Get up. You're coming home — and you'll tell her yourself.\"", "\"Run. Don't ever come back to the valley.\""], (i) => {
      T.choice = i === 0 ? "home" : "gone";
      persist();
      if (i === 0) {
        ui.subs([{ who: "BIKASH", text: "...Okay. Okay. I'll tell her. Everything.", dur: 2.8 }]);
        bikash.mode = "follow";
      } else {
        ui.subs([{ who: "BIKASH", text: "I— thank you. Tell her... no. Don't tell her anything.", dur: 3.2 }]);
        const p = bikash.p;
        bikash.mode = "leaving";
        setTimeout(() => { if (bikash && bikash.p === p) { removeGoon(p); bikash = null; } }, 5000);
      }
      setTimeout(() => setStage(9, "YOU'VE GOT THE TORANA", "Take it home to Laxmi Didi at Durbar Square."), 2600);
    });
  }, 9600);
}
function updateBikashAfter(dt, ctx) {
  if (!bikash) return;
  const p = bikash.p, me = ctx.pos;
  if (bikash.mode === "leaving") {
    // walks off up the beach, away from you
    const dx = p.x - me.x, dz = p.z - me.z, dd = Math.hypot(dx, dz) || 1;
    p.state = "flee"; p.speed = 4;
    p.heading = Math.atan2(dx, dz);
    const nx = p.x + (dx / dd) * 4 * dt, nz = p.z + (dz / dd) * 4 * dt;
    if (!blocked(nx, nz, terrainH(nx, nz))) { p.x = nx; p.z = nz; }
  } else if (bikash.mode === "follow") {
    // tags along behind you (catches up if you drive off without him)
    const dx = me.x - p.x, dz = me.z - p.z, dd = Math.hypot(dx, dz);
    if (dd > 60) { p.x = me.x - Math.sin(Math.atan2(dx, dz)) * 3; p.z = me.z - Math.cos(Math.atan2(dx, dz)) * 3; }
    const sp = dd > 8 ? 5 : dd > 3 ? 2 : 0;
    p.state = sp > 3 ? "flee" : "walk";
    p.speed = sp;
    p.heading = Math.atan2(dx, dz);
    if (sp) {
      const nx = p.x + (dx / dd) * sp * dt, nz = p.z + (dz / dd) * sp * dt;
      if (!blocked(nx, nz, terrainH(nx, nz))) { p.x = nx; p.z = nz; }
    }
  }
}

// ---------------------------------------------------------------- Rocco's boat
const ESCAPE = [[-330, 520], [-700, 560], [-985, 620]];
const HULL = 5;
// who's on board: Rocco at the wheel, Bikash hunched in the back, a gunman
// on the stern (the one shooting at you — shoot him off and the firing stops)
let crew = null;           // { rocco, bikash, gunner, gunnerDown }
const DECK = 0.42;
function boardCrew() {
  if (crew || !boat) return;
  const p = boat.v.mesh.position;
  const rocco = spawnGoon(p.x, p.z, { key: "rocco", look: KINDS.rocco.look });
  const bk = spawnGoon(p.x, p.z, { key: "bikash", look: BIKASH_LOOK });
  bk.gun.setEnabled(false);
  const gunner = spawnGoon(p.x, p.z, { key: "crew" });
  crew = { rocco, bikash: bk, gunner, gunnerDown: false };
  placeCrew(0);
}
function dropCrew() {
  if (!crew) return;
  for (const p of [crew.rocco, crew.bikash, crew.gunner]) if (p) removeGoon(p);
  crew = null;
}
// stand them on the deck, moving with the boat
function placeCrew(dt) {
  if (!crew || !boat) return;
  const v = boat.v, b = v.mesh.position, h = v.heading;
  const fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
  const deck = b.y + DECK;
  const put = (p, along, side, state, heading) => {
    if (!p) return;
    p.x = b.x + fx * along + sx * side; p.z = b.z + fz * along + sz * side;
    p.yOff = deck;
    p.state = state; p.speed = 0;
    p.heading = heading;
  };
  const me = lastPP || b;
  put(crew.rocco, -0.35, 0.2, "walk", h);                                        // at the wheel
  put(crew.bikash, -2.0, -0.5, "cower", h + Math.PI * 0.8);                      // hunched by the rear bench
  if (!crew.gunnerDown) put(crew.gunner, -2.3, 0.45, "aim", Math.atan2(me.x - b.x, me.z - b.z));
}
function mooredBoat() {
  if (!jetty) return;
  let v = boat && boat.v;
  if (!v || !vehicles.includes(v)) {
    v = null;
    let bd = 8;
    for (const o of vehicles) {
      if (o.kind !== "boat" || o.wrecked) continue;
      const d = Math.hypot(o.mesh.position.x - jetty.x, o.mesh.position.z - jetty.z);
      if (d < bd) { bd = d; v = o; }
    }
  }
  if (!v) return;
  v.spec = { ...SPECS.boat, max: SPECS.boat.max * 0.9, accel: 7.5, turn: 1.15, label: "" };
  v.locked = true;
  v.mesh.unfreezeWorldMatrix();
  v.mesh.position.set(jetty.x, 0.045, jetty.z);
  v.heading = jetty.heading; v.speed = 0; v.vx = v.vz = 0; v.lean = 0;
  v.mesh.rotation.set(0, v.heading, 0);
  if (v.solid) v.solid.off = true;
  boat = { v, hp: HULL, state: "moored", wp: 0, stuck: 0, swerve: 0, hitCool: 0, farT: 0, gunCool: 2, way: null, unstick: 1 };
  dropCrew();
  boardCrew();
  shootables.length = 0;
  shootables.push({ box: { rot: { cx: 0, cz: 0, c: 1, s: 0 }, lx0: -1.05, lx1: 1.05, lz0: -2.95, lz1: 2.95, minY: -0.4, maxY: 1.5 }, onHit: () => hullHit(1, "HIT!") });
}
function hullHit(n, title) {
  if (!boat || boat.state === "beaching" || boat.state === "beached") return;
  if (boat.state === "moored") boatFlee();
  boat.hp -= n;
  if (boat.hp <= 0) {
    boat.state = "beaching";
    ui.subs([
      { who: "ROCCO", text: "We're taking water! Beach it — BEACH IT!", dur: 2.6 },
      { who: "BIKASH", text: "Rocco, the engine's on fire—", dur: 2.2 },
    ]);
    setStage(6, "THEY'RE RUNNING AGROUND", "Follow them onto the Saint-Clair beach.");
  } else ui.banner(title, `${boat.hp} more ${boat.hp === 1 ? "hit" : "hits"}`, 1100);
}
function boatFlee() {
  if (!boat) mooredBoat();
  if (!boat) return;
  boat.state = "fleeing"; boat.wp = 0;
  // out past the end of the jetty first (it's moored alongside it), then away
  const v = boat.v, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  boat.way = [[v.mesh.position.x + fx * 30, v.mesh.position.z + fz * 30], ...ESCAPE];
}
function updateBoat(dt, ctx) {
  if (!boat) { mooredBoat(); if (!boat) return; }
  const v = boat.v, p = v.mesh.position, me = ctx.pos;
  const box = shootables[0] && shootables[0].box;
  if (box) { box.rot.cx = p.x; box.rot.cz = p.z; box.rot.c = Math.cos(v.heading); box.rot.s = Math.sin(v.heading); box.minY = p.y - 0.4; box.maxY = p.y + 1.5; }
  const dMe = Math.hypot(p.x - me.x, p.z - me.z);
  const pv = C.playerVehicle ? C.playerVehicle() : null;
  if (boat.state === "moored") {
    if (dMe < 28 || (pv && pv.kind === "boat")) {
      boatFlee();
      ui.subs([{ who: "ROCCO", text: "Go, go, GO! Lose him in the bay!", dur: 2.4 }]);
    }
    return;
  }
  if (boat.state === "beached") return;
  // where to: open sea, or (crippled) the Saint-Clair beach
  let tx, tz;
  if (boat.state === "beaching") { tx = beach.boatX; tz = beach.boatZ; }
  else {
    const way = boat.way || ESCAPE;
    [tx, tz] = way[Math.min(boat.wp, way.length - 1)];
    if (Math.hypot(tx - p.x, tz - p.z) < (boat.wp === 0 && boat.way ? 10 : 40) && boat.wp < way.length - 1) boat.wp++;
  }
  boat.swerve += dt;
  let want = Math.atan2(tx - p.x, tz - p.z);
  if (boat.state === "fleeing" && dMe < 22) want += Math.sin(boat.swerve * 1.6) * 0.7;
  let da = Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading));
  const keys = { KeyW: true, KeyD: da > 0.08, KeyA: da < -0.08 };
  if (boat.state === "beaching") v.spec.max = SPECS.boat.max * 0.55;
  if (boat.stuck > 0) {
    // jammed against something: back straight off it...
    boat.stuck -= dt;
    keys.KeyW = false; keys.KeyS = true; keys.KeyD = keys.KeyA = false;
    if (boat.stuck <= 0) boat.dodge = 1.2;
  } else if (boat.dodge > 0) {
    // ...then come round the other way for a moment
    boat.dodge -= dt;
    keys.KeyD = boat.unstick > 0; keys.KeyA = boat.unstick < 0;
  }
  const res = driveBoat(v, dt, keys);
  if (res.impact > 0 && boat.stuck <= 0) { boat.stuck = 0.7; boat.unstick = da > 0 ? -1 : 1; }
  placeCrew(dt);
  // aground: they jump out onto the sand
  if (boat.state === "beaching" && (Math.hypot(tx - p.x, tz - p.z) < 9 || (res.impact > 0 && Math.hypot(tx - p.x, tz - p.z) < 40))) {
    boat.state = "beached";
    v.speed = 0; v.vx = v.vz = 0;
    shootables.length = 0;
    dropCrew();
    setStage(7, "SHOWDOWN", "Rocco \"the Crab\" Ferraro. End this.");
    ui.subs([
      { who: "ROCCO", text: "You've cost me a boat, a crew and a very patient buyer.", dur: 3.2 },
      { who: "ROCCO", text: "Let's see if you're worth it. Boys!", dur: 2.4 },
    ]);
    return;
  }
  // the gunman on the stern
  boat.gunCool -= dt;
  if (boat.state === "fleeing" && boat.gunCool <= 0 && dMe < 70 && crew && !crew.gunnerDown) {
    boat.gunCool = 1.3 + Math.random() * 0.9;
    const g = crew.gunner, gf = Math.sin(g.heading), gz = Math.cos(g.heading);
    const from = { x: g.x + gf * 0.6, y: (g.yOff || p.y) + 1.45, z: g.z + gz * 0.6 };
    if (C.spark) C.spark(new BABYLON.Vector3(from.x, from.y, from.z), 0.2, 0.05);
    const hit = Math.random() < 0.3 * Math.max(0.2, 1 - dMe / 70);
    const to = hit ? { x: me.x, y: me.y + 1.2, z: me.z } : { x: me.x + (Math.random() - 0.5) * 5, y: me.y + Math.random() * 2, z: me.z + (Math.random() - 0.5) * 5 };
    if (C.tracer) C.tracer(new BABYLON.Vector3(from.x, from.y, from.z), new BABYLON.Vector3(to.x, to.y, to.z));
    if (C.shotSound) C.shotSound(from.x, from.z);
    if (hit && C.hurtPlayer) C.hurtPlayer(7, (me.x - p.x) / (dMe || 1), (me.z - p.z) / (dMe || 1));
  }
  // rammed?
  boat.hitCool -= dt;
  if (pv && pv.kind === "boat" && boat.hitCool <= 0 && boat.state === "fleeing") {
    const c = specOf(v), pc = specOf(pv), q = pv.mesh.position;
    let touch = false;
    for (const a of c.circles) for (const b of pc.circles) {
      const ax = p.x + Math.sin(v.heading) * a, az = p.z + Math.cos(v.heading) * a;
      const bx = q.x + Math.sin(pv.heading) * b, bz = q.z + Math.cos(pv.heading) * b;
      if (Math.hypot(ax - bx, az - bz) < c.r + pc.r) touch = true;
    }
    if (touch) {
      const nx = (p.x - q.x) / (dMe || 1), nz = (p.z - q.z) / (dMe || 1);
      const rel = (pv.vx || 0) * nx + (pv.vz || 0) * nz - ((v.vx || 0) * nx + (v.vz || 0) * nz);
      v.vx += nx * 4; v.vz += nz * 4;
      pv.vx = (pv.vx || 0) - nx * 3; pv.vz = (pv.vz || 0) - nz * 3;
      boat.hitCool = 0.8;
      sfx.bump(Math.max(4, rel * 1.5), "vehicle");
      if (rel > 4.5) { v.speed *= 0.45; hullHit(1, "RAMMED!"); }
    }
  }
  // got away?
  boat.farT = dMe > 260 ? boat.farT + dt : 0;
  if (boat.state === "fleeing" && (p.x < -935 || boat.farT > 7)) {
    ui.banner("THEY GOT AWAY", "...but Rocco's waiting at the jetty for his money man. Get back there — try again.", 4000);
    mooredBoat();
  }
}

// ---------------------------------------------------------------- dialogue with Laxmi
export function toranaChoices(c) {
  if (c.def.id !== GIVER) return [];
  if (T.stage === 0) {
    if (!T.briefed) return [{
      label: "Didi? You look like you haven't slept.",
      go: () => {
        T.briefed = true; persist();
        speakAs(c, "The torana — the golden arch over the Taleju shrine. Three hundred years it hung there. Last night they pried it off like a bottle cap. " +
          "And Bikash — my nephew, my sister's boy — he phoned me at midnight. He said he'd followed the thieves to the old boat shed on the west shore, " +
          "and he was going to stop them himself. Then nothing. His phone just rings.", "sad", "Didi? You look like you haven't slept.");
      },
    }];
    return [
      { label: "I'll find him. And the torana.", go: () => { speakAs(c, "The torana can be replaced, babu. He can't. Bring him home. Please.", "sad", "I'll find him. And the torana."); setTimeout(() => setStage(1, "THE GOLDEN TORANA", "Get to the old boat shed on Kathmandu's west shore."), 2200); } },
      { label: "Who'd steal from a temple?", go: () => speakAs(c, "People who think the gods don't keep accounts. They do. So do I.", "angry", "Who'd steal from a temple?") },
    ];
  }
  if (T.stage < 9) return [{ label: "About Bikash…", go: () => speakAs(c, "Why are you here? The west shore, babu — go! Every minute...", "sad", "About Bikash…") }];
  if (T.stage === 9) return [{
    label: "I brought the torana back.",
    go: () => {
      const home = T.choice === "home";
      speakAs(c, home
        ? "...Bikash. Look at me. No — look at me. ...Go inside. Wash your face. We will talk when I can bear to. " +
          "(to you) You brought me back both of them. One of them I'm not sure I wanted. Thank you, babu. Take this, and this — Rocco's phone. " +
          "One name in it, over and over. 'Holloway. London.' A man who buys gods."
        : "And Bikash? ...You let him go. Maybe that was kinder than I could have been. The torana is home; my nephew is not. Ke garne. " +
          "Take this, babu. And this — Rocco's phone. One name in it, over and over. 'Holloway. London.' A man who buys gods.",
      home ? "sad" : "sad", "I brought the torana back.");
      addCash(2000);
      if (boat) {
        // Rocco's boat is yours now — wherever it ran aground
        const v = boat.v;
        v.locked = false; v.spec = SPECS.boat; v.speed = 0;
        if (v.solid) removeSolid(v.solid);
        v.solid = vehicleSolid(v);
        v.mesh.freezeWorldMatrix();
      }
      T.stage = 10; persist();
      enterStage(10, false);
      if (bikash) { removeGoon(bikash.p); bikash = null; }
      setTimeout(() => clearGoons(), 4000);
      setTimeout(() => ui.banner("MISSION COMPLETE", `+$2000 · The torana is home${home ? " — and so is Bikash" : ""}. New lead: Grant Holloway, London.`, 5600), 1400);
      setTimeout(() => ui.onDone && ui.onDone(), 7400);
    },
  }];
  return [];
}

// ---------------------------------------------------------------- per frame
export function updateTorana(dt, ctx) {
  if (T.stage >= 10) return;
  const me = ctx.pos;
  if (lastPP && dt > 0) pSpeed += (Math.hypot(me.x - lastPP.x, me.z - lastPP.z) / dt - pSpeed) * Math.min(1, dt * 6);
  lastPP = { x: me.x, y: me.y, z: me.z };
  if (T.stage === 1 && shed) {
    const d = Math.hypot(me.x - shed.x, me.z - shed.z);
    if (!overheard && d < 75) {
      overheard = true;
      ui.subs([
        { who: "THUG", text: "...Rocco says the boat goes at sundown. Not a minute after.", dur: 3 },
        { who: "THUG 2", text: "And the kid? He's been crying in there for an hour.", dur: 2.8 },
        { who: "THUG", text: "Let him cry. He's getting paid more than you are.", dur: 2.8 },
        { who: "THUG 2", text: "...Wait. Who's that?", dur: 2 },
      ]);
    }
  }
  if (T.stage >= 1 && T.stage <= 7) updateGoons(dt, ctx);
  if (T.stage === 2 && !alive().length) {
    setStage(3, "SHED CLEARED", "Find Bikash inside.");
    ui.subs([{ who: "BIKASH", text: "(from inside) H-hello? Is someone there? Help me!", dur: 3 }]);
  }
  if (T.stage === 1 || T.stage === 3) updateBikash(dt, ctx);
  if (T.stage === 4) {
    updateBikash(dt, ctx);
    if (!alive().length) {
      setStage(5, "ROCCO'S BOAT IS LEAVING", "Take the other boat at the jetty — ram them!");
      ui.subs([
        { who: "", text: "(your phone buzzes — Laxmi Didi)", dur: 2 },
        { who: "LAXMI", text: "Babu? I heard shooting from the shore. Is Bikash with you? Is he safe?", dur: 3.4 },
        { who: "YOU", text: "...He's on Rocco's boat, Didi. I'm going after him.", dur: 3 },
        { who: "LAXMI", text: "...Then go.", dur: 1.8 },
      ]);
      mooredBoat();
    }
  }
  if (T.stage >= 5 && T.stage <= 7) updateBoatStage(dt, ctx);
  if (T.stage === 7 && !alive().length) {
    setStage(8, "IT'S OVER", "Bikash is on his knees in the sand. Go to him.");
  }
  if (T.stage >= 8) updateBikashBeachStage(dt, ctx);
}
function updateBoatStage(dt, ctx) {
  if (T.stage === 5 || T.stage === 6) updateBoat(dt, ctx);
}
function updateBikashBeachStage(dt, ctx) {
  if (!bikash) return;
  if (bikash.mode === "beach") updateBikash(dt, ctx);
  else updateBikashAfter(dt, ctx);
}

export function toranaShootables() {
  return T.stage === 5 ? shootables : [];
}
export function toranaTimeScale() {
  return performance.now() < slowUntil ? 0.3 : 1;
}

// ---------------------------------------------------------------- dying + checkpoints
export function toranaRespawn() {
  const at = (x, z, yaw) => ({ x, z, yaw });
  if (shed && T.stage >= 1 && T.stage <= 2) { const [x, z] = L(0, -45); return at(x, z, shed.yaw); }
  if (shed && T.stage >= 3 && T.stage <= 4) { const [x, z] = L(0, 2); return at(x, z, shed.yaw + Math.PI); }
  if (shed && (T.stage === 5 || T.stage === 6)) return at(shed.shoreX - shed.n[0] * 3, shed.shoreZ - shed.n[1] * 3, shed.yaw);
  if (beach && T.stage === 7) return at(beach.landX - beach.n[0] * 30, beach.landZ - beach.n[1] * 30, Math.atan2(beach.n[0], beach.n[1]));
  return null;
}
export function toranaOnRespawn() {
  // restart the fight you lost
  if (T.stage === 2) { T.stage = 1; enterStage(1, false); ui.banner("THE BOAT SHED", "Try a different approach — use the crates.", 2600); }
  else if (T.stage === 3 || T.stage === 4) { if (bikash) { removeGoon(bikash.p); bikash = null; } T.stage = 4; enterStage(4, false); ui.banner("AMBUSH!", "Here they come again.", 2200); }
  else if (T.stage === 5 || T.stage === 6) { T.stage = 5; mooredBoat(); ui.banner("CATCH ROCCO'S BOAT", "They're back at the jetty.", 2200); }
  else if (T.stage === 7) { enterStage(7, false); ui.banner("SHOWDOWN", "Once more.", 2000); }
  persist();
}

// ---------------------------------------------------------------- objective + card
export function toranaObjective() {
  const c = charById(GIVER);
  const laxmi = c && c.p.state !== "away" ? { x: c.p.x, z: c.p.z, label: "Laxmi Didi", target: true } : (landmarks.ktmDurbar ? { x: landmarks.ktmDurbar.x, z: landmarks.ktmDurbar.z, label: "Durbar Square" } : null);
  if (T.stage === 0 || T.stage === 9) return laxmi;
  if (T.stage === 1 && shed) return { x: shed.x, z: shed.z, label: "Boat shed" };
  if ((T.stage === 2 || T.stage === 4 || T.stage === 7) && alive().length) {
    // the nearest enemy
    let b = null, bd = Infinity;
    for (const g of alive()) { const d = Math.hypot(g.p.x - (lastPP ? lastPP.x : 0), g.p.z - (lastPP ? lastPP.z : 0)); if (d < bd) { bd = d; b = g; } }
    return b ? { x: b.p.x, z: b.p.z, label: b.kind === "rocco" ? "Rocco" : b.kind === "heavy" ? "Heavy" : "Gunman", target: true } : null;
  }
  if (T.stage === 3 && bikash) return { x: bikash.p.x, z: bikash.p.z, label: "Bikash", target: true };
  if ((T.stage === 5 || T.stage === 6) && boat) { const p = boat.v.mesh.position; return { x: p.x, z: p.z, label: boat.state === "moored" ? "Rocco's boat" : "Rocco", target: true }; }
  if (T.stage === 8 && bikash) return { x: bikash.p.x, z: bikash.p.z, label: "Bikash", target: true };
  return null;
}
export function toranaCard() {
  const st = STAGES[Math.min(T.stage, 10)];
  let extra = "";
  if (T.stage === 2 || T.stage === 4 || T.stage === 7) {
    const a = alive();
    extra = `${a.length} left`;
    const r = a.find((g) => g.kind === "rocco");
    if (r) extra += ` · Rocco ${"█".repeat(Math.ceil((r.hp / r.max) * 8))}${"░".repeat(8 - Math.ceil((r.hp / r.max) * 8))}`;
  }
  if (T.stage === 5 && boat) extra = boat.state === "moored" ? "Get in the other boat" : `Their hull ${"●".repeat(Math.max(0, boat.hp))}${"○".repeat(HULL - Math.max(0, boat.hp))}`;
  return { name: "MISSION 1 — THE GOLDEN TORANA", title: st.title, hint: st.hint, extra, done: T.stage >= 10 };
}
