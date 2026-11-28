// melee.js — hand-to-hand fighting, "freeflow" style (think Arkham / Skyrim).
//
// It's meant to be a real fight, not a button-mash: every strike, dodge and
// blocked blow costs STAMINA (tired = slow, weak blows, a guard that breaks);
// people block and slip your punches, cover up when you pile on, shrug off
// light blows if they're tough, and hit back hard. Counters only work in the
// last moment of their wind-up; raising your guard just as a blow lands is a
// PARRY. Takedowns only finish someone who's already badly hurt.
//
//   You      Q (or left click with fists out) strikes. You step in to whoever
//            is in the direction you're pushing (or looking) and chain into
//            the next move of your fighting style; 12 clean hits in a row and
//            the next is a COMBO TAKEDOWN (it finishes someone below 40%).
//            R / right click: COUNTER when the bolt over an attacker's head
//            flares (the last moment of their wind-up); otherwise it raises
//            your guard — BLOCK while held, a PARRY if it goes up just as the
//            blow lands. Space in a fight DODGEs (front / back flip, cartwheel
//            to the side) — the only answer to a red-bolt charge.
//            G changes style: Boxing, Muay Thai, Kung Fu, Taekwondo.
//   People   Have health and POISE: a blow rocks them but they keep fighting
//            until several land in quick succession and they stagger; they
//            cover up if you keep piling on, block and slip punches, throw
//            combinations, and hit back after a block. Badly hurt, a heavy
//            blow floors them (they get back up); out of health they're
//            KNOCKED OUT — down for a good while, then they come round and get
//            away. Brave people fight back (a friend / a couple of tough types
//            nearby may join in); timid ones take the hit and run.
//
// melee.js owns the moves, the brawlers' brains and the HUD; people.js just
// animates a brawling ped from the pose values set here, and main.js applies
// the player's movement / facing / pose (see the hooks in initMelee).
import { scene, clamp, rr, rand, angDiff, terrainH } from "./engine.js";
import { peds, enterBrawl, leaveBrawl, knockDown, scare } from "./people.js";
import { blocked } from "./combat.js";
import * as sfx from "./sound.js";

const TAU = Math.PI * 2;
const smooth = (u) => u * u * (3 - 2 * u);
const wrapAng = (a) => a - TAU * Math.round(a / TAU);
const turn = (a, b, k) => a + angDiff(b, a) * Math.min(1, k);

// ---------------------------------------------------------------- player poses
// Joint values for the player rig (same conventions as main.js's poses):
//   aLx / aRx  shoulder swing (−π/2 = arm straight out in front, more = up)
//   aLz / aRz  arm raised out to the side (outward +, either side)
//   eL / eR    elbow (− folds the forearm forward / up)
//   hLx / hRx  hip (− = leg forward / up)     hLz / hRz  leg out to the side
//   kL / kR    knee bend   lean  body tips forward (+) / back (−)
//   twist      upper body turned right (+) / left (−)   roll  leans left (+)
//   y          body raised / lowered (m)   spin / flip / cart  whole-body
//              turns round the waist (vertical / forward / sideways axis)
const GUARD = {
  aLx: -0.75, aLz: 0.12, eL: -1.9, aRx: -0.62, aRz: 0.18, eR: -2.0,
  hLx: -0.32, hLz: 0.06, kL: 0.32, hRx: 0.24, hRz: 0.06, kR: 0.4,
  lean: 0.1, twist: 0.15, roll: 0, y: -0.06, spin: 0, flip: 0, cart: 0,
};
const J = Object.keys(GUARD);
const LEGS = new Set(["hLx", "hLz", "kL", "hRx", "hRz", "kR", "y"]);
const BLOCK = { ...GUARD, aLx: -1.0, aLz: 0.05, eL: -2.5, aRx: -0.95, aRz: 0.05, eR: -2.55, lean: 0.2, y: -0.12, kL: 0.45, kR: 0.5, twist: 0.05 };

// A move: duration (s), when in it the blow(s) land (0..1), damage, reach,
// how far it knocks them back, and keyframes [t, joints] (missing joints are
// the guard stance). heavy: a big blow (floors someone already hurt);
// floor: always floors; kick: hits lower; units: damage to a mission gunman.
function M(name, o) {
  const kf = o.kf.map(([t, q]) => [t, { ...GUARD, ...q }]);
  if (kf[0][0] > 0) kf.unshift([0, { ...GUARD }]);
  if (kf[kf.length - 1][0] < 1) kf.push([1, { ...GUARD }]);
  return { name, dur: 0.4, hits: [0.45], dmg: 12, reach: 1.3, units: 1, heavy: false, floor: false, kick: false, step: 0.2, push: 1.4, ...o, kf };
}
const H2 = (o) => [o, o];   // hold a pose across two keyframes

const STYLES = [
  {
    name: "Boxing",
    desc: "Fast hands: jab, cross, hook, uppercut",
    moves: [
      M("Jab", { dur: 0.3, hits: [0.4], dmg: 11, kf: [[0.38, { aLx: -1.62, aLz: 0.05, eL: -0.05, twist: 0.45, lean: 0.16 }], [0.55, { aLx: -1.58, aLz: 0.05, eL: -0.12, twist: 0.42, lean: 0.15 }]] }),
      M("Cross", { dur: 0.34, hits: [0.42], dmg: 14, kf: [[0.4, { aRx: -1.62, aRz: 0.05, eR: -0.02, twist: -0.45, lean: 0.22, hRx: 0.42, kR: 0.55 }], [0.56, { aRx: -1.58, aRz: 0.05, eR: -0.1, twist: -0.42, lean: 0.2, hRx: 0.4, kR: 0.5 }]] }),
      M("Left hook", { dur: 0.38, hits: [0.5], dmg: 16, reach: 1.2, kf: [[0.24, { twist: -0.2, aLx: -1.25, aLz: 0.8, eL: -1.7 }], [0.5, { twist: 0.75, aLx: -1.45, aLz: 1.25, eL: -1.45, lean: 0.14 }], [0.62, { twist: 0.7, aLx: -1.4, aLz: 1.2, eL: -1.5, lean: 0.12 }]] }),
      M("Uppercut", { dur: 0.5, hits: [0.5], dmg: 24, units: 2, heavy: true, floor: true, push: 2.2, kf: [[0.3, { aRx: -0.25, aRz: 0.25, eR: -1.9, y: -0.2, lean: 0.3, twist: 0.15, kL: 0.65, kR: 0.7, hLx: -0.55, hRx: 0.0 }], [0.5, { aRx: -2.5, aRz: 0.1, eR: -1.35, y: 0.05, lean: -0.18, twist: -0.5 }], [0.66, { aRx: -2.45, aRz: 0.1, eR: -1.4, y: 0.03, lean: -0.15, twist: -0.45 }]] }),
    ],
    finisher: M("Haymaker", { dur: 0.62, hits: [0.52], dmg: 40, units: 4, heavy: true, floor: true, push: 3, step: 0.5, kf: [[0.3, { aRx: -0.9, aRz: 1.1, eR: -1.4, twist: 0.55, lean: -0.05, y: -0.05 }], [0.52, { aRx: -1.85, aRz: 0.55, eR: -0.35, twist: -0.75, lean: 0.3, hRx: 0.45, kR: 0.5 }], [0.7, { aRx: -1.5, aRz: 0.4, eR: -0.5, twist: -0.7, lean: 0.28, hRx: 0.4, kR: 0.5 }]] }),
    counter: M("Slip & cross", { dur: 0.5, hits: [0.55], dmg: 22, units: 2, heavy: true, push: 2.2, kf: [[0.25, { roll: 0.3, y: -0.16, twist: 0.4, lean: 0.2, kL: 0.6, kR: 0.6 }], [0.55, { aRx: -1.62, eR: 0, aRz: 0.05, twist: -0.5, lean: 0.22, roll: -0.05 }], [0.7, { aRx: -1.55, eR: -0.1, twist: -0.45, lean: 0.2 }]] }),
  },
  {
    name: "Muay Thai",
    desc: "Elbows, knees and roundhouse kicks",
    moves: [
      M("Elbow", { dur: 0.36, hits: [0.45], dmg: 15, reach: 1.15, kf: [[0.2, { twist: 0.3, aRx: -1.3, aRz: 0.6, eR: -2.5 }], [0.45, { twist: -0.7, aRx: -1.55, aRz: 1.0, eR: -2.6, lean: 0.18 }], [0.6, { twist: -0.65, aRx: -1.5, aRz: 0.95, eR: -2.55, lean: 0.16 }]] }),
      M("Clinch knee", { dur: 0.45, hits: [0.5], dmg: 17, kick: true, reach: 1.15, kf: [[0.2, { aLx: -1.45, eL: -1.1, aRx: -1.45, eR: -1.1, lean: 0.15 }], ...H2({ aLx: -1.25, eL: -1.4, aRx: -1.25, eR: -1.4, hRx: -1.9, kR: 2.1, hLx: 0.1, kL: 0.15, lean: -0.12, y: 0.04 }).map((q, i) => [0.5 + i * 0.12, q])] }),
      M("Roundhouse", { dur: 0.55, hits: [0.5], dmg: 22, kick: true, reach: 1.6, push: 2, kf: [[0.2, { twist: 0.45, hLx: -0.1, kL: 0.2 }], ...H2({ hRx: -0.75, hRz: 1.45, kR: 0.2, hLx: 0.05, kL: 0.1, twist: -0.95, roll: 0.4, aLx: -0.9, aLz: 0.3, eL: -1.6, aRx: 0.1, aRz: 0.7, eR: -0.4 }).map((q, i) => [0.5 + i * 0.12, q])] }),
      M("Teep", { dur: 0.45, hits: [0.48], dmg: 16, kick: true, reach: 1.55, push: 3.2, heavy: true, kf: [[0.25, { hLx: -1.3, kL: 1.7, lean: -0.05 }], [0.48, { hLx: -1.5, kL: 0.05, lean: -0.3, aLx: -0.5, aLz: 0.4, eL: -1.2 }], [0.66, { hLx: -1.2, kL: 1.4 }]] }),
    ],
    finisher: M("Flying knee", { dur: 0.66, hits: [0.52], dmg: 40, units: 4, heavy: true, floor: true, kick: true, push: 3, step: 1.2, kf: [[0.28, { y: -0.18, kL: 0.75, kR: 0.75, hLx: -0.5, hRx: -0.3, lean: 0.2 }], [0.52, { y: 0.55, hRx: -2.0, kR: 2.2, hLx: 0.35, kL: 1.1, lean: -0.15, aLx: -2.5, eL: -1.0, aRx: -2.5, eR: -1.0 }], [0.74, { y: 0.22, hRx: -1.2, kR: 1.6, hLx: 0.1, kL: 0.8, aLx: -1.8, eL: -1.4, aRx: -1.8, eR: -1.4 }]] }),
    counter: M("Catch & elbow", { dur: 0.55, hits: [0.55], dmg: 24, units: 2, heavy: true, push: 2, kf: [[0.25, { aLx: -1.5, aLz: 0.35, eL: -1.0, twist: 0.35, lean: -0.05 }], ...H2({ aLx: -1.3, aLz: 0.2, eL: -1.2, aRx: -1.55, aRz: 1.0, eR: -2.6, twist: -0.75, lean: 0.2 }).map((q, i) => [0.55 + i * 0.13, q])] }),
  },
  {
    name: "Kung Fu",
    desc: "Palm strikes, chain punches, spinning kicks",
    moves: [
      M("Palm strike", { dur: 0.32, hits: [0.42], dmg: 12, push: 2, kf: [...H2({ aLx: -1.55, aLz: 0.0, eL: -0.12, twist: 0.5, lean: 0.2, hLx: -0.5, kL: 0.55, y: -0.12 }).map((q, i) => [0.4 + i * 0.15, q])] }),
      M("Chain punches", {
        dur: 0.55, hits: [0.2, 0.38, 0.56], dmg: 6, reach: 1.2, push: 0.6,
        kf: [0.17, 0.32, 0.47, 0.62].map((t, i) => [t, i % 2 ? { aLx: -1.6, eL: -0.05, aRx: -1.0, eR: -1.4, twist: 0.3, lean: 0.15 } : { aRx: -1.6, eR: -0.05, aLx: -1.0, eL: -1.4, twist: -0.1, lean: 0.15 }]),
      }),
      M("Spinning hook kick", { dur: 0.62, hits: [0.55], dmg: 22, kick: true, reach: 1.6, push: 2.4, heavy: true, kf: [[0.12, {}], [0.4, { spin: -3.2, hRz: 0.8, hRx: -0.3, kR: 0.6, lean: -0.1 }], [0.58, { spin: -5.2, hRz: 1.45, hRx: -0.5, kR: 0.15, roll: 0.4, lean: -0.15 }], [0.78, { spin: -TAU, hRz: 0.3, kR: 0.4 }], [1, { spin: -TAU }]] }),
      M("Tiger claw", { dur: 0.42, hits: [0.48], dmg: 15, reach: 1.25, kf: [[0.22, { aRx: -2.3, aRz: 0.5, eR: -1.2, twist: 0.4, y: 0.03 }], [0.48, { aRx: -1.2, aRz: 0.2, eR: -0.4, twist: -0.5, lean: 0.3, y: -0.12, kL: 0.5, kR: 0.55 }], [0.62, { aRx: -1.0, eR: -0.5, twist: -0.45, lean: 0.28, y: -0.1 }]] }),
    ],
    finisher: M("Dragon kick", { dur: 0.7, hits: [0.5], dmg: 40, units: 4, heavy: true, floor: true, kick: true, push: 3.5, step: 1.6, kf: [[0.25, { y: -0.2, kL: 0.8, kR: 0.8, lean: 0.25 }], [0.5, { y: 0.6, hLx: -1.65, kL: 0.0, hRx: -0.6, kR: 1.9, lean: -0.3, aLx: -0.3, aLz: 0.9, eL: -0.5, aRx: -0.2, aRz: 1.0, eR: -0.5 }], [0.7, { y: 0.3, hLx: -1.2, kL: 0.4, hRx: -0.5, kR: 1.4 }]] }),
    counter: M("Parry & double palm", { dur: 0.55, hits: [0.55], dmg: 24, units: 2, heavy: true, push: 4, kf: [[0.22, { aLx: -1.35, aLz: 0.8, eL: -1.6, twist: -0.3 }], ...H2({ aLx: -1.55, aLz: 0.15, eL: -0.1, aRx: -1.55, aRz: 0.15, eR: -0.1, lean: 0.25, twist: 0.1, y: -0.1, hLx: -0.55, kL: 0.6 }).map((q, i) => [0.55 + i * 0.15, q])] }),
  },
  {
    name: "Taekwondo",
    desc: "Snap, side, axe and tornado kicks",
    moves: [
      M("Front snap kick", { dur: 0.42, hits: [0.45], dmg: 14, kick: true, reach: 1.55, kf: [[0.22, { hRx: -1.35, kR: 1.7, lean: -0.05 }], [0.45, { hRx: -1.6, kR: 0.05, lean: -0.2, aLx: -0.5, aLz: 0.4, eL: -1.3 }], [0.65, { hRx: -1.2, kR: 1.5 }]] }),
      M("Side kick", { dur: 0.5, hits: [0.5], dmg: 18, kick: true, reach: 1.7, push: 2.6, kf: [[0.25, { twist: 1.0, hLz: 0.9, kL: 1.7, hLx: -0.4, roll: -0.25 }], ...H2({ twist: 1.35, hLz: 1.5, kL: 0.05, hLx: -0.15, roll: -0.55, aRx: -0.3, aRz: 0.8, eR: -0.6 }).map((q, i) => [0.5 + i * 0.15, q])] }),
      M("Axe kick", { dur: 0.55, hits: [0.55], dmg: 20, kick: true, reach: 1.5, heavy: true, kf: [[0.35, { hRx: -2.6, kR: 0.05, hRz: 0.35, lean: -0.32, aLx: -1.0, eL: -1.2 }], [0.55, { hRx: -0.7, kR: 0.05, hRz: 0.1, lean: 0.15 }], [0.7, { hRx: -0.3, kR: 0.3 }]] }),
      M("Back-spin kick", { dur: 0.6, hits: [0.55], dmg: 22, kick: true, reach: 1.6, push: 3, heavy: true, kf: [[0.15, { aLx: -1.3, aLz: 0.7, eL: -1.6 }], [0.4, { spin: -2.3, lean: 0.5, hRx: 0.4, kR: 1.6 }], [0.55, { spin: -3.14, lean: 0.7, hRx: 1.4, kR: 0.05 }], [0.75, { spin: -3.6, lean: 0.3, hRx: 0.5, kR: 0.8 }], [1, { spin: -TAU }]] }),
    ],
    finisher: M("Tornado kick", { dur: 0.75, hits: [0.55], dmg: 40, units: 4, heavy: true, floor: true, kick: true, push: 3.2, step: 1.0, kf: [[0.1, { y: -0.15, kL: 0.6, kR: 0.6 }], [0.35, { spin: -3.3, y: 0.45, kL: 1.2, hLx: -0.6, hRx: -0.3, kR: 1.0 }], [0.55, { spin: -5.0, y: 0.5, hRz: 1.5, hRx: -0.6, kR: 0.15, roll: 0.45, kL: 1.4, hLx: -0.7 }], [0.75, { spin: -TAU, y: 0.15, hRz: 0.3 }], [1, { spin: -TAU }]] }),
    counter: M("Check & side kick", { dur: 0.58, hits: [0.55], dmg: 24, units: 2, heavy: true, kick: true, push: 3.2, reach: 1.7, kf: [[0.2, { aLx: -1.3, aLz: 0.7, eL: -1.6 }], [0.38, { twist: 1.0, hLz: 0.9, kL: 1.7, hLx: -0.4, roll: -0.25 }], ...H2({ twist: 1.35, hLz: 1.5, kL: 0.05, hLx: -0.15, roll: -0.55, aRx: -0.3, aRz: 0.8, eR: -0.6 }).map((q, i) => [0.55 + i * 0.13, q])] }),
  },
];
// someone floored at your feet: a hard blow (knocks them out if they're badly hurt)
const TAKEDOWN = M("Ground takedown", { dur: 0.6, hits: [0.55], dmg: 30, units: 4, heavy: true, reach: 1.8, step: 0.1, kf: [[0.3, { y: -0.3, lean: 0.55, kL: 1.0, kR: 1.1, hLx: -0.8, hRx: -0.2, aRx: -2.6, eR: -0.6, aLx: -0.5 }], [0.55, { y: -0.5, lean: 0.8, kL: 1.4, kR: 1.5, hLx: -1.0, hRx: -0.5, aRx: -0.6, eR: -0.1 }], [0.75, { y: -0.45, lean: 0.75, kL: 1.35, kR: 1.45, hLx: -0.95, hRx: -0.45, aRx: -0.7, eR: -0.15 }]] });
const SPECIAL_AT = 12;    // clean hits in a row for a combo takedown
const FINISHERS = new Set(STYLES.map((st) => st.finisher));
const STAM_MAX = 100;

// ---------------------------------------------------------------- enemy attacks
// wind: telegraph time (the bolt shows; counter any time in it), stand: how
// close they step in, red: unblockable / uncounterable — dodge it.
// quick: a fast follow-up jab (combos, and hitting back after a block / slip)
const ATK = {
  jab: { name: "jab", pose: "jab", wind: 0.45, dmg: 9, range: 1.75, stand: 1.15 },
  quick: { name: "quick", pose: "jab", wind: 0.4, dmg: 7, range: 1.75, stand: 1.1 },
  hay: { name: "hay", pose: "hay", wind: 0.66, dmg: 16, range: 1.85, stand: 1.2, heavy: true },
  kick: { name: "kick", pose: "kick", wind: 0.58, dmg: 13, range: 2.0, stand: 1.4, heavy: true },
  rush: { name: "rush", pose: "rush", wind: 0.8, dmg: 22, range: 2.3, stand: 0.9, heavy: true, red: true },
};
// the counter window: the last part of a wind-up (never shorter than 0.25 s)
const counterWin = (A) => Math.max(0.25, A.wind * 0.4);
// ped arm poses [axL, axR, azL, azR] (+ax = forward / up, +az = outward)
const PG = [1.25, 1.35, -0.25, -0.25];

// ---------------------------------------------------------------- state
let H = null;              // hooks from main.js
let P = null;              // player position (V3, feet)
export const brawlers = []; // { p, state, t, ... }
const F = {
  style: 0, seq: 0, lastEnd: -9, now: 0,
  combo: 0, comboT: 0, best: 0, special: 0,
  act: null, queued: null,
  vx: 0, vz: 0, kx: 0, kz: 0, face: null,
  blockHeld: false, blocking: false, invuln: 0,
  guardW: 0, poseW: 0, cam: 0, engaged: false, glidePh: 0,
  hitstop: 0, slowmo: 0, gcool: 0, lastTarget: null, threat: null, fightN: 0,
  stam: STAM_MAX, stamT: 0, blockAt: -9, flash: "", flashT: 0,
};
// stamina: n > 0 spends (and pauses the recovery a moment), n < 0 gives back
function spend(n) {
  F.stam = clamp(F.stam - n, 0, STAM_MAX);
  if (n > 0) F.stamT = 0.9;
}
function flash(text) {
  F.flash = text;
  F.flashT = 0.9;
}
const S = { ...GUARD };    // the sampled move / dodge / block pose
const V = { ...GUARD };    // what the arms show in first person

export function initMelee(hooks) {
  H = hooks;
  P = hooks.pos;
}

// ---------------------------------------------------------------- queries for main.js
export const meleeLocked = () => !!F.act;                         // a move is driving the body
export const meleeBlocking = () => F.blocking;
export const meleeEngaged = () => F.engaged;
export const meleeCam = () => F.cam;                              // 0..1, the camera pulls back in a fight
export const meleeVel = () => ({ x: F.vx, z: F.vz });             // root motion this frame (m/s)
export const meleeFacing = () => F.face;                          // null = leave facing alone
export const meleeEyeY = () => clamp(S.y * F.poseW, -0.5, 0.7);  // first person: crouches / jumps move the eyes
export const meleeStyle = () => STYLES[F.style].name;
export function meleeView() {                                     // first-person arms (null = keep them down)
  return F.poseW > 0.05 || (F.guardW > 0.05 && F.engaged) ? V : null;
}
// Hit-stop on every blow (the world freezes for a beat), slow motion on the
// last knockout of a fight.
export function meleeTimeScale(rdt) {
  let s = 1;
  if (F.hitstop > 0) { F.hitstop -= rdt; s = 0.12; }
  if (F.slowmo > 0) { F.slowmo -= rdt; s = Math.min(s, 0.28 + 0.72 * smooth(clamp(1 - F.slowmo / 0.9, 0, 1))); }
  return s;
}

// ---------------------------------------------------------------- input
export function meleeAttack() {
  if (!H || !H.canFight()) return false;
  const a = F.act;
  if (!a) { startAttack(); return true; }
  // freeflow: once the blow has landed you can go straight into the next
  if (a.kind === "move" && !a.whiff && a.done >= a.def.hits.length && a.t / (a.def.dur * a.dm) > recoverAt(a.def)) {
    endAct();
    startAttack();
    return true;
  }
  if (a.kind !== "hurt") F.queued = "attack";
  return true;
}
// Counter whoever is winding up on you; false = nobody to counter (block instead).
export function meleeCounter() {
  if (!H || !H.canFight()) return false;
  const b = counterable();
  if (!b || F.stam < 8) return false;          // too early (or too tired): it's just your guard going up
  if (F.act && F.act.kind === "move" && F.act.counter && F.act.done < F.act.def.hits.length) { F.queued = "counter"; return true; }
  if (F.act && F.act.kind === "hurt") return true;
  spend(8);
  doCounter(b);
  return true;
}
export function meleeBlock(held) {
  if (held && !F.blockHeld) F.blockAt = F.now;  // (raised just as a blow lands = a parry)
  F.blockHeld = held;
}
export function meleeWantsDodge() {
  return !!H && H.canFight() && H.onGround() && (F.engaged || (!!F.act && F.act.kind === "move")) && !(F.act && F.act.kind === "dodge");
}
export function meleeDodge() {
  const inp = H.input();
  let dx = inp.x, dz = inp.z, l = Math.hypot(dx, dz);
  const fa = H.facing();
  if (l < 0.1) { dx = -Math.sin(fa); dz = -Math.cos(fa); l = 1; }   // no direction: flip back out of it
  dx /= l; dz /= l;
  const fwd = dx * Math.sin(fa) + dz * Math.cos(fa), side = dx * Math.cos(fa) - dz * Math.sin(fa);
  const mode = Math.abs(side) > Math.abs(fwd) ? "side" : fwd > 0 ? "front" : "back";
  endAct();
  const tired = F.stam < 18;                    // out of breath: a stumbling half-step
  spend(18);
  F.act = tired
    ? { kind: "dodge", t: 0, dur: 0.35, dx, dz, mode: "side", sgn: side >= 0 ? 1 : -1, dist: 1.5, small: true }
    : { kind: "dodge", t: 0, dur: 0.5, dx, dz, mode, sgn: side >= 0 ? 1 : -1, dist: mode === "back" ? 3.2 : 3.8 };
  F.invuln = tired ? 0.12 : 0.3;
  F.queued = null;
  sfx.swish(!tired);
}
export function cycleStyle() {
  F.style = (F.style + 1) % STYLES.length;
  F.seq = 0;
  const st = STYLES[F.style];
  if (H.toast) H.toast(`${st.name.toUpperCase()}<small>${st.desc} · G next style</small>`, 1800);
}

// ---------------------------------------------------------------- targets
const groundY = (p) => p.yOff ?? terrainH(p.x, p.z);
function validTarget(p) {
  if (!p || p.dead || p.dormant || p.state === "away" || p.state === "down" || !p.root.isEnabled()) return false;
  return Math.abs(groundY(p) - P.y) < 1.4;
}
// Who a strike goes for: someone in the direction you're pushing (or facing /
// looking), near ones first, people already fighting you preferred.
function pickTarget(maxD) {
  const inp = H.input();
  let dx = inp.x, dz = inp.z;
  const il = Math.hypot(dx, dz);
  if (il > 0.1) { dx /= il; dz /= il; }
  else { const y = H.yaw(); dx = Math.sin(y); dz = Math.cos(y); }
  let best = null, bs = Infinity;
  for (const p of peds) {
    const ox = p.x - P.x, oz = p.z - P.z;
    if (Math.abs(ox) > maxD || Math.abs(oz) > maxD || !validTarget(p)) continue;
    const d = Math.hypot(ox, oz);
    if (d > maxD) continue;
    const c = d > 0.01 ? (ox * dx + oz * dz) / d : 1;
    if (c < 0.25 && d > 1.6) continue;
    let s = d * (1.7 - c);
    if (p.__b) s *= p.__b.state === "floored" ? 0.85 : 0.6;
    if (s < bs) { bs = s; best = p; }
  }
  return best;
}
function inFront(r) {
  const f = H.facing(), fx = Math.sin(f), fz = Math.cos(f);
  let best = null, bd = r;
  for (const p of peds) {
    const ox = p.x - P.x, oz = p.z - P.z;
    if (Math.abs(ox) > r || Math.abs(oz) > r || !validTarget(p)) continue;
    const d = Math.hypot(ox, oz);
    if (d > bd || (ox * fx + oz * fz) / (d || 1) < 0.35) continue;
    bd = d;
    best = p;
  }
  return best;
}
function counterable() {
  let best = null, bt = Infinity;
  for (const b of brawlers) {
    if (b.state !== "windup" || b.atk.red || b.d > 3.2) continue;
    const left = b.atk.wind - b.t;
    if (left > counterWin(b.atk)) continue;     // too early to read it
    if (left < bt) { bt = left; best = b; }
  }
  return best;
}

// ---------------------------------------------------------------- your moves
// when in a move you can flow into the next one (after the blow, and some recovery)
const recoverAt = (def) => Math.max(def.hits[def.hits.length - 1] + 0.18, 0.8);
function startAttack() {
  const tgt = pickTarget(4.5);
  const st = STYLES[F.style];
  const b = tgt && tgt.__b;
  let def;
  if (b && b.state === "floored") def = TAKEDOWN;
  else if (tgt && F.special >= SPECIAL_AT) { def = st.finisher; F.special = 0; }   // combo takedown
  else {
    if (F.now - F.lastEnd > 0.9) F.seq = 0;
    def = st.moves[F.seq % st.moves.length];
    F.seq++;
  }
  const cost = FINISHERS.has(def) ? 25 : def.heavy || def.kick ? 16 : 10;
  const tired = F.stam < cost;                  // tired: slow and weak
  spend(cost);
  begin(def, tgt, null, tired);
}
const mkMove = (def, target, counter, tired) => ({ kind: "move", def, t: 0, target, done: 0, counter, swished: false, dm: tired ? 1.6 : 1, weak: tired, whiff: false });
function begin(def, tgt, counter, tired = false) {
  if (tgt) {
    const d = Math.hypot(tgt.x - P.x, tgt.z - P.z), stand = def.reach * 0.8;
    // a few steps away: step in first (a quick shuffle, not a flying leap)
    if (d - stand > 1.0) {
      F.act = { kind: "glide", t: 0, max: Math.min(0.55, (d - stand) / 8 + 0.08), def, target: tgt, counter, tired };
      return;
    }
  }
  F.act = mkMove(def, tgt, counter, tired);
}
function doCounter(b) {
  b.state = "countered";
  b.t = 0;
  endAct();
  F.queued = null;
  F.invuln = 0.65;
  sfx.blockHit(H.pan(b.p.x, b.p.z));
  begin(STYLES[F.style].counter, b.p, b);
}
function endAct() {
  if (F.act && F.act.kind === "move") F.lastEnd = F.now;
  F.act = null;
}
function faceTo(ox, oz, dt, rate) {
  const f = H.facing();
  return f + angDiff(Math.atan2(ox, oz), f) * Math.min(1, dt * rate);
}
function stepAct(a, dt) {
  if (a.kind === "glide") {
    a.t += dt;
    F.glidePh += dt * 16;
    const p = a.target;
    if (!validTarget(p)) { F.act = mkMove(a.def, null, null, a.tired); return; }
    const ox = p.x - P.x, oz = p.z - P.z, d = Math.hypot(ox, oz) || 0.01;
    const left = d - a.def.reach * 0.8, sp = 8;
    if (left <= sp * dt || a.t >= a.max) {
      const v = Math.max(0, Math.min(sp, left / dt));
      F.vx = (ox / d) * v;
      F.vz = (oz / d) * v;
      F.act = mkMove(a.def, p, a.counter, a.tired);
    } else {
      F.vx = (ox / d) * sp;
      F.vz = (oz / d) * sp;
    }
    F.face = faceTo(ox, oz, dt, 20);
    return;
  }
  if (a.kind === "move") {
    const def = a.def, dur = def.dur * a.dm;
    a.t += dt;
    const u = a.t / dur;
    const lastHit = def.hits[def.hits.length - 1];
    if (a.target && a.done < def.hits.length && validTarget(a.target)) {
      // close the last bit of distance by the time the blow lands; never overlap them
      const p = a.target, ox = p.x - P.x, oz = p.z - P.z, d = Math.hypot(ox, oz) || 0.01;
      const stand = def.reach * 0.75, rem = Math.max(dt, def.hits[a.done] * dur - a.t + dt);
      if (d > stand) {
        const v = Math.min(6, (d - stand) / rem);
        F.vx = (ox / d) * v;
        F.vz = (oz / d) * v;
      } else if (d < 0.7) {
        F.vx = (-ox / d) * 2;
        F.vz = (-oz / d) * 2;
      }
      F.face = faceTo(ox, oz, dt, 22);
    } else if (u < lastHit) {
      const f = H.facing(), v = def.step / Math.max(0.05, def.hits[0] * dur);
      F.vx = Math.sin(f) * v;
      F.vz = Math.cos(f) * v;
    }
    if (!a.swished && u >= def.hits[0] - 0.2) {
      a.swished = true;
      sfx.swish(def.heavy || def.kick);
    }
    while (a.done < def.hits.length && u >= def.hits[a.done]) {
      resolveHit(a);
      a.done++;
      if (F.act !== a) return;      // blocked: your fist bounced off (that reaction takes over)
    }
    // a whiffed / blocked swing leaves you open a little longer
    const end = a.whiff ? 1.3 : 1;
    if (F.queued && u >= (a.whiff ? end : recoverAt(def))) {
      const q = F.queued;
      F.queued = null;
      endAct();
      if (q === "attack") startAttack();
      else { const b = counterable(); if (b && F.stam >= 8) { spend(8); doCounter(b); } }
      return;
    }
    if (u >= end) endAct();
    return;
  }
  if (a.kind === "dodge") {
    a.t += dt;
    const u = Math.min(1, a.t / a.dur), sp = (a.dist / a.dur) * 2 * (1 - u);
    F.vx = a.dx * sp;
    F.vz = a.dz * sp;
    if (u >= 1) {
      F.act = null;
      if (F.queued === "attack") { F.queued = null; startAttack(); }
    }
    return;
  }
  if (a.kind === "hurt") {
    a.t += dt;
    const u = Math.min(1, a.t / a.dur), sp = (a.light ? 1.2 : 3.2) * (1 - u);
    F.vx = a.ux * sp;
    F.vz = a.uz * sp;
    if (u >= 1) F.act = null;
  }
}
function resolveHit(a) {
  const def = a.def;
  let p = a.target;
  if (a.counter && validTarget(a.counter.p)) p = a.counter.p;         // counters always connect
  else if (!validTarget(p) || Math.hypot(p.x - P.x, p.z - P.z) > def.reach + 0.7) p = inFront(def.reach + 0.3);
  if (!p) { a.whiff = true; return; }                                  // a whiff (the swish already played)
  const ox = p.x - P.x, oz = p.z - P.z, d = Math.hypot(ox, oz) || 0.01;
  if (!a.counter && d > def.reach + 0.7) { a.whiff = true; return; }
  // they see it coming: blocked or slipped
  if (p.__b && !a.counter && defend(p.__b, def, a, ox / d, oz / d)) return;
  landHit(p, def, ox / d, oz / d, !!a.counter, a.weak);
}
// A brawler squared up and facing you may block (arms up, a little gets
// through; heavy blows wear the guard down until it breaks) or slip a punch
// (a step back / aside — and then they come straight back at you).
function defend(b, def, a, ux, uz) {
  const p = b.p, st = b.state;
  if (st !== "circle" && st !== "recover" && st !== "cover") return false;
  if (-ux * Math.sin(p.heading) - uz * Math.cos(p.heading) < 0.4) return false;   // not looking at you
  const heavy = def.heavy || def.kick, r = rand();
  let act = null;
  // (slow, tired swings are easy to read)
  if (st === "cover") act = "block";
  else if (r < b.skill * 0.5 + (a.weak ? 0.3 : 0)) act = "block";
  else if (!heavy && r < b.skill * 0.75 + (a.weak ? 0.3 : 0)) act = "slip";
  if (!act) return false;
  const pan = H.pan(p.x, p.z);
  F.lastTarget = p;
  if (act === "slip") {
    b.state = "slip";
    b.t = 0;
    b.side = rand() < 0.5 ? -1 : 1;
    b.vx = ux * 2.2 - uz * b.side * 1.6;
    b.vz = uz * 2.2 + ux * b.side * 1.6;
    a.whiff = true;
    F.combo = 0;
    F.special = 0;
    sfx.swish(false, pan);
    flash("SLIPPED");
    return true;
  }
  if (p.hp === undefined) p.hp = b.max;
  p.hp -= def.dmg * (heavy ? 0.35 : 0.1) * (a.weak ? 0.5 : 1);    // a little gets through
  sfx.blockHit(pan);
  H.spark(p.x - ux * 0.3, groundY(p) + 1.5, p.z - uz * 0.3, 0.16, 0.06);
  F.hitstop = 0.03;
  F.special = 0;
  if (p.hp <= 0) { knockOut(p, ux, uz); return true; }
  if (heavy && --b.guard <= 0) {
    // smashed through the guard: they reel
    b.guard = b.guardMax;
    b.state = "hurt";
    b.t = 0;
    b.dur = 0.65;
    b.vx = ux * 1.4;
    b.vz = uz * 1.4;
    b.snap = 0;
    b.stag = 0;
    flash("GUARD BROKEN");
    return true;
  }
  // (already covered up: they stay behind the guard until it's time to hit back)
  if (st !== "cover") {
    b.state = "cover";
    b.t = 0;
    b.dur = 0.5;
  }
  b.riposte = true;
  a.whiff = true;
  F.combo = 0;
  if (!heavy) {
    // your fist bounces off their arms: a moment off balance
    endAct();
    F.act = { kind: "hurt", t: 0, dur: 0.28, side: rand() < 0.5 ? -1 : 1, ux: -ux * 0.5, uz: -uz * 0.5, light: true };
    spend(6);
  }
  flash("BLOCKED");
  return true;
}
function landHit(p, def, ux, uz, counter, weak) {
  const b0 = p.__b, max = b0 ? b0.max : maxHp(p);
  if (p.hp === undefined) p.hp = maxHp(p);
  // takedowns only finish someone who's already in a bad way
  const ko = (def === TAKEDOWN && p.hp <= max * 0.3) || (FINISHERS.has(def) && p.hp <= max * 0.4);
  const heavy = def.heavy || counter || ko;
  F.combo++;
  F.comboT = 2.8;
  F.best = Math.max(F.best, F.combo);
  if (def !== TAKEDOWN && !ko) F.special++;
  F.lastTarget = p;
  const y = groundY(p) + (def.kick ? 1.15 : 1.45);
  H.spark(p.x - ux * 0.22, y, p.z - uz * 0.22, heavy ? 0.36 : 0.24, heavy ? 0.12 : 0.08);
  H.shake(heavy ? 0.2 : 0.09);
  F.hitstop = heavy ? 0.085 : 0.045;
  const pan = H.pan(p.x, p.z);
  // a mission gunman: their own health (a few punches, or one takedown)
  if (p.goon) {
    H.hitGoon(p, ko ? 4 : weak ? 1 : def.units, ux, uz, def.kick || heavy ? "kick" : "punch");
    sfx.impact(heavy, pan);
    return;
  }
  p.hp -= ko ? 9999 : def.dmg * (weak ? 0.35 : 1);
  // story characters / mission targets: they get hurt and knocked out, but don't brawl
  if (p.char || p.scripted) {
    if (p.hp <= 0) knockOut(p, ux, uz);
    else {
      sfx.impact(heavy, pan);
      p.state = "annoyed";
      p.timer = 1.2;
    }
    return;
  }
  const b = engage(p, true);
  if (p.hp <= 0) { knockOut(p, ux, uz); return; }
  sfx.impact(heavy, pan);
  // hit while down and not finished: they scramble back up
  if (b.state === "floored") { b.state = "rise"; b.t = 0; return; }
  const floor = (def.floor && p.hp < b.max * 0.35) || (heavy && p.hp < b.max * 0.2);
  // POISE: a blow rocks them (head snaps back) but they keep fighting — even
  // keep swinging — until enough lands in quick succession to stagger them.
  // Kicks / heavy blows / counters break it much faster.
  if (!floor && b.state !== "hurt" && b.state !== "cover") {
    const light = !def.heavy && !def.kick && !counter;
    b.poise -= def.dmg * (light ? 1 : 2.4);
    b.poiseT = 0.7;
    if (b.poise > 0) {
      p.nod = -0.35;
      p.look = (rand() - 0.5) * 0.7;
      return;
    }
    b.poise = b.poiseMax;
  }
  if (floor) {
    b.state = "floored";
    b.t = 0;
    b.vx = ux * def.push * 1.3;
    b.vz = uz * def.push * 1.3;
  } else {
    b.state = "hurt";
    b.t = 0;
    b.dur = heavy ? 0.6 : 0.25 + rand() * 0.1;
    b.vx = ux * def.push;
    b.vz = uz * def.push;
    // which way the head snaps: from the side the blow came from
    b.snap = (def.kf.some((k) => k[1].twist < 0) ? 1 : -1) * (0.5 + rand() * 0.4);
    // pile on and they cover up (then hit back) — no stun-locking anyone
    b.stag = (b.stagT > 0 ? b.stag : 0) + 1;
    b.stagT = 1.8;
    if (!counter && b.stag >= (b.skill > 0.6 ? 2 : 3)) b.coverNext = true;
  }
  b.cool = Math.max(b.cool, 0.3);
  b.poise = b.poiseMax;
}
function knockOut(p, ux, uz) {
  const pan = H.pan(p.x, p.z);
  if (p.__b) dropBrawler(p.__b, null);
  p.ko = true;                     // (no death cry: they're out cold, not dead)
  knockDown(p, ux * 5, uz * 5);
  p.ko = false;
  if (p.state === "down" && !p.dead) p.timer = rr(12, 18);
  p.hp = undefined;                // back to full when they come round
  sfx.knockout(pan);
  H.shake(0.3);
  F.hitstop = 0.12;
  scare(p.x, p.z, 12);             // onlookers back off (the curious ones film it)
  const left = brawlers.some((b) => b.d < 15 && !b.timid);
  if (!left && (F.fightN >= 2 || F.combo >= 5)) F.slowmo = 0.9;        // the last one down: slow motion
}
const maxHp = (p) => (p.persona.elderly ? 50 : 95 + p.persona.brave * 85);

// ---------------------------------------------------------------- brawlers
function engage(p, provoked) {
  if (p.__b) return p.__b;
  enterBrawl(p);
  const timid = p.persona.elderly || p.persona.brave < 0.3;
  if (p.hp === undefined) p.hp = maxHp(p);
  // skill: how well they read you (blocks, slips, combos, how often they swing);
  const brave = p.persona.brave, skill = clamp(0.2 + brave * 0.6 + rand() * 0.25, 0, 1);
  const guardMax = 2 + Math.round(skill * 2);
  const b = {
    p, state: "circle", t: 0, dur: 0, max: maxHp(p), cool: rr(0.5, 1.2), side: rand() < 0.5 ? -1 : 1,
    flipT: rr(1.5, 3), ring: rr(1.8, 2.5), vx: 0, vz: 0, d: 99, timid, atk: null, snap: 0, away: 0, marker: null,
    skill, guard: guardMax, guardMax,
    // poise: how much punishment they take before a blow staggers them (comes back fast)
    poiseMax: 14 + skill * 22 + (brave > 0.8 ? 12 : 0), poise: 0, poiseT: 0,
    stag: 0, stagT: 0, coverNext: false, riposte: false,
  };
  b.poise = b.poiseMax;
  p.__b = b;
  brawlers.push(b);
  if (provoked && !timid) rally(p);
  return b;
}
// friends, and anyone else tough nearby, wade in
function rally(p) {
  let n = 0;
  for (const o of peds) {
    if (brawlers.length >= 5 || n >= 2) break;
    if (o === p || o.__b || o.goon || o.char || o.scripted || o.dormant || o.dead || o.persona.elderly) continue;
    if (o.state === "down" || o.state === "away" || o.state === "flee" || o.state === "cower") continue;
    if (Math.abs(o.x - p.x) > 10 || Math.abs(o.z - p.z) > 10 || Math.hypot(o.x - p.x, o.z - p.z) > 10) continue;
    const friend = o.leader === p || p.leader === o;
    if (!(friend && o.persona.brave > 0.3) && o.persona.brave < 0.8) continue;
    engage(o, false).cool = rr(1.2, 2.8);
    n++;
  }
}
// straight back at you after covering up / slipping a punch
function startRiposte(b) {
  b.t = 0;
  if (b.riposte && b.d < 3.5 && !H.dead()) {
    b.riposte = false;
    b.atk = rand() < 0.6 ? ATK.quick : ATK.hay;
    b.state = "windup";
    return;
  }
  b.riposte = false;
  b.state = "circle";
  b.cool = rr(0.3, 0.9);
}
function dropBrawler(b, how) {
  const i = brawlers.indexOf(b);
  if (i >= 0) brawlers.splice(i, 1);
  if (b.marker) { b.marker.setEnabled(false); markerPool.push(b.marker); b.marker = null; }
  b.p.__b = null;
  if (how) leaveBrawl(b.p, how, P.x, P.z);
}
function pickAttack(p) {
  const r = rand();
  if (p.persona.brave > 0.8 && r < 0.2) return ATK.rush;
  return r < 0.4 ? ATK.jab : r < 0.74 ? ATK.hay : ATK.kick;
}
// set a brawling ped's pose (people.js eases the arms toward these)
function pose(p, arms, lean = 0.08, twist = 0, kick = 0, lift = 0, roll = 0, crouch = 0) {
  p.bArms = arms;
  p.bLean = lean;
  p.bTwist = twist;
  p.bKick = kick;
  p.bLift = lift;
  p.bRoll = roll;
  p.bCrouch = crouch;
}
const mixA = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
function windPose(b, u) {
  const A = b.atk, p = b.p, k = smooth(clamp(u, 0, 1));
  if (A.pose === "jab") pose(p, mixA(PG, [1.15, 1.0, -0.2, 0.1], k), 0.08 - 0.12 * k, -0.25 * k);
  else if (A.pose === "hay") pose(p, mixA(PG, [1.1, -0.35, -0.2, 0.95], k), 0.08 - 0.2 * k, 0.6 * k);
  else if (A.pose === "kick") pose(p, PG, 0.08 - 0.22 * k, 0, 0.7 * k);
  else pose(p, mixA(PG, [0.7, 0.7, 0.7, 0.7], k), 0.08 + 0.3 * k, 0, 0, 0, 0, 0.35 * k);   // rush: crouched to charge
}
function strikePose(b) {
  const A = b.atk, p = b.p;
  if (A.pose === "jab") pose(p, [1.7, 1.1, -0.05, -0.2], 0.25, 0.35);
  else if (A.pose === "hay") pose(p, [0.8, 1.65, -0.25, -0.1], 0.32, -0.55);
  else if (A.pose === "kick") pose(p, PG, -0.3, 0, 1.5);
  else pose(p, [1.5, 1.5, 0.3, 0.3], 0.55);
}
function enemyStrike(b, d, ux, uz) {
  const A = b.atk, p = b.p, pan = H.pan(p.x, p.z);
  sfx.swish(!!A.heavy, pan);
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  if (d > A.range || ux * fx + uz * fz < 0.3 || Math.abs(P.y - groundY(p)) > 1.2 || H.dead() || !H.canFight()) return;
  if (F.invuln > 0) return;                                   // dodged / mid-counter
  let mult = 1;
  if (F.blocking && !A.red) {
    const pf = H.facing();
    if (-ux * Math.sin(pf) - uz * Math.cos(pf) > 0.2) {        // facing them: the guard takes it
      if (F.now - F.blockAt < 0.22) {
        // PARRY: guard up just in time — they're thrown off balance
        sfx.blockHit(pan);
        H.shake(0.1);
        F.hitstop = 0.08;
        spend(-10);
        b.state = "hurt";
        b.t = 0;
        b.dur = 0.85;
        b.vx = -ux * 1.2;
        b.vz = -uz * 1.2;
        b.snap = 0;
        flash("PARRY");
        return;
      }
      const cost = A.dmg * 1.8;
      if (F.stam >= cost) {
        spend(cost);
        sfx.blockHit(pan);
        H.shake(0.07);
        F.kx += ux * 1.6;
        F.kz += uz * 1.6;
        if (A.heavy) H.hurtPlayer(A.dmg * 0.2, ux, uz);         // a big one still hurts through the arms
        flash("BLOCKED");
        return;
      }
      // too tired to hold it: the guard caves in
      spend(STAM_MAX);
      mult = 0.6;
      flash("GUARD BROKEN");
    }
  }
  sfx.impact(!!A.heavy, pan);
  H.hurtPlayer(A.dmg * mult * (0.85 + rand() * 0.3), ux, uz);
  endAct();
  const dur = A.red ? 0.95 : A.heavy ? 0.62 : 0.5, kb = A.red ? 2.2 : A.heavy ? 1.3 : 1;
  F.act = { kind: "hurt", t: 0, dur, side: rand() < 0.5 ? -1 : 1, ux: ux * kb, uz: uz * kb };
  F.queued = null;
  F.combo = 0;
  F.special = 0;
}
function updateBrawlers(dt, can) {
  let attacking = 0;
  for (const b of brawlers) if (b.state === "windup" || b.state === "strike") attacking++;
  F.gcool -= dt;
  F.threat = null;
  for (let i = brawlers.length - 1; i >= 0; i--) {
    const b = brawlers[i], p = b.p;
    if (!p.brawl || p.state === "down" || p.dead || p.state === "away") { dropBrawler(b, null); continue; }
    const ox = P.x - p.x, oz = P.z - p.z, d = Math.hypot(ox, oz) || 0.01, ux = ox / d, uz = oz / d;
    b.d = d;
    const reachable = can && Math.abs(P.y - groundY(p)) < 2.5;
    // lost you: drove off, swung away, went down, ran for it
    b.away = reachable && d < 16 ? 0 : b.away + dt;
    if (b.away > (H.dead() ? 1.5 : 5) || d > 45) { dropBrawler(b, b.timid ? "flee" : "annoyed"); continue; }
    b.t += dt;
    if (b.stagT > 0) b.stagT -= dt;
    if (b.poiseT > 0) b.poiseT -= dt;
    else b.poise = Math.min(b.poiseMax, b.poise + dt * 40);
    let mvx = 0, mvz = 0;
    const faceMe = (rate = 10) => { p.heading = turn(p.heading, Math.atan2(ox, oz), dt * rate); };
    let lookT = 0, nodT = 0;
    switch (b.state) {
      case "circle": {
        if (b.timid) { dropBrawler(b, "flee"); continue; }
        faceMe();
        b.flipT -= dt;
        if (b.flipT <= 0) { b.side = -b.side; b.flipT = rr(1.4, 3.2); }
        // hold a ring round you (further out while others are swinging), strafing
        const radial = d - (b.ring + (attacking >= 2 ? 0.9 : 0));
        const rs = clamp(radial * 2, -1.8, d > 6 ? 4.2 : 2.4);
        mvx = ux * rs - uz * b.side * 1.1;
        mvz = uz * rs + ux * b.side * 1.1;
        for (const o of brawlers) {
          if (o === b) continue;
          const sx = p.x - o.p.x, sz = p.z - o.p.z, sd = Math.hypot(sx, sz);
          if (sd < 1.4 && sd > 0.01) { mvx += (sx / sd) * (1.4 - sd) * 3; mvz += (sz / sd) * (1.4 - sd) * 3; }
        }
        const bounce = Math.sin(F.now * 7 + i) * 0.06;
        pose(p, [PG[0] + bounce, PG[1] - bounce, PG[2], PG[3]], 0.1);
        b.cool -= dt;
        if (reachable && !H.dead() && b.cool <= 0 && F.gcool <= 0 && attacking < 2 && d < 4.2) {
          b.atk = pickAttack(p);
          b.state = "windup";
          b.t = 0;
          attacking++;
          F.gcool = rr(0.2, 0.55);
        }
        break;
      }
      case "cover": {            // arms up round the head, waiting for a gap
        faceMe(12);
        pose(p, [1.95, 1.95, -0.5, -0.5], 0.18, 0, 0, 0, 0, 0.12);
        if (b.t >= b.dur) startRiposte(b);
        break;
      }
      case "slip": {             // ducked / stepped out of the way
        const u = clamp(b.t / 0.35, 0, 1), k = 1 - u;
        faceMe(12);
        mvx = b.vx * k * 2;
        mvz = b.vz * k * 2;
        pose(p, PG, -0.25 * Math.sin(Math.PI * u), b.side * 0.4 * k, 0, 0, b.side * 0.25 * Math.sin(Math.PI * u), 0.25 * Math.sin(Math.PI * u));
        if (b.t >= 0.35) startRiposte(b);
        break;
      }
      case "windup": {
        const A = b.atk;
        faceMe(A.red ? 4 : 10);
        if (d > A.stand) {
          const v = Math.min(A.red ? 8 : 5.5, (d - A.stand) / Math.max(0.05, A.wind - b.t));
          mvx = ux * v;
          mvz = uz * v;
        }
        windPose(b, b.t / A.wind);
        if (!F.threat || A.wind - b.t < F.threat.left) F.threat = { red: !!A.red, left: A.wind - b.t, open: A.wind - b.t <= counterWin(A) && d < 3.2 };
        if (b.t >= A.wind) {
          b.state = "strike";
          b.t = 0;
          strikePose(b);
          enemyStrike(b, d, ux, uz);
        }
        break;
      }
      case "strike":
        if (b.t >= 0.24) {
          // the good ones put combinations together
          if (reachable && b.atk !== ATK.rush && b.atk !== ATK.quick && rand() < b.skill * 0.45) {
            b.atk = ATK.quick;
            b.state = "windup";
          } else b.state = "recover";
          b.t = 0;
        }
        break;
      case "recover":
        faceMe(6);
        mvx = -ux * 0.9;
        mvz = -uz * 0.9;
        pose(p, mixA([0.9, 0.9, 0.1, 0.1], PG, clamp(b.t / 0.5, 0, 1)), 0.05);
        if (b.t > 0.4) { b.state = "circle"; b.cool = rr(0.5, 1.5) * (1.3 - b.skill * 0.6); }
        break;
      case "countered":          // caught mid-swing: frozen until your counter lands
        faceMe(12);
        windPose(b, 0.85);
        if (b.t > 1.3) { b.state = "circle"; b.cool = rr(1, 2); }
        break;
      case "hurt": {
        const u = clamp(b.t / b.dur, 0, 1), k = 1 - u;
        mvx = b.vx * k * 1.8;
        mvz = b.vz * k * 1.8;
        pose(p, [0.5 + 0.4 * u, 0.4 + 0.5 * u, 0.7 * k, 0.6 * k], -0.38 * k * k + 0.05);
        nodT = -0.55 * k;
        lookT = b.snap * k;
        if (b.t >= b.dur) {
          b.t = 0;
          if (b.coverNext && !b.timid) {
            b.coverNext = false;
            b.stag = 0;
            b.state = "cover";
            b.dur = 0.8;
            b.riposte = true;
          } else if (!b.timid && b.d < 3 && rand() < b.skill * 0.35) {
            b.riposte = true;            // shake it off and fire straight back
            startRiposte(b);
          } else b.state = "circle";
        }
        break;
      }
      case "floored": {
        const k = Math.max(0, 1 - b.t / 0.5);
        mvx = b.vx * k * 2;
        mvz = b.vz * k * 2;
        pose(p, [0.3, 0.25, 1.1, 1.0], -1.45, 0, 0.2, 0.13);
        nodT = 0.3;
        if (b.t > 1.8) { b.state = "rise"; b.t = 0; }
        break;
      }
      case "rise": {
        const u = clamp(b.t / 0.7, 0, 1);
        pose(p, mixA([0.3, 0.25, 1.1, 1.0], PG, u), -1.45 * (1 - smooth(u)) + 0.08 * u, 0, 0, 0.13 * (1 - u), 0, 0.3 * Math.sin(Math.PI * u));
        if (b.t > 0.7) { b.state = "circle"; b.cool = rr(0.6, 1.4); }
        break;
      }
    }
    p.look += (lookT - p.look) * Math.min(1, dt * 14);
    p.nod += (nodT - p.nod) * Math.min(1, dt * 14);
    // move (split up so nobody walks through a wall; never into you)
    const sp = Math.hypot(mvx, mvz);
    let moved = 0;
    if (sp > 0.01) {
      const step = sp * dt, n = Math.max(1, Math.ceil(step / 0.3));
      for (let s = 0; s < n; s++) {
        const nx = p.x + (mvx * dt) / n, nz = p.z + (mvz * dt) / n;
        if (blocked(nx, nz, terrainH(nx, nz))) break;
        if (Math.hypot(nx - P.x, nz - P.z) < 0.8 && Math.hypot(nx - P.x, nz - P.z) < Math.hypot(p.x - P.x, p.z - P.z)) break;
        p.x = nx;
        p.z = nz;
        moved = sp;
      }
    }
    p.speed = b.state === "floored" || b.state === "rise" || b.state === "hurt" ? 0 : moved;
    // the warning bolt over their head while they wind up
    if (b.state === "windup" || b.state === "countered")
      showMarker(b, b.atk.red, b.state === "countered" || b.atk.red || b.atk.wind - b.t <= counterWin(b.atk));
    else if (b.marker) { b.marker.setEnabled(false); markerPool.push(b.marker); b.marker = null; }
  }
}

// ---------------------------------------------------------------- warning bolts
let boltMats = null;
const markerPool = [];
function boltMat(name, col, glow) {
  const t = new BABYLON.DynamicTexture(name + "T", { width: 128, height: 128 }, scene, true);
  t.hasAlpha = true;
  const c = t.getContext();
  c.clearRect(0, 0, 128, 128);
  c.shadowColor = glow;
  c.shadowBlur = 16;
  c.fillStyle = col;
  c.beginPath();
  for (const [x, y] of [[76, 6], [34, 70], [60, 70], [46, 122], [96, 50], [69, 50], [86, 6]]) c.lineTo(x, y);
  c.closePath();
  c.fill();
  c.fill();
  t.update();
  const m = new BABYLON.StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = new BABYLON.Color3(0, 0, 0);
  m.emissiveTexture = t;
  m.opacityTexture = t;
  m.fogEnabled = false;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  return m;
}
function showMarker(b, red, open) {
  if (!boltMats) boltMats = { blue: boltMat("boltBlue", "#bfe8ff", "#2f9bff"), red: boltMat("boltRed", "#ffd0c8", "#ff3020") };
  if (!b.marker) {
    let m = markerPool.pop();
    if (!m) {
      m = BABYLON.MeshBuilder.CreatePlane("bolt", { size: 1 }, scene);
      m.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      m.renderingGroupId = 1;
      m.isPickable = false;
    }
    b.marker = m;
    m.setEnabled(true);
  }
  const m = b.marker, p = b.p;
  m.material = red ? boltMats.red : boltMats.blue;
  m.position.set(p.x, groundY(p) + 2.3, p.z);
  // a small warning as they wind up; it flares when it's time to counter
  m.scaling.setAll(open ? 0.62 + 0.05 * Math.sin(F.now * 40) : 0.3);
}

// ---------------------------------------------------------------- per frame (before the player moves)
export function updateMelee(dt) {
  if (!H) return;
  F.now += dt;
  F.vx = F.vz = 0;
  F.face = null;
  F.invuln = Math.max(0, F.invuln - dt);
  if (F.comboT > 0 && (F.comboT -= dt) <= 0) { F.combo = 0; F.special = 0; }
  if (F.flashT > 0) F.flashT -= dt;
  // stamina comes back once you stop spending it (slowly behind a raised guard)
  if (F.stamT > 0) F.stamT -= dt;
  else F.stam = Math.min(STAM_MAX, F.stam + dt * (F.blocking ? 9 : 24));
  const can = H.canFight();
  if (!can && F.act) { F.act = null; F.queued = null; }
  if (F.act) stepAct(F.act, dt);
  updateBrawlers(dt, can);
  let fighters = 0;
  for (const b of brawlers) if (!b.timid) fighters++;
  F.fightN = fighters ? Math.max(F.fightN, fighters) : 0;
  let near = null, nd = 4.5;
  F.engaged = false;
  for (const b of brawlers) {
    if (b.timid) continue;
    if (b.d < 9) F.engaged = true;
    if (b.d < nd && b.state !== "floored") { nd = b.d; near = b; }
  }
  F.engaged = F.engaged && can;
  F.cam += ((F.engaged ? 1 : 0) - F.cam) * Math.min(1, dt * 2.5);
  F.blocking = can && F.blockHeld && !F.act && H.onGround();
  // squared up: keep facing the nearest one (you can still circle round them)
  if (!F.act && F.face === null && near && can) F.face = faceTo(near.p.x - P.x, near.p.z - P.z, dt, 8);
  // knocked back off a block
  F.vx += F.kx;
  F.vz += F.kz;
  const kk = Math.exp(-dt * 7);
  F.kx *= kk;
  F.kz *= kk;
  if (Math.abs(F.kx) < 0.05) F.kx = 0;
  if (Math.abs(F.kz) < 0.05) F.kz = 0;
  updateHud();
}

// ---------------------------------------------------------------- player pose (after the normal walk pose and stunts)
function samplePose(a, out) {
  Object.assign(out, GUARD);
  if (a.kind === "move") {
    const kf = a.def.kf, u = clamp(a.t / (a.def.dur * a.dm), 0, 1);
    let i = 0;
    while (i < kf.length - 2 && u > kf[i + 1][0]) i++;
    const [t0, A] = kf[i], [t1, B] = kf[i + 1];
    const k = t1 > t0 ? smooth(clamp((u - t0) / (t1 - t0), 0, 1)) : 1;
    for (const j of J) out[j] = A[j] + (B[j] - A[j]) * k;
  } else if (a.kind === "glide") {
    const s = Math.sin(F.glidePh);
    out.lean = 0.42;
    out.y = -0.1;
    out.hLx = -0.9 * s;
    out.hRx = 0.9 * s;
    out.kL = 0.4 + 0.9 * Math.max(0, -s);
    out.kR = 0.4 + 0.9 * Math.max(0, s);
    out.twist = 0.05;
  } else if (a.kind === "dodge") {
    const u = clamp(a.t / a.dur, 0, 1), e = smooth(u), b = Math.sin(Math.PI * u) * (a.small ? 0.25 : 1);
    if (a.mode === "side") {
      out.cart = a.small ? 0 : -a.sgn * TAU * e;   // cartwheel (tired: just a stumble aside)
      out.y = 0.35 * b;
      out.aLz = out.aRz = 0.2 + 2.7 * b;
      out.aLx = out.aRx = -0.2;
      out.eL = out.eR = -0.1;
      out.hLz = out.hRz = 0.7 * b;
      out.kL = out.kR = 0.1;
      out.hLx = out.hRx = 0;
      out.lean = 0;
      out.twist = 0;
    } else {
      out.flip = (a.mode === "front" ? 1 : -1) * TAU * e;   // front / back flip, tucked
      out.y = 0.65 * b;
      out.kL = out.kR = 0.3 + 1.9 * b;
      out.hLx = out.hRx = -0.2 - 1.4 * b;
      out.aLx = out.aRx = -0.5 - 1.4 * b;
      out.eL = out.eR = -1.2;
      out.twist = 0;
      out.lean = 0;
    }
  } else if (a.kind === "hurt") {
    const u = clamp(a.t / a.dur, 0, 1), b = Math.sin(Math.PI * Math.min(1, u * 1.3));
    out.lean = -0.38 * b;
    out.aLx = -0.4;
    out.aLz = 0.6;
    out.eL = -0.7;
    out.aRx = -0.3;
    out.aRz = 0.7;
    out.eR = -0.6;
    out.twist = a.side * 0.45 * b;
    out.y = -0.1 * b;
    out.hLx = -0.1;
    out.hRx = 0.35;
    out.kL = 0.3;
    out.kR = 0.5;
  }
  out.spin = wrapAng(out.spin);
  out.flip = wrapAng(out.flip);
  out.cart = wrapAng(out.cart);
}
const lerp = (a, b, k) => a + (b - a) * k;
export function poseMelee(dt) {
  if (!H) return;
  const R = H.rig, can = H.canFight() && !H.swimming();
  const a = can ? F.act : null;
  if (a) samplePose(a, S);
  else if (F.blocking) Object.assign(S, BLOCK);
  const activeT = a || F.blocking ? 1 : 0;
  F.poseW += (activeT - F.poseW) * Math.min(1, dt * (activeT ? 30 : 12));
  F.guardW += ((can && !H.gunUp() && (F.engaged || H.fists()) ? 1 : 0) - F.guardW) * Math.min(1, dt * 6);
  if (!can) { F.poseW = 0; F.guardW = 0; }
  const pw = F.poseW, gw = F.guardW;
  if (pw < 0.001 && gw < 0.001) {
    R.legL.hip.rotation.z = R.legR.hip.rotation.z = 0;
    R.body.rotation.y = R.body.rotation.z = 0;
    return;
  }
  const legG = gw * (H.speed() > 1 ? 0 : 1);   // walking: the legs keep walking
  const val = (j, base) => {
    const g = lerp(base, GUARD[j], LEGS.has(j) ? legG : gw);
    return lerp(g, S[j], pw);
  };
  const L = R.armL, Rr = R.armR;
  L.sh.rotation.x = val("aLx", L.sh.rotation.x);
  L.sh.rotation.z = -val("aLz", -L.sh.rotation.z);
  L.el.rotation.x = val("eL", L.el.rotation.x);
  Rr.sh.rotation.x = val("aRx", Rr.sh.rotation.x);
  Rr.sh.rotation.z = val("aRz", Rr.sh.rotation.z);
  Rr.el.rotation.x = val("eR", Rr.el.rotation.x);
  R.legL.hip.rotation.x = val("hLx", R.legL.hip.rotation.x);
  R.legL.hip.rotation.z = -val("hLz", 0);
  R.legL.knee.rotation.x = val("kL", R.legL.knee.rotation.x);
  R.legR.hip.rotation.x = val("hRx", R.legR.hip.rotation.x);
  R.legR.hip.rotation.z = val("hRz", 0);
  R.legR.knee.rotation.x = val("kR", R.legR.knee.rotation.x);
  R.body.rotation.x = val("lean", R.body.rotation.x);
  R.body.rotation.y = val("twist", 0);
  R.body.rotation.z = val("roll", 0);
  R.body.position.y += lerp(GUARD.y * legG, S.y, pw);
  R.stuntPivot.rotation.x += S.flip * pw;
  R.stuntPivot.rotation.y += S.spin * pw;
  R.stuntPivot.rotation.z += S.cart * pw;
  // first-person arms: the same pose, from the guard
  for (const j of J) V[j] = lerp(GUARD[j], S[j], pw);
}

// ---------------------------------------------------------------- HUD
let hudEl = null, hudHtml = "", hudOn = false;
function updateHud() {
  if (!hudEl) {
    const st = document.createElement("style");
    st.textContent = `
#meleeHud{position:fixed;left:32px;top:30%;text-align:left;font:600 13px/1.25 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7);pointer-events:none;z-index:6;opacity:0;transition:opacity .25s}
#meleeHud.on{opacity:1}
#meleeHud .st{letter-spacing:.2em;font-size:11px;opacity:.85;text-transform:uppercase}
#meleeHud .cb{font-size:40px;font-weight:800;line-height:1;margin:4px 0 0}
#meleeHud .cb small{font-size:13px;font-weight:700;opacity:.7;margin-left:4px;letter-spacing:.12em}
#meleeHud .tg{margin-top:8px;font-size:11px;letter-spacing:.06em;opacity:.95}
#meleeHud .bar{display:inline-block;width:110px;height:6px;background:rgba(0,0,0,.45);border-radius:3px;overflow:hidden;vertical-align:middle;margin-left:6px}
#meleeHud .bar i{display:block;height:100%;background:#e8584a;border-radius:3px}
#meleeHud .tip{margin-top:10px;font-size:13px;font-weight:800;letter-spacing:.1em}
#meleeHud .tip.ctr{color:#8fd6ff}
#meleeHud .tip.dge{color:#ff7262}
#meleeHud .tip.tkd{color:#ffc23d}
#meleeHud .sm{margin-top:6px;font-size:10px;letter-spacing:.14em;opacity:.9}
#meleeHud .sm .bar{width:90px;height:5px}
#meleeHud .fl{margin-top:8px;font-size:17px;font-weight:800;letter-spacing:.14em;color:#fff}`;
    document.head.appendChild(st);
    hudEl = document.createElement("div");
    hudEl.id = "meleeHud";
    document.body.appendChild(hudEl);
  }
  const show = H.canFight() && (H.fists() || F.engaged || F.combo > 0);
  if (show !== hudOn) {
    hudOn = show;
    hudEl.classList.toggle("on", show);
  }
  if (!show) return;
  let h = `<div class="st">${STYLES[F.style].name} · <kbd>G</kbd></div>`;
  const sp = Math.round(F.stam / 2) * 2, scol = sp < 15 ? "#ff5a4a" : sp < 35 ? "#ffc23d" : "#7bd88f";
  h += `<div class="sm">${sp < 15 ? "TIRED" : "STAMINA"}<span class="bar"><i style="width:${sp}%;background:${scol}"></i></span></div>`;
  if (F.combo >= 2) h += `<div class="cb">${F.combo}<small>HIT COMBO</small></div>`;
  const t = F.lastTarget;
  if (t && t.__b && !t.dead && t.state !== "down" && t.hp > 0) {
    h += `<div class="tg">${t.__b.state === "floored" ? "DOWN · Q to finish" : "Opponent"}<span class="bar"><i style="width:${Math.round(clamp(t.hp / t.__b.max, 0, 1) * 100)}%"></i></span></div>`;
  }
  if (F.threat && F.threat.red) h += `<div class="tip dge">DODGE · <kbd>Space</kbd></div>`;
  else if (F.threat && F.threat.open) h += `<div class="tip ctr">COUNTER NOW · <kbd>R</kbd> / <kbd>Right click</kbd></div>`;
  else if (F.special >= SPECIAL_AT) h += `<div class="tip tkd">COMBO TAKEDOWN READY · <kbd>Q</kbd></div>`;
  if (F.flashT > 0) h += `<div class="fl">${F.flash}</div>`;
  if (h !== hudHtml) {
    hudHtml = h;
    hudEl.innerHTML = h;
  }
}
