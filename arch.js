// arch.js — Mission 1: "The Golden Arch". Four acts, four cities.
//
// Last night the golden arch over the old shrine in Kathmandu's Palace
// Square was pried off and stolen. Martha Bell, who has kept the square all
// her life, is beside herself: her nephew Danny phoned to say he'd found the
// thieves at the old boat shed on the west shore. Then nothing.
//
// ACT I — KATHMANDU
//   0  Martha — the story, and a plea: bring Danny home
//   1  The boat shed (you overhear Rocco's crew)
//   2  Shootout among the crates
//   3  Find Danny — tied up in the shed... or is he?
//   4  Ambush — he set you up
//   5  Boat chase — ram Rocco's speedboat (a gunman on the stern)
//   6  They run aground on Saint-Clair's north beach
// ACT II — SAINT-CLAIR
//   7  Showdown — Rocco "the Crab" Ferraro. The boat was bait.
//   8  Danny on his knees — your call. He names the dealer: Lucien Gray.
//   9  The fountain — Lucien and his bodyguards
//  10  Car chase — stop Lucien's car before he reaches Midtown
//  11  Make him talk... and Vinnie Sour's hit squad arrives
//  12  Destroy the hit squad's two cars
// ACT III — MIDTOWN
//  13  Vinnie's yard on the Midtown docks (overhear his call)
//  14  Clear the yard — Vinnie makes a run for his truck
//  15  Truck chase — stop the armoured truck before it reaches London
//  16  Vinnie, cornered
// ACT IV — LONDON
//  17  The big wheel — Grant Holloway, the buyer
//  18  His security
//  19  Holloway — your call
//  20  Drive the arch home to Kathmandu (his last men hunt you)
//  21  Give it back to Martha
//  22  Done
// Throughout, texts from an unknown number ("A Friend") point the way...
//
// Die and you're back on your feet at the start of the fight you lost.
import {
  scene, hex, terrainH, landH, removeSolid, makeAcc, litMat, addBox, solidBox, setXF, clearXF, makeXF, xfp, setLift, query, seaAt,
} from "./engine.js";
import { landmarks, PARIS, roadDist } from "./roads.js";
import { vehicles, driveBoat, SPECS, specOf, vehicleSolid } from "./vehicles.js";
import { charById, speakAs, addCash, setGone } from "./characters.js";
import { removeGoon, knockDown, spawnGoon } from "./people.js";
import * as sfx from "./sound.js";
import {
  C, events, KINDS, addGoon, clearGoons, hostiles, aliveOf, alertAll, resetAlert, hitGoon, kill, goons,
  enemyObjective, bossBar, spawnExtra, stepToward, freeSpot, playerPos, turn,
} from "./combat.js";
import {
  spawnCar, removeCar, clearCars, releaseCar, fieldTo, nearestOnRoad, kerbSpot, roadPointAround, healthBar, cars,
} from "./roadcar.js";

const SAVE_KEY = "babylon.mission.arch.v1";
const GIVER = "laxmi";        // (Martha's id in the cast)
let T = { stage: 0 };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); if (s) T = { ...T, ...s }; } catch { /* private mode */ }
// fights and chases restart from a sensible place after a reload
const checkpoint = (s) => (s >= 1 && s <= 4 ? 1 : s >= 5 && s <= 7 ? 5 : s >= 9 && s <= 10 ? 9 : s >= 12 && s <= 16 ? 13 : s >= 17 && s <= 19 ? 17 : s > 22 ? 22 : s);
T.stage = checkpoint(T.stage);
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(T)); } catch { /* ignore */ } };
// (testing: start at a given stage)
export function archJump(stage, extra = {}) {
  T = { stage: checkpoint(stage), briefed: stage > 0, choice: stage > 8 ? "home" : undefined, holloway: stage > 19 ? "jail" : undefined, ...extra };
  persist();
}

const STAGES = [
  { title: "Talk to Martha", hint: "The caretaker of Palace Square is pacing by the palace. Walk up and press T.", act: "I · KATHMANDU" },
  { title: "The old boat shed", hint: "West shore of Kathmandu, by the jetty. Danny said the thieves are there.", act: "I · KATHMANDU" },
  { title: "Take out Rocco's crew", hint: "Use the crates for cover. Q to punch — three in a row is a kick. F switches gun / web.", act: "I · KATHMANDU" },
  { title: "Find Danny", hint: "He should be inside the shed.", act: "I · KATHMANDU" },
  { title: "Ambush!", hint: "Danny set you up. Survive — Rocco's boat won't leave without its cover.", act: "I · KATHMANDU" },
  { title: "Catch Rocco's boat", hint: "Take the other boat at the jetty and ram them. Watch the gunman on the stern.", act: "I · KATHMANDU" },
  { title: "They're running aground", hint: "Rocco's making for the Saint-Clair beach. Follow him in.", act: "I · KATHMANDU" },
  { title: "Showdown", hint: "Rocco \"the Crab\" Ferraro and his last men, on the beach.", act: "II · SAINT-CLAIR" },
  { title: "Danny", hint: "He's on his knees in the sand. Go to him.", act: "II · SAINT-CLAIR" },
  { title: "Find Lucien Gray", hint: "Grey suit, silver hair — by the fountain in Saint-Clair. He has the arch's trail.", act: "II · SAINT-CLAIR" },
  { title: "Stop Lucien's car", hint: "Ram it off the road, or get out and shoot it. Don't lose him.", act: "II · SAINT-CLAIR" },
  { title: "Make Lucien talk", hint: "He's crawling out of the wreck.", act: "II · SAINT-CLAIR" },
  { title: "Vinnie's hit squad", hint: "Two cars of gunmen. Destroy them — ram them, or shoot from cover.", act: "II · SAINT-CLAIR" },
  { title: "Vinnie's yard", hint: "The container yard on the Midtown docks, north-west corner.", act: "III · MIDTOWN" },
  { title: "Clear the yard", hint: "Vinnie Sour and his crew, among the containers.", act: "III · MIDTOWN" },
  { title: "Stop the armoured truck", hint: "Vinnie's running for London with the arch. Ram it — it's heavy, keep hitting.", act: "III · MIDTOWN" },
  { title: "Vinnie, cornered", hint: "Finish this.", act: "III · MIDTOWN" },
  { title: "Find Grant Holloway", hint: "The buyer. He's waiting by the big wheel in London.", act: "IV · LONDON" },
  { title: "Holloway's security", hint: "Private guards in black. Take them down.", act: "IV · LONDON" },
  { title: "Holloway", hint: "He's cowering by the wheel. Decide what happens to him.", act: "IV · LONDON" },
  { title: "Drive the arch home", hint: "Get in Vinnie's truck and drive it back to Palace Square in Kathmandu. They'll come after you.", act: "IV · HOME" },
  { title: "Give it back to Martha", hint: "She's waiting by the empty shrine. Press T.", act: "IV · HOME" },
  { title: "Mission complete", hint: "The arch is home.", act: "" },
];
const DONE = 22;
export const archDone = () => T.stage >= DONE;
export const archState = () => T;

let ui = { banner: () => {}, subs: () => {}, choice: () => {}, text: () => {}, clearSubs: () => {} };
let shed = null, jetty = null, beach = null, fountain = null, yard = null;
let danny = null;               // { p, mode }
let lucien = null;              // { p, mode }
let holloway = null;            // goon
let boat = null, crew = null;
let lucienCar = null, truck = null, escort = null, archV = null;
let hunters = [], huntWave = 0, huntT = 0, inTruckOnce = false;
let slowUntil = 0, overheard = false, talkBusy = false, pausing = false;
const timers = [];
const later = (ms, fn) => { const id = setTimeout(() => { const i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); fn(); }, ms); timers.push(id); return id; };
const cancelTimers = () => { while (timers.length) clearTimeout(timers.pop()); };
const shootList = [];
const me = () => playerPos() || { x: 0, y: 0, z: 0 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------- setup
export function initArch(opts) {
  ui = opts;
  const ms = opts.moorings || [];
  // Kathmandu's jetty (the shed), Saint-Clair's (the beach), Midtown's (Vinnie's yard)
  const ktm = ms.filter((m) => m.x < -150 && m.z > 600);
  const par = ms.filter((m) => Math.hypot(m.x + 560, m.z - 377) < 60);
  const mid = ms.filter((m) => Math.hypot(m.x + 150, m.z - 470) < 140);
  if (ktm.length) {
    jetty = ktm[0];
    const n = [Math.sin(jetty.heading), Math.cos(jetty.heading)];
    const ax = ktm.reduce((a, m) => a + m.x, 0) / ktm.length, az = ktm.reduce((a, m) => a + m.z, 0) / ktm.length;
    const sx = ax - n[0] * 9, sz = az - n[1] * 9;
    const cx = sx - n[0] * 17, cz = sz - n[1] * 17;
    shed = { x: cx, z: cz, yaw: jetty.heading, lift: landH(cx, cz), n, side: [n[1], -n[0]], shoreX: sx, shoreZ: sz };
    buildShed();
  }
  if (par.length) {
    const m = par[0], n = [Math.sin(m.heading), Math.cos(m.heading)];
    const ax = par.reduce((a, q) => a + q.x, 0) / par.length, az = par.reduce((a, q) => a + q.z, 0) / par.length;
    const sx = ax - n[0] * 9 + n[1] * 32, sz = az - n[1] * 9 - n[0] * 32;
    beach = { boatX: sx + n[0] * 7, boatZ: sz + n[1] * 7, landX: sx - n[0] * 7, landZ: sz - n[1] * 7, n };
  } else beach = { boatX: -560, boatZ: 385, landX: -560, landZ: 355, n: [0, 1] };
  // the fountain in Saint-Clair: Lucien on the pavement, his car at the kerb
  const k = kerbSpot(PARIS.x - 50, PARIS.z - 6, 0.55);
  fountain = { ...k, carS: Math.min(k.e.len - 4, Math.max(4, k.s + 7)) };
  buildYard(mid);
  // characters the story has already finished with
  if (T.stage >= 13) setGone("vinnie");
  if (T.stage >= 17) setGone("grant");
  enterStage(T.stage, true);
}
function setStage(s, title, sub, ms = 3600) {
  T.stage = s;
  persist();
  enterStage(s, false);
  ui.banner(title || STAGES[s].title.toUpperCase(), sub ?? (s < DONE ? STAGES[s].hint : ""), ms);
}
// what each stage needs in the world
function enterStage(s, loading) {
  events.alert = onAlert;
  events.kill = onKill;
  pausing = false;
  events.vipHit = null;
  const g = charById(GIVER);
  if (g && s < DONE) g.forceSlot = { spot: "durbar", pose: s === 0 ? "inspect" : "lean", doing: s === 0 ? "pacing in front of the empty shrine" : s >= 20 ? "waiting by the empty shrine" : "waiting for news of Danny" };
  if (s === 1) { clearAll(); spawnWave1(); spawnDannyTied(); overheard = false; }
  if (s === 4) { clearGoons(true); spawnWave2(); }
  if (s === 5) { mooredBoat(); if (danny) { removeGoon(danny.p); danny = null; } }
  if (s !== 5 && s !== 6) dropCrew();
  if (s === 7) { clearGoons(); spawnShowdown(); }
  if (s === 8 && loading) { clearGoons(); spawnDannyBeach(); }
  if (s === 9) { clearAll(); spawnFountain(); }
  if (s === 11) spawnLucienWreck(loading);
  if (s === 13) { clearAll(); setGone("vinnie"); T.vinnieDead = false; T.vinnieHp = 0; spawnYard(); overheard = false; }
  if (s === 15 && loading) { /* (never loaded straight into a chase) */ }
  if (s === 17) { clearAll(true); setGone("grant"); spawnWheel(); overheard = false; }
  if (s === 20) { clearGoons(); startDriveHome(loading); }
  if (s === 21) { clearAll(); }
  if (s >= DONE) {
    clearGoons(); clearCars();
    if (g) g.forceSlot = null;
    if (danny) { const d = danny; danny = null; later(20000, () => removeGoon(d.p)); }
  }
}
function clearAll(keepTruck = false) {
  clearGoons();
  const keep = keepTruck && truck && truck.state === "stopped" ? truck : null;
  for (const c of cars.slice()) if (c !== keep) removeCar(c);
  lucienCar = escort = null; hunters = [];
  truck = keep;
  if (danny) { removeGoon(danny.p); danny = null; }
  if (lucien) { removeGoon(lucien.p); lucien = null; }
  holloway = null;
  talkBusy = false;
  resetAlert();
}

// ---------------------------------------------------------------- the boat shed (Kathmandu)
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
  solidBox(-W / 2, -1, D / 2 - 0.25, -1.4, H, D / 2, metal);
  solidBox(1.4, -1, D / 2 - 0.25, W / 2, H, D / 2, metal);
  solidBox(-1.4, 2.6, D / 2 - 0.25, 1.4, H, D / 2, metal);
  solidBox(-W / 2, -1, -D / 2, -W / 2 + 0.25, H, D / 2, metal);
  solidBox(W / 2 - 0.25, -1, -D / 2, W / 2, H, D / 2, metal);
  solidBox(-W / 2, H - 1.2, -D / 2, W / 2, H, -D / 2 + 0.25, rust);
  solidBox(-W / 2 - 0.4, H, -D / 2 - 0.4, W / 2 + 0.4, H + 0.3, D / 2 + 0.4, roof);
  for (const x of [-4, 4]) addBox(x - 0.25, H - 0.55, -0.25, x + 0.25, H - 0.4, 0.25, lampA);
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

// ---------------------------------------------------------------- Vinnie's container yard (Midtown docks)
// A clear patch of ground near the Midtown jetty: shipping containers to fight
// among, a site office, floodlights.
function buildYard(mid) {
  let sx = -150, sz = 470, n = [-1, 0];
  if (mid.length) {
    const m = mid[0];
    n = [Math.sin(m.heading), Math.cos(m.heading)];
    const ax = mid.reduce((a, q) => a + q.x, 0) / mid.length, az = mid.reduce((a, q) => a + q.z, 0) / mid.length;
    sx = ax - n[0] * 9; sz = az - n[1] * 9;
  }
  const side = [n[1], -n[0]];
  const yaw = Math.atan2(n[0], n[1]);
  // find a 26 × 20 patch with nothing on it (no road, no building, no sea)
  const free = (cx, cz) => {
    const xf = makeXF(cx, cz, yaw);
    for (let lx = -13; lx <= 13; lx += 3.25) for (let lz = -10; lz <= 10; lz += 3.3) {
      const [x, z] = xfp(xf, lx, lz);
      if (seaAt(x, z) || roadDist(x, z) < 0.5) return false;
      for (const s of query(x - 1.5, x + 1.5, z - 1.5, z + 1.5)) if (s.maxY > 0.4 && !s.vehicle) return false;
    }
    return true;
  };
  let best = null;
  for (let back = 14; back <= 70 && !best; back += 4) {
    for (const lat of [0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40]) {
      const cx = sx - n[0] * back + side[0] * lat, cz = sz - n[1] * back + side[1] * lat;
      if (free(cx, cz)) { best = [cx, cz]; break; }
    }
  }
  if (!best) best = [sx - n[0] * 26, sz - n[1] * 26];
  const [cx, cz] = best;
  yard = { x: cx, z: cz, yaw, n };
  const red = makeAcc("yardRed", litMat("yardRedM", hex("#8e2b22"), 0.12));
  const blue = makeAcc("yardBlue", litMat("yardBlueM", hex("#24507a"), 0.12));
  const green = makeAcc("yardGreen", litMat("yardGreenM", hex("#2f6a45"), 0.12));
  const grey = makeAcc("yardGrey", litMat("yardGreyM", hex("#6d7277"), 0.12));
  const rib = makeAcc("yardRib", litMat("yardRibM", hex("#2a2c2f"), 0.2));
  const office = makeAcc("yardOffice", litMat("yardOfficeM", hex("#d7d2c4"), 0.05));
  const crate = makeAcc("yardCrate", litMat("yardCrateM", hex("#8a6a42"), 0.04));
  const lampA = makeAcc("yardLamp", (() => { const m = new BABYLON.StandardMaterial("yardLampM", scene); m.disableLighting = true; m.emissiveColor = hex("#fff1c8"); return m; })());
  lampA.glow = true;
  setXF(makeXF(cx, cz, yaw));
  // containers: [x, z, along-x?, colour, stacked]
  const box = (x, z, alongX, mat, h0 = 0) => {
    const hw = alongX ? 3.05 : 1.22, hd = alongX ? 1.22 : 3.05;
    solidBox(x - hw, h0, z - hd, x + hw, h0 + 2.6, z + hd, mat);
    for (const k of [-0.7, 0, 0.7]) addBox(x - hw - 0.03, h0 + 0.2, z - hd - 0.03 + (alongX ? 0 : (k + 0.7) * hd * 0.7), x + hw + 0.03, h0 + 2.4, z - hd + 0.12 + (alongX ? 0 : (k + 0.7) * hd * 0.7), rib);
  };
  box(-8, -5, true, red); box(-8, -5, true, blue, 2.6);
  box(7.5, -6, false, blue);
  box(0, 3, true, green);
  box(-3, -13, false, red);
  box(9, 5.5, true, grey); box(9, 5.5, true, red, 2.6);
  box(-10, 6, false, grey);
  // the site office at the back (sea side), and some crates
  solidBox(-3, 0, 8.2, 3, 3, 11, office);
  addBox(-3.1, 3, 8.1, 3.1, 3.2, 11.1, rib);
  for (const [x, z, s] of [[4, -1, 1.3], [-4.5, 0, 1.2], [2.5, -9, 1.3], [-12, -1, 1.2], [12.5, -2, 1.3]]) solidBox(x - s / 2, 0, z - s / 2, x + s / 2, s, z + s / 2, crate);
  // floodlight poles
  for (const [x, z] of [[-12.5, -9.5], [12.5, 9.5]]) {
    solidBox(x - 0.15, 0, z - 0.15, x + 0.15, 8, z + 0.15, rib);
    addBox(x - 0.6, 8, z - 0.3, x + 0.6, 8.5, z + 0.3, lampA);
  }
  clearXF();
  if (C.flushAccs) C.flushAccs();
}
const Y = (lx, lz) => xfp(makeXF(yard.x, yard.z, yard.yaw), lx, lz);

// ---------------------------------------------------------------- the waves
function spawnWave1() {
  if (!shed) return;
  const y = shed.yaw + Math.PI;
  for (const [lx, lz, h] of [[-6.5, -11, 0.4], [4.8, -9.5, -0.3], [8, -14, 0], [-2, -2, 0.2], [-11, -15, 0.6]]) {
    const [x, z] = L(lx, lz);
    addGoon(x, z, "crew", { heading: y + h });
  }
}
function spawnWave2() {
  if (!shed) return;
  for (const [lx, lz, k] of [[-14, -42, "crew"], [-5, -46, "crew"], [6, -44, "heavy"], [14, -40, "crew"], [0, -52, "crew"], [20, -30, "crew"], [-20, -34, "rifle"]]) {
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
  addGoon(beach.landX - n[0] * 14 + sx * 3, beach.landZ - n[1] * 14 + sz * 3, "heavy", { combat: true, roam: 40 });
  spawnDannyBeach();
}
function spawnYard() {
  if (!yard) return;
  const face = yard.yaw + Math.PI;                 // looking inland, toward the street
  for (const [lx, lz, k, h] of [[-6, -9, "crew", 0.3], [4, -10, "crew", -0.2], [11, -11, "crew", 0], [-12, -12, "crew", 0.5], [0, -2, "heavy", 0],
    [6, 1, "crew", 0.2], [-6, 2.5, "rifle", 0], [12, 2, "heavy", -0.3]]) {
    const [x, z] = Y(lx, lz);
    addGoon(x, z, k, { heading: face + h, roam: 26 });
  }
  const [vx, vz] = Y(0, 6.5);
  addGoon(vx, vz, "vinnie", { heading: face, roam: 14 });
  // the armoured truck at the nearest kerb
  const k = kerbSpot(yard.x, yard.z, 0);
  truck = spawnCar("truck", k.x, k.z, { mode: "parked", at: { e: k.e, s: k.s }, heading: k.side > 0 ? k.yaw : k.yaw + Math.PI, lane: k.e.w / 2 - 1.6, hp: 24, top: 23, label: "Armoured truck", explodes: false });
}
function spawnWheel() {
  const w = landmarks.wheel;
  if (!w) return;
  // the land side of the wheel (+n), guards spread along the river walk
  const at = (along, out) => [w.x + w.tx * along + w.nx * out, w.z + w.tz * along + w.nz * out];
  const face = Math.atan2(-w.nx, -w.nz);
  const [hx, hz] = at(0, 16);
  holloway = addGoon(hx, hz, "holloway", { heading: face, roam: 6 });
  holloway.hold = true;
  holloway.p.state = "walk";
  for (const [a, o, k] of [[-10, 20, "guard"], [10, 20, "guard"], [-20, 26, "guard"], [20, 25, "guard"], [0, 30, "heavy"], [-30, 18, "guard"], [30, 18, "heavy"], [0, 42, "rifle"], [16, 38, "guard"]]) {
    const [x, z] = at(a, o);
    addGoon(x, z, k, { heading: face + Math.PI, roam: 30 });
  }
}

// ---------------------------------------------------------------- combat events
function onAlert() {
  if (T.stage === 1) setStage(2, "THEY'VE SEEN YOU!", "Take out Rocco's crew.");
  else if (T.stage === 13) setStage(14, "CLEAR THE YARD", "Vinnie Sour and his crew. The arch is here somewhere.");
  else if (T.stage === 17) {
    if (holloway) holloway.hold = false;
    setStage(18, "HOLLOWAY'S SECURITY", "Take them down. Holloway isn't going anywhere.");
  }
}
function onKill(g) {
  if (g.kind === "rocco") {
    slowUntil = performance.now() + 2200;
    ui.subs([
      { who: "ROCCO", text: "Heh... you think it was ever... on the boat?", dur: 2.8 },
      { who: "ROCCO", text: "The boat was bait, hero. The arch went by road... before dawn...", dur: 3.4 },
    ]);
    ui.banner("ROCCO IS DOWN", "", 2600);
  } else if (g.kind === "vinnie") {
    if (T.stage === 14) { T.vinnieDead = true; persist(); }
    slowUntil = performance.now() + 2400;
    ui.banner("VINNIE IS DOWN", "", 2600);
  } else if (g.kind === "holloway") {
    T.holloway = "dead"; persist();
    ui.banner("HOLLOWAY IS DOWN", "", 2400);
  } else if (g.kind === "heavy") ui.banner("THE HEAVY'S DOWN", "", 1400);
}

// ---------------------------------------------------------------- Danny
const DANNY_LOOK = { shirt: "#2f6f9f", sleeve: "#2f6f9f", skin: "#c9946a", hair: "#3a2414", pants: "#2b3348", build: 1.0 };
function spawnDannyTied() {
  if (!shed) return;
  if (danny) removeGoon(danny.p);
  const [x, z] = L(3.5, 2.5);
  danny = { p: spawnExtra(x, z, "danny", DANNY_LOOK, shed.yaw + Math.PI), mode: "tied" };
}
function spawnDannyBeach() {
  if (!beach) return;
  if (danny) removeGoon(danny.p);
  danny = { p: spawnExtra(beach.landX + beach.n[0] * 2, beach.landZ + beach.n[1] * 2, "danny", DANNY_LOOK), mode: "beach" };
}
const holdPose = (p, state, heading) => { p.state = state; p.speed = 0; if (heading !== undefined) p.heading = heading; };
function updateDanny(dt, pos) {
  if (!danny) return;
  const p = danny.p, d = dist(pos, p);
  if (danny.mode === "tied") {
    holdPose(p, "cower", Math.atan2(pos.x - p.x, pos.z - p.z));
    if (T.stage === 3 && d < 3.2) twist();
  } else if (danny.mode === "twist") {
    holdPose(p, "aim", Math.atan2(pos.x - p.x, pos.z - p.z));
  } else if (danny.mode === "run") {
    const tgt = danny.path[0];
    if (!tgt) { danny.mode = "boat"; p.root.setEnabled(false); return; }
    const dd = Math.hypot(tgt[0] - p.x, tgt[1] - p.z);
    if (dd < 0.6) { danny.path.shift(); return; }
    p.state = "flee"; p.speed = 5.2;
    p.heading = Math.atan2(tgt[0] - p.x, tgt[1] - p.z);
    p.x += ((tgt[0] - p.x) / dd) * 5.2 * dt; p.z += ((tgt[1] - p.z) / dd) * 5.2 * dt;
  } else if (danny.mode === "beach") {
    holdPose(p, "cower", Math.atan2(pos.x - p.x, pos.z - p.z));
    if (T.stage === 8 && d < 4 && !danny.asked) askAboutDanny();
  } else if (danny.mode === "leaving") {
    const dx = p.x - pos.x, dz = p.z - pos.z, dd = Math.hypot(dx, dz) || 1;
    stepToward(p, p.x + (dx / dd) * 5, p.z + (dz / dd) * 5, danny.speed || 4, dt, "flee");
  }
}
// He was never tied up.
function twist() {
  danny.mode = "twist";
  danny.p.gun.setEnabled(true);
  ui.subs([
    { who: "DANNY", text: "Auntie sent you? ...Of course she did. She always sends someone.", dur: 3.4 },
    { who: "YOU", text: "Get up. She's been crying since last night.", dur: 2.6 },
    { who: "DANNY", text: "You think I'm tied up? Look closer, hero.", dur: 2.6 },
    { who: "DANNY", text: "The temple pays in blessings. Rocco pays in cash. Sorry, friend.", dur: 3.4 },
    { who: "DANNY", text: "(into his phone) Now, Rocco! NOW!", dur: 2.2 },
  ], () => {
    if (!danny || T.stage !== 3) return;
    const [bx, bz] = L(0, 7.5), [jx, jz] = [jetty.x - shed.n[0] * 3, jetty.z - shed.n[1] * 3];
    danny.mode = "run";
    danny.path = [[bx, bz], [shed.shoreX, shed.shoreZ], [jx, jz]];
    setStage(4, "BETRAYED", "Danny set you up. Survive the ambush!");
    sfx.door();
  });
}
function askAboutDanny() {
  danny.asked = true;
  ui.subs([
    { who: "DANNY", text: "Don't— don't shoot. Please. It was only supposed to be the arch.", dur: 3.2 },
    { who: "YOU", text: "Where is it, Danny? It wasn't on that boat.", dur: 2.6 },
    { who: "DANNY", text: "No... the boat was to pull you away. We loaded the arch into a van at dawn.", dur: 3.6 },
    { who: "DANNY", text: "It went to a dealer in Saint-Clair. Lucien Gray. Silver hair, grey suit. He sells to people in London.", dur: 4.2 },
    { who: "DANNY", text: "Rocco said nobody would get hurt. He said Auntie would never even know it was me.", dur: 3.6 },
    { who: "YOU", text: "She knows. She sent me to bring you home.", dur: 2.6 },
  ], () => {
    ui.choice("WHAT HAPPENS TO DANNY?", ["\"Go home. Tell her everything yourself — tonight.\"", "\"Run. Don't ever come back to the valley.\""], (i) => {
      T.choice = i === 0 ? "home" : "gone";
      persist();
      const p = danny.p;
      danny.mode = "leaving"; danny.speed = i === 0 ? 3 : 4.5;
      later(6000, () => { if (danny && danny.p === p) { removeGoon(p); danny = null; } });
      ui.subs([i === 0
        ? { who: "DANNY", text: "...Okay. Okay. I'll tell her. Everything. I swear.", dur: 2.8 }
        : { who: "DANNY", text: "I— thank you. Tell her... no. Don't tell her anything.", dur: 3.2 }], () => {
        ui.text("UNKNOWN NUMBER", "Lucien Gray is at the Saint-Clair fountain right now. He's packing up to leave. Hurry. — A Friend");
        ui.subs([{ who: "YOU", text: "\"A Friend\"? ...Who is this?", dur: 2.4 }, { who: "", text: "(no reply)", dur: 1.8 }],
          () => setStage(9, "ACT II · SAINT-CLAIR", "Find Lucien Gray at the fountain.", 4200));
      });
    });
  });
}

// ---------------------------------------------------------------- Lucien Gray, the dealer (Saint-Clair)
const LUCIEN_LOOK = { shirt: "#8a8f96", sleeve: "#8a8f96", skin: "#e8c4a2", hair: "#d8d4cc", pants: "#6e737a", build: 1.05 };
function spawnFountain() {
  if (!fountain) return;
  const f = fountain;
  lucien = { p: spawnExtra(f.x, f.z, "lucien", LUCIEN_LOOK, f.face), mode: "idle" };
  lucien.p.state = "walk"; lucien.p.speed = 0;
  // bodyguards either side
  const ax = Math.sin(f.yaw), az = Math.cos(f.yaw);
  for (const k of [-4, 5, -9]) addGoon(f.x + ax * k, f.z + az * k, "guard", { heading: f.face + Math.PI, roam: 25 });
  // his car at the kerb
  const sideHeading = f.side > 0 ? f.yaw : f.yaw + Math.PI;
  lucienCar = spawnCar("grey", f.x, f.z, { mode: "parked", at: { e: f.e, s: f.carS }, heading: sideHeading, lane: f.e.w / 2 - 1.2, hp: 14, top: 27, label: "Lucien's car" });
  lucienCar.onShotParked = () => { if (lucien && lucien.mode === "idle") lucienBolts(); };
}
function lucienBolts() {
  if (!lucien || lucien.mode !== "idle") return;
  lucien.mode = "run";
  alertAll();
  ui.subs([
    { who: "LUCIEN", text: "You! From the beach— No, no, no. Stop him! STOP HIM!", dur: 2.8 },
  ]);
}
function startLucienChase() {
  if (lucien) { removeGoon(lucien.p); lucien = null; }
  const c = lucienCar;
  if (!c) return;
  c.lane = null;
  c.mode = "goal"; c.state = "drive"; c.rubber = true;
  c.goal = fieldTo(yard ? yard.x : -100, yard ? yard.z : 400);
  c.next = null;
  c.onDisabled = () => { setStage(11, "LUCIEN'S CAR IS DONE", "He's crawling out. Make him talk."); };
  c.onArrive = () => chaseFailed(9, "LUCIEN MADE IT TO MIDTOWN", "He's back at the fountain with fresh bodyguards... (try again)");
  c.onEscape = () => chaseFailed(9, "YOU LOST HIM", "Back to the fountain — he'll be back for his things.");
  sfx.door();
  setStage(10, "HE'S GETTING AWAY!", "Stop Lucien's car before he reaches Midtown.");
}
function chaseFailed(stage, title, sub) {
  cancelTimers();
  ui.clearSubs();
  setStage(stage, title, sub, 4200);
}
// Lucien crawls out of his stopped car (after a reload: the car's where it
// stopped, smoking, and he's still beside it).
function spawnLucienWreck(loading) {
  if (loading || !lucienCar) {
    clearAll();
    const a = T.lucienAt || fountain || me();
    const at = nearestOnRoad(a.x, a.z);
    lucienCar = spawnCar("grey", 0, 0, { at, mode: "parked", hp: 14, label: "Lucien's car", explodes: false });
    lucienCar.wantSmoke = true;          // (added on the first frame — the effects aren't built yet while loading)
  }
  const v = lucienCar.v, p = v.mesh.position, h = v.heading;
  T.lucienAt = { x: p.x, z: p.z }; persist();
  // out of the driver's door, a couple of steps from the car
  const [x, z] = freeSpot(p.x - Math.cos(h) * 2.6, p.z + Math.sin(h) * 2.6);
  if (lucien) removeGoon(lucien.p);
  lucien = { p: spawnExtra(x, z, "lucien", LUCIEN_LOOK, h + Math.PI / 2), mode: "wreck" };
  talkBusy = false;
}
function lucienTalk() {
  if (talkBusy) return;
  talkBusy = true;
  ui.subs([
    { who: "LUCIEN", text: "Enough! ENOUGH! I'm only the middleman!", dur: 2.4 },
    { who: "YOU", text: "Where's the arch?", dur: 1.8 },
    { who: "LUCIEN", text: "Collateral! Grant Holloway owes Vinnie Sour a fortune — the man borrowed half of London from him.", dur: 4 },
    { who: "LUCIEN", text: "Vinnie keeps the arch in his yard on the Midtown docks until Holloway pays.", dur: 3.4 },
    { who: "LUCIEN", text: "Tonight it goes to London, paid or not. And Vinnie hates loose ends, so if he finds out I talked—", dur: 3.8 },
  ], () => {
    if (T.stage !== 11) return;
    // the hit squad arrives
    const pos = me();
    const spawnHunter = (dd) => {
      const at = roadPointAround(pos.x, pos.z, dd);
      if (!at) return null;
      const c = spawnCar("suv", 0, 0, { at, mode: "chase", gunners: 2, hp: 9, top: 30, label: "Hit squad", stopAt: 15 });
      c.onWrecked = () => checkHunters();
      return c;
    };
    hunters = [spawnHunter(120), spawnHunter(160)].filter(Boolean);
    // a shot from the street — Lucien falls
    if (lucien) {
      const p = lucien.p, from = hunters[0] ? hunters[0].v.mesh.position : { x: p.x + 30, z: p.z + 30 };
      const V = BABYLON.Vector3, y = terrainH(p.x, p.z);
      if (C.tracer) C.tracer(new V(p.x + (from.x - p.x) * 0.15, y + 1.6, p.z + (from.z - p.z) * 0.15), new V(p.x, y + 1.2, p.z));
      if (C.shotSound) C.shotSound(p.x + 20, p.z);
      knockDown(p, (p.x - from.x) * 0.05, (p.z - from.z) * 0.05);
      p.dead = true;
    }
    ui.subs([{ who: "", text: "(a gunshot — Lucien drops)", dur: 1.8 }, { who: "YOU", text: "...Vinnie's men. Already.", dur: 2.2 }]);
    setStage(12, "VINNIE'S HIT SQUAD", "Two cars of gunmen. Destroy them.");
  });
}
function checkHunters() {
  if (T.stage === 12 && hunters.every((c) => c.state === "wrecked")) {
    later(1800, () => {
      ui.text("UNKNOWN NUMBER", "Vinnie's yard: the container yard on the Midtown docks, north-west corner. Nine men, maybe more. — A Friend");
      setStage(13, "ACT III · MIDTOWN", "Vinnie Sour's container yard, on the Midtown docks.", 4200);
    });
  }
}

// ---------------------------------------------------------------- Vinnie (Midtown)
function vinnieRun() {
  const v = aliveOf("vinnie")[0];
  if (!v || !truck || v.running) return;
  v.running = true; v.hold = true; v.invulnerable = true; v.runT = 0;
  T.vinnieHp = v.hp; persist();
  ui.subs([{ who: "VINNIE", text: "Forget the yard — get the truck moving! MOVE!", dur: 2.6 }]);
  ui.banner("VINNIE'S RUNNING FOR THE TRUCK", "", 2000);
}
function startTruck() {
  const v = aliveOf("vinnie")[0];
  if (v) { removeGoon(v.p); goons.splice(goons.indexOf(v), 1); }
  const c = truck;
  if (!c) return;
  c.lane = null; c.mode = "goal"; c.state = "drive"; c.rubber = true; c.gunners = 1;
  const sq = (landmarks.londonSquares || [])[0] || { x: 1000, z: 0 };
  c.goal = fieldTo(sq.x, sq.z);
  c.next = null;
  c.onDisabled = () => truckStopped();
  c.onArrive = () => chaseFailed(13, "VINNIE MADE IT TO LONDON", "The arch is gone... (try again — back to the yard)");
  c.onEscape = () => chaseFailed(13, "YOU LOST THE TRUCK", "Back to the yard — try again.");
  // an escort follows the truck out and comes after you
  const at = { e: c.e, s: Math.max(1, Math.min(c.e.len - 1, c.s - c.dir * 14)) };
  escort = spawnCar("suv", 0, 0, { at, mode: "chase", gunners: 2, hp: 8, top: 31, label: "Escort", stopAt: 15 });
  sfx.door();
  setStage(15, "THE TRUCK'S MOVING!", "Stop it before it reaches London. Ram it — over and over.");
}
function truckStopped() {
  if (T.stage !== 15) return;
  const p = truck.v.mesh.position, h = truck.v.heading;
  const sx = Math.cos(h), sz = -Math.sin(h);
  clearGoons();
  if (!T.vinnieDead) {
    const vg = addGoon(p.x + sx * 3.2, p.z + sz * 3.2, "vinnie", { combat: true, roam: 30 });
    if (T.vinnieHp) vg.hp = Math.max(6, T.vinnieHp);
  } else addGoon(p.x + sx * 3.2, p.z + sz * 3.2, "heavy", { combat: true, roam: 30 });
  addGoon(p.x - sx * 3.2, p.z - sz * 3.2, "crew", { combat: true, roam: 30 });
  addGoon(p.x - Math.sin(h) * 6, p.z - Math.cos(h) * 6, "crew", { combat: true, roam: 30 });
  ui.subs([T.vinnieDead ? { who: "DRIVER", text: "Vinnie's dead and I ain't dying for his gold! ...Unless you make me.", dur: 3 } : { who: "VINNIE", text: "You've got any idea what that cost me?! You want the arch? COME AND GET IT!", dur: 3.2 }]);
  setStage(16, "VINNIE, CORNERED", "Finish this.");
}

// ---------------------------------------------------------------- the drive home
function startDriveHome(loading) {
  const keep = !loading && truck && truck.state === "stopped" ? truck : null;
  for (const c of cars.slice()) if (c !== keep) removeCar(c);
  hunters = []; huntWave = 0; huntT = 0; inTruckOnce = false;
  if (keep) { archV = releaseCar(keep); truck = null; }
  else {
    // Vinnie's truck: where you left it (or, failing that, at the edge of London)
    const at = T.truckAt ? nearestOnRoad(T.truckAt.x, T.truckAt.z) : nearestOnRoad(770, 30, (e) => e.len > 30 && e.w >= 9);
    const c = spawnCar("truck", 0, 0, { at, mode: "parked", hp: 99, label: "Vinnie's truck", explodes: false, lane: at.e.w / 2 - 1.6 });
    archV = releaseCar(c);
  }
  archV.health = 900;
}
function updateDriveHome(dt, ctx) {
  const pos = ctx.pos, inTruck = ctx.vehicle && ctx.vehicle === archV;
  if (archV && archV.wrecked) {
    // the arch is gold — it survives the fire; Vinnie's lot had another truck
    T.truckAt = { x: archV.mesh.position.x, z: archV.mesh.position.z }; persist();
    ui.banner("THE TRUCK'S WRECKED", "You drag the arch out of the fire into another truck. Keep going.", 3600);
    const at = nearestOnRoad(pos.x + 8, pos.z + 8);
    const c = spawnCar("truck", 0, 0, { at, mode: "parked", hp: 99, label: "truck", explodes: false });
    archV = releaseCar(c); archV.health = 900;
    return;
  }
  if (inTruck && !inTruckOnce) {
    inTruckOnce = true; huntT = 7;
    ui.subs([{ who: "", text: "(the arch shifts in the back with a heavy golden clang)", dur: 2.6 }, { who: "YOU", text: "...Let's get you home.", dur: 2 }]);
  }
  if (inTruckOnce && huntWave < 3) {
    huntT -= dt;
    const live = hunters.filter((c) => c.state !== "wrecked").length;
    if (huntT <= 0 && live < 2) {
      huntWave++;
      huntT = 45;
      for (const dd of huntWave === 2 ? [140, 180, 220] : [150, 200]) {
        const at = roadPointAround(pos.x, pos.z, dd);
        if (at) hunters.push(spawnCar("suv", 0, 0, { at, mode: "chase", gunners: 2, hp: 8, top: 34, label: "Hunter", stopAt: 15 }));
      }
      ui.banner(huntWave === 1 ? "THEY'RE COMING FOR THE ARCH" : "MORE OF THEM!", "Holloway's last men. Keep driving — or fight.", 2600);
    }
  }
  const sq = landmarks.ktmDurbar;
  if (sq && inTruck && Math.hypot(pos.x - sq.x, pos.z - sq.z) < 45) {
    for (const c of hunters) if (c.state !== "wrecked") removeCar(c);
    hunters = [];
    setStage(21, "YOU MADE IT", "Martha's waiting by the empty shrine. Press T to talk.");
    ui.subs([{ who: "", text: "(the square goes quiet as the truck rolls in — people come out of every doorway)", dur: 3.6 }]);
  }
}

// ---------------------------------------------------------------- Holloway (London)
function hollowayTalk() {
  if (talkBusy || !holloway) return;
  talkBusy = true;
  ui.subs([
    { who: "HOLLOWAY", text: "Wait— wait! It's just business! I buy beautiful things, that's all I do!", dur: 3.2 },
    { who: "YOU", text: "You bought a temple's god. People died for it.", dur: 2.6 },
    { who: "HOLLOWAY", text: "Rocco, Vinnie, me — it was never about the arch! It's about what happened twelve years ago, it was—", dur: 3.8 },
    { who: "HOLLOWAY", text: "...Forget it. I have money. Name a number. Any number.", dur: 2.8 },
  ], () => {
    ui.choice("WHAT HAPPENS TO HOLLOWAY?", ["\"You're going to tell the police everything.\"", "\"This is for Martha.\""], (i) => {
      const p = holloway && holloway.p;
      if (i === 0) {
        T.holloway = "jail";
        ui.subs([
          { who: "HOLLOWAY", text: "...Fine. FINE. I'll talk. Just get me away from here before someone else finds me.", dur: 3.4 },
          { who: "", text: "(sirens, getting closer)", dur: 2 },
        ], () => {
          if (holloway && holloway.p === p) { removeGoon(p); goons.splice(goons.indexOf(holloway), 1); holloway = null; }
          persist();
          afterHolloway(600);
        });
        return;
      } else {
        T.holloway = "dead";
        if (p) {
          const pos = me(), V = BABYLON.Vector3, y = terrainH(pos.x, pos.z);
          sfx.gunshot();
          if (C.tracer) C.tracer(new V(pos.x, y + 1.45, pos.z), new V(p.x, terrainH(p.x, p.z) + 1.1, p.z));
          kill(holloway, (p.x - pos.x) * 0.5, (p.z - pos.z) * 0.5);
        }
      }
      persist();
      afterHolloway(3400);
    });
  });
}
function afterHolloway(ms) {
  later(ms, () => {
    ui.text("UNKNOWN NUMBER", "Three. ...I mean — well done. Vinnie's truck is where you left it. Take the arch home to Martha. — A Friend",
      () => setStage(20, "TAKE THE ARCH HOME", "Find Vinnie's truck and drive it back to Palace Square, Kathmandu.", 4400));
  });
}

// ---------------------------------------------------------------- Rocco's boat (ported as it was)
const ESCAPE = [[-330, 520], [-700, 560], [-985, 620]];
const HULL = 5;
const DECK = 0.42;
function boardCrew() {
  if (crew || !boat) return;
  const p = boat.v.mesh.position;
  const rocco = spawnGoon(p.x, p.z, { key: "rocco", look: KINDS.rocco.look });
  const dn = spawnGoon(p.x, p.z, { key: "danny", look: DANNY_LOOK });
  dn.gun.setEnabled(false);
  const gunner = spawnGoon(p.x, p.z, { key: "crew" });
  crew = { rocco, danny: dn, gunner, gunnerDown: false };
  placeCrew();
}
function dropCrew() {
  if (!crew) return;
  for (const p of [crew.rocco, crew.danny, crew.gunner]) if (p) removeGoon(p);
  crew = null;
}
function placeCrew() {
  if (!crew || !boat) return;
  const v = boat.v, b = v.mesh.position, h = v.heading;
  const fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
  const deck = b.y + DECK;
  const put = (p, along, side, state, heading) => {
    if (!p) return;
    p.x = b.x + fx * along + sx * side; p.z = b.z + fz * along + sz * side;
    p.yOff = deck; p.state = state; p.speed = 0; p.heading = heading;
  };
  const m = playerPos() || b;
  put(crew.rocco, -0.35, 0.2, "walk", h);
  put(crew.danny, -2.0, -0.5, "cower", h + Math.PI * 0.8);
  if (!crew.gunnerDown) put(crew.gunner, -2.3, 0.45, "aim", Math.atan2(m.x - b.x, m.z - b.z));
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
  shootList.length = 0;
  shootList.push({ box: { rot: { cx: 0, cz: 0, c: 1, s: 0 }, lx0: -1.05, lx1: 1.05, lz0: -2.95, lz1: 2.95, minY: -0.4, maxY: 1.5 }, onHit: () => hullHit(1, "HIT!") });
}
function freeBoat() {
  // Rocco's boat is yours now — wherever it ran aground
  if (!boat) return;
  const v = boat.v;
  v.locked = false; v.spec = SPECS.boat; v.speed = 0;
  if (v.solid) removeSolid(v.solid);
  v.solid = vehicleSolid(v);
  v.mesh.freezeWorldMatrix();
  boat = null;
}
function hullHit(n, title) {
  if (!boat || boat.state === "beaching" || boat.state === "beached") return;
  if (boat.state === "moored") boatFlee();
  boat.hp -= n;
  if (boat.hp <= 0) {
    boat.state = "beaching";
    ui.subs([
      { who: "ROCCO", text: "We're taking water! Beach it — BEACH IT!", dur: 2.6 },
      { who: "DANNY", text: "Rocco, the engine's on fire—", dur: 2.2 },
    ]);
    setStage(6, "THEY'RE RUNNING AGROUND", "Follow them onto the Saint-Clair beach.");
  } else ui.banner(title, `${boat.hp} more ${boat.hp === 1 ? "hit" : "hits"}`, 1100);
}
function boatFlee() {
  if (!boat) mooredBoat();
  if (!boat) return;
  boat.state = "fleeing"; boat.wp = 0;
  const v = boat.v, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  boat.way = [[v.mesh.position.x + fx * 30, v.mesh.position.z + fz * 30], ...ESCAPE];
}
function updateBoat(dt, ctx) {
  if (!boat) { mooredBoat(); if (!boat) return; }
  const v = boat.v, p = v.mesh.position, pos = ctx.pos;
  const box = shootList[0] && shootList[0].box;
  if (box) { box.rot.cx = p.x; box.rot.cz = p.z; box.rot.c = Math.cos(v.heading); box.rot.s = Math.sin(v.heading); box.minY = p.y - 0.4; box.maxY = p.y + 1.5; }
  const dMe = Math.hypot(p.x - pos.x, p.z - pos.z);
  const pv = ctx.vehicle;
  if (boat.state === "moored") {
    if (dMe < 28 || (pv && pv.kind === "boat")) {
      boatFlee();
      ui.subs([{ who: "ROCCO", text: "Go, go, GO! Lose him in the bay!", dur: 2.4 }]);
    }
    return;
  }
  if (boat.state === "beached") return;
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
  const da = Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading));
  const keys = { KeyW: true, KeyD: da > 0.08, KeyA: da < -0.08 };
  if (boat.state === "beaching") v.spec.max = SPECS.boat.max * 0.55;
  if (boat.stuck > 0) {
    boat.stuck -= dt;
    keys.KeyW = false; keys.KeyS = true; keys.KeyD = keys.KeyA = false;
    if (boat.stuck <= 0) boat.dodge = 1.2;
  } else if (boat.dodge > 0) {
    boat.dodge -= dt;
    keys.KeyD = boat.unstick > 0; keys.KeyA = boat.unstick < 0;
  }
  const res = driveBoat(v, dt, keys);
  if (res.impact > 0 && boat.stuck <= 0) { boat.stuck = 0.7; boat.unstick = da > 0 ? -1 : 1; }
  placeCrew();
  if (boat.state === "beaching" && (Math.hypot(tx - p.x, tz - p.z) < 9 || (res.impact > 0 && Math.hypot(tx - p.x, tz - p.z) < 40))) {
    boat.state = "beached";
    v.speed = 0; v.vx = v.vz = 0;
    shootList.length = 0;
    dropCrew();
    setStage(7, "ACT II · SAINT-CLAIR", "Rocco \"the Crab\" Ferraro. End this.", 4200);
    ui.subs([
      { who: "ROCCO", text: "You've cost me a boat, a crew and a very patient buyer.", dur: 3.2 },
      { who: "ROCCO", text: "Let's see if you're worth it. Boys!", dur: 2.4 },
    ]);
    freeBoat();
    return;
  }
  boat.gunCool -= dt;
  if (boat.state === "fleeing" && boat.gunCool <= 0 && dMe < 70 && crew && !crew.gunnerDown) {
    boat.gunCool = 1.3 + Math.random() * 0.9;
    const g = crew.gunner, gf = Math.sin(g.heading), gz = Math.cos(g.heading);
    const from = { x: g.x + gf * 0.6, y: (g.yOff || p.y) + 1.45, z: g.z + gz * 0.6 };
    if (C.spark) C.spark(new BABYLON.Vector3(from.x, from.y, from.z), 0.2, 0.05);
    const hit = Math.random() < 0.3 * Math.max(0.2, 1 - dMe / 70);
    const to = hit ? { x: pos.x, y: pos.y + 1.2, z: pos.z } : { x: pos.x + (Math.random() - 0.5) * 5, y: pos.y + Math.random() * 2, z: pos.z + (Math.random() - 0.5) * 5 };
    if (C.tracer) C.tracer(new BABYLON.Vector3(from.x, from.y, from.z), new BABYLON.Vector3(to.x, to.y, to.z));
    if (C.shotSound) C.shotSound(from.x, from.z);
    if (hit && C.hurtPlayer) C.hurtPlayer(7, (pos.x - p.x) / (dMe || 1), (pos.z - p.z) / (dMe || 1));
  }
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
  boat.farT = dMe > 260 ? boat.farT + dt : 0;
  if (boat.state === "fleeing" && (p.x < -935 || boat.farT > 7)) {
    ui.banner("THEY GOT AWAY", "...but Rocco's turned back for the jetty to wait for his money man. Get back there — try again.", 4000);
    mooredBoat();
  }
}

// ---------------------------------------------------------------- dialogue with Martha
export function archChoices(c) {
  if (c.def.id !== GIVER) return [];
  if (T.stage === 0) {
    if (!T.briefed) return [{
      label: "Martha? You look like you haven't slept.",
      go: () => {
        T.briefed = true; persist();
        speakAs(c, "The golden arch — the one over the old shrine. Three hundred years it hung there. Last night they pried it off like a bottle cap. " +
          "And Danny — my nephew, my sister's boy — he phoned me at midnight. He said he'd followed the thieves to the old boat shed on the west shore " +
          "and he was going to stop them himself. Then nothing. His phone just rings.", "sad", "Martha? You look like you haven't slept.");
      },
    }];
    return [
      { label: "I'll find him. And the arch.", go: () => { speakAs(c, "The arch can be replaced, dear. He can't. Bring him home. ...And whoever took it — follow them. All the way. Every one of them.", "sad", "I'll find him. And the arch."); later(2600, () => setStage(1, "MISSION 1 · THE GOLDEN ARCH", "Get to the old boat shed on Kathmandu's west shore.", 4400)); } },
      { label: "Who'd steal from a temple?", go: () => speakAs(c, "People who think the gods don't keep accounts. They do. So do I.", "angry", "Who'd steal from a temple?") },
    ];
  }
  if (T.stage < 9) return [{ label: "About Danny…", go: () => speakAs(c, "Why are you here? The west shore, dear — go! Every minute...", "sad", "About Danny…") }];
  if (T.stage < 21) return [{ label: "About the arch…", go: () => speakAs(c, "Saint-Clair? Midtown? London? ...Then follow it as far as it goes. Don't you dare stop.", "sad", "About the arch…") }];
  if (T.stage === 21) return [{
    label: "I brought the arch home.",
    go: () => {
      const home = T.choice === "home";
      speakAs(c, home
        ? "...Danny told me everything. Every word. He's inside — he can't look at me yet. " +
          "And you... you followed it through four cities. Saint-Clair, Midtown, London. Rocco, Vinnie, Holloway — every one of them. " +
          "Three hundred years that arch has watched this square, and tonight it will again. Take this, dear. You've earned far more."
        : "And Danny? ...You let him go. Perhaps that was kinder than I could have been. " +
          "But you — you followed it through four cities and never once stopped. Rocco, Vinnie, Holloway. Every one of them. " +
          "The arch is home. Take this, dear. You've earned far more.",
      "sad", "I brought the arch home.");
      finish();
    },
  }];
  return [];
}
function finish() {
  addCash(5000);
  T.stage = DONE; persist();
  enterStage(DONE, false);
  const g = charById(GIVER);
  later(1400, () => ui.banner("MISSION 1 COMPLETE", `+$5000 · The golden arch is home${T.choice === "home" ? " — and so is Danny" : ""}.`, 5600));
  // ...and she takes out her phone
  later(5200, () => { if (g) g.forceSlot = { spot: "durbar", pose: "phone", doing: "typing on her phone" }; });
  later(9800, () => {
    ui.text("UNKNOWN NUMBER", "All three. Thank you. — A Friend", () => { if (g) g.forceSlot = null; if (ui.onDone) ui.onDone(); });
  });
}

// ---------------------------------------------------------------- per frame
export function updateArch(dt, ctx) {
  if (T.stage >= DONE) return;
  const pos = ctx.pos, s = T.stage;
  if (s === 1 && shed) {
    const d = Math.hypot(pos.x - shed.x, pos.z - shed.z);
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
  if (s === 2 && !hostiles().length) {
    setStage(3, "SHED CLEARED", "Find Danny inside.");
    ui.subs([{ who: "DANNY", text: "(from inside) H-hello? Is someone there? Help me!", dur: 3 }]);
  }
  if (s === 1 || s === 3) updateDanny(dt, pos);
  if (s === 4) {
    updateDanny(dt, pos);
    if (!hostiles().length) {
      setStage(5, "ROCCO'S BOAT IS LEAVING", "Take the other boat at the jetty — ram them!");
      ui.subs([
        { who: "", text: "(your phone buzzes — Martha)", dur: 2 },
        { who: "MARTHA", text: "I heard shooting from the shore. Is Danny with you? Is he safe?", dur: 3.4 },
        { who: "YOU", text: "...He's on Rocco's boat, Martha. I'm going after him.", dur: 3 },
        { who: "MARTHA", text: "...Then go. And don't let any of them get away.", dur: 2.6 },
      ]);
      mooredBoat();
    }
  }
  if (s === 5 || s === 6) updateBoat(dt, ctx);
  if (s === 7 && !hostiles().length) setStage(8, "IT'S OVER", "Danny is on his knees in the sand. Go to him.");
  if (s === 8) updateDanny(dt, pos);
  if (s === 9) updateFountain(dt, ctx);
  if (s === 11 && lucienCar && lucienCar.wantSmoke && !lucienCar.smoke && C.smokeOn) { lucienCar.wantSmoke = false; lucienCar.smoke = C.smokeOn(lucienCar.v.mesh); }
  if (s === 11 && lucien) {
    holdPose(lucien.p, "cower", Math.atan2(pos.x - lucien.p.x, pos.z - lucien.p.z));
    if (dist(pos, lucien.p) < (ctx.vehicle ? 9 : 5)) lucienTalk();
  }
  if (s === 13 && yard) {
    const d = Math.hypot(pos.x - yard.x, pos.z - yard.z);
    if (!overheard && d < 80) {
      overheard = true;
      ui.subs([
        { who: "VINNIE", text: "(on the phone) Grant. Grant! Listen to me. Midnight. Your money's here by midnight—", dur: 3.4 },
        { who: "VINNIE", text: "—or your precious golden arch goes in the river. I'm not a museum, Grant.", dur: 3.2 },
        { who: "VINNIE", text: "...What do you mean, 'some nobody from Kathmandu'? What nobody?", dur: 3 },
        { who: "THUG", text: "Boss. Boss — company.", dur: 2 },
      ]);
    }
  }
  if (s === 14) {
    const v = aliveOf("vinnie")[0];
    const crewLeft = hostiles().filter((g) => g.kind !== "vinnie").length;
    if (v && !v.running && (crewLeft <= 2 || v.hp <= v.max * 0.5)) vinnieRun();
    if (v && v.running && truck) {
      const tp = truck.v.mesh.position;
      v.runT += dt;
      if (stepToward(v.p, tp.x, tp.z, 5.4, dt) < 2.2 || v.runT > 7) startTruck();
    }
    if (!v && T.stage === 14) {
      // (killed before he made it to the truck) — the driver panics and goes anyway
      startTruck();
    }
  }
  if (s === 16 && !hostiles().length && !pausing) {
    if (truck) T.truckAt = { x: truck.v.mesh.position.x, z: truck.v.mesh.position.z };
    persist();
    pausing = true;    // (a moment of quiet while the dying words play)
    ui.subs(T.vinnieDead ? [{ who: "", text: "(the driver's dead. In the back of the truck, under a tarp: gold)", dur: 3.4 }] : [
      { who: "VINNIE", text: "Heh... Holloway was never... gonna pay me...", dur: 2.8 },
      { who: "VINNIE", text: "Ask yourself, kid... who's been... pointing you at us...", dur: 3.4 },
    ], () => {
      ui.text("UNKNOWN NUMBER", "Holloway is at the big wheel in London. He's waiting for a truck that isn't coming. — A Friend",
        () => setStage(17, "ACT IV · LONDON", "Grant Holloway is waiting at the big wheel.", 4400));
    });
  }
  if (s === 17 && holloway && landmarks.wheel) {
    const d = dist(pos, holloway.p);
    holloway.p.state = "walk"; holloway.p.speed = 0;
    if (!overheard && d < 75) {
      overheard = true;
      ui.subs([
        { who: "HOLLOWAY", text: "(on the phone) Where's my truck, Vinnie? Vinnie? ...VINNIE?", dur: 3 },
        { who: "HOLLOWAY", text: "...Oh, no. No, no, no. It's him. SECURITY!", dur: 2.6 },
      ], () => { if (T.stage === 17) alertAll(); });
    }
  }
  if (s === 18 && !hostiles().length && !pausing) {
    if (T.holloway === "dead") { pausing = true; afterHolloway(2600); }
    else setStage(19, "HE'S ALL YOURS", "Holloway's cowering by the wheel. Go to him.");
  }
  if (s === 19 && holloway && !holloway.p.dead && dist(pos, holloway.p) < (ctx.vehicle ? 8 : 4.5)) hollowayTalk();
  if (s === 20) updateDriveHome(dt, ctx);
  if (s === 21) updateMarthaEnd(dt, pos);
}
function updateFountain(dt, ctx) {
  if (!lucien) return;
  const pos = ctx.pos, p = lucien.p;
  if (lucien.mode === "idle") {
    holdPose(p, "walk", fountain.face);
    p.state = "walk";
    if (dist(pos, p) < (ctx.vehicle ? 55 : 40)) lucienBolts();
  } else if (lucien.mode === "run" && lucienCar) {
    const cp = lucienCar.v.mesh.position;
    lucien.runT = (lucien.runT || 0) + dt;
    if (stepToward(p, cp.x, cp.z, 4.6, dt) < 1.8 || lucien.runT > 6) startLucienChase();
  }
}
// at the very end, Danny's there too (if you sent him home)
function updateMarthaEnd(dt, pos) {
  const g = charById(GIVER);
  if (!g || g.p.state === "away") return;
  if (T.choice === "home" && !danny && dist(pos, g.p) < 70) {
    const [x, z] = freeSpot(g.p.x + 1.8, g.p.z + 1.2);
    danny = { p: spawnExtra(x, z, "danny", DANNY_LOOK), mode: "home" };
  }
  if (danny && danny.mode === "home") { danny.p.state = "walk"; danny.p.speed = 0; danny.p.heading = turn(danny.p.heading, Math.atan2(pos.x - danny.p.x, pos.z - danny.p.z), dt * 2); }
}

// ---------------------------------------------------------------- hooks for mission.js
export function archShootables() {
  return T.stage === 5 ? shootList : [];
}
export function archHitGoon(p, dmg, fx, fz, how) {
  if (crew && p === crew.gunner && !crew.gunnerDown) {
    crew.gunnerDown = true;
    removeGoon(p);
    crew.gunner = null;
    ui.banner("GUNMAN DOWN", "The stern's clear — ram them!", 1600);
    ui.subs([{ who: "ROCCO", text: "Marco?! MARCO! ...Just drive, kid, DRIVE!", dur: 2.6 }]);
    return;
  }
  if (lucien && p === lucien.p) {
    if (lucien.mode === "idle") lucienBolts();
    ui.banner("DON'T KILL HIM", "He knows where the arch went.", 1400);
    return;
  }
  if (danny && p === danny.p) return;
  hitGoon(p, dmg, fx, fz, how);
}
export const archTimeScale = () => (performance.now() < slowUntil ? 0.3 : 1);
export function archRespawn() {
  const at = (x, z, yaw = 0) => ({ x, z, yaw });
  const s = T.stage, pos = me();
  if (shed && s >= 1 && s <= 2) { const [x, z] = L(0, -45); return at(x, z, shed.yaw); }
  if (shed && s >= 3 && s <= 4) { const [x, z] = L(0, 2); return at(x, z, shed.yaw + Math.PI); }
  if (shed && (s === 5 || s === 6)) return at(shed.shoreX - shed.n[0] * 3, shed.shoreZ - shed.n[1] * 3, shed.yaw);
  if (beach && s === 7) return at(beach.landX - beach.n[0] * 30, beach.landZ - beach.n[1] * 30, Math.atan2(beach.n[0], beach.n[1]));
  if (fountain && s >= 9 && s <= 10) return at(fountain.x - Math.sin(fountain.face) * 50, fountain.z - Math.cos(fountain.face) * 50, fountain.face);
  if (yard && (s === 13 || s === 14)) { const [x, z] = Y(0, -48); return at(x, z, yard.yaw); }
  if (yard && s === 15) { const [x, z] = Y(0, -30); return at(x, z, yard.yaw); }
  if (s === 16 && truck) { const p = truck.v.mesh.position; const [x, z] = freeSpot(p.x - Math.sin(truck.v.heading) * 30, p.z - Math.cos(truck.v.heading) * 30); return at(x, z, truck.v.heading); }
  if ((s === 17 || s === 18) && landmarks.wheel) { const w = landmarks.wheel; const [x, z] = freeSpot(w.x + w.nx * 80, w.z + w.nz * 80); return at(x, z, Math.atan2(-w.nx, -w.nz)); }
  if (s === 12 && pos) return null;
  if (s === 20 && archV) { const p = archV.mesh.position; const [x, z] = freeSpot(p.x + Math.cos(archV.heading) * 3.5, p.z - Math.sin(archV.heading) * 3.5); return at(x, z, archV.heading); }
  return null;
}
export function archOnRespawn() {
  const s = T.stage;
  cancelTimers();
  talkBusy = false;
  if (s === 2) { T.stage = 1; enterStage(1, false); ui.banner("THE BOAT SHED", "Try a different approach — use the crates.", 2600); }
  else if (s === 3 || s === 4) { if (danny) { removeGoon(danny.p); danny = null; } T.stage = 4; enterStage(4, false); ui.banner("AMBUSH!", "Here they come again.", 2200); }
  else if (s === 5 || s === 6) { T.stage = 5; mooredBoat(); ui.banner("CATCH ROCCO'S BOAT", "They're back at the jetty.", 2200); }
  else if (s === 7) { enterStage(7, false); ui.banner("SHOWDOWN", "Once more.", 2000); }
  else if (s === 9 || s === 10) { T.stage = 9; enterStage(9, false); ui.banner("FIND LUCIEN GRAY", "He's back at the fountain.", 2400); }
  else if (s === 11) { /* he's still there */ }
  else if (s === 12) {
    for (const c of hunters) if (c.state !== "wrecked") removeCar(c);
    const pos = me();
    hunters = [140, 190].map((dd) => { const at = roadPointAround(pos.x, pos.z, dd); return at && spawnCar("suv", 0, 0, { at, mode: "chase", gunners: 2, hp: 9, top: 30, label: "Hit squad", stopAt: 15 }); }).filter(Boolean);
    for (const c of hunters) c.onWrecked = () => checkHunters();
    ui.banner("VINNIE'S HIT SQUAD", "They're coming back round.", 2200);
  }
  else if (s >= 13 && s <= 15) { T.stage = 13; enterStage(13, false); ui.banner("VINNIE'S YARD", "Again — and this time, don't let him reach the truck.", 2600); }
  else if (s === 16 && truck) { T.stage = 15; truckStopped(); }
  else if (s === 17 || s === 18) { T.stage = 17; enterStage(17, false); ui.banner("THE BIG WHEEL", "Holloway's security has regrouped.", 2400); }
  else if (s === 20) {
    for (const c of hunters) if (c.state !== "wrecked") removeCar(c);
    hunters = []; huntWave = Math.max(0, huntWave - 1); huntT = 8;
  }
  persist();
}

// ---------------------------------------------------------------- objective + card
export function archObjective() {
  const c = charById(GIVER), s = T.stage, pos = me();
  const martha = c && c.p.state !== "away" ? { x: c.p.x, z: c.p.z, label: "Martha", target: true } : (landmarks.ktmDurbar ? { x: landmarks.ktmDurbar.x, z: landmarks.ktmDurbar.z, label: "Palace Square" } : null);
  if (s === 0 || s === 21) return martha;
  if (s === 1 && shed) return { x: shed.x, z: shed.z, label: "Boat shed" };
  if ([2, 4, 7, 14, 16, 18].includes(s)) return enemyObjective(pos);
  if (s === 3 && danny) return { x: danny.p.x, z: danny.p.z, label: "Danny", target: true };
  if ((s === 5 || s === 6) && boat) { const p = boat.v.mesh.position; return { x: p.x, z: p.z, label: boat.state === "moored" ? "Rocco's boat" : "Rocco", target: true }; }
  if (s === 8 && danny) return { x: danny.p.x, z: danny.p.z, label: "Danny", target: true };
  if (s === 9) return lucien ? { x: lucien.p.x, z: lucien.p.z, label: "Lucien Gray", target: true } : fountain && { x: fountain.x, z: fountain.z, label: "The fountain" };
  if (s === 10 && lucienCar) { const p = lucienCar.v.mesh.position; return { x: p.x, z: p.z, label: "Lucien", target: true }; }
  if (s === 11 && lucien) return { x: lucien.p.x, z: lucien.p.z, label: "Lucien", target: true };
  if (s === 12) {
    let b = null, bd = Infinity;
    for (const h of hunters) { if (h.state === "wrecked") continue; const p = h.v.mesh.position, d = Math.hypot(p.x - pos.x, p.z - pos.z); if (d < bd) { bd = d; b = p; } }
    return b ? { x: b.x, z: b.z, label: "Hit squad", target: true } : null;
  }
  if (s === 13 && yard) return { x: yard.x, z: yard.z, label: "Vinnie's yard" };
  if (s === 15 && truck) { const p = truck.v.mesh.position; return { x: p.x, z: p.z, label: "The truck", target: true }; }
  if (s === 17 && holloway) return { x: holloway.p.x, z: holloway.p.z, label: "Holloway" };
  if (s === 19 && holloway) return { x: holloway.p.x, z: holloway.p.z, label: "Holloway", target: true };
  if (s === 20) {
    if (archV && !(C.playerVehicle && C.playerVehicle() === archV)) { const p = archV.mesh.position; return { x: p.x, z: p.z, label: "Vinnie's truck", target: true }; }
    return landmarks.ktmDurbar ? { x: landmarks.ktmDurbar.x, z: landmarks.ktmDurbar.z, label: "Palace Square" } : null;
  }
  return null;
}
export function archCard() {
  const s = Math.min(T.stage, DONE);
  const st = STAGES[s] || STAGES[DONE];
  let extra = "";
  if ([2, 4, 7, 14, 16, 18].includes(s)) {
    extra = `${hostiles().length} left`;
    for (const b of ["rocco", "vinnie"]) { const bar = bossBar(b); if (bar) extra += ` · ${bar}`; }
  }
  if (s === 5 && boat) extra = boat.state === "moored" ? "Get in the other boat" : `Their hull ${"●".repeat(Math.max(0, Math.min(HULL, boat.hp)))}${"○".repeat(HULL - Math.max(0, Math.min(HULL, boat.hp)))}`;
  if (s === 10 && lucienCar) extra = healthBar(lucienCar);
  if (s === 12) extra = `${hunters.filter((c) => c.state !== "wrecked").length} cars left`;
  if (s === 15 && truck) extra = healthBar(truck) + (escort && escort.state !== "wrecked" ? " · escort on you" : "");
  if (s === 20) {
    const inTruck = C.playerVehicle && C.playerVehicle() === archV;
    const n = hunters.filter((c) => c.state !== "wrecked").length;
    extra = inTruck ? (n ? `${n} hunter${n > 1 ? "s" : ""} on your tail` : "Palace Square, Kathmandu") : "Get in the truck — the arch is in the back";
  }
  return { name: `MISSION 1 — THE GOLDEN ARCH${st.act ? " · ACT " + st.act : ""}`, title: st.title, hint: st.hint, extra, done: T.stage >= DONE };
}
