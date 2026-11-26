// sound.js — every sound in the game, made live with the Web Audio API.
// The engines use the recording in sound/car-sound.wav; everything else is
// synthesised (no other audio files).
//
//   vehicles   the recorded engine for every vehicle, pitched per type (deep
//              for trucks and buses, high for supercars and bikes) and by
//              revs / gear changes / throttle / boost; its start-up rev plays
//              when you get in; tyre screech; a horn (H); door clunk
//   moving     wind that grows with speed (driving, web-swinging, falling),
//              footsteps, a thump when you land a big drop
//   combat     gunshots, explosions, crashes, the web shooter's "thwip"
//   the city   a passing-traffic engine (panned left/right), a low city
//              hum, birdsong by day, crickets at night
//
// Browsers only allow audio after a click / key press, so main.js calls
// unlock() from those events. N toggles mute.
let ctx = null,
  master = null,
  noiseBuf = null,
  muted = false;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function ensure() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(comp);
  comp.connect(ctx.destination);
  const N = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, N, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
  loadRecordings();
  return ctx;
}

// ---------------------------------------------------------------- recorded engines
//   car  sound/car-sound.wav (10.5 s): quiet idle, a start-up rev
//        (~1.0–3.7 s), then a steady running engine (~4.0–9.35 s) we loop
//   bike sound/bike-sound.mp3 (37.6 s, mono, 48 kHz): analysed when it loads
//        — the steadiest stretch is looped, the loudest burst becomes the
//        start-up rev, and it's levelled to match the car
// Cars, vans, trucks and buses use the car recording; bikes and superbikes
// the bike recording. Each is pitched per vehicle type and by revs; until a
// recording has loaded, the synth engine stands in.
const RECORDINGS = {
  car: { file: "sound/car-sound.wav", start: [0.95, 3.7], loop: [4.0, 9.35], gain: 1 },
  // sound/bike-sound.mp3 (37.6 s, mono): its start / loop / level are worked
  // out from the audio itself once decoded — see analyseEngine()
  bike: { file: "sound/bike-sound.mp3", auto: true, start: [0, 1.5], loop: [2, 8], gain: 1 },
};
// Find the useful parts of an engine recording: skip quiet lead-in / tail,
// loop the steadiest stretch, use the loudest burst as the start-up rev (if
// it clearly stands out), and level it to sound as loud as the car loop.
function analyseEngine(R, buf) {
  const sr = buf.sampleRate, W = Math.floor(sr * 0.1), chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const rms = [];
  for (let i = 0; i + W <= buf.length; i += W) {
    let s = 0;
    for (let k = i; k < i + W; k += 2) for (const d of chs) s += d[k] * d[k];
    rms.push(Math.sqrt(s / ((W / 2) * chs.length)));
  }
  const n = rms.length, peak = Math.max(...rms);
  let a = 0, b = n - 1;
  while (a < n - 1 && rms[a] < peak * 0.12) a++;
  while (b > a && rms[b] < peak * 0.12) b--;
  const active = b - a + 1;
  // steadiest stretch: lowest variation (std / mean) over a sliding window
  const L = Math.max(10, Math.min(60, Math.floor(active * 0.5)));        // 1–6 s
  let best = a, bestCv = Infinity, loopMean = 0;
  for (let s = a; s + L <= b + 1; s++) {
    let m = 0; for (let k = s; k < s + L; k++) m += rms[k]; m /= L;
    let v = 0; for (let k = s; k < s + L; k++) v += (rms[k] - m) ** 2;
    const cv = Math.sqrt(v / L) / (m || 1);
    if (cv < bestCv) { bestCv = cv; best = s; loopMean = m; }
  }
  R.loop = [best * 0.1 + 0.05, (best + L) * 0.1 - 0.05];
  // start-up rev: the loudest ~1.6 s, if it's clearly louder than the loop
  const S = 16;
  let bs = a, bm = 0;
  for (let s = a; s + S <= b + 1; s++) {
    let m = 0; for (let k = s; k < s + S; k++) m += rms[k]; m /= S;
    if (m > bm) { bm = m; bs = s; }
  }
  R.start = bm > loopMean * 1.35 ? [Math.max(0, bs - 3) * 0.1, (bs + S) * 0.1] : [a * 0.1, Math.min(b, a + 15) * 0.1];
  R.gain = clamp(0.06 / (loopMean || 0.06), 0.4, 4);
  console.info(`engine sound ${R.file}: loop ${R.loop.map((x) => x.toFixed(2)).join("–")} s, start ${R.start.map((x) => x.toFixed(2)).join("–")} s, level ×${R.gain.toFixed(2)}`);
}
const LOOP_SEG = RECORDINGS.car.loop;          // passing traffic uses the car loop
// one-shot recordings (played whole)
const ONE_SHOTS = {
  explosion: { file: "sound/explosion-sound.wav" },  // 3 s, loud from the first frame
  wallHit: { file: "sound/wall-hit-crash.mp3" },     // vehicle into a wall / post / anything solid
  carHit: { file: "sound/car-hit-crash.mp3" },       // vehicle into another vehicle
  splash: { file: "sound/water-jump.wav" },          // player landing in the river / pond / sea
  npcDeath: { file: "sound/npc-death.mp3" },         // a pedestrian shot / run over / blown over
  swim: { file: "sound/swimming-sound.mp3" },        // 22 s, looped while swimming
};
// Casual remarks people make when you walk right up to them, played in a
// shuffled order (all five once, then reshuffle) so they don't repeat back to back.
const TALK_FILES = [
  "sound/casual-talk/freesound_community-076904_hello-can-i-help-you-38120.mp3",
  "sound/casual-talk/kittenstrike1-quothello-therequot-158832.mp3",
  "sound/casual-talk/voiceofruthie-excuse-me-loud-338197.mp3",
  "sound/casual-talk/voiceofruthie-pardon-me-338198.mp3",
  "sound/casual-talk/zoey03-im-sorry-what-338742.mp3",
];
TALK_FILES.forEach((file, i) => { ONE_SHOTS["talk" + i] = { file }; });
let talkBag = [];
// Play a one-shot recording; returns false if it isn't loaded (yet).
function playShot(key, vol, { rate = 1, pan = 0, bright = 20000 } = {}) {
  const buf = bufs[key];
  if (!buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  chain(src, filt("lowpass", bright, 0.7), gain(vol), panner(pan), master);
  src.start();
  return true;
}
const bufs = {};
function loadRecordings() {
  for (const [key, R] of Object.entries({ ...RECORDINGS, ...ONE_SHOTS })) {
    fetch(encodeURI(R.file))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { if (R.auto) analyseEngine(R, buf); bufs[key] = buf; })
      .catch((e) => console.warn(`${R.file} not loaded, using the synth engine:`, e));
  }
}
// which recording, base pitch (playback rate), brightness and loudness per vehicle type
const SAMPLE = {
  car: { rec: "car", rate: 1.0, bright: 4200, vol: 0.7 },
  SUV: { rec: "car", rate: 0.92, bright: 3600, vol: 0.75 },
  van: { rec: "car", rate: 0.84, bright: 3000, vol: 0.75 },
  truck: { rec: "car", rate: 0.62, bright: 1900, vol: 0.85 },
  bus: { rec: "car", rate: 0.6, bright: 1800, vol: 0.85 },
  "double-decker": { rec: "car", rate: 0.58, bright: 1700, vol: 0.85 },
  supercar: { rec: "car", rate: 1.22, bright: 7000, vol: 0.75 },
  bike: { rec: "bike", rate: 1.0, bright: 6500, vol: 0.7 },
  superbike: { rec: "bike", rate: 1.15, bright: 9000, vol: 0.72 },
  // outboard motor: the bike recording, lower and muffled (heard over the water)
  boat: { rec: "bike", rate: 0.74, bright: 2400, vol: 0.62 },
};
const sampleOf = (name) => SAMPLE[name] || SAMPLE.car;
const bufFor = (name) => bufs[sampleOf(name).rec] || null;
function makeSampleEngine(name) {
  const S = sampleOf(name), R = RECORDINGS[S.rec];
  const src = ctx.createBufferSource();
  src.buffer = bufs[S.rec]; src.loop = true;
  src.loopStart = R.loop[0]; src.loopEnd = R.loop[1];
  src.playbackRate.value = S.rate * 0.8;
  const lp = filt("lowpass", S.bright * 0.6, 0.7), out = gain(0);
  chain(src, lp, out, master);
  src.start(0, R.loop[0]);
  return { sample: true, S, R, P: ENGINES[name] || ENGINES.car, src, lp, out, srcs: [src], rpm: 0, alive: true, fadeIn: 0 };
}
const live = () => ctx && ctx.state === "running" && !muted;
export function unlock() {
  const a = ensure();
  if (a && a.state === "suspended") a.resume();
}
export function toggleMute() {
  ensure();
  muted = !muted;
  if (master)
    master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.05);
  return muted;
}

// ---------------------------------------------------------------- building blocks
function noise(loop = false) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = loop;
  if (!loop) s.playbackRate.value = 0.9 + Math.random() * 0.2;
  return s;
}
function filt(type, f, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}
function gain(v = 0) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}
function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}
function panner(p) {
  if (!ctx.createStereoPanner) return gain(1);
  const s = ctx.createStereoPanner();
  s.pan.value = clamp(p, -1, 1);
  return s;
}
// a decaying burst: [attack, decay] envelope on a gain node
function env(g, t0, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}
function burst({
  type = "lowpass",
  f = 1000,
  q = 0.7,
  peak = 0.5,
  attack = 0.002,
  decay = 0.2,
  sweepTo = null,
  pan = 0,
  at = 0,
}) {
  const t0 = ctx.currentTime + at,
    s = noise(),
    b = filt(type, f, q),
    g = gain(),
    p = panner(pan);
  if (sweepTo)
    b.frequency.exponentialRampToValueAtTime(sweepTo, t0 + attack + decay);
  env(g, t0, peak, attack, decay);
  chain(s, b, g, p, master);
  s.start(t0);
  s.stop(t0 + attack + decay + 0.05);
}
function tone({
  type = "sine",
  f = 200,
  to = null,
  peak = 0.3,
  attack = 0.005,
  decay = 0.2,
  pan = 0,
  at = 0,
}) {
  const t0 = ctx.currentTime + at,
    o = ctx.createOscillator(),
    g = gain(),
    p = panner(pan);
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + attack + decay);
  env(g, t0, peak, attack, decay);
  chain(o, g, p, master);
  o.start(t0);
  o.stop(t0 + attack + decay + 0.05);
}

// ---------------------------------------------------------------- one-shots
export function gunshot() {
  if (!live()) return;
  burst({ type: "highpass", f: 900, peak: 0.9, attack: 0.001, decay: 0.09 });
  burst({
    type: "lowpass",
    f: 2400,
    peak: 0.55,
    attack: 0.001,
    decay: 0.35,
    sweepTo: 300,
  });
  tone({ f: 150, to: 45, peak: 0.6, attack: 0.002, decay: 0.16 });
}
export function explosion(dist = 0, scale = 1, pan = 0) {
  if (!live()) return;
  const k = clamp(1 - dist / 260, 0.08, 1) * clamp(scale, 0.4, 1.3);
  if (bufs.explosion) {
    // the recorded blast: quieter and duller the further away it is,
    // placed left/right, slightly varied in pitch each time
    const t0 = ctx.currentTime, src = ctx.createBufferSource();
    src.buffer = bufs.explosion;
    src.playbackRate.value = (0.92 + Math.random() * 0.14) * (scale < 0.8 ? 1.1 : 1);
    const lp = filt("lowpass", 900 + 11000 * k * k, 0.7), g = gain(0.95 * k), p = panner(pan);
    chain(src, lp, g, p, master);
    src.start(t0);
    return;
  }
  burst({
    type: "lowpass",
    f: 1800,
    peak: 0.9 * k,
    attack: 0.004,
    decay: 1.6,
    sweepTo: 90,
    pan,
  });
  tone({ f: 70, to: 22, peak: 0.85 * k, attack: 0.01, decay: 1.2, pan });
  burst({
    type: "bandpass",
    f: 3000,
    q: 0.5,
    peak: 0.25 * k,
    attack: 0.001,
    decay: 0.25,
    pan,
  });
  // debris patter afterwards
  for (let i = 0; i < 6; i++)
    burst({
      type: "bandpass",
      f: 900 + Math.random() * 1800,
      q: 2,
      peak: 0.07 * k,
      decay: 0.06,
      at: 0.35 + Math.random() * 0.9,
      pan,
    });
}
// what = "vehicle" (hit another vehicle) or "wall" (anything else solid)
export function crash(impact, what = "wall") {
  if (!live()) return;
  const v = clamp(impact / 30, 0.12, 1);
  const vary = 0.94 + Math.random() * 0.12;
  if (playShot(what === "vehicle" ? "carHit" : "wallHit", 0.35 + 0.65 * v, { rate: vary, bright: 2500 + 17500 * v })) return;
  burst({
    type: "lowpass",
    f: 900 + impact * 60,
    peak: 0.85 * v,
    attack: 0.002,
    decay: 0.55,
  });
  for (const [f, type] of [
    [140 + Math.random() * 60, "square"],
    [430 + Math.random() * 200, "triangle"],
  ]) {
    tone({ type, f, to: f * 0.45, peak: 0.16 * v, decay: 0.45 });
  }
  for (let i = 0; i < 4; i++)
    burst({
      type: "bandpass",
      f: 2500 + Math.random() * 2500,
      q: 3,
      peak: 0.12 * v,
      decay: 0.08,
      at: 0.05 + Math.random() * 0.3,
    });
}
// A light knock: brushing a wall, nudging another car (impact ~2.5–5 m/s).
// An enemy's gun: duller and quieter with distance.
export function enemyShot(dist = 20, pan = 0) {
  if (!live()) return;
  const k = clamp(1 - dist / 150, 0.08, 1);
  burst({ type: "lowpass", f: 1500 + 3500 * k, peak: 0.75 * k, attack: 0.001, decay: 0.1, pan });
  burst({ type: "bandpass", f: 260, q: 1.2, peak: 0.45 * k, attack: 0.002, decay: 0.22, pan });
}
// An animal's growl (rate: lower = bigger beast) — a rough, pulsing rumble.
export function growl(dist = 20, pan = 0, rate = 1, loud = 1) {
  if (!live()) return;
  const k = clamp(1 - dist / 120, 0.05, 1) * loud;
  const f = 95 * rate;
  for (let i = 0; i < 5; i++) {
    burst({ type: "bandpass", f: f * (1.6 + Math.random() * 0.6), q: 2.5, peak: 0.45 * k, attack: 0.02, decay: 0.12, pan, at: i * 0.11 });
    tone({ type: "sawtooth", f: f * (0.95 + Math.random() * 0.1), to: f * 0.8, peak: 0.12 * k, attack: 0.02, decay: 0.12, pan, at: i * 0.11 });
  }
}
// You've been hit.
export function hurt() {
  if (!live()) return;
  tone({ type: "sine", f: 95, to: 45, peak: 0.4, decay: 0.16 });
  burst({ type: "lowpass", f: 500, peak: 0.35, decay: 0.1 });
}
// A punch / kick: a swish, and a thud if it lands.
export function punch(landed) {
  if (!live()) return;
  burst({ type: "bandpass", f: 2200, q: 0.8, peak: 0.18, attack: 0.01, decay: 0.08, sweepTo: 900 });
  if (landed) burst({ type: "lowpass", f: 700, peak: 0.7, attack: 0.001, decay: 0.09, at: 0.04 });
}
export function bump(impact, what = "wall") {
  if (!live()) return;
  const v = clamp((impact - 2) / 4, 0.1, 1);
  playShot(what === "vehicle" ? "carHit" : "wallHit", 0.12 + 0.18 * v, { rate: 1.1 + Math.random() * 0.1, bright: 1800 + 2500 * v });
}
// A pedestrian goes down; quieter / duller with distance, placed left-right.
let deathVoices = 0;
export function npcDeath(dist = 0, pan = 0) {
  if (!live() || dist > 90 || deathVoices >= 3) return;      // an explosion can drop a crowd: cap the overlap
  const k = clamp(1 - dist / 90, 0.15, 1);
  if (playShot("npcDeath", 0.85 * k, { rate: 0.92 + Math.random() * 0.16, pan, bright: 2500 + 15000 * k })) {
    deathVoices++;
    setTimeout(() => deathVoices--, 900);
  }
}
// Someone you've walked right up to says something (shuffled clips).
export function npcTalk(dist = 0, pan = 0) {
  if (!live()) return;
  if (!talkBag.length) {
    talkBag = TALK_FILES.map((_, i) => i).filter((i) => bufs["talk" + i]);
    for (let i = talkBag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [talkBag[i], talkBag[j]] = [talkBag[j], talkBag[i]]; }
    if (!talkBag.length) return;                              // none loaded yet
  }
  const k = clamp(1 - dist / 8, 0.4, 1);
  playShot("talk" + talkBag.pop(), 0.75 * k, { rate: 0.95 + Math.random() * 0.1, pan });
}
// Landing in water; speed = how fast you were falling.
export function splash(speed = 8) {
  if (!live()) return;
  const k = clamp(speed / 20, 0.35, 1);
  if (playShot("splash", 0.45 + 0.5 * k, { rate: 1.08 - k * 0.12 + Math.random() * 0.06 })) return;
  burst({ type: "lowpass", f: 1400, peak: 0.5 * k, attack: 0.005, decay: 0.6, sweepTo: 300 });
  for (let i = 0; i < 6; i++) burst({ type: "bandpass", f: 1200 + Math.random() * 2500, q: 3, peak: 0.08 * k, decay: 0.05, at: 0.15 + Math.random() * 0.6 });
}
export function webShot(strength = 1) {
  if (!live()) return;
  burst({
    type: "bandpass",
    f: 3500,
    q: 1.4,
    peak: 0.35 * strength,
    attack: 0.003,
    decay: 0.14,
    sweepTo: 700,
  });
  tone({
    type: "triangle",
    f: 1400,
    to: 380,
    peak: 0.08 * strength,
    decay: 0.12,
  });
}
export function footstep(running) {
  if (!live()) return;
  burst({
    type: "lowpass",
    f: running ? 900 : 650,
    peak: running ? 0.16 : 0.09,
    attack: 0.002,
    decay: 0.07,
  });
  burst({
    type: "bandpass",
    f: 2200,
    q: 1,
    peak: running ? 0.03 : 0.015,
    decay: 0.03,
  });
}
export function land(speed) {
  if (!live()) return;
  const k = clamp(speed / 25, 0.2, 1);
  tone({ f: 95, to: 38, peak: 0.55 * k, decay: 0.22 });
  burst({ type: "lowpass", f: 500, peak: 0.4 * k, decay: 0.25 });
}
export function door() {
  if (!live()) return;
  tone({ type: "triangle", f: 160, to: 70, peak: 0.25, decay: 0.12 });
  burst({ type: "lowpass", f: 1200, peak: 0.25, decay: 0.08 });
  burst({ type: "bandpass", f: 3000, q: 3, peak: 0.05, decay: 0.03, at: 0.02 });
}
export function blip() {
  if (!live()) return;
  tone({ type: "sine", f: 880, to: 1320, peak: 0.05, decay: 0.08 });
}
// A big bronze bell: a low strike with a few inharmonic partials ringing out.
export function bell(dist = 0, pan = 0) {
  if (!live()) return;
  const k = clamp(1 - dist / 400, 0.15, 1);
  const f0 = 146;
  for (const [m, a, d] of [[1, 0.32, 4.5], [2.0, 0.16, 3.2], [2.76, 0.1, 2.4], [5.4, 0.05, 1.2], [0.5, 0.14, 5.5]])
    tone({ type: "sine", f: f0 * m, peak: a * k, attack: 0.004, decay: d, pan });
  burst({ type: "bandpass", f: 900, q: 2, peak: 0.12 * k, attack: 0.001, decay: 0.06, pan });
}
// Your phone buzzing with a message / call.
export function phoneBuzz() {
  if (!live()) return;
  for (let i = 0; i < 2; i++) {
    tone({ type: "square", f: 180, peak: 0.035, attack: 0.01, decay: 0.16, at: i * 0.28 });
    tone({ type: "sine", f: 1320, peak: 0.04, attack: 0.005, decay: 0.09, at: i * 0.28 });
  }
}
// One tick of a countdown (higher and sharper in the last seconds).
export function tick(urgent = false) {
  if (!live()) return;
  tone({ type: "triangle", f: urgent ? 1560 : 1040, peak: urgent ? 0.07 : 0.04, attack: 0.002, decay: 0.05 });
}

// ---------------------------------------------------------------- engine
// pitch range (Hz at idle / redline), gears, waveform and how gritty it is
const ENGINES = {
  boat: {
    idle: 40,
    top: 150,
    gears: 1,
    wave: "sawtooth",
    grit: 0.4,
    lp: [600, 2400],
    vol: 0.5,
  },
  car: {
    idle: 34,
    top: 150,
    gears: 5,
    wave: "sawtooth",
    grit: 0.25,
    lp: [700, 3200],
    vol: 0.5,
  },
  SUV: {
    idle: 30,
    top: 125,
    gears: 5,
    wave: "sawtooth",
    grit: 0.3,
    lp: [600, 2600],
    vol: 0.55,
  },
  van: {
    idle: 26,
    top: 105,
    gears: 5,
    wave: "sawtooth",
    grit: 0.4,
    lp: [500, 2200],
    vol: 0.55,
  },
  truck: {
    idle: 20,
    top: 80,
    gears: 6,
    wave: "sawtooth",
    grit: 0.6,
    lp: [380, 1600],
    vol: 0.65,
  },
  bus: {
    idle: 21,
    top: 78,
    gears: 4,
    wave: "sawtooth",
    grit: 0.55,
    lp: [380, 1500],
    vol: 0.65,
  },
  "double-decker": {
    idle: 20,
    top: 74,
    gears: 4,
    wave: "sawtooth",
    grit: 0.6,
    lp: [360, 1400],
    vol: 0.65,
  },
  supercar: {
    idle: 48,
    top: 290,
    gears: 6,
    wave: "sawtooth",
    grit: 0.35,
    lp: [900, 5200],
    vol: 0.55,
  },
  bike: {
    idle: 52,
    top: 240,
    gears: 5,
    wave: "square",
    grit: 0.35,
    lp: [800, 3800],
    vol: 0.42,
  },
  superbike: {
    idle: 64,
    top: 340,
    gears: 6,
    wave: "square",
    grit: 0.3,
    lp: [1000, 5600],
    vol: 0.45,
  },
};
let eng = null;
function makeEngine(P) {
  const o1 = ctx.createOscillator(),
    o2 = ctx.createOscillator(),
    sub = ctx.createOscillator();
  o1.type = P.wave;
  o2.type = P.wave;
  sub.type = "sine";
  o2.detune.value = 7;
  const n = noise(true),
    nb = filt("bandpass", 400, 0.8),
    ng = gain(P.grit * 0.5);
  const mix = gain(1),
    lp = filt("lowpass", P.lp[0], 1.2);
  // firing pulses: amplitude-modulate at the firing rate for that chuggy texture
  const trem = gain(0.75),
    lfo = ctx.createOscillator(),
    lfoG = gain(0.25);
  lfo.type = "sine";
  lfo.connect(lfoG);
  lfoG.connect(trem.gain);
  const out = gain(0);
  const g1 = gain(0.45),
    g2 = gain(0.3),
    gs = gain(0.5);
  o1.connect(g1);
  o2.connect(g2);
  sub.connect(gs);
  g1.connect(mix);
  g2.connect(mix);
  gs.connect(mix);
  n.connect(nb);
  nb.connect(ng);
  ng.connect(mix);
  chain(mix, lp, trem, out, master);
  for (const s of [o1, o2, sub, n, lfo]) s.start();
  return {
    P,
    o1,
    o2,
    sub,
    nb,
    ng,
    lp,
    lfo,
    out,
    srcs: [o1, o2, sub, n, lfo],
    rpm: 0,
    alive: true,
  };
}
function killEngine(e, fade = 0.4) {
  if (!e) return;
  const t = ctx.currentTime;
  e.out.gain.setTargetAtTime(0, t, fade / 3);
  e.alive = false;
  setTimeout(
    () => {
      for (const s of e.srcs)
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
    },
    fade * 1000 + 200,
  );
}
// Starter crank and a rev as you get in.
export function engineStart(specName) {
  if (!live()) return;
  if (bufFor(specName)) {
    // the recording's own start-up rev, then the running loop fades in under it
    const S = sampleOf(specName), R = RECORDINGS[S.rec], t0 = ctx.currentTime;
    const one = ctx.createBufferSource(), lp = filt("lowpass", S.bright, 0.7), g = gain(0);
    one.buffer = bufs[S.rec]; one.playbackRate.value = S.rate;
    const v = S.vol * R.gain, seg = R.start[1] - R.start[0], len = seg / S.rate;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(v, t0 + 0.05);
    g.gain.setValueAtTime(v, t0 + Math.max(0.1, len - 0.6));
    g.gain.linearRampToValueAtTime(0, t0 + len);
    chain(one, lp, g, master);
    one.start(t0, R.start[0], seg);
    if (eng) killEngine(eng, 0.1);
    eng = makeSampleEngine(specName);
    eng.name = specName;
    eng.fadeIn = t0 + Math.max(0.3, len - 0.7);
    return;
  }
  const P = ENGINES[specName] || ENGINES.car;
  for (let i = 0; i < 4; i++)
    tone({
      type: "square",
      f: P.idle * 1.4,
      to: P.idle,
      peak: 0.05,
      decay: 0.07,
      at: i * 0.09,
    });
  if (eng) killEngine(eng, 0.1);
  eng = makeEngine(P);
  eng.name = specName;
  eng.rpm = 0.9; // the start-up blip, settles to idle
}

// ---------------------------------------------------------------- loops: wind, horn, traffic, ambience
let loops = null;
function makeLoops() {
  const windN = noise(true),
    windB = filt("lowpass", 400, 0.5),
    windG = gain(0);
  chain(windN, windB, windG, master);
  windN.start();
  const hornG = gain(0),
    hornLp = filt("lowpass", 2200, 0.7);
  for (const f of [392, 494]) {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    o.connect(hornLp);
    o.start();
  }
  chain(hornLp, hornG, master);
  // nearest traffic car: its own small engine, panned to where it is
  const tO = ctx.createOscillator(),
    tLp = filt("lowpass", 600, 1),
    tG = gain(0),
    tPan = panner(0);
  tO.type = "sawtooth";
  tO.frequency.value = 40;
  const tN = noise(true),
    tNB = filt("bandpass", 300, 0.6),
    tNG = gain(0.25);
  tN.connect(tNB);
  tNB.connect(tNG);
  tNG.connect(tLp);
  chain(tO, tLp, tG, tPan, master);
  tO.start();
  tN.start();
  // city hum
  const humN = noise(true),
    humB = filt("lowpass", 220, 0.4),
    humG = gain(0);
  chain(humN, humB, humG, master);
  humN.start();
  loops = {
    windG,
    windB,
    hornG,
    tO,
    tLp,
    tG,
    tPan,
    humG,
    chirpT: 2,
    cricketT: 1,
  };
}

function chirp(pan) {
  // a little bird: 2–4 quick rising whistles
  const base = 2600 + Math.random() * 1800,
    n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++)
    tone({
      f: base,
      to: base * (1.15 + Math.random() * 0.3),
      peak: 0.025,
      attack: 0.01,
      decay: 0.07,
      at: i * 0.11,
      pan,
    });
}
function cricket(pan) {
  for (let i = 0; i < 3; i++)
    tone({
      type: "triangle",
      f: 4300 + Math.random() * 300,
      peak: 0.012,
      attack: 0.004,
      decay: 0.035,
      at: i * 0.06,
      pan,
    });
}

// ---------------------------------------------------------------- per frame
// s = {
//   vehicle: { name, speed, max, throttle 0..1, boost } | null,
//   windSpeed, horn, night, inside,
//   traffic: { dist, speed, pan } | null,
// }
export function update(dt, s) {
  if (!ctx || ctx.state !== "running") return;
  if (!loops) makeLoops();
  const t = ctx.currentTime,
    L = loops;

  // ---- player's engine
  const v = s.vehicle;
  if (v) {
    // (re)build the engine voice if the vehicle changed, or the recording
    // finished loading while the synth stand-in was running
    const rec = bufFor(v.name);
    if (!eng || !eng.alive || eng.name !== v.name || !!eng.sample !== !!rec) {
      if (eng) killEngine(eng, 0.1);
      eng = rec ? makeSampleEngine(v.name) : makeEngine(ENGINES[v.name] || ENGINES.car);
      eng.name = v.name;
    }
    const P = eng.P,
      sp = Math.abs(v.speed),
      max = Math.max(5, v.max);
    const span = max / P.gears,
      gear = Math.min(P.gears - 1, Math.floor(sp / span));
    const within = clamp((sp - gear * span) / span, 0, 1);
    const target = sp < 0.6 ? 0.08 + v.throttle * 0.25 : 0.22 + 0.78 * within;
    eng.rpm +=
      (target - eng.rpm) * Math.min(1, dt * (target < eng.rpm ? 6 : 9));
    const load = 0.35 + 0.65 * v.throttle;
    if (eng.sample) {
      // pitch the recording with revs (drops on each gear change), open up
      // the tone and volume with throttle
      const S = eng.S;
      const rate = S.rate * (0.78 + 0.72 * eng.rpm) * (1 + gear * 0.025) * (v.boost ? 1.06 : 1);
      eng.src.playbackRate.setTargetAtTime(rate, t, 0.04);
      eng.lp.frequency.setTargetAtTime(S.bright * (0.45 + 0.55 * load) * (v.boost ? 1.2 : 1), t, 0.05);
      const warm = t < eng.fadeIn ? 0.15 : 1;            // quiet under the start-up rev
      eng.out.gain.setTargetAtTime(S.vol * eng.R.gain * warm * (0.5 + 0.3 * load + 0.25 * eng.rpm), t, warm < 1 ? 0.05 : 0.25);
    } else {
    const f =
      (P.idle + (P.top - P.idle) * eng.rpm) *
      (v.boost ? 1.08 : 1) *
      (1 + gear * 0.03);
    eng.o1.frequency.setTargetAtTime(f, t, 0.03);
    eng.o2.frequency.setTargetAtTime(f * 1.005, t, 0.03);
    eng.sub.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    eng.lfo.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    eng.nb.frequency.setTargetAtTime(f * 3, t, 0.05);
    eng.lp.frequency.setTargetAtTime(
      P.lp[0] + (P.lp[1] - P.lp[0]) * eng.rpm * load * (v.boost ? 1.25 : 1),
      t,
      0.05,
    );
    eng.out.gain.setTargetAtTime(
      P.vol * (0.32 + 0.38 * load + 0.3 * eng.rpm),
      t,
      0.05,
    );
    }
  } else if (eng && eng.alive) killEngine(eng, 0.5);

  // ---- tyres

  // ---- wind: only on foot (web-swinging, falling) — silent while driving
  const w = v ? 0 : clamp(s.windSpeed / 45, 0, 1);
  L.windG.gain.setTargetAtTime(w * w * 0.32, t, 0.15);
  L.windB.frequency.setTargetAtTime(250 + w * 1600, t, 0.15);

  // ---- horn
  L.hornG.gain.setTargetAtTime(s.horn ? 0.12 : 0, t, 0.015);

  // ---- swimming: the recording loops (started on first swim, then just
  // faded in / out); louder while stroking than while treading water
  if (bufs.swim && !L.swimSrc && s.swim >= 0) {
    L.swimSrc = ctx.createBufferSource();
    L.swimSrc.buffer = bufs.swim; L.swimSrc.loop = true;
    L.swimG = gain(0);
    chain(L.swimSrc, L.swimG, master);
    L.swimSrc.start(0, Math.random() * Math.max(0, bufs.swim.duration - 2));
  }
  if (L.swimG) L.swimG.gain.setTargetAtTime(s.swim >= 0 ? 0.25 + 0.45 * s.swim : 0, t, s.swim >= 0 ? 0.15 : 0.3);

  // ---- passing traffic
  const tr = s.traffic;
  if (bufs.car && !L.tSrc) {
    // the car recording, looped, for the nearest traffic car (replaces the synth)
    L.tSrc = ctx.createBufferSource();
    L.tSrc.buffer = bufs.car; L.tSrc.loop = true;
    L.tSrc.loopStart = LOOP_SEG[0]; L.tSrc.loopEnd = LOOP_SEG[1];
    L.tSLp = filt("lowpass", 1200, 0.7); L.tSG = gain(0);
    chain(L.tSrc, L.tSLp, L.tSG, L.tPan);
    L.tSrc.start(0, LOOP_SEG[0] + Math.random() * 3);
    L.tG.gain.setTargetAtTime(0, t, 0.1);
  }
  if (L.tSrc) {
    if (tr && !s.inside) {
      const k = clamp(1 - tr.dist / 45, 0, 1);
      L.tSG.gain.setTargetAtTime(k * k * 0.32, t, 0.12);
      L.tSrc.playbackRate.setTargetAtTime(0.62 + clamp(tr.speed / 16, 0, 1) * 0.45, t, 0.2);
      L.tSLp.frequency.setTargetAtTime(700 + k * 2200, t, 0.15);
      if (L.tPan.pan) L.tPan.pan.setTargetAtTime(clamp(tr.pan, -0.9, 0.9), t, 0.1);
    } else L.tSG.gain.setTargetAtTime(0, t, 0.2);
  } else if (tr && !s.inside) {
    const k = clamp(1 - tr.dist / 45, 0, 1);
    L.tG.gain.setTargetAtTime(k * k * 0.16, t, 0.12);
    L.tO.frequency.setTargetAtTime(28 + tr.speed * 4, t, 0.15);
    L.tLp.frequency.setTargetAtTime(350 + tr.speed * 40 + k * 400, t, 0.15);
    if (L.tPan.pan)
      L.tPan.pan.setTargetAtTime(clamp(tr.pan, -0.9, 0.9), t, 0.1);
  } else L.tG.gain.setTargetAtTime(0, t, 0.2);

  // ---- ambience: city hum, birds (day), crickets (night); muffled indoors
  L.humG.gain.setTargetAtTime(s.inside ? 0.01 : s.night ? 0.03 : 0.05, t, 0.5);
  if (!s.inside && !v) {
    L.chirpT -= dt;
    L.cricketT -= dt;
    if (!s.night && L.chirpT <= 0) {
      L.chirpT = 2.5 + Math.random() * 6;
      chirp(Math.random() * 1.6 - 0.8);
    }
    if (s.night && L.cricketT <= 0) {
      L.cricketT = 0.4 + Math.random() * 1.2;
      cricket(Math.random() * 1.6 - 0.8);
    }
  }
}
