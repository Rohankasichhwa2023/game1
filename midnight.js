// midnight.js — Mission 2: "Midnight Bells". Opens the night after the arch comes home.
//
//   0  (not started — begins soon after Mission 1 ends)
//   1  A call from Old Tom, the sailor: someone's coming for him tonight. London embankment.
//   2  Assassins — protect Tom
//   3  Get Tom to St. Agnes hospital in Midtown (hunters on the road)
//   4  Tom's story: the Northern Star, twelve years ago... and a letter signed "A Friend"
//   5  Midnight. The bells. Race to the London clock tower
//   6  Climb to the belfry and disarm the bomb before the clock strikes
//   7  "Wrong bells, dear." They've taken Tom — stop the grey van heading north
//   8  Get Tom back from the van crew
//   9  Tom wants to face her: take him to Palace Square
//  10  The last stand — her men, the temple bells ringing
//  11  Martha
//  12  Done (three endings)
//
// The twist: every text from "A Friend" in Mission 1 was hers.
import { hex, terrainH, makeAcc, litMat, addBox, addSolid, setXF, clearXF, makeXF, xfp } from "./engine.js";
import { landmarks } from "./roads.js";
import { addCash, setGone, setBack } from "./characters.js";
import { removeGoon, knockDown } from "./people.js";
import * as sfx from "./sound.js";
import {
  C, events, addGoon, clearGoons, hostiles, resetAlert, hitGoon, enemyObjective, spawnExtra, stepToward, freeSpot, follow, setVip,
  playerPos, turn,
} from "./combat.js";
import { spawnCar, removeCar, clearCars, fieldTo, nearestOnRoad, kerbSpot, roadPointAround, healthBar, cars } from "./roadcar.js";
import { archState } from "./arch.js";

const SAVE_KEY = "babylon.mission.midnight.v1";
let M = { stage: 0 };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); if (s) M = { ...M, ...s }; } catch { /* private mode */ }
const checkpoint = (s) => (s >= 1 && s <= 3 ? 1 : s >= 4 && s <= 6 ? 5 : s === 8 ? 7 : s === 10 ? 9 : s > 12 ? 12 : s);
{
  const s = checkpoint(M.stage);
  if (s === 5 && M.stage !== 5) M.timer = 240;
  M.stage = s;
}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(M)); } catch { /* ignore */ } };
// (testing: start at a given stage)
export function midnightJump(stage) { const s = checkpoint(stage); M = { stage: s, timer: s === 5 ? 240 : undefined }; persist(); }

const STAGES = [
  { title: "—", hint: "" },
  { title: "Get to Old Tom", hint: "The London embankment, by the river near the clock tower. He sounded terrified." },
  { title: "Protect Tom", hint: "Assassins. Keep them off him — he can't take many hits." },
  { title: "Get Tom to St. Agnes", hint: "The hospital in west Midtown. Grab a car — he'll climb in with you." },
  { title: "Tom's story", hint: "Listen." },
  { title: "Get to the clock tower", hint: "Midnight. The bells. The London clock tower — fast." },
  { title: "Disarm the bomb", hint: "It's up in the belfry. Web-zip up the tower (F for web, right-click the amber target) and stay by it." },
  { title: "Stop the grey van", hint: "They've taken Tom north, toward Kathmandu. Ram the van before it gets there." },
  { title: "Get Tom back", hint: "The van crew. Don't let them reach him." },
  { title: "Take Tom to Palace Square", hint: "He wants to face her. Kathmandu, Palace Square — he'll ride with you." },
  { title: "The last stand", hint: "Her men are everywhere. Keep Tom alive." },
  { title: "Martha", hint: "She's waiting by the palace steps." },
  { title: "Mission complete", hint: "" },
];
const DONE = 12;
export const midnightStarted = () => M.stage >= 1;
export const midnightDone = () => M.stage >= DONE;

let ui = { banner: () => {}, subs: () => {}, choice: () => {}, text: () => {}, clearSubs: () => {}, onDone: () => {} };
let embank = null, hospital = null, tower = null, square = null, vanStart = null;
let tom = null;            // { p, aboard, mode }
let martha = null;         // { p }
let sofia = null;          // the night nurse (a ped) at St. Agnes
let vip = null;            // { p, hp, max }
let van = null, escort = null, hunters = [], huntT = 0, huntWave = 0;
let pendingTime = null;
let progress = 0, defused = false, bellT = 0, wave2 = false, talkBusy = false, slowUntil = 0, failing = false, lastTick = -1;
const timers = [];
const later = (ms, fn) => { const id = setTimeout(() => { const i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); fn(); }, ms); timers.push(id); return id; };
const cancelTimers = () => { while (timers.length) clearTimeout(timers.pop()); };
const me = () => playerPos() || { x: 0, y: 0, z: 0 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const TOM_LOOK = { shirt: "#5b4a3c", sleeve: "#5b4a3c", skin: "#e0b08c", hair: "#cfcfcf", pants: "#3d3d3d", beard: true };
const MARTHA_LOOK = { shirt: "#a8232e", sleeve: "#c9a227", skin: "#a8724e", hair: "#1a1410", pants: "#5a1a22", longHair: true, build: 1.0 };
const SOFIA_LOOK = { shirt: "#3f8f8a", sleeve: "#3f8f8a", skin: "#c08462", hair: "#2a1d14", pants: "#3f8f8a", longHair: true, build: 1.0 };
const BELL_Y = 56;

// ---------------------------------------------------------------- setup
export function initMidnight(opts) {
  ui = opts;
  const L = landmarks;
  if (L.clockTower) {
    const t = L.clockTower;
    tower = { x: t.x, z: t.z, yaw: Math.atan2(t.nx, t.nz), base: terrainH(t.x, t.z) };
    embank = kerbSpot(t.x - t.tx * 70, t.z - t.tz * 70, 0.6);
    buildTowerLedges();
  }
  hospital = kerbSpot(-60, -150, 0.6);
  if (L.ktmDurbar) { const d = L.ktmDurbar; square = { ...d, xf: makeXF(d.x, d.z, d.yaw) }; }
  vanStart = nearestOnRoad(260, 520, (e) => e.district === "city" && e.len > 30) || nearestOnRoad(260, 520);
  applyWorld();
  if (M.stage >= 1 && M.stage < DONE) enterStage(M.stage, true);
}
// who's around afterwards, depending on how it ended
function applyWorld() {
  if (M.stage >= 1 && M.stage < DONE) { setGone("tom"); setGone("laxmi"); return; }
  if (M.stage >= DONE) {
    if (M.ending === "debt") setGone("tom"); else setBack("tom");
    if (M.ending === "mercy") setBack("laxmi"); else setGone("laxmi");
  }
}
// The clock tower gets a stone gallery halfway up and a walkable ledge round
// the clock stage, both web-zip targets — two zips from the street to the bells.
function buildTowerLedges() {
  const stone = makeAcc("towerGallery", litMat("towerGalleryM", hex("#bca677"), 0.05));
  const iron = makeAcc("towerRail", litMat("towerRailM", hex("#2a2c2e"), 0.3));
  const xf = makeXF(tower.x, tower.z, tower.yaw);
  setXF(xf);
  const G = 28;
  addBox(-6.4, G - 0.5, -6.4, 6.4, G, 6.4, stone);                            // the gallery floor
  addSolid(-6.4, G - 0.5, -6.4, 6.4, G, 6.4);
  for (const k of [-1, 1]) {                                                  // a low iron rail round it
    addBox(-6.4, G, k * 6.3 - 0.05, 6.4, G + 0.9, k * 6.3 + 0.05, iron);
    addBox(k * 6.3 - 0.05, G, -6.4, k * 6.3 + 0.05, G + 0.9, 6.4, iron);
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(sx * 6 - 0.35, G - 2.2, sz * 6 - 0.35, sx * 6 + 0.35, G - 0.5, sz * 6 + 0.35, stone);   // corbels
  addSolid(-5.9, 46, -5.9, 5.9, 54.2, 5.9);                                   // the clock stage is solid: its top is a ledge
  clearXF();
  if (C.flushAccs) C.flushAccs();
  if (C.roofs) {
    C.roofs.push({ xf, hw: 6.4, hd: 6.4, lhw: 5.6, lhd: 5.6, top: G + tower.base, mechs: [] });
    C.roofs.push({ xf, hw: 5.9, hd: 5.9, lhw: 5.2, lhd: 5.2, top: 54.2 + tower.base, mechs: [] });
  }
}

// ---------------------------------------------------------------- the start (called by mission.js)
export function beginMidnight() {
  if (M.stage >= 1) return;
  M.stage = 1; persist();
  applyWorld();
  if (C.setTime) C.setTime(21.6);
  const hol = archState().holloway === "jail" ? "Holloway's in a cell — they say he won't last the week." : "Holloway's dead.";
  sfx.phoneBuzz();
  ui.subs([
    { who: "", text: "(your phone rings — a number you don't know)", dur: 2.4 },
    { who: "TOM", text: "Hello? Is this... the one who brought the arch back? It's Tom. Old Tom. The sailor, from the embankment.", dur: 4 },
    { who: "TOM", text: "Somebody left a letter under my coat while I slept. It says they're coming for me. Tonight.", dur: 3.8 },
    { who: "TOM", text: `Rocco's dead. Vinnie's dead. ${hol} I'm the last one.`, dur: 3.6 },
    { who: "YOU", text: "The last one of what?", dur: 1.8 },
    { who: "TOM", text: "...Just come. Please. I'm by the river, near the clock tower.", dur: 3 },
  ], () => ui.banner("MISSION 2 · MIDNIGHT BELLS", STAGES[1].hint, 4600));
  enterStage(1, false);
}

function setStage(s, title, sub, ms = 3600) {
  M.stage = s;
  persist();
  enterStage(s, false);
  ui.banner(title || STAGES[s].title.toUpperCase(), sub ?? (s < DONE ? STAGES[s].hint : ""), ms);
}
function enterStage(s, loading) {
  events.alert = null;
  events.kill = null;
  events.vipHit = onVipHit;
  failing = false;
  talkBusy = false;
  if (loading) pendingTime = s >= 7 ? 0.2 : s >= 5 ? 23.75 : 21.6;     // (set on the first frame — the sky isn't built yet while loading)
  if (s === 1) { clearAllM(); spawnTom(embank, "waiting"); M.assassins = false; }
  if (s === 3) { setVipOn(false); huntT = 18; huntWave = 0; hunters = []; tom.mode = "follow"; }
  if (s === 5) {
    if (loading) clearAllM();
    if (M.timer === undefined || M.timer <= 0) M.timer = 240;
    if (loading) M.timer = Math.max(M.timer, 180);
    progress = 0; defused = false; M.towerGuns = false;
  }
  if (s === 7) { clearAllM(); spawnVan(); }
  if (s === 8) startVanFight();
  if (s === 9) {
    if (loading || !tom) { clearAllM(); const p = me(); spawnTom({ x: p.x + 2, z: p.z + 2, face: 0 }, "follow"); }
    tom.mode = "follow"; setVipOn(false);
  }
  if (s === 10) startLastStand();
  if (s === 11) { if (loading) { clearAllM(); spawnMartha(); const [x, z] = Q(-1, -5); spawnTom({ x, z, face: 0 }, "facing"); } }
}
function clearAllM() {
  clearGoons();
  clearCars();
  van = escort = null; hunters = [];
  if (tom) { removeGoon(tom.p); tom = null; }
  if (martha) { removeGoon(martha.p); martha = null; }
  if (sofia) { removeGoon(sofia); sofia = null; }
  setVipOn(false);
  resetAlert();
}
const Q = (lx, lz) => (square ? xfp(square.xf, lx, lz) : [0, 0]);

// ---------------------------------------------------------------- Tom
function spawnTom(at, mode) {
  if (tom) removeGoon(tom.p);
  const [x, z] = freeSpot(at.x, at.z);
  tom = { p: spawnExtra(x, z, "oldTom", TOM_LOOK, at.face || 0), aboard: false, mode };
}
function setVipOn(on) {
  if (on && tom) { vip = { p: tom.p, hp: 10, max: 10 }; setVip(vip); }
  else { vip = null; setVip(null); }
}
function onVipHit(v) {
  if (v.hp <= 0) tomDies();
  else if (v.hp <= 3) ui.banner("TOM'S BADLY HURT", "Protect him!", 1200);
  else ui.banner("TOM'S HIT", "", 900);
}
function tomDies() {
  if (failing || !tom) return;
  failing = true;
  const p = tom.p;
  if (p.state !== "down") knockDown(p, 0, 0);
  p.dead = true;
  setVipOn(false);
  cancelTimers();
  ui.clearSubs();
  ui.banner("TOM IS DEAD", "Try again.", 3600);
  const back = { 2: 1, 3: 3, 8: 8, 9: 9, 10: 10 }[M.stage] || M.stage;
  later(3800, () => {
    if (back === 3) { for (const c of cars.slice()) removeCar(c); hunters = []; const q = me(); spawnTom({ x: q.x + 2, z: q.z + 2 }, "follow"); }
    if (back === 9 && tom) { removeGoon(tom.p); tom = null; }
    setStage(back, STAGES[back].title.toUpperCase(), "Again.", 2600);
  });
}
// Tom's per-frame: follow, board / leave your vehicle, cower in a fight
function updateTom(dt, ctx) {
  if (!tom) return;
  const p = tom.p, pos = ctx.pos, inV = !!ctx.vehicle;
  if (p.dead) return;
  if (p.state === "down") { if (vip) tomDies(); return; }
  if (tom.mode === "waiting" || tom.mode === "cower") {
    p.state = "cower"; p.speed = 0;
    p.heading = turn(p.heading, Math.atan2(pos.x - p.x, pos.z - p.z), dt * 3);
    return;
  }
  if (tom.mode === "goto") {
    if (stepToward(p, tom.to[0], tom.to[1], 3.6, dt) < 0.6) tom.mode = tom.then || "cower";
    return;
  }
  if (tom.mode === "facing") {
    p.state = "walk"; p.speed = 0;
    const f = martha ? martha.p : pos;          // (Martha at the end; you, while he tells his story)
    p.heading = turn(p.heading, Math.atan2(f.x - p.x, f.z - p.z), dt * 3);
    return;
  }
  if (tom.mode === "follow") {
    // climbs in with you; gets out when you do
    if (inV && !tom.aboard && dist(pos, p) < 12) {
      tom.aboard = true; p.root.setEnabled(false); p.speed = 0;
      sfx.door();
    } else if (!inV && tom.aboard) unboard(pos);
    if (tom.aboard) { p.x = pos.x; p.z = pos.z; return; }
    follow(p, pos, dt, inV);
  }
}
function unboard(pos) {
  if (!tom || !tom.aboard) return;
  tom.aboard = false;
  const [x, z] = freeSpot(pos.x + 2.4, pos.z + 1.2);
  tom.p.x = x; tom.p.z = z;
  tom.p.root.setEnabled(true);
}
const tomWithYou = (pos) => tom && !tom.p.dead && (tom.aboard || dist(pos, tom.p) < 18);

// ---------------------------------------------------------------- stage 1-2: the embankment
function spawnAssassins() {
  M.assassins = true;
  const t = tom.p, pos = me();
  const ax = Math.sin(embank.yaw), az = Math.cos(embank.yaw);
  for (const [along, out] of [[-34, 0], [-28, 6], [32, 2], [38, -4], [0, 30], [6, -26]]) {
    const x = t.x + ax * along + Math.cos(embank.yaw) * out, z = t.z + az * along - Math.sin(embank.yaw) * out;
    addGoon(x, z, "assassin", { combat: true, roam: 45, heading: Math.atan2(pos.x - x, pos.z - z) });
  }
  setVipOn(true);
  tom.mode = "cower";
  ui.subs([
    { who: "TOM", text: "There! That's them — they've been circling for an hour!", dur: 2.6 },
    { who: "ASSASSIN", text: "The old man. Nobody else. ...Fine. Everybody else too.", dur: 2.8 },
  ]);
  setStage(2, "PROTECT TOM", "Assassins on both sides. Keep them off him.");
}

// ---------------------------------------------------------------- stage 3: the drive to St. Agnes
function updateEscort(dt, ctx) {
  const pos = ctx.pos;
  huntT -= dt;
  const live = hunters.filter((c) => c.state !== "wrecked").length;
  if (huntWave < 2 && huntT <= 0 && live === 0 && ctx.vehicle) {
    huntWave++; huntT = 40;
    for (const dd of huntWave === 1 ? [150, 190] : [160, 210]) {
      const at = roadPointAround(pos.x, pos.z, dd);
      if (at) hunters.push(spawnCar("suv", 0, 0, { at, mode: "chase", gunners: 2, hp: 8, top: 33, label: "Hunter", stopAt: 15 }));
    }
    ui.banner(huntWave === 1 ? "THEY'RE FOLLOWING YOU" : "MORE OF THEM", "Lose them, or wreck them. Tom's safe as long as he's in the car.", 2600);
  }
  if (hospital && Math.hypot(pos.x - hospital.x, pos.z - hospital.z) < 28 && tomWithYou(pos)) {
    for (const c of cars.slice()) if (c.state !== "wrecked") removeCar(c);
    hunters = [];
    setStage(4, "ST. AGNES", "", 1800);
    tellStory();
  }
}
function tellStory() {
  const pos = me();
  if (tom) { unboard(pos); tom.mode = "facing"; }
  // Sofia, the night nurse, comes out to meet him
  if (sofia) removeGoon(sofia);
  {
    const [x, z] = freeSpot(pos.x - 2.2, pos.z + 1.6);
    sofia = spawnExtra(x, z, "sofia", SOFIA_LOOK, Math.atan2(pos.x - x, pos.z - z));
    sofia.state = "walk"; sofia.speed = 0;
  }
  ui.subs([
    { who: "SOFIA", text: "Tom? What happened to you— get inside, quick, before somebody sees you.", dur: 3.2 },
    { who: "TOM", text: "Not yet. He needs to hear this first. ...He's earned it.", dur: 2.8 },
    { who: "TOM", text: "Twelve years ago I was first mate on a cargo ship. The Northern Star. Rocco was her captain.", dur: 3.8 },
    { who: "TOM", text: "The cargo was Holloway's. The money behind it was Vinnie's. We carried things nobody asked about.", dur: 3.8 },
    { who: "TOM", text: "One night — a storm off the point — a deckhand went over the side. Nineteen years old. Sam.", dur: 3.8 },
    { who: "TOM", text: "I threw him a line. Missed. I could hear him calling out in the dark...", dur: 3.4 },
    { who: "TOM", text: "Rocco said if we turned back, we'd lose the cargo. Holloway said keep going. Vinnie laughed.", dur: 3.8 },
    { who: "TOM", text: "And I... I went back to the wheelhouse. We all did. We just kept going.", dur: 3.4 },
    { who: "YOU", text: "Sam who, Tom?", dur: 1.8 },
    { who: "TOM", text: "Sam Bell. That's all I ever knew. A kid from the hills. ...And tonight, this was under my coat.", dur: 3.8 },
    { who: "LETTER", text: "\"Every one of them was on that deck, Tom. And so were you. Midnight. The bells. — A Friend\"", dur: 4.4 },
    { who: "YOU", text: "...\"A Friend.\"", dur: 2 },
    { who: "YOU", text: "Those texts. Every single one pointed me at the next man on that deck. Rocco. Vinnie. Holloway.", dur: 3.8 },
    { who: "TOM", text: "Then you've been doing somebody's killing for them, son. And I'm the last name on the list.", dur: 3.6 },
    { who: "SOFIA", text: "The bells — the clock tower in London strikes midnight. It's ten to twelve!", dur: 3 },
  ], () => {
    if (M.stage !== 4) return;
    if (C.setTime) C.setTime(23.75);
    M.timer = 240;
    setStage(5, "MIDNIGHT BELLS", "Get to the London clock tower before it strikes twelve. Tom stays here with Sofia.", 4600);
  });
}

// ---------------------------------------------------------------- stage 5-6: the clock tower
function spawnTowerGuns() {
  M.towerGuns = true;
  const t = tower;
  for (const [a, r, k] of [[0.3, 26, "rifle"], [1.9, 30, "rifle"], [3.4, 24, "crew"], [4.6, 34, "rifle"], [5.6, 20, "crew"]]) {
    const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
    addGoon(x, z, k, { combat: true, roam: 22 });
  }
}
function updateTower(dt, ctx) {
  const pos = ctx.pos;
  if (!tower) return;
  // countdown
  M.timer -= dt;
  const sec = Math.ceil(M.timer);
  if (sec !== lastTick && sec <= 30 && sec >= 0) { lastTick = sec; sfx.tick(sec <= 10); }
  const d = Math.hypot(pos.x - tower.x, pos.z - tower.z);
  if (M.stage === 5 && d < 110) {
    if (!M.towerGuns) spawnTowerGuns();
    setStage(6, "DISARM THE BOMB", STAGES[6].hint, 4200);
    ui.subs([{ who: "", text: "(up in the belfry, something is blinking red)", dur: 2.6 }]);
  }
  if (M.stage === 6) {
    const dy = pos.y - (tower.base + BELL_Y);
    const near = Math.hypot(d, dy) < 11 && pos.y > tower.base + 44;
    progress = near ? progress + dt : Math.max(0, progress - dt * 0.25);
    if (progress >= 6 && !defused) { defused = true; disarmed(); return; }
  }
  if (M.timer <= 0 && !defused) {
    // too late
    const at = new BABYLON.Vector3(tower.x, tower.base + BELL_Y, tower.z);
    if (C.explode) C.explode(at, 3);
    if (C.shake) C.shake(0.6);
    const d3 = Math.hypot(d, pos.y - at.y);
    if (d3 < 30 && C.hurtPlayer) C.hurtPlayer(999, 0, 0);
    ui.banner("TOO LATE", "The belfry is gone. ...Try again.", 4000);
    M.timer = 160; progress = 0;
    clearGoons(); M.towerGuns = false;
    M.stage = 5; persist();
  }
}
function disarmed() {
  M.timer = 0;
  if (C.setTime) C.setTime(0.0);
  slowUntil = performance.now() + 1800;
  ui.subs([
    { who: "", text: "(you pull the last wire. The timer dies at 00:00:03)", dur: 3 },
    { who: "", text: "(taped inside the casing, a note — neat, old-fashioned handwriting)", dur: 3 },
    { who: "NOTE", text: "\"Wrong bells, dear. Mine are older.\"", dur: 3.4 },
  ], () => {
    sfx.phoneBuzz();
    ui.subs([
      { who: "SOFIA", text: "(on the phone, crying) They took him! Three men, a grey van — they hit me, they just TOOK him!", dur: 4 },
      { who: "SOFIA", text: "Kenji saw the van at the north end of Midtown — stopped, like they're waiting for someone. Go!", dur: 3.8 },
      { who: "YOU", text: "\"Dear.\" ...\"Mine are older.\"", dur: 2.6 },
    ], () => setStage(7, "THE GREY VAN", "North Midtown, heading for Kathmandu. Stop it.", 4200));
  });
  ui.banner("BOMB DISARMED", "", 2400);
  // midnight: the bells ring out over London
  for (let i = 0; i < 12; i++) later(800 + i * 2300, () => { if (C.bellAt && tower) C.bellAt(tower.x, tower.z); });
}

// ---------------------------------------------------------------- stage 7-8: the van
function spawnVan() {
  if (!vanStart) return;
  van = spawnCar("van", 0, 0, { at: vanStart, mode: "parked", hp: 16, top: 25, label: "Grey van", explodes: false, lane: vanStart.e.w / 2 - 1.3 });
  van.onShotParked = () => vanGo();
}
function vanGo() {
  if (!van || van.state !== "parked") return;
  van.lane = null; van.mode = "goal"; van.state = "drive"; van.rubber = true; van.gunners = 1;
  van.goal = square ? fieldTo(square.x, square.z) : null;
  van.next = null;
  van.onDisabled = () => setStage(8, "THE VAN'S DONE", "Get Tom back.");
  van.onArrive = () => vanFailed("THE VAN GOT THROUGH", "They've taken Tom into the square. ...Try again.");
  van.onEscape = () => vanFailed("YOU LOST THE VAN", "Try again.");
  const at = { e: van.e, s: Math.max(1, Math.min(van.e.len - 1, van.s - van.dir * 14)) };
  escort = spawnCar("suv", 0, 0, { at, mode: "chase", gunners: 2, hp: 8, top: 32, label: "Escort", stopAt: 15 });
  ui.subs([{ who: "VAN DRIVER", text: "(over the radio) He's here. Go, go! Straight to the square — she's waiting!", dur: 3.2 }]);
  ui.banner("THE VAN'S MOVING", "Ram it until it stops.", 2400);
}
function vanFailed(title, sub) {
  cancelTimers();
  ui.clearSubs();
  setStage(7, title, sub, 4200);
}
function startVanFight() {
  const p = van ? van.v.mesh.position : me(), h = van ? van.v.heading : 0;
  const sx = Math.cos(h), sz = -Math.sin(h), fx = Math.sin(h), fz = Math.cos(h);
  clearGoons();
  for (const [a, s, k] of [[2, 3, "watch"], [2, -3, "watch"], [-4, 3, "heavy"], [6, -2, "watch"]]) addGoon(p.x + fx * a + sx * s, p.z + fz * a + sz * s, k, { combat: true, roam: 30 });
  spawnTom({ x: p.x - fx * 4.5, z: p.z - fz * 4.5 }, "cower");
  setVipOn(true);
}

// ---------------------------------------------------------------- stage 10-11: Palace Square
function spawnMartha() {
  if (martha) removeGoon(martha.p);
  const [x, z] = Q(-1, 2.6);
  martha = { p: spawnExtra(x, z, "martha", MARTHA_LOOK, square ? square.yaw + Math.PI : 0), mode: "wait" };
  martha.p.state = "walk"; martha.p.speed = 0;
}
function startLastStand() {
  const pos = me();
  clearGoons();
  for (const c of cars.slice()) if (c.state !== "wrecked") removeCar(c);
  if (!tom || tom.p.dead) spawnTom({ x: pos.x + 2, z: pos.z + 2 }, "follow");
  unboard(pos);
  const [hx, hz] = Q(-24, -24);
  tom.mode = "goto"; tom.to = freeSpot(hx, hz); tom.then = "cower";
  setVipOn(true);
  spawnMartha();
  wave2 = false;
  for (const [lx, lz, k] of [[-14, -6, "watch"], [12, -4, "watch"], [-24, -2, "watch"], [24, -12, "watch"], [3, -14, "watch"], [-8, -18, "heavy"], [-30, 0, "rifle"], [30, 2, "rifle"]]) {
    const [x, z] = Q(lx, lz);
    addGoon(x, z, k, { combat: true, roam: 30 });
  }
  bellT = 1;
  ui.subs([
    { who: "", text: "(the temple bells are ringing. At this hour. Every one of them.)", dur: 3 },
    { who: "MARTHA", text: "(from the palace steps) You brought him. Thank you, dear. ...Now stand aside.", dur: 3.4 },
  ]);
}
function updateLastStand(dt, ctx) {
  bellT -= dt;
  if (bellT <= 0) { bellT = 6.5; if (C.bellAt && square) C.bellAt(square.x, square.z); }
  if (martha) { martha.p.state = "walk"; martha.p.speed = 0; martha.p.heading = turn(martha.p.heading, Math.atan2(ctx.pos.x - martha.p.x, ctx.pos.z - martha.p.z), dt * 2); }
  const n = hostiles().length;
  if (!wave2 && n <= 2) {
    wave2 = true;
    for (const [lx, lz, k] of [[-10, -40, "watch"], [8, -42, "watch"], [0, -48, "heavy"], [-20, -36, "watch"], [18, -38, "heavy"]]) {
      const [x, z] = Q(lx, lz);
      addGoon(x, z, k, { combat: true, roam: 40 });
    }
    ui.banner("MORE OF THEM", "From the street — behind you!", 2400);
  }
  if (wave2 && n === 0) {
    setVipOn(false);
    const [x, z] = Q(-1, -5);
    tom.mode = "goto"; tom.to = [x, z]; tom.then = "facing";
    setStage(11, "SHE'S WAITING", "Go to Martha.", 3200);
  }
}
function finale() {
  if (talkBusy) return;
  talkBusy = true;
  const home = archState().choice === "home";
  martha.mode = "talk";
  ui.subs([
    { who: "MARTHA", text: "You came. Of course you came. You always come, dear — that's what I like about you.", dur: 3.6 },
    { who: "MARTHA", text: "Twelve years I swept these steps and read his letters to the goddess. The same letters. Over and over.", dur: 4 },
    { who: "MARTHA", text: "Then one day I understood. The gods don't keep accounts. Mothers do.", dur: 3.4 },
    { who: "YOU", text: "The texts. \"A Friend.\" It was you. The whole time.", dur: 2.8 },
    { who: "MARTHA", text: "Rocco. Vinnie. Holloway. Every man who stood on that deck and watched my Sam drown. You found them all for me.", dur: 4.4 },
    { who: "MARTHA", text: "I couldn't have done it myself. Look at me — an old woman with a broom. But you... you never stop.", dur: 3.8 },
    { who: "YOU", text: "And the arch? Danny?", dur: 2 },
    home
      ? { who: "MARTHA", text: "Danny carried the arch to Rocco because I asked him to. He cried the whole night. His \"betrayal\" at the shed — I wrote every word of it.", dur: 4.8 }
      : { who: "MARTHA", text: "Danny carried the arch to Rocco because I asked him to. His \"betrayal\" at the shed — I wrote every word. You let him run; he's waiting for me in the hills.", dur: 4.8 },
    { who: "MARTHA", text: "I stole my own god to bait the men who killed my son. ...And it worked.", dur: 3.4 },
    { who: "TOM", text: "Martha... I threw him the line. I swear to you, I threw him the line.", dur: 3.2 },
    { who: "MARTHA", text: "And then you went back to the wheelhouse. Twelve years, Tom. Twelve years I've had to imagine that.", dur: 4 },
    { who: "MARTHA", text: "(she raises a pistol at Tom) Step aside, dear. He's the last one. Then the account is closed.", dur: 3.8 },
  ], () => {
    if (martha) { martha.mode = "aim"; martha.p.gun.setEnabled(true); }
    ui.choice("MARTHA HAS A GUN ON TOM", [
      "\"Put it down, Martha. Sam wouldn't want this.\"",
      "Shoot her before she shoots him.",
      "Step aside. \"...He's yours.\"",
    ], (i) => ending(["mercy", "justice", "debt"][i]));
  });
}
function ending(kind) {
  M.ending = kind;
  const V = BABYLON.Vector3;
  const mp = martha && martha.p, tp = tom && tom.p, pos = me();
  const shot = (from, p) => {
    sfx.gunshot();
    if (C.tracer) C.tracer(new V(from.x, terrainH(from.x, from.z) + 1.45, from.z), new V(p.x, terrainH(p.x, p.z) + 1.1, p.z));
    knockDown(p, (p.x - from.x) * 0.3, (p.z - from.z) * 0.3);
    p.dead = true;
  };
  let title = "", lines = [];
  if (kind === "mercy") {
    title = "MERCY";
    lines = [
      { who: "MARTHA", text: "...You don't know what Sam would want. You never even met him.", dur: 3.2 },
      { who: "MARTHA", text: "(a long silence. The pistol shakes.) ...He'd have hated this. He'd have hated me.", dur: 3.8 },
      { who: "TOM", text: "(on his knees) I'm sorry, Martha. I've been sorry every single night for twelve years.", dur: 3.6 },
      { who: "MARTHA", text: "I know, Tom. ...I know. Go home.", dur: 2.6 },
      { who: "MARTHA", text: "And you, dear. Go. Before I change my mind about the both of you.", dur: 3.2 },
    ];
    if (martha) { martha.mode = "kneel"; mp.gun.setEnabled(false); }
    if (tom) tom.mode = "cower";
  } else if (kind === "justice") {
    title = "JUSTICE";
    slowUntil = performance.now() + 2200;
    if (mp) shot(pos, mp);
    if (martha) martha.mode = "dead";
    lines = [
      { who: "", text: "(one shot. The bells stop.)", dur: 2.4 },
      { who: "TOM", text: "...She was right about us. Every word of it. You know that?", dur: 3.2 },
      { who: "YOU", text: "Maybe. But it ends here. With her.", dur: 2.6 },
    ];
  } else {
    title = "THE DEBT";
    slowUntil = performance.now() + 2200;
    later(1600, () => { if (mp && tp) shot(mp, tp); });
    lines = [
      { who: "MARTHA", text: "Thank you, dear.", dur: 2.2 },
      { who: "", text: "(one shot)", dur: 1.6 },
      { who: "MARTHA", text: "...Twelve years. It doesn't feel the way I thought it would.", dur: 3.2 },
      { who: "MARTHA", text: "Goodbye, dear. Don't come to the square any more.", dur: 3 },
    ];
    if (martha) { martha.mode = "leave"; }
    if (tom) tom.mode = "dead";
  }
  ui.subs(lines, () => {
    addCash(10000);
    M.stage = DONE; persist();
    const s = cars.slice(); for (const c of s) removeCar(c);
    ui.banner("MISSION 2 COMPLETE", `+$10000 · Ending: ${title}`, 6000);
    const wrapUp = () => {
      clearGoons();
      if (tom) { removeGoon(tom.p); tom = null; }
      if (martha) { removeGoon(martha.p); martha = null; }
      if (sofia) { removeGoon(sofia); sofia = null; }
      applyWorld();
      if (ui.onDone) ui.onDone();
    };
    later(5000, () => {
      if (kind === "mercy") ui.text("UNKNOWN NUMBER", "The account is closed. Thank you for stopping me. — M", wrapUp);
      else if (kind === "debt") ui.text("UNKNOWN NUMBER", "Paid in full. — A Friend", wrapUp);
      else ui.text("SOFIA", "Tom's here. He hasn't said a word since he walked in. ...Thank you.", wrapUp);
    });
  });
}
function updateMartha(dt, ctx) {
  if (!martha) return;
  const p = martha.p, pos = ctx.pos;
  if (martha.mode === "wait" || martha.mode === "talk") {
    p.state = "walk"; p.speed = 0;
    p.heading = turn(p.heading, Math.atan2(pos.x - p.x, pos.z - p.z), dt * 2);
    if (M.stage === 11 && martha.mode === "wait" && dist(pos, p) < 8) finale();
  } else if (martha.mode === "aim" && tom) {
    p.state = "aim"; p.speed = 0;
    p.heading = turn(p.heading, Math.atan2(tom.p.x - p.x, tom.p.z - p.z), dt * 4);
  } else if (martha.mode === "kneel") {
    p.state = "cower"; p.speed = 0;
  } else if (martha.mode === "leave") {
    const [x, z] = Q(-1, 5.5);
    p.gun.setEnabled(false);
    if (stepToward(p, x, z, 1.1, dt, "walk") < 0.8) { removeGoon(p); martha = null; }
  }
}

// ---------------------------------------------------------------- per frame
export function updateMidnight(dt, ctx) {
  const s = M.stage;
  if (s < 1 || s >= DONE) return;
  if (pendingTime !== null && C.setTime) { C.setTime(pendingTime); pendingTime = null; }
  const pos = ctx.pos;
  updateTom(dt, ctx);
  updateMartha(dt, ctx);
  if (s === 1 && tom && !M.assassins && dist(pos, tom.p) < 55) spawnAssassins();
  if (s === 2 && !hostiles().length && !failing) {
    setVipOn(false);
    ui.subs([
      { who: "TOM", text: "They — they're gone? ...God. Thank you. Thank you.", dur: 2.6 },
      { who: "TOM", text: "I can't stay here. St. Agnes — the hospital in Midtown. The night nurse, Sofia, she'll hide me.", dur: 3.8 },
      { who: "TOM", text: "Get a car. I'll get in with you. And drive like they're behind us — because they will be.", dur: 3.4 },
    ]);
    setStage(3, "GET TOM TO ST. AGNES", STAGES[3].hint);
  }
  if (s === 3) updateEscort(dt, ctx);
  if (s === 5 || s === 6) {
    updateTower(dt, ctx);
    // Tom stays behind at the hospital
    if (tom && !tom.aboard && dist(pos, tom.p) > 140) { removeGoon(tom.p); tom = null; }
    if (sofia && dist(pos, sofia) > 140) { removeGoon(sofia); sofia = null; }
    if (sofia) { sofia.state = "walk"; sofia.speed = 0; }
  }
  if (s === 7 && van && van.state === "parked" && dist(pos, van.v.mesh.position) < 240) vanGo();
  if (s === 8 && !hostiles().length && !failing && !talkBusy) {
    talkBusy = true;
    setVipOn(false);
    ui.subs([
      { who: "TOM", text: "You came. ...They kept saying her name in the van. \"She's waiting. Mrs. Bell is waiting.\"", dur: 3.8 },
      { who: "TOM", text: "Bell. Sam BELL. God help me, I never once put it together. His mother keeps the square in Kathmandu.", dur: 4.2 },
      { who: "YOU", text: "Martha.", dur: 1.6 },
      { who: "TOM", text: "She won't stop. She's waited twelve years for tonight. ...Take me to her. I'm done running.", dur: 3.8 },
    ], () => setStage(9, "TAKE TOM TO PALACE SQUARE", "He wants to face her.", 3600));
  }
  if (s === 9 && square && dist(pos, square) < 55 && tomWithYou(pos)) setStage(10, "THE LAST STAND", STAGES[10].hint, 3600);
  if (s === 10) updateLastStand(dt, ctx);
  if (s === 11) {
    bellT -= dt;
    if (bellT <= 0) { bellT = 9; if (C.bellAt && square) C.bellAt(square.x, square.z); }
  }
}

// ---------------------------------------------------------------- hooks for mission.js
export function midnightHitGoon(p, dmg, fx, fz, how) {
  if (tom && p === tom.p) return;                                   // (don't shoot the man you're saving)
  if (martha && p === martha.p) { ui.banner("NOT YET", "Hear her out.", 1200); return; }
  hitGoon(p, dmg, fx, fz, how);
}
export const midnightTimeScale = () => (performance.now() < slowUntil ? 0.3 : 1);
export function midnightRespawn() {
  const s = M.stage, at = (x, z, yaw = 0) => ({ x, z, yaw });
  if ((s === 1 || s === 2) && embank) return at(embank.x - Math.sin(embank.yaw) * 30, embank.z - Math.cos(embank.yaw) * 30, embank.yaw);
  if ((s === 5 || s === 6) && tower) { const [x, z] = freeSpot(tower.x + Math.sin(tower.yaw) * 30, tower.z + Math.cos(tower.yaw) * 30); return at(x, z, tower.yaw + Math.PI); }
  if (s === 8 && van) { const p = van.v.mesh.position; const [x, z] = freeSpot(p.x - Math.sin(van.v.heading) * 28, p.z - Math.cos(van.v.heading) * 28); return at(x, z, van.v.heading); }
  if ((s === 10 || s === 11) && square) { const [x, z] = Q(0, -44); return at(x, z, square.yaw); }
  return null;
}
export function midnightOnRespawn() {
  const s = M.stage;
  cancelTimers();
  if (s === 1 || s === 2) { setStage(1, "OLD TOM", "Get back to him.", 2200); }
  else if (s === 3) {
    for (const c of hunters) if (c.state !== "wrecked") removeCar(c);
    hunters = []; huntT = 10; huntWave = Math.max(0, huntWave - 1);
  } else if (s === 5 || s === 6) {
    M.timer = Math.max(M.timer, 100);
    clearGoons(); M.towerGuns = false; progress = 0;
    M.stage = 5; persist();
    ui.banner("THE CLOCK TOWER", "Still time. Go.", 2200);
  } else if (s === 8) { startVanFight(); ui.banner("GET TOM BACK", "", 2000); }
  else if (s === 10) { setStage(10, "THE LAST STAND", "Again.", 2200); }
  talkBusy = false;
}
export function midnightObjective() {
  const s = M.stage, pos = me();
  if (s === 1) return tom ? { x: tom.p.x, z: tom.p.z, label: "Old Tom", target: true } : embank && { x: embank.x, z: embank.z, label: "The embankment" };
  if (s === 2 || s === 8 || s === 10) return enemyObjective(pos);
  if (s === 3 || s === 9) {
    if (tom && !tom.aboard && dist(pos, tom.p) > 14) return { x: tom.p.x, z: tom.p.z, label: "Tom", target: true };
    if (s === 3) return hospital && { x: hospital.x, z: hospital.z, label: "St. Agnes" };
    return square && { x: square.x, z: square.z, label: "Palace Square" };
  }
  if (s === 5) return tower && { x: tower.x, z: tower.z, label: "Clock tower" };
  if (s === 6) return tower && { x: tower.x, z: tower.z, y: tower.base + BELL_Y, label: "The bomb" };
  if (s === 7 && van) { const p = van.v.mesh.position; return { x: p.x, z: p.z, label: "Grey van", target: true }; }
  if (s === 11 && martha) return { x: martha.p.x, z: martha.p.z, label: "Martha", target: true };
  return null;
}
export function midnightCard() {
  const s = Math.min(M.stage, DONE), st = STAGES[s];
  let extra = "", timer = null;
  if (s === 2 || s === 8 || s === 10) {
    extra = `${hostiles().length} left`;
    if (vip) extra += ` · Tom ${"█".repeat(Math.max(0, vip.hp))}${"░".repeat(Math.max(0, vip.max - vip.hp))}`;
  }
  if (s === 3 || s === 9) {
    const n = hunters.filter((c) => c.state !== "wrecked").length;
    extra = tom && tom.aboard ? (n ? `${n} hunter${n > 1 ? "s" : ""} behind you` : "Tom's in the car") : "Pick up Tom";
  }
  if (s === 5 || s === 6) {
    timer = defused ? null : Math.max(0, M.timer);
    if (s === 6) extra = progress > 0 ? `Disarming ${"█".repeat(Math.round(progress / 6 * 10))}${"░".repeat(10 - Math.round(progress / 6 * 10))}` : "Get up to the belfry";
  }
  if (s === 7 && van) extra = van.state === "parked" ? "Parked — they're waiting for something" : healthBar(van) + (escort && escort.state !== "wrecked" ? " · escort on you" : "");
  return { name: "MISSION 2 — MIDNIGHT BELLS", title: st.title, hint: st.hint, extra, timer, done: M.stage >= DONE };
}
