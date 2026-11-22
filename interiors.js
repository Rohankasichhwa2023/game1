// interiors.js — walk-in homes, built only when you step through the door.
//
// Nothing about an interior exists until the player presses E at a home's
// front door. Then one of 12 hand-designed floor plans is generated far away
// from the city, the camera switches to the "inside" layer so the city is
// not drawn at all, and the player is moved in. Leaving disposes every mesh
// and collider again and switches the city back on.
//
// Plans are lists of rooms (rectangles) per floor. Walls are derived from
// the plan: exterior walls around the footprint (with windows), interior
// walls wherever two rooms touch (with a wide doorway unless the rooms share
// an "open" group). Furniture is placed into free wall slots, so it never
// overlaps a doorway, a window (tall pieces) or the stairs.
import {
  scene, glow, hex, C3, litMat, addBox, solidBox, setXF, clearXF, makeXF, xfp, captureSolids, removeSolid, rand, rr, pick, clamp,
  state as world,
} from "./engine.js";
import { homes, furnishWith } from "./buildings.js";

export const WORLD_MASK = 0x0fffffff;
export const INSIDE_MASK = 0x10000000;
export const BOTH_MASK = WORLD_MASK | INSIDE_MASK;
const ORIGIN = { x: 24000, z: 24000 };
const T_IN = 0.075, T_EX = 0.25;

// ---------------------------------------------------------------- floor plans
// x = across the house (front door wall at z = 0), z = into the house.
// stairs: "L"/"R" = the stair flight runs along that side of the room.
const P = (x, z, w, d, t, o = {}) => ({ x, z, w, d, t, ...o });
const TYPES = {
  victorian: {
    label: "Victorian terrace", door: 1.9, party: true, fire: true,
    paint: { living: "#9fb39a", bed: "#e2cfc0", kitchenDining: "#efe4c8", bath: "#d2e3e6", hall: "#d9c7a2", landing: "#d9c7a2", kids: "#c6dbef" },
    floors: [
      [P(0, 0, 2.6, 7.4, "hall", { stairs: "L" }), P(2.6, 0, 5, 7.4, "living"), P(0, 7.4, 7.6, 6.6, "kitchenDining")],
      [P(0, 0, 2.6, 7.4, "landing", { stairs: "L" }), P(2.6, 0, 5, 7.4, "bed"), P(0, 7.4, 4.2, 6.6, "kids"), P(4.2, 7.4, 3.4, 6.6, "bath")],
    ],
  },
  openModern: {
    label: "Modern townhouse", door: 1.9, party: true, island: true,
    paint: { living: "#eeeeea", kitchenDining: "#eeeeea", bed: "#dfe3e8", study: "#cfd8d2", bath: "#e9ecee", hall: "#f2f1ec", landing: "#f2f1ec" },
    floors: [
      [P(0, 0, 2.6, 7.4, "hall", { stairs: "L" }), P(2.6, 0, 5.4, 7.4, "living", { open: 1 }), P(0, 7.4, 8, 6.6, "kitchenDining", { open: 1 })],
      [P(0, 0, 2.6, 7.4, "landing", { stairs: "L" }), P(2.6, 0, 5.4, 7.4, "bed"), P(0, 7.4, 3.4, 6.6, "study"), P(3.4, 7.4, 4.6, 6.6, "bath")],
    ],
  },
  cottage: {
    label: "Cottage", door: 7.15, fire: true,
    paint: { living: "#efe2c4", kitchen: "#f3ecd6", utility: "#e6e1d3", bed: "#e8d5d5", bath: "#d8e8e0", kids: "#f1e2b3", study: "#d7d1c0", hall: "#e8dcc0", landing: "#e8dcc0" },
    floors: [
      [P(6.4, 0, 2.6, 7, "hall", { stairs: "R" }), P(0, 0, 6.4, 5.5, "living"), P(0, 5.5, 6.4, 4.5, "kitchen"), P(6.4, 7, 2.6, 3, "utility")],
      [P(6.4, 0, 2.6, 7, "landing", { stairs: "R" }), P(0, 0, 6.4, 5.5, "bed"), P(0, 5.5, 3.2, 4.5, "bath"), P(3.2, 5.5, 3.2, 4.5, "kids"), P(6.4, 7, 2.6, 3, "study")],
    ],
  },
  familyHouse: {
    label: "Family house", door: 4.9, fire: true,
    paint: { living: "#d7c9b2", study: "#a9b8a4", dining: "#e3d6bf", kitchen: "#f0ead8", bed: "#cfd9e4", bath: "#e3ecef", kids: "#f3d9c8", hall: "#e6dcc8", landing: "#e6dcc8" },
    floors: [
      [P(4.2, 0, 2.6, 7.5, "hall", { stairs: "R" }), P(0, 0, 4.2, 7.5, "living"), P(6.8, 0, 4.2, 5, "study"), P(6.8, 5, 4.2, 6, "dining", { open: 2 }), P(0, 7.5, 6.8, 3.5, "kitchen", { open: 2 })],
      [P(4.2, 0, 2.6, 7.5, "landing", { stairs: "R" }), P(0, 0, 4.2, 7.5, "bed"), P(6.8, 0, 4.2, 5.5, "kids"), P(6.8, 5.5, 4.2, 5.5, "bath"), P(0, 7.5, 6.8, 3.5, "study")],
    ],
  },
  brownstone: {
    label: "Brownstone", door: 1.9, party: true, fire: true, piano: true,
    paint: { living: "#7e8f7a", dining: "#b58c6a", kitchen: "#efe7d4", bed: "#cbb7a8", bath: "#e2e6e2", study: "#8c7a62", hall: "#c9b391", landing: "#c9b391" },
    floors: [
      [P(0, 0, 2.6, 8, "hall", { stairs: "L" }), P(2.6, 0, 5.4, 8, "living"), P(0, 8, 4, 7, "dining"), P(4, 8, 4, 7, "kitchen")],
      [P(0, 0, 2.6, 8, "landing", { stairs: "L" }), P(2.6, 0, 5.4, 8, "bed"), P(0, 8, 3, 7, "bath"), P(3, 8, 5, 7, "study")],
    ],
  },
  narrow: {
    label: "Narrow terrace", door: 4.35, party: true,
    paint: { living: "#e5d3b8", kitchenDining: "#f0e9d6", bed: "#d9d2e6", bath: "#dfeae6", kids: "#cfe5c9", hall: "#e8e0cc", landing: "#e8e0cc" },
    floors: [
      [P(3.6, 0, 2.6, 7.2, "hall", { stairs: "R" }), P(0, 0, 3.6, 7.2, "living"), P(0, 7.2, 6.2, 5.8, "kitchenDining")],
      [P(3.6, 0, 2.6, 7.2, "landing", { stairs: "R" }), P(0, 0, 3.6, 7.2, "bed"), P(0, 7.2, 2.8, 5.8, "bath"), P(2.8, 7.2, 3.4, 5.8, "kids")],
    ],
  },
  parisApartment: {
    label: "Paris apartment", door: 7, fire: true, piano: true,
    paint: { living: "#e9e2d0", dining: "#e9e2d0", kitchen: "#f1ede2", bed: "#d9cdd8", bath: "#e6eaea", hall: "#ede6d4" },
    floors: [[
      P(5.5, 0, 3, 6.5, "hall"), P(0, 0, 5.5, 5.5, "living"), P(8.5, 0, 5.5, 5.5, "dining", { open: 3 }),
      P(8.5, 5.5, 5.5, 4.5, "kitchen", { open: 3 }), P(0, 5.5, 5.5, 4.5, "bed"), P(5.5, 6.5, 3, 3.5, "bath"),
    ]],
  },
  studio: {
    label: "Studio flat", door: 6,
    paint: { studio: "#e7e4dc", kitchen: "#e7e4dc", bath: "#dfe9ec" },
    floors: [[P(0, 0, 12, 6.5, "studio", { open: 4 }), P(0, 6.5, 4, 2.5, "bath"), P(4, 6.5, 8, 2.5, "kitchen", { open: 4 })]],
  },
  mansionFlat: {
    label: "Mansion flat", door: 7.5, fire: true,
    paint: { living: "#b7c4cf", dining: "#e4d9c3", kitchen: "#efeadb", bed: "#e3cfc8", bath: "#dde7e9", kids: "#f2e3a6", hall: "#d8cdb7" },
    floors: [[
      P(6, 0, 3, 12, "hall"), P(0, 0, 6, 6.5, "living"), P(0, 6.5, 6, 5.5, "bed"), P(9, 0, 6, 5, "dining", { open: 5 }),
      P(9, 5, 6, 3.5, "kitchen", { open: 5 }), P(9, 8.5, 3, 3.5, "bath"), P(12, 8.5, 3, 3.5, "kids"),
    ]],
  },
  studentFlat: {
    label: "Shared flat", door: 6,
    paint: { kids: "#d5e2c6", living: "#f0d9b5", kitchen: "#f0d9b5", bath: "#e2eaec", hall: "#e6e2d8" },
    floors: [[
      P(5, 0, 2, 10, "hall"), P(0, 0, 5, 5, "kids"), P(0, 5, 5, 5, "kids"), P(7, 0, 5, 5, "living", { open: 6 }),
      P(7, 5, 5, 2.8, "kitchen", { open: 6 }), P(7, 7.8, 5, 2.2, "bath"),
    ]],
  },
  artistLoft: {
    label: "Artist loft", door: 5, fh: 5,
    paint: { artist: "#e9e6df", kitchen: "#e9e6df", bath: "#d9e3e5" },
    floors: [[P(0, 0, 10, 9, "artist", { open: 7 }), P(0, 9, 6, 5, "kitchen", { open: 7 }), P(6, 9, 4, 5, "bath")]],
  },
  penthouse: {
    label: "Penthouse", door: 4.5, piano: true, island: true,
    paint: { living: "#ecebe6", dining: "#ecebe6", kitchen: "#e4e6e8", bed: "#d6dbe2", bath: "#eceeee" },
    floors: [[
      P(0, 0, 9, 7, "living", { open: 8 }), P(9, 0, 7, 7, "dining", { open: 8 }), P(9, 7, 7, 5, "kitchen"),
      P(0, 7, 5.5, 5, "bed"), P(5.5, 7, 3.5, 5, "bath"),
    ]],
  },
};
const BY_KIND = {
  brown: ["brownstone", "victorian", "openModern", "artistLoft", "narrow"],
  house: ["cottage", "familyHouse", "openModern", "victorian"],
  lterr: ["victorian", "narrow", "openModern", "cottage", "brownstone"],
  haus: ["parisApartment", "studio", "penthouse", "studentFlat"],
  mansion: ["mansionFlat", "studentFlat", "penthouse", "studio", "parisApartment"],
};
export function homeType(home) {
  const list = BY_KIND[home.kind] || BY_KIND.house;
  return TYPES[list[(Math.imul(home.no, 7919) >>> 0) % list.length]];
}

let current = null;   // { home, meshes, solids, glowMeshes, exit: [x, z] }
export const insideHome = () => current;

// ---------------------------------------------------------------- door lookup
export function nearestHome(x, z, y) {
  if (y > 2.6) return null;
  let best = null, bd = 2.0;
  for (const h of homes) {
    if (Math.abs(h.tx - x) > bd || Math.abs(h.tz - z) > bd) continue;
    const d = Math.hypot(h.tx - x, h.tz - z);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
export function atExit(x, z) {
  return !!current && Math.hypot(current.exit[0] - x, current.exit[1] - z) < 1.5;
}

// ---------------------------------------------------------------- materials (made once, on first entry)
let K = null;
const paints = new Map();
function kit() {
  if (K) return K;
  const glassM = new BABYLON.StandardMaterial("homeWindow", scene);
  glassM.disableLighting = true;
  const waterM = litMat("homeWater", hex("#9fd0e6"), 0.8);
  const goldM = litMat("homeGold", hex("#b8924a"), 0.6);
  K = {
    glass: glassM, water: waterM, gold: goldM,
    brick: litMat("homeBrick", hex("#9a5a44")), porcelain: litMat("homePorcelain", hex("#f5f5f2"), 0.6),
    mirror: litMat("homeMirror", hex("#b9c8d2"), 0.9), black: litMat("homeBlack", hex("#141416"), 0.5),
    steel: litMat("homeSteel", hex("#b6bcc2"), 0.8), oak: litMat("homeOak", hex("#b78a5c"), 0.15),
  };
  return K;
}
function paintMat(c) {
  if (!paints.has(c)) paints.set(c, litMat("homePaint" + paints.size, hex(c)));
  return paints.get(c);
}
const acc = (mat, tw = 1, th = 1) => { mat.backFaceCulling = false; return { name: "home", mat, tw, th, pos: [], nrm: [], uv: [], idx: [], mesh: null }; };

// ---------------------------------------------------------------- enter / leave
export function enterHome(home) {
  if (current) leaveHome();
  const m0 = scene.meshes.length;
  const solids = [];
  captureSolids(solids);
  let info;
  const accs = [];
  const extra = furnishWith((orig) => acc(orig.mat, orig.tw, orig.th), (A, F) => { info = build(home, A, F, accs); });
  home.typeLabel = info.label;
  clearXF();
  captureSolids(null);
  const all = [...new Set([...extra, ...accs])];
  for (const a of all) {
    if (!a.pos.length) continue;
    const mesh = new BABYLON.Mesh("homePart", scene);
    const vd = new BABYLON.VertexData();
    vd.positions = a.pos; vd.normals = a.nrm; vd.uvs = a.uv; vd.indices = a.idx;
    vd.applyToMesh(mesh);
    mesh.material = a.mat;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    if (a.glow) glow.addIncludedOnlyMesh(mesh);
    a.mesh = mesh;
  }
  const meshes = scene.meshes.slice(m0);
  for (const mesh of meshes) mesh.layerMask = INSIDE_MASK;   // incl. plant instances
  current = { home, meshes, solids, glowMeshes: all.filter((a) => a.glow && a.mesh).map((a) => a.mesh), exit: info.exit };
  return info.spawn;
}
export function leaveHome() {
  if (!current) return null;
  const h = current.home;
  for (const m of current.glowMeshes) glow.removeIncludedOnlyMesh(m);
  for (const m of current.meshes) m.dispose(false, false);
  for (const s of current.solids) removeSolid(s);
  current = null;
  return { x: h.ox, y: 0, z: h.oz, yaw: h.outYaw };
}

// ---------------------------------------------------------------- interval helpers
function freeParts(a0, a1, blocks) {
  let parts = [[a0, a1]];
  for (const [b0, b1] of blocks) {
    const next = [];
    for (const [p0, p1] of parts) {
      if (b1 <= p0 || b0 >= p1) { next.push([p0, p1]); continue; }
      if (b0 > p0) next.push([p0, b0]);
      if (b1 < p1) next.push([b1, p1]);
    }
    parts = next;
  }
  return parts;
}
const EPS = 1e-4;

// ---------------------------------------------------------------- the builder
function build(home, A, F, accs) {
  const type = homeType(home);
  const Kt = kit();
  const night = world.night;
  const FH = type.fh || 3.4;
  const floors = type.floors;
  const W = Math.max(...floors[0].map((r) => r.x + r.w));
  const D = Math.max(...floors[0].map((r) => r.z + r.d));
  const base = makeXF(ORIGIN.x - W / 2, ORIGIN.z - D / 2, 0);
  setXF(base);
  const withFrame = (x, z, yaw, fn) => { setXF(makeXF(base.cx + x, base.cz + z, yaw)); fn(); setXF(base); };

  for (const m of paints.values()) m.emissiveColor = night ? new C3(0.3, 0.26, 0.2) : new C3(0.2, 0.2, 0.19);
  Kt.glass.emissiveColor = night ? hex("#14203a") : hex("#cfe6f6");
  const mk = (m, tw, th) => { const a = acc(m, tw, th); accs.push(a); return a; };
  const G = {
    glass: mk(Kt.glass), water: mk(Kt.water), gold: mk(Kt.gold), brick: mk(Kt.brick, 0.6, 0.6), porcelain: mk(Kt.porcelain),
    mirror: mk(Kt.mirror), black: mk(Kt.black), steel: mk(Kt.steel), oak: mk(Kt.oak),
  };
  const paintAcc = new Map();
  const paintOf = (t) => {
    const c = type.paint[t] || "#e6e1d6";
    if (!paintAcc.has(c)) paintAcc.set(c, mk(paintMat(c)));
    return paintAcc.get(c);
  };
  A.light.glow = true;

  // ---- per-floor room bookkeeping
  const doorX = type.door;
  const stairOf = (r) => {
    if (!r.stairs) return null;
    const sw = 1.1, N = 16, tread = 0.28;
    const sx0 = r.stairs === "L" ? r.x : r.x + r.w - sw, sx1 = sx0 + sw;
    const zs = r.z + 1.2;
    return { sx0, sx1, zs, ze: zs + N * tread, N, tread, side: r.stairs === "L" ? 2 : 3 };
  };
  const plans = floors.map((rooms, f) => rooms.map((r) => {
    const R = { ...r, f, y: f * FH, paint: paintOf(r.t), st: stairOf(r) };
    const onB = (s) => (s === 0 ? r.z < EPS : s === 1 ? r.z + r.d > D - EPS : s === 2 ? r.x < EPS : r.x + r.w > W - EPS);
    R.walls = [
      { axis: "x", fixed: r.z, a0: r.x, a1: r.x + r.w, nx: 0, nz: 1 },
      { axis: "x", fixed: r.z + r.d, a0: r.x, a1: r.x + r.w, nx: 0, nz: -1 },
      { axis: "z", fixed: r.x, a0: r.z, a1: r.z + r.d, nx: 1, nz: 0 },
      { axis: "z", fixed: r.x + r.w, a0: r.z, a1: r.z + r.d, nx: -1, nz: 0 },
    ].map((w, s) => ({ ...w, s, ext: onB(s), inset: onB(s) ? 0 : T_IN, blocks: [], win: [], doors: [] }));
    if (R.st) {
      // nothing may go against the stair side, nor across the flight's ends
      R.walls[R.st.side].blocks.push([-1e9, 1e9]);
      for (const s of [0, 1]) R.walls[s].blocks.push([R.st.sx0 - 0.1, R.st.sx1 + 0.1]);
    }
    return R;
  }));

  // ---- floors, slabs, ceiling
  const finishOf = (t) => (["kitchen", "kitchenDining", "bath", "utility"].includes(t) ? A.tileF : ["bed", "kids", "study"].includes(t) ? A.carpet : A.wood);
  const H = floors.length * FH;
  solidBox(-T_EX, -0.3, -T_EX, W + T_EX, 0, D + T_EX, () => null);
  solidBox(-T_EX, H, -T_EX, W + T_EX, H + 0.3, D + T_EX, (d) => (d === "-y" ? A.ceiling : null));
  let hole = null;
  for (const R of plans[0]) if (R.st) hole = { x0: R.st.sx0, x1: R.st.sx1, z0: R.st.zs - 0.02, z1: R.st.ze + 0.02 };
  const minusHole = (x0, z0, x1, z1) => {
    if (!hole || hole.x1 <= x0 || hole.x0 >= x1 || hole.z1 <= z0 || hole.z0 >= z1) return [[x0, z0, x1, z1]];
    const out = [];
    if (hole.z0 > z0) out.push([x0, z0, x1, hole.z0]);
    if (hole.z1 < z1) out.push([x0, hole.z1, x1, z1]);
    if (hole.x0 > x0) out.push([x0, Math.max(z0, hole.z0), hole.x0, Math.min(z1, hole.z1)]);
    if (hole.x1 < x1) out.push([hole.x1, Math.max(z0, hole.z0), x1, Math.min(z1, hole.z1)]);
    return out;
  };
  for (let f = 1; f < floors.length; f++) {
    const y = f * FH;
    for (const [a, b, c, d] of minusHole(-T_EX, -T_EX, W + T_EX, D + T_EX)) {
      solidBox(a, y - 0.3, b, c, y, d, (dir) => (dir === "-y" ? A.ceiling : dir === "+y" ? null : A.plaster));
    }
  }
  for (const rooms of plans) for (const R of rooms) {
    for (const [a, b, c, d] of R.f > 0 ? minusHole(R.x, R.z, R.x + R.w, R.z + R.d) : [[R.x, R.z, R.x + R.w, R.z + R.d]]) {
      addBox(a, R.y, b, c, R.y + 0.02, d, finishOf(R.t));
    }
  }

  // ---- exterior walls (per room, so each room keeps its own paint) + windows
  const win = (R, w, at, y0, wh) => {
    const ww = 1.3, f = 0.07, i = w.inset, n = [w.nx, w.nz];
    // build in wall-local terms then map: u = along wall, v = into room
    const B = (u0, y1, v0, u1, y2, v1, a) => {
      if (w.axis === "x") addBox(u0, y1, Math.min(w.fixed + n[1] * v0, w.fixed + n[1] * v1), u1, y2, Math.max(w.fixed + n[1] * v0, w.fixed + n[1] * v1), a);
      else addBox(Math.min(w.fixed + n[0] * v0, w.fixed + n[0] * v1), y1, u0, Math.max(w.fixed + n[0] * v0, w.fixed + n[0] * v1), y2, u1, a);
    };
    B(at - ww / 2, y0, i, at + ww / 2, y0 + wh, i + 0.012, G.glass);
    B(at - ww / 2 - f, y0 - f, i, at + ww / 2 + f, y0, i + 0.06, A.white);
    B(at - ww / 2 - f, y0 + wh, i, at + ww / 2 + f, y0 + wh + f, i + 0.06, A.white);
    B(at - ww / 2 - f, y0, i, at - ww / 2, y0 + wh, i + 0.06, A.white);
    B(at + ww / 2, y0, i, at + ww / 2 + f, y0 + wh, i + 0.06, A.white);
    B(at - 0.03, y0, i, at + 0.03, y0 + wh, i + 0.05, A.white);
    B(at - ww / 2, y0 + wh * 0.6, i, at + ww / 2, y0 + wh * 0.6 + 0.05, i + 0.05, A.white);
    B(at - ww / 2 - 0.12, y0 - 0.12, i, at + ww / 2 + 0.12, y0 - 0.05, i + 0.2, A.white);          // sill
    w.win.push([at - ww / 2 - 0.15, at + ww / 2 + 0.15]);
  };
  for (const rooms of plans) for (const R of rooms) {
    const y0 = R.y, y1 = R.y + FH;
    for (const w of R.walls) {
      if (!w.ext) continue;
      const lo = w.a0 - (w.a0 < EPS ? T_EX : 0), hi = w.a1 + (w.a1 > (w.axis === "x" ? W : D) - EPS ? T_EX : 0);
      const face = { 0: "+z", 1: "-z", 2: "+x", 3: "-x" }[w.s];
      const fn = (dir) => (dir === face ? R.paint : null);
      const seg = (u0, ya, u1, yb) => {
        if (u1 - u0 < EPS) return;
        if (w.axis === "x") solidBox(u0, ya, w.s === 0 ? -T_EX : D, u1, yb, w.s === 0 ? 0 : D + T_EX, fn);
        else solidBox(w.s === 2 ? -T_EX : W, ya, u0, w.s === 2 ? 0 : W + T_EX, yb, u1, fn);
      };
      const hasDoor = R.f === 0 && w.s === 0 && doorX > w.a0 && doorX < w.a1;
      if (hasDoor) {
        seg(lo, y0, doorX - 0.6, y1); seg(doorX + 0.6, y0, hi, y1); seg(doorX - 0.6, y0 + 2.4, doorX + 0.6, y1);
        solidBox(doorX - 0.6, y0, -T_EX + 0.02, doorX + 0.6, y0 + 2.4, -0.03, A.door);
        addBox(doorX - 0.72, y0, -0.03, doorX + 0.72, y0 + 2.52, 0.01, A.doorTrim);
        addBox(doorX - 0.58, y0, 0.01, doorX + 0.58, y0 + 2.38, 0.03, A.door);
        for (const [a, b] of [[-0.42, -0.06], [0.06, 0.42]]) for (const [c, d] of [[0.25, 1.05], [1.3, 2.2]]) addBox(doorX + a, y0 + c, 0.03, doorX + b, y0 + d, 0.045, A.darkWood);
        addBox(doorX + 0.4, y0 + 1.0, 0.03, doorX + 0.48, y0 + 1.08, 0.1, G.gold);
        w.blocks.push([doorX - 1.0, doorX + 1.0]); w.doors.push([doorX - 0.6, doorX + 0.6]);
      } else seg(lo, y0, hi, y1);
      // windows (not on party walls, not behind the stairs)
      if (type.party && w.s >= 2) continue;
      if (R.st && w.s === R.st.side) continue;
      const wh = Math.min(2.6, FH - 1.5);
      const parts = freeParts(w.a0 + 0.7, w.a1 - 0.7, hasDoor ? [[doorX - 1.2, doorX + 1.2]] : []);
      for (const [p0, p1] of parts) {
        const n = Math.floor((p1 - p0 + 1.3) / 2.7);
        for (let k = 0; k < n; k++) win(R, w, p0 + (p1 - p0) * (k + 0.5) / n, y0 + 0.95, wh);
      }
    }
  }

  // ---- interior walls between touching rooms, with doorways
  for (const rooms of plans) {
    for (let i = 0; i < rooms.length; i++) for (let j = 0; j < rooms.length; j++) {
      if (i === j) continue;
      const a = rooms[i], b = rooms[j];
      let axis, fixed, i0, i1, sa, sb;
      if (Math.abs(a.x + a.w - b.x) < EPS) { axis = "z"; fixed = b.x; i0 = Math.max(a.z, b.z); i1 = Math.min(a.z + a.d, b.z + b.d); sa = 3; sb = 2; }
      else if (Math.abs(a.z + a.d - b.z) < EPS) { axis = "x"; fixed = b.z; i0 = Math.max(a.x, b.x); i1 = Math.min(a.x + a.w, b.x + b.w); sa = 1; sb = 0; }
      else continue;
      if (i1 - i0 < 0.05) continue;
      const open = a.open && a.open === b.open;
      const y0 = a.y, y1 = a.y + FH;
      // doorway: avoid the stair side and the flight's ends, keep off corners
      let forbid = [];
      for (const R of [a, b]) if (R.st) {
        if ((R === a && sa === R.st.side) || (R === b && sb === R.st.side)) forbid.push([-1e9, 1e9]);
        if (axis === "x") forbid.push([R.st.sx0 - 0.1, R.st.sx1 + 0.1]);
      }
      let door = null;
      if (!open) {
        const parts = freeParts(i0 + 0.15, i1 - 0.15, forbid).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
        if (parts.length && parts[0][1] - parts[0][0] >= 1.05) {
          const len = parts[0][1] - parts[0][0], dw = Math.min(1.5, len - 0.1), c = (parts[0][0] + parts[0][1]) / 2;
          door = [c - dw / 2, c + dw / 2];
        }
      }
      for (const [R, s] of [[a, sa], [b, sb]]) {
        if (open) { R.walls[s].blocks.push([i0 - 0.6, i1 + 0.6]); R.walls[s].doors.push([i0, i1]); }
        else if (door) { R.walls[s].blocks.push([door[0] - 0.35, door[1] + 0.35]); R.walls[s].doors.push(door); }
      }
      if (open) continue;
      const fn = (dir) => {
        if (axis === "z") return dir === "-x" ? a.paint : dir === "+x" ? b.paint : dir === "+y" || dir === "-y" ? null : A.plaster;
        return dir === "-z" ? a.paint : dir === "+z" ? b.paint : dir === "+y" || dir === "-y" ? null : A.plaster;
      };
      const piece = (u0, ya, u1, yb) => {
        if (u1 - u0 < EPS) return;
        if (axis === "z") solidBox(fixed - T_IN, ya, u0, fixed + T_IN, yb, u1, fn);
        else solidBox(u0, ya, fixed - T_IN, u1, yb, fixed + T_IN, fn);
      };
      if (!door) { piece(i0, y0, i1, y1); continue; }
      piece(i0, y0, door[0], y1); piece(door[1], y0, i1, y1); piece(door[0], y0 + 2.4, door[1], y1);
      // architrave on both faces
      for (const sd of [-1, 1]) {
        const v0 = fixed + sd * T_IN, v1 = fixed + sd * (T_IN + 0.025);
        const T = (u0, ya, u1, yb) => axis === "z"
          ? addBox(Math.min(v0, v1), ya, u0, Math.max(v0, v1), yb, u1, A.white)
          : addBox(u0, ya, Math.min(v0, v1), u1, yb, Math.max(v0, v1), A.white);
        T(door[0] - 0.09, y0, door[0], y0 + 2.49); T(door[1], y0, door[1] + 0.09, y0 + 2.49); T(door[0] - 0.09, y0 + 2.4, door[1] + 0.09, y0 + 2.49);
      }
    }
  }

  // ---- stairs (ground floor flight) + guard rails round the hole upstairs
  for (const R of plans[0]) {
    if (!R.st || floors.length < 2) continue;
    const { sx0, sx1, zs, N, tread } = R.st, rise = FH / N;
    for (let k = 1; k <= N; k++) {
      const z0 = zs + (k - 1) * tread;
      solidBox(sx0, 0, z0, sx1, k * rise, z0 + tread, (d) => (d === "+y" ? G.oak : A.white));
      addBox(sx0, k * rise - 0.02, z0 - 0.02, sx1, k * rise + 0.01, z0 + 0.03, A.darkWood);   // nosing
    }
    const open = R.stairs === "L" ? sx1 : sx0, sgn = R.stairs === "L" ? 1 : -1;
    for (let k = 1; k <= N; k += 2) {
      const z = zs + (k - 0.5) * tread, top = k * rise;
      addBox(open - 0.025 * sgn - 0.02, top, z - 0.02, open - 0.025 * sgn + 0.02, top + 0.9, z + 0.02, A.white);
    }
    for (let k = 1; k <= N; k++) {
      const z0 = zs + (k - 1) * tread;
      addBox(open - 0.025 * sgn - 0.035, k * rise + 0.88, z0, open - 0.025 * sgn + 0.035, k * rise + 0.94, z0 + tread + 0.02, A.darkWood);
    }
    solidBox(open - 0.025 * sgn - 0.06, 0, zs - 0.12, open - 0.025 * sgn + 0.06, 1.1, zs, A.darkWood);   // newel post
    const y = FH;
    solidBox(Math.min(open, open + sgn * 0.05), y, hole.z0, Math.max(open, open + sgn * 0.05), y + 1.0, hole.z1, A.white);
    addBox(Math.min(open, open + sgn * 0.07) - 0.01, y + 1.0, hole.z0, Math.max(open, open + sgn * 0.07) + 0.01, y + 1.06, hole.z1, A.darkWood);
    solidBox(sx0, y, hole.z0 - 0.05, sx1, y + 1.0, hole.z0, A.white);
  }

  // ---------------------------------------------------------------- furniture
  // place(R, wall, width, depth, {tall}) → frame {x, z, yaw, nx, nz} on that wall, or null
  const place = (R, s, width, depth, o = {}) => {
    const w = R.walls[s];
    const blocks = o.tall ? w.blocks.concat(w.win) : w.blocks;
    const parts = freeParts(w.a0 + 0.12, w.a1 - 0.12, blocks).filter(([p0, p1]) => p1 - p0 >= width);
    if (!parts.length) return null;
    const mid = o.at === "start" ? w.a0 : o.at === "end" ? w.a1 : (w.a0 + w.a1) / 2;
    let bp = 0, bd = Infinity;
    for (const [p0, p1] of parts) { const p = clamp(mid, p0 + width / 2, p1 - width / 2); if (Math.abs(p - mid) < bd) { bd = Math.abs(p - mid); bp = p; } }
    w.blocks.push([bp - width / 2 - 0.05, bp + width / 2 + 0.05]);
    const off = w.inset + depth / 2 + (o.gap ?? 0.03);
    const x = w.axis === "x" ? bp : w.fixed + w.nx * off, z = w.axis === "x" ? w.fixed + w.nz * off : bp;
    return { x, z, yaw: Math.atan2(w.nx, w.nz), nx: w.nx, nz: w.nz, s };
  };
  const tryWalls = (R, order, width, depth, o) => { for (const s of order) { const fr = place(R, s, width, depth, o); if (fr) return fr; } return null; };
  const longFirst = (R) => (R.w >= R.d ? [1, 0, 2, 3] : [2, 3, 1, 0]);
  const opp = [1, 0, 3, 2], sides = (s) => (s < 2 ? [2, 3] : [0, 1]);
  const at = (fr, k) => [fr.x + fr.nx * k, fr.z + fr.nz * k];
  const inFrame = (fr, y, fn) => withFrame(fr.x, fr.z, fr.yaw, () => fn(y));

  // pieces are built in a frame whose back (-z) is against the wall
  const sofa = (y, w, fab) => {
    solidBox(-w / 2, y, -0.45, w / 2, y + 0.42, 0.45, fab);
    solidBox(-w / 2, y + 0.42, -0.45, w / 2, y + 0.95, -0.2, fab);
    for (const sx of [-1, 1]) addBox(sx * w / 2 - (sx > 0 ? 0.2 : 0), y + 0.42, -0.45, sx * w / 2 + (sx < 0 ? 0.2 : 0), y + 0.65, 0.45, fab);
    const n = Math.max(2, Math.round(w / 0.8));
    for (let k = 0; k < n; k++) { const x = -w / 2 + 0.22 + (k + 0.5) * (w - 0.44) / n; addBox(x - (w - 0.44) / n / 2 + 0.02, y + 0.42, -0.18, x + (w - 0.44) / n / 2 - 0.02, y + 0.52, 0.4, fab); }
    for (const x of [-w / 2 + 0.45, w / 2 - 0.45]) addBox(x - 0.22, y + 0.5, -0.24, x + 0.22, y + 0.88, -0.1, pick(A.fabrics));
  };
  const armchair = (y, fab) => sofa(y, 0.95, fab);
  const tvUnit = (y, w) => {
    solidBox(-w / 2, y, -0.22, w / 2, y + 0.5, 0.22, A.darkWood);
    const tw = Math.min(1.5, w - 0.2);
    addBox(-tw / 2, y + 0.62, -0.08, tw / 2, y + 1.46, -0.03, G.black);
    addBox(-tw / 2 + 0.03, y + 0.65, -0.03, tw / 2 - 0.03, y + 1.43, -0.025, A.screen);
    addBox(-0.15, y + 0.5, -0.1, 0.15, y + 0.62, 0, G.black);
  };
  const wardrobe = (y, w) => {
    solidBox(-w / 2, y, -0.3, w / 2, y + 2.15, 0.3, A.furnWood);
    addBox(-0.01, y + 0.05, 0.3, 0.01, y + 2.1, 0.31, A.darkWood);
    for (const sx of [-1, 1]) addBox(sx * 0.07 - 0.015, y + 1.0, 0.3, sx * 0.07 + 0.015, y + 1.3, 0.34, G.steel);
  };
  const dresser = (y, w) => {
    solidBox(-w / 2, y, -0.25, w / 2, y + 0.85, 0.25, A.furnWood);
    for (const h of [0.2, 0.45, 0.7]) addBox(-w / 2 + 0.05, y + h - 0.01, 0.25, w / 2 - 0.05, y + h + 0.01, 0.26, A.darkWood);
    F.plant(w / 2 - 0.25, 0, y + 0.85);
  };
  const bedGroup = (y, double, fab) => {
    const bw = double ? 1.6 : 0.95;
    solidBox(-bw / 2, y, -1.05, bw / 2, y + 0.38, 1.05, A.darkWood);
    addBox(-bw / 2 + 0.04, y + 0.38, -1.0, bw / 2 - 0.04, y + 0.56, 1.0, A.white);
    addBox(-bw / 2 + 0.02, y + 0.4, -0.25, bw / 2 - 0.02, y + 0.6, 1.03, fab);
    const pw = double ? [-0.38, 0.38] : [0];
    for (const x of pw) addBox(x - 0.3, y + 0.56, -0.95, x + 0.3, y + 0.7, -0.6, A.white);
    solidBox(-bw / 2 - 0.05, y, -1.13, bw / 2 + 0.05, y + 1.15, -1.05, A.darkWood);
    for (const sx of [-1, 1]) {
      const x = sx * (bw / 2 + 0.3);
      solidBox(x - 0.24, y, -1.05, x + 0.24, y + 0.55, -0.6, A.furnWood);
      addBox(x - 0.07, y + 0.55, -0.9, x + 0.07, y + 0.8, -0.76, A.light);
    }
  };
  const kitchenRun = (y, L, R, fr) => {
    solidBox(-L / 2, y, -0.31, L / 2, y + 0.88, 0.31, A.white);
    addBox(-L / 2 - 0.02, y + 0.88, -0.32, L / 2 + 0.02, y + 0.93, 0.34, A.counter);
    for (let x = -L / 2 + 0.6; x < L / 2 - 0.05; x += 0.6) addBox(x - 0.005, y + 0.06, 0.31, x + 0.005, y + 0.84, 0.315, A.gray);
    addBox(-L / 2, y + 0.03, 0.29, L / 2, y + 0.1, 0.32, G.black);                        // plinth
    const sink = -L / 4, hob = L / 4;
    addBox(sink - 0.3, y + 0.9, -0.2, sink + 0.3, y + 0.935, 0.2, G.steel);
    addBox(sink - 0.03, y + 0.93, -0.28, sink + 0.03, y + 1.2, -0.24, G.steel);
    addBox(hob - 0.3, y + 0.93, -0.25, hob + 0.3, y + 0.945, 0.25, G.black);
    addBox(hob - 0.3, y + 0.1, 0.31, hob + 0.3, y + 0.75, 0.32, G.black);                  // oven door
    // splashback + wall cupboards, but not over a window
    const w = R.walls[fr.s], sgn = fr.s === 0 || fr.s === 3 ? 1 : -1, c = w.axis === "x" ? fr.x : fr.z;
    const toLocal = (u) => (u - c) * sgn;
    const pieces = freeParts(c - L / 2, c + L / 2, w.win).map(([p, q]) => [toLocal(p), toLocal(q)].sort((m, n) => m - n));
    for (const [u0, u1] of pieces) {
      if (u1 - u0 < 0.4) continue;
      addBox(u0, y + 0.93, -0.31, u1, y + 1.5, -0.3, A.tileF);
      addBox(u0, y + 1.5, -0.31, u1, y + 2.2, 0.03, A.white);
      for (let x = u0 + 0.5; x < u1 - 0.05; x += 0.5) addBox(x - 0.005, y + 1.52, 0.03, x + 0.005, y + 2.18, 0.035, A.gray);
    }
  };
  const fridge = (y) => {
    solidBox(-0.36, y, -0.33, 0.36, y + 1.95, 0.33, G.steel);
    addBox(-0.35, y + 1.25, 0.33, 0.35, y + 1.27, 0.34, G.black);
    addBox(0.25, y + 0.5, 0.33, 0.29, y + 1.8, 0.38, G.black);
  };
  const diningSet = (cx, cz, y, w, d) => {
    withFrame(cx, cz, 0, () => {
      F.table(0, 0, y, w, d, 0.76, G.oak);
      const n = Math.max(1, Math.floor(w / 0.75));
      for (let k = 0; k < n; k++) {
        const x = -w / 2 + (k + 0.5) * w / n;
        F.chair(x, -d / 2 - 0.32, y, -1); F.chair(x, d / 2 + 0.32, y, 1);
      }
      addBox(-0.1, y + 0.76, -0.1, 0.1, y + 0.98, 0.1, A.pot);
    });
  };
  const island = (cx, cz, y, w) => withFrame(cx, cz, 0, () => {
    solidBox(-w / 2, y, -0.45, w / 2, y + 0.9, 0.45, A.white);
    addBox(-w / 2 - 0.05, y + 0.9, -0.5, w / 2 + 0.05, y + 0.95, 0.5, A.counter);
    for (let k = 0; k < 3; k++) {
      const x = -w / 2 + (k + 0.5) * w / 3;
      addBox(x - 0.03, y, 0.75, x + 0.03, y + 0.7, 0.81, G.steel);
      addBox(x - 0.2, y + 0.7, 0.58, x + 0.2, y + 0.75, 0.98, G.black);
    }
  });
  const coffeeTable = (fr, y, k) => { const [x, z] = at(fr, k); withFrame(x, z, fr.yaw, () => F.table(0, 0, y, 1.1, 0.6, 0.42, A.darkWood)); };
  const rug = (x, z, y, w, d, yaw = 0) => withFrame(x, z, yaw, () => addBox(-w / 2, y + 0.02, -d / 2, w / 2, y + 0.04, d / 2, pick(A.fabrics)));
  const picture = (R, y) => {
    const fr = tryWalls(R, [0, 1, 2, 3].sort(() => rand() - 0.5), rr(0.6, 1.1), 0.04, { tall: true, gap: 0.01 });
    if (!fr) return;
    const pw = rr(0.55, 1.0), ph = rr(0.45, 0.85);
    inFrame(fr, y, () => {
      addBox(-pw / 2, y + 1.45, -0.02, pw / 2, y + 1.45 + ph, 0.02, rand() < 0.5 ? G.gold : A.darkWood);
      addBox(-pw / 2 + 0.05, y + 1.5, 0.02, pw / 2 - 0.05, y + 1.4 + ph, 0.025, pick(A.fabrics));
    });
  };
  const plantAt = (R, y, big = true) => {
    const fr = tryWalls(R, [0, 1, 2, 3].sort(() => rand() - 0.5), 0.6, 0.6, { at: rand() < 0.5 ? "start" : "end" });
    if (fr) inFrame(fr, y, () => F.plant(0, 0, y, big));
  };
  const lampAt = (R, y) => {
    const fr = tryWalls(R, [2, 3, 0, 1], 0.45, 0.45, { at: "start", tall: true });
    if (!fr) return;
    inFrame(fr, y, () => {
      addBox(-0.18, y, -0.18, 0.18, y + 0.04, 0.18, G.black);
      solidBox(-0.025, y, -0.025, 0.025, y + 1.5, 0.025, G.black);
      addBox(-0.2, y + 1.45, -0.2, 0.2, y + 1.75, 0.2, A.light);
    });
  };
  const pendant = (x, z, ceil) => {
    addBox(x - 0.01, ceil - 0.7, z - 0.01, x + 0.01, ceil, z + 0.01, G.black);
    addBox(x - 0.22, ceil - 0.85, z - 0.22, x + 0.22, ceil - 0.68, z + 0.22, A.light);
  };
  const fireplace = (R, y) => {
    const fr = tryWalls(R, [2, 3, 1, 0], 1.8, 0.45, { tall: true, gap: 0 });
    if (!fr) return;
    inFrame(fr, y, () => {
      solidBox(-0.85, y, -0.22, 0.85, y + FH, 0.22, R.paint);
      addBox(-0.6, y, 0.22, 0.6, y + 1.05, 0.25, G.brick);
      addBox(-0.42, y + 0.06, 0.22, 0.42, y + 0.8, 0.255, G.black);
      addBox(-0.85, y + 1.08, 0.18, 0.85, y + 1.17, 0.42, A.white);
      addBox(-0.9, y, 0.22, 0.9, y + 0.05, 0.75, A.stoneDark);
      addBox(-0.45, y + 1.4, 0.22, 0.45, y + 2.2, 0.24, G.gold);
      addBox(-0.4, y + 1.45, 0.24, 0.4, y + 2.15, 0.25, G.mirror);
      for (const x of [-0.6, 0.6]) addBox(x - 0.05, y + 1.17, 0.25, x + 0.05, y + 1.4, 0.35, A.pot);
    });
  };
  const piano = (R, y) => {
    const fr = tryWalls(R, [0, 1, 2, 3], 1.55, 0.62, { tall: true });
    if (!fr) return;
    inFrame(fr, y, () => {
      solidBox(-0.75, y, -0.3, 0.75, y + 1.25, 0.12, G.black);
      solidBox(-0.75, y + 0.65, 0.12, 0.75, y + 0.78, 0.3, G.black);
      addBox(-0.7, y + 0.78, 0.13, 0.7, y + 0.82, 0.29, A.white);
      for (let x = -0.68; x < 0.68; x += 0.065) addBox(x, y + 0.82, 0.15, x + 0.03, y + 0.84, 0.24, G.black);
      solidBox(-0.45, y, 0.65, 0.45, y + 0.48, 1.0, G.black);
    });
  };
  const bookcase = (R, y) => { const fr = tryWalls(R, [0, 1, 2, 3].sort(() => rand() - 0.5), 1.05, 0.42, { tall: true }); if (fr) inFrame(fr, y, () => F.bookshelf(0, 0, y)); };

  // ---- rooms
  const living = (R) => {
    const y = R.y, fab = pick(A.fabrics);
    const sfr = tryWalls(R, longFirst(R), Math.min(2.4, Math.max(R.w, R.d) - 1.4), 0.95);
    if (sfr) {
      inFrame(sfr, y, () => sofa(y, Math.min(2.4, Math.max(R.w, R.d) - 1.4), fab));
      const [rx, rz] = at(sfr, 1.3);
      rug(rx, rz, y, 2.6, 1.8, sfr.yaw);
      coffeeTable(sfr, y, 1.45);
      const tv = tryWalls(R, [opp[sfr.s], ...sides(sfr.s)], 1.8, 0.45, { tall: true });
      if (tv) inFrame(tv, y, () => tvUnit(y, 1.8));
      for (const s of sides(sfr.s)) { const a = place(R, s, 0.95, 0.9); if (a) inFrame(a, y, () => armchair(y, pick(A.fabrics))); }
    }
    if (type.fire) fireplace(R, y);
    if (type.piano) piano(R, y);
    bookcase(R, y);
    lampAt(R, y);
    plantAt(R, y); plantAt(R, y);
    picture(R, y); picture(R, y);
  };
  const kitchen = (R, dining) => {
    const y = R.y;
    const order = [0, 1, 2, 3].sort((p, q) => {
      const len = (s) => R.walls[s].a1 - R.walls[s].a0;
      return len(q) - len(p);
    });
    let run = null;
    for (const s of order) {
      const w = R.walls[s];
      const best = freeParts(w.a0 + 0.12, w.a1 - 0.12, w.blocks).reduce((m, p) => Math.max(m, p[1] - p[0]), 0);
      if (best < 2.0) continue;
      const L = Math.min(4.2, best);
      run = place(R, s, L, 0.65, { gap: 0 });
      if (run) { inFrame(run, y, () => kitchenRun(y, L, R, run)); break; }
    }
    const fr = tryWalls(R, run ? [run.s, ...sides(run.s), opp[run.s]] : [0, 1, 2, 3], 0.75, 0.7, { tall: true });
    if (fr) inFrame(fr, y, () => fridge(y));
    const cx = R.x + R.w / 2, cz = R.z + R.d / 2;
    const room = Math.min(R.w, R.d);
    if (type.island && room >= 4.5) island(cx, cz, y, Math.min(2.4, Math.max(R.w, R.d) - 3));
    else if (dining && room >= 4.2) {
      const [tx, tz] = run ? [cx + run.nx * 0.5, cz + run.nz * 0.5] : [cx, cz];
      diningSet(tx, tz, y, Math.min(1.9, R.w - 2.8), Math.min(0.95, R.d - 3.2));
    } else if (room >= 3.6) diningSet(cx, cz, y, 0.9, 0.8);
    plantAt(R, y, false);
    picture(R, y);
  };
  const diningRoom = (R) => {
    const y = R.y;
    diningSet(R.x + R.w / 2, R.z + R.d / 2, y, Math.min(2.2, R.w - 2.6), Math.min(1.0, R.d - 2.8));
    const sb = tryWalls(R, longFirst(R), 1.6, 0.48);
    if (sb) inFrame(sb, y, () => { solidBox(-0.8, y, -0.24, 0.8, y + 0.85, 0.24, A.darkWood); addBox(-0.15, y + 0.85, -0.1, 0.15, y + 1.15, 0.1, A.pot); });
    plantAt(R, y); picture(R, y); picture(R, y);
  };
  const bedroom = (R, double = true) => {
    const y = R.y;
    const bfr = tryWalls(R, longFirst(R).reverse(), (double ? 1.6 : 0.95) + 1.15, 2.2, { tall: true });
    if (bfr) {
      inFrame(bfr, y, () => bedGroup(y, double, pick(A.fabrics)));
      if ((bfr.s < 2 ? R.d : R.w) > 4.8) { const [rx, rz] = at(bfr, 2.4); rug(rx, rz, y, 2.0, 1.2, bfr.yaw); }
    }
    const wfr = tryWalls(R, [0, 1, 2, 3].sort(() => rand() - 0.5), 1.6, 0.62, { tall: true });
    if (wfr) inFrame(wfr, y, () => wardrobe(y, 1.6));
    const dfr = tryWalls(R, [0, 1, 2, 3], 1.2, 0.5);
    if (dfr) inFrame(dfr, y, () => dresser(y, 1.2));
    plantAt(R, y); picture(R, y);
  };
  const kids = (R) => {
    const y = R.y;
    bedroom(R, false);
    const d = tryWalls(R, [0, 1, 2, 3], 1.45, 0.8, { tall: true });
    if (d) inFrame(d, y, () => F.desk(0, 0, y, 1));
    const t = tryWalls(R, [0, 1, 2, 3], 0.85, 0.5);
    if (t) inFrame(t, y, () => { solidBox(-0.42, y, -0.25, 0.42, y + 0.45, 0.25, pick(A.fabrics)); addBox(-0.15, y + 0.45, -0.1, 0.05, y + 0.62, 0.1, pick(A.fabrics)); });
    bookcase(R, y);
  };
  const study = (R) => {
    const y = R.y;
    const d = tryWalls(R, longFirst(R), 1.45, 0.8, { tall: true });
    if (d) inFrame(d, y, () => F.desk(0, 0, y, 1));
    bookcase(R, y); bookcase(R, y);
    const a = tryWalls(R, [0, 1, 2, 3], 0.95, 0.9);
    if (a) inFrame(a, y, () => armchair(y, pick(A.fabrics)));
    lampAt(R, y); plantAt(R, y); picture(R, y);
    rug(R.x + R.w / 2, R.z + R.d / 2, y, Math.min(2.2, R.w - 1.6), Math.min(1.6, R.d - 1.6));
  };
  const bath = (R) => {
    const y = R.y;
    // tile wainscot (below the window sills)
    for (const w of R.walls) {
      for (const [p0, p1] of freeParts(w.a0, w.a1, w.doors)) {
        const v0 = w.fixed + (w.axis === "x" ? w.nz : w.nx) * w.inset, v1 = v0 + (w.axis === "x" ? w.nz : w.nx) * 0.012;
        if (w.axis === "x") addBox(p0, y, Math.min(v0, v1), p1, y + 0.9, Math.max(v0, v1), A.tileF);
        else addBox(Math.min(v0, v1), y, p0, Math.max(v0, v1), y + 0.9, p1, A.tileF);
      }
    }
    const tub = tryWalls(R, longFirst(R), 1.75, 0.78, { gap: 0.02 });
    if (tub) inFrame(tub, y, () => {
      solidBox(-0.875, y, -0.39, 0.875, y + 0.56, 0.39, G.porcelain);
      addBox(-0.78, y + 0.5, -0.3, 0.78, y + 0.565, 0.3, G.water);
      addBox(0.6, y + 0.56, -0.38, 0.66, y + 0.8, -0.32, G.steel);
    });
    const wc = tryWalls(R, [0, 1, 2, 3], 0.6, 0.7);
    if (wc) inFrame(wc, y, () => {
      solidBox(-0.2, y, -0.1, 0.2, y + 0.42, 0.33, G.porcelain);
      solidBox(-0.25, y, -0.35, 0.25, y + 0.85, -0.1, G.porcelain);
      addBox(-0.21, y + 0.42, -0.1, 0.21, y + 0.45, 0.34, A.white);
    });
    const bs = tryWalls(R, [0, 1, 2, 3], 0.75, 0.5, { tall: true });
    if (bs) inFrame(bs, y, () => {
      solidBox(-0.08, y, -0.25, 0.08, y + 0.75, -0.05, G.porcelain);
      addBox(-0.32, y + 0.75, -0.25, 0.32, y + 0.88, 0.2, G.porcelain);
      addBox(-0.03, y + 0.88, -0.22, 0.03, y + 1.02, -0.12, G.steel);
      addBox(-0.32, y + 1.15, -0.25, 0.32, y + 1.95, -0.23, G.mirror);
    });
    const tr = tryWalls(R, [0, 1, 2, 3], 0.6, 0.1, { tall: true, gap: 0 });
    if (tr) inFrame(tr, y, () => { addBox(-0.3, y + 1.0, -0.05, 0.3, y + 1.02, 0.03, G.steel); addBox(-0.25, y + 0.55, 0.0, 0.25, y + 1.02, 0.04, pick(A.fabrics)); });
    rug(R.x + R.w / 2, R.z + R.d / 2, y, 0.9, 0.55);
    plantAt(R, y, false);
  };
  const utility = (R) => {
    const y = R.y;
    for (let k = 0; k < 2; k++) {
      const fr = tryWalls(R, [1, 2, 3, 0], 0.65, 0.65);
      if (fr) inFrame(fr, y, () => { solidBox(-0.3, y, -0.3, 0.3, y + 0.85, 0.3, A.white); addBox(-0.18, y + 0.25, 0.3, 0.18, y + 0.6, 0.32, G.black); });
    }
    bookcase(R, y); plantAt(R, y, false);
  };
  const hall = (R) => {
    const y = R.y;
    const cr = tryWalls(R, [0, 1, 2, 3], 0.5, 0.45, { tall: true, at: "start" });
    if (cr && R.f === 0) inFrame(cr, y, () => {
      solidBox(-0.04, y, -0.04, 0.04, y + 1.8, 0.04, A.darkWood);
      for (const a of [0, 1.6, 3.2, 4.8]) addBox(Math.cos(a) * 0.15 - 0.03, y + 1.6, Math.sin(a) * 0.15 - 0.03, Math.cos(a) * 0.15 + 0.03, y + 1.7, Math.sin(a) * 0.15 + 0.03, A.darkWood);
      addBox(-0.18, y + 1.0, -0.05, 0.12, y + 1.6, 0.12, pick(A.fabrics));
    });
    const con = tryWalls(R, [3, 2, 1, 0], 1.0, 0.36);
    if (con) inFrame(con, y, () => { F.table(0, 0, y, 1.0, 0.36, 0.8, A.darkWood); addBox(-0.08, y + 0.8, -0.08, 0.08, y + 1.15, 0.08, A.light); });
    plantAt(R, y); picture(R, y); picture(R, y);
    rug(R.x + R.w / 2 + (R.st ? (R.st.side === 2 ? 0.55 : -0.55) : 0), R.z + (R.st ? 0.7 : R.d / 2), y, R.st ? 1.2 : 1.1, R.st ? 1.0 : Math.min(3.5, R.d - 1.5));
  };
  const artist = (R) => {
    const y = R.y;
    const bfr = tryWalls(R, [1, 2, 3], 1.6 + 1.15, 2.2, { tall: true });
    if (bfr) inFrame(bfr, y, () => bedGroup(y, true, pick(A.fabrics)));
    const sfr = tryWalls(R, [2, 3, 1, 0], 2.2, 0.95);
    if (sfr) { inFrame(sfr, y, () => sofa(y, 2.2, pick(A.fabrics))); coffeeTable(sfr, y, 1.45); }
    // easels with canvases in the middle of the floor
    for (const [ox, oz, yaw] of [[-1.4, 0.2, 0.4], [1.3, -0.4, -0.5]]) {
      withFrame(R.x + R.w / 2 + ox, R.z + R.d / 2 + oz, yaw, () => {
        for (const sx of [-0.3, 0.3]) addBox(sx - 0.025, y, -0.05, sx + 0.025, y + 1.8, 0.0, A.furnWood);
        addBox(-0.025, y, 0.3, 0.025, y + 1.6, 0.35, A.furnWood);
        addBox(-0.42, y + 0.85, 0.0, 0.42, y + 0.9, 0.08, A.furnWood);
        addBox(-0.4, y + 0.9, -0.04, 0.4, y + 1.6, 0.0, A.white);
        for (let k = 0; k < 5; k++) addBox(rr(-0.35, 0.2), y + rr(0.95, 1.45), -0.05, rr(0.22, 0.38), y + rr(1.0, 1.55), -0.04, pick(A.fabrics));
        F.item(0, 0.9, y, 0.4, 0.4, 0.6, A.darkWood);
      });
    }
    for (let k = 0; k < 4; k++) {
      const fr = tryWalls(R, [0, 1, 2, 3].sort(() => rand() - 0.5), 0.9, 0.12);
      if (fr) inFrame(fr, y, () => { addBox(-0.45, y, -0.06, 0.45, y + 1.1, 0.0, A.white); addBox(-0.4, y + 0.05, 0.0, 0.4, y + 1.05, 0.01, pick(A.fabrics)); });
    }
    rug(R.x + R.w / 2, R.z + R.d / 2, y, 3.2, 2.4);
    bookcase(R, y); plantAt(R, y); plantAt(R, y); plantAt(R, y); lampAt(R, y);
  };
  const studioRoom = (R) => {
    const y = R.y;
    const bfr = tryWalls(R, [2, 3], 1.6 + 1.15, 2.2, { tall: true });
    if (bfr) inFrame(bfr, y, () => bedGroup(y, true, pick(A.fabrics)));
    living(R);
    const d = tryWalls(R, [0, 1, 2, 3], 1.45, 0.8, { tall: true });
    if (d) inFrame(d, y, () => F.desk(0, 0, y, 1));
  };

  for (const rooms of plans) for (const R of rooms) {
    switch (R.t) {
      case "living": living(R); break;
      case "kitchen": kitchen(R, false); break;
      case "kitchenDining": kitchen(R, true); break;
      case "dining": diningRoom(R); break;
      case "bed": bedroom(R, true); break;
      case "kids": kids(R); break;
      case "study": study(R); break;
      case "bath": bath(R); break;
      case "utility": utility(R); break;
      case "hall": case "landing": hall(R); break;
      case "artist": artist(R); break;
      case "studio": studioRoom(R); break;
    }
    // ceiling lights (hall lights stay clear of the stair opening)
    const ceil = R.y + FH - (R.f < floors.length - 1 ? 0.3 : 0);
    if (R.st) pendant((R.st.side === 2 ? (R.st.sx1 + R.x + R.w) / 2 : (R.x + R.st.sx0) / 2), R.f === 0 ? R.z + 0.6 : R.z + R.d - 0.7, ceil);
    else if (R.w * R.d > 32) {
      const long = R.w > R.d;
      for (const k of [-1, 1]) pendant(R.x + R.w / 2 + (long ? k * R.w / 4 : 0), R.z + R.d / 2 + (long ? 0 : k * R.d / 4), ceil);
    } else pendant(R.x + R.w / 2, R.z + R.d / 2, ceil);
    // skirting boards
    for (const w of R.walls) {
      for (const [p0, p1] of freeParts(w.a0, w.a1, w.doors)) {
        const v0 = w.fixed + (w.axis === "x" ? w.nz : w.nx) * w.inset, v1 = v0 + (w.axis === "x" ? w.nz : w.nx) * 0.02;
        if (w.axis === "x") addBox(p0, R.y, Math.min(v0, v1), p1, R.y + 0.12, Math.max(v0, v1), A.white);
        else addBox(Math.min(v0, v1), R.y, p0, Math.max(v0, v1), R.y + 0.12, p1, A.white);
      }
    }
  }

  const [sx, sz] = xfp(base, doorX, 1.7);
  const [ex, ez] = xfp(base, doorX, 0.6);
  return { spawn: { x: sx, y: 0, z: sz, yaw: 0 }, exit: [ex, ez], label: type.label };
}
