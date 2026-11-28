// wildlife.js — animals, in three places:
//
//   Swayambhu's forest (killers)
//     wolves   packs of three, fast, bite often, come at you from the sides
//     jackals  packs of four: small, quick, nippy
//     tigers   stalk, then pounce from close range — a few hits and you're down
//     leopards smaller, faster, pounce too
//     bears    slower, very tough, hit very hard
//     boars    charge you down
//   Swayambhu's stairways and summit (harmless)
//     monkeys  sit about on the steps, scamper off if you come close
//     dogs     stray dogs lounging on the landings, the odd bark
//   The Himalayas (himalaya.js builds them; these come with them)
//     yetis    huge, tough, smash you flat
//     snow leopards  pounce out of the rocks
//     yaks     graze the valley floor (harmless)
//
// Killers hunt you once you're on their ground (the forest off the stairs;
// the mountains outside base camp) and close enough. The stairway / summit /
// anywhere outside the wall, and base camp, are safe: they stop at the edge
// and growl. Shoot them, or run for safety. Killed in the forest you come
// round outside the gate; in the mountains, at base camp.
//
// Bodies are vertex-coloured templates (one per species) with four limbs on
// hip pivots — a handful of instanced draw calls for the lot. Nothing runs
// while you're far from where they live.
import { scene, hex, terrainH, colorTemplate, SWAY, SWAY_SEGS } from "./engine.js";
import { onStairs, swayR, inCourtyard } from "./swayambhu.js";
import { HIM, CAMP, REALM, inHimBox, himH } from "./realm.js";
import * as sfx from "./sound.js";

const MB = BABYLON.MeshBuilder;
// detect: how far off they notice you · reach: bite range · bite: seconds between bites
// passive: never hunts (flees when you come close / shoot it) · flee: how close is too close
// biped: walks on two legs (arms swing as the front pair)
const K = {
  wolf: { hp: 3, run: 8.3, walk: 1.5, detect: 40, reach: 1.7, dmg: 11, bite: 0.8, gait: 6.5, len: 1.4, wid: 0.5, ht: 1.1, name: "Wolves", plural: true, voice: 1.25 },
  jackal: { hp: 2, run: 8.8, walk: 1.6, detect: 36, reach: 1.5, dmg: 8, bite: 0.65, gait: 7.5, len: 1.1, wid: 0.4, ht: 0.85, name: "Jackals", plural: true, voice: 1.55 },
  tiger: { hp: 7, run: 9.4, walk: 1.3, detect: 48, reach: 2.4, dmg: 30, bite: 1.25, gait: 4.6, len: 2.4, wid: 0.75, ht: 1.4, pounce: true, name: "A tiger", voice: 0.85 },
  leopard: { hp: 5, run: 10.2, walk: 1.4, detect: 44, reach: 2.0, dmg: 22, bite: 1.0, gait: 5.4, len: 1.9, wid: 0.6, ht: 1.1, pounce: true, name: "A leopard", voice: 1.05 },
  bear: { hp: 11, run: 7.0, walk: 1.0, detect: 30, reach: 2.4, dmg: 27, bite: 1.5, gait: 4.0, len: 2.1, wid: 1.0, ht: 1.6, name: "A bear", voice: 0.7 },
  boar: { hp: 6, run: 8.6, walk: 1.2, detect: 30, reach: 1.8, dmg: 18, bite: 1.1, gait: 6.0, len: 1.5, wid: 0.65, ht: 1.0, name: "A wild boar", voice: 1.4 },
  monkey: { hp: 1, run: 5.5, walk: 1.1, reach: 0, dmg: 0, gait: 8, len: 0.6, wid: 0.35, ht: 0.7, passive: true, flee: 3.5, voice: 2.6 },
  dog: { hp: 2, run: 6.5, walk: 1.2, reach: 0, dmg: 0, gait: 6.5, len: 1.0, wid: 0.4, ht: 0.8, passive: true, flee: 0, voice: 1.9 },
  yeti: { hp: 18, run: 7.6, walk: 1.2, detect: 80, reach: 3.0, dmg: 34, bite: 1.6, gait: 3.2, len: 1.2, wid: 1.3, ht: 3.5, biped: true, name: "A YETI", voice: 0.5 },
  snowleopard: { hp: 5, run: 10.0, walk: 1.3, detect: 55, reach: 2.0, dmg: 24, bite: 1.0, gait: 5.4, len: 2.0, wid: 0.6, ht: 1.1, pounce: true, name: "A snow leopard", voice: 1.0 },
  yak: { hp: 6, run: 5.5, walk: 0.7, reach: 0, dmg: 0, gait: 3.6, len: 2.2, wid: 1.0, ht: 1.8, passive: true, flee: 7, voice: 0.6 },
};
let H = {};           // hooks: hurtPlayer(n, fx, fz), playerDead(), toast(html, ms), pan(x, z), dist(x, z)
const animals = [];
const shoot = [];
let ready = false, warnAt = 0, realmSpawned = false;

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
// a dog-shaped body, scaled (wolves, jackals, dogs)
function canine(k, back, belly, head, dark, tailUp = 2.2) {
  const S = (v) => v * k;
  return [
    ["s", { s: [S(0.38), S(0.42), S(1.05)], p: [0, S(0.72), 0], c: C(back) }],
    ["s", { s: [S(0.3), S(0.24), S(0.85)], p: [0, S(0.6), 0], c: C(belly) }],
    ["s", { s: [S(0.42), S(0.48), S(0.5)], p: [0, S(0.78), S(0.33)], c: C(head) }],
    ["s", { s: [S(0.26), S(0.32), S(0.32)], p: [0, S(0.92), S(0.55)], c: C(back) }],
    ["s", { s: [S(0.27), S(0.26), S(0.33)], p: [0, S(1.02), S(0.7)], c: C(head) }],
    ["b", { w: S(0.13), h: S(0.12), d: S(0.24), p: [0, S(0.96), S(0.9)], c: C(dark) }],
    ["b", { w: S(0.06), h: S(0.05), d: S(0.05), p: [0, S(0.99), S(1.02)], c: C("#111111") }],
    ["s", { s: [S(0.04), S(0.04), S(0.03)], p: [S(-0.07), S(1.06), S(0.84)], c: C("#d8b040") }],
    ["s", { s: [S(0.04), S(0.04), S(0.03)], p: [S(0.07), S(1.06), S(0.84)], c: C("#d8b040") }],
    ["c", { dt: 0, db: S(0.1), h: S(0.16), p: [S(-0.08), S(1.18), S(0.66)], c: C(dark) }],
    ["c", { dt: 0, db: S(0.1), h: S(0.16), p: [S(0.08), S(1.18), S(0.66)], c: C(dark) }],
    ["c", { dt: S(0.05), db: S(0.12), h: S(0.55), r: [tailUp, 0, 0], p: [0, S(0.68), S(-0.72)], c: C(dark) }],
  ];
}
// a big cat (tiger, leopard, snow leopard), scaled
function feline(k, coat, belly, ear, tailLen = 1.05, tailThick = 1) {
  const S = (v) => v * k;
  return [
    ["s", { s: [S(0.58), S(0.62), S(1.65)], p: [0, S(1.0), 0], c: C(coat) }],
    ["s", { s: [S(0.44), S(0.32), S(1.3)], p: [0, S(0.82), 0], c: C(belly) }],
    ["s", { s: [S(0.6), S(0.66), S(0.7)], p: [0, S(1.05), S(0.55)], c: C(coat) }],
    ["s", { s: [S(0.44), S(0.42), S(0.44)], p: [0, S(1.18), S(1.0)], c: C(coat) }],
    ["s", { s: [S(0.26), S(0.2), S(0.22)], p: [0, S(1.08), S(1.2)], c: C(belly) }],
    ["b", { w: S(0.09), h: S(0.06), d: S(0.05), p: [0, S(1.15), S(1.3)], c: C("#2a1a14") }],
    ["s", { s: [S(0.05), S(0.04), S(0.03)], p: [S(-0.1), S(1.27), S(1.19)], c: C("#c9d040") }],
    ["s", { s: [S(0.05), S(0.04), S(0.03)], p: [S(0.1), S(1.27), S(1.19)], c: C("#c9d040") }],
    ["s", { s: [S(0.12), S(0.13), S(0.06)], p: [S(-0.15), S(1.4), S(0.95)], c: C(ear) }],
    ["s", { s: [S(0.12), S(0.13), S(0.06)], p: [S(0.15), S(1.4), S(0.95)], c: C(ear) }],
    ["c", { dt: S(0.07) * tailThick, db: S(0.13) * tailThick, h: S(tailLen), r: [2.0, 0, 0], p: [0, S(0.9), S(-0.7 - tailLen / 2)], c: C(coat) }],
  ];
}
// species: body parts, leg { dt, db, h, paw, c }, hips [x, y, z] (front ±z)
// (or limbs: [[x, y, z, "leg" | "arm"] × 4], front pair first, for the yeti),
// pattern: dark markings painted into the coat's vertex colours
const SPECIES = {
  wolf: { body: canine(1, "#7d7770", "#b5ada0", "#86807a", "#5f5a54"), leg: { dt: 0.1, db: 0.07, h: 0.56, paw: 0.1, c: "#6e6861" }, hips: [0.12, 0.6, 0.38] },
  jackal: { body: canine(0.78, "#a5814f", "#e0cfa8", "#b08a55", "#5c4630"), leg: { dt: 0.08, db: 0.055, h: 0.44, paw: 0.08, c: "#94744a" }, hips: [0.095, 0.47, 0.3] },
  dog: { body: canine(0.82, "#b08a5a", "#e6d6b8", "#a57e50", "#6b5236", 1.0), leg: { dt: 0.085, db: 0.06, h: 0.46, paw: 0.085, c: "#a17b4d" }, hips: [0.1, 0.49, 0.31] },
  dog2: { body: canine(0.8, "#2b2522", "#c9a77a", "#2e2724", "#1a1614", 1.0), leg: { dt: 0.085, db: 0.06, h: 0.45, paw: 0.085, c: "#3a312c" }, hips: [0.1, 0.48, 0.3] },
  tiger: { body: feline(1, "#d9822b", "#efe3cf", "#2a1a14"), leg: { dt: 0.21, db: 0.15, h: 0.8, paw: 0.2, c: "#d4782a" }, hips: [0.18, 0.82, 0.58],
    pattern: { on: [0.85, 0.51, 0.17], mark: (x, y, z) => Math.sin(z * 17 + Math.abs(x) * 6 + y * 4) > 0.45, col: [0.12, 0.08, 0.06] } },
  leopard: { body: feline(0.78, "#d6a144", "#efe2c6", "#2a1a14", 1.1), leg: { dt: 0.16, db: 0.11, h: 0.64, paw: 0.15, c: "#cf9a40" }, hips: [0.14, 0.65, 0.45],
    pattern: { on: [0.84, 0.63, 0.27], mark: (x, y, z) => Math.sin(x * 31 + z * 9) * Math.sin(z * 27 - y * 13) > 0.42, col: [0.16, 0.11, 0.07] } },
  snowleopard: { body: feline(0.8, "#cbc8be", "#ecebe5", "#4a4744", 1.25, 1.6), leg: { dt: 0.17, db: 0.12, h: 0.62, paw: 0.17, c: "#c4c1b7" }, hips: [0.14, 0.64, 0.46],
    pattern: { on: [0.8, 0.78, 0.75], mark: (x, y, z) => Math.sin(x * 26 + z * 8) * Math.sin(z * 22 - y * 12) > 0.38, col: [0.28, 0.27, 0.27] } },
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
      ["s", { s: [0.5, 0.12, 0.3], p: [0, 1.15, 0.62], c: C("#d8cfb0") }],      // the pale chest crescent (Himalayan black bear)
    ],
    leg: { dt: 0.3, db: 0.25, h: 0.78, paw: 0.29, c: "#33251a" }, hips: [0.26, 0.78, 0.5],
  },
  boar: {
    body: [
      ["s", { s: [0.6, 0.66, 1.25], p: [0, 0.74, 0], c: C("#3a2f27") }],
      ["s", { s: [0.2, 0.22, 1.0], p: [0, 1.02, 0.05], c: C("#1f1915") }],      // bristly back
      ["s", { s: [0.5, 0.52, 0.55], p: [0, 0.76, 0.55], c: C("#3f332a") }],
      ["s", { s: [0.34, 0.36, 0.5], p: [0, 0.66, 0.85], c: C("#3a2f27") }],
      ["c", { dt: 0.16, db: 0.2, h: 0.24, r: [Math.PI / 2, 0, 0], p: [0, 0.6, 1.12], c: C("#4a3c32") }],
      ["c", { dt: 0.17, db: 0.17, h: 0.03, r: [Math.PI / 2, 0, 0], p: [0, 0.6, 1.25], c: C("#c79a8a") }],
      ["c", { dt: 0, db: 0.05, h: 0.18, r: [-0.6, 0, 0.5], p: [-0.1, 0.58, 1.1], c: C("#efe8d8") }],
      ["c", { dt: 0, db: 0.05, h: 0.18, r: [-0.6, 0, -0.5], p: [0.1, 0.58, 1.1], c: C("#efe8d8") }],
      ["s", { s: [0.04, 0.04, 0.03], p: [-0.12, 0.78, 0.98], c: C("#111111") }],
      ["s", { s: [0.04, 0.04, 0.03], p: [0.12, 0.78, 0.98], c: C("#111111") }],
      ["c", { dt: 0, db: 0.12, h: 0.18, r: [-0.4, 0, -0.3], p: [-0.16, 0.98, 0.72], c: C("#1f1915") }],
      ["c", { dt: 0, db: 0.12, h: 0.18, r: [-0.4, 0, 0.3], p: [0.16, 0.98, 0.72], c: C("#1f1915") }],
      ["c", { dt: 0.02, db: 0.05, h: 0.35, r: [2.6, 0, 0], p: [0, 0.78, -0.72], c: C("#1f1915") }],
    ],
    leg: { dt: 0.12, db: 0.08, h: 0.48, paw: 0.09, c: "#251e19" }, hips: [0.17, 0.5, 0.42],
  },
  monkey: {
    body: [
      ["s", { s: [0.32, 0.34, 0.5], p: [0, 0.48, 0], c: C("#8b7a63") }],
      ["s", { s: [0.3, 0.3, 0.3], p: [0, 0.52, 0.2], c: C("#9a876c") }],
      ["s", { s: [0.26, 0.27, 0.26], p: [0, 0.68, 0.32], c: C("#8b7a63") }],
      ["s", { s: [0.18, 0.18, 0.1], p: [0, 0.66, 0.43], c: C("#d9a08a") }],     // the pink face
      ["s", { s: [0.03, 0.03, 0.02], p: [-0.04, 0.69, 0.48], c: C("#1a1410") }],
      ["s", { s: [0.03, 0.03, 0.02], p: [0.04, 0.69, 0.48], c: C("#1a1410") }],
      ["s", { s: [0.06, 0.08, 0.04], p: [-0.13, 0.71, 0.33], c: C("#c48f78") }],
      ["s", { s: [0.06, 0.08, 0.04], p: [0.13, 0.71, 0.33], c: C("#c48f78") }],
      ["s", { s: [0.16, 0.12, 0.08], p: [0, 0.4, -0.25], c: C("#c48f78") }],
      ["c", { dt: 0.03, db: 0.05, h: 0.55, r: [2.5, 0, 0], p: [0, 0.62, -0.42], c: C("#7a6a55") }],   // the tail, curled up
    ],
    leg: { dt: 0.06, db: 0.045, h: 0.36, paw: 0.06, c: "#6f604d" }, hips: [0.1, 0.4, 0.17],
  },
  yak: {
    body: [
      ["s", { s: [0.95, 1.0, 1.75], p: [0, 1.28, 0], c: C("#2a211c") }],
      ["s", { s: [1.02, 0.55, 1.6], p: [0, 0.95, 0], c: C("#1f1915") }],        // the long fur skirt
      ["s", { s: [0.8, 0.7, 0.8], p: [0, 1.6, 0.45], c: C("#2f2520") }],         // shoulder hump
      ["s", { s: [0.48, 0.52, 0.62], p: [0, 1.22, 1.05], c: C("#2a211c") }],
      ["s", { s: [0.34, 0.3, 0.34], p: [0, 1.05, 1.3], c: C("#5a4a40") }],
      ["s", { s: [0.28, 0.2, 0.1], p: [0, 1.32, 1.28], c: C("#e8e2d6") }],       // white blaze
      ["c", { dt: 0.02, db: 0.09, h: 0.5, r: [0, 0, 1.0], p: [-0.38, 1.5, 1.05], c: C("#d8cfba") }],
      ["c", { dt: 0.02, db: 0.09, h: 0.5, r: [0, 0, -1.0], p: [0.38, 1.5, 1.05], c: C("#d8cfba") }],
      ["s", { s: [0.04, 0.04, 0.03], p: [-0.16, 1.3, 1.28], c: C("#111111") }],
      ["s", { s: [0.04, 0.04, 0.03], p: [0.16, 1.3, 1.28], c: C("#111111") }],
      ["c", { dt: 0.05, db: 0.07, h: 0.6, r: [2.7, 0, 0], p: [0, 1.15, -0.95], c: C("#2a211c") }],
      ["s", { s: [0.18, 0.3, 0.18], p: [0, 0.85, -1.15], c: C("#e8e2d6") }],     // tail tuft
    ],
    leg: { dt: 0.2, db: 0.14, h: 0.86, paw: 0.17, c: "#1f1915" }, hips: [0.3, 0.88, 0.62],
  },
  yeti: {
    body: [
      ["s", { s: [1.25, 1.75, 0.95], p: [0, 2.05, 0], c: C("#e9ece9") }],
      ["s", { s: [0.95, 1.2, 0.5], p: [0, 1.95, 0.28], c: C("#cfd4d6") }],
      ["s", { s: [1.5, 0.75, 1.0], p: [0, 2.75, -0.05], c: C("#eef0ee") }],       // hunched shoulders
      ["s", { s: [1.05, 0.72, 0.82], p: [0, 1.38, 0], c: C("#e3e7e6") }],         // hips
      ["s", { s: [0.62, 0.66, 0.62], p: [0, 3.22, 0.24], c: C("#eef0ee") }],      // head
      ["s", { s: [0.42, 0.46, 0.2], p: [0, 3.16, 0.5], c: C("#45424a") }],        // the bare grey face
      ["s", { s: [0.5, 0.13, 0.22], p: [0, 3.33, 0.48], c: C("#dfe3e2") }],       // heavy brow
      ["s", { s: [0.07, 0.06, 0.04], p: [-0.11, 3.24, 0.6], c: C("#c0392b") }],   // eyes
      ["s", { s: [0.07, 0.06, 0.04], p: [0.11, 3.24, 0.6], c: C("#c0392b") }],
      ["b", { w: 0.22, h: 0.07, d: 0.05, p: [0, 3.04, 0.59], c: C("#1a1212") }],  // mouth
      ["c", { dt: 0, db: 0.05, h: 0.09, r: [Math.PI, 0, 0], p: [-0.07, 3.0, 0.6], c: C("#f2efe4") }],   // fangs
      ["c", { dt: 0, db: 0.05, h: 0.09, r: [Math.PI, 0, 0], p: [0.07, 3.0, 0.6], c: C("#f2efe4") }],
      // shaggy tufts
      ["s", { s: [0.55, 0.6, 0.55], p: [-0.55, 2.2, -0.15], c: C("#dde1df") }],
      ["s", { s: [0.55, 0.6, 0.55], p: [0.55, 2.2, -0.15], c: C("#dde1df") }],
      ["s", { s: [0.5, 0.5, 0.45], p: [-0.45, 1.6, 0.2], c: C("#eef0ee") }],
      ["s", { s: [0.5, 0.5, 0.45], p: [0.45, 1.6, 0.2], c: C("#eef0ee") }],
      ["s", { s: [0.7, 0.55, 0.5], p: [0, 2.5, -0.45], c: C("#e1e5e3") }],
      ["s", { s: [0.42, 0.42, 0.42], p: [0, 3.5, 0.12], c: C("#e9ece9") }],
    ],
    limbs: [[-0.86, 2.68, 0.1, "arm"], [0.86, 2.68, 0.1, "arm"], [-0.38, 1.28, -0.05, "leg"], [0.38, 1.28, -0.05, "leg"]],
    leg: { dt: 0.46, db: 0.34, h: 1.22, paw: 0.42, c: "#e3e7e6", foot: "#5b585c" },
    arm: { dt: 0.38, db: 0.26, h: 1.8, paw: 0.34, c: "#e9ece9", foot: "#4e4b50" },
  },
};
const tpls = {};
function limbTemplate(name, L) {
  const leg = part("c", { dt: L.dt, db: L.db, h: L.h, p: [0, -L.h / 2, 0], c: C(L.c) });
  const paw = part("s", { s: [L.paw, L.paw * 0.7, L.paw * 1.3], p: [0, -L.h, L.paw * 0.2], c: C(L.foot || L.c) });
  return colorTemplate(name, [leg, paw]);
}
function makeTemplates() {
  for (const [name, sp] of Object.entries(SPECIES)) {
    const parts = sp.body.map(([k, o]) => part(k, o));
    const body = colorTemplate("animal_" + name, parts);
    // stripes / spots / rosettes: dark marks painted into the vertex colours of the coat
    if (sp.pattern) {
      const P = sp.pattern;
      const pos = body.getVerticesData(BABYLON.VertexBuffer.PositionKind), col = body.getVerticesData(BABYLON.VertexBuffer.ColorKind);
      for (let i = 0; i < pos.length / 3; i++) {
        const r = col[i * 4], g = col[i * 4 + 1], b = col[i * 4 + 2];
        if (Math.abs(r - P.on[0]) > 0.06 || Math.abs(g - P.on[1]) > 0.06 || Math.abs(b - P.on[2]) > 0.08) continue;
        if (P.mark(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])) { col[i * 4] = P.col[0]; col[i * 4 + 1] = P.col[1]; col[i * 4 + 2] = P.col[2]; }
      }
      body.setVerticesData(BABYLON.VertexBuffer.ColorKind, col);
    }
    const t = { body, leg: limbTemplate("animalLeg_" + name, sp.leg), hips: sp.hips, limbs: sp.limbs };
    if (sp.arm) t.arm = limbTemplate("animalArm_" + name, sp.arm);
    tpls[name] = t;
  }
}

// ---------------------------------------------------------------- where they live
// zone: allowed(x, z) where they may walk · huntable(p) you're fair game ·
// spot() somewhere to (re)spawn · active(me) worth running at all · safe: the
// message when they've got you on the run
const inForest = (x, z) => {
  const r = swayR(x, z);
  return r > SWAY.R0 + 3 && r < SWAY.RW - 1.5 && !inCourtyard(x, z) && !onStairs(x, z);
};
const nearSway = (me) => swayR(me.x, me.z) < SWAY.RW + 260;
function forestSpot() {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2, r = SWAY.R0 + 10 + Math.random() * (SWAY.RB - SWAY.R0 - 14);
    const x = SWAY.x + Math.sin(a) * r, z = SWAY.z + Math.cos(a) * r;
    if (inForest(x, z)) return [x, z];
  }
  return [SWAY.x + 60, SWAY.z];
}
// the stairways, the summit and the courtyard inside the gate
const onSteps = (x, z) => onStairs(x, z) || swayR(x, z) < SWAY.R0 - 2 || inCourtyard(x, z);
function stairSpot() {
  for (let i = 0; i < 30; i++) {
    let x, z;
    if (Math.random() < 0.2) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (SWAY.R0 - 8);
      x = SWAY.x + Math.sin(a) * r; z = SWAY.z + Math.cos(a) * r;
    } else {
      const s = SWAY_SEGS[Math.floor(Math.random() * SWAY_SEGS.length)], t = Math.random() * s.len, off = (Math.random() - 0.5) * SWAY.hw * 1.4;
      x = s.ax + s.ux * t - s.uz * off; z = s.az + s.uz * t + s.ux * off;
    }
    if (onSteps(x, z)) return [x, z];
  }
  return [SWAY.x, SWAY.z - SWAY.R0 + 6];
}
// the mountains: the valley and its lower slopes, kept out of base camp
let campY = null;
const campH = () => (campY ??= himH(HIM.x + CAMP.u, HIM.z + CAMP.v));
const campD = (x, z) => Math.hypot(x - HIM.x - CAMP.u, z - HIM.z - CAMP.v);
const inSnow = (x, z, alt = 520, campR = CAMP.r + 12) => {
  const u = x - HIM.x, v = z - HIM.z;
  return Math.abs(u) < 2050 && Math.abs(v) < 2050 && campD(x, z) > campR && himH(x, z) - campH() < alt;
};
function snowSpot(alt, minD, maxD = 1900) {
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2, r = minD + Math.random() * (maxD - minD);
    const x = HIM.x + CAMP.u + Math.sin(a) * r, z = HIM.z + CAMP.v + 300 + Math.cos(a) * r;
    if (inSnow(x, z, alt)) return [x, z];
  }
  return [HIM.x + CAMP.u + 400, HIM.z + CAMP.v + 400];
}
const ZONES = {
  forest: {
    allowed: inForest, active: nearSway, spot: forestSpot,
    huntable: (p) => { const r = swayR(p.x, p.z); return r < SWAY.RW - 0.5 && r > SWAY.R0 + 1 && !inCourtyard(p.x, p.z) && !onStairs(p.x, p.z); },
    safe: "Get back to the stairway — they won't follow you onto it",
  },
  steps: { allowed: onSteps, active: nearSway, spot: stairSpot, huntable: () => false },
  snow: {
    allowed: (x, z) => inSnow(x, z), active: (me) => REALM.on && inHimBox(me.x, me.z), spot: () => snowSpot(480, 260),
    huntable: (p) => REALM.on && inHimBox(p.x, p.z) && campD(p.x, p.z) > CAMP.r,
    stalk: 700,      // they come looking for you when you're out on the ice
    safe: "Get back to base camp — they won't come near it",
  },
  pasture: {
    allowed: (x, z) => inSnow(x, z, 70, CAMP.r - 20), active: (me) => REALM.on && inHimBox(me.x, me.z), spot: () => snowSpot(60, 110, 900),
    huntable: () => false,
  },
};

// ---------------------------------------------------------------- spawning
function spawn(kind, x, z, zone, pack = null, tplName = kind) {
  const t = tpls[tplName];
  const root = new BABYLON.TransformNode("animal", scene);
  const body = t.body.createInstance("ab"); body.parent = root;
  let legs;
  if (t.limbs) {
    legs = t.limbs.map(([lx, ly, lz, w]) => {
      const l = (w === "arm" ? t.arm : t.leg).createInstance("al"); l.parent = root; l.position.set(lx, ly, lz); return l;
    });
  } else {
    const [hx, hy, hz] = t.hips;
    legs = [[-hx, hz], [hx, hz], [-hx, -hz], [hx, -hz]].map(([lx, lz]) => {
      const l = t.leg.createInstance("al"); l.parent = root; l.position.set(lx, hy, lz); return l;
    });
  }
  const k = K[kind];
  const a = {
    kind, k, zone: ZONES[zone], root, body, legs, x, z, h: Math.random() * 6.28, speed: 0, state: "roam", hp: k.hp,
    tx: x, tz: z, idle: Math.random() * 3, cool: 0, phase: Math.random() * 6, pounce: 0, pounceCool: 0, deadT: 0, pack,
    side: Math.random() < 0.5 ? -1 : 1, growlT: Math.random() * 5, rest: 0, fleeT: 0,
  };
  a.box = { rot: { cx: x, cz: z, c: 1, s: 0 }, lx0: -k.wid / 2, lx1: k.wid / 2, lz0: -k.len / 2, lz1: k.len / 2, minY: 0, maxY: k.ht };
  a.target = { box: a.box, onHit: () => hit(a) };
  root.setEnabled(false);
  animals.push(a);
  return a;
}
const packOf = (kind, zone, n, size, spotFn) => {
  for (let p = 0; p < n; p++) {
    const [x, z] = spotFn();
    for (let i = 0; i < size; i++) spawn(kind, x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6, zone, kind + p);
  }
};
export function initWildlife(hooks) {
  H = hooks || {};
  makeTemplates();
  // the forest is full of them
  packOf("wolf", "forest", 8, 3, forestSpot);
  packOf("jackal", "forest", 5, 4, forestSpot);
  for (let i = 0; i < 6; i++) spawn("tiger", ...forestSpot(), "forest");
  for (let i = 0; i < 7; i++) spawn("leopard", ...forestSpot(), "forest");
  for (let i = 0; i < 6; i++) spawn("bear", ...forestSpot(), "forest");
  for (let i = 0; i < 9; i++) spawn("boar", ...forestSpot(), "forest");
  // the stairs: monkeys everywhere, a few stray dogs
  for (let i = 0; i < 24; i++) spawn("monkey", ...stairSpot(), "steps");
  for (let i = 0; i < 10; i++) spawn("dog", ...stairSpot(), "steps", null, i % 2 ? "dog" : "dog2");
  ready = true;
}
// the mountains' animals (once the range has been built)
export function spawnRealmAnimals() {
  if (realmSpawned) return;
  realmSpawned = true;
  campY = null;
  for (let i = 0; i < 11; i++) spawn("yeti", ...snowSpot(480, 320), "snow");
  for (let i = 0; i < 7; i++) spawn("snowleopard", ...snowSpot(480, 260), "snow");
  // yaks graze in little herds near camp
  for (let h = 0; h < 4; h++) {
    const [x, z] = snowSpot(60, 110, 700);
    for (let i = 0; i < 3; i++) spawn("yak", x + (Math.random() - 0.5) * 12, z + (Math.random() - 0.5) * 12, "pasture");
  }
}

// ---------------------------------------------------------------- being shot
function hit(a) {
  if (a.state === "dead") return;
  a.hp--;
  a.provoked = 12;
  if (a.k.passive) { a.fleeT = 6; a.rest = 0; }
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
  sfx.growl(d, H.pan ? H.pan(a.x, a.z) : 0, a.k.voice || 1, loud ? 1 : 0.7);
}

// ---------------------------------------------------------------- per frame
const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
export function updateWildlife(dt, ctx) {
  if (!ready) return;
  const me = ctx.pos;
  const dead = H.playerDead ? H.playerDead() : false;
  // which places are worth running this frame
  const live = new Map();
  for (const [name, z] of Object.entries(ZONES)) live.set(z, z.active(me));
  const prey = new Map();
  for (const z of Object.values(ZONES)) prey.set(z, !dead && live.get(z) && z.huntable(me));
  let alarm = null;
  for (const a of animals) {
    const Z = a.zone;
    if (!live.get(Z)) {
      if (a.root.isEnabled()) a.root.setEnabled(false);
      continue;
    }
    if (!a.root.isEnabled()) a.root.setEnabled(true);
    const k = a.k;
    a.growlT -= dt; a.cool -= dt; a.pounceCool -= dt;
    if (a.provoked > 0) a.provoked -= dt;
    if (a.state === "dead") {
      a.deadT -= dt;
      if (a.deadT <= 0 && Math.hypot(me.x - a.x, me.z - a.z) > 90) {
        const [x, z] = Z.spot();
        a.x = x; a.z = z; a.hp = k.hp; a.state = "roam"; a.root.rotation.z = 0; a.fleeT = 0;
      }
      place(a, 0);
      continue;
    }
    const dx = me.x - a.x, dz = me.z - a.z, d = Math.hypot(dx, dz) || 0.01;
    if (k.passive) passive(a, dt, dx, dz, d, me);
    else {
      const onPrey = prey.get(Z);
      // hunt: you're on their ground and close enough (or you shot them)
      const hunting = (onPrey && (d < k.detect || (a.state !== "roam" && d < 85))) || (a.provoked > 0 && d < 70 && onPrey);
      if (hunting) {
        if (a.state === "roam") { a.state = "hunt"; alarm = alarm || a; growl(a, true); }
        // pack hunters fan out and come in from the sides
        let want = Math.atan2(dx, dz);
        if (a.pack !== null && d > 6) want += a.side * 0.45 * Math.min(1, (d - 6) / 15);
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
            a.lunge = k.biped ? 0.45 : 0.25;
          }
        }
        a.speed += (sp - a.speed) * Math.min(1, dt * 6);
      } else if (!onPrey && a.state === "hunt" && d < 30) {
        // you've got out of reach: pace and growl at the edge
        a.state = "watch";
        growl(a);
      } else {
        if (a.state !== "roam" && (a.state !== "watch" || d > 40 || onPrey)) a.state = "roam";
        if (a.state === "watch") {
          a.speed += (0 - a.speed) * Math.min(1, dt * 5);
          a.h = turn(a.h, Math.atan2(dx, dz), dt * 3);
          if (Math.random() < dt * 0.4) growl(a);
        } else roam(a, dt, 50, onPrey && Z.stalk && d < Z.stalk ? me : null);
      }
    }
    move(a, dt);
    place(a, dt);
  }
  // a warning, now and then
  if (alarm && performance.now() > warnAt && H.toast) {
    warnAt = performance.now() + 9000;
    H.toast(`<b>${alarm.k.name.toUpperCase()}</b> ${alarm.k.plural ? "are" : "is"} hunting you<small>${alarm.zone.safe || ""}</small>`, 3200);
  }
}
// amble to a spot nearby, stop a while (sit / lie down, for some), pick another
function roam(a, dt, range, toward = null) {
  const k = a.k, tdx = a.tx - a.x, tdz = a.tz - a.z, td = Math.hypot(tdx, tdz);
  if (td < 1.2) {
    a.speed += (0 - a.speed) * Math.min(1, dt * 4);
    a.idle -= dt;
    if (a.idle <= 0) {
      a.idle = k.passive ? 3 + Math.random() * 12 : 2 + Math.random() * 6;
      a.rest = k.passive && Math.random() < 0.6 ? a.idle : 0;      // sit down / lie down for it
      if (toward) a.idle *= 0.4;     // stalking: shorter stops
      for (let i = 0; i < 10; i++) {
        // (stalking: the next spot is somewhere round you)
        const cx = toward ? toward.x : a.x, cz = toward ? toward.z : a.z, rg = toward ? 70 : range;
        const nx = cx + (Math.random() - 0.5) * rg, nz = cz + (Math.random() - 0.5) * rg;
        if (a.zone.allowed(nx, nz)) { a.tx = nx; a.tz = nz; break; }
      }
    }
  } else {
    a.rest = 0;
    a.h = turn(a.h, Math.atan2(tdx, tdz), dt * 2.5);
    a.speed += ((toward ? k.walk * 3 : k.walk) - a.speed) * Math.min(1, dt * 3);   // (stalking: a steady lope)
  }
  if (a.rest > 0) a.rest -= dt;
}
// harmless ones: keep their distance, run off when shot
function passive(a, dt, dx, dz, d, me) {
  const k = a.k;
  if (a.fleeT > 0) a.fleeT -= dt;
  if ((k.flee && d < k.flee) || a.fleeT > 0) {
    if (a.fleeT <= 0) a.fleeT = 1.5 + Math.random();
    a.rest = 0;
    a.h = turn(a.h, Math.atan2(-dx, -dz), dt * 8);
    a.speed += (k.run - a.speed) * Math.min(1, dt * 6);
    a.tx = a.x; a.tz = a.z;
    if (a.kind === "monkey" && Math.random() < dt * 1.5) growl(a);
    return;
  }
  // a stray dog that spots you watches you go by, and barks now and then
  if (a.kind === "dog" && d < 9) {
    a.speed += (0 - a.speed) * Math.min(1, dt * 4);
    a.h = turn(a.h, Math.atan2(dx, dz), dt * 3);
    if (Math.random() < dt * 0.25) growl(a);
    return;
  }
  roam(a, dt, a.kind === "monkey" ? 18 : 30);
}
// move, staying on their own ground (the killers won't set foot on the stairs,
// the summit or in base camp)
function move(a, dt) {
  if (a.speed <= 0.01) return;
  const allowed = a.zone.allowed;
  const step = a.speed * dt, n = Math.max(1, Math.ceil(step / 0.6));
  for (let i = 0; i < n; i++) {
    const nx = a.x + Math.sin(a.h) * (step / n), nz = a.z + Math.cos(a.h) * (step / n);
    if (allowed(nx, nz)) { a.x = nx; a.z = nz; }
    else {
      // slide along the edge
      const sx = a.x + Math.sin(a.h) * (step / n), sz = a.z;
      if (allowed(sx, sz)) a.x = sx;
      else if (allowed(a.x, a.z + Math.cos(a.h) * (step / n))) a.z += Math.cos(a.h) * (step / n);
      else { a.speed *= 0.5; if (a.state === "roam") { a.tx = a.x; a.tz = a.z; } }
      break;
    }
  }
}
// pose: on the ground, tilted with the slope, legs trotting (sitting / lying when resting)
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
  const fx = Math.sin(a.h), fz = Math.cos(a.h), half = Math.max(0.4, k.len * 0.4);
  let pitch = -Math.atan2(terrainH(a.x + fx * half, a.z + fz * half) - terrainH(a.x - fx * half, a.z - fz * half), half * 2);
  if (k.biped) pitch = Math.max(-0.15, Math.min(0.15, pitch));   // stays upright on a slope
  a.phase += dt * a.speed * (k.gait / Math.max(1, k.run * 0.5));
  const run = a.speed > k.walk * 1.5, amp = Math.min(0.85, 0.2 + a.speed * 0.09);
  const off = run && !k.biped ? [0, 0.6, Math.PI, Math.PI + 0.6] : [0, Math.PI, Math.PI, 0];   // gallop / trot (and a biped's walk)
  a.legs.forEach((l, i) => { l.rotation.x = a.speed > 0.1 ? Math.sin(a.phase + off[i]) * amp : 0; });
  const bob = a.speed > 0.1 ? Math.abs(Math.sin(a.phase)) * 0.05 * Math.min(1, a.speed / 3) * (k.biped ? 3 : 1) : 0;
  let y = gy + bob + (a.pounce > 0 ? 0.35 : 0);
  if (a.lunge > 0) a.lunge -= dt;
  let lean = a.lunge > 0 ? -0.18 : 0;
  // a yeti's blow: both arms come up and smash down
  if (k.biped && a.lunge > 0) {
    const u = a.lunge / 0.45, up = u > 0.5 ? (1 - u) * 2 : u * 2;
    a.legs[0].rotation.x = a.legs[1].rotation.x = -2.8 * up;
    lean = -0.25 * (1 - up);
  }
  // resting: monkeys sit up, dogs and yaks lie down
  if (a.rest > 0 && a.speed < 0.1) {
    if (a.kind === "monkey") {
      lean = -0.75; y += 0.08;
      a.legs[0].rotation.x = a.legs[1].rotation.x = 0.7;
      a.legs[2].rotation.x = a.legs[3].rotation.x = -0.9;
    } else {
      y -= k.ht * 0.28;
      a.legs[0].rotation.x = a.legs[1].rotation.x = -1.35;
      a.legs[2].rotation.x = a.legs[3].rotation.x = 1.3;
    }
  }
  r.position.set(a.x, y, a.z);
  r.rotation.set(pitch + lean, a.h, 0);
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
// killed in the forest: come round just outside the gate; in the mountains: at base camp
export function wildlifeRespawn(p) {
  if (inHimBox(p.x, p.z)) return { x: HIM.x + CAMP.u, z: HIM.z + CAMP.v + 8, yaw: 0 };
  const r = swayR(p.x, p.z);
  if (r > SWAY.RW + 2 || r < SWAY.R0 - 1 || onStairs(p.x, p.z)) return null;
  return { x: SWAY.x, z: SWAY.z - SWAY.RW - 10, yaw: 0 };
}
export function wildlifeOnRespawn() {
  for (const a of animals) if (a.state !== "dead") { a.state = "roam"; a.provoked = 0; a.speed = 0; a.tx = a.x; a.tz = a.z; a.fleeT = 0; }
}
