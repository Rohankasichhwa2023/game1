// vehicles.js — vehicle models (sedan, taxi, hatchback, SUV/jeep, van, bus,
// box truck, supercar, bike, superbike), parked vehicles, traffic that follows
// the curved road graph (turning at junctions, yielding to pedestrians and the
// player), and the drivable-vehicle physics.
//
// Every vehicle carries a `spec` (size, collision circles, handling, camera,
// hit points). `kind` is only the rider style: "car" (player hidden inside)
// or "bike" (player sits on it).
import {
  scene, rand, rr, pick, clamp, hex, angDiff, litMat, flatMat, mergedTemplate, addSolidR, query, circleHit, xfl, toLocal, L,
} from "./engine.js";
import { edges, pathAt, asphaltDist, WORLD } from "./roads.js";

// ---------------------------------------------------------------- specs
// max / boost are in m/s (× 3.6 = km/h). Shift multiplies top speed by boost.
const KMH = 1 / 3.6;
export const SPECS = {
  car: {
    name: "car", kind: "car", hw: 0.95, hd: 2.2, ht: 1.45, circles: [-1.45, 0, 1.45], r: 0.98,
    accel: 13, max: 120 * KMH, boost: 1.3, rev: 9, brake: 28, turn: 1.8, camDist: 9, camH: 2.0, hits: 6, label: "Drive car",
  },
  suv: {
    name: "SUV", kind: "car", hw: 1.0, hd: 2.45, ht: 2.1, circles: [-1.5, 0, 1.5], r: 1.05,
    accel: 13, max: 135 * KMH, boost: 1.3, rev: 9, brake: 28, turn: 1.75, camDist: 9.5, camH: 2.5, hits: 8, label: "Drive SUV",
  },
  van: {
    name: "van", kind: "car", hw: 1.0, hd: 2.75, ht: 2.4, circles: [-1.8, 0, 1.8], r: 1.05,
    accel: 9, max: 110 * KMH, boost: 1.25, rev: 7, brake: 24, turn: 1.55, camDist: 10.5, camH: 3.0, hits: 8, label: "Drive van",
    traffic: 0.9,
  },
  truck: {
    name: "truck", kind: "car", hw: 1.25, hd: 4.3, ht: 3.9, circles: [-3.2, -1.1, 1.1, 3.2], r: 1.3,
    accel: 5.5, max: 90 * KMH, boost: 1.2, rev: 5, brake: 18, turn: 1.15, camDist: 15, camH: 4.3, hits: 12, label: "Drive truck",
    traffic: 0.8,
  },
  bus: {
    name: "bus", kind: "car", hw: 1.3, hd: 5.85, ht: 3.4, circles: [-4.6, -2.3, 0, 2.3, 4.6], r: 1.33,
    accel: 4.5, max: 75 * KMH, boost: 1.15, rev: 4, brake: 16, turn: 0.95, camDist: 17, camH: 4.5, hits: 14, label: "Drive bus",
    traffic: 0.75,
  },
  supercar: {
    name: "supercar", kind: "car", hw: 1.02, hd: 2.35, ht: 1.2, circles: [-1.5, 0, 1.5], r: 1.02,
    accel: 24, max: 200 * KMH, boost: 1.5, rev: 10, brake: 42, turn: 2.0, camDist: 8, camH: 1.8, hits: 6, label: "Drive supercar",
  },
  bike: {
    name: "bike", kind: "bike", hw: 0.35, hd: 0.95, ht: 1.15, circles: [-0.45, 0.45], r: 0.42,
    accel: 17, max: 145 * KMH, boost: 1.3, rev: 4, brake: 32, turn: 2.7, camDist: 6, camH: 1.6, hits: 3, label: "Ride bike",
  },
  superbike: {
    name: "superbike", kind: "bike", hw: 0.36, hd: 1.0, ht: 1.15, circles: [-0.48, 0.48], r: 0.42,
    accel: 28, max: 200 * KMH, boost: 1.5, rev: 4, brake: 46, turn: 2.8, camDist: 6.5, camH: 1.6, hits: 3, label: "Ride superbike",
  },
};
export const VEH = SPECS;                       // back-compat alias
export const specOf = (v) => v.spec || SPECS[v.kind];

export const vehicles = []; // parked / usable (and wrecks)
export const traffic = [];

// ---------------------------------------------------------------- model builders
const MB = BABYLON.MeshBuilder;
let headM, tailM, tyreM, chromeM, darkM, glassM, burntM, burntGlassM;
const burntCache = {};

// Build a template from a parts function. P.box / P.wheel / P.cyl add parts
// with a material key: body, accent, glass, dark, chrome, tyre, light, tail.
function build(name, colors, partsFn, burnt = false) {
  const M = burnt
    ? { body: burntM, accent: burntM, glass: burntGlassM, dark: burntM, chrome: burntM, tyre: tyreM, light: null, tail: null }
    : {
      body: (() => { const m = litMat(name + "Body", hex(colors.body), 0.35); m.specularPower = 64; return m; })(),
      accent: litMat(name + "Accent", hex(colors.accent || colors.body), 0.25),
      glass: glassM, dark: darkM, chrome: chromeM, tyre: tyreM, light: headM, tail: tailM,
    };
  const parts = [];
  const P = {
    box(w, h, d, x, y, z, mat, rx = 0) {
      if (!M[mat]) return;
      const m = MB.CreateBox("p", { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z); m.rotation.x = rx;
      parts.push({ mesh: m, mat: M[mat] });
    },
    wheel(dia, width, x, y, z) {
      const w = MB.CreateCylinder("w", { diameter: dia, height: width, tessellation: 14 }, scene);
      w.rotation.z = Math.PI / 2; w.position.set(x, y, z);
      parts.push({ mesh: w, mat: M.tyre });
    },
    cyl(dia, h, x, y, z, mat, rx = 0, rz = 0) {
      if (!M[mat]) return;
      const c = MB.CreateCylinder("c", { diameter: dia, height: h, tessellation: 14 }, scene);
      c.position.set(x, y, z); c.rotation.x = rx; c.rotation.z = rz;
      parts.push({ mesh: c, mat: M[mat] });
    },
  };
  partsFn(P);
  return mergedTemplate(burnt ? name + "Burnt" : name, parts, !burnt);
}
// Template factory: remembers its spec + how to build its burnt wreck.
function model(specKey, name, colors, partsFn) {
  const t = build(name, colors, partsFn);
  t.specKey = specKey;
  t.burnKey = specKey + ":" + partsFn.name;
  t.buildBurnt = () => build(name, colors, partsFn, true);
  return t;
}

// ---- shapes ----
function sedanParts(o = {}) {
  const len = o.len ?? 4.4, cabLen = o.cabLen ?? 2.2, cabOff = o.cabOff ?? -0.25, cabH = o.cabH ?? 0.55;
  return function sedan(P) {
    P.box(1.9, 0.62, len, 0, 0.6, 0, "body");
    P.box(1.66, cabH, cabLen, 0, 0.91 + cabH / 2, cabOff, "glass");
    const wz = len / 2 - 0.8;
    for (const sx of [-0.88, 0.88]) for (const sz of [-wz, wz]) P.wheel(0.68, 0.26, sx, 0.34, sz);
    for (const sx of [-0.65, 0.65]) {
      P.box(0.35, 0.14, 0.05, sx, 0.68, len / 2, "light");
      P.box(0.3, 0.12, 0.05, sx, 0.7, -len / 2, "tail");
    }
    if (o.taxi) {
      P.box(0.75, 0.22, 0.28, 0, 0.91 + cabH + 0.11, cabOff, "light");
      P.box(1.92, 0.08, len * 0.7, 0, 0.7, 0, "dark");
    }
  };
}
function suvParts(P) {
  P.box(2.0, 0.85, 4.7, 0, 0.82, 0, "body");
  P.box(1.86, 0.75, 2.9, 0, 1.6, -0.35, "glass");
  P.box(1.88, 0.08, 2.92, 0, 2.0, -0.35, "body");
  P.box(1.5, 0.06, 2.0, 0, 2.1, -0.35, "dark");
  for (const sx of [-0.7, 0.7]) P.box(0.06, 0.1, 2.3, sx, 2.07, -0.35, "chrome");
  for (const sz of [-1.5, 1.5]) P.box(2.12, 0.2, 1.05, 0, 0.78, sz, "dark");
  P.cyl(0.8, 0.26, 0, 1.05, -2.48, "dark", Math.PI / 2);
  P.box(1.9, 0.2, 0.2, 0, 0.5, 2.42, "chrome");
  P.box(1.9, 0.2, 0.2, 0, 0.5, -2.42, "dark");
  for (const sx of [-0.95, 0.95]) for (const sz of [-1.5, 1.5]) P.wheel(0.86, 0.32, sx, 0.43, sz);
  for (const sx of [-0.68, 0.68]) { P.box(0.36, 0.16, 0.05, sx, 1.0, 2.36, "light"); P.box(0.18, 0.32, 0.05, sx * 1.25, 1.05, -2.36, "tail"); }
}
function vanParts(P) {
  P.box(2.0, 1.95, 4.6, 0, 1.4, -0.3, "body");
  P.box(1.95, 0.8, 0.95, 0, 0.82, 2.45, "body");
  P.box(1.84, 0.9, 0.06, 0, 1.75, 2.05, "glass", -0.45);
  P.box(2.02, 0.62, 1.0, 0, 1.95, 1.45, "glass");
  P.box(2.02, 0.2, 4.6, 0, 1.05, -0.3, "accent");
  P.box(2.0, 0.25, 0.15, 0, 0.5, 2.9, "dark");
  P.box(2.0, 0.25, 0.15, 0, 0.55, -2.62, "dark");
  for (const sx of [-0.95, 0.95]) for (const sz of [-1.75, 1.85]) P.wheel(0.74, 0.28, sx, 0.37, sz);
  for (const sx of [-0.7, 0.7]) { P.box(0.34, 0.16, 0.05, sx, 0.98, 2.93, "light"); P.box(0.2, 0.42, 0.05, sx * 1.22, 1.25, -2.62, "tail"); }
}
function truckParts(P) {
  P.box(2.0, 0.35, 8.4, 0, 0.75, 0, "dark");
  P.box(2.4, 2.1, 2.2, 0, 1.95, 3.05, "body");
  P.box(2.2, 0.85, 0.06, 0, 2.45, 4.16, "glass");
  P.box(2.44, 0.7, 1.0, 0, 2.45, 3.45, "glass");
  P.box(1.6, 0.6, 0.06, 0, 1.3, 4.16, "chrome");
  P.box(2.5, 2.9, 5.7, 0, 2.4, -1.1, "accent");
  P.box(2.52, 0.12, 5.72, 0, 3.86, -1.1, "dark");
  for (const sx of [-1.1, 1.1]) for (const sz of [3.1, -2.2, -3.4]) P.wheel(1.0, 0.36, sx, 0.5, sz);
  for (const sx of [-0.85, 0.85]) { P.box(0.4, 0.2, 0.05, sx, 1.25, 4.17, "light"); P.box(0.3, 0.25, 0.05, sx * 1.23, 1.0, -3.96, "tail"); }
}
function busParts(P) {
  P.box(2.6, 2.75, 11.6, 0, 1.75, 0, "body");
  P.box(2.64, 0.95, 10.4, 0, 2.35, -0.3, "glass");
  P.box(2.4, 1.5, 0.06, 0, 2.15, 5.81, "glass");
  P.box(2.64, 0.38, 11.62, 0, 1.0, 0, "accent");
  P.box(1.8, 0.3, 3.0, 0, 3.27, -2, "dark");
  P.box(1.8, 0.28, 0.06, 0, 2.98, 5.83, "light");
  for (const sx of [-1.15, 1.15]) for (const sz of [3.9, -3.4]) P.wheel(1.0, 0.36, sx, 0.5, sz);
  for (const sx of [-0.95, 0.95]) { P.box(0.35, 0.18, 0.05, sx, 0.85, 5.82, "light"); P.box(0.3, 0.3, 0.05, sx * 1.05, 1.0, -5.82, "tail"); }
}
function supercarParts(P) {
  P.box(2.0, 0.42, 4.6, 0, 0.42, 0, "body");
  P.box(1.9, 0.16, 1.3, 0, 0.66, 1.55, "body", 0.16);
  P.box(1.9, 0.22, 1.5, 0, 0.7, -1.45, "body");
  P.box(1.55, 0.42, 1.7, 0, 0.83, -0.15, "glass");
  P.box(2.04, 0.22, 0.85, 0, 0.45, -0.7, "dark");
  P.box(2.0, 0.06, 0.45, 0, 1.12, -2.15, "dark");
  for (const sx of [-0.6, 0.6]) P.box(0.08, 0.3, 0.1, sx, 0.95, -2.1, "dark");
  P.box(1.8, 0.12, 0.3, 0, 0.25, -2.32, "dark");
  for (const sx of [-0.25, 0.25]) P.box(0.16, 0.012, 1.25, sx, 0.745, 1.55, "accent", 0.16);
  for (const sx of [-0.95, 0.95]) { P.wheel(0.7, 0.32, sx, 0.35, 1.45); P.wheel(0.74, 0.36, sx, 0.37, -1.45); }
  for (const sx of [-0.62, 0.62]) { P.box(0.45, 0.07, 0.05, sx, 0.6, 2.31, "light"); P.box(0.6, 0.07, 0.05, sx, 0.72, -2.31, "tail"); }
}
function bikeParts(P) {
  for (const z of [-0.68, 0.7]) P.wheel(0.64, 0.13, 0, 0.32, z);
  P.box(0.12, 0.12, 1.05, 0, 0.6, 0.02, "body", -0.12);
  P.box(0.3, 0.24, 0.55, 0, 0.84, 0.22, "body");
  P.box(0.27, 0.1, 0.62, 0, 0.88, -0.28, "dark");
  P.box(0.3, 0.32, 0.42, 0, 0.47, 0.02, "chrome");
  P.box(0.07, 0.62, 0.07, 0, 0.62, 0.6, "chrome", -0.32);
  P.box(0.72, 0.05, 0.05, 0, 1.0, 0.5, "chrome");
  P.box(0.08, 0.06, 0.55, 0.12, 0.36, -0.35, "chrome", 0.12);
  P.box(0.2, 0.06, 0.4, 0, 0.66, -0.62, "body", 0.25);
  P.box(0.17, 0.13, 0.06, 0, 0.9, 0.72, "light");
  P.box(0.13, 0.06, 0.04, 0, 0.78, -0.82, "tail");
}
function superbikeParts(P) {
  for (const z of [-0.72, 0.72]) P.wheel(0.62, 0.18, 0, 0.31, z);
  P.box(0.42, 0.5, 0.9, 0, 0.72, 0.38, "body", -0.25);
  P.box(0.32, 0.22, 0.05, 0, 1.02, 0.66, "glass", -0.6);
  P.box(0.36, 0.22, 0.5, 0, 0.9, 0.0, "body");
  P.box(0.26, 0.08, 0.45, 0, 0.86, -0.38, "dark");
  P.box(0.28, 0.16, 0.5, 0, 0.92, -0.72, "body", 0.35);
  P.box(0.44, 0.06, 0.6, 0, 0.62, 0.3, "accent", -0.25);
  P.box(0.34, 0.3, 0.6, 0, 0.42, 0.05, "dark");
  P.box(0.1, 0.08, 0.7, 0.12, 0.35, -0.38, "chrome");
  for (const sx of [-0.09, 0.09]) P.box(0.07, 0.55, 0.07, sx, 0.6, 0.62, "chrome", -0.4);
  P.box(0.6, 0.04, 0.04, 0, 0.98, 0.42, "chrome");
  P.box(0.1, 0.1, 0.45, 0.15, 0.62, -0.6, "chrome", 0.25);
  P.box(0.22, 0.08, 0.05, 0, 0.82, 0.86, "light");
  P.box(0.16, 0.05, 0.04, 0, 0.98, -0.97, "tail");
}

// Pools (weighted by repetition).
const T = { cityTraffic: [], parisTraffic: [], cityParked: [], parisParked: [], bikes: [], start: {} };

export function initVehicleTemplates() {
  headM = flatMat("headLightM", hex("#f2efe2"), 1);
  tailM = flatMat("tailLightM", hex("#c0261d"), 1);
  tyreM = litMat("tyreM", hex("#151515"));
  chromeM = litMat("chromeM", hex("#55595e"), 0.5);
  darkM = litMat("trimDarkM", hex("#1c1d20"), 0.2);
  glassM = litMat("carGlassM", hex("#1b2126"), 0.4);
  burntM = litMat("burntM", hex("#1b1817"));
  burntGlassM = litMat("burntGlassM", hex("#0a0a0a"));

  const sedan = sedanParts(), hatch = sedanParts({ len: 3.8, cabLen: 2.0, cabOff: -0.3, cabH: 0.62 });
  const taxi = model("car", "taxi", { body: "#f2c230" }, sedanParts({ taxi: true }));
  const sedans = ["#1d1f22", "#22314a", "#d8d8d4", "#9da3a8", "#7a1f1f"].map((c, i) => model("car", "sedan" + i, { body: c }, sedan));
  const hatches = ["#ecebe6", "#b32d2a", "#9fd1c0", "#efe3c3", "#2f5d8a"].map((c, i) => model("car", "hatch" + i, { body: c }, hatch));
  const suvs = ["#18191b", "#e6e6e2", "#5b6b3a", "#6d1f24", "#2e3f55"].map((c, i) => model("suv", "suv" + i, { body: c }, suvParts));
  const vans = [["#f1f1ee", "#2a6fb5"], ["#a9adb2", "#1d1f22"], ["#2f5d3e", "#f1f1ee"], ["#f1f1ee", "#c0392b"]]
    .map(([b, a], i) => model("van", "van" + i, { body: b, accent: a }, vanParts));
  const trucks = [["#c0392b", "#f1f1ee"], ["#1f4f9a", "#e9e4d6"], ["#f1f1ee", "#2f7d4a"]]
    .map(([b, a], i) => model("truck", "truck" + i, { body: b, accent: a }, truckParts));
  const cityBus = model("bus", "busCity", { body: "#e9ecef", accent: "#1d5fa8" }, busParts);
  const parisBus = model("bus", "busParis", { body: "#2f7d55", accent: "#e9ecef" }, busParts);
  const supers = [["#e8b100", "#111"], ["#d81b1b", "#fff"], ["#ff6a00", "#111"], ["#1565c0", "#fff"], ["#7ed321", "#111"]]
    .map(([b, a], i) => model("supercar", "supercar" + i, { body: b, accent: a }, supercarParts));
  const bikes = ["#a3262a", "#1f4f9a", "#222326", "#c8681a"].map((c, i) => model("bike", "bike" + i, { body: c }, bikeParts));
  const superbikes = [["#00a86b", "#111"], ["#c62828", "#fff"], ["#1e88e5", "#fff"], ["#f5f5f5", "#d32f2f"]]
    .map(([b, a], i) => model("superbike", "superbike" + i, { body: b, accent: a }, superbikeParts));

  T.cityTraffic = [taxi, taxi, taxi, taxi, taxi, ...sedans, sedans[0], suvs[0], suvs[1], suvs[4], vans[0], vans[1], vans[3], trucks[0], trucks[1], cityBus, cityBus, supers[0]];
  T.parisTraffic = [...hatches, ...hatches, sedans[0], sedans[2], suvs[2], suvs[1], vans[2], vans[0], trucks[2], parisBus];
  T.cityParked = [taxi, ...sedans, ...sedans, suvs[0], suvs[1], suvs[3], suvs[4], vans[0], vans[1], trucks[1], supers[1], supers[3]];
  T.parisParked = [...hatches, ...hatches, sedans[2], suvs[2], suvs[1], vans[2], supers[4]];
  T.bikes = [...bikes, ...bikes, ...superbikes];
  T.start = { supercar: supers[0], superbike: superbikes[1], bike: bikes[0], suv: suvs[2] };
}

// ---------------------------------------------------------------- parked / usable
export function vehicleSolid(v) {
  const c = specOf(v), p = v.mesh.position;
  const s = addSolidR(p.x, p.z, v.heading, c.hw, c.hd, p.y, p.y + c.ht);
  s.vehicle = v;
  return s;
}
export function makeVehicle(tpl, x, z, heading, y = 0) {
  const spec = SPECS[tpl.specKey];
  const mesh = tpl.createInstance(spec.name);
  mesh.position.set(x, y, z);
  mesh.rotation.y = heading;
  const v = { kind: spec.kind, spec, tpl, mesh, heading, speed: 0, hits: 0, wrecked: false, lean: 0, solid: null };
  v.solid = vehicleSolid(v);
  mesh.freezeWorldMatrix();
  vehicles.push(v);
  return v;
}
function freeSpot(x, z, r) {
  for (const s of query(x - r, x + r, z - r, z + r)) if (s.maxY > 0.3 && circleHit(s, x, z, r)) return false;
  return true;
}
function pickEdge(filter) {
  const list = edges.filter(filter);
  const total = list.reduce((a, e) => a + e.len, 0);
  let r = rand() * total;
  for (const e of list) { r -= e.len; if (r <= 0) return e; }
  return list[list.length - 1];
}
export function spawnParked(START) {
  // fast toys parked on the plaza lawn beside the start (clear of the view east)
  makeVehicle(T.start.supercar, START.x, START.z + 6, Math.PI / 2);
  makeVehicle(T.start.suv, START.x - 4, START.z + 10, Math.PI / 2);
  makeVehicle(T.start.superbike, START.x - 1, START.z - 5, Math.PI / 2 + 0.3);
  makeVehicle(T.start.bike, START.x - 2.6, START.z - 5.8, Math.PI / 2 + 0.3);

  const parkable = (e) => e.w >= 10 && e.district !== "park" && e.kind !== "roundabout" && e.len > 40;
  for (const [district, n] of [["city", 95], ["paris", 60]]) {
    const pool = district === "city" ? T.cityParked : T.parisParked;
    let placed = 0;
    for (let tries = 0; tries < n * 6 && placed < n; tries++) {
      const e = pickEdge((x) => parkable(x) && x.district === district);
      const tpl = pick(pool), spec = SPECS[tpl.specKey];
      if (e.len < spec.hd * 2 + 30) continue;
      const s = rr(15 + spec.hd, e.len - 15 - spec.hd), side = rand() < 0.5 ? -1 : 1;
      const p = pathAt(e, s, {});
      const rx = p.tz * side, rz = -p.tx * side;
      const off = e.w / 2 - 0.15 - spec.hw;
      const x = p.x + rx * off, z = p.z + rz * off;
      if (!freeSpot(x, z, spec.hd + 0.4)) continue;
      const heading = side > 0 ? Math.atan2(p.tx, p.tz) : Math.atan2(-p.tx, -p.tz);
      makeVehicle(tpl, x, z, heading);
      placed++;
    }
  }
  let bikes = 0;
  for (let tries = 0; tries < 400 && bikes < 50; tries++) {
    const e = pickEdge((x) => x.district !== "park" && x.sw >= 3);
    const s = rr(10, e.len - 10), side = rand() < 0.5 ? -1 : 1;
    const p = pathAt(e, s, {});
    const rx = p.tz * side, rz = -p.tx * side;
    const off = e.w / 2 + 0.8;
    const x = p.x + rx * off, z = p.z + rz * off;
    if (asphaltDist(x, z) < 0.3 || !freeSpot(x, z, 1.3)) continue;
    makeVehicle(pick(T.bikes), x, z, Math.atan2(-rx, -rz));
    bikes++;
  }
}
export function swapToBurnt(v) {
  const key = v.tpl ? v.tpl.burnKey : v.kind;
  if (!burntCache[key]) burntCache[key] = v.tpl ? v.tpl.buildBurnt() : build(v.kind, {}, v.kind === "bike" ? bikeParts : sedanParts(), true);
  const m = burntCache[key].createInstance("wreck");
  m.position.copyFrom(v.mesh.position);
  m.rotation.y = v.mesh.rotation.y;
  m.freezeWorldMatrix();
  v.mesh.dispose();
  v.mesh = m;
  v.wrecked = true;
}

// ---------------------------------------------------------------- traffic
const SPEED = { avenue: 13, street: 10, broadway: 12, roundabout: 8, radial: 13, plaza: 9, major: 11, minor: 8, outer: 13, parkway: 15 };
const TP = { x: 0, z: 0, tx: 0, tz: 1 };
function laneTarget(t) {
  const p = pathAt(t.e, t.s, TP);
  const fx = p.tx * t.dir, fz = p.tz * t.dir;
  return [p.x + fz * t.e.lane, p.z - fx * t.e.lane, Math.atan2(fx, fz)];
}
export function spawnTraffic() {
  for (const [district, n] of [["city", 90], ["paris", 45], ["park", 10]]) {
    const pool = district === "paris" ? T.parisTraffic : T.cityTraffic;
    for (let i = 0; i < n; i++) {
      const tpl = pick(pool), spec = SPECS[tpl.specKey];
      const e = pickEdge((x) => x.district === district && x.len > 20 + spec.hd * 2);
      const t = {
        e, dir: rand() < 0.5 ? 1 : -1, s: rr(5, e.len - 5), speed: 0, hits: 0, stopUntil: 0,
        tpl, spec, mesh: tpl.createInstance("traffic"),
        box: { rot: { cx: 0, cz: 0, c: 1, s: 0 }, lx0: -spec.hw - 0.05, lx1: spec.hw + 0.05, lz0: -spec.hd - 0.1, lz1: spec.hd + 0.1, minY: 0, maxY: spec.ht },
      };
      t.mult = rr(0.8, 1.15) * (spec.traffic ?? 1);
      const [x, z, h] = laneTarget(t);
      t.vx = x; t.vz = z; t.heading = h;
      traffic.push(t);
    }
  }
}
function nextEdge(t, overflow) {
  const nd = t.dir > 0 ? t.e.b : t.e.a;
  const opts = nd.edges.filter((e) => e !== t.e);
  const e = opts.length ? pick(opts) : t.e;
  if (e === t.e) { t.dir = -t.dir; t.s = t.dir > 0 ? overflow : e.len - overflow; return; }
  t.e = e;
  if (e.a === nd) { t.dir = 1; t.s = overflow; } else { t.dir = -1; t.s = e.len - overflow; }
}
// ctx: { pos, vehicle, peds }
export function updateTraffic(dt, now, ctx) {
  const pSpec = ctx.vehicle ? specOf(ctx.vehicle) : null;
  for (const t of traffic) {
    // Knocked by a crash: slide + spin freely, then drift back into the lane.
    if (t.knockT > 0) {
      t.knockT -= dt;
      const k = Math.exp(-2.6 * dt);
      t.vx += t.kvx * dt; t.vz += t.kvz * dt; t.kvx *= k; t.kvz *= k;
      t.heading += t.spin * dt; t.spin *= k;
      t.speed = 0;
      t.mesh.position.set(t.vx, 0, t.vz);
      t.mesh.rotation.y = t.heading;
      const r = t.box.rot;
      r.cx = t.vx; r.cz = t.vz; r.c = Math.cos(t.heading); r.s = Math.sin(t.heading);
      continue;
    }
    const fx = Math.sin(t.heading), fz = Math.cos(t.heading), sp = t.spec;
    // Is (qx,qz) in the lane box in front of this vehicle?
    const ahead = (qx, qz, halfW, near, far) => {
      const dx = qx - t.vx, dz = qz - t.vz;
      const fwd = dx * fx + dz * fz, lat = dx * fz - dz * fx;
      return fwd > near && fwd < far && Math.abs(lat) < sp.hw + halfW + 0.25;
    };
    let blocked = now < t.stopUntil;
    if (!blocked && ctx.pos.y < 2) {
      const ohd = pSpec ? pSpec.hd : 0.4, ohw = pSpec ? pSpec.hw : 0.4;
      if (ahead(ctx.pos.x, ctx.pos.z, ohw, 0.5, sp.hd + ohd + 4.5)) blocked = true;
    }
    if (!blocked) {
      for (const o of traffic) {
        if (o === t || Math.abs(o.vx - t.vx) > 20 || Math.abs(o.vz - t.vz) > 20) continue;
        if (Math.abs(angDiff(o.heading, t.heading)) > 1.1) continue;
        if (ahead(o.vx, o.vz, o.spec.hw, 1.0, sp.hd + o.spec.hd + 4.5)) { blocked = true; break; }
      }
    }
    if (!blocked) {
      for (const p of ctx.peds) {
        if (Math.abs(p.x - t.vx) > 14 || Math.abs(p.z - t.vz) > 14) continue;
        if (ahead(p.x, p.z, 0.3, 0.5, sp.hd + 5)) { blocked = true; break; }
      }
    }
    if (!blocked) {
      const reach = sp.hd + 3.3;
      const cx = t.vx + fx * reach, cz = t.vz + fz * reach;
      for (const s of query(cx - 3.5, cx + 3.5, cz - 3.5, cz + 3.5)) {
        if (!s.vehicle) continue;
        if (ahead(s.rot.cx, s.rot.cz, 1.0, 0.5, sp.hd + 6)) { blocked = true; break; }
      }
    }
    const base = (SPEED[t.e.kind] ?? 10) * t.mult;
    const target = blocked ? 0 : base;
    t.speed += clamp(target - t.speed, -24 * dt, 6 * dt);
    t.s += t.dir * t.speed * dt;
    let guard = 0;
    while ((t.s > t.e.len || t.s < 0) && guard++ < 4) nextEdge(t, t.s > t.e.len ? t.s - t.e.len : -t.s);

    const [x, z, h] = laneTarget(t);
    const d = Math.hypot(x - t.vx, z - t.vz);
    if (d > 0.6) { const k = Math.min(1, dt * (d > 2 ? 1.5 : 5)); t.vx += (x - t.vx) * k; t.vz += (z - t.vz) * k; }
    else { t.vx = x; t.vz = z; }
    t.heading += angDiff(h, t.heading) * Math.min(1, dt * (sp.hd > 3 ? 4 : 7));
    t.mesh.position.set(t.vx, 0, t.vz);
    t.mesh.rotation.y = t.heading;
    const r = t.box.rot;
    r.cx = t.vx; r.cz = t.vz; r.c = Math.cos(t.heading); r.s = Math.sin(t.heading);
  }
}
// Shove a traffic vehicle away from a crash (dx,dz = push direction) and spin it.
// Heavy vehicles barely move; light ones get thrown around.
export function knockTraffic(t, dx, dz, impact, pusherMass = 1) {
  const l = Math.hypot(dx, dz) || 1;
  const mass = t.spec.hd * t.spec.hw;                 // ~2 car, ~7.6 bus
  const k = clamp((impact * 0.55 * pusherMass) / mass, 0, 18);
  t.kvx = (dx / l) * k; t.kvz = (dz / l) * k;
  t.spin = (rand() < 0.5 ? -1 : 1) * clamp(impact * 0.07 / Math.sqrt(mass), 0, 3.2);
  t.knockT = 1.4 + impact * 0.03;
  t.stopUntil = performance.now() + 5000 + impact * 100;
  t.speed = 0;
}
export function stealTraffic(t) {
  traffic.splice(traffic.indexOf(t), 1);
  const v = { kind: t.spec.kind, spec: t.spec, tpl: t.tpl, mesh: t.mesh, heading: t.heading, speed: 0, hits: t.hits, wrecked: false, lean: 0 };
  v.solid = vehicleSolid(v);
  vehicles.push(v);
  return v;
}

// ---------------------------------------------------------------- driving
// How deeply a vehicle at pose (x, z, h) overlaps the world (0 = free).
// Returns { depth, traffic } where traffic is the first traffic vehicle touched.
// Using depth instead of a yes/no lets a vehicle that is already jammed into
// something drive *out* of it (any move that reduces the depth is allowed).
export function vehicleOverlap(v, x, z, h, y, enterables) {
  const c = specOf(v);
  const fx = Math.sin(h), fz = Math.cos(h);
  let depth = 0, hitT = null;
  for (const off of c.circles) {
    const cx = x + fx * off, cz = z + fz * off;
    for (const e of enterables) {
      const [lx, lz] = xfl(e.xf, cx, cz);
      if (lx > e.minX - 0.6 && lx < e.maxX + 0.6 && lz > e.minZ - 0.6 && lz < e.maxZ + 0.6 && y < e.F * e.fh) depth += 5;
    }
    for (const s of query(cx - c.r, cx + c.r, cz - c.r, cz + c.r)) {
      if (s.maxY <= y + 0.32 || s.minY >= y + Math.min(c.ht, 2.5)) continue;
      toLocal(s, cx, cz);
      const dx = L.x - clamp(L.x, s.lx0, s.lx1), dz = L.z - clamp(L.z, s.lz0, s.lz1);
      const d = Math.hypot(dx, dz);
      if (d < c.r) depth += c.r - d;
    }
    for (const t of traffic) {
      const reach = t.spec.hd + 2;
      if (Math.abs(t.vx - cx) > reach || Math.abs(t.vz - cz) > reach) continue;
      const tfx = Math.sin(t.heading), tfz = Math.cos(t.heading);
      for (const o of t.spec.circles) {
        const d = Math.hypot(t.vx + tfx * o - cx, t.vz + tfz * o - cz);
        const rr2 = c.r + t.spec.r;
        if (d < rr2) { depth += rr2 - d; hitT = hitT || t; }
      }
    }
  }
  return { depth, traffic: hitT };
}
export function vehicleBlocked(v, x, z, h, y, enterables) {
  const o = vehicleOverlap(v, x, z, h, y, enterables);
  return o.depth > 0 ? o.traffic || true : false;
}
// Push the vehicle out of any traffic vehicle it is jammed into (traffic is
// locked to its lane, so the player's vehicle is the one that gives way).
function separateFromTraffic(v, dt) {
  const c = specOf(v), p = v.mesh.position;
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  let px = 0, pz = 0;
  for (const off of c.circles) {
    const cx = p.x + fx * off, cz = p.z + fz * off;
    for (const t of traffic) {
      const reach = t.spec.hd + 2;
      if (Math.abs(t.vx - cx) > reach || Math.abs(t.vz - cz) > reach) continue;
      const tfx = Math.sin(t.heading), tfz = Math.cos(t.heading);
      for (const o of t.spec.circles) {
        const dx = cx - (t.vx + tfx * o), dz = cz - (t.vz + tfz * o);
        const d = Math.hypot(dx, dz) || 0.01;
        const pen = c.r + t.spec.r - d;
        if (pen > 0) { px += (dx / d) * pen; pz += (dz / d) * pen; t.stopUntil = Math.max(t.stopUntil, performance.now() + 1500); }
      }
    }
  }
  if (px || pz) {
    const k = Math.min(1, dt * 12);
    p.x += px * k; p.z += pz * k;
  }
}
// Arcade handling. keys: KeyboardEvent.code → bool. Returns impact speed.
export function driveVehicle(v, dt, keys, enterables, supportHeight) {
  const c = specOf(v);
  const throttle = keys.KeyW || keys.ArrowUp, back = keys.KeyS || keys.ArrowDown;
  const steer = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const boosting = (keys.ShiftLeft || keys.ShiftRight) && throttle;
  const top = c.max * (boosting ? c.boost : 1);
  if (throttle) {
    if (v.speed < -0.5) v.speed += c.brake * dt;
    else if (v.speed < top) v.speed = Math.min(top, v.speed + c.accel * (boosting ? 1.35 : 1) * dt);
  }
  if (back) v.speed -= (v.speed > 0.5 ? c.brake : c.accel * 0.7) * dt;
  if (keys.Space) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), c.brake * 1.3 * dt);
  // coasting drag, plus a gentle slow-down when above the current top speed (boost released)
  if (!throttle && !back) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), (2.5 + Math.abs(v.speed) * 0.12) * dt);
  else if (v.speed > top) v.speed = Math.max(top, v.speed - c.accel * 0.6 * dt);
  v.speed = clamp(v.speed, -c.rev, c.max * c.boost);

  const sf = clamp(Math.abs(v.speed) / 6, 0, 1) * (1 - 0.45 * clamp(Math.abs(v.speed) / c.max, 0, 1));
  const totalTurn = steer * c.turn * sf * Math.sign(v.speed) * dt;
  const p = v.mesh.position;
  // Sub-step so fast vehicles can't tunnel through posts and thin walls.
  const n = Math.max(1, Math.ceil(Math.abs(v.speed * dt) / 0.4));
  // Crash report for main.js: impact speed (m/s), what was hit, where, and
  // whether we're scraping along something.
  const res = { impact: 0, traffic: null, x: 0, z: 0, dir: 1, scrape: false };
  for (let i = 0; i < n; i++) {
    const newH = v.heading + totalTurn / n;
    const step = (v.speed * dt) / n;
    const nx = p.x + Math.sin(newH) * step, nz = p.z + Math.cos(newH) * step;
    // A move is OK if it doesn't dig deeper into anything than we already are.
    const cur = vehicleOverlap(v, p.x, p.z, v.heading, p.y, enterables).depth;
    const ok = (x, z, h) => vehicleOverlap(v, x, z, h, p.y, enterables).depth <= cur + 1e-4;
    const hit = vehicleOverlap(v, nx, nz, newH, p.y, enterables);
    if (hit.depth <= cur + 1e-4) { p.x = nx; p.z = nz; v.heading = newH; continue; }
    // glancing blow: slide along the obstacle (and lose some speed)
    if (ok(nx, p.z, v.heading)) { p.x = nx; v.speed *= 0.96; res.scrape = Math.abs(v.speed) > 6; continue; }
    if (ok(p.x, nz, v.heading)) { p.z = nz; v.speed *= 0.96; res.scrape = Math.abs(v.speed) > 6; continue; }
    // head-on: stop, bounce back
    const sgn = Math.sign(v.speed) || 1;
    res.impact = Math.abs(v.speed);
    res.traffic = hit.traffic;
    res.dir = sgn;
    res.x = p.x + Math.sin(v.heading) * c.hd * sgn;
    res.z = p.z + Math.cos(v.heading) * c.hd * sgn;
    if (hit.traffic) hit.traffic.stopUntil = performance.now() + 3000;
    v.speed = -v.speed * 0.25;
    if (ok(p.x, p.z, newH)) v.heading = newH;   // still allow steering out
    break;
  }
  separateFromTraffic(v, dt);
  const gy = supportHeight(p.x, p.z, p.y + 0.1);
  p.y += (gy - p.y) * Math.min(1, dt * 14);
  p.x = clamp(p.x, WORLD.x0 + 5, WORLD.x1 - 5);
  p.z = clamp(p.z, WORLD.z0 + 5, WORLD.z1 - 5);
  v.mesh.rotation.y = v.heading;
  if (v.kind === "bike") {
    const leanT = -steer * clamp(Math.abs(v.speed) / 14, 0, 1) * 0.42;
    v.lean += (leanT - v.lean) * Math.min(1, dt * 6);
    v.mesh.rotation.z = v.lean;
  }
  return res;
}
