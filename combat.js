// combat.js — the missions' gunmen (shared by Mission 1 and Mission 2).
//
// A gunman is a person with a pistol (people.js only animates them; all the
// moving, aiming and shooting happens here). They stand guard until they see
// you, then hold a ring of distance round you, sidestep, and fire in bursts
// when they have a line of fire. Some kinds hang back with rifles, heavies
// soak up bullets, bosses are tougher, and "passive" ones (a cowering
// businessman) don't shoot at all.
//
// A VIP (someone you're protecting) can be set: gunmen then sometimes aim at
// them instead of you.
import { terrainH, seaAt, query, pointIn } from "./engine.js";
import { specOf } from "./vehicles.js";
import { spawnGoon, removeGoon, knockDown } from "./people.js";

export let C = {};                // hooks from main.js (hurtPlayer, tracer, shotClear, explode, ...)
export const events = { alert: null, kill: null, vipHit: null };
export function initCombat(hooks) { C = hooks || {}; }

export const KINDS = {
  crew: { hp: 3, acc: 0.3, dmg: 8, speed: 2.6, ring: [11, 19], burst: [1, 3], cool: [1.1, 2.0], range: 48 },
  heavy: { hp: 8, acc: 0.26, dmg: 13, speed: 1.7, ring: [6, 11], burst: [3, 5], cool: [1.8, 2.6], range: 40, label: "Heavy",
    look: { shirt: "#3a2a22", sleeve: "#3a2a22", skin: "#8d5a3c", hair: "#111111", pants: "#1c1c1c", build: 1.5, bald: true } },
  rifle: { hp: 3, acc: 0.22, dmg: 11, speed: 1.6, ring: [24, 44], burst: [1, 1], cool: [1.7, 2.7], range: 95, label: "Rifleman",
    look: { shirt: "#2e3a2c", sleeve: "#2e3a2c", skin: "#c08462", hair: "#2a1d14", pants: "#262a24", build: 1.1 } },
  guard: { hp: 4, acc: 0.3, dmg: 9, speed: 2.4, ring: [10, 18], burst: [2, 3], cool: [1.2, 2.0], range: 50, label: "Guard",
    look: { shirt: "#15171c", sleeve: "#15171c", skin: "#e0b08c", hair: "#2a1d14", pants: "#15171c", build: 1.2 } },
  watch: { hp: 4, acc: 0.3, dmg: 9, speed: 2.7, ring: [9, 17], burst: [1, 3], cool: [1.0, 1.8], range: 50, label: "Gunman",
    look: { shirt: "#5a1a22", sleeve: "#2a1416", skin: "#a8724e", hair: "#111111", pants: "#24181a", build: 1.1 } },
  assassin: { hp: 3, acc: 0.32, dmg: 9, speed: 3.0, ring: [9, 16], burst: [1, 3], cool: [1.0, 1.7], range: 50, label: "Assassin",
    look: { shirt: "#22262e", sleeve: "#22262e", skin: "#c08462", hair: "#111111", pants: "#1a1c20", build: 1.1 } },
  rocco: { hp: 16, acc: 0.36, dmg: 11, speed: 3.0, ring: [8, 14], burst: [2, 4], cool: [0.9, 1.5], range: 50, label: "Rocco", boss: true,
    look: { shirt: "#e8e4da", sleeve: "#e8e4da", skin: "#e0b08c", hair: "#2a1d14", pants: "#d9d4c8", build: 1.3, beard: true } },
  vinnie: { hp: 14, acc: 0.34, dmg: 12, speed: 2.4, ring: [7, 13], burst: [3, 4], cool: [1.2, 1.8], range: 45, label: "Vinnie", boss: true,
    look: { shirt: "#2a2a2e", sleeve: "#2a2a2e", skin: "#e0b08c", hair: "#7a7a7a", pants: "#1d1d1d", build: 1.25 } },
  holloway: { hp: 2, passive: true, speed: 2.2, label: "Holloway",
    look: { shirt: "#5a6470", sleeve: "#5a6470", skin: "#e0b08c", hair: "#5a3a20", pants: "#3d4450", build: 1.1 } },
};

export let goons = [];       // { p, kind, K, hp, max, state, ... }
let triggered = false;
let lastPP = null, pSpeed = 0;
let vip = null;              // { p, hp, max }

// ---------------------------------------------------------------- spawning
// nearest free spot to (x, z) (not inside a house / crate, not in the sea)
export function blocked(x, z, y) {
  if (seaAt(x, z)) return true;
  for (const s of query(x - 0.4, x + 0.4, z - 0.4, z + 0.4)) {
    if (s.vehicle || s.off || s.maxY <= y + 0.45 || s.minY >= y + 1.7) continue;
    if (pointIn(s, x, y + 0.9, z, 0.35)) return true;
  }
  return false;
}
export function freeSpot(x, z) {
  if (!blocked(x, z, terrainH(x, z))) return [x, z];
  for (let r = 2; r <= 16; r += 2) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
    if (!blocked(nx, nz, terrainH(nx, nz))) return [nx, nz];
  }
  return [x, z];
}
// o: { heading, combat (already fighting), roam (how far from the spawn point), look, key, label }
export function addGoon(x0, z0, kind = "crew", o = {}) {
  const K = KINDS[kind];
  const [x, z] = o.exact ? [x0, z0] : freeSpot(x0, z0);
  const p = spawnGoon(x, z, { key: o.key || kind, look: o.look || K.look, heading: o.heading || 0 });
  if (K.passive) p.gun.setEnabled(false);
  const g = {
    p, kind, K, hp: K.hp, max: K.hp, state: o.combat ? "combat" : "idle", cool: 0.6 + Math.random(), burst: 0, burstT: 0,
    strafe: Math.random() < 0.5 ? -1 : 1, flipT: 1 + Math.random() * 2, react: o.combat ? 0.3 + Math.random() * 0.6 : 0,
    anchor: { x, z }, guardYaw: o.heading || 0, roam: o.roam ?? 30, label: o.label || K.label || "Gunman", stagger: 0,
  };
  goons.push(g);
  return g;
}
export function clearGoons(keepDead = false) {
  goons = goons.filter((g) => {
    if (keepDead && g.p.dead) return true;
    removeGoon(g.p);
    return false;
  });
  triggered = false;
}
// throw away the bodies (they pile up over a long mission)
export function clearDead() {
  goons = goons.filter((g) => { if (g.p.dead) { removeGoon(g.p); return false; } return true; });
}
export const alive = () => goons.filter((g) => !g.p.dead);
export const aliveOf = (kind) => goons.filter((g) => !g.p.dead && g.kind === kind);
export const hostiles = () => goons.filter((g) => !g.p.dead && !g.K.passive);
export function resetAlert() { triggered = false; }
export function setVip(v) { vip = v; }

// ---------------------------------------------------------------- brains
export function alertAll() {
  if (triggered) return;
  triggered = true;
  for (const g of goons) if (g.state === "idle") { g.state = "combat"; g.react = 0.3 + Math.random() * 0.9; }
  if (events.alert) events.alert();
}
// call every frame (keeps track of how fast you're moving: harder to hit)
export function trackPlayer(dt, me) {
  if (lastPP && dt > 0) pSpeed += (Math.hypot(me.x - lastPP.x, me.z - lastPP.z) / dt - pSpeed) * Math.min(1, dt * 6);
  lastPP = { x: me.x, y: me.y, z: me.z };
}
export const playerPos = () => lastPP;
export const playerSpeed = () => pSpeed;
const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
export { turn };

export function updateGoons(dt, ctx) {
  const me = ctx.pos, pv = C.playerVehicle ? C.playerVehicle() : null;
  const dead = C.playerDead ? C.playerDead() : false;
  for (const g of goons) {
    const p = g.p, K = g.K;
    if (p.dead) continue;
    // run over / blown up / knocked down by anything = dead
    if (p.state === "down") { kill(g, 0, 0); continue; }
    if (pv && pv.kind !== "boat" && Math.abs(pv.speed) > 5 && !g.yOff) {
      const q = pv.mesh.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) < specOf(pv).hd + 0.5) { kill(g, Math.sin(pv.heading) * pv.speed * 0.6, Math.cos(pv.heading) * pv.speed * 0.6); continue; }
    }
    if (g.hold) continue;                                 // scripted for now (the mission moves them)
    const dx = me.x - p.x, dz = me.z - p.z, d = Math.hypot(dx, dz) || 0.01;
    const y = g.yOff ?? terrainH(p.x, p.z);
    if (g.stagger > 0) {
      g.stagger -= dt;
      p.state = "stagger"; p.speed = 0;
      if (g.stagger <= 0) p.state = K.passive ? "cower" : "aim";
      continue;
    }
    if (K.passive) {
      // cowers behind his men; once they're gone he just stays down
      p.state = "cower"; p.speed = 0;
      p.heading = turn(p.heading, Math.atan2(dx, dz), dt * 3);
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
    if (fromA > g.roam) { mx += ((g.anchor.x - p.x) / fromA) * 1.5; mz += ((g.anchor.z - p.z) / fromA) * 1.5; }
    const ml = Math.hypot(mx, mz);
    let moved = 0;
    if (ml > 0.1 && !dead && !g.yOff) {
      // (a big step at low frame rates is split so nobody walks through a wall)
      const sp = K.speed * (d > r1 + 15 ? 1.4 : 1), step = sp * dt, n = Math.max(1, Math.ceil(step / 0.35));
      for (let i = 0; i < n; i++) {
        const nx = p.x + (mx / ml) * (step / n), nz = p.z + (mz / ml) * (step / n);
        if (!blocked(nx, nz, terrainH(nx, nz))) { p.x = nx; p.z = nz; moved = sp; }
        else { g.strafe = -g.strafe; g.flipT = 1.5; break; }
      }
    }
    p.speed = moved;
    // aim at whoever they're shooting at
    const tgt = g.atVip && vip && !vip.p.dead ? vip.p : null;
    const ax = tgt ? tgt.x - p.x : dx, az = tgt ? tgt.z - p.z : dz;
    p.heading = turn(p.heading, Math.atan2(ax, az), dt * 7);
    // shoot: bursts, when there's a line of fire
    if (dead) continue;
    if (g.burst > 0) {
      g.burstT -= dt;
      if (g.burstT <= 0) { g.burst--; g.burstT = 0.16; shoot(g, d, y); }
    } else {
      g.cool -= dt;
      if (g.cool <= 0) {
        g.cool = K.cool[0] + Math.random() * (K.cool[1] - K.cool[0]);
        // now and then they go for the VIP instead of you
        g.atVip = false;
        if (vip && !vip.p.dead && Math.random() < 0.35) {
          const vd = Math.hypot(vip.p.x - p.x, vip.p.z - p.z);
          const vy = terrainH(vip.p.x, vip.p.z);
          if (vd < 30 && (!C.shotClear || C.shotClear({ x: p.x, y: y + 1.5, z: p.z }, { x: vip.p.x, y: vy + 1.0, z: vip.p.z }))) g.atVip = true;
        }
        const from = { x: p.x, y: y + 1.5, z: p.z }, to = { x: me.x, y: me.y + 1.3, z: me.z };
        if (g.atVip || (d < K.range && (!C.shotClear || C.shotClear(from, to)))) {
          g.burst = K.burst[0] + Math.floor(Math.random() * (K.burst[1] - K.burst[0] + 1)); g.burstT = 0;
        }
      }
    }
  }
}
// One shot from gunman g: at you (likelier to hit up close, and when you're
// standing still on the ground — misses still crack past), or at the VIP.
function shoot(g, d, y) {
  const p = g.p, K = g.K, me = lastPP;
  if (!me) return;
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  const from = { x: p.x + fx * 0.6, y: y + 1.45, z: p.z + fz * 0.6 };
  if (C.spark) C.spark(new BABYLON.Vector3(from.x, from.y, from.z), 0.2, 0.05);
  if (C.shotSound) C.shotSound(p.x, p.z);
  if (g.atVip && vip && !vip.p.dead) {
    const v = vip.p, vy = terrainH(v.x, v.z), vd = Math.hypot(v.x - p.x, v.z - p.z);
    const hit = Math.random() < 0.28 * Math.max(0.2, 1 - vd / 35);
    const to = hit ? { x: v.x, y: vy + 0.9, z: v.z } : { x: v.x + (Math.random() - 0.5) * 3, y: vy + Math.random() * 2, z: v.z + (Math.random() - 0.5) * 3 };
    if (C.tracer) C.tracer(new BABYLON.Vector3(from.x, from.y, from.z), new BABYLON.Vector3(to.x, to.y, to.z));
    if (hit) { vip.hp--; if (events.vipHit) events.vipHit(vip); }
    return;
  }
  let chance = K.acc * Math.max(0.15, 1 - d / (K.range + 7));
  if (pSpeed > 6) chance *= 0.55;
  if (me.y - terrainH(me.x, me.z) > 2) chance *= 0.5;             // swinging / up high
  const hit = Math.random() < chance;
  const to = hit ? { x: me.x, y: me.y + 1.1 + Math.random() * 0.5, z: me.z }
    : { x: me.x + (Math.random() - 0.5) * 3.5, y: me.y + 0.2 + Math.random() * 2.2, z: me.z + (Math.random() - 0.5) * 3.5 };
  if (C.tracer) C.tracer(new BABYLON.Vector3(from.x, from.y, from.z), new BABYLON.Vector3(to.x, to.y, to.z));
  if (hit && C.hurtPlayer) C.hurtPlayer(K.dmg * (0.8 + Math.random() * 0.4), (me.x - p.x) / (d || 1), (me.z - p.z) / (d || 1));
}
// A gunman hit by you (bullets: 1, punches 1, kick 2). Returns false if p isn't one of ours.
export function hitGoon(p, dmg, fx, fz, how) {
  const g = goons.find((q) => q.p === p);
  if (!g) return false;
  if (p.dead) return true;
  if (g.state === "idle") alertAll();
  g.react = 0;
  if (g.invulnerable) { g.stagger = 0.3; return true; }
  g.hp -= dmg;
  if (how === "kick" || how === "punch") {
    g.stagger = how === "kick" ? 0.9 : 0.35;
    p.x += fx * (how === "kick" ? 1.4 : 0.5); p.z += fz * (how === "kick" ? 1.4 : 0.5);
  } else if (g.kind !== "heavy" && !g.K.boss) g.stagger = 0.18;
  if (g.hp <= 0) kill(g, fx * 5, fz * 5);
  return true;
}
export function kill(g, fx = 0, fz = 0) {
  const p = g.p;
  if (p.dead) return;
  if (p.state !== "down") knockDown(p, fx, fz);
  p.dead = true;
  p.speed = 0;
  if (events.kill) events.kill(g);
}
// the nearest gunman to you (for the objective marker)
export function nearestHostile(me) {
  let b = null, bd = Infinity;
  for (const g of goons) {
    if (g.p.dead || g.K.passive) continue;
    const d = Math.hypot(g.p.x - me.x, g.p.z - me.z);
    if (d < bd) { bd = d; b = g; }
  }
  return b;
}
export function enemyObjective(me) {
  const b = me && nearestHostile(me);
  return b ? { x: b.p.x, z: b.p.z, y: b.yOff, label: b.label, target: true } : null;
}
// "▓▓▓▓░░" bar for a boss's health
export function bossBar(kind) {
  const g = goons.find((q) => q.kind === kind && !q.p.dead);
  if (!g) return "";
  const n = Math.ceil((g.hp / g.max) * 8);
  return `${g.label} ${"█".repeat(n)}${"░".repeat(8 - n)}`;
}

// ---------------------------------------------------------------- a person the story moves (not a gunman)
// Unarmed extras (the nephew, the dealer, the old sailor): spawned like a
// gunman so people.js animates them, but we drive them.
export function spawnExtra(x, z, key, look, heading = 0) {
  const p = spawnGoon(x, z, { key, look, heading });
  p.gun.setEnabled(false);
  p.state = "cower";
  return p;
}
// Walk / run p toward (x, z) at speed sp; returns the distance left.
export function stepToward(p, x, z, sp, dt, state = "flee") {
  const dx = x - p.x, dz = z - p.z, dd = Math.hypot(dx, dz);
  if (dd < 0.3) { p.speed = 0; return dd; }
  p.state = state; p.speed = sp;
  p.heading = turn(p.heading, Math.atan2(dx, dz), dt * 8);
  const step = Math.min(dd, sp * dt), n = Math.max(1, Math.ceil(step / 0.35));
  for (let i = 0; i < n; i++) {
    const nx = p.x + (dx / dd) * (step / n), nz = p.z + (dz / dd) * (step / n);
    if (blocked(nx, nz, terrainH(nx, nz))) {
      // slide round whatever's in the way
      const sx = p.x + (-dz / dd) * (step / n), sz = p.z + (dx / dd) * (step / n);
      if (!blocked(sx, sz, terrainH(sx, sz))) { p.x = sx; p.z = sz; }
      break;
    }
    p.x = nx; p.z = nz;
  }
  return dd;
}
// Someone tagging along behind you: catches up (or just turns up) if you get
// far ahead; rides with you while you're in a vehicle (hidden).
export function follow(p, me, dt, inVehicle) {
  const dx = me.x - p.x, dz = me.z - p.z, dd = Math.hypot(dx, dz);
  if (inVehicle) return dd;
  if (dd > 45) {
    const a = Math.atan2(dx, dz), [x, z] = freeSpot(me.x - Math.sin(a) * 3, me.z - Math.cos(a) * 3);
    p.x = x; p.z = z; p.speed = 0;
    return 3;
  }
  const sp = dd > 8 ? 4.6 : dd > 3 ? 2 : 0;
  if (!sp) { p.speed = 0; p.state = "walk"; p.heading = turn(p.heading, Math.atan2(dx, dz), dt * 4); return dd; }
  stepToward(p, me.x, me.z, sp, dt, sp > 3 ? "flee" : "walk");
  return dd;
}
export { removeGoon };
