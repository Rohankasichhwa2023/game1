// mission.js — the story: runs the missions in order and owns their UI
// (the mission card, banners, subtitles, choices, phone messages, the
// countdown, and the on-screen waypoint).
//
//   Mission 1  "The Golden Arch"   (arch.js)      Kathmandu → Saint-Clair → Midtown → London → home
//   Mission 2  "Midnight Bells"    (midnight.js)  begins with a phone call soon after Mission 1 ends
//
// Shared pieces: combat.js (gunmen) and roadcar.js (chase / hunter vehicles).
//
// Testing shortcut: add ?m=1.13 to the URL to jump to Mission 1 stage 13,
// ?m=2.5 for Mission 2 stage 5, ?m=reset to start the story over.
import { scene, camera, engine, canvas, clamp, terrainH } from "./engine.js";
import { storyHooks } from "./characters.js";
import { initCombat, updateGoons, trackPlayer, goons } from "./combat.js";
import { updateCars, shootables as carShootables } from "./roadcar.js";
import {
  initArch, updateArch, archDone, archChoices, archObjective, archCard, archShootables, archHitGoon, archRespawn, archOnRespawn,
  archTimeScale, archJump,
} from "./arch.js";
import {
  initMidnight, beginMidnight, updateMidnight, midnightStarted, midnightDone, midnightObjective, midnightCard, midnightHitGoon,
  midnightRespawn, midnightOnRespawn, midnightTimeScale, midnightJump,
} from "./midnight.js";
import * as sfx from "./sound.js";

let hud, banner, marker, phoneEl, timerEl;
let beginT = null;          // counting down to Mission 2's phone call
let jumped = false;

// ---------------------------------------------------------------- setup
// opts: { moorings, combat }
export function initMission(opts = {}) {
  injectUI();
  initCombat(opts.combat || {});
  // ?m=<mission>.<stage> — jump straight to a point in the story (for testing)
  const q = new URLSearchParams(location.search).get("m");
  if (q === "reset") {
    for (const k of ["babylon.mission.arch.v1", "babylon.mission.midnight.v1"]) try { localStorage.removeItem(k); } catch { /* ignore */ }
    archJump(0); midnightJump(0);
  } else if (q && /^[12]\.\d+$/.test(q)) {
    const [m, s] = q.split(".").map(Number);
    if (m === 1) { archJump(s); midnightJump(0); } else { archJump(22, { choice: "home", holloway: "jail" }); midnightJump(s); }
    jumped = true;
  }
  storyHooks.choices = (c) => archChoices(c);
  const ui = {
    banner: (t, sub, ms) => showBanner(t, sub, ms),
    subs: (lines, onDone) => playSubs(lines, onDone),
    clearSubs: () => clearSubs(),
    choice: (title, options, cb) => showChoice(title, options, cb),
    text: (from, msg, onDone) => showText(from, msg, onDone),
  };
  initArch({ ...ui, moorings: opts.moorings, onDone: () => { beginT = 25; } });
  initMidnight({ ...ui, onDone: () => {} });
  if (archDone() && !midnightStarted()) beginT = 12;
}
// Where to put the player when a ?m= jump starts the game (main.js asks).
export function missionJumpSpot() {
  if (!jumped) return null;
  return !archDone() ? archRespawn() : midnightRespawn();
}
// Big map open: the mission card, banner and waypoint get out of the way.
export function setMissionUIHidden(h) {
  mapOpen = h;
  for (const el of [hud, subsEl, banner, marker, phoneEl, timerEl]) if (el) el.style.visibility = h ? "hidden" : "";
}
const inM2 = () => archDone() && midnightStarted() && !midnightDone();
// Things a bullet can hit that aren't ordinary solids (boats, chase cars).
export function missionShootables() {
  const a = archDone() ? [] : archShootables();
  const b = carShootables();
  return a.length ? a.concat(b) : b;
}
// A mission gunman hit by a bullet / punch / kick. dmg in hits.
export function missionHitGoon(p, dmg, fx, fz, how = "bullet") {
  if (!archDone()) archHitGoon(p, dmg, fx, fz, how);
  else if (inM2()) midnightHitGoon(p, dmg, fx, fz, how);
}
// Where to get back up after going down (null = where you fell).
export const missionRespawn = () => (!archDone() ? archRespawn() : inM2() ? midnightRespawn() : null);
export function missionOnRespawn() {
  if (!archDone()) archOnRespawn();
  else if (inM2()) midnightOnRespawn();
}
// Slow motion for the big moments.
export const missionTimeScale = () => Math.min(archTimeScale(), midnightTimeScale());
// (someone was knocked down — the missions track their own people)
export function missionOnPedDown() {}

// ---------------------------------------------------------------- per frame
// ctx: { pos, vehicle, inside }
export function updateMission(dt, ctx) {
  trackPlayer(dt, ctx.pos);
  if (goons.length) updateGoons(dt, ctx);
  updateCars(dt, ctx);
  if (!archDone()) updateArch(dt, ctx);
  else if (!midnightStarted()) {
    if (beginT !== null && !ctx.inside) { beginT -= dt; if (beginT <= 0) { beginT = null; beginMidnight(); } }
  } else if (!midnightDone()) updateMidnight(dt, ctx);
  renderHud(ctx);
}

// Where the current objective is (for the maps and the on-screen marker).
export function missionObjective() {
  if (!archDone()) return archObjective();
  if (inM2()) return midnightObjective();
  return null;
}

// ---------------------------------------------------------------- UI
function injectUI() {
  const css = document.createElement("style");
  css.textContent = `
  #missionHud{position:fixed;top:92px;right:32px;width:310px;background:rgba(14,16,22,.82);color:#eee;border-left:4px solid #ffcf4a;
    padding:10px 14px 11px;border-radius:6px;font-family:"Segoe UI",system-ui,sans-serif;z-index:20;pointer-events:none}
  #missionHud .mt{font-size:11px;letter-spacing:2px;color:#ffcf4a;font-weight:700}
  #missionHud .mo{font-size:16px;font-weight:700;margin-top:3px}
  #missionHud .md{font-size:12.5px;opacity:.75;margin-top:3px;line-height:1.35}
  #missionHud .ms{font-size:12px;margin-top:6px;color:#ffcf4a}
  #missionHud.m2{border-left-color:#e0475a}
  #missionHud.m2 .mt,#missionHud.m2 .ms{color:#ff8a96}
  #missionBanner{position:fixed;top:24%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#fff;z-index:25;pointer-events:none;
    font-family:"Segoe UI",system-ui,sans-serif;opacity:0;transition:opacity .45s;text-shadow:0 2px 12px rgba(0,0,0,.7);max-width:80vw}
  #missionBanner.on{opacity:1}
  #missionBanner b{display:block;font-size:34px;font-weight:900;letter-spacing:3px;color:#ffcf4a}
  #missionBanner span{display:block;font-size:17px;margin-top:6px;opacity:.9}
  #missionMarker{position:fixed;transform:translate(-50%,-100%);color:#ffcf4a;font:700 13px "Segoe UI",system-ui,sans-serif;text-align:center;
    text-shadow:0 1px 4px #000;pointer-events:none;z-index:19;display:none}
  #missionMarker i{display:block;font-style:normal;font-size:22px;line-height:18px}
  #missionSubs{position:fixed;left:50%;bottom:118px;transform:translateX(-50%);max-width:780px;width:80%;text-align:center;z-index:24;pointer-events:none;
    font:600 19px/1.4 "Segoe UI",system-ui,sans-serif;color:#fff;text-shadow:0 2px 6px #000,0 0 2px #000;opacity:0;transition:opacity .2s;
    background:rgba(8,10,14,.55);border-radius:8px;padding:10px 18px 8px}
  #missionSubs .k,#missionPhone .k{display:block;margin-top:6px;font:600 12px "Segoe UI",system-ui,sans-serif;opacity:.75;letter-spacing:1px;text-shadow:none}
  #missionSubs .k kbd,#missionPhone .k kbd{display:inline-block;padding:0 6px;margin-right:5px;border-radius:4px;background:#eee;color:#222;font:700 11px/18px monospace}
  #missionPhone .k{color:#555;text-align:right}
  #missionSubs.on{opacity:1}
  #missionSubs b{color:#ffcf4a;font-weight:800;letter-spacing:1px;margin-right:8px}
  #missionChoice{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);background:rgba(12,14,20,.9);border-top:3px solid #ffcf4a;border-radius:6px;
    padding:14px 22px;z-index:26;font:15px "Segoe UI",system-ui,sans-serif;color:#eee;display:none;min-width:360px}
  #missionChoice .t{font-size:12px;letter-spacing:2px;color:#ffcf4a;font-weight:700;margin-bottom:8px}
  #missionChoice div.o{margin:5px 0}
  #missionChoice kbd{display:inline-block;min-width:20px;padding:0 6px;margin-right:8px;border-radius:4px;background:#eee;color:#222;font:700 13px/22px monospace;text-align:center}
  #missionPhone{position:fixed;right:32px;top:300px;width:280px;background:#f4f2ec;color:#1d1d1f;border-radius:16px;padding:10px 14px 12px;z-index:22;
    pointer-events:none;font-family:"Segoe UI",system-ui,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.45);opacity:0;transform:translateX(30px);
    transition:opacity .35s,transform .35s}
  #missionPhone.on{opacity:1;transform:none}
  #missionPhone .f{font-size:11px;font-weight:800;letter-spacing:1.5px;color:#8a1f2c;display:flex;justify-content:space-between}
  #missionPhone .f small{font-weight:600;color:#777;letter-spacing:0}
  #missionPhone .b{margin-top:6px;font-size:14.5px;line-height:1.38;background:#e4e1d8;border-radius:12px 12px 12px 3px;padding:8px 11px}
  #missionTimer{position:fixed;top:22px;left:50%;transform:translateX(-50%);z-index:21;pointer-events:none;text-align:center;display:none;
    font-family:"Segoe UI",system-ui,sans-serif;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.8)}
  #missionTimer small{display:block;font-size:11px;letter-spacing:3px;font-weight:700;color:#ffcf4a}
  #missionTimer b{display:block;font:800 40px/1.05 "Consolas","Courier New",monospace;letter-spacing:2px}
  #missionTimer.hot b{color:#ff4a4a}
  @media (max-width:640px){#missionHud{width:auto;left:16px;right:16px;top:auto;bottom:150px}#missionPhone{top:auto;bottom:260px;right:16px}}`;
  document.head.appendChild(css);
  const mk = (id) => { const e = document.createElement("div"); e.id = id; document.body.appendChild(e); return e; };
  hud = mk("missionHud"); banner = mk("missionBanner"); marker = mk("missionMarker");
  subsEl = mk("missionSubs"); choiceEl = mk("missionChoice"); phoneEl = mk("missionPhone"); timerEl = mk("missionTimer");
  window.addEventListener("keydown", (e) => {
    // C: on to the next line of dialogue / close the message
    if (e.code === "KeyC" && !e.repeat && !mapOpen && cur && cur !== BUSY && performance.now() - shownAt > 250) { nextLine(); return; }
    if (!choiceCb) return;
    const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
    if (n === undefined || n >= choiceN) return;
    const cb = choiceCb;
    choiceCb = null;
    choiceEl.style.display = "none";
    cb(n);
  });
}
// ---- dialogue: [{ who, text }] lines and phone messages, shown one at a
// time; each stays up until the player presses C. Everything queues, so
// nothing is ever cut off, and onDone runs once a batch has been read.
let subsEl, choiceEl, choiceCb = null, choiceN = 0, mapOpen = false;
const subQ = [];                 // [{ lines, onDone }]
const BUSY = {};
let cur = null, shownAt = 0;
function playSubs(lines, onDone) {
  subQ.push({ lines: lines.slice(), onDone });
  if (!cur) nextLine();
}
function nextLine() {
  phoneEl.classList.remove("on");
  for (;;) {
    const b = subQ[0];
    if (!b) { cur = null; subsEl.classList.remove("on"); return; }
    if (b.lines.length) { cur = b.lines.shift(); showLine(cur); return; }
    subQ.shift();
    if (b.onDone) { cur = BUSY; try { b.onDone(); } catch (err) { console.error(err); } }   // (may queue more lines — they show next)
  }
}
const KEY = `<span class="k"><kbd>C</kbd> continue</span>`;
function showLine(l) {
  shownAt = performance.now();
  if (l.phone) {
    sfx.phoneBuzz();
    subsEl.classList.remove("on");
    phoneEl.innerHTML = `<div class="f"><span>✉ ${l.who}</span><small>now</small></div><div class="b">${l.text}</div>${KEY}`;
    phoneEl.classList.add("on");
    return;
  }
  subsEl.innerHTML = (l.who ? `<b>${l.who}</b>${l.text}` : l.text) + KEY;
  subsEl.classList.add("on");
}
// a failed attempt: drop whatever was still waiting to be read
function clearSubs() {
  subQ.length = 0;
  cur = null;
  subsEl.classList.remove("on");
  phoneEl.classList.remove("on");
}
// ---- a decision: number keys pick
function showChoice(title, options, cb) {
  choiceEl.innerHTML = `<div class="t">${title}</div>` + options.map((o, i) => `<div class="o"><kbd>${i + 1}</kbd>${o}</div>`).join("");
  choiceEl.style.display = "block";
  choiceCb = cb;
  choiceN = options.length;
}
// ---- a message on your phone (in the same queue: it waits for C too)
function showText(from, msg, onDone) {
  playSubs([{ phone: true, who: from, text: msg }], onDone);
}
let bannerTimer = null;
function showBanner(title, sub = "", ms = 3200) {
  if (!banner) return;
  banner.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}`;
  banner.classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove("on"), ms);
}
let lastHtml = "", doneHideAt = 0, doneKey = "";
// DOM writes only when something actually changed (each write can force a re-layout)
const domCache = new WeakMap();
function setStyle(el, k, v) {
  let c = domCache.get(el);
  if (!c) domCache.set(el, (c = {}));
  if (c[k] !== v) { c[k] = v; if (k === "html") el.innerHTML = v; else if (k === "class") el.className = v; else el.style[k] = v; }
}
const V = BABYLON.Vector3, TMP = new V(0, 0, 0);
const fmt = (t) => { const s = Math.ceil(t); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function renderHud(ctx) {
  const obj = missionObjective();
  const dist = obj ? Math.round(Math.hypot(obj.x - ctx.pos.x, obj.z - ctx.pos.z)) : null;
  let card = null, m2 = false;
  if (!archDone()) card = archCard();
  else if (inM2()) { card = midnightCard(); m2 = true; }
  else if (midnightDone()) card = { name: "MISSION 2 — COMPLETE", title: "Midnight Bells", hint: "The story's over — for now. The four cities are yours.", done: true };
  else card = { name: "MISSION 1 — COMPLETE", title: "The Golden Arch", hint: "The arch is home. Enjoy the city... for now.", done: true };
  const html = `<div class="mt">${card.name}</div><div class="mo">${card.title}</div><div class="md">${card.hint}</div>` +
    (obj || card.extra ? `<div class="ms">${obj ? `${obj.label}` : ""}${card.extra ? (obj ? " · " : "") + card.extra : ""}</div>` : "");
  if (html !== lastHtml) { hud.innerHTML = html; lastHtml = html; }
  setStyle(hud, "class", m2 || midnightDone() ? "m2" : "");
  // the "complete" card fades after a while
  const key = card.done ? card.name : "";
  if (key !== doneKey) { doneKey = key; doneHideAt = key ? performance.now() + 15000 : 0; }
  setStyle(hud, "display", card.done && performance.now() > doneHideAt ? "none" : "block");
  // the countdown
  if (card.timer !== undefined && card.timer !== null) {
    setStyle(timerEl, "display", "block");
    setStyle(timerEl, "class", card.timer <= 30 ? "hot" : "");
    setStyle(timerEl, "html", `<small>MIDNIGHT IN</small><b>${fmt(card.timer)}</b>`);
  } else setStyle(timerEl, "display", "none");
  // on-screen waypoint over the objective
  // (no waypoint inside a house: interiors are built far off the map)
  if (!obj || dist < 4 || ctx.inside) { setStyle(marker, "display", "none"); return; }
  TMP.set(obj.x, obj.y !== undefined && obj.y !== null ? obj.y + 4.5 : terrainH(obj.x, obj.z) + (obj.target ? 2.6 : 6), obj.z);
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const s = V.Project(TMP, BABYLON.Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
  if (s.z < 0 || s.z > 1) { setStyle(marker, "display", "none"); return; }
  const x = clamp(s.x * canvas.clientWidth / w, 30, canvas.clientWidth - 30), y = clamp(s.y * canvas.clientHeight / h, 40, canvas.clientHeight - 20);
  setStyle(marker, "display", "block");
  setStyle(marker, "left", Math.round(x) + "px"); setStyle(marker, "top", Math.round(y) + "px");
  setStyle(marker, "html", `<i>▼</i>${obj.label} · ${dist} m`);
}
