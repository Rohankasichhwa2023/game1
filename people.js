// people.js — pedestrians with personalities and everyday behaviour.
//
// Bodies have a separate head (looks around, tracks the player, looks down at
// a phone) and arms on shoulder pivots, so people can actually *do* things:
//
//   everyday   walk with swinging arms, stop and look around, take a phone
//              call, text while walking, window-shop, tie a shoelace,
//              stretch, check the time, chat with someone they meet (with
//              hand gestures), walk in pairs with a friend, jog, cross the
//              road (look both ways, wait for traffic, then cross),
//              keep personal space and step round people
//   social     glance at the player, wave at them, get annoyed when barged
//              into (shake a fist), dive out of the way of a speeding car
//   danger     raise their hands when a gun is pointed at them, run *away*
//              from gunfire / explosions, some freeze and cower first, the
//              curious ones stop at a distance and film it on their phone
//   time       most people go home at night; night owls stay out
//
// Public API is unchanged: peds[], spawnPeds, updatePeds, knockDown, scare.
// A ped's state is one of: walk, act, chat, follow, cross, wave, annoyed,
// dodge, surrender, cower, flee, watch, down, away — or brawl (in a fist
// fight with the player: melee.js moves and poses them, we just animate).
import { scene, rand, rr, pick, clamp, hex, litMat, colorTemplate, angDiff, terrainH, state as world } from "./engine.js";
import { edges, pathAt } from "./roads.js";

export const peds = [];
const MB = BABYLON.MeshBuilder;
let torsoTs = [], headTs = [], legTs = [], armTs = {}, farTs = {}, phoneT = null, templatesMade = false;
const SHOULDER_Y = 1.47, SHOULDER_X = 0.25;
// Beyond FAR_LOD metres a person is drawn as one low-poly figure (same shirt
// and skin) instead of six animated parts; back to full detail when closer.
const FAR_LOD = 50, NEAR_LOD = 44;

function initTemplates() {
  if (templatesMade) return;
  templatesMade = true;
  const skins = ["#e0b08c", "#c08462", "#8d5a3c", "#5c3a26"].map((h, i) => litMat("skin" + i, hex(h), 0.15));
  const hairs = ["#2a1d14", "#5a3a20", "#b08a50", "#111111", "#7a7a7a"].map((h, i) => litMat("hair" + i, hex(h)));
  const shirtHex = ["#c0392b", "#2c3e50", "#ecf0f1", "#27ae60", "#f1c40f", "#8e44ad", "#3d6fa8", "#d35400", "#1d1d1d", "#7f8c8d"];
  const shirts = shirtHex.map((h, i) => litMat("shirt" + i, hex(h), 0.05));
  torsoTs = shirts.map((shirt, i) => {
    const t = MB.CreateCapsule("t", { radius: 0.19, height: 0.66, tessellation: 10, subdivisions: 1 }, scene);
    t.position.y = 1.2; t.scaling.set(1.1, 1, 0.72);
    return { tpl: colorTemplate("pedTorso" + i, [{ mesh: t, mat: shirt }]), si: i };
  });
  // heads pivot at the neck (origin), so they can turn and nod
  skins.forEach((skin, si) => hairs.forEach((hair, hi) => {
    const head = MB.CreateSphere("h", { diameter: 0.23, segments: 8 }, scene);
    head.position.y = 0.12;
    const hr = MB.CreateSphere("hr", { diameter: 0.25, segments: 8, slice: 0.55 }, scene);
    hr.position.y = 0.14;
    const nose = MB.CreateBox("ns", { width: 0.04, height: 0.05, depth: 0.05 }, scene);
    nose.position.set(0, 0.11, 0.115);
    const neck = MB.CreateCylinder("n", { diameter: 0.1, height: 0.12, tessellation: 6 }, scene);
    neck.position.y = -0.01;
    headTs.push({ tpl: colorTemplate(`pedHead${si}_${hi}`, [{ mesh: head, mat: skin }, { mesh: hr, mat: hair }, { mesh: nose, mat: skin }, { mesh: neck, mat: skin }]), si });
  }));
  // arms pivot at the shoulder and hang down -y
  shirts.forEach((shirt, i) => skins.forEach((skin, si) => {
    const arm = MB.CreateCapsule("a", { radius: 0.058, height: 0.6, tessellation: 8, subdivisions: 1 }, scene);
    arm.position.y = -0.28;
    const hand = MB.CreateSphere("hd", { diameter: 0.1, segments: 6 }, scene);
    hand.position.y = -0.6;
    armTs[`${i}_${si}`] = colorTemplate(`pedArm${i}_${si}`, [{ mesh: arm, mat: shirt }, { mesh: hand, mat: skin }]);
  }));
  legTs = ["#2b3a55", "#1d1d1d", "#b8a27a", "#4a4a4a"].map((h, i) => {
    const leg = MB.CreateCapsule("leg", { radius: 0.082, height: 0.88, tessellation: 8, subdivisions: 1 }, scene);
    leg.position.y = -0.44;
    return colorTemplate("pedLeg" + i, [{ mesh: leg, mat: litMat("pants" + i, hex(h)) }]);
  });
  // far-away figures: legs, body and head in one mesh per shirt / skin colour
  const pants = litMat("farPants", hex("#2b3348"));
  shirts.forEach((shirt, i) => skins.forEach((skin, si) => {
    const legs = MB.CreateCapsule("fl", { radius: 0.15, height: 0.95, tessellation: 6, capSubdivisions: 2 }, scene);
    legs.position.y = 0.47; legs.scaling.set(1.35, 1, 0.9);
    const body = MB.CreateCapsule("fb", { radius: 0.21, height: 0.75, tessellation: 6, capSubdivisions: 2 }, scene);
    body.position.y = 1.22; body.scaling.set(1.15, 1, 0.75);
    const head = MB.CreateSphere("fh", { diameter: 0.25, segments: 4 }, scene);
    head.position.y = 1.67;
    farTs[`${i}_${si}`] = colorTemplate(`pedFar${i}_${si}`, [{ mesh: legs, mat: pants }, { mesh: body, mat: shirt }, { mesh: head, mat: skin }]);
  }));
  const ph = MB.CreateBox("phone", { width: 0.075, height: 0.14, depth: 0.015 }, scene);
  const scr = MB.CreateBox("phoneScr", { width: 0.065, height: 0.12, depth: 0.004 }, scene);
  scr.position.z = 0.009;
  const glowM = litMat("phoneScrM", hex("#6fb7ff"), 0.3); glowM.emissiveColor = hex("#3c78b8");
  phoneT = colorTemplate("pedPhone", [{ mesh: ph, mat: litMat("phoneM", hex("#151618"), 0.4) }, { mesh: scr, mat: glowM }]);
}

function pickEdge(district = null) {
  const list = district ? edges.filter((e) => e.district === district && e.len > 6)
    : edges.filter((e) => e.district !== "park" || rand() < 0.3);
  const total = list.reduce((a, e) => a + e.len, 0);
  let r = rand() * total;
  for (const e of list) { r -= e.len; if (r <= 0) return e; }
  return list[0];
}

// A one-off outfit for a story character: own shirt / skin / hair / trouser
// colours (built once, so the character is recognisable from a distance).
function customLook(id, o) {
  const skin = litMat(id + "Skin", hex(o.skin), 0.15), hair = litMat(id + "Hair", hex(o.hair));
  const shirt = litMat(id + "Shirt", hex(o.shirt), 0.05), sleeve = litMat(id + "Sleeve", hex(o.sleeve || o.shirt), 0.05);
  const t = MB.CreateCapsule("t", { radius: 0.19, height: 0.66, tessellation: 10, subdivisions: 1 }, scene);
  t.position.y = 1.2; t.scaling.set(o.build ?? 1.1, 1, 0.72);
  const torso = { tpl: colorTemplate(id + "Torso", [{ mesh: t, mat: shirt }]) };
  const head = MB.CreateSphere("h", { diameter: 0.23, segments: 8 }, scene); head.position.y = 0.12;
  const parts = [{ mesh: head, mat: skin }];
  if (!o.bald) { const hr = MB.CreateSphere("hr", { diameter: 0.25, segments: 8, slice: o.longHair ? 0.75 : 0.55 }, scene); hr.position.y = o.longHair ? 0.1 : 0.14; parts.push({ mesh: hr, mat: hair }); }
  const nose = MB.CreateBox("ns", { width: 0.04, height: 0.05, depth: 0.05 }, scene); nose.position.set(0, 0.11, 0.115); parts.push({ mesh: nose, mat: skin });
  const neck = MB.CreateCylinder("n", { diameter: 0.1, height: 0.12, tessellation: 6 }, scene); neck.position.y = -0.01; parts.push({ mesh: neck, mat: skin });
  if (o.beard) { const b = MB.CreateSphere("bd", { diameter: 0.2, segments: 6 }, scene); b.scaling.set(1, 0.7, 0.8); b.position.set(0, 0.04, 0.05); parts.push({ mesh: b, mat: hair }); }
  const headT = { tpl: colorTemplate(id + "Head", parts) };
  const arm = MB.CreateCapsule("a", { radius: 0.058, height: 0.6, tessellation: 8, subdivisions: 1 }, scene); arm.position.y = -0.28;
  const hand = MB.CreateSphere("hd", { diameter: 0.1, segments: 6 }, scene); hand.position.y = -0.6;
  const armT = colorTemplate(id + "Arm", [{ mesh: arm, mat: sleeve }, { mesh: hand, mat: skin }]);
  const leg = MB.CreateCapsule("leg", { radius: 0.082, height: 0.88, tessellation: 8, subdivisions: 1 }, scene);
  leg.position.y = -0.44;
  const legT = colorTemplate(id + "Leg", [{ mesh: leg, mat: litMat(id + "Pants", hex(o.pants)) }]);
  return { torso, head: headT, armT, legT };
}

function makePed(e, look = null) {
  const torso = look ? look.torso : pick(torsoTs), head = look ? look.head : pick(headTs);
  const root = new BABYLON.TransformNode("ped", scene);
  const body = torso.tpl.createInstance("pt"); body.parent = root;
  const headPivot = new BABYLON.TransformNode("pedHeadPivot", scene);
  headPivot.parent = root; headPivot.position.y = 1.55;
  const headM = head.tpl.createInstance("ph"); headM.parent = headPivot;
  const armT = look ? look.armT : armTs[`${torso.si}_${head.si}`];
  const arms = [-1, 1].map((sx) => {
    const a = armT.createInstance("pa"); a.parent = root;
    a.position.set(sx * SHOULDER_X, SHOULDER_Y, 0);
    return a;
  });
  const phone = phoneT.createInstance("pp");
  phone.parent = arms[1]; phone.position.set(0, -0.62, 0.06); phone.rotation.x = Math.PI / 2;
  phone.setEnabled(false);
  const legT = look ? look.legT : pick(legTs);
  const legs = [-0.1, 0.1].map((x) => { const l = legT.createInstance("pl"); l.parent = root; l.position.set(x, 0.9, 0); return l; });

  // far-away stand-in (not for story characters, who always keep full detail)
  let far = null;
  if (!look) { far = farTs[`${torso.si}_${head.si}`].createInstance("pf"); far.parent = root; far.setEnabled(false); }
  const persona = {
    brave: rand(), social: rand(), curious: rand(), phoneAddict: rand() < 0.3,
    jogger: rand() < 0.07, elderly: rand() < 0.1, nightOwl: rand() < 0.35,
  };
  if (persona.jogger) persona.elderly = false;
  const walk = persona.jogger ? rr(2.7, 3.2) : persona.elderly ? rr(0.75, 1.0) : rr(1.1, 1.6);
  const p = {
    root, body, headPivot, arms, legs, phone, persona, far, lod: 0,
    e, dir: rand() < 0.5 ? 1 : -1, s: rr(2, e.len - 2), side: 1,
    lat: rr(0.35, 0.65), walk, speed: walk, phase: rand() * 6,
    state: "walk", act: null, timer: 0, cool: rr(3, 20), x: 0, z: 0, heading: 0, vx: 0, vz: 0, push: 0,
    look: 0, nod: 0, crouch: 0, lean: 0, ax: [0, 0], az: [0, 0],
    threat: null, partner: null, leader: null, cross: null, fx: 0, fz: 1,
  };
  place(p, 0, true);
  peds.push(p);
  return p;
}

// An extra crowd that lives in one district (Kathmandu's busy lanes). They
// stay there (respawning there too), and while the player is far away they go
// dormant — hidden and not updated — so the crowd costs nothing elsewhere.
export function spawnDistrictPeds(district, count) {
  initTemplates();
  for (let i = 0; i < count; i++) {
    const p = makePed(pickEdge(district));
    p.home = district;
    if (!p.persona.jogger && rand() < 0.25 && i + 1 < count) {          // friends / family walking together
      const f = makePed(p.e);
      f.home = district; f.leader = p; f.state = "follow"; p.hasFollower = true;
      f.persona.jogger = false; f.walk = p.walk; f.speed = p.walk;
      f.persona.nightOwl = p.persona.nightOwl;
      f.dir = p.dir; f.s = p.s; f.lat = p.lat > 0.5 ? p.lat - 0.32 : p.lat + 0.32;
      place(f, 0, true);
      i++;
    }
  }
}
export function spawnPeds(count = 190) {
  initTemplates();
  while (peds.length < count) {
    const p = makePed(pickEdge());
    // ~15% walk with a friend
    if (!p.persona.jogger && rand() < 0.15 && peds.length < count) {
      const f = makePed(p.e);
      f.leader = p; f.state = "follow"; p.hasFollower = true;
      f.persona.jogger = false; f.walk = p.walk; f.speed = p.walk;
      f.persona.nightOwl = p.persona.nightOwl;
      f.dir = p.dir; f.s = p.s; f.lat = p.lat > 0.5 ? p.lat - 0.32 : p.lat + 0.32;
      place(f, 0, true);
    }
  }
}

// ---------------------------------------------------------------- story characters
// characters.js drives these: it gives them a look, a daily schedule (a route
// to walk along the road graph, then a "work" pose at their spot) and handles
// conversations. The usual street reactions (dodging cars, hands up at a gun,
// fleeing gunfire, getting knocked down) still apply, and are reported back
// through pedHooks so the character can remember them.
export const pedHooks = { onHurt: null, onGun: null, onScare: null, onBarged: null, onDown: null, onNear: null };
// onDown(p): anyone knocked down (main.js plays the death sound)
// onNear(p, d): the player has walked right up to someone (casual remark)
export function spawnCharacter(def, e, s) {
  const p = makePed(e, customLook("chr_" + def.id, def.look));
  p.char = def;
  p.s = clamp(s, 1, e.len - 1);
  p.walk = def.walkSpeed ?? 1.35; p.speed = 0;
  Object.assign(p.persona, { brave: def.persona.brave, social: 0, curious: def.persona.curious ?? 0.5, nightOwl: true, jogger: false, elderly: !!def.persona.elderly });
  p.state = "work"; p.pose = "stand";
  place(p, 0, true);
  return p;
}
// ---------------------------------------------------------------- gunmen
// Mission enemies: a person with a pistol, driven entirely by the mission's
// combat code (it sets x / z / heading / speed / state); this module only
// animates them. Once knocked down (killed) they fall like anyone else.
let goonGunT = null;
const goonLooks = {};
export function spawnGoon(x, z, o = {}) {
  initTemplates();
  const key = o.key || "goon";
  const look = goonLooks[key] || (goonLooks[key] = customLook("goon_" + key, o.look || { shirt: "#1d1f24", sleeve: "#24272d", skin: "#c08462", hair: "#111111", pants: "#22252b", build: 1.15 }));
  const p = makePed(edges[0], look);
  p.goon = true; p.char = null;
  p.state = "aim"; p.speed = 0; p.walk = 0;
  p.x = x; p.z = z; p.heading = o.heading || 0;
  Object.assign(p.persona, { jogger: false, elderly: false, nightOwl: true, phoneAddict: false });
  if (!goonGunT) {
    const b = MB.CreateBox("gg", { width: 0.06, height: 0.24, depth: 0.12 }, scene);
    goonGunT = colorTemplate("goonGun", [{ mesh: b, mat: litMat("goonGunM", hex("#111214"), 0.4) }]);
  }
  const g = goonGunT.createInstance("goonGunI");
  g.parent = p.arms[1]; g.position.set(0, -0.68, 0.04);
  p.gun = g;
  p.root.position.set(x, terrainH(x, z), z);
  p.root.setEnabled(true);
  p.dormant = false;
  return p;
}
export function removeGoon(p) {
  const i = peds.indexOf(p);
  if (i >= 0) peds.splice(i, 1);
  p.root.dispose(false, false);
}

export function placePed(p) { p.push = 0; place(p, 0, true); p.heading = Math.atan2(p.fx, p.fz); }
export function fleePed(p, x, z) { p.threat = { x, z }; startFlee(p, rr(4, 7)); }
export function sideHeading(p, towardRoad) {
  return towardRoad ? Math.atan2(-p.fz * p.side, p.fx * p.side) : Math.atan2(p.fz * p.side, -p.fx * p.side);
}

// ---------------------------------------------------------------- path helpers
const sideOffset = (p) => p.e.w / 2 + p.e.sw * p.lat + p.push;
const Q = { x: 0, z: 0, tx: 0, tz: 1 };
function place(p, dt, snap = false, offScale = 1) {
  const q = pathAt(p.e, p.s, Q);
  const fx = q.tx * p.dir, fz = q.tz * p.dir;
  p.fx = fx; p.fz = fz;
  const off = sideOffset(p) * p.side * offScale;
  const x = q.x + fz * off, z = q.z - fx * off;
  const gx = x - p.x, gz = z - p.z, gap = Math.hypot(gx, gz);
  if (snap || gap < 0.05) { p.x = x; p.z = z; }
  else {
    // Catch up with the path point, but never faster than a person can move:
    // after being knocked a few metres off the pavement they run back to it
    // instead of sliding / teleporting there.
    const maxStep = (Math.max(p.speed, 1.2) + (p.state === "dodge" ? 6 : 1.5)) * dt;
    const step = Math.min(gap, maxStep);
    p.x += (gx / gap) * step; p.z += (gz / gap) * step;
  }
  return Math.atan2(fx, fz);
}
function turnTo(p, h, dt, rate = 8) { p.heading += angDiff(h, p.heading) * Math.min(1, dt * rate); }
function faceXZ(p, x, z, dt, rate = 6) { turnTo(p, Math.atan2(x - p.x, z - p.z), dt, rate); }
// heading toward the buildings on this ped's side of the street
const outward = (p) => Math.atan2(p.fz * p.side, -p.fx * p.side);
function nextEdge(p, overflow) {
  const nd = p.dir > 0 ? p.e.b : p.e.a;
  // a character on its way somewhere follows its planned route
  if (p.route && p.route.length) {
    const e = p.route.shift();
    if (e.a === nd || e.b === nd) {
      p.e = e;
      if (e.a === nd) { p.dir = 1; p.s = overflow; } else { p.dir = -1; p.s = e.len - overflow; }
      return;
    }
    p.route = null;
  }
  // a scripted runner (mission target) picks its own way at every junction
  if (p.chooser) {
    const opts2 = nd.edges.filter((e) => e !== p.e);
    const e = opts2.length ? p.chooser(p, nd, opts2) : p.e;
    if (e === p.e) { p.dir = -p.dir; p.s = p.dir > 0 ? overflow : e.len - overflow; return; }
    p.e = e;
    if (e.a === nd) { p.dir = 1; p.s = overflow; } else { p.dir = -1; p.s = e.len - overflow; }
    return;
  }
  const opts = nd.edges.filter((e) => e !== p.e);
  const e = opts.length && rand() < 0.92 ? pick(opts) : p.e;
  if (e === p.e) { p.dir = -p.dir; p.s = p.dir > 0 ? overflow : e.len - overflow; return; }
  p.e = e;
  if (e.a === nd) { p.dir = 1; p.s = overflow; } else { p.dir = -1; p.s = e.len - overflow; }
  // sometimes cross over right after turning the corner
  if (!p.leader && !p.char && p.state === "walk" && rand() < 0.12) p.crossAt = p.dir > 0 ? overflow + 5 : e.len - overflow - 5;
}
function advance(p, ds) {
  p.s += p.dir * ds;
  let guard = 0;
  while ((p.s > p.e.len || p.s < 0) && guard++ < 4) nextEdge(p, p.s > p.e.len ? p.s - p.e.len : -p.s);
}
const crossable = (e) => !["roundabout", "circus", "bridge", "parkway", "plaza"].includes(e.kind) && e.w <= 15;

// ---------------------------------------------------------------- reactions (public)
export function knockDown(p, fx = 0, fz = 0) {
  if (p.dead || p.state === "away") return;
  if (p.brawl) clearBrawl(p);
  if (p.state === "down") { if (pedHooks.onDown && p.scripted) pedHooks.onDown(p, Math.hypot(fx, fz)); return; }   // a target can still be finished off
  if (p.char && pedHooks.onHurt) pedHooks.onHurt(p);
  if (pedHooks.onDown) pedHooks.onDown(p, Math.hypot(fx, fz));
  endSocial(p);
  p.state = "down";
  p.timer = rr(3.5, 5.5);
  p.vx = fx; p.vz = fz;
  p.phone.setEnabled(false);
}
// Something scary happened at (x, z): people near it run away from it (or
// freeze and cower first); curious, braver people further out stop to watch
// and film it.
export function scare(x, z, r) {
  for (const p of peds) {
    if (p.state === "down" || p.state === "away" || p.scripted || p.brawl) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > r * 1.6) continue;
    if (p.char && pedHooks.onScare) pedHooks.onScare(p, x, z, d / r);
    endSocial(p);
    p.threat = { x, z };
    p.cross = null; p.crossAt = undefined;
    if (d > r || (d > r * 0.55 && p.persona.curious > 0.6 && p.persona.brave > 0.45)) {
      if (p.state === "flee" || p.state === "cower") continue;
      if (p.persona.curious > 0.45) { p.state = "watch"; p.timer = rr(5, 10); p.phone.setEnabled(rand() < 0.75); }
      continue;
    }
    p.phone.setEnabled(false);
    if (p.state !== "flee" && p.persona.brave < 0.3 && d < r * 0.6 && rand() < 0.6) { p.state = "cower"; p.timer = rr(1.5, 3.5); continue; }
    startFlee(p, rr(5, 9));
  }
}
// ---------------------------------------------------------------- fist fights (driven by melee.js)
// While brawling, p.x / p.z / p.heading / p.speed are set by melee.js, and
// these shape the pose: bArms [axL, axR, azL, azR], bLean, bTwist (upper-body
// turn), bRoll, bLift (lying on the ground), bKick (right leg raised), bCrouch.
export function enterBrawl(p) {
  endSocial(p);
  p.cross = null; p.crossAt = undefined; p.act = null; p.threat = null;
  p.phone.setEnabled(false);
  if (p.lod) setLod(p, 0);
  p.state = "brawl"; p.brawl = true; p.speed = 0;
}
function clearBrawl(p) {
  p.brawl = false;
  p.bArms = null; p.bLean = p.bTwist = p.bRoll = p.bLift = p.bKick = p.bCrouch = 0;
  p.root.rotation.z = 0;
}
// how: "flee" (run off), "annoyed" (shake a fist, then go about their day)
export function leaveBrawl(p, how = "annoyed", x = 0, z = 0) {
  if (!p.brawl) return;
  clearBrawl(p);
  if (p.state === "down" || p.dead) return;
  if (how === "flee") { p.threat = { x, z }; startFlee(p, rr(5, 8)); }
  else { p.state = "annoyed"; p.timer = rr(1.5, 2.5); }
}
function startFlee(p, t) {
  p.state = "flee"; p.timer = t;
  p.phone.setEnabled(false);
  if (p.threat) {
    // run along the street in the direction that takes us away from it
    const q = pathAt(p.e, p.s, Q);
    if ((p.x - p.threat.x) * q.tx * p.dir + (p.z - p.threat.z) * q.tz * p.dir < 0) p.dir = -p.dir;
  } else if (rand() < 0.5) p.dir = -p.dir;
}
function endSocial(p) {
  if (p.partner) { const o = p.partner; p.partner = null; if (o.partner === p) { o.partner = null; if (o.state === "chat") toWalk(o); } }
  if (p.leader && p.state !== "follow") p.leader = null;
}
function toWalk(p) {
  p.state = p.leader ? "follow" : "walk"; p.act = null; p.cross = null;
  p.phone.setEnabled(false);
  p.cool = rr(6, 22);
  if (p.char) p.replan = true;          // characters work out where they were going again
}

// Is pedestrian p inside the footprint of vehicle v (plus a small margin)?
function underVehicle(v, p) {
  const s = v.spec || { hw: 0.95, hd: 2.2 };
  const h = v.heading, q = v.mesh.position;
  const dx = p.x - q.x, dz = p.z - q.z;
  const fwd = dx * Math.sin(h) + dz * Math.cos(h), lat = dx * Math.cos(h) - dz * Math.sin(h);
  return Math.abs(fwd) < s.hd + 0.4 && Math.abs(lat) < s.hw + 0.45;
}
// Speeding car heading for p? → +1/-1 = which side of its path p is on.
function inCarPath(v, sp, p) {
  const s = v.spec || { hw: 0.95, hd: 2.2 };
  const h = v.heading + (sp < 0 ? Math.PI : 0), q = v.mesh.position;
  const dx = p.x - q.x, dz = p.z - q.z;
  const fwd = dx * Math.sin(h) + dz * Math.cos(h), lat = dx * Math.cos(h) - dz * Math.sin(h);
  const reach = s.hd + Math.min(16, Math.abs(sp) * 1.1);
  return fwd > 0 && fwd < reach && Math.abs(lat) < s.hw + 1.3 ? (lat >= 0 ? 1 : -1) : 0;
}

// ---------------------------------------------------------------- everyday activities
const ACTS = {
  look:    { t: [2, 5],   move: 0 },     // stop, look around
  call:    { t: [5, 12],  move: 0 },     // phone call, pacing slightly
  text:    { t: [5, 12],  move: 0.65 },  // text while walking, head down
  shop:    { t: [3, 7],   move: 0 },     // window-shopping
  shoe:    { t: [2.2, 3.2], move: 0 },   // tie a shoelace
  stretch: { t: [1.6, 2.4], move: 0 },
  watch:   { t: [1.2, 1.8], move: 0 },   // check the time
};
function pickActivity(p) {
  const P = p.persona;
  const r = rand();
  if (P.phoneAddict && r < 0.55) return rand() < 0.5 ? "text" : "call";
  if (r < 0.25) return "look";
  if (r < 0.4) return "shop";
  if (r < 0.52) return "call";
  if (r < 0.64) return "text";
  if (r < 0.74 && !P.elderly) return "shoe";
  if (r < 0.84) return "stretch";
  return "watch";
}

// ---------------------------------------------------------------- update
const CELL = 4;
const cells = new Map();
const ck = (x, z) => (Math.floor(x / CELL) + 4000) * 16384 + (Math.floor(z / CELL) + 4000);
let lastPX = null, lastPZ = 0, playerSpeed = 0;
let awayCheck = 0;

// ctx: { pos, vehicle, vehicleSpeed, traffic, armed, aimYaw }
const cellPool = [];
let frameNo = 0;
export function updatePeds(dtFrame, ctx) {
  const pos = ctx.pos;
  frameNo++;
  if (lastPX !== null && dtFrame > 0) playerSpeed += (Math.hypot(pos.x - lastPX, pos.z - lastPZ) / dtFrame - playerSpeed) * Math.min(1, dtFrame * 8);
  lastPX = pos.x; lastPZ = pos.z;
  const pAbove = pos.y - terrainH(pos.x, pos.z);   // player's height above the ground (hills)
  const onFoot = !ctx.vehicle && pAbove < 1.5;
  const aimX = Math.sin(ctx.aimYaw ?? 0), aimZ = Math.cos(ctx.aimYaw ?? 0);

  // spatial hash of standing / walking people (for personal space + chats)
  // (cell arrays are pooled: a fresh array per cell per frame was steady GC churn)
  for (const c of cells.values()) { c.length = 0; cellPool.push(c); }
  cells.clear();
  for (const p of peds) {
    if (p.state === "down" || p.state === "away" || p.dormant) continue;
    const k = ck(p.x, p.z);
    let c = cells.get(k);
    if (!c) { c = cellPool.pop() || []; cells.set(k, c); }
    c.push(p);
  }

  // night: most people go home (only when out of sight), back in the morning
  awayCheck -= dtFrame;
  const checkAway = awayCheck <= 0;
  if (checkAway) awayCheck = 0.5;

  for (const p of peds) {
    if (p.goon && p.state !== "down") {                 // mission gunmen: the mission moves them, we animate
      animate(p, dtFrame, 0);                           // (places the body at x / z / heading too)
      continue;
    }
    if (p.brawl && p.state !== "down") {                // in a fist fight: melee.js moves them
      p.state = "brawl";
      animate(p, dtFrame, 0);
      continue;
    }
    const far = Math.abs(p.x - pos.x) > 70 || Math.abs(p.z - pos.z) > 70;
    if (checkAway && !p.char) {
      if (p.state === "away") {
        if (!world.night && rand() < 0.08) {
          const e = pickEdge(p.home), s = rr(2, e.len - 2), q = pathAt(e, s, Q);
          if (Math.hypot(q.x - pos.x, q.z - pos.z) > 80) {
            p.e = e; p.s = s; p.side = 1; p.push = 0; p.root.setEnabled(true);
            toWalk(p); p.x = q.x; p.z = q.z; place(p, 0, true);
          }
        }
        continue;
      }
      if (world.night && !p.persona.nightOwl && far && rand() < 0.04 && ["walk", "act", "follow"].includes(p.state)) {
        endSocial(p);
        p.state = "away"; p.root.setEnabled(false); p.x = p.z = 1e6;
        continue;
      }
    }
    if (p.state === "away") continue;
    // far from the player: dormant (hidden, not updated) until you come near —
    // they're specks in the haze out there, and this keeps the crowds cheap.
    // Story characters always stay awake.
    const qd = Math.max(Math.abs(p.x - pos.x), Math.abs(p.z - pos.z));
    if (!p.char) {
      // a little hysteresis so people right at the edge don't flicker on/off
      const dormant = p.dormant ? qd > 140 : qd > 150;
      if (dormant !== !!p.dormant) { p.dormant = dormant; p.root.setEnabled(!dormant); p.acc = 0; }
      if (dormant) continue;
    }
    // Level of detail in time: people close to you update every frame; further
    // out every 2nd / 4th frame with the skipped time added up, so they still
    // walk at the right speed (at that distance the step is invisible). Each
    // ped has its own phase so the work is spread evenly over the frames.
    p.acc = (p.acc || 0) + dtFrame;
    if (!p.char && p.state !== "down" && qd > 40) {
      const every = qd > 85 ? 4 : 2;
      if ((frameNo + (p.slot ??= (rand() * 4) | 0)) % every) continue;
    }
    const dt = Math.min(p.acc, 0.2);
    p.acc = 0;
    if (p.far) {
      const lod = p.lod ? (qd > NEAR_LOD ? 1 : 0) : (qd > FAR_LOD ? 1 : 0);
      if (lod !== p.lod) setLod(p, lod);
    }

    // ---- knocked down
    if (p.state === "down") {
      p.timer -= dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      const k = Math.exp(-5 * dt); p.vx *= k; p.vz *= k;
      p.root.position.set(p.x, terrainH(p.x, p.z) + 0.1, p.z);
      p.root.rotation.x += (-Math.PI / 2 + 0.08 - p.root.rotation.x) * Math.min(1, dt * 10);
      p.root.rotation.y = p.heading;
      poseArms(p, dt, -0.4, -0.4, 1.2, 1.2);
      p.headPivot.rotation.set(0, 0, 0);
      if (p.dead) continue;                 // killed: stays where they fell
      if (p.timer <= 0) {
        p.root.rotation.x = 0;
        if (p.persona.brave > 0.75 && onFoot && Math.hypot(pos.x - p.x, pos.z - p.z) < 6) { p.state = "annoyed"; p.timer = rr(2, 3); }
        else startFlee(p, rr(4, 7));
      }
      continue;
    }

    p.timer -= dt;
    p.cool -= dt;
    const dx = pos.x - p.x, dz = pos.z - p.z;
    const d = Math.hypot(dx, dz);
    const near = d < 25;
    // walked right up to someone calm: they may say something (once per ~25 s each)
    if (onFoot && d < 2.6 && pedHooks.onNear && !["down", "flee", "cower", "surrender", "dodge", "talk", "away"].includes(p.state)) {
      const now = performance.now();
      if (!(p.talkAt > now)) { p.talkAt = now + 25000; pedHooks.onNear(p, d); }
    }

    // ---- run over by the player's vehicle
    if (ctx.vehicle && near && Math.abs(ctx.vehicleSpeed) > 3.5 && pAbove < 2 && underVehicle(ctx.vehicle, p)) {
      const h = ctx.vehicle.heading, sp = ctx.vehicleSpeed;
      knockDown(p, Math.sin(h) * sp * 0.6 - (dx / (d || 1)) * 3, Math.cos(h) * sp * 0.6 - (dz / (d || 1)) * 3);
      scare(p.x, p.z, 25);
      continue;
    }
    // ---- dive out of the way of a speeding car
    if (ctx.vehicle && near && Math.abs(ctx.vehicleSpeed) > 6 && !["dodge", "flee", "cower"].includes(p.state)) {
      const sd = inCarPath(ctx.vehicle, ctx.vehicleSpeed, p);
      if (sd) {
        endSocial(p);
        p.state = "dodge"; p.timer = 0.9; p.cross = null;
        // which way along the street's normal takes us away from the car's line?
        const nx = p.fz * p.side, nz = -p.fx * p.side;
        const h = ctx.vehicle.heading, rx = Math.cos(h) * sd, rz = -Math.sin(h) * sd;
        p.dodgeDir = nx * rx + nz * rz > 0 ? 1 : -1;
      }
    }
    // ---- a gun pointed at them
    if (ctx.armed && onFoot && d < 14 && !p.scripted && !["flee", "cower", "dodge", "surrender"].includes(p.state)) {
      const cosA = (-dx * aimX - dz * aimZ) / (d || 1);
      if (cosA > 0.93) {
        endSocial(p);
        p.cross = null; p.phone.setEnabled(false);
        if (p.char && pedHooks.onGun) pedHooks.onGun(p);
        if (p.persona.brave < 0.2 && d > 6) { p.threat = { x: pos.x, z: pos.z }; startFlee(p, rr(5, 8)); }
        else { p.state = "surrender"; p.timer = rr(1.5, 2.5); }
      }
    }

    switch (p.state) {
      case "surrender": {
        p.speed = 0;
        faceXZ(p, pos.x, pos.z, dt);
        if (ctx.armed && d < 16) {
          const cosA = (-dx * aimX - dz * aimZ) / (d || 1);
          if (cosA > 0.88) p.timer = Math.max(p.timer, 0.6);
        }
        if (p.timer <= 0) { p.threat = { x: pos.x, z: pos.z }; startFlee(p, rr(4, 7)); }
        break;
      }
      case "cower":
        p.speed = 0;
        if (p.timer <= 0) startFlee(p, rr(4, 7));
        break;
      case "flee":
        if (p.timer <= 0) { toWalk(p); p.threat = null; }
        break;
      case "watch":
        p.speed = 0;
        if (p.threat) faceXZ(p, p.threat.x, p.threat.z, dt, 4);
        if (p.timer <= 0) { toWalk(p); p.threat = null; }
        break;
      case "dodge":
        p.push = clamp(p.push + p.dodgeDir * dt * 7, -2.6, 2.6);
        if (p.timer <= 0) {
          if (p.persona.brave > 0.6) { p.state = "annoyed"; p.timer = rr(1.5, 2.5); }
          else { p.threat = { x: pos.x, z: pos.z }; startFlee(p, rr(3, 5)); }
        }
        break;
      case "annoyed":
        p.speed = 0;
        faceXZ(p, pos.x, pos.z, dt);
        if (p.timer <= 0) toWalk(p);
        break;
      case "wave":
        p.speed = 0;
        faceXZ(p, pos.x, pos.z, dt);
        if (p.timer <= 0) toWalk(p);
        break;
      case "chat": {
        p.speed = 0;
        const o = p.partner;
        if (!o || o.partner !== p) { toWalk(p); break; }
        faceXZ(p, o.x, o.z, dt, 4);
        if (p.timer <= 0) { endSocial(p); toWalk(p); }
        break;
      }
      case "act":
        if (p.timer <= 0) toWalk(p);
        break;
      case "work":                         // a character at their spot, doing their thing
        p.speed = 0;
        if (p.faceYaw !== undefined) turnTo(p, p.faceYaw, dt, 3);
        break;
      case "talk":                         // a character in conversation with the player
        p.speed = 0;
        faceXZ(p, pos.x, pos.z, dt, 5);
        break;
      case "follow": {
        const L = p.leader;
        if (!L || L.state === "away" || L.state === "down" || L.state === "flee") { p.leader = null; toWalk(p); break; }
        if (L.state === "walk" || L.state === "follow" || (L.state === "act" && ACTS[L.act].move > 0)) {
          // stay beside the leader, matching their street and direction
          if (p.e !== L.e) { p.e = L.e; p.s = L.s; }
          p.side = L.side; p.dir = L.dir;
          p.s += (L.s - p.s) * Math.min(1, dt * 3);
          p.speed = L.speed;
        } else {
          p.speed = 0;
          faceXZ(p, L.x, L.z, dt, 4);
        }
        break;
      }
    }

    // ---- calm states: notice the player, start activities / chats / crossings
    if (p.char && !p.scripted && (p.state === "walk" || p.state === "work") && onFoot && d < 0.9 && playerSpeed > 2.2 && p.cool <= 0) {
      p.cool = 4;
      if (pedHooks.onBarged) pedHooks.onBarged(p);
      p.prevState = p.state; p.state = "annoyed"; p.timer = rr(1.8, 2.8);
    }
    if (p.state === "walk" && near && !p.char) {
      if (onFoot && d < 0.9 && playerSpeed > 2.2) {
        // barged into
        if (p.persona.brave > 0.45) { p.state = "annoyed"; p.timer = rr(1.8, 2.8); }
        else p.push = clamp(p.push + (p.lat > 0.5 ? -1 : 1) * 0.6, -1.4, 1.4);
      } else if (onFoot && !ctx.armed && d > 2.5 && d < 6 && playerSpeed < 3 && p.cool <= 0 && p.persona.social > 0.8 && rand() < dt * 0.6) {
        p.state = "wave"; p.timer = rr(1.6, 2.4);
      }
    }
    if (p.state === "walk" && p.cool <= 0 && !p.persona.jogger && !p.char) {
      if (p.hasFollower) p.crossAt = undefined;
      if (p.crossAt !== undefined && crossable(p.e) && Math.abs(p.s - p.crossAt) < 1.5) {
        p.crossAt = undefined;
        p.state = "cross"; p.cross = { phase: "look", t: 0, timer: rr(1.2, 2) };
      } else if (rand() < dt * 0.05) {
        if (!p.hasFollower && crossable(p.e) && p.e.w <= 10 && rand() < 0.3 && p.s > 8 && p.s < p.e.len - 8) {
          p.state = "cross"; p.cross = { phase: "look", t: 0, timer: rr(1.2, 2) };
        } else {
          p.state = "act"; p.act = pickActivity(p);
          p.timer = rr(...ACTS[p.act].t);
          p.phone.setEnabled(p.act === "call" || p.act === "text");
          if (p.act === "shop") p.shopYaw = outward(p);
        }
      } else if (p.persona.social > 0.45) {
        // bump into someone you know?
        const c = cells.get(ck(p.x, p.z));
        if (c) for (const o of c) {
          if (o === p || o.state !== "walk" || o.cool > 0 || o.persona.social < 0.45 || o.leader === p || p.leader === o) continue;
          if (Math.hypot(o.x - p.x, o.z - p.z) > 2.4 || rand() > dt * 1.5) continue;
          const t = rr(6, 14);
          p.state = o.state = "chat"; p.partner = o; o.partner = p; p.timer = o.timer = t;
          p.cool = o.cool = 999;
          break;
        }
      }
    }

    // ---- movement
    let target = 0, offScale = 1, moveHeading = null;
    if (p.state === "walk") target = p.walk;
    else if (p.state === "follow") target = p.speed;
    else if (p.state === "act") target = p.walk * ACTS[p.act].move;
    else if (p.state === "flee") target = p.persona.elderly ? 2.2 : 3.6 + p.persona.brave * 0.6;   // a real sprint, ~3.6–4.2 m/s
    else if (p.state === "dodge") target = 0.6;

    // (something interrupted a crossing without ending it — a punch, a scare:
    // just carry on walking rather than reading a crossing that isn't there)
    if (p.state === "cross" && !p.cross) toWalk(p);
    if (p.state === "cross") {
      const C = p.cross;
      C.timer -= dt;
      const kerbLook = Math.sin(C.timer * 3.2) * 1.1;
      if (C.phase === "look") {
        target = 0; p.lookTarget = kerbLook;
        if (C.timer <= 0) C.phase = "wait";
      } else if (C.phase === "wait") {
        target = 0; p.lookTarget = kerbLook;
        let clear = !(ctx.vehicle && Math.abs(ctx.vehicleSpeed) > 1.5 && d < 18);
        if (clear && ctx.traffic) for (const t of ctx.traffic) {
          if (Math.abs(t.vx - p.x) < 18 && Math.abs(t.vz - p.z) < 18 && t.speed > 1.5) { clear = false; break; }
        }
        if (clear) { C.phase = "go"; C.len = 2 * (p.e.w / 2 + p.e.sw * p.lat); }
        else if (C.timer < -12) toWalk(p);                // gave up waiting
      } else {
        C.t = Math.min(1, C.t + (dt * p.walk * 1.15) / C.len);
        offScale = 1 - 2 * C.t;
        moveHeading = Math.atan2(-p.fz * p.side, p.fx * p.side);   // straight across
        p.lookTarget = 0;
        if (C.t >= 1) { p.side = -p.side; offScale = 1; toWalk(p); p.cool = rr(4, 12); }
      }
    }

    const acc = p.state === "flee" || p.state === "dodge" ? 6 : 3;
    p.speed += clamp(target - p.speed, -acc * dt, acc * dt);

    // personal space: step round people in front, slow behind slower ones
    if (p.speed > 0.3 && (p.state === "walk" || p.state === "act" || p.state === "flee")) {
      const c = cells.get(ck(p.x + p.fx * 1.2, p.z + p.fz * 1.2));
      if (c) for (const o of c) {
        if (o === p || o === p.leader || o.leader === p) continue;
        const ox = o.x - p.x, oz = o.z - p.z;
        const ahead = ox * p.fx + oz * p.fz;
        if (ahead <= 0 || ahead > 1.6) continue;
        const lat = ox * p.fz - oz * p.fx;
        if (Math.abs(lat) > 0.7) continue;
        p.push = clamp(p.push + (lat > 0 ? -1 : 1) * p.side * dt * 2.2, -1.4, 1.4);
        if (o.dir === p.dir && o.e === p.e && o.speed < p.speed) p.speed = Math.max(o.speed, p.speed - dt * 2);
      }
    }
    // side-step the player standing in the way
    if (!ctx.vehicle && d < 1.1 && pAbove < 1.5 && p.state !== "dodge") p.push = clamp(p.push + dt * 2.5 * (p.lat > 0.5 ? -1 : 1), -1.4, 1.4);
    else if (p.state !== "dodge") p.push *= Math.exp(-dt * 0.6);

    if (p.state !== "follow") advance(p, p.speed * dt);
    else p.s = clamp(p.s, 0, p.e.len);
    const pathH = place(p, dt, false, offScale);

    // facing
    if (moveHeading !== null) turnTo(p, moveHeading, dt);
    else if (p.state === "act" && p.act === "shop") turnTo(p, p.shopYaw, dt, 3);
    else if (p.state === "act" && p.act === "call") turnTo(p, pathH + Math.sin(p.timer * 0.7) * 1.2, dt, 1.5);
    else if (p.state === "cross") turnTo(p, Math.atan2(-p.fz * p.side, p.fx * p.side) + (p.cross.phase === "go" ? 0 : 0.6 * p.side), dt, 4);
    else if (!["surrender", "annoyed", "wave", "chat", "watch", "work", "talk"].includes(p.state) && !(p.state === "follow" && p.speed < 0.1)) turnTo(p, pathH, dt);

    // head: look at the player when they're close, otherwise glance around
    let look = 0, nod = 0;
    if (p.lookTarget !== undefined && p.state === "cross") look = p.lookTarget;
    else if (near && d < 9 && ["walk", "act", "follow", "chat"].includes(p.state)) {
      look = clamp(angDiff(Math.atan2(dx, dz), p.heading), -1.2, 1.2);
    } else if (p.state === "work" && d < 6 && !["sleep", "paint", "read", "busk"].includes(p.pose)) {
      look = clamp(angDiff(Math.atan2(dx, dz), p.heading), -1.1, 1.1);
    } else if (p.state === "work" && p.pose === "inspect") look = Math.sin(performance.now() / 1300 + p.phase) * 0.9;
    if (p.state === "work" && ["read", "paint", "phone", "sleep"].includes(p.pose)) nod = p.pose === "sleep" ? 0.7 : 0.35;
    if (p.state === "talk" && p.emotion === "sad") nod = 0.4; else if (p.state === "act" && p.act === "look") look = Math.sin(p.timer * 1.3) * 1.1;
    else if (p.state === "flee") look = Math.sin(p.phase * 0.25) * 0.5;
    if (p.state === "act" && (p.act === "text" || p.act === "watch")) nod = 0.45;
    if (p.state === "act" && p.act === "shoe") nod = 0.6;
    if (p.state === "chat") nod = Math.sin(p.phase * 0.5 + p.timer * 3) * 0.08;
    p.look += (look - p.look) * Math.min(1, dt * 5);
    p.nod += (nod - p.nod) * Math.min(1, dt * 5);

    animate(p, dt, d);
  }
}

function setLod(p, lod) {
  p.lod = lod;
  const near = !lod;
  p.body.setEnabled(near); p.headPivot.setEnabled(near);
  for (const a of p.arms) a.setEnabled(near);      // (the phone hangs off an arm)
  for (const l of p.legs) l.setEnabled(near);
  p.far.setEnabled(!near);
}

// ---------------------------------------------------------------- animation
// Arm targets: ax = forward raise (+ = forward/up, PI = straight up),
// az = outward spread. L/R = the ped's left/right arm.
function poseArms(p, dt, axL, axR, azL, azR, rate = 10) {
  const k = Math.min(1, dt * rate);
  p.ax[0] += (axL - p.ax[0]) * k; p.ax[1] += (axR - p.ax[1]) * k;
  p.az[0] += (azL - p.az[0]) * k; p.az[1] += (azR - p.az[1]) * k;
  p.arms[0].rotation.x = -p.ax[0]; p.arms[0].rotation.z = -p.az[0];
  p.arms[1].rotation.x = -p.ax[1]; p.arms[1].rotation.z = p.az[1];
}
function animate(p, dt, d) {
  const moving = p.speed > 0.15;
  p.phase += dt * (moving ? p.speed * 4.2 : 0);
  const run = p.speed > 2.2;
  const t = performance.now() / 1000;
  let legSw = moving ? Math.sin(p.phase) * (run ? 0.75 : 0.45) : 0;
  let crouch = 0, lean = run ? 0.12 : p.persona.elderly ? 0.1 : 0;
  const sw = Math.sin(p.phase) * (run ? 0.9 : 0.35);
  let L = [sw, -sw, 0.08, 0.08];                         // natural arm swing, opposite the legs
  if (run && !["flee"].includes(p.state)) L = [sw * 0.7 + 1.1, -sw * 0.7 + 1.1, 0.15, 0.15];   // jogger: bent arms

  switch (p.state) {
    case "surrender": L = [2.9, 2.9, 0.35, 0.35]; lean = -0.05; break;
    case "aim": L = [1.42, 1.58, -0.14, 0.06]; lean = moving ? 0.06 : -0.02; break;          // pistol up, two hands
    case "stagger": L = [0.7, 0.5, 0.6, 0.5]; lean = -0.28; legSw = 0; break;
    case "brawl":
      L = p.bArms || [1.25, 1.35, -0.25, -0.25];        // fists up
      lean = p.bLean || 0; crouch = p.bCrouch || 0;
      if (!moving) legSw = 0.22;                          // staggered fighting stance
      break;
    case "cower": L = [2.5, 2.5, -0.9, -0.9]; crouch = 0.45; lean = 0.35; legSw = 0; break;
    case "flee": L = [sw * 1.2 + 0.4, -sw * 1.2 + 0.4, 0.5 + Math.sin(t * 9) * 0.2, 0.5 + Math.cos(t * 9) * 0.2]; break;
    case "dodge": L = [1.8, 1.8, 0.8, 0.8]; lean = -0.25; break;
    case "annoyed": L = [0.1, 2.3 + Math.sin(t * 14) * 0.35, 0.05, -0.15]; break;
    case "wave": L = [0.05, 2.7, 0.05, 0.35 + Math.sin(t * 9) * 0.35]; break;
    case "watch": L = p.phone.isEnabled() ? [0.6, 1.55, -0.2, -0.25] : [0.2, 0.2, 0.1, 0.1]; break;
    case "chat": {
      const g = Math.sin(t * 2.3 + p.timer), h = Math.sin(t * 1.7 + p.timer * 1.3);
      L = [0.4 + Math.max(0, g) * 0.9, 0.4 + Math.max(0, h) * 0.9, 0.15, 0.2 + Math.max(0, -h) * 0.3];
      break;
    }
    case "cross":
      if (p.cross && p.cross.phase === "go" && p.speed < 0.2) { legSw = Math.sin(t * p.walk * 4.2) * 0.45; L = [legSw * 0.7, -legSw * 0.7, 0.08, 0.08]; }
      break;
    case "work": {
      // what a story character does at their spot
      const k = t + p.phase;
      switch (p.pose) {
        case "vendor": L = [0.6, 1.2 + Math.max(0, Math.sin(k * 1.3)) * 1.4, 0.1, 0.2 + Math.max(0, Math.sin(k * 1.3)) * 0.3]; break;
        case "lean": L = [1.0, 1.0, -0.75, -0.75]; break;                                   // arms folded
        case "phone": L = [0.15 + Math.sin(k * 1.4) * 0.25, 2.5, 0.1, -0.55]; break;
        case "eat": case "drink": { const up = Math.max(0, Math.sin(k * 0.9)) ** 3; L = [0.3, 0.9 + up * 1.4, 0.1, -0.2 - up * 0.3]; break; }
        case "read": L = [1.15, 1.15, -0.35, -0.35]; break;
        case "feed": L = [0.3, 0.9 + Math.max(0, Math.sin(k * 2.2)) * 0.8, 0.1, 0.25]; lean = 0.15; break;
        case "busk": L = [1.05, 0.65 + Math.sin(k * 11) * 0.12, -0.25, -0.35]; break;
        case "sweep": L = [0.85 + Math.sin(k * 3) * 0.35, 0.95 + Math.sin(k * 3) * 0.35, -0.15, -0.2]; lean = 0.18; break;
        case "serve": L = [0.2, 1.45, 0.1, -0.1]; break;
        case "smoke": { const up = Math.max(0, Math.sin(k * 0.7)) ** 4; L = [0.9, 0.5 + up * 1.8, -0.6, -0.15 - up * 0.4]; break; }
        case "paint": L = [0.9, 1.45 + Math.sin(k * 2.1) * 0.35, -0.2, 0.15 + Math.sin(k * 1.3) * 0.15]; break;
        case "inspect": L = [-0.45, -0.45, -0.12, -0.12]; break;                           // hands behind the back
        case "beg": L = [0.1, 1.2, 0.05, 0.1]; lean = 0.12; break;
        case "sleep": L = [0.8, 0.8, -0.5, -0.5]; crouch = 0.55; lean = 0.35; legSw = 0; break;
        case "stretch": L = [3.0, 3.0, 0.3, 0.3]; lean = -0.1; break;
        default: L = [0.05, 0.05, 0.08, 0.08];
      }
      break;
    }
    case "talk": {
      const g = Math.sin(t * 2.4 + p.phase), h = Math.sin(t * 1.9 + p.phase * 1.3);
      switch (p.emotion) {
        case "angry": L = [0.2, 2.2 + Math.sin(t * 12) * 0.3, 0.05, -0.15]; lean = 0.08; break;
        case "scared": L = [1.9, 1.9, 0.6, 0.6]; lean = -0.12; break;
        case "wary": L = [1.0, 1.0, -0.75, -0.75]; break;
        case "sad": L = [0.05, 0.05, 0.02, 0.02]; lean = 0.06; break;
        case "amused": L = [0.3 + Math.max(0, g) * 0.6, 0.3, 0.2, 0.2]; lean = Math.abs(Math.sin(t * 9)) * 0.06; break;
        case "happy": L = [0.4 + Math.max(0, g) * 0.8, 0.4 + Math.max(0, h) * 0.8, 0.2, 0.25]; break;
        default: L = [0.3 + Math.max(0, g) * 0.6, 0.3 + Math.max(0, h) * 0.5, 0.15, 0.2];
      }
      break;
    }
    case "act":
      switch (p.act) {
        case "call": L = [0.1 + Math.sin(t * 1.5) * 0.1, 2.5, 0.05, -0.55]; break;
        case "text": L = [1.2, 1.25, -0.3, -0.25]; break;
        case "shop": L = [0.05, 0.05, -0.15, -0.15]; break;
        case "shoe": L = [1.4, 1.5, 0.1, 0.1]; crouch = 0.55; lean = 0.6; legSw = 0; break;
        case "stretch": L = [3.0, 3.0, 0.3 + Math.sin(t * 2) * 0.1, 0.3]; lean = -0.12; break;
        case "watch": L = [1.4, 0.1, -0.6, 0.05]; break;
        case "look": L = [0.05, 0.05, 0.1, 0.1]; break;
      }
      break;
  }
  // a walking ped who stopped (follow / waiting) shouldn't swing
  if (!moving && ["walk", "follow", "cross"].includes(p.state) && !(p.state === "cross" && p.cross && p.cross.phase === "go")) L = [0.05, 0.05, 0.08, 0.08];

  // only bother with fine arm/head animation near the player
  if (d < 90) {
    poseArms(p, dt, ...L, p.state === "brawl" ? 26 : 10);   // punches are quick
    p.headPivot.rotation.y = p.look;
    p.headPivot.rotation.x = p.nod;
    if (p.state === "cower") p.headPivot.rotation.x = 0.5;
  }
  p.crouch += (crouch - p.crouch) * Math.min(1, dt * 8);
  const brawl = p.state === "brawl";
  p.lean += (lean - p.lean) * Math.min(1, dt * (brawl ? 16 : 6));
  if (p.crouch > 0.2) { p.legs[0].rotation.x = -1.3 * p.crouch / 0.55; p.legs[1].rotation.x = 0.5; }
  else { p.legs[0].rotation.x = legSw; p.legs[1].rotation.x = -legSw; }
  if (brawl && p.bKick) p.legs[1].rotation.x = -p.bKick;
  const bob = moving ? Math.abs(Math.cos(p.phase)) * (run ? 0.07 : 0.04) : 0;
  // (yOff: standing on something that isn't the ground — a boat's deck)
  p.root.position.set(p.x, (p.yOff ?? terrainH(p.x, p.z)) + bob - p.crouch * 0.6 + (brawl ? p.bLift || 0 : 0), p.z);
  p.root.rotation.y = p.heading + (brawl ? p.bTwist || 0 : 0);
  p.root.rotation.x = p.lean;
  if (brawl) p.root.rotation.z = p.bRoll || 0;
}
