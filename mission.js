// mission.js — Mission 1: "The Holloway Job".
//
//   0  Get to London                    (you start in Saint-Clair)
//   1  Meet Grant Holloway              (the developer, at the garden square;
//                                        talk to him — he hires you)
//   2  Find Vinnie Sour in Midtown      (the loan shark Grant owes; he spots
//                                        you if you get close, and runs)
//   3  The chase                        (he picks escape routes away from you,
//                                        sprints in bursts and tires, so he's
//                                        catchable; lose him and he stops to
//                                        catch his breath. 3 bullets, or one hit
//                                        from a car / an explosion)
//   4  Done                             ($500 from Holloway)
//
// Progress is saved; once Vinnie is dead he stays out of the game.
import { scene, camera, engine, canvas, clamp } from "./engine.js";
import { districtAt, landmarks } from "./roads.js";
import { charById, storyHooks, speakAs, addCash, setGone } from "./characters.js";

const SAVE_KEY = "babylon.mission.v1";
let M = { stage: 0 };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); if (s) M = { ...M, ...s }; } catch { /* private mode */ }
if (M.stage === 3) M.stage = 2;                   // a chase doesn't survive a reload
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(M)); } catch { /* ignore */ } };

const GIVER = "grant", TARGET = "vinnie";
const STAGES = [
  { title: "Get to London", hint: "Head east, through Midtown, over to London." },
  { title: "Meet Grant Holloway", hint: "He's at the garden square in London. Walk up and press T to talk." },
  { title: "Find Vinnie Sour in Midtown", hint: "Flat cap, dark coat. Usually around Times plaza or Broadway." },
  { title: "Kill Vinnie Sour", hint: "He's running — chase him down." },
  { title: "Mission complete", hint: "Holloway paid up. The city is yours to explore." },
];
let hud, banner, marker, briefed = false;
let chase = null;            // { stamina, tired, hiding, lostT, hp }
let lastPos = null;

// ---------------------------------------------------------------- setup
export function initMission() {
  injectUI();
  storyHooks.choices = storyChoices;
  if (M.stage >= 4) { setGone(TARGET); }
  else setTimeout(() => showBanner(M.stage === 0 ? "MISSION 1 — THE HOLLOWAY JOB" : "MISSION 1 — RESUMED", STAGES[M.stage].title), 1200);
  applyStage();
}
function setStage(s, bannerText) {
  M.stage = s;
  persist();
  applyStage();
  showBanner(bannerText || STAGES[s].title, s < 4 ? STAGES[s].hint : "");
}
// keep the characters where the story needs them
function applyStage() {
  const g = charById(GIVER), v = charById(TARGET);
  if (g) g.forceSlot = M.stage <= 1 ? { spot: "square", pose: "inspect", doing: "waiting for someone at the garden square" } : null;
  if (v && M.stage < 4) v.forceSlot = M.stage >= 2 ? { spot: "times", pose: "lean", doing: "watching the plaza" } : null;
}

// ---------------------------------------------------------------- dialogue with Holloway
function storyChoices(c) {
  if (c.def.id !== GIVER) return [];
  if (M.stage <= 1) {
    if (!briefed) return [{
      label: "Mr. Holloway? You sent for me.",
      go: () => {
        briefed = true;
        speakAs(c, "You're the one. Good. Keep your voice down. Vinnie Sour — Midtown loan shark, flat cap, nice coat. " +
          "I borrowed from him to buy this city and now he's 'reminding' my family. I want him gone. Permanently. " +
          "He hangs around Times plaza. Do it and there's five hundred in it for you.", "wary", "Mr. Holloway? You sent for me.");
      },
    }];
    return [
      { label: "Consider it done.", go: () => { speakAs(c, "Don't call me. I'll know when it's done. Now go — Midtown.", "neutral", "Consider it done."); setTimeout(() => setStage(2, "NEW TARGET: VINNIE SOUR"), 1800); } },
      { label: "Five hundred? For a man's life?", go: () => speakAs(c, "For a loan shark's life. Market rate. Take it or walk.", "wary", "Five hundred? For a man's life?") },
    ];
  }
  if (M.stage < 4) return [{ label: "About Vinnie…", go: () => speakAs(c, "Why are you still standing here? Midtown. Go.", "angry", "About Vinnie…") }];
  return [{ label: "It's done.", go: () => speakAs(c, "I heard. ...Good. We never met.", "neutral", "It's done.") }];
}

// ---------------------------------------------------------------- the target goes down
// force = how hard they were hit (bullets ~3, cars / blasts much more)
export function missionOnPedDown(p, force) {
  if (M.stage < 2 || M.stage >= 4) return;
  const v = charById(TARGET);
  if (!v || v.p !== p) return;
  if (!chase) startChase(v);                       // shot before he even saw you
  chase.hp -= force > 6 ? 99 : 1;
  if (chase.hp <= 0) {
    p.dead = true; p.chooser = null; p.route = null;
    v.scripted = true; p.scripted = true;
    chase = null;
    addCash(500);
    M.stage = 4; persist(); applyStage();
    showBanner("MISSION COMPLETE", "Vinnie Sour is dead. Holloway wires you $500.");
  } else showBanner("HE'S HIT", `${chase.hp} more to finish him`, 1600);
}

// ---------------------------------------------------------------- the chase
function startChase(v) {
  const p = v.p;
  v.scripted = true; p.scripted = true;
  v.forceSlot = null;
  chase = { stamina: 6, tired: false, hiding: false, lostT: 0, hp: 3 };
  p.chooser = chooseEscape;
  if (p.state === "away") return;
  runAway(p);
  if (M.stage === 2) setStage(3, "HE'S SPOTTED YOU — CHASE HIM!");
}
function runAway(p) {
  if (!lastPos || p.state === "down") return;
  p.state = "walk"; p.route = null; p.roam = true;
  p.phone.setEnabled(false);
  // run along the street in the direction away from the player
  const q = pathAtCurrent(p);
  p.dir = (p.x - lastPos.x) * q.tx + (p.z - lastPos.z) * q.tz >= 0 ? 1 : -1;
}
function pathAtCurrent(p) {
  const e = p.e, i = Math.min(e.xs.length - 2, Math.max(0, e.cum.findIndex((c) => c > p.s) - 1));
  const tx = e.xs[i + 1] - e.xs[i], tz = e.zs[i + 1] - e.zs[i], l = Math.hypot(tx, tz) || 1;
  return { tx: tx / l, tz: tz / l };
}
// At a junction: take the street whose far end is furthest from the player,
// avoiding dead ends and anything that heads back toward them.
function chooseEscape(p, nd, opts) {
  if (!lastPos) return opts[0];
  let best = opts[0], bs = -Infinity;
  for (const e of opts) {
    const far = e.a === nd ? e.b : e.a;
    let s = Math.hypot(far.x - lastPos.x, far.z - lastPos.z) - Math.hypot(nd.x - lastPos.x, nd.z - lastPos.z);
    if (far.edges.length === 1) s -= 120;             // dead end = cornered
    s += Math.random() * 30;                          // not perfectly predictable
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}
function updateChase(dt, v, ctx) {
  const p = v.p;
  if (p.dead) return;
  if (p.state === "away") return;
  const d = Math.hypot(p.x - ctx.pos.x, p.z - ctx.pos.z);
  // don't let ordinary street reactions stop him running
  if (["annoyed", "surrender", "cower", "watch", "wave", "talk", "act", "chat"].includes(p.state) && !chase.hiding) runAway(p);
  // sprint in bursts, tire, recover — fast, but a determined player catches him
  if (!chase.tired) { chase.stamina -= dt; if (chase.stamina <= 0) chase.tired = true; }
  else { chase.stamina += dt * 0.8; if (chase.stamina >= 4.5) chase.tired = false; }
  p.walk = chase.hiding ? 1.2 : chase.tired ? 2.6 : 5.1;
  // lose him and he stops to catch his breath; get close again and he bolts
  if (!chase.hiding) {
    chase.lostT = d > 170 ? chase.lostT + dt : 0;
    if (chase.lostT > 6) {
      chase.hiding = true;
      p.state = "work"; p.pose = "lean"; p.route = null;
      showBanner("YOU LOST HIM", "He's catching his breath somewhere — check the map.", 2500);
    }
  } else if (d < 35) {
    chase.hiding = false; chase.stamina = 5; chase.tired = false;
    runAway(p);
    showBanner("THERE HE IS!", "", 1400);
  }
}

// ---------------------------------------------------------------- per frame
// ctx: { pos, vehicle }
export function updateMission(dt, ctx) {
  lastPos = ctx.pos;
  if (M.stage === 0 && districtAt(ctx.pos.x, ctx.pos.z) === "london") setStage(1);
  const v = charById(TARGET);
  if (M.stage === 2 && v && v.p.state !== "away" && !v.p.dead) {
    const d = Math.hypot(v.p.x - ctx.pos.x, v.p.z - ctx.pos.z);
    if (d < (ctx.vehicle ? 40 : 24)) startChase(v);
  }
  if (M.stage === 3 && v && chase) updateChase(dt, v, ctx);
  renderHud(ctx);
}

// Where the current objective is (for the maps and the on-screen marker).
export function missionObjective() {
  if (M.stage >= 4) return null;
  if (M.stage === 0) {
    const sq = (landmarks.londonSquares || [])[0];
    return sq ? { x: sq.x, z: sq.z, label: "London" } : null;
  }
  const c = charById(M.stage === 1 ? GIVER : TARGET);
  if (!c) return null;
  if (c.p.state === "away") {
    if (M.stage === 1) { const sq = (landmarks.londonSquares || [])[0]; return sq ? { x: sq.x, z: sq.z, label: "Holloway" } : null; }
    return { x: landmarks.times ? landmarks.times.x : 200, z: landmarks.times ? landmarks.times.z : -100, label: "Vinnie" };
  }
  return { x: c.p.x, z: c.p.z, label: M.stage === 1 ? "Holloway" : "Vinnie", target: M.stage >= 2 };
}

// ---------------------------------------------------------------- UI
function injectUI() {
  const css = document.createElement("style");
  css.textContent = `
  #missionHud{position:fixed;top:92px;right:32px;width:300px;background:rgba(14,16,22,.82);color:#eee;border-left:4px solid #ffcf4a;
    padding:10px 14px 11px;border-radius:6px;font-family:"Segoe UI",system-ui,sans-serif;z-index:20;pointer-events:none}
  #missionHud .mt{font-size:11px;letter-spacing:2px;color:#ffcf4a;font-weight:700}
  #missionHud .mo{font-size:16px;font-weight:700;margin-top:3px}
  #missionHud .md{font-size:12.5px;opacity:.75;margin-top:3px;line-height:1.35}
  #missionHud .ms{font-size:12px;margin-top:6px;color:#ffcf4a}
  #missionBanner{position:fixed;top:24%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#fff;z-index:25;pointer-events:none;
    font-family:"Segoe UI",system-ui,sans-serif;opacity:0;transition:opacity .45s;text-shadow:0 2px 12px rgba(0,0,0,.7)}
  #missionBanner.on{opacity:1}
  #missionBanner b{display:block;font-size:34px;font-weight:900;letter-spacing:3px;color:#ffcf4a}
  #missionBanner span{display:block;font-size:17px;margin-top:6px;opacity:.9}
  #missionMarker{position:fixed;transform:translate(-50%,-100%);color:#ffcf4a;font:700 13px "Segoe UI",system-ui,sans-serif;text-align:center;
    text-shadow:0 1px 4px #000;pointer-events:none;z-index:19;display:none}
  #missionMarker i{display:block;font-style:normal;font-size:22px;line-height:18px}
  @media (max-width:640px){#missionHud{width:auto;left:16px;right:16px;top:auto;bottom:150px}}`;
  document.head.appendChild(css);
  hud = document.createElement("div"); hud.id = "missionHud"; document.body.appendChild(hud);
  banner = document.createElement("div"); banner.id = "missionBanner"; document.body.appendChild(banner);
  marker = document.createElement("div"); marker.id = "missionMarker"; document.body.appendChild(marker);
}
let bannerTimer = null;
function showBanner(title, sub = "", ms = 3200) {
  if (!banner) return;
  banner.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}`;
  banner.classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove("on"), ms);
}
let lastHtml = "", doneHideAt = 0;
const V = BABYLON.Vector3, TMP = new V(0, 0, 0);
function renderHud(ctx) {
  const st = STAGES[Math.min(M.stage, 4)];
  const obj = missionObjective();
  const dist = obj ? Math.round(Math.hypot(obj.x - ctx.pos.x, obj.z - ctx.pos.z)) : null;
  let extra = "";
  if (M.stage === 3 && chase) extra = chase.hiding ? "He's stopped to catch his breath." : chase.tired ? "He's tiring — close in!" : "He's sprinting.";
  if (M.stage === 3 && chase) extra += ` &nbsp;·&nbsp; ${"●".repeat(Math.max(0, chase.hp))}${"○".repeat(3 - Math.max(0, chase.hp))}`;
  const html = M.stage >= 4
    ? `<div class="mt">MISSION 1 — COMPLETE</div><div class="mo">The Holloway Job</div><div class="md">${st.hint}</div>`
    : `<div class="mt">MISSION 1 — THE HOLLOWAY JOB</div><div class="mo">${st.title}</div><div class="md">${st.hint}</div>` +
      (dist !== null ? `<div class="ms">${obj.label} · ${dist} m${extra ? " · " + extra : ""}</div>` : "");
  if (html !== lastHtml) { hud.innerHTML = html; lastHtml = html; }
  if (M.stage >= 4 && !doneHideAt) doneHideAt = performance.now() + 15000;      // the "complete" card fades after a while
  hud.style.display = M.stage >= 4 && performance.now() > doneHideAt ? "none" : "block";
  // on-screen waypoint over the objective
  if (!obj || dist < 4) { marker.style.display = "none"; return; }
  TMP.set(obj.x, obj.target ? 2.6 : 6, obj.z);
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const s = V.Project(TMP, BABYLON.Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
  if (s.z < 0 || s.z > 1) { marker.style.display = "none"; return; }
  const x = clamp(s.x * canvas.clientWidth / w, 30, canvas.clientWidth - 30), y = clamp(s.y * canvas.clientHeight / h, 40, canvas.clientHeight - 20);
  marker.style.display = "block";
  marker.style.left = x + "px"; marker.style.top = y + "px";
  marker.innerHTML = `<i>▼</i>${obj.label} · ${dist} m`;
}
