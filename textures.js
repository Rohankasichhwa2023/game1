// textures.js — every procedural texture: building facades (each with a day
// look, a night emissive "lit windows" variant and, for enterable types, an
// interior variant with the same window layout), roofs, ground and paving.
import { scene, rand, rr, pick, canvasTex, makeAcc, C3 } from "./engine.js";

export const facadeList = [];
const LIT = ["#ffd27a", "#ffe3a3", "#f6c66a", "#fff0c8", "#ffcf8a"];
const SKYC = ["#cfe6f6", "#c6e0f3", "#d6ebf8"];
const NAVY = ["#0e1724", "#111b2a", "#0b1420"];

// Window glass colour for a draw mode.
function glass(mode, dayList, litP = 0.34) {
  if (mode === "day") return pick(dayList);
  if (mode === "night") return rand() < litP ? pick(LIT) : "#060a10";
  if (mode === "inner") return pick(SKYC);
  return pick(NAVY);
}
const trim = (mode, t) => (mode === "night" ? "#000" : mode === "day" ? t : "#f4f2ee");
const bg = (mode, c) => (mode === "night" ? "#000" : mode === "day" ? c : "#e6e1d8");
function fill(ctx, c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
function speckle(ctx, S, n, light, dark, a0, a1, w0, w1, h = 2) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? dark : light},${rr(a0, a1)})`;
    ctx.fillRect(rand() * S, rand() * S, rr(w0, w1), h);
  }
}

function makeFacade(name, style, withInner = false) {
  const { cols, rows } = style;
  const paint = (mode) => (ctx, S) => {
    const cw = S / cols, ch = S / rows;
    style.bg(ctx, S, mode, cw, ch);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) style.cell(ctx, c * cw, r * ch, cw, ch, mode, c, r);
    if (style.post) style.post(ctx, S, mode, cw, ch);
  };
  const tex = canvasTex(name, 512, paint("day"));
  const nightTex = canvasTex(name + "N", 512, paint("night"));
  const mat = new BABYLON.StandardMaterial(name + "M", scene);
  mat.diffuseTexture = tex;
  const sp = style.spec ?? 0.04;
  mat.specularColor = new C3(sp, sp, sp);
  mat.specularPower = 48;
  const tileW = cols * style.cellW, tileH = rows * style.cellH;
  const f = { name, style, mat, nightTex, out: makeAcc(name + "Out", mat, tileW, tileH) };
  if (withInner) {
    f.itex = canvasTex(name + "In", 512, paint("inner"));
    f.itexN = canvasTex(name + "InN", 512, paint("innerN"));
    f.imat = new BABYLON.StandardMaterial(name + "InM", scene);
    f.imat.diffuseTexture = f.itex;
    f.imat.specularColor = new C3(0, 0, 0);
    f.imat.emissiveColor = new C3(0.32, 0.32, 0.32);
    f.imat.__dayEm = f.imat.emissiveColor.clone();
    f.inn = makeAcc(name + "Inner", f.imat, tileW, tileH);
  }
  facadeList.push(f);
  return f;
}

export const FAC = {};
export function createFacades() {
  // ---------------- New York ----------------
  FAC.glass = makeFacade("glass", {
    cols: 8, rows: 8, cellW: 2.4, cellH: 3.4, spec: 0.18,
    bg: (ctx, S, m) => fill(ctx, bg(m, "#6a7075"), 0, 0, S, S),
    cell(ctx, x, y, cw, ch, m) {
      fill(ctx, glass(m, ["#2b3236", "#343c41", "#3e474d", "#262c30", "#4a545a", "#30383d"]), x + 3, y + 3, cw - 6, ch - 6);
      if (m === "day" && rand() < 0.35) {
        const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
        g.addColorStop(0, "rgba(180,200,215,0.18)"); g.addColorStop(1, "rgba(180,200,215,0)");
        fill(ctx, g, x + 3, y + 3, cw - 6, ch - 6);
      }
    },
  }, true);

  FAC.office = makeFacade("office", {
    cols: 6, rows: 8, cellW: 3.2, cellH: 3.6, spec: 0.08,
    bg: (ctx, S, m) => fill(ctx, bg(m, "#8f8e88"), 0, 0, S, S),
    cell(ctx, x, y, cw, ch, m) {
      fill(ctx, glass(m, ["#2a2f33", "#353b40", "#2f353a", "#3f474d"]), x + 4, y + ch * 0.18, cw - 8, ch * 0.62);
      fill(ctx, m === "day" ? "#8f8e88" : trim(m, ""), x + cw / 2 - 1.5, y + ch * 0.18, 3, ch * 0.62);
    },
  }, true);

  // Pre-war brick with black fire escapes zig-zagging down the middle bay.
  FAC.brick = makeFacade("brick", {
    cols: 8, rows: 6, cellW: 2.2, cellH: 3.2, spec: 0.03,
    bg(ctx, S, m, cw) {
      fill(ctx, bg(m, "#6e4636"), 0, 0, S, S);
      if (m !== "day") return;
      speckle(ctx, S, 5000, "160,110,90", "30,15,10", 0.04, 0.14, 3, 7);
      ctx.fillStyle = "#56352a";
      for (let c = 0; c <= 8; c += 2) ctx.fillRect(c * cw - 5, 0, 10, S);
    },
    cell(ctx, x, y, cw, ch, m) {
      const wx = x + cw * 0.2, wy = y + ch * 0.2, ww = cw * 0.6, wh = ch * 0.62;
      const t = trim(m, "#cfc9bd");
      fill(ctx, t, wx - 3, wy - 3, ww + 6, wh + 8);
      fill(ctx, glass(m, ["#3d4a52", "#56656e", "#46545c", "#2f3a40"]), wx, wy, ww, wh);
      fill(ctx, t, wx + ww / 2 - 1.5, wy, 3, wh);
      fill(ctx, t, wx, wy + wh * 0.45, ww, 3);
    },
    post(ctx, S, m, cw, ch) {
      if (m !== "day") return;
      ctx.strokeStyle = "#141414"; ctx.fillStyle = "#141414";
      const x0 = 3 * cw - 8, x1 = 5 * cw + 8;
      for (let r = 0; r < 6; r++) {
        const py = r * ch + ch * 0.86;
        ctx.fillRect(x0, py, x1 - x0, 5);                // platform
        ctx.fillRect(x0, py - ch * 0.3, x1 - x0, 2);      // top rail
        for (let x = x0; x <= x1; x += 9) ctx.fillRect(x, py - ch * 0.3, 1.5, ch * 0.3);
        ctx.lineWidth = 3;
        ctx.beginPath();
        const flip = r % 2;
        ctx.moveTo(flip ? x1 - 12 : x0 + 12, py);
        ctx.lineTo(flip ? x0 + 30 : x1 - 30, py + ch);
        ctx.stroke();
      }
    },
  }, true);

  FAC.beige = makeFacade("beige", {
    cols: 6, rows: 6, cellW: 3, cellH: 3.4, spec: 0.03,
    bg: (ctx, S, m) => fill(ctx, bg(m, "#b9ad97"), 0, 0, S, S),
    cell(ctx, x, y, cw, ch, m) {
      fill(ctx, glass(m, ["#3b4247", "#4a535a", "#33393d"]), x + cw * 0.15, y + ch * 0.22, cw * 0.7, ch * 0.55);
    },
  }, true);

  // Art Deco limestone: strong vertical piers, recessed spandrels.
  FAC.deco = makeFacade("deco", {
    cols: 6, rows: 8, cellW: 2.6, cellH: 3.5, spec: 0.05,
    bg(ctx, S, m, cw, ch) {
      fill(ctx, bg(m, "#cdbfa3"), 0, 0, S, S);
      if (m !== "day") return;
      speckle(ctx, S, 1500, "240,230,210", "120,100,70", 0.03, 0.08, 2, 5);
      for (let c = 0; c <= 6; c++) fill(ctx, "#b6a789", c * cw - cw * 0.09, 0, cw * 0.18, S);
    },
    cell(ctx, x, y, cw, ch, m) {
      if (m === "day") fill(ctx, "#a8987a", x + cw * 0.2, y + ch * 0.8, cw * 0.6, ch * 0.18);
      fill(ctx, glass(m, ["#2c3238", "#353c43", "#283036"]), x + cw * 0.22, y + ch * 0.1, cw * 0.56, ch * 0.68);
    },
  });

  // Brownstone: tall windows with pale stone lintels and sills.
  FAC.brown = makeFacade("brown", {
    cols: 3, rows: 4, cellW: 2.6, cellH: 3.3, spec: 0.03,
    bg(ctx, S, m) {
      fill(ctx, bg(m, "#6a4532"), 0, 0, S, S);
      if (m === "day") speckle(ctx, S, 3000, "150,100,75", "40,25,15", 0.05, 0.15, 2, 6);
    },
    cell(ctx, x, y, cw, ch, m) {
      if (m === "day") {
        fill(ctx, "#c9b596", x + cw * 0.17, y + ch * 0.07, cw * 0.66, ch * 0.09);
        fill(ctx, "#c9b596", x + cw * 0.19, y + ch * 0.8, cw * 0.62, ch * 0.05);
      }
      const t = trim(m, "#e8e1d4");
      fill(ctx, t, x + cw * 0.22, y + ch * 0.17, cw * 0.56, ch * 0.63);
      fill(ctx, glass(m, ["#2e363d", "#3a434a"]), x + cw * 0.25, y + ch * 0.19, cw * 0.5, ch * 0.59);
      fill(ctx, t, x + cw * 0.5 - 1.5, y + ch * 0.19, 3, ch * 0.59);
      fill(ctx, t, x + cw * 0.25, y + ch * 0.45, cw * 0.5, 3);
    },
  });

  // Street-level shopfronts (one storey tall tile).
  const shop = (name, awning, stone, cellW = 3.0) => makeFacade(name, {
    cols: 4, rows: 1, cellW, cellH: 4.5, spec: 0.1,
    bg: (ctx, S, m) => fill(ctx, bg(m, stone), 0, 0, S, S),
    cell(ctx, x, y, cw, ch, m, c) {
      if (m === "day") {
        for (let i = 0; i < 8; i++) fill(ctx, i % 2 ? "#f4efe4" : awning, x + cw * 0.06 + (i * cw * 0.88) / 8, y + ch * 0.06, (cw * 0.88) / 8 + 1, ch * 0.14);
        fill(ctx, "rgba(0,0,0,0.25)", x + cw * 0.06, y + ch * 0.2, cw * 0.88, ch * 0.03);
      }
      const gx = x + cw * 0.1, gy = y + ch * 0.25, gw = cw * 0.8, gh = ch * 0.73;
      if (m === "night") fill(ctx, rand() < 0.75 ? pick(LIT) : "#1a1206", gx, gy, gw, gh);
      else if (m === "day") {
        const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
        g.addColorStop(0, "#26303a"); g.addColorStop(1, "#5a4a36");
        fill(ctx, g, gx, gy, gw, gh);
        if (c === 1) fill(ctx, "#3b2a1e", x + cw * 0.38, gy + gh * 0.1, cw * 0.24, gh * 0.9);
      } else fill(ctx, glass(m, []), gx, gy, gw, gh);
    },
  });
  FAC.shopCity = shop("shopCity", "#1d3d6b", "#9a9488");
  FAC.shopParis = [shop("shopParisR", "#a3262a", "#d9ccb0"), shop("shopParisG", "#2d6a3e", "#d9ccb0"), shop("shopParisB", "#22365e", "#d9ccb0")];

  // ---------------- Paris ----------------
  // Haussmann limestone: rusticated joints, tall French windows, iron rails.
  FAC.haus = makeFacade("haus", {
    cols: 4, rows: 4, cellW: 3.0, cellH: 3.2, spec: 0.05,
    bg(ctx, S, m, cw, ch) {
      fill(ctx, bg(m, "#e8ddc5"), 0, 0, S, S);
      if (m !== "day") return;
      speckle(ctx, S, 1800, "250,245,230", "150,130,100", 0.03, 0.08, 2, 6);
      ctx.fillStyle = "rgba(150,130,100,0.28)";
      for (let y = 0; y < S; y += ch / 4) ctx.fillRect(0, y, S, 1.2);
      for (let r = 0; r < 16; r++) for (let x = (r % 2) * 40; x < S; x += 80) ctx.fillRect(x, r * (ch / 4), 1.2, ch / 4);
    },
    cell(ctx, x, y, cw, ch, m) {
      if (m === "day") {
        fill(ctx, "#f3ebd8", x + cw * 0.2, y + ch * 0.05, cw * 0.6, ch * 0.86);
        fill(ctx, "#d9cba9", x + cw * 0.17, y + ch * 0.02, cw * 0.66, ch * 0.05);
      }
      const gx = x + cw * 0.27, gy = y + ch * 0.12, gw = cw * 0.46, gh = ch * 0.74;
      fill(ctx, glass(m, ["#3b4556", "#454f60", "#353e4d"], 0.4), gx, gy, gw, gh);
      const t = trim(m, "#f6f2ea");
      fill(ctx, t, gx + gw / 2 - 1.5, gy, 3, gh);
      fill(ctx, t, gx, gy + gh * 0.24, gw, 3);
      if (m !== "night") {
        ctx.fillStyle = "#15171a";
        ctx.fillRect(gx - 4, y + ch * 0.6, gw + 8, 3);
        for (let bx = gx - 3; bx < gx + gw + 4; bx += 6) ctx.fillRect(bx, y + ch * 0.6, 1.6, ch * 0.26);
        ctx.fillRect(gx - 4, y + ch * 0.85, gw + 8, 2);
      }
    },
  });

  // European town houses: pastel render, shutters, flower boxes.
  const PALETTE = [
    ["#efe3c8", "#3f6b4a"], ["#f1dc9b", "#2f4f7a"], ["#e8b4a0", "#5b3a2a"],
    ["#bcd3e0", "#f4f1ea"], ["#f2efe8", "#2e5e8c"], ["#c9d3b2", "#7a3b2e"], ["#e9c9c9", "#4c5f74"],
  ];
  FAC.house = PALETTE.map(([wall, shut], i) => makeFacade("house" + i, {
    cols: 4, rows: 3, cellW: 2.6, cellH: 3.0, spec: 0.03, wall,
    bg(ctx, S, m) {
      fill(ctx, bg(m, wall), 0, 0, S, S);
      if (m === "day") speckle(ctx, S, 1200, "255,255,255", "90,80,60", 0.03, 0.07, 2, 5);
    },
    cell(ctx, x, y, cw, ch, m) {
      const t = trim(m, "#fbfaf6");
      fill(ctx, t, x + cw * 0.3, y + ch * 0.2, cw * 0.4, ch * 0.54);
      fill(ctx, glass(m, ["#4c5b68", "#56667a", "#43505c"], 0.45), x + cw * 0.33, y + ch * 0.23, cw * 0.34, ch * 0.48);
      fill(ctx, t, x + cw * 0.5 - 1.5, y + ch * 0.23, 3, ch * 0.48);
      fill(ctx, t, x + cw * 0.33, y + ch * 0.4, cw * 0.34, 3);
      if (m === "day") {
        for (const sx of [0.16, 0.7]) {
          fill(ctx, shut, x + cw * sx, y + ch * 0.2, cw * 0.14, ch * 0.54);
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          for (let ly = y + ch * 0.22; ly < y + ch * 0.72; ly += 5) ctx.fillRect(x + cw * sx, ly, cw * 0.14, 1.2);
        }
        if (rand() < 0.5) {
          fill(ctx, "#3d5a33", x + cw * 0.3, y + ch * 0.74, cw * 0.4, ch * 0.06);
          for (let k = 0; k < 9; k++) {
            ctx.fillStyle = pick(["#d23b4a", "#f06a8a", "#fff3f3", "#e8892b"]);
            ctx.beginPath(); ctx.arc(x + cw * (0.32 + k * 0.045), y + ch * 0.735, 3, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    },
  }));
}

// ---------------------------------------------------------------- roofs & small textures
export function tileRoofTex() {
  return canvasTex("roofTile", 256, (ctx, S) => {
    fill(ctx, "#a9492b", 0, 0, S, S);
    const rowH = 16, tw = 20;
    for (let r = 0; r < S / rowH; r++) {
      for (let x = -(r % 2) * (tw / 2); x < S; x += tw) {
        ctx.fillStyle = pick(["#b5532f", "#a8482a", "#c4633c", "#9e4326", "#b95a35"]);
        ctx.beginPath();
        ctx.moveTo(x, r * rowH);
        ctx.lineTo(x + tw, r * rowH);
        ctx.lineTo(x + tw, r * rowH + rowH - 3);
        ctx.quadraticCurveTo(x + tw / 2, r * rowH + rowH + 3, x, r * rowH + rowH - 3);
        ctx.fill();
      }
      fill(ctx, "rgba(60,20,10,0.35)", 0, r * rowH + rowH - 2, S, 2);
    }
  });
}
export function slateRoofTex() {
  return canvasTex("roofSlate", 256, (ctx, S) => {
    fill(ctx, "#3f4652", 0, 0, S, S);
    for (let r = 0; r < S / 12; r++) {
      for (let x = -(r % 2) * 9; x < S; x += 18) fill(ctx, pick(["#4a5260", "#525b69", "#444b57", "#56606e"]), x + 1, r * 12 + 1, 16, 10);
    }
  });
}
export function zincRoofTex() {
  return canvasTex("roofZinc", 128, (ctx, S) => {
    fill(ctx, "#7c8996", 0, 0, S, S);
    for (let x = 0; x < S; x += 16) { fill(ctx, "#93a0ac", x, 0, 2, S); fill(ctx, "#66717c", x + 2, 0, 1, S); }
  });
}
export function dormerTex() {
  return canvasTex("dormer", 128, (ctx, S) => {
    fill(ctx, "#ece4d0", 0, 0, S, S);
    fill(ctx, "#f8f4ec", S * 0.18, S * 0.12, S * 0.64, S * 0.8);
    fill(ctx, "#3b4556", S * 0.24, S * 0.18, S * 0.52, S * 0.7);
    fill(ctx, "#f8f4ec", S * 0.5 - 2, S * 0.18, 4, S * 0.7);
  });
}
export function railingTex() {
  const t = canvasTex("railing", 128, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#121315";
    ctx.fillRect(0, 0, S, 10);
    ctx.fillRect(0, S - 8, S, 8);
    for (let x = 4; x < S; x += 12) ctx.fillRect(x, 0, 3, S);
    ctx.strokeStyle = "#121315"; ctx.lineWidth = 3;
    for (let x = 10; x < S; x += 24) { ctx.beginPath(); ctx.arc(x, S / 2, 8, 0, Math.PI * 2); ctx.stroke(); }
  }, true);
  t.hasAlpha = true;
  return t;
}

// ---------------------------------------------------------------- ground + paving
export function noiseTex(name, base, n, light, dark, size = 256, blob = [1, 3]) {
  return canvasTex(name, size, (ctx, S) => {
    fill(ctx, base, 0, 0, S, S);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? light : dark},${rr(0.04, 0.16)})`;
      ctx.fillRect(rand() * S, rand() * S, rr(blob[0], blob[1]), rr(blob[0], blob[1]));
    }
  });
}
export function slabTex(name, base, line, n = 4, size = 256) {
  return canvasTex(name, size, (ctx, S) => {
    fill(ctx, base, 0, 0, S, S);
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? "255,255,255" : "0,0,0"},${rr(0.02, 0.06)})`;
      ctx.fillRect(rand() * S, rand() * S, 2, 2);
    }
    ctx.fillStyle = line;
    for (let i = 0; i <= n; i++) { ctx.fillRect((i * S) / n - 1, 0, 2, S); ctx.fillRect(0, (i * S) / n - 1, S, 2); }
  });
}
export function cobbleTex() {
  return canvasTex("cobble", 256, (ctx, S) => {
    fill(ctx, "#8d8576", 0, 0, S, S);
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
      ctx.fillStyle = pick(["#b3a993", "#a89e88", "#bdb39d", "#9f957f", "#c2b8a2"]);
      const ox = (r % 2) * 8;
      ctx.beginPath();
      ctx.ellipse(c * 16 + ox + 8, r * 16 + 8, 7, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
