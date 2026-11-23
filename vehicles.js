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
  decker: {
    name: "double-decker", kind: "car", hw: 1.3, hd: 5.45, ht: 4.45, circles: [-4.2, -2.1, 0, 2.1, 4.2], r: 1.33,
    accel: 4.2, max: 70 * KMH, boost: 1.15, rev: 4, brake: 16, turn: 0.95, camDist: 18, camH: 5.6, hits: 14, label: "Drive double-decker",
    traffic: 0.7,
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
// Vehicles are sculpted from Babylon primitives: lofted ribbons for the body
// shells (rounded cross-sections swept along the car's length), tori for
// tyres, arc-cylinders for wheel arches / mudguards, and oriented struts for
// pillars, forks and frames. Parts are merged per material so each template
// is only a handful of draw calls, then instanced.
const MB = BABYLON.MeshBuilder;
const V3b = BABYLON.Vector3;
let headM, tailM, tyreM, chromeM, darkM, glassM, rimM, plateM, burntM, burntGlassM;
const burntCache = {};
// Level of detail (instances follow their template's levels automatically):
//   < LOD_NEAR  full model
//   < LOD_MID   level 1: no spokes / handles / small trim, fewer segments
//   < LOD_FAR   level 2: body shells, glass, lights and plain wheels only
//   beyond      not drawn (the fog hides them anyway)
const LOD_NEAR = 25, LOD_MID = 80, LOD_FAR = 230;
let LO = 0;                                       // detail level being built (0 = full)

// Cross-section of a lofted panel at station z: flat bottom with small
// chamfers, sides from half-width hb (bottom) to ht (top), rounded top corners
// of radius c. Points run counter-clockwise seen from +z (outward normals).
function ring(z, y0, y1, hb, ht, c, cx = 0) {
  const h = y1 - y0;
  c = Math.max(0.004, Math.min(c, h * 0.48, ht * 0.9));
  const cb = Math.min(c, 0.05, h * 0.25, hb * 0.5);
  const pts = [[hb - cb, y0], [hb, y0 + cb], [ht, y1 - c]];
  if (!LO) for (const a of [Math.PI / 6, Math.PI / 3]) pts.push([ht - c + c * Math.cos(a), y1 - c + c * Math.sin(a)]);
  pts.push([ht - c, y1], [c - ht, y1]);
  if (!LO) for (const a of [Math.PI * 2 / 3, Math.PI * 5 / 6]) pts.push([c - ht + c * Math.cos(a), y1 - c + c * Math.sin(a)]);
  pts.push([-ht, y1 - c], [-hb, y0 + cb], [cb - hb, y0]);
  return pts.map(([x, y]) => new V3b(x + cx, y, z));
}

// Build a template from a parts function. The P.* helpers add parts with a
// material key: body, accent, glass, dark, chrome, rim, tyre, plate, light, tail.
function mats(name, colors, burnt = false) {
  const paint = (n, c) => { const m = litMat(n, hex(c), 0.5); m.specularPower = 80; return m; };
  return burnt
    ? { body: burntM, accent: burntM, glass: burntGlassM, dark: burntM, chrome: burntM, rim: burntM, tyre: tyreM, plate: burntM, light: null, tail: null }
    : {
      body: paint(name + "Body", colors.body),
      accent: paint(name + "Accent", colors.accent || colors.body),
      glass: glassM, dark: darkM, chrome: chromeM, rim: rimM, tyre: tyreM, plate: plateM, light: headM, tail: tailM,
    };
}
// Low-detail levels skip parts smaller than this (lights are always kept).
const small = (mat, ...dims) => LO > 0 && mat !== "light" && mat !== "tail" && Math.max(...dims) < (LO > 1 ? 0.6 : 0.2);
function build(name, M, partsFn, glowIt, lo = 0) {
  LO = lo;
  const groups = new Map();                      // material -> meshes
  const add = (mesh, key) => {
    const m = M[key];
    if (!m) { mesh.dispose(); return; }
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(mesh);
  };
  const P = {
    box(w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
      if (!M[mat] || small(mat, w, h, d)) return;
      const m = MB.CreateBox("p", { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      add(m, mat);
    },
    // cylinder: axis is Y, turned by rx / rz (rz = PI/2 → axis along X, rx = PI/2 → along Z)
    cyl(dia, h, x, y, z, mat, rx = 0, rz = 0, tess = 16) {
      if (!M[mat] || small(mat, dia, h)) return;
      const c = MB.CreateCylinder("c", { diameter: dia, height: h, tessellation: LO > 1 ? 6 : LO ? 8 : Math.min(tess, 14) }, scene);
      c.position.set(x, y, z); c.rotation.x = rx; c.rotation.z = rz;
      add(c, mat);
    },
    torus(dia, thick, x, y, z, mat, rx = 0, rz = 0, sy = 1) {
      if (!M[mat]) return;
      const t = MB.CreateTorus("t", { diameter: dia, thickness: thick, tessellation: LO > 1 ? 6 : LO ? 8 : 12 }, scene);
      t.scaling.y = sy; t.rotation.x = rx; t.rotation.z = rz; t.position.set(x, y, z);
      add(t, mat);
    },
    // Rod / bar between points a and b. d = width; box = false → round,
    // true → square, number → box of that height.
    strut(mat, a, b, d, box = false) {
      const A = new V3b(a[0], a[1], a[2]), B = new V3b(b[0], b[1], b[2]), len = V3b.Distance(A, B);
      if (!M[mat] || (LO === 1 && d < 0.07 && box !== true) || (LO > 1 && len < 0.5)) return;
      let m;
      if (box) m = MB.CreateBox("s", { width: d, height: box === true ? d : box, depth: len }, scene);
      else {
        m = MB.CreateCylinder("s", { diameter: d, height: len, tessellation: LO > 1 ? 4 : LO ? 5 : 8 }, scene);
        m.rotation.x = Math.PI / 2; m.bakeCurrentTransformIntoVertices();
      }
      m.position = A.add(B).scaleInPlace(0.5);
      m.lookAt(B);
      add(m, mat);
    },
    // Lofted shell through stations [z, y0, y1, hb, ht, c, cx?] (any order).
    loft(mat, stations, caps = true) {
      if (!M[mat]) return;
      const rings = [...stations].sort((p, q) => p[0] - q[0]).map((s) => ring(...s));
      add(MB.CreateRibbon("l", { pathArray: rings, closePath: true }, scene), mat);
      if (!caps) return;
      const centre = (r) => {
        const c = r.reduce((acc, p) => acc.addInPlace(p), new V3b(0, 0, 0)).scaleInPlace(1 / r.length);
        return r.map(() => c.clone());
      };
      const first = rings[0], last = rings[rings.length - 1];
      add(MB.CreateRibbon("cap", { pathArray: [centre(first), first], closePath: true }, scene), mat);
      add(MB.CreateRibbon("cap", { pathArray: [last, centre(last)], closePath: true }, scene), mat);
    },
    // Wheel with axis along X: rounded tyre, rim barrel, spoked face + hub on
    // the outward side (both sides for bikes).
    wheel(dia, width, x, y, z, o = {}) {
      const tk = dia * (o.profile ?? 0.2);
      if (LO > 1) { P.cyl(dia, width, x, y, z, "tyre", 0, Math.PI / 2); return; }
      P.torus(dia - tk, tk, x, y, z, "tyre", 0, Math.PI / 2, width / tk);
      const rd = dia - tk * 1.6, rimMat = o.rimMat ?? "rim";
      P.cyl(rd, width * 0.8, x, y, z, rimMat, 0, Math.PI / 2);
      if (LO) return;
      const sides = o.both ? [-1, 1] : [Math.sign(x) || 1];
      for (const s of sides) {
        const fx = x + s * width * 0.41;
        P.cyl(rd * 0.82, 0.012, fx, y, z, "dark", 0, Math.PI / 2);
        const n = o.spokes ?? 5;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          P.box(0.02, rd * 0.4, rd * 0.11, fx + s * 0.008, y + Math.cos(a) * rd * 0.2, z + Math.sin(a) * rd * 0.2, rimMat, a);
        }
        P.cyl(rd * 0.2, 0.03, fx + s * 0.012, y, z, "chrome", 0, Math.PI / 2, 10);
      }
    },
    // Dark half-disc on a car's flank behind a wheel: reads as the wheel well.
    arch(r, x, y, z, mat = "dark", th = 0.02) {
      if (!M[mat]) return;
      const a = MB.CreateCylinder("a", { diameter: r * 2, height: th, arc: 0.5, enclose: true, tessellation: LO ? 6 : 12 }, scene);
      a.rotation.set(Math.PI / 2, Math.PI / 2, 0); a.position.set(x, y, z);
      add(a, mat);
    },
    // Open curved mudguard over a wheel (axis X). a0 = start angle measured
    // from straight back (0) over the top (PI/2) to straight forward (PI).
    fender(r, w, x, y, z, a0, span, mat) {
      if (!M[mat]) return;
      const f = MB.CreateCylinder("f", {
        diameter: r * 2, height: w, arc: span / (Math.PI * 2), tessellation: LO ? 5 : 9,
        cap: BABYLON.Mesh.NO_CAP, sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      }, scene);
      f.rotation.set(Math.PI / 2, Math.PI / 2, 0); f.bakeCurrentTransformIntoVertices();
      f.rotation.set(a0, 0, 0); f.position.set(x, y, z);
      add(f, mat);
    },
  };
  partsFn(P);
  LO = 0;
  // one mesh per material → few draw calls per instanced template
  const parts = [];
  for (const [mat, list] of groups) {
    const mesh = list.length === 1 ? list[0] : BABYLON.Mesh.MergeMeshes(list, true, true);
    parts.push({ mesh, mat });
  }
  const t = mergedTemplate(name, parts, glowIt);
  if (!lo) t.addLODLevel(LOD_FAR, null);          // not drawn beyond LOD_FAR
  return t;
}
// Template factory: remembers its spec + how to build its burnt wreck.
// Instances follow their template's LOD levels automatically.
function model(specKey, name, colors, partsFn) {
  const M = mats(name, colors);
  const t = build(name, M, partsFn, true);
  // Only the near, full model blooms; the glow pass re-renders every included
  // mesh, so the far levels stay out of it (their lights are still bright).
  t.addLODLevel(LOD_NEAR, build(name + "Lo", M, partsFn, false, 1));
  t.addLODLevel(LOD_MID, build(name + "Lo2", M, partsFn, false, 2));
  t.specKey = specKey;
  t.burnKey = specKey + ":" + name.replace(/\d+$/, "");
  t.buildBurnt = () => build(name + "Burnt", mats(name, colors, true), partsFn, false);
  return t;
}

// ---- cars (sedan / hatch / taxi / SUV / supercar / van share one body generator) ----
// Lengths along Z (front = +Z). The body is a lower shell (belt line from the
// bonnet at wsBase to the boot deck at rearBase), a glass house on top with a
// painted roof skin and A/B/C pillars, and trim: lights, grille, bumpers,
// mirrors, handles, sills, wheel arches.
function carParts(o) {
  const L = o.len, W = o.hw, h2 = L / 2, y0 = o.y0, wd = o.wheel, ww = o.ww ?? 0.24;
  const zf = o.zf, zr = o.zr, rY = o.roofY, gW = W - 0.1, rw = o.roofW ?? W - 0.2;
  const beltAt = (z) => o.deckY + (o.hoodY - o.deckY) * clamp((z - o.rearBase) / (o.wsBase - o.rearBase), 0, 1);
  return function car(P) {
    // lower body shell
    const st = [[-h2, y0 + 0.1, o.tailY - 0.07, W - 0.1, W - 0.16, 0.1], [-h2 + 0.14, y0, o.tailY, W - 0.01, W - 0.07, 0.12]];
    if (o.rearBase > -h2 + 0.3) st.push([o.rearBase, y0, o.deckY, W, W - 0.05, 0.12]);
    for (const z of o.mid ?? []) st.push([z, y0, beltAt(z), W, W - 0.05, 0.12]);
    if (o.wsBase < h2 - 0.3) st.push([o.wsBase, y0, o.hoodY, W, W - 0.05, 0.12]);
    st.push([h2 - 0.14, y0, o.noseY, W - 0.01, W - 0.09, 0.12], [h2, y0 + 0.1, o.noseY - 0.08, W - 0.12, W - 0.2, 0.1]);
    P.loft("body", st);

    // glass house (windscreen, side windows, rear window)
    P.loft("glass", [
      [o.rearBase, beltAt(o.rearBase) - 0.07, beltAt(o.rearBase) + 0.01, gW, gW - 0.02, 0.02],
      [o.roofR, beltAt(o.roofR) - 0.07, rY, gW, rw, 0.1],
      [o.roofF, beltAt(o.roofF) - 0.07, rY, gW, rw, 0.1],
      [o.wsBase, o.hoodY - 0.07, o.hoodY + 0.01, gW, gW - 0.02, 0.02],
    ]);
    // painted roof skin
    const rf = o.roofF - 0.04, rb = o.roofR + 0.04;
    P.loft("body", [
      [rb, rY - 0.05, rY + 0.01, rw + 0.01, rw - 0.04, 0.04],
      [rb + 0.1, rY - 0.06, rY + 0.03, rw + 0.025, rw - 0.03, 0.05],
      [rf - 0.1, rY - 0.06, rY + 0.03, rw + 0.025, rw - 0.03, 0.05],
      [rf, rY - 0.05, rY + 0.01, rw + 0.01, rw - 0.04, 0.04],
    ]);
    // panel van: painted cargo sides cover the glass behind the cab
    if (o.cargo != null) {
      P.loft("body", [
        [o.rearBase - 0.01, beltAt(o.rearBase) - 0.08, rY - 0.01, gW + 0.012, rw + 0.012, 0.1],
        [o.cargo, beltAt(o.cargo) - 0.08, rY - 0.01, gW + 0.012, rw + 0.012, 0.1],
      ]);
    }
    const pm = o.pillar ?? "body";
    for (const s of [-1, 1]) {
      P.strut(pm, [s * gW, o.hoodY - 0.01, o.wsBase - 0.02], [s * rw, rY - 0.03, o.roofF + 0.02], 0.075, true);
      P.strut(pm, [s * gW, o.deckY - 0.01, o.rearBase + 0.03], [s * rw, rY - 0.03, o.roofR - 0.02], 0.075, o.cW ?? 0.16);
      if (o.bPillar != null) P.strut("dark", [s * (gW + 0.01), beltAt(o.bPillar) - 0.03, o.bPillar], [s * (rw + 0.012), rY - 0.03, o.bPillar - 0.05], 0.05, 0.11);
      // lights
      P.box(o.headW ?? 0.36, o.headH ?? 0.11, 0.12, s * (W - 0.3), o.noseY - 0.12, h2 - 0.05, "light");
      P.box(o.tailW ?? 0.38, o.tailH ?? 0.11, 0.12, s * (W - 0.28), o.tailY - 0.13, -h2 + 0.05, "tail");
      // mirror on a stalk
      P.box(0.07, 0.11, 0.17, s * (W + 0.05), o.hoodY + 0.1, o.wsBase - 0.2, "body");
      P.box(0.12, 0.04, 0.06, s * (W - 0.02), o.hoodY + 0.07, o.wsBase - 0.17, "dark");
      // sill + door handles
      P.box(0.04, 0.08, zf - zr - wd - 0.1, s * (W - 0.01), y0 + 0.06, (zf + zr) / 2, "dark");
      for (const z of o.handles ?? []) P.box(0.04, 0.03, 0.13, s * (W - 0.02), beltAt(z) - 0.1, z, "chrome");
      // wheels in dark arches
      for (const [z, d] of [[zf, wd], [zr, o.wheelR ?? wd]]) {
        P.arch(d / 2 + (o.archPad ?? 0.07), s * W, d / 2, z, "dark");
        P.wheel(d, ww, s * (W + 0.05 - ww / 2), d / 2, z, { spokes: o.spokes });
      }
    }
    // grille, intakes, bumpers, number plates
    P.box(o.grilleW ?? (W - 0.42) * 2, o.grilleH ?? 0.13, 0.1, 0, o.noseY - 0.13, h2 - 0.04, "dark");
    P.box((W - 0.2) * 2, 0.09, 0.1, 0, y0 + 0.13, h2 - 0.04, "dark");
    P.box((W - 0.2) * 2, 0.09, 0.1, 0, y0 + 0.11, -h2 + 0.04, "dark");
    P.box(0.44, 0.11, 0.03, 0, (y0 + o.noseY) / 2, h2 + 0.005, "plate");
    P.box(0.44, 0.12, 0.03, 0, (y0 + 0.11 + o.tailY - 0.13) / 2, -h2 - 0.005, "plate");
    if (o.extra) o.extra(P, { W, h2, rY, rw, gW, beltAt });
  };
}

const SEDAN = {
  len: 4.4, hw: 0.9, y0: 0.3, wheel: 0.68, zf: 1.35, zr: -1.3,
  noseY: 0.8, hoodY: 0.9, wsBase: 0.95, roofF: 0.2, roofR: -0.85, roofY: 1.42, rearBase: -1.45, deckY: 0.96, tailY: 0.94,
  bPillar: -0.3, handles: [-0.05, -0.85],
};
const sedanParts = (extra) => carParts(extra ? { ...SEDAN, ...extra } : SEDAN);
const hatchParts = () => carParts({
  len: 3.8, hw: 0.88, y0: 0.3, wheel: 0.64, zf: 1.2, zr: -1.2,
  noseY: 0.84, hoodY: 0.92, wsBase: 0.8, roofF: 0.05, roofR: -1.45, roofY: 1.5, rearBase: -1.72, deckY: 0.98, tailY: 0.98,
  bPillar: -0.45, handles: [-0.2, -1.0], cW: 0.2,
});
const taxiParts = () => sedanParts({
  extra(P, k) {
    // roof sign
    P.loft("light", [[-0.5, k.rY + 0.02, k.rY + 0.2, 0.34, 0.28, 0.06], [-0.22, k.rY + 0.02, k.rY + 0.2, 0.34, 0.28, 0.06]]);
    P.box(0.5, 0.03, 0.3, 0, k.rY + 0.03, -0.36, "dark");
    // checker band along the doors
    for (const s of [-1, 1]) for (let i = 0; i < 14; i++) {
      P.box(0.025, 0.07, 0.15, s * (k.W - 0.005), i % 2 ? 0.66 : 0.73, -1.2 + i * 0.15, "dark");
    }
  },
});
// London cab: tall, upright, rounded; amber "TAXI" sign on the roof.
const cabParts = () => carParts({
  len: 4.55, hw: 0.92, y0: 0.3, wheel: 0.68, zf: 1.45, zr: -1.35,
  noseY: 0.84, hoodY: 0.98, wsBase: 1.05, roofF: 0.4, roofR: -1.5, roofY: 1.8, rearBase: -1.85, deckY: 1.02, tailY: 1.0,
  bPillar: -0.3, handles: [-0.05, -1.0], cW: 0.24,
  extra(P, k) {
    P.box(0.42, 0.14, 0.16, 0, k.rY + 0.08, 0.25, "light");
    P.box(1.1, 0.05, 0.36, 0, 0.62, k.h2 - 0.02, "chrome");
  },
});
const suvParts = () => carParts({
  len: 4.85, hw: 0.95, y0: 0.45, wheel: 0.84, ww: 0.3, zf: 1.5, zr: -1.5, archPad: 0.1,
  noseY: 1.12, hoodY: 1.22, wsBase: 1.2, roofF: 0.5, roofR: -2.05, roofY: 1.95, roofW: 0.8, rearBase: -2.2, deckY: 1.24, tailY: 1.24,
  bPillar: -0.1, handles: [0.15, -0.75], cW: 0.24, grilleH: 0.24, headH: 0.13,
  extra(P, k) {
    for (const s of [-1, 1]) {
      P.strut("chrome", [s * 0.62, k.rY + 0.1, -1.85], [s * 0.62, k.rY + 0.1, 0.3], 0.04);
      for (const z of [-1.8, 0.25]) P.box(0.05, 0.1, 0.08, s * 0.62, k.rY + 0.06, z, "dark");
    }
    // spare wheel on the tailgate + skid plates
    P.torus(0.62, 0.18, 0, 1.0, -k.h2 - 0.1, "tyre", Math.PI / 2, 0, 1.4);
    P.cyl(0.6, 0.2, 0, 1.0, -k.h2 - 0.1, "body", Math.PI / 2);
    P.box(1.1, 0.07, 0.3, 0, 0.5, k.h2 - 0.02, "chrome");
    P.box(1.1, 0.07, 0.3, 0, 0.5, -k.h2 + 0.02, "chrome");
  },
});
const supercarParts = () => carParts({
  len: 4.6, hw: 0.98, y0: 0.18, wheel: 0.68, wheelR: 0.72, ww: 0.3, zf: 1.45, zr: -1.45, archPad: 0.05,
  noseY: 0.52, hoodY: 0.68, wsBase: 0.7, roofF: -0.05, roofR: -0.75, roofY: 1.13, roofW: 0.68, rearBase: -1.8, deckY: 0.86, tailY: 0.84,
  handles: [-0.5], cW: 0.12, pillar: "dark", headW: 0.42, headH: 0.06, tailW: 0.5, tailH: 0.06, grilleW: 0.9, grilleH: 0.07, spokes: 10,
  extra(P, k) {
    // flared hips over the wheels
    for (const s of [-1, 1]) for (const [z, top] of [[1.45, 0.74], [-1.45, 0.86]]) {
      P.loft("body", [
        [z - 0.62, 0.3, top - 0.14, 0.12, 0.1, 0.08, s * (k.W - 0.15)],
        [z - 0.3, 0.3, top, 0.15, 0.13, 0.1, s * (k.W - 0.15)],
        [z + 0.3, 0.3, top, 0.15, 0.13, 0.1, s * (k.W - 0.15)],
        [z + 0.62, 0.3, top - 0.14, 0.12, 0.1, 0.08, s * (k.W - 0.15)],
      ]);
      P.box(0.04, 0.2, 0.55, s * (k.W + 0.0), 0.55, -0.62, "dark");            // side intake
    }
    // rear wing
    for (const s of [-1, 1]) P.strut("dark", [s * 0.55, 0.84, -1.98], [s * 0.55, 1.08, -2.1], 0.05, 0.14);
    P.loft("dark", [[-2.28, 1.06, 1.11, 0.96, 0.96, 0.02], [-2.0, 1.08, 1.12, 0.96, 0.96, 0.02]]);
    // racing stripes over bonnet + roof
    for (const sx of [-0.2, 0.2]) {
      P.strut("accent", [sx, 0.525, k.h2 - 0.16], [sx, 0.688, 0.72], 0.13, 0.012);
      P.box(0.13, 0.012, 0.5, sx, k.rY + 0.035, -0.4, "accent");
    }
    // diffuser fins + exhaust tips
    for (const x of [-0.45, -0.15, 0.15, 0.45]) P.box(0.03, 0.14, 0.3, x, 0.27, -k.h2 + 0.1, "dark");
    for (const s of [-1, 1]) P.cyl(0.1, 0.14, s * 0.28, 0.34, -k.h2 - 0.02, "chrome", Math.PI / 2);
  },
});
const vanParts = () => carParts({
  len: 5.4, hw: 0.95, y0: 0.38, wheel: 0.74, ww: 0.28, zf: 1.85, zr: -1.75,
  noseY: 1.0, hoodY: 1.1, wsBase: 1.95, roofF: 1.15, roofR: -2.6, roofY: 2.32, roofW: 0.86, rearBase: -2.66, deckY: 1.12, tailY: 1.12,
  bPillar: 0.85, cargo: 0.8, handles: [1.1], cW: 0.1, grilleH: 0.2, headH: 0.15, tailW: 0.2, tailH: 0.4,
  extra(P, k) {
    for (const s of [-1, 1]) {
      P.box(0.03, 0.2, 4.2, s * (k.W - 0.01), 0.82, -0.5, "accent");             // livery stripe
      P.box(0.02, 1.1, 0.02, s * (k.W + 0.0), 1.55, -0.1, "dark");               // sliding-door seam
      P.box(0.62, 0.4, 0.03, s * 0.42, 1.8, -k.h2 + 0.02, "glass");              // rear door windows
    }
    P.box(0.02, 1.8, 0.03, 0, 1.3, -k.h2 + 0.02, "dark");                         // rear door split
  },
});
function truckParts(P) {
  const W = 1.2;
  P.box(1.6, 0.28, 8.3, 0, 0.72, -0.1, "dark");                               // chassis
  // cab-over cab with a raked windscreen
  P.loft("body", [
    [2.2, 0.62, 3.2, W, W - 0.08, 0.2],
    [3.85, 0.62, 3.2, W, W - 0.08, 0.2],
    [4.12, 0.64, 2.9, W - 0.02, W - 0.1, 0.18],
    [4.28, 0.66, 1.95, W - 0.04, W - 0.08, 0.12],
  ]);
  P.strut("glass", [0, 2.0, 4.3], [0, 2.86, 4.15], 2.0, 0.03);
  P.box(2.1, 0.08, 0.25, 0, 2.95, 4.15, "dark");                               // sun visor
  P.box(1.5, 0.55, 0.05, 0, 1.3, 4.29, "chrome");                              // grille
  for (let i = 0; i < 4; i++) P.box(1.4, 0.04, 0.06, 0, 1.1 + i * 0.13, 4.31, "dark");
  P.box(2.4, 0.3, 0.25, 0, 0.6, 4.25, "dark");                                 // bumper
  for (let i = -2; i <= 2; i++) P.box(0.1, 0.05, 0.06, i * 0.3, 3.22, 4.0, "light"); // cab marker lights
  for (const s of [-1, 1]) {
    P.box(0.38, 0.18, 0.06, s * 0.82, 1.0, 4.29, "light");
    P.box(0.03, 0.75, 1.05, s * (W - 0.04), 2.45, 3.5, "glass");              // side window
    P.box(0.02, 1.6, 0.02, s * (W - 0.005), 1.5, 2.9, "dark");                 // door seam
    P.box(0.1, 0.06, 0.4, s * (W - 0.02), 0.85, 3.55, "dark");                 // step
    P.strut("dark", [s * W, 2.55, 3.9], [s * (W + 0.18), 2.45, 4.05], 0.035);
    P.box(0.08, 0.38, 0.2, s * (W + 0.2), 2.28, 4.05, "dark");                 // mirror
    P.arch(0.58, s * W, 0.5, 3.1, "dark");
  }
  // cargo box with ribs, rear doors and lights
  P.loft("accent", [[-4.3, 1.02, 3.85, 1.25, 1.25, 0.05], [2.05, 1.02, 3.85, 1.25, 1.25, 0.05]]);
  P.box(2.52, 0.12, 6.36, 0, 1.0, -1.125, "dark");
  for (const s of [-1, 1]) for (let z = -3.7; z < 2; z += 1.05) P.box(0.03, 2.72, 0.06, s * 1.255, 2.43, z, "chrome");
  P.box(0.03, 2.65, 0.02, 0, 2.43, -4.31, "dark");
  for (const x of [-0.35, 0.35]) P.strut("chrome", [x, 1.2, -4.32], [x, 3.65, -4.32], 0.035);
  P.box(2.2, 0.15, 0.1, 0, 0.55, -4.2, "dark");                                // under-ride bar
  for (const s of [-1, 1]) P.box(0.3, 0.14, 0.05, s * 0.95, 0.78, -4.27, "tail");
  // fuel tank + side guard
  P.cyl(0.5, 1.0, -0.95, 0.62, 1.4, "chrome", Math.PI / 2);
  P.strut("dark", [1.12, 0.6, -1.6], [1.12, 0.6, 0.6], 0.05, 0.12);
  // wheels: single front axle, tandem rear axles under mudguards
  for (const s of [-1, 1]) for (const z of [3.1, -2.2, -3.4]) P.wheel(1.0, 0.32, s * 1.06, 0.5, z, { spokes: 6 });
  for (const s of [-1, 1]) P.fender(0.58, 0.38, s * 1.06, 0.5, -2.8, Math.PI * 0.15, Math.PI * 0.7, "dark");
  P.loft("dark", [[-3.95, 0.98, 1.04, 1.24, 1.24, 0.02], [-1.65, 0.98, 1.04, 1.24, 1.24, 0.02]]);
}
function busParts(P) {
  const W = 1.27, h2 = 5.8;
  P.loft("body", [
    [-h2, 0.38, 3.12, W - 0.05, W - 0.1, 0.26],
    [-h2 + 0.15, 0.32, 3.2, W, W - 0.05, 0.3],
    [h2 - 0.2, 0.32, 3.2, W, W - 0.05, 0.3],
    [h2, 0.36, 3.1, W - 0.04, W - 0.1, 0.25],
  ]);
  // window bays (door side is +X)
  const bays = [[-5.3, -4.05], [-3.95, -2.7], [-2.6, -1.35], [-1.25, 0.0], [0.1, 1.35], [1.45, 2.7], [2.8, 4.05], [4.15, 5.55]];
  const doors = [[0.1, 1.35], [4.15, 5.2]];
  for (const s of [-1, 1]) {
    const x = s * (W - 0.025);
    for (const [z0, z1] of bays) {
      if (s > 0 && doors.some(([a]) => a === z0)) continue;
      P.box(0.03, 0.95, z1 - z0, x, 2.32, (z0 + z1) / 2, "glass");
    }
    for (const z of [-5.35, -4.0, -2.65, -1.3, 0.05, 1.4, 2.75, 4.1]) P.box(0.035, 0.97, 0.1, s * (W - 0.02), 2.32, z, "body");
    // livery band (broken by the doors on the kerb side)
    for (const [z0, z1] of s > 0 ? [[-5.6, 0.0], [1.45, 4.1]] : [[-5.6, 5.6]]) P.box(0.02, 0.32, z1 - z0, s * (W - 0.012), 1.45, (z0 + z1) / 2, "accent");
    P.strut("dark", [s * (W - 0.05), 2.75, 5.7], [s * (W + 0.15), 2.62, 5.95], 0.04);
    P.box(0.1, 0.4, 0.06, s * (W + 0.17), 2.4, 5.97, "dark");                  // mirror
    P.box(0.36, 0.16, 0.04, s * 0.95, 0.85, h2 + 0.01, "light");
    P.box(0.22, 0.5, 0.05, s * 1.0, 1.1, -h2 - 0.01, "tail");
    for (const z of [3.9, -3.4]) {
      P.arch(0.6, s * W, 0.5, z, "dark");
      P.wheel(1.0, 0.32, s * (W + 0.04 - 0.16), 0.5, z, { spokes: 8 });
    }
  }
  P.box(0.03, 0.95, 0.3, -(W - 0.025), 2.32, 5.4, "glass");
  P.box(0.03, 0.95, 0.3, W - 0.025, 2.32, 5.4, "glass");
  for (const [z0, z1] of doors) {                                                 // glazed folding doors
    P.box(0.025, 2.33, z1 - z0 + 0.08, W - 0.03, 1.62, (z0 + z1) / 2, "dark");
    P.box(0.03, 2.25, z1 - z0, W - 0.025, 1.62, (z0 + z1) / 2, "glass");
    P.box(0.035, 2.25, 0.03, W - 0.02, 1.62, (z0 + z1) / 2, "dark");
  }
  // front: windscreen, destination sign, grille, bumper
  P.box(2.3, 1.45, 0.04, 0, 2.15, h2, "glass");
  P.box(1.8, 0.24, 0.04, 0, 2.97, h2, "light");
  P.box(1.2, 0.2, 0.04, 0, 0.9, h2 + 0.01, "dark");
  P.box(2.5, 0.3, 0.15, 0, 0.48, h2, "dark");
  P.box(0.5, 0.13, 0.03, 0, 0.7, h2 + 0.07, "plate");
  // rear: window, engine grille, bumper
  P.box(2.0, 0.7, 0.04, 0, 2.45, -h2, "glass");
  P.box(1.8, 0.5, 0.04, 0, 1.2, -h2 - 0.01, "dark");
  P.box(2.5, 0.3, 0.15, 0, 0.5, -h2, "dark");
  P.box(0.5, 0.13, 0.03, 0, 0.75, -h2 - 0.04, "plate");
  // roof air-con pod
  P.loft("body", [[-2.2, 3.1, 3.4, 0.85, 0.75, 0.12], [0.6, 3.1, 3.4, 0.85, 0.75, 0.12]]);
}

// Double-decker: two glazed decks, cream band between them, front entrance.
function deckerParts(P) {
  const W = 1.27, h2 = 5.4;
  P.loft("body", [
    [-h2, 0.38, 4.32, W - 0.05, W - 0.1, 0.32],
    [-h2 + 0.15, 0.32, 4.4, W, W - 0.05, 0.36],
    [h2 - 0.2, 0.32, 4.4, W, W - 0.05, 0.36],
    [h2, 0.36, 4.3, W - 0.04, W - 0.1, 0.3],
  ]);
  const bays = [[-4.95, -3.75], [-3.65, -2.45], [-2.35, -1.15], [-1.05, 0.15], [0.25, 1.45], [1.55, 2.75], [2.85, 4.05], [4.15, 5.05]];
  const door = [3.95, 5.05];
  for (const s of [-1, 1]) {
    const x = s * (W - 0.025);
    for (const [z0, z1] of bays) {
      P.box(0.03, 0.9, z1 - z0, x, 3.55, (z0 + z1) / 2, "glass");                  // upper deck
      if (s > 0 && z1 > door[0]) continue;
      P.box(0.03, 0.92, z1 - z0, x, 2.05, (z0 + z1) / 2, "glass");                 // lower deck
    }
    P.box(0.02, 0.22, h2 * 2 - 0.3, s * (W - 0.012), 2.86, 0, "accent");            // cream band
    P.box(0.1, 0.4, 0.06, s * (W + 0.17), 2.4, h2 + 0.08, "dark");                 // mirror
    P.strut("dark", [s * (W - 0.05), 2.7, h2 - 0.1], [s * (W + 0.15), 2.6, h2 + 0.08], 0.04);
    P.box(0.3, 0.16, 0.04, s * 0.95, 0.85, h2 + 0.01, "light");
    P.box(0.2, 0.45, 0.05, s * 1.0, 1.1, -h2 - 0.01, "tail");
    for (const z of [3.7, -2.9]) {
      P.arch(0.6, s * W, 0.5, z, "dark");
      P.wheel(1.0, 0.32, s * (W + 0.04 - 0.16), 0.5, z, { spokes: 8 });
    }
  }
  P.box(0.025, 2.2, door[1] - door[0], W - 0.03, 1.55, (door[0] + door[1]) / 2, "dark");
  P.box(0.03, 2.1, door[1] - door[0] - 0.1, W - 0.022, 1.55, (door[0] + door[1]) / 2, "glass");
  // front: lower windscreen, destination blind, upper front windows
  P.box(2.3, 1.15, 0.04, 0, 2.0, h2, "glass");
  P.box(1.7, 0.26, 0.04, 0, 2.95, h2, "light");
  for (const s of [-1, 1]) P.box(1.08, 0.88, 0.04, s * 0.58, 3.6, h2 - 0.02, "glass");
  P.box(2.5, 0.3, 0.15, 0, 0.48, h2, "dark");
  P.box(0.5, 0.13, 0.03, 0, 0.7, h2 + 0.07, "plate");
  P.box(1.0, 0.18, 0.04, 0, 0.95, h2 + 0.01, "chrome");
  // rear
  P.box(2.0, 0.8, 0.04, 0, 3.55, -h2, "glass");
  P.box(1.6, 0.6, 0.04, 0, 2.0, -h2, "glass");
  P.box(2.5, 0.3, 0.15, 0, 0.5, -h2, "dark");
  P.box(0.5, 0.13, 0.03, 0, 0.75, -h2 - 0.04, "plate");
}

// ---- motorbikes ----
function bikeParts(P) {
  const fz = 0.68, rz = -0.66, wy = 0.32;
  for (const z of [rz, fz]) P.wheel(0.64, 0.12, 0, wy, z, { both: true, profile: 0.17, rimMat: "dark", spokes: 5 });
  for (const s of [-1, 1]) P.cyl(0.26, 0.012, s * 0.068, wy, fz, "chrome", 0, Math.PI / 2);   // brake discs
  P.fender(0.37, 0.13, 0, wy, fz, Math.PI * 0.3, Math.PI * 0.5, "body");
  P.fender(0.37, 0.15, 0, wy, rz, Math.PI * 0.3, Math.PI * 0.35, "dark");
  // front end: forks, clamps, round headlight, bars, mirrors
  for (const s of [-1, 1]) P.strut("chrome", [s * 0.085, wy, fz], [s * 0.085, 0.98, 0.47], 0.045);
  P.box(0.26, 0.05, 0.09, 0, 0.98, 0.47, "dark");
  P.cyl(0.2, 0.09, 0, 0.9, 0.6, "chrome", Math.PI / 2);
  P.cyl(0.17, 0.02, 0, 0.9, 0.65, "light", Math.PI / 2);
  P.strut("chrome", [-0.36, 1.07, 0.4], [0.36, 1.07, 0.4], 0.028);
  for (const s of [-1, 1]) {
    P.strut("chrome", [s * 0.08, 0.99, 0.46], [s * 0.12, 1.07, 0.41], 0.03);
    P.cyl(0.045, 0.12, s * 0.32, 1.07, 0.4, "dark", 0, Math.PI / 2);
    P.strut("dark", [s * 0.24, 1.07, 0.41], [s * 0.3, 1.25, 0.36], 0.015);
    P.box(0.11, 0.06, 0.02, s * 0.3, 1.27, 0.36, "dark");
  }
  // tank, seat, tail
  P.loft("body", [[-0.05, 0.76, 0.95, 0.1, 0.13, 0.08], [0.15, 0.73, 1.0, 0.13, 0.16, 0.09], [0.38, 0.8, 0.98, 0.09, 0.11, 0.07]]);
  P.loft("dark", [[-0.62, 0.86, 0.92, 0.09, 0.09, 0.03], [-0.32, 0.84, 0.94, 0.13, 0.13, 0.04], [-0.04, 0.83, 0.92, 0.12, 0.12, 0.04]]);
  P.loft("body", [[-0.86, 0.85, 0.9, 0.05, 0.05, 0.02], [-0.6, 0.79, 0.9, 0.1, 0.1, 0.04]]);
  P.box(0.12, 0.05, 0.04, 0, 0.87, -0.87, "tail");
  P.box(0.16, 0.1, 0.01, 0, 0.74, -0.86, "plate", -0.3);
  // frame, engine, exhaust, swingarm, shocks
  P.strut("dark", [0, 0.95, 0.45], [0, 0.48, -0.12], 0.06);
  P.strut("dark", [0, 0.95, 0.45], [0, 0.8, -0.05], 0.05);
  for (const s of [-1, 1]) P.strut("dark", [s * 0.08, 0.8, -0.05], [s * 0.07, 0.84, -0.7], 0.035);
  P.box(0.3, 0.3, 0.42, 0, 0.48, 0.08, "dark");
  for (let i = 0; i < 4; i++) P.box(0.32, 0.025, 0.2, 0, 0.66 + i * 0.035, 0.2, "chrome", -0.35);
  for (const s of [-1, 1]) P.cyl(0.22, 0.04, s * 0.16, 0.44, 0.02, "chrome", 0, Math.PI / 2);
  P.strut("chrome", [0.06, 0.52, 0.3], [0.13, 0.3, 0.1], 0.055);
  P.strut("chrome", [0.13, 0.3, 0.1], [0.15, 0.37, -0.32], 0.06);
  P.strut("chrome", [0.15, 0.37, -0.3], [0.16, 0.47, -0.74], 0.11);
  P.cyl(0.08, 0.02, 0.16, 0.47, -0.745, "dark", Math.PI / 2 - 0.22);
  for (const s of [-1, 1]) {
    P.strut("dark", [s * 0.08, 0.42, -0.1], [s * 0.08, wy, rz], 0.05, 0.07);
    P.strut("chrome", [s * 0.09, 0.38, -0.52], [s * 0.09, 0.84, -0.34], 0.03);
    P.strut("body", [s * 0.09, 0.47, -0.48], [s * 0.09, 0.76, -0.37], 0.055);
  }
}
function superbikeParts(P) {
  const fz = 0.72, rz = -0.72, wy = 0.31;
  P.wheel(0.62, 0.15, 0, wy, fz, { both: true, profile: 0.18, rimMat: "accent", spokes: 3 });
  P.wheel(0.62, 0.2, 0, wy, rz, { both: true, profile: 0.2, rimMat: "accent", spokes: 3 });
  for (const s of [-1, 1]) P.cyl(0.3, 0.012, s * 0.085, wy, fz, "chrome", 0, Math.PI / 2);
  P.fender(0.36, 0.14, 0, wy, fz, Math.PI * 0.35, Math.PI * 0.45, "body");
  P.fender(0.36, 0.2, 0, wy, rz, Math.PI * 0.3, Math.PI * 0.3, "dark");
  // front: fairing with twin slit headlights, windscreen, forks, clip-ons
  P.loft("body", [
    [0.08, 0.38, 0.92, 0.17, 0.15, 0.08],
    [0.45, 0.42, 1.0, 0.2, 0.15, 0.1],
    [0.72, 0.55, 0.93, 0.15, 0.1, 0.08],
    [0.87, 0.66, 0.84, 0.07, 0.05, 0.04],
  ]);
  P.strut("glass", [0, 0.93, 0.74], [0, 1.1, 0.46], 0.24, 0.012);
  for (const s of [-1, 1]) {
    P.box(0.06, 0.04, 0.06, s * 0.045, 0.78, 0.86, "light", 0, s * 0.3);
    P.strut("accent", [s * 0.205, 0.6, 0.12], [s * 0.17, 0.74, 0.68], 0.012, 0.07);  // fairing flash
    P.box(0.1, 0.05, 0.08, s * 0.22, 0.95, 0.6, "dark");                            // mirrors
    P.strut("chrome", [s * 0.085, wy, fz], [s * 0.085, 0.96, 0.5], 0.05);
    P.strut("dark", [s * 0.09, 0.94, 0.5], [s * 0.3, 0.91, 0.42], 0.03);
  }
  // tank, seat, pointed tail, belly pan
  P.loft("body", [[-0.3, 0.82, 1.0, 0.12, 0.11, 0.07], [0.12, 0.8, 1.05, 0.16, 0.15, 0.08], [0.35, 0.82, 1.0, 0.13, 0.12, 0.07]]);
  P.loft("dark", [[-0.62, 0.9, 0.97, 0.1, 0.09, 0.03], [-0.28, 0.88, 0.98, 0.13, 0.12, 0.04]]);
  P.loft("body", [[-1.0, 0.99, 1.04, 0.03, 0.03, 0.01], [-0.62, 0.86, 1.02, 0.12, 0.1, 0.04]]);
  P.loft("accent", [[-0.2, 0.25, 0.42, 0.13, 0.17, 0.05], [0.35, 0.3, 0.5, 0.15, 0.19, 0.05]]);
  P.box(0.1, 0.04, 0.04, 0, 1.0, -0.99, "tail");
  P.strut("dark", [0, 0.9, -0.8], [0, 0.72, -0.94], 0.03);
  P.box(0.16, 0.1, 0.01, 0, 0.7, -0.95, "plate", -0.3);
  // engine, swingarm, exhaust
  P.box(0.3, 0.32, 0.5, 0, 0.5, 0.0, "dark");
  for (const s of [-1, 1]) P.strut("chrome", [s * 0.1, 0.44, -0.1], [s * 0.1, wy, rz], 0.07, 0.1);
  P.strut("chrome", [0.12, 0.3, 0.0], [0.18, 0.55, -0.55], 0.13);
  P.cyl(0.1, 0.02, 0.185, 0.565, -0.57, "dark", Math.PI / 2 - 0.43);
}

// Pools (weighted by repetition).
const T = { cityTraffic: [], parisTraffic: [], londonTraffic: [], cityParked: [], parisParked: [], londonParked: [], bikes: [], start: {} };

export function initVehicleTemplates() {
  headM = flatMat("headLightM", hex("#f2efe2"), 1);
  tailM = flatMat("tailLightM", hex("#c0261d"), 1);
  tyreM = litMat("tyreM", hex("#161616"), 0.08);
  chromeM = litMat("chromeM", hex("#9aa1a8"), 0.9); chromeM.specularPower = 96;
  rimM = litMat("rimM", hex("#c4c8cd"), 0.8); rimM.specularPower = 64;
  darkM = litMat("trimDarkM", hex("#1c1d20"), 0.25);
  glassM = litMat("carGlassM", hex("#1c2630"), 0.9); glassM.specularPower = 128;
  plateM = litMat("plateM", hex("#e9e7dc"), 0.1);
  burntM = litMat("burntM", hex("#1b1817"));
  burntGlassM = litMat("burntGlassM", hex("#0a0a0a"));

  const sedan = sedanParts(), hatch = hatchParts(), suv = suvParts(), van = vanParts(), sup = supercarParts();
  const taxi = model("car", "taxi", { body: "#f2c230" }, taxiParts());
  const sedans = ["#1d1f22", "#22314a", "#d8d8d4", "#9da3a8", "#7a1f1f"].map((c, i) => model("car", "sedan" + i, { body: c }, sedan));
  const hatches = ["#ecebe6", "#b32d2a", "#9fd1c0", "#efe3c3", "#2f5d8a"].map((c, i) => model("car", "hatch" + i, { body: c }, hatch));
  const suvs = ["#18191b", "#e6e6e2", "#5b6b3a", "#6d1f24", "#2e3f55"].map((c, i) => model("suv", "suv" + i, { body: c }, suv));
  const vans = [["#f1f1ee", "#2a6fb5"], ["#a9adb2", "#1d1f22"], ["#2f5d3e", "#f1f1ee"], ["#f1f1ee", "#c0392b"]]
    .map(([b, a], i) => model("van", "van" + i, { body: b, accent: a }, van));
  const trucks = [["#c0392b", "#f1f1ee"], ["#1f4f9a", "#e9e4d6"], ["#f1f1ee", "#2f7d4a"]]
    .map(([b, a], i) => model("truck", "truck" + i, { body: b, accent: a }, truckParts));
  const cityBus = model("bus", "busCity", { body: "#e9ecef", accent: "#1d5fa8" }, busParts);
  const parisBus = model("bus", "busParis", { body: "#2f7d55", accent: "#e9ecef" }, busParts);
  const cab = model("suv", "blackCab", { body: "#141517" }, cabParts());
  const decker = model("decker", "deckerRed", { body: "#c8102e", accent: "#ece4cc" }, deckerParts);
  const supers = [["#e8b100", "#111"], ["#d81b1b", "#fff"], ["#ff6a00", "#111"], ["#1565c0", "#fff"], ["#7ed321", "#111"]]
    .map(([b, a], i) => model("supercar", "supercar" + i, { body: b, accent: a }, sup));
  const bikes = ["#a3262a", "#1f4f9a", "#222326", "#c8681a"].map((c, i) => model("bike", "bike" + i, { body: c }, bikeParts));
  const superbikes = [["#00a86b", "#111"], ["#c62828", "#fff"], ["#1e88e5", "#fff"], ["#f5f5f5", "#d32f2f"]]
    .map(([b, a], i) => model("superbike", "superbike" + i, { body: b, accent: a }, superbikeParts));

  T.cityTraffic = [taxi, taxi, taxi, taxi, taxi, ...sedans, sedans[0], suvs[0], suvs[1], suvs[4], vans[0], vans[1], vans[3], trucks[0], trucks[1], cityBus, cityBus, supers[0]];
  T.parisTraffic = [...hatches, ...hatches, sedans[0], sedans[2], suvs[2], suvs[1], vans[2], vans[0], trucks[2], parisBus];
  T.cityParked = [taxi, ...sedans, ...sedans, suvs[0], suvs[1], suvs[3], suvs[4], vans[0], vans[1], trucks[1], supers[1], supers[3]];
  T.parisParked = [...hatches, ...hatches, sedans[2], suvs[2], suvs[1], vans[2], supers[4]];
  T.londonTraffic = [cab, cab, cab, cab, cab, decker, decker, decker, ...hatches, sedans[0], sedans[1], sedans[3], vans[0], vans[3], suvs[1], trucks[1]];
  T.londonParked = [cab, cab, ...hatches, sedans[0], sedans[1], sedans[2], sedans[4], suvs[0], suvs[2], vans[0], vans[1], supers[1], decker];
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
  // fast toys parked beside the start, lined up along the promenade
  if (START.parked) {
    for (const v of START.parked) makeVehicle(T.start[v.key], v.x, v.z, v.h + (v.key.includes("bike") ? 0.35 : 0));
  } else {
    makeVehicle(T.start.supercar, START.x, START.z + 6, Math.PI / 2);
    makeVehicle(T.start.suv, START.x - 4, START.z + 10, Math.PI / 2);
    makeVehicle(T.start.superbike, START.x - 1, START.z - 5, Math.PI / 2 + 0.3);
    makeVehicle(T.start.bike, START.x - 2.6, START.z - 5.8, Math.PI / 2 + 0.3);
  }

  const parkable = (e) => e.w >= 10 && e.district !== "park" && !["roundabout", "circus", "bridge"].includes(e.kind) && e.len > 40;
  // (none in Kathmandu: its roads are too narrow to park on)
  for (const [district, n] of [["city", 95], ["paris", 60], ["london", 70]]) {
    const pool = district === "city" ? T.cityParked : district === "london" ? T.londonParked : T.parisParked;
    let placed = 0;
    for (let tries = 0; tries < n * 6 && placed < n; tries++) {
      const e = pickEdge((x) => parkable(x) && x.district === district);
      if (!e) break;                                   // no road here wide enough to park on
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
  if (!burntCache[key]) burntCache[key] = v.tpl ? v.tpl.buildBurnt() : build(v.kind + "Burnt", mats(v.kind, {}, true), v.kind === "bike" ? bikeParts : sedanParts(), false);
  const m = burntCache[key].createInstance("wreck");
  m.position.copyFrom(v.mesh.position);
  m.rotation.y = v.mesh.rotation.y;
  m.freezeWorldMatrix();
  v.mesh.dispose();
  v.mesh = m;
  v.wrecked = true;
}

// ---------------------------------------------------------------- traffic
const SPEED = {
  avenue: 13, street: 10, broadway: 12, roundabout: 8, radial: 13, plaza: 9, major: 11, minor: 8, outer: 13, parkway: 15,
  high: 10, lane: 8, mews: 5, bridge: 12, circus: 7,
  artery: 13, collector: 10, galli: 6,
};
const TP = { x: 0, z: 0, tx: 0, tz: 1 };
function laneTarget(t) {
  const p = pathAt(t.e, t.s, TP);
  const fx = p.tx * t.dir, fz = p.tz * t.dir;
  return [p.x + fz * t.e.lane, p.z - fx * t.e.lane, Math.atan2(fx, fz)];
}
export function spawnTraffic() {
  for (const [district, n] of [["city", 90], ["paris", 45], ["park", 10], ["london", 75], ["kathmandu", 45]]) {
    const pool = district === "paris" ? T.parisTraffic : district === "london" ? T.londonTraffic : T.cityTraffic;
    for (let i = 0; i < n; i++) {
      const tpl = pick(pool), spec = SPECS[tpl.specKey];
      const e = pickEdge((x) => x.district === district && x.len > 20 + spec.hd * 2);
      if (!e) continue;
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
export function updateTraffic(dtFrame, now, ctx) {
  const pSpec = ctx.vehicle ? specOf(ctx.vehicle) : null;
  for (const t of traffic) {
    // far from the player: no avoidance checks, and only every 4th frame (with
    // the time saved up, so they still drive at the right speed)
    const far = Math.abs(t.vx - ctx.pos.x) > 200 || Math.abs(t.vz - ctx.pos.z) > 200;
    t.acc = (t.acc || 0) + dtFrame;
    if (far && ((t.tick = (t.tick || 0) + 1) & 3)) continue;
    const dt = Math.min(t.acc, 0.25);
    t.acc = 0;
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
    if (!blocked && !far) {
      for (const o of traffic) {
        if (o === t || Math.abs(o.vx - t.vx) > 20 || Math.abs(o.vz - t.vz) > 20) continue;
        if (Math.abs(angDiff(o.heading, t.heading)) > 1.1) continue;
        if (ahead(o.vx, o.vz, o.spec.hw, 1.0, sp.hd + o.spec.hd + 4.5)) { blocked = true; break; }
      }
    }
    if (!blocked && !far) {
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
// Returns { depth, traffic, vehicle }: traffic = the first traffic vehicle
// touched, vehicle = the first parked / wrecked vehicle touched.
// Using depth instead of a yes/no lets a vehicle that is already jammed into
// something drive *out* of it (any move that reduces the depth is allowed).
export function vehicleOverlap(v, x, z, h, y, enterables) {
  const c = specOf(v);
  const fx = Math.sin(h), fz = Math.cos(h);
  let depth = 0, hitT = null, hitV = null;
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
      if (d < c.r) { depth += c.r - d; if (s.vehicle && !hitV) hitV = s.vehicle; }
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
  return { depth, traffic: hitT, vehicle: hitV };
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
  const res = { impact: 0, traffic: null, vehicle: null, x: 0, z: 0, dir: 1, scrape: false };
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
    res.vehicle = hit.vehicle;
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
