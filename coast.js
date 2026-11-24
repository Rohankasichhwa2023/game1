// coast.js — what the islands look like from outside: the sea surface, the
// grass and the strip of sandy beach round every island, the bridges (deck
// slabs, parapets you can't drive through, piers) and the wooden boat docks.
//
// The shapes come from water.js's coastline field, meshed with marching
// squares on a 4 m grid. Solid stretches of a row are merged into one long
// quad (so the open sea is a few thousand triangles, not millions), except on
// Kathmandu's hillside where the grass has to follow the slopes.
import {
  scene, hex, flatTexMat, litMat, makeAcc, addBox, solidBox, addSolid, setXF, clearXF, makeXF, xfp, landH,
} from "./engine.js";
import { makeWaterMat, updateWater } from "./waterMat.js";
import { noiseTex } from "./textures.js";
import { landSdf, seaAt, onBridge, bridgeSpans, SEA_BOX } from "./water.js";
import { TERRAIN_BOX } from "./terrain.js";

const CELL = 4;
export const SEA_Y = 0.045;   // the water surface (just over the district ground plates)

// ---------------------------------------------------------------- iso meshes
// Fill the region where f(node) < 0 into accumulator acc. Heights: y + (drape ? landH : 0).
function isoFill(acc, vals, nx, nz, x0, z0, y, drape, tile) {
  const P = (x, z) => [x, y + (drape ? landH(x, z) : 0), z];
  const uv = (p) => [p[0] / tile, p[2] / tile];
  const hilly = (x, z) => drape && x > TERRAIN_BOX.x0 - 8 && x < TERRAIN_BOX.x1 + 8 && z > TERRAIN_BOX.z0 - 8 && z < TERRAIN_BOX.z1 + 8;
  const tri = (pts) => {
    const base = acc.pos.length / 3;
    for (const p of pts) { acc.pos.push(p[0], p[1], p[2]); acc.nrm.push(0, 1, 0); const t = uv(p); acc.uv.push(t[0], t[1]); }
    for (let k = 1; k < pts.length - 1; k++) acc.idx.push(base, base + k + 1, base + k);
  };
  const v = (i, j) => vals[j * nx + i];
  for (let j = 0; j < nz - 1; j++) {
    const za = z0 + j * CELL, zb = za + CELL;
    let run = -1;
    const flush = (iEnd) => {
      if (run < 0) return;
      const xa = x0 + run * CELL, xb = x0 + iEnd * CELL;
      tri([P(xa, za), P(xb, za), P(xb, zb), P(xa, zb)]);
      run = -1;
    };
    for (let i = 0; i < nx - 1; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      const xa = x0 + i * CELL, xb = xa + CELL;
      if (a < 0 && b < 0 && c < 0 && d < 0) {
        if (hilly(xa, za)) { flush(i); tri([P(xa, za), P(xb, za), P(xb, zb), P(xa, zb)]); }
        else if (run < 0) run = i;
        continue;
      }
      flush(i);
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) continue;
      // partial cell: walk the corners, keeping inside ones and edge crossings
      const corners = [[xa, za, a], [xb, za, b], [xb, zb, c], [xa, zb, d]];
      const poly = [];
      for (let k = 0; k < 4; k++) {
        const [px, pz, pv] = corners[k], [qx, qz, qv] = corners[(k + 1) % 4];
        if (pv < 0) poly.push(P(px, pz));
        if ((pv < 0) !== (qv < 0)) {
          const t = pv / (pv - qv);
          poly.push(P(px + (qx - px) * t, pz + (qz - pz) * t));
        }
      }
      if (poly.length >= 3) tri(poly);
    }
    flush(nx - 1);
  }
}

// ---------------------------------------------------------------- sea, beach, grass
export function buildCoast() {
  const x0 = SEA_BOX.x0, z0 = SEA_BOX.z0;
  const nx = Math.ceil((SEA_BOX.x1 - x0) / CELL) + 1, nz = Math.ceil((SEA_BOX.z1 - z0) / CELL) + 1;
  const sdf = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) sdf[j * nx + i] = landSdf(x0 + i * CELL, z0 + j * CELL);
  const neg = (off, sign) => { const o = new Float32Array(sdf.length); for (let k = 0; k < sdf.length; k++) o[k] = sign * sdf[k] + off; return o; };

  // sea: where sdf > 0 → value = -sdf < 0
  const sea = makeAcc("sea", makeWaterMat("seaM", -2.5), 1, 1);   // waves, sky reflection, sun glints
  isoFill(sea, neg(0, -1), nx, nz, x0, z0, SEA_Y, false, 22);

  // sand: the whole island, under the grass (shows as a ~6 m beach at the edge)
  const sandTex = noiseTex("beachSandT", "#d9c89f", 3000, "255,248,230", "130,110,80", 256, [1, 3]);
  const sand = makeAcc("beachSand", flatTexMat("beachSandM", sandTex, 0.2), 1, 1);
  isoFill(sand, sdf, nx, nz, x0, z0, -0.075, true, 9);

  // grass: everything more than ~6 m inland
  const grassTex = noiseTex("islandGrassT", "#6f9a4e", 9000, "150,190,100", "40,70,30", 256, [1, 3]);
  const grassM = flatTexMat("islandGrassM", grassTex, 0.16);
  grassM.zOffset = -0.5;
  const grass = makeAcc("islandGrass", grassM, 1, 1);
  isoFill(grass, neg(6, 1), nx, nz, x0, z0, -0.06, true, 14);
}
// the waves move on
export function animateSea(dt) {
  updateWater(dt);
}

// ---------------------------------------------------------------- bridges
export function buildBridgeStructures() {
  const conc = makeAcc("bridgeConcrete", litMat("bridgeConcreteM", hex("#a29d93"), 0.05));
  const dark = makeAcc("bridgeUnder", litMat("bridgeUnderM", hex("#6f6a62"), 0.03));
  const rail = makeAcc("bridgeRail", litMat("bridgeRailM", hex("#d8d4cb"), 0.1));
  const T = 0.7;                                  // deck slab thickness
  for (const span of bridgeSpans) {
    const { pts, hw } = span;
    let sincePier = 12;
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k], q = pts[k + 1];
      if (!p.wet && !q.wet) continue;
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, L = Math.hypot(q.x - p.x, q.z - p.z) + 0.05;
      const yaw = Math.atan2(q.x - p.x, q.z - p.z);
      const lo = Math.min(p.h, q.h), hi = Math.max(p.h, q.h);
      setXF(makeXF(mx, mz, yaw));
      // slab under the road (its top is the road surface itself)
      addBox(-hw, lo - T, -L / 2, hw, lo - 0.01, L / 2, (d) => (d === "+y" ? null : d === "-y" ? dark : conc));
      // parapets: solid, so nothing drives (or walks) off the edge
      for (const sd of [-1, 1]) {
        const xa = sd * (hw - 0.3), xb = sd * hw;
        solidBox(Math.min(xa, xb), lo - T, -L / 2, Math.max(xa, xb), hi + 0.95, L / 2, rail);
        addBox(Math.min(xa, xb) - 0.05, hi + 0.95, -L / 2, Math.max(xa, xb) + 0.05, hi + 1.05, L / 2, conc);
      }
      // piers down into the water under the high parts
      sincePier += L;
      if (lo > 2.2 && sincePier > 24 && p.wet && q.wet) {
        sincePier = 0;
        const w = hw - 1.2;
        for (const sd of [-1, 1]) solidBox(sd * w - 0.6, -4, -0.6, sd * w + 0.6, lo - T, 0.6, dark);
      }
      clearXF();
    }
  }
}

// ---------------------------------------------------------------- boat docks
// A wooden jetty from the shore out into the bay, boats moored alongside.
// Each wanted spot is moved along the coast until the jetty is clear of bridges.
export function buildDocks(wanted) {
  const plank = makeAcc("dockPlank", litMat("dockPlankM", hex("#7a5a3c"), 0.05), 1, 1);
  const post = makeAcc("dockPost", litMat("dockPostM", hex("#4a3624"), 0.05));
  const out = [];
  for (const w of wanted) {
    const spot = findShore(w.x, w.z);
    if (!spot) continue;
    const { x, z, nx, nz } = spot;
    const yaw = Math.atan2(nx, nz), LEN = 16, HW = 1.4, TOP = 0.38;
    setXF(makeXF(x + nx * (LEN / 2 - 3), z + nz * (LEN / 2 - 3), yaw));
    solidBox(-HW, TOP - 0.12, -LEN / 2, HW, TOP, LEN / 2, (d) => (d === "-y" ? null : plank));
    for (let zz = -LEN / 2 + 1; zz <= LEN / 2; zz += 3) for (const sd of [-1, 1]) addBox(sd * HW - 0.12, -1.5, zz - 0.12, sd * HW + 0.12, TOP + 0.5, zz + 0.12, post);
    clearXF();
    // moorings either side of the jetty, bows pointing out to sea
    const sideX = -nz, sideZ = nx;
    for (const sd of [-1, 1]) {
      const along = LEN / 2 + 1, off = HW + 2.2;
      out.push({ x: x + nx * along + sideX * off * sd, z: z + nz * along + sideZ * off * sd, heading: yaw });
    }
  }
  return out;
}
// Walk outward from (x, z) along the coast normal to the shoreline; slide
// sideways along the coast if a bridge is in the way.
function findShore(x0, z0) {
  for (let tries = 0; tries < 24; tries++) {
    const side = (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * 18;
    // gradient of the coastline field = outward normal
    const g = (x, z) => {
      const e = 2, gx = landSdf(x + e, z) - landSdf(x - e, z), gz = landSdf(x, z + e) - landSdf(x, z - e), l = Math.hypot(gx, gz) || 1;
      return [gx / l, gz / l];
    };
    let [nx, nz] = g(x0, z0);
    let x = x0 - nz * side, z = z0 + nx * side;
    // march to the shore
    let s = landSdf(x, z);
    for (let k = 0; k < 400 && Math.abs(s) > 0.5; k++) {
      [nx, nz] = g(x, z);
      x -= nx * s * 0.8; z -= nz * s * 0.8;
      s = landSdf(x, z);
    }
    if (Math.abs(s) > 1) continue;
    [nx, nz] = g(x, z);
    // the jetty + boats must be clear of bridges and of other land
    let ok = true;
    for (let d = -3; d <= 22 && ok; d += 1.5) {
      for (const o of [-5, 0, 5]) {
        const px = x + nx * d - nz * o, pz = z + nz * d + nx * o;
        if (onBridge(px, pz)) { ok = false; break; }
        if (d > 6 && !seaAt(px, pz)) { ok = false; break; }
      }
    }
    if (ok) return { x, z, nx, nz };
  }
  return null;
}
