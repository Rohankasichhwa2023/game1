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
  const SZ = style.size || 512;
  const tex = canvasTex(name, SZ, paint("day"));
  const nightTex = canvasTex(name + "N", SZ, paint("night"));
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

  createLondonFacades();
  createKathmanduFacades();
}

// ---------------- London ----------------
// Georgian / Victorian sash window: white frame, 6-over-6 glazing bars.
function sash(ctx, m, x, y, w, h, glassList, litP = 0.38) {
  const t = trim(m, "#f4f1ea");
  fill(ctx, t, x - 3, y - 3, w + 6, h + 6);
  fill(ctx, glass(m, glassList, litP), x, y, w, h);
  if (m === "night") return;
  ctx.fillStyle = t;
  ctx.fillRect(x, y + h / 2 - 2, w, 4);                      // meeting rail
  for (const f of [1 / 3, 2 / 3]) ctx.fillRect(x + w * f - 1, y, 2, h);
  for (const f of [0.25, 0.75]) ctx.fillRect(x, y + h * f - 1, w, 2);
}
const LON_GLASS = ["#2d343c", "#38414a", "#323a42", "#424c56"];
function createLondonFacades() {
  FAC.lon = {};
  // Brick terraces: London stock (yellow-grey), red, and soot-dark brick.
  const bricks = { stock: ["#a8966f", "#8d7c5a"], red: ["#94503a", "#7a3e2c"], dark: ["#6b5848", "#56463a"] };
  for (const [key, [wall, mortar]] of Object.entries(bricks)) {
    FAC.lon[key] = makeFacade("lon_" + key, {
      cols: 2, rows: 4, cellW: 2.6, cellH: 3.2, spec: 0.03, wall,
      bg(ctx, S, m) {
        fill(ctx, bg(m, wall), 0, 0, S, S);
        if (m !== "day") return;
        speckle(ctx, S, 4200, "200,180,150", "40,30,20", 0.05, 0.16, 3, 8);
        ctx.fillStyle = `rgba(60,50,40,0.18)`;
        for (let yy = 0; yy < S; yy += 6) ctx.fillRect(0, yy, S, 1);
        ctx.fillStyle = mortar;
        ctx.globalAlpha = 0.25;
        for (let i = 0; i < 260; i++) ctx.fillRect(rand() * S, Math.floor(rand() * S / 6) * 6, rr(8, 14), 5);
        ctx.globalAlpha = 1;
      },
      cell(ctx, x, y, cw, ch, m) {
        const wx = x + cw * 0.27, wy = y + ch * 0.18, ww = cw * 0.46, wh = ch * 0.62;
        if (m === "day") {
          fill(ctx, "#ddd3bd", wx - 6, wy - 12, ww + 12, 9);        // stone lintel
          fill(ctx, "#d4c9b0", wx - 7, wy + wh + 4, ww + 14, 6);    // sill
          fill(ctx, "rgba(0,0,0,0.12)", wx - 7, wy + wh + 10, ww + 14, 3);
        }
        sash(ctx, m, wx, wy, ww, wh, LON_GLASS);
      },
    }, false);
  }
  // Painted stucco (Belgravia white, Notting Hill pastels): rusticated
  // ground band, window cornices, iron balconettes.
  const stuccos = { white: "#efebe1", cream: "#ece0c4", pink: "#e8c4c0", blue: "#c4d6df", mint: "#cfe0c8", lemon: "#efe0a6" };
  for (const [key, wall] of Object.entries(stuccos)) {
    FAC.lon[key] = makeFacade("lon_" + key, {
      cols: 2, rows: 4, cellW: 2.6, cellH: 3.2, spec: 0.04, wall, stucco: true,
      bg(ctx, S, m, cw, ch) {
        fill(ctx, bg(m, wall), 0, 0, S, S);
        if (m !== "day") return;
        speckle(ctx, S, 900, "255,255,255", "120,110,90", 0.03, 0.07, 2, 5);
        ctx.fillStyle = "rgba(110,100,80,0.28)";
        for (let yy = S - ch; yy < S; yy += ch / 5) ctx.fillRect(0, yy, S, 2);   // rustication (bottom row)
        fill(ctx, "rgba(255,255,255,0.5)", 0, S - ch - 6, S, 5);
      },
      cell(ctx, x, y, cw, ch, m, c, r) {
        const wx = x + cw * 0.28, wy = y + ch * 0.2, ww = cw * 0.44, wh = ch * 0.6;
        if (m === "day") {
          fill(ctx, "rgba(0,0,0,0.13)", wx - 9, wy - 10, ww + 18, 4);
          fill(ctx, "#faf8f2", wx - 9, wy - 15, ww + 18, 6);           // window cornice
          fill(ctx, "#faf8f2", wx - 6, wy - 3, ww + 12, wh + 7);       // architrave
        }
        sash(ctx, m, wx, wy, ww, wh, LON_GLASS, 0.42);
        if (m !== "night" && r === 2) {                                // first-floor balconette
          ctx.fillStyle = "#16181a";
          ctx.fillRect(wx - 8, wy + wh * 0.62, ww + 16, 3);
          for (let bx = wx - 7; bx < wx + ww + 8; bx += 5) ctx.fillRect(bx, wy + wh * 0.62, 1.5, wh * 0.38);
        }
      },
    }, false);
  }
  // Red-brick Edwardian mansion block with white stone banding.
  FAC.lonMansion = makeFacade("lonMansion", {
    cols: 4, rows: 4, cellW: 3.0, cellH: 3.2, spec: 0.03, wall: "#8f4532",
    bg(ctx, S, m, cw, ch) {
      fill(ctx, bg(m, "#8f4532"), 0, 0, S, S);
      if (m !== "day") return;
      speckle(ctx, S, 4000, "190,120,95", "40,15,10", 0.05, 0.15, 3, 7);
      for (let r = 0; r < 4; r++) fill(ctx, "#e6dccb", 0, r * ch + ch * 0.83, S, ch * 0.07);
    },
    cell(ctx, x, y, cw, ch, m) {
      const wx = x + cw * 0.22, wy = y + ch * 0.16, ww = cw * 0.56, wh = ch * 0.62;
      if (m === "day") fill(ctx, "#e6dccb", wx - 5, wy - 7, ww + 10, 6);
      sash(ctx, m, wx, wy, ww, wh, LON_GLASS);
    },
  }, false);

  // Shop fronts / pubs: painted timber surround, fascia board with gilt
  // lettering, big glazed window with a door to one side.
  const lonShop = (name, paint, fasciaText) => makeFacade(name, {
    cols: 2, rows: 1, cellW: 2.6, cellH: 4.2, spec: 0.08,
    bg: (ctx, S, m) => fill(ctx, bg(m, paint), 0, 0, S, S),
    cell(ctx, x, y, cw, ch, m, c) {
      if (m === "day") {
        fill(ctx, "#111", x, y + ch * 0.06, cw, ch * 0.16);
        fill(ctx, paint, x + 3, y + ch * 0.07, cw - 6, ch * 0.14);
        ctx.fillStyle = fasciaText;
        for (let k = 0; k < 5; k++) ctx.fillRect(x + cw * (0.14 + k * 0.15), y + ch * 0.11, cw * 0.1, ch * 0.06);
      }
      const gx = x + cw * 0.1, gy = y + ch * 0.27, gw = cw * 0.8, gh = ch * 0.66;
      if (m === "night") fill(ctx, rand() < 0.8 ? pick(LIT) : "#1a1206", gx, gy, gw, gh);
      else if (m === "day") {
        const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
        g.addColorStop(0, "#28313a"); g.addColorStop(1, "#4d3f30");
        fill(ctx, g, gx, gy, gw, gh);
        ctx.fillStyle = paint;
        for (const f of [1 / 3, 2 / 3]) ctx.fillRect(gx + gw * f - 2, gy, 4, gh * 0.72);
        ctx.fillRect(gx, gy + gh * 0.24, gw, 3);
        fill(ctx, paint, gx, gy + gh * 0.72, gw, gh * 0.28);              // stall riser
        if (c === 1) fill(ctx, "#2a1e16", x + cw * 0.58, gy + gh * 0.05, cw * 0.28, gh * 0.95);
      } else fill(ctx, glass(m, []), gx, gy, gw, gh);
    },
  });
  FAC.lonShops = [
    lonShop("lonShopGreen", "#1f4a36", "#d8b45a"), lonShop("lonShopNavy", "#1d2c4d", "#e8e2cf"),
    lonShop("lonShopBlack", "#1a1a1c", "#d8b45a"), lonShop("lonShopRed", "#7d1f25", "#f0e6cf"),
    lonShop("lonShopTeal", "#2e6670", "#f4efe2"), lonShop("lonShopCream", "#d9cfb6", "#2b2b2b"),
  ];
  FAC.lonPubs = [lonShop("lonPubOx", "#4a1418", "#e0b84e"), lonShop("lonPubGreen", "#16352a", "#e0b84e")];
}

// ---------------- Kathmandu ----------------
// Newar brick: thin red fired brick with pale mortar courses, dark carved
// timber windows with a diamond lattice (they glow through the lattice at
// night); shopfronts with roll-up shutters and painted signboards; plastered
// concrete houses in the usual pastel / ochre washes.
const KTM_WOOD = "#3b2418";
function lattice(ctx, m, x, y, w, h, litP = 0.45) {
  if (m === "night") fill(ctx, rand() < litP ? pick(LIT) : "#060a10", x, y, w, h);
  else {
    fill(ctx, KTM_WOOD, x - 6, y - 6, w + 12, h + 12);
    fill(ctx, "#1c110b", x, y, w, h);
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = m === "night" ? "#000" : "#6a4428"; ctx.lineWidth = m === "night" ? 2.5 : 2;
  ctx.beginPath();
  for (let k = -h; k < w + h; k += 10) { ctx.moveTo(x + k, y); ctx.lineTo(x + k + h, y + h); ctx.moveTo(x + k + h, y); ctx.lineTo(x + k, y + h); }
  ctx.stroke();
  ctx.restore();
  if (m === "day") {
    fill(ctx, KTM_WOOD, x - 14, y - 15, w + 28, 9);                 // carved lintel, ends sticking out
    fill(ctx, "#4a2c1b", x - 9, y + h + 5, w + 18, 6);              // sill
    fill(ctx, "rgba(0,0,0,0.25)", x - 9, y + h + 11, w + 18, 3);
  }
}
function brickBg(ctx, S, m, wall) {
  fill(ctx, bg(m, wall), 0, 0, S, S);
  if (m !== "day") return;
  speckle(ctx, S, 5200, "235,160,120", "70,25,12", 0.05, 0.18, 3, 9);
  ctx.fillStyle = "#c9b79c"; ctx.globalAlpha = 0.32;
  for (let yy = 0; yy < S; yy += 6) ctx.fillRect(0, yy, S, 1.3);       // brick courses
  ctx.globalAlpha = 1;
}
function createKathmanduFacades() {
  FAC.ktm = {};
  // upper storeys: a wide carved window band and a pair of small lattice windows
  for (const [key, wall] of [["brickDark", "#b5543a"], ["brickLight", "#c8693f"]]) {
    FAC.ktm[key] = makeFacade("ktm_" + key, {
      cols: 2, rows: 2, cellW: 2.4, cellH: 2.8, spec: 0.03, wall,
      bg: (ctx, S, m) => brickBg(ctx, S, m, wall),
      cell(ctx, x, y, cw, ch, m, c, r) {
        if (r === 0) lattice(ctx, m, x + cw * 0.1, y + ch * 0.22, cw * 0.8, ch * 0.5);
        else lattice(ctx, m, x + cw * 0.34, y + ch * 0.26, cw * 0.32, ch * 0.42, 0.35);
      },
      post(ctx, S, m) {
        if (m === "day") for (let r = 0; r < 2; r++) fill(ctx, "rgba(40,15,8,0.16)", 0, r * S / 2 + S / 2 - 12, S, 12);  // soot under the eaves / bands
      },
    });
  }
  // ground storey: plain and solid, small lattice windows and a carved door
  FAC.ktm.brickGround = makeFacade("ktm_brickGround", {
    cols: 2, rows: 1, cellW: 2.4, cellH: 3.2, spec: 0.03, wall: "#a94d35",
    bg(ctx, S, m) {
      brickBg(ctx, S, m, "#a94d35");
      if (m !== "day") return;
      const g = ctx.createLinearGradient(0, S * 0.7, 0, S);
      g.addColorStop(0, "rgba(30,15,10,0)"); g.addColorStop(1, "rgba(30,15,10,0.45)");   // damp + soot near the street
      fill(ctx, g, 0, S * 0.7, S, S * 0.3);
    },
    cell(ctx, x, y, cw, ch, m, c) {
      if (c === 0) { lattice(ctx, m, x + cw * 0.38, y + ch * 0.32, cw * 0.24, ch * 0.16, 0.3); return; }
      const dx = x + cw * 0.27, dw = cw * 0.46, dy = y + ch * 0.3, dh = ch * 0.7;
      if (m === "night") { fill(ctx, "#040404", dx, dy, dw, dh); return; }
      fill(ctx, KTM_WOOD, dx - 10, dy - 22, dw + 20, dh + 22);                 // ornate frame
      ctx.fillStyle = "#2a170e";
      ctx.beginPath(); ctx.arc(dx + dw / 2, dy - 4, dw * 0.55, Math.PI, 0); ctx.fill();   // carved tympanum (torana)
      fill(ctx, "#4a2c1b", dx, dy, dw / 2 - 2, dh); fill(ctx, "#43271a", dx + dw / 2 + 2, dy, dw / 2 - 2, dh);   // double door
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      for (let k = 1; k < 4; k++) ctx.fillRect(dx, dy + (dh * k) / 4, dw, 3);
      fill(ctx, "#c9a227", dx + dw / 2 - 8, dy + dh * 0.5, 4, 8); fill(ctx, "#c9a227", dx + dw / 2 + 4, dy + dh * 0.5, 4, 8);
    },
  });
  // shopfronts: roll-up shutters (some open on lit, crowded shelves), signboards
  const SIGNS = [["#b3261e", "#ffe9a8"], ["#1f4e8c", "#ffffff"], ["#1d6b3a", "#fff3c4"], ["#d9a21b", "#3a1a0a"]];
  FAC.ktm.shops = [0, 1, 2].map((v) => makeFacade("ktm_shop" + v, {
    cols: 2, rows: 1, cellW: 2.4, cellH: 3.2, spec: 0.06,
    bg: (ctx, S, m) => fill(ctx, bg(m, v === 1 ? "#d9cdb6" : "#9d4a33"), 0, 0, S, S),
    cell(ctx, x, y, cw, ch, m, c) {
      const [board, ink] = SIGNS[(v + c) % SIGNS.length];
      const ox = x + cw * 0.05, ow = cw * 0.9, oy = y + ch * 0.27, oh = ch * 0.73;
      const open = (v + c) % 3 !== 2;
      if (m === "night") { fill(ctx, open && rand() < 0.85 ? pick(LIT) : "#050505", ox, oy, ow, oh); return; }
      fill(ctx, board, x + 2, y + ch * 0.06, cw - 4, ch * 0.17);                // signboard
      ctx.fillStyle = ink;
      for (let k = 0; k < 5; k++) ctx.fillRect(x + cw * (0.1 + k * 0.16), y + ch * 0.1, cw * 0.11, ch * 0.08);
      if (open) {
        fill(ctx, "#2b2018", ox, oy, ow, oh);
        const goods = ["#d94f3d", "#f2c14e", "#3d8fd9", "#5fbf6a", "#e8e2d0", "#b05fd9"];
        for (let k = 0; k < 70; k++) fill(ctx, pick(goods), ox + rand() * (ow - 8), oy + 6 + rand() * (oh * 0.75), rr(4, 10), rr(4, 9));
        fill(ctx, "#8a8f94", ox, oy, ow, oh * 0.12);                            // shutter rolled up
      } else {
        fill(ctx, "#8a8f94", ox, oy, ow, oh);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        for (let yy = oy; yy < oy + oh; yy += 6) ctx.fillRect(ox, yy, ow, 2);
      }
    },
  }));
  // small grocery shops (kirana pasal): signboard, shutter rolled up on a
  // cramped shop — shelves of packets, strings of snack packets hanging at the
  // front, sacks of rice and lentils on the floor, a little counter
  const GROC = [["#c62828", "#ffd54f"], ["#f9a825", "#7a1010"], ["#2e7d32", "#ffffff"]];
  FAC.ktm.grocery = GROC.map(([board, ink], v) => makeFacade("ktm_grocery" + v, {
    cols: 2, rows: 1, cellW: 2.4, cellH: 3.2, spec: 0.06,
    bg: (ctx, S, m) => fill(ctx, bg(m, v === 2 ? "#cfc4ae" : "#a3523a"), 0, 0, S, S),
    cell(ctx, x, y, cw, ch, m, c) {
      const ox = x + cw * 0.04, ow = cw * 0.92, oy = y + ch * 0.26, oh = ch * 0.74;
      if (m === "night") { fill(ctx, rand() < 0.9 ? pick(LIT) : "#050505", ox, oy, ow, oh); return; }
      fill(ctx, board, x + 2, y + ch * 0.05, cw - 4, ch * 0.18);                  // signboard
      ctx.fillStyle = ink;
      for (let k = 0; k < 6; k++) ctx.fillRect(x + cw * (0.08 + k * 0.145), y + ch * 0.09, cw * 0.1, ch * 0.09);
      fill(ctx, "#2a1e15", ox, oy, ow, oh);                                       // shop interior
      const goods = ["#e53935", "#fdd835", "#1e88e5", "#43a047", "#fb8c00", "#f5f5f5", "#8e24aa", "#00acc1"];
      for (let r = 0; r < 4; r++) {                                               // shelves stacked with packets
        const sy = oy + oh * (0.12 + r * 0.16);
        fill(ctx, "#6d4c33", ox + 4, sy + oh * 0.13, ow - 8, 4);
        for (let gx = ox + 6; gx < ox + ow - 10; gx += rr(6, 11)) fill(ctx, pick(goods), gx, sy + rr(2, 6), rr(4, 9), oh * 0.13 - rr(2, 6));
      }
      for (let k = 0; k < 7; k++) {                                               // hanging strings of snack packets
        const hx = ox + 8 + (k * (ow - 16)) / 6;
        for (let j = 0; j < 5; j++) fill(ctx, pick(goods), hx - 4, oy + 4 + j * 10, 8, 8);
      }
      for (let k = 0; k < 4; k++) {                                               // sacks of rice / lentils / flour
        const sx = ox + 6 + k * (ow / 4.2), sw = ow / 4.8;
        ctx.fillStyle = pick(["#d7c49e", "#cbb184", "#e3d6b8"]);
        ctx.beginPath(); ctx.ellipse(sx + sw / 2, oy + oh * 0.9, sw / 2, oh * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        fill(ctx, pick(["#f2c14e", "#c0703a", "#f5f0e0"]), sx + sw * 0.2, oy + oh * 0.8, sw * 0.6, oh * 0.05);   // grain heaped on top
      }
      if (c === 1) fill(ctx, "#5d4030", ox + ow * 0.55, oy + oh * 0.68, ow * 0.45, oh * 0.32);   // counter
      fill(ctx, "#8a8f94", ox, oy, ow, oh * 0.07);                                // rolled-up shutter
    },
  }));
  // plastered concrete houses
  const PLASTER =[["cream", "#e8dcbf"], ["salmon", "#e3b9a4"], ["ochre", "#d8a55e"], ["sky", "#bcd2dc"]];
  FAC.ktm.plaster = PLASTER.map(([k, wall]) => makeFacade("ktm_plaster_" + k, {
    cols: 2, rows: 1, cellW: 2.4, cellH: 3.0, spec: 0.03, wall, size: 256,
    bg(ctx, S, m) {
      fill(ctx, bg(m, wall), 0, 0, S, S);
      if (m !== "day") return;
      speckle(ctx, S, 700, "255,255,255", "90,80,60", 0.04, 0.1, 2, 6);
      for (let i = 0; i < 6; i++) fill(ctx, "rgba(80,70,55,0.08)", rand() * S, 0, rr(3, 10), S);   // rain streaks
      fill(ctx, "rgba(255,255,255,0.35)", 0, S - 7, S, 5);                                     // slab edge
    },
    cell(ctx, x, y, cw, ch, m) {
      const wx = x + cw * 0.22, wy = y + ch * 0.3, ww = cw * 0.56, wh = ch * 0.42;
      if (m === "day") { fill(ctx, "rgba(0,0,0,0.18)", wx - 8, wy - 9, ww + 16, 6); fill(ctx, "#d7d4cc", wx - 4, wy - 4, ww + 8, wh + 8); }
      fill(ctx, glass(m, ["#3b5560", "#46636e", "#2f4650"], 0.36), wx, wy, ww, wh);
      if (m === "day") { fill(ctx, "#d7d4cc", wx + ww / 2 - 1, wy, 2, wh); fill(ctx, "#d7d4cc", wx, wy + wh / 2 - 1, ww, 2); }
    },
  }));
  // whitewashed neoclassical (Durbar Square): white lattice windows, pilasters
  FAC.ktm.white = makeFacade("ktm_white", {
    cols: 2, rows: 1, cellW: 2.4, cellH: 3.2, spec: 0.05, wall: "#f2f0ea",
    bg(ctx, S, m) {
      fill(ctx, bg(m, "#f2f0ea"), 0, 0, S, S);
      if (m !== "day") return;
      speckle(ctx, S, 800, "255,255,255", "120,115,100", 0.03, 0.08, 2, 6);
      for (let c = 0; c < 2; c++) fill(ctx, "rgba(0,0,0,0.07)", c * S / 2, 0, 10, S);       // pilasters
      fill(ctx, "rgba(0,0,0,0.1)", 0, 12, S, 6);
    },
    cell(ctx, x, y, cw, ch, m) {
      const wx = x + cw * 0.28, wy = y + ch * 0.22, ww = cw * 0.44, wh = ch * 0.56;
      if (m === "night") { fill(ctx, rand() < 0.4 ? pick(LIT) : "#060a10", wx, wy, ww, wh); return; }
      fill(ctx, "#e4e1d8", wx - 10, wy - 10, ww + 20, wh + 20);
      fill(ctx, "#2f3a40", wx, wy, ww, wh);
      ctx.fillStyle = "#f7f6f2";
      for (let k = 1; k < 4; k++) ctx.fillRect(wx + (ww * k) / 4 - 2, wy, 4, wh);
      for (let k = 1; k < 5; k++) ctx.fillRect(wx, wy + (wh * k) / 5 - 2, ww, 4);
    },
  });
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
