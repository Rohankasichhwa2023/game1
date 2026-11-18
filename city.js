// city.js — Babylon.js city: glass/brick towers, sandy lots, beach + ocean,
// asphalt roads with sidewalks and street lamps, parked + driving traffic,
// drivable cars and bikes, shooting, super-jumps onto rooftops, a day/night
// cycle, and 10 enterable buildings with lobbies, stairs, rooms and roofs.
(function () {
  "use strict";

  const canvas = document.getElementById("renderCanvas");
  const engine = new BABYLON.Engine(canvas, true, { stencil: false });
  const scene = new BABYLON.Scene(engine);
  const V3 = BABYLON.Vector3;

  // ---------------------------------------------------------------- constants
  const PITCH = 80;          // block-to-block spacing (m)
  const ASPHALT = 10;        // asphalt width
  const SIDEWALK = 3;        // sidewalk width each side
  const K_MIN = -6, K_MAX = 6; // block indices on each axis
  const SHORE_X = -528;      // ocean starts west of this
  const CITY_MAX = 540;
  const DOWNTOWN = { x: 60, z: 60 };
  const START = { x: -466, z: -250 };

  const SKY = new BABYLON.Color3(0.62, 0.78, 0.93);
  const NIGHT_SKY = new BABYLON.Color3(0.035, 0.05, 0.1);
  const SAND = new BABYLON.Color3(0.84, 0.78, 0.66);

  // Seeded PRNG so the city is the same every load.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(20261117);
  const rr = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------- scene setup
  scene.clearColor = new BABYLON.Color4(SKY.r, SKY.g, SKY.b, 1);
  scene.ambientColor = new BABYLON.Color3(0.25, 0.25, 0.27);
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
  scene.fogColor = SKY.clone();
  scene.fogStart = 280;
  scene.fogEnd = 1150;
  scene.skipPointerMovePicking = true;

  const hemi = new BABYLON.HemisphericLight("hemi", new V3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.78;
  hemi.diffuse = new BABYLON.Color3(1, 1, 1);
  hemi.groundColor = new BABYLON.Color3(0.5, 0.5, 0.53);
  hemi.specular = new BABYLON.Color3(0, 0, 0);

  const sun = new BABYLON.DirectionalLight("sun", new V3(-0.45, -1, 0.35), scene);
  sun.intensity = 0.5;
  sun.specular = new BABYLON.Color3(0.25, 0.25, 0.25);

  const camera = new BABYLON.FreeCamera("cam", new V3(0, 5, -10), scene);
  camera.fov = 1.0;
  camera.minZ = 0.05;
  camera.maxZ = 3000;
  camera.inputs.clear(); // we drive it ourselves

  // Glow only for things that should bloom (lamps, car lights, tracers…).
  const glow = new BABYLON.GlowLayer("glow", scene, { mainTextureFixedSize: 512, blurKernelSize: 32 });
  glow.intensity = 0.35;

  // ---------------------------------------------------------------- helpers
  const hex = (h) => BABYLON.Color3.FromHexString(h);
  const flatMats = [];      // unlit outdoor surfaces, dimmed at night
  const interiorMats = [];  // indoor surfaces, "lamp-lit" at night

  function flatMat(name, color, nightK = 0.2) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.disableLighting = true;
    m.emissiveColor = color;
    if (nightK !== 1) flatMats.push({ m, day: color.clone(), k: nightK });
    return m;
  }
  function litMat(name, color, spec = 0.05) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = color;
    m.specularColor = new BABYLON.Color3(spec, spec, spec);
    return m;
  }
  function indoor(m) {
    m.__dayEm = m.emissiveColor.clone();
    interiorMats.push(m);
    return m;
  }
  function canvasTex(name, w, draw, mips = true, h = w) {
    const t = new BABYLON.DynamicTexture(name, { width: w, height: h }, scene, mips);
    draw(t.getContext(), w, h);
    t.update();
    t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8;
    return t;
  }
  function radialTex(name, stops, size = 128) {
    const t = canvasTex(name, size, (ctx, S) => {
      const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      for (const [o, c] of stops) g.addColorStop(o, c);
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    }, false);
    t.hasAlpha = true;
    t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    return t;
  }
  function emissiveTemplate(name, mesh, color) {
    const m = new BABYLON.StandardMaterial(name + "M", scene);
    m.disableLighting = true;
    m.emissiveColor = color;
    mesh.material = m;
    mesh.setEnabled(false);
    glow.addIncludedOnlyMesh(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- collision world
  // Every walkable/blocking thing is an axis-aligned box in a spatial hash.
  // Boxes can be switched off (s.off) — used for vehicles that start moving.
  const GRID = 8;
  const grid = new Map();
  const gkey = (ix, iz) => (ix + 2000) * 8192 + (iz + 2000);
  function addSolid(minX, minY, minZ, maxX, maxY, maxZ) {
    const s = { minX, minY, minZ, maxX, maxY, maxZ, stamp: 0, off: false, vehicle: null };
    for (let ix = Math.floor(minX / GRID); ix <= Math.floor(maxX / GRID); ix++) {
      for (let iz = Math.floor(minZ / GRID); iz <= Math.floor(maxZ / GRID); iz++) {
        const k = gkey(ix, iz);
        let cell = grid.get(k);
        if (!cell) { cell = []; grid.set(k, cell); }
        cell.push(s);
      }
    }
    return s;
  }
  let stamp = 0;
  const qbuf = [];
  function query(minX, maxX, minZ, maxZ) {
    stamp++;
    qbuf.length = 0;
    for (let ix = Math.floor(minX / GRID); ix <= Math.floor(maxX / GRID); ix++) {
      for (let iz = Math.floor(minZ / GRID); iz <= Math.floor(maxZ / GRID); iz++) {
        const cell = grid.get(gkey(ix, iz));
        if (!cell) continue;
        for (const s of cell) {
          if (s.stamp === stamp) continue;
          s.stamp = stamp;
          if (!s.off) qbuf.push(s);
        }
      }
    }
    return qbuf;
  }
  function circleHitsBox(x, z, r, s) {
    const cx = clamp(x, s.minX, s.maxX), cz = clamp(z, s.minZ, s.maxZ);
    return (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r;
  }

  // ---------------------------------------------------------------- mesh accumulators
  // Boxes are appended into one big mesh per material. UVs are world-aligned
  // (relative to a per-box origin) so window grids line up across pieces and
  // the inside windows sit exactly behind the outside ones.
  const accs = [];
  function makeAcc(name, mat, tw = 1, th = 1) {
    mat.backFaceCulling = false;
    const a = { name, mat, tw, th, pos: [], nrm: [], uv: [], idx: [], mesh: null };
    accs.push(a);
    return a;
  }
  const ZERO = { x: 0, y: 0, z: 0 };
  function addBox(x0, y0, z0, x1, y1, z1, faceFn, o = ZERO) {
    const faces = [
      ["+x", x1, [1, 0, 0]], ["-x", x0, [-1, 0, 0]],
      ["+y", y1, [0, 1, 0]], ["-y", y0, [0, -1, 0]],
      ["+z", z1, [0, 0, 1]], ["-z", z0, [0, 0, -1]],
    ];
    for (const [dir, c, n] of faces) {
      const acc = typeof faceFn === "function" ? faceFn(dir, c) : faceFn;
      if (!acc) continue;
      let v;
      if (dir[1] === "x") v = [[c, y0, z0], [c, y1, z0], [c, y1, z1], [c, y0, z1]];
      else if (dir[1] === "y") v = [[x0, c, z0], [x1, c, z0], [x1, c, z1], [x0, c, z1]];
      else v = [[x0, y0, c], [x1, y0, c], [x1, y1, c], [x0, y1, c]];
      const base = acc.pos.length / 3;
      for (const p of v) {
        acc.pos.push(p[0], p[1], p[2]);
        acc.nrm.push(n[0], n[1], n[2]);
        let u, w;
        if (dir[1] === "x") { u = (p[2] - o.z) / acc.tw; w = (p[1] - o.y) / acc.th; }
        else if (dir[1] === "y") { u = (p[0] - o.x) / acc.tw; w = (p[2] - o.z) / acc.th; }
        else { u = (p[0] - o.x) / acc.tw; w = (p[1] - o.y) / acc.th; }
        acc.uv.push(u, w);
      }
      acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // Box that also blocks/supports the player.
  function solidBox(x0, y0, z0, x1, y1, z1, faceFn, o) {
    addBox(x0, y0, z0, x1, y1, z1, faceFn, o);
    return addSolid(x0, y0, z0, x1, y1, z1);
  }
  function flushAccs() {
    for (const a of accs) {
      if (!a.pos.length) continue;
      const mesh = new BABYLON.Mesh(a.name, scene);
      const vd = new BABYLON.VertexData();
      vd.positions = a.pos; vd.normals = a.nrm; vd.uvs = a.uv; vd.indices = a.idx;
      vd.applyToMesh(mesh);
      mesh.material = a.mat;
      mesh.freezeWorldMatrix();
      a.mesh = mesh;
    }
  }

  // ---------------------------------------------------------------- ground + ocean
  const sandTex = canvasTex("sandTex", 256, (ctx, S) => {
    ctx.fillStyle = SAND.toHexString();
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1800; i++) {
      const v = rr(-14, 10);
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 120},${v > 0 ? 250 : 100},${v > 0 ? 235 : 70},${Math.abs(v) / 100})`;
      ctx.fillRect(rand() * S, rand() * S, rr(1, 3), rr(1, 3));
    }
  });
  sandTex.uScale = sandTex.vScale = 4000 / 12;
  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 4000, height: 4000 }, scene);
  const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
  groundMat.disableLighting = true;
  groundMat.emissiveTexture = sandTex;
  ground.material = groundMat;

  const oceanW = 2400;
  const ocean = BABYLON.MeshBuilder.CreateGround("ocean", { width: oceanW, height: 4000 }, scene);
  ocean.position.set(SHORE_X - oceanW / 2, 0.06, 0);
  ocean.material = flatMat("oceanMat", hex("#4fa3d6"), 0.18);

  const wet = BABYLON.MeshBuilder.CreateGround("wet", { width: 6, height: 4000 }, scene);
  wet.position.set(SHORE_X + 2, 0.03, 0);
  wet.material = flatMat("wetMat", hex("#c9b997"), 0.16);

  // ---------------------------------------------------------------- roads
  const asphaltMat = flatMat("asphalt", hex("#3a3d42"), 0.45);
  const lineMat = flatMat("line", hex("#d9d6c8"), 0.25);

  const roadXs = []; // x positions of north–south roads
  const roadZs = []; // z positions of east–west roads
  for (let k = K_MIN; k <= K_MAX; k++) roadXs.push((k + 0.5) * PITCH);
  for (let k = K_MIN - 1; k <= K_MAX; k++) roadZs.push((k + 0.5) * PITCH);

  const roadPieces = [];
  const linePieces = [];
  for (const x of roadXs) {
    const r = BABYLON.MeshBuilder.CreateGround("r", { width: ASPHALT, height: CITY_MAX * 2 }, scene);
    r.position.set(x, 0.04, 0);
    roadPieces.push(r);
  }
  for (const z of roadZs) {
    const r = BABYLON.MeshBuilder.CreateGround("r", { width: CITY_MAX - SHORE_X, height: ASPHALT }, scene);
    r.position.set((CITY_MAX + SHORE_X) / 2, 0.05, z);
    roadPieces.push(r);
  }
  for (const x of roadXs) {
    for (let z = -CITY_MAX; z < CITY_MAX; z += 6) {
      if (roadZs.some((rz) => Math.abs(z + 1.5 - rz) < 9)) continue;
      const d = BABYLON.MeshBuilder.CreateGround("d", { width: 0.18, height: 3 }, scene);
      d.position.set(x, 0.07, z + 1.5);
      linePieces.push(d);
    }
  }
  for (const z of roadZs) {
    for (let x = SHORE_X; x < CITY_MAX; x += 6) {
      if (roadXs.some((rx) => Math.abs(x + 1.5 - rx) < 9)) continue;
      const d = BABYLON.MeshBuilder.CreateGround("d", { width: 3, height: 0.18 }, scene);
      d.position.set(x + 1.5, 0.07, z);
      linePieces.push(d);
    }
  }
  const roadsMesh = BABYLON.Mesh.MergeMeshes(roadPieces, true, true);
  roadsMesh.material = asphaltMat;
  const linesMesh = BABYLON.Mesh.MergeMeshes(linePieces, true, true);
  linesMesh.material = lineMat;
  for (const m of [ground, ocean, wet, roadsMesh, linesMesh]) m.freezeWorldMatrix();

  // ---------------------------------------------------------------- facade textures
  // Each texture holds a tile of cols × rows windows; cellW/cellH are the real
  // metres one window cell covers. Variants with the same window layout:
  //   day    – the outside facade
  //   night  – emissive overlay: random warm lit windows on black
  //   inner  – inside walls, windows as bright daylight openings
  //   innerN – inside walls at night, windows dark
  function drawFacade(ctx, S, style, mode) {
    const { cols, rows } = style;
    const cw = S / cols, ch = S / rows;
    const inner = mode === "inner" || mode === "innerN";
    ctx.fillStyle = mode === "night" ? "#000" : inner ? "#e6e1d8" : style.frame;
    ctx.fillRect(0, 0, S, S);
    const sky = ["#cfe6f6", "#c6e0f3", "#d6ebf8"];
    const lit = ["#ffd27a", "#ffe3a3", "#f6c66a", "#fff0c8", "#ffcf8a"];

    if (style.kind === "brick" && mode === "day") {
      for (let i = 0; i < 5000; i++) {
        ctx.fillStyle = `rgba(${rand() < 0.5 ? "30,15,10" : "160,110,90"},${rr(0.04, 0.14)})`;
        ctx.fillRect(rand() * S, rand() * S, rr(3, 7), 2);
      }
      ctx.fillStyle = style.pilaster;
      for (let c = 0; c <= cols; c += 2) ctx.fillRect(c * cw - 5, 0, 10, S);
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw, y = r * ch;
        let glass, trim;
        if (mode === "day") { glass = pick(style.glass); trim = style.trim || style.frame; }
        else if (mode === "night") { glass = rand() < 0.34 ? pick(lit) : "#060a10"; trim = "#000"; }
        else if (mode === "inner") { glass = pick(sky); trim = "#f4f2ee"; }
        else { glass = pick(["#0e1724", "#111b2a", "#0b1420"]); trim = "#f4f2ee"; }
        if (style.kind === "glass") {
          ctx.fillStyle = glass;
          ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
          if (mode === "day" && rand() < 0.35) {
            const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
            g.addColorStop(0, "rgba(180,200,215,0.18)");
            g.addColorStop(1, "rgba(180,200,215,0)");
            ctx.fillStyle = g;
            ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
          }
        } else if (style.kind === "office") {
          ctx.fillStyle = glass;
          ctx.fillRect(x + 4, y + ch * 0.18, cw - 8, ch * 0.62);
          ctx.fillStyle = mode === "day" ? style.frame : trim;
          ctx.fillRect(x + cw / 2 - 1.5, y + ch * 0.18, 3, ch * 0.62);
        } else if (style.kind === "brick") {
          const wx = x + cw * 0.2, wy = y + ch * 0.2, ww = cw * 0.6, wh = ch * 0.62;
          ctx.fillStyle = trim;
          ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 8);
          ctx.fillStyle = glass;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = trim;
          ctx.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
          ctx.fillRect(wx, wy + wh * 0.45, ww, 3);
        } else {
          ctx.fillStyle = glass;
          ctx.fillRect(x + cw * 0.15, y + ch * 0.22, cw * 0.7, ch * 0.55);
        }
      }
    }
  }

  const facadeList = [];
  function facade(name, style) {
    const tex = canvasTex(name, 512, (ctx, S) => drawFacade(ctx, S, style, "day"));
    const nightTex = canvasTex(name + "N", 512, (ctx, S) => drawFacade(ctx, S, style, "night"));
    const mat = new BABYLON.StandardMaterial(name + "Mat", scene);
    mat.diffuseTexture = tex;
    mat.specularColor = new BABYLON.Color3(style.spec, style.spec, style.spec);
    mat.specularPower = 48;

    const itex = canvasTex(name + "In", 512, (ctx, S) => drawFacade(ctx, S, style, "inner"));
    const itexN = canvasTex(name + "InN", 512, (ctx, S) => drawFacade(ctx, S, style, "innerN"));
    const imat = new BABYLON.StandardMaterial(name + "InMat", scene);
    imat.diffuseTexture = itex;
    imat.specularColor = new BABYLON.Color3(0, 0, 0);
    imat.emissiveColor = new BABYLON.Color3(0.32, 0.32, 0.32);

    const tileW = style.cols * style.cellW, tileH = style.rows * style.cellH;
    const f = {
      style, mat, imat, nightTex, itex, itexN,
      out: makeAcc(name + "Out", mat, tileW, tileH),
      inn: makeAcc(name + "Inner", imat, tileW, tileH),
    };
    facadeList.push(f);
    return f;
  }

  const FACADES = {
    glass: facade("glass", {
      kind: "glass", cols: 8, rows: 8, cellW: 2.4, cellH: 3.4, spec: 0.18,
      frame: "#6a7075",
      glass: ["#2b3236", "#343c41", "#3e474d", "#262c30", "#4a545a", "#30383d"],
    }),
    office: facade("office", {
      kind: "office", cols: 6, rows: 8, cellW: 3.2, cellH: 3.6, spec: 0.08,
      frame: "#8f8e88",
      glass: ["#2a2f33", "#353b40", "#2f353a", "#3f474d"],
    }),
    brick: facade("brick", {
      kind: "brick", cols: 8, rows: 6, cellW: 2.2, cellH: 3.2, spec: 0.03,
      frame: "#6e4636", pilaster: "#56352a", trim: "#cfc9bd",
      glass: ["#3d4a52", "#56656e", "#46545c", "#2f3a40"],
    }),
    beige: facade("beige", {
      kind: "plain", cols: 6, rows: 6, cellW: 3, cellH: 3.4, spec: 0.03,
      frame: "#b9ad97",
      glass: ["#3b4247", "#4a535a", "#33393d"],
    }),
  };

  // ---------------------------------------------------------------- interior materials
  const woodFloorTex = canvasTex("woodFloor", 256, (ctx, S) => {
    const tones = ["#a0714c", "#a87a54", "#97683f", "#b08259", "#9c6c47"];
    const rowsN = 8, ph = S / rowsN;
    for (let r = 0; r < rowsN; r++) {
      let x = -rand() * 120;
      while (x < S) {
        const len = rr(70, 140);
        ctx.fillStyle = pick(tones);
        ctx.fillRect(x, r * ph, len, ph);
        ctx.fillStyle = "rgba(60,35,20,0.5)";
        ctx.fillRect(x, r * ph, 2, ph);
        x += len;
      }
      ctx.fillStyle = "rgba(60,35,20,0.45)";
      ctx.fillRect(0, r * ph, S, 1.5);
    }
  });
  const tileTex = canvasTex("tile", 256, (ctx, S) => {
    ctx.fillStyle = "#dcd6ca"; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "#cfc8ba"; ctx.fillRect(0, 0, S / 2, S / 2); ctx.fillRect(S / 2, S / 2, S / 2, S / 2);
    ctx.strokeStyle = "#a9a296"; ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, S, S); ctx.beginPath();
    ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
  });
  const carpetTex = canvasTex("carpet", 128, (ctx, S) => {
    ctx.fillStyle = "#6d7079"; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? "40,42,50" : "140,144,155"},0.25)`;
      ctx.fillRect(rand() * S, rand() * S, 1.5, 1.5);
    }
  });
  const texMat = (name, tex, spec = 0.04) => {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseTexture = tex;
    m.specularColor = new BABYLON.Color3(spec, spec, spec);
    return m;
  };
  const withEm = (m, h) => { m.emissiveColor = hex(h); return m; };
  const iLit = (name, h, spec) => indoor(litMat(name, hex(h), spec));

  const A = {
    roof: makeAcc("roof", litMat("roofM", hex("#7d7f80"))),
    sidewalk: makeAcc("sidewalk", litMat("sidewalkM", hex("#a7a7a3"))),
    lampMetal: makeAcc("lampMetal", litMat("lampMetalM", hex("#3a3e44"), 0.3)),
    plaster: makeAcc("plaster", indoor(withEm(litMat("plasterM", hex("#e3ddd2")), "#3c3a36"))),
    ceiling: makeAcc("ceiling", indoor(withEm(litMat("ceilingM", hex("#d8d6d0")), "#46443f"))),
    rail: makeAcc("rail", iLit("railM", "#9aa0a6", 0.3)),
    wood: makeAcc("woodFloor", indoor(texMat("woodFloorM", woodFloorTex, 0.1)), 2.4, 2.4),
    tile: makeAcc("tileFloor", indoor(texMat("tileM", tileTex, 0.15)), 1.6, 1.6),
    carpet: makeAcc("carpet", indoor(texMat("carpetM", carpetTex)), 2, 2),
    stairs: makeAcc("stairs", iLit("stairsM", "#a19d96")),
    metal: makeAcc("metal", iLit("metalM", "#2f3236", 0.3)),
    furnWood: makeAcc("furnWood", iLit("furnWoodM", "#8a5a3b", 0.12)),
    darkWood: makeAcc("darkWood", iLit("darkWoodM", "#4e3424", 0.12)),
    white: makeAcc("white", iLit("whiteM", "#ebe9e3", 0.15)),
    blue: makeAcc("fabricBlue", iLit("blueM", "#3f5f8a")),
    red: makeAcc("fabricRed", iLit("redM", "#8c3d3a")),
    gray: makeAcc("fabricGray", iLit("grayM", "#6f7378")),
    green: makeAcc("fabricGreen", iLit("greenM", "#4d6b48")),
    mustard: makeAcc("fabricMustard", iLit("mustardM", "#b88a2e")),
    counter: makeAcc("counter", iLit("counterM", "#bdb8ae", 0.2)),
    pot: makeAcc("pot", iLit("potM", "#7a4a32")),
    screen: makeAcc("screen", withEm(litMat("screenM", hex("#14202b"), 0.6), "#1d3f5c")),
    light: makeAcc("ceilLight", flatMat("ceilLightM", hex("#fffbe8"), 1)),
  };
  for (const f of facadeList) { f.imat.__dayEm = f.imat.emissiveColor.clone(); }
  const fabrics = [A.blue, A.red, A.gray, A.green, A.mustard];

  // Plant foliage = instanced low-poly spheres.
  const leafTemplate = BABYLON.MeshBuilder.CreateSphere("leaf", { diameter: 1, segments: 5 }, scene);
  leafTemplate.material = iLit("leafM", "#3f7a3a");
  leafTemplate.setEnabled(false);

  // ---------------------------------------------------------------- building generation
  const mapBuildings = [];
  const enterables = [];
  const roofs = [];     // landing spots for the double-jump

  function snap(v, cell, min) { return Math.max(min, Math.round(v / cell)) * cell; }

  // Plain solid (non-enterable) building.
  function buildSolid(cx, cz, w, d, h, type) {
    const F = FACADES[type];
    const minX = cx - w / 2, maxX = cx + w / 2, minZ = cz - d / 2, maxZ = cz + d / 2;
    const o = { x: minX, y: 0, z: minZ };
    addBox(minX, 0, minZ, maxX, h, maxZ, (dir) => (dir === "+y" ? A.roof : dir === "-y" ? null : F.out), o);
    addSolid(minX, 0, minZ, maxX, h + 0.5, maxZ);
    addBox(minX - 0.2, h, minZ - 0.2, maxX + 0.2, h + 0.5, maxZ + 0.2, A.roof);
    const mechs = [];
    if (h > 30) {
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const mw = rr(3, w * 0.4), md = rr(3, d * 0.4), mh = rr(2, 5);
        const mx = cx + rr(-w / 4, w / 4), mz = cz + rr(-d / 4, d / 4);
        solidBox(mx - mw / 2, h + 0.5, mz - md / 2, mx + mw / 2, h + mh, mz + md / 2, A.roof);
        mechs.push({ x: mx, z: mz, r: Math.max(mw, md) / 2 + 1 });
      }
    }
    mapBuildings.push({ x: cx, z: cz, w, d });
    roofs.push({ minX, maxX, minZ, maxZ, top: h + 0.5, rim: h + 0.5, mechs });
  }

  // ---- furniture helpers (all boxes; solid unless noted) ----
  function item(cx, cz, y, w, d, h, acc, solid = true) {
    const f = solid ? solidBox : addBox;
    f(cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2, acc);
  }
  function plant(cx, cz, y, big = false) {
    const s = big ? 1.25 : 1;
    item(cx, cz, y, 0.45 * s, 0.45 * s, 0.45 * s, A.pot);
    const leaf = leafTemplate.createInstance("plant");
    leaf.position.set(cx, y + 0.45 * s + 0.4 * s, cz);
    leaf.scaling.set(0.75 * s, 0.95 * s, 0.75 * s);
    leaf.freezeWorldMatrix();
  }
  function bed(cx, cz, y, alongZ) {
    const w = alongZ ? 1.6 : 2.1, d = alongZ ? 2.1 : 1.6;
    solidBox(cx - w / 2, y, cz - d / 2, cx + w / 2, y + 0.38, cz + d / 2, A.darkWood);
    addBox(cx - w / 2 + 0.05, y + 0.38, cz - d / 2 + 0.05, cx + w / 2 - 0.05, y + 0.55, cz + d / 2 - 0.05, A.white);
    const blanket = pick(fabrics);
    if (alongZ) {
      addBox(cx - w / 2 + 0.02, y + 0.4, cz - d / 2 + 0.02, cx + w / 2 - 0.02, y + 0.58, cz + 0.25, blanket);
      addBox(cx - 0.6, y + 0.55, cz + d / 2 - 0.5, cx + 0.6, y + 0.68, cz + d / 2 - 0.12, A.white);
      solidBox(cx - w / 2, y, cz + d / 2, cx + w / 2, y + 1.05, cz + d / 2 + 0.08, A.darkWood);
    } else {
      addBox(cx - w / 2 + 0.02, y + 0.4, cz - d / 2 + 0.02, cx + 0.25, y + 0.58, cz + d / 2 - 0.02, blanket);
      addBox(cx + w / 2 - 0.5, y + 0.55, cz - 0.6, cx + w / 2 - 0.12, y + 0.68, cz + 0.6, A.white);
      solidBox(cx + w / 2, y, cz - d / 2, cx + w / 2 + 0.08, y + 1.05, cz + d / 2, A.darkWood);
    }
  }
  // Sofa with its back toward -z (faceZ=+1) or +z (faceZ=-1).
  function sofa(cx, cz, y, faceZ, fab) {
    const w = 2.2, d = 0.9;
    solidBox(cx - w / 2, y, cz - d / 2, cx + w / 2, y + 0.45, cz + d / 2, fab);
    const bz = faceZ > 0 ? cz - d / 2 : cz + d / 2 - 0.25;
    solidBox(cx - w / 2, y + 0.45, bz, cx + w / 2, y + 0.9, bz + 0.25, fab);
    addBox(cx - w / 2, y + 0.45, cz - d / 2, cx - w / 2 + 0.2, y + 0.65, cz + d / 2, fab);
    addBox(cx + w / 2 - 0.2, y + 0.45, cz - d / 2, cx + w / 2, y + 0.65, cz + d / 2, fab);
  }
  function table(cx, cz, y, w, d, h, top = A.furnWood) {
    addBox(cx - w / 2, y + h - 0.05, cz - d / 2, cx + w / 2, y + h, cz + d / 2, top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = cx + sx * (w / 2 - 0.08), lz = cz + sz * (d / 2 - 0.08);
      addBox(lx - 0.035, y, lz - 0.035, lx + 0.035, y + h - 0.05, lz + 0.035, A.metal);
    }
    addSolid(cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2);
  }
  function chair(cx, cz, y, bx, bz, fab = A.darkWood) {
    item(cx, cz, y, 0.45, 0.45, 0.46, fab);
    const x0 = bx > 0 ? cx + 0.17 : cx - 0.225;
    const x1 = bx < 0 ? cx - 0.17 : cx + 0.225;
    const z0 = bz > 0 ? cz + 0.17 : cz - 0.225;
    const z1 = bz < 0 ? cz - 0.17 : cz + 0.225;
    addBox(x0, y + 0.46, z0, x1, y + 0.95, z1, fab);
  }
  function desk(cx, cz, y, faceZ) {
    table(cx, cz, y, 1.4, 0.75, 0.75, A.white);
    const mz = cz - faceZ * 0.22;
    addBox(cx - 0.3, y + 0.82, mz - 0.025, cx + 0.3, y + 1.18, mz + 0.025, A.screen);
    addBox(cx - 0.04, y + 0.75, mz - 0.04, cx + 0.04, y + 0.82, mz + 0.04, A.metal);
    addBox(cx - 0.25, y + 0.75, cz + faceZ * 0.12 - 0.08, cx + 0.25, y + 0.77, cz + faceZ * 0.12 + 0.08, A.metal);
    chair(cx, cz + faceZ * 0.7, y, 0, faceZ, A.gray);
  }
  function wardrobe(cx, cz, y) {
    item(cx, cz, y, 1.1, 0.6, 2.0, A.furnWood);
    addBox(cx - 0.01, y + 0.1, cz - 0.31, cx + 0.01, y + 1.9, cz + 0.31, A.darkWood);
  }
  function bookshelf(cx, cz, y) {
    item(cx, cz, y, 1.0, 0.4, 1.9, A.darkWood);
    for (let s = 0; s < 4; s++) {
      let x = cx - 0.45;
      while (x < cx + 0.4) {
        const bw = rr(0.04, 0.09);
        addBox(x, y + 0.12 + s * 0.45, cz - 0.21, x + bw, y + 0.12 + s * 0.45 + rr(0.24, 0.34), cz + 0.21, pick(fabrics));
        x += bw + 0.01;
      }
    }
  }

  // ---- room presets: r = {x0,x1,z0,z1} inside faces of the room walls ----
  const cornersOf = (r, m) => [[r.x0 + m, r.z0 + m], [r.x1 - m, r.z0 + m], [r.x0 + m, r.z1 - m], [r.x1 - m, r.z1 - m]];
  function bedroom(r, y) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    bed(cx, cz, y, rand() < 0.5);
    const cs = cornersOf(r, 0.75);
    wardrobe(cs[0][0], cs[0][1], y);
    plant(cs[3][0], cs[3][1], y);
    item(cs[1][0], cs[1][1], y, 0.5, 0.45, 0.55, A.furnWood);
  }
  function living(r, y) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    sofa(cx, cz - 0.9, y, 1, pick(fabrics));
    table(cx, cz + 0.4, y, 1.1, 0.6, 0.42, A.darkWood);
    item(cx, cz + 1.7, y, 1.6, 0.45, 0.45, A.darkWood);
    addBox(cx - 0.7, y + 0.5, cz + 1.8, cx + 0.7, y + 1.3, cz + 1.86, A.screen);
    const cs = cornersOf(r, 0.65);
    plant(cs[0][0], cs[0][1], y, true);
    bookshelf(cs[1][0], cs[1][1] - 0.1, y);
  }
  function kitchen(r, y) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    table(cx, cz, y, 1.6, 0.9, 0.76);
    chair(cx - 0.45, cz - 0.75, y, 0, -1);
    chair(cx + 0.45, cz - 0.75, y, 0, -1);
    chair(cx - 0.45, cz + 0.75, y, 0, 1);
    chair(cx + 0.45, cz + 0.75, y, 0, 1);
    const cs = cornersOf(r, 0.4);
    const [kx, kz] = cs[3];
    item(kx - 1.2, kz, y, 2.4, 0.6, 0.9, A.counter);
    addBox(kx - 2.4, y + 0.9, kz - 0.3, kx, y + 0.94, kz + 0.3, A.darkWood);
    item(cs[1][0], cs[1][1], y, 0.75, 0.7, 1.9, A.white);
  }
  function offices(r, y) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    for (const dx of [-0.72, 0.72]) {
      desk(cx + dx, cz - 0.4, y, -1);
      desk(cx + dx, cz + 0.4, y, 1);
    }
    const cs = cornersOf(r, 0.6);
    plant(cs[0][0], cs[0][1], y, true);
    plant(cs[3][0], cs[3][1], y);
    item(cs[1][0], cs[1][1], y, 0.5, 0.6, 1.3, A.gray);
  }
  function meeting(r, y) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    table(cx, cz, y, 3.0, 1.2, 0.76, A.white);
    for (const dx of [-1.0, 0, 1.0]) {
      chair(cx + dx, cz - 0.95, y, 0, -1, A.gray);
      chair(cx + dx, cz + 0.95, y, 0, 1, A.gray);
    }
    const cs = cornersOf(r, 0.6);
    plant(cs[1][0], cs[1][1], y, true);
    plant(cs[3][0], cs[3][1], y);
  }

  // Wall with doorway gaps, along X (at z) or along Z (at x).
  function partition(alongX, fixed, a0, a1, gaps, y0, y1) {
    const T2 = 0.075, GW = 0.7, DH = 2.3;
    const cuts = gaps.slice().sort((p, q) => p - q);
    let s = a0;
    const seg = (b0, b1, yy0, yy1) => {
      if (b1 - b0 < 0.02) return;
      if (alongX) solidBox(b0, yy0, fixed - T2, b1, yy1, fixed + T2, A.plaster);
      else solidBox(fixed - T2, yy0, b0, fixed + T2, yy1, b1, A.plaster);
    };
    for (const g of cuts) {
      seg(s, g - GW, y0, y1);
      seg(g - GW, g + GW, y0 + DH, y1);
      s = g + GW;
    }
    seg(s, a1, y0, y1);
  }

  // ---- the enterable building ----
  const NAMES_APT = ["Harbor Apartments", "Pine Street Lofts", "Bayview House", "Cedar Court", "Elm Residences"];
  const NAMES_OFF = ["Mercer Tower", "Atlas Offices", "Orion Plaza", "Summit Center", "Meridian Tower", "Union Works"];

  function makeSign(text, x, y, z, rotY) {
    const tex = new BABYLON.DynamicTexture("sign", { width: 512, height: 96 }, scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = "#1c1e22"; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = "#ffd36b";
    ctx.font = "bold 46px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text.toUpperCase(), 256, 50);
    tex.update();
    const m = new BABYLON.StandardMaterial("signM", scene);
    m.diffuseTexture = tex; m.emissiveTexture = tex; m.disableLighting = true;
    const p = BABYLON.MeshBuilder.CreatePlane("signP", { width: 3.4, height: 0.64 }, scene);
    p.material = m; p.position.set(x, y, z); p.rotation.y = rotY;
    p.freezeWorldMatrix();
    glow.addIncludedOnlyMesh(p);
  }

  function buildEnterable(spec) {
    const { minX, maxX, minZ, maxZ, F, fh, type, kind, door, name } = spec;
    const Fac = FACADES[type];
    const T = 0.3;
    const h = F * fh;
    const w = maxX - minX, d = maxZ - minZ;
    const o = { x: minX, y: 0, z: minZ };
    const X0 = minX + T, X1 = maxX - T, Z0 = minZ + T, Z1 = maxZ - T;
    const near = (a, b) => Math.abs(a - b) < 1e-4;

    // Shell faces: exterior plane → facade; interior plane → inner windows; else plaster.
    const shellFace = (dir, c) => {
      if ((dir === "+x" && near(c, maxX)) || (dir === "-x" && near(c, minX)) ||
          (dir === "+z" && near(c, maxZ)) || (dir === "-z" && near(c, minZ))) return Fac.out;
      if ((dir === "-x" && near(c, X1)) || (dir === "+x" && near(c, X0)) ||
          (dir === "-z" && near(c, Z1)) || (dir === "+z" && near(c, Z0))) return Fac.inn;
      return dir === "-y" ? null : A.plaster;
    };
    const shell = (x0, y0, z0, x1, y1, z1) => solidBox(x0, y0, z0, x1, y1, z1, shellFace, o);

    // Door: centred on the chosen side, ground floor only.
    const DW = 1.2, DHt = 2.6;
    const xc = (minX + maxX) / 2, zc = (minZ + maxZ) / 2;
    const xWall = (zA, zB, isDoor) => {
      if (!isDoor) return shell(minX, 0, zA, maxX, h, zB);
      shell(minX, 0, zA, xc - DW, h, zB);
      shell(xc + DW, 0, zA, maxX, h, zB);
      shell(xc - DW, DHt, zA, xc + DW, h, zB);
    };
    const zWall = (xA, xB, isDoor) => {
      if (!isDoor) return shell(xA, 0, Z0, xB, h, Z1);
      shell(xA, 0, Z0, xB, h, zc - DW);
      shell(xA, 0, zc + DW, xB, h, Z1);
      shell(xA, DHt, zc - DW, xB, h, zc + DW);
    };
    xWall(minZ, Z0, door === "-z");
    xWall(Z1, maxZ, door === "+z");
    zWall(minX, X0, door === "-x");
    zWall(X1, maxX, door === "+x");

    // Parapet around the roof.
    solidBox(minX, h, minZ, maxX, h + 1.0, Z0, A.roof);
    solidBox(minX, h, Z1, maxX, h + 1.0, maxZ, A.roof);
    solidBox(minX, h, Z0, X0, h + 1.0, Z1, A.roof);
    solidBox(X1, h, Z0, maxX, h + 1.0, Z1, A.roof);

    // Door frame, canopy and lit sign.
    const out = { "-z": [0, -1], "+z": [0, 1], "-x": [-1, 0], "+x": [1, 0] }[door];
    if (out[1] !== 0) {
      const zf = out[1] < 0 ? minZ : maxZ;
      const zo = zf + out[1] * 0.06;
      addBox(xc - DW - 0.12, 0, Math.min(zf, zo), xc - DW, DHt + 0.12, Math.max(zf, zo), A.metal);
      addBox(xc + DW, 0, Math.min(zf, zo), xc + DW + 0.12, DHt + 0.12, Math.max(zf, zo), A.metal);
      addBox(xc - DW - 0.12, DHt, Math.min(zf, zo), xc + DW + 0.12, DHt + 0.12, Math.max(zf, zo), A.metal);
      const ze = zf + out[1] * 1.3;
      addBox(xc - 1.9, DHt + 0.15, Math.min(zf, ze), xc + 1.9, DHt + 0.3, Math.max(zf, ze), A.metal);
      makeSign(name, xc, DHt + 0.62, zf + out[1] * 0.08, out[1] < 0 ? 0 : Math.PI);
    } else {
      const xf = out[0] < 0 ? minX : maxX;
      const xo = xf + out[0] * 0.06;
      addBox(Math.min(xf, xo), 0, zc - DW - 0.12, Math.max(xf, xo), DHt + 0.12, zc - DW, A.metal);
      addBox(Math.min(xf, xo), 0, zc + DW, Math.max(xf, xo), DHt + 0.12, zc + DW + 0.12, A.metal);
      addBox(Math.min(xf, xo), DHt, zc - DW - 0.12, Math.max(xf, xo), DHt + 0.12, zc + DW + 0.12, A.metal);
      const xe = xf + out[0] * 1.3;
      addBox(Math.min(xf, xe), DHt + 0.15, zc - 1.9, Math.max(xf, xe), DHt + 0.3, zc + 1.9, A.metal);
      makeSign(name, xf + out[0] * 0.08, DHt + 0.62, zc, out[0] < 0 ? Math.PI / 2 : -Math.PI / 2);
    }

    // Stair core in the (minX, maxZ) corner: two flights per storey with a
    // half landing against the back wall (switchback).
    const ax0 = X0, ax1 = X0 + 1.4, bx1 = X0 + 2.8;
    const zb = Z1;
    const holeZ0 = zb - 3.8;
    const STEPS = 8, TREAD = 0.3;
    const rise = fh / 2 / STEPS;
    for (let i = 0; i < F; i++) {
      const y0 = i * fh;
      for (let k = 1; k <= STEPS; k++) {
        const z0 = holeZ0 + (k - 1) * TREAD, top = y0 + k * rise;
        solidBox(ax0, Math.max(y0, top - 0.35), z0, ax1, top, z0 + TREAD, A.stairs);
      }
      solidBox(ax0, y0 + fh / 2 - 0.3, zb - 1.4, bx1, y0 + fh / 2, zb, A.stairs);
      for (let k = 1; k <= STEPS; k++) {
        const z1 = zb - 1.4 - (k - 1) * TREAD, top = y0 + fh / 2 + k * rise;
        solidBox(ax1, top - 0.35, z1 - TREAD, bx1, top, z1, A.stairs);
      }
      for (let k = 1; k <= STEPS; k++) {
        const z = holeZ0 + (k - 0.5) * TREAD;
        const top1 = y0 + k * rise;
        addBox(ax1 - 0.02, top1, z - 0.02, ax1 + 0.02, top1 + 0.9, z + 0.02, A.metal);
      }
    }

    // Floors: ground floor tiles, slabs with a stair hole, roof slab.
    solidBox(X0, -0.05, Z0, X1, 0.02, Z1, (dir) => (dir === "+y" ? A.tile : null));
    for (let j = 1; j <= F; j++) {
      const top = j * fh, bot = top - 0.25;
      const roof = j === F;
      const floorAcc = roof ? A.roof : kind === "office" ? A.carpet : A.wood;
      const slabFace = (dir) => (dir === "+y" ? floorAcc : dir === "-y" ? A.ceiling : A.plaster);
      solidBox(X0, bot, Z0, X1, top, holeZ0, slabFace);
      solidBox(bx1, bot, holeZ0, X1, top, Z1, slabFace);
      solidBox(bx1, top, holeZ0, bx1 + 0.06, top + 1.0, Z1, A.rail);
      if (roof) solidBox(ax0, top, holeZ0 - 0.06, ax1, top + 1.0, holeZ0, A.rail);
    }

    // Lobby (ground floor): reception desk, seating, plants, lights.
    {
      const y = 0.02;
      const inward = [-out[0], -out[1]];
      const lat = [out[1], out[0]];
      const dx = out[0] !== 0 ? (out[0] < 0 ? minX : maxX) : xc;
      const dz = out[1] !== 0 ? (out[1] < 0 ? minZ : maxZ) : zc;
      const at = (fwd, side) => [dx + inward[0] * fwd + lat[0] * side, dz + inward[1] * fwd + lat[1] * side];
      let [px, pz] = at(4.2, 3.4);
      const deskAlongX = out[1] !== 0;
      item(px, pz, y, deskAlongX ? 2.4 : 0.8, deskAlongX ? 0.8 : 2.4, 1.05, A.darkWood);
      addBox(px - (deskAlongX ? 1.25 : 0.45), y + 1.05, pz - (deskAlongX ? 0.45 : 1.25),
        px + (deskAlongX ? 1.25 : 0.45), y + 1.1, pz + (deskAlongX ? 0.45 : 1.25), A.counter);
      [px, pz] = at(4.2, -3.6);
      if (deskAlongX) sofa(px, pz, y, out[1] > 0 ? -1 : 1, A.gray);
      else item(px, pz, y, 0.9, 2.2, 0.45, A.gray);
      for (const [f, s] of [[0.9, 2.2], [0.9, -2.2]]) {
        const [qx, qz] = at(f, s);
        plant(qx, qz, y, true);
      }
      for (let lx = X0 + 3; lx < X1 - 1; lx += 4.5) {
        for (let lz = Z0 + 3; lz < Z1 - 1; lz += 4.5) {
          addBox(lx - 0.6, fh - 0.29, lz - 0.3, lx + 0.6, fh - 0.25, lz + 0.3, A.light);
        }
      }
    }

    // Upper floors: partitions + furnished rooms.
    const xW = minX + w * 0.5, xB = minX + w * 0.62, zW = minZ + d * 0.45;
    const gx1 = minX + w * 0.25, gx2 = minX + w * 0.75;
    for (let j = 1; j < F; j++) {
      const y0 = j * fh, y1 = (j + 1) * fh - 0.25;
      partition(true, zW, X0, X1, [gx1, gx2], y0, y1);
      partition(false, xW, Z0, zW - 0.075, [(Z0 + zW) / 2], y0, y1);
      partition(false, xB, zW + 0.075, Z1, [(zW + Z1) / 2], y0, y1);

      const FL = { x0: X0, x1: xW - 0.075, z0: Z0, z1: zW - 0.075 };
      const FR = { x0: xW + 0.075, x1: X1, z0: Z0, z1: zW - 0.075 };
      const BR = { x0: xB + 0.075, x1: X1, z0: zW + 0.075, z1: Z1 };
      const BL = { x0: X0, x1: xB - 0.075, z0: zW + 0.075, z1: Z1 };
      if (kind === "office") {
        offices(FL, y0);
        offices(FR, y0);
        meeting(BR, y0);
      } else {
        const presets = [bedroom, living, kitchen].sort(() => rand() - 0.5);
        presets[0](FL, y0);
        presets[1](FR, y0);
        presets[2](BR, y0);
      }
      plant(BL.x1 - 0.6, BL.z0 + 0.6, y0);
      for (const r of [FL, FR, BR, BL]) {
        const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
        addBox(cx - 0.6, y1 - 0.04, cz - 0.3, cx + 0.6, y1, cz + 0.3, A.light);
      }
    }

    mapBuildings.push({ x: xc, z: zc, w, d, enter: true, door: out });
    enterables.push({ name, minX: X0, maxX: X1, minZ: Z0, maxZ: Z1, fh, F });
    // Roof landing: away from the stair hole in the (minX,maxZ) corner.
    roofs.push({
      minX, maxX, minZ, maxZ, top: h, rim: h + 1.0, mechs: [],
      landing: { x: (xc + X1) / 2, z: (Z0 + zc) / 2 },
    });
  }

  // ---------------------------------------------------------------- city blocks
  function addSidewalkRing(cx, cz) {
    const outer = PITCH - ASPHALT;      // 70
    const half = outer / 2;
    const hgt = 0.15;
    const mk = (w, d, x, z) => solidBox(x - w / 2, 0, z - d / 2, x + w / 2, hgt, z + d / 2, A.sidewalk);
    mk(outer, SIDEWALK, cx, cz + half - SIDEWALK / 2);
    mk(outer, SIDEWALK, cx, cz - half + SIDEWALK / 2);
    mk(SIDEWALK, outer - 2 * SIDEWALK, cx + half - SIDEWALK / 2, cz);
    mk(SIDEWALK, outer - 2 * SIDEWALK, cx - half + SIDEWALK / 2, cz);
  }

  function pickType(h) {
    if (h > 55) return rand() < 0.55 ? "glass" : "office";
    if (h > 30) return pick(["glass", "office", "office", "beige"]);
    return pick(["brick", "brick", "beige", "office"]);
  }

  const specs = [];
  for (let kx = K_MIN; kx <= K_MAX; kx++) {
    for (let kz = K_MIN; kz <= K_MAX; kz++) {
      const cx = kx * PITCH, cz = kz * PITCH;
      if (kx === K_MIN) continue;              // beach column: open sand
      addSidewalkRing(cx, cz);
      if (rand() < 0.08) continue;             // empty sand lot

      const dist = Math.hypot(cx - DOWNTOWN.x, cz - DOWNTOWN.z);
      const tall = 22 + 150 * Math.exp(-dist / 260);
      const inner = PITCH - ASPHALT - 2 * SIDEWALK - 4; // 60

      const lots = [];
      const r = rand();
      if (r < 0.3) {
        lots.push({ x: cx, z: cz, w: inner, d: inner });
      } else if (r < 0.65) {
        const half = inner / 2 - 1;
        if (rand() < 0.5) {
          lots.push({ x: cx - inner / 4, z: cz, w: half, d: inner });
          lots.push({ x: cx + inner / 4, z: cz, w: half, d: inner });
        } else {
          lots.push({ x: cx, z: cz - inner / 4, w: inner, d: half });
          lots.push({ x: cx, z: cz + inner / 4, w: inner, d: half });
        }
      } else {
        const q = inner / 2 - 1;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          if (rand() < 0.12) continue;
          lots.push({ x: cx + (sx * inner) / 4, z: cz + (sz * inner) / 4, w: q, d: q });
        }
      }

      for (const lot of lots) {
        const h = Math.max(12, tall * rr(0.45, 1.15));
        specs.push({
          lot, bx: cx, bz: cz, h, type: pickType(h),
          fw: rr(0.62, 0.95), fd: rr(0.62, 0.95), fox: rr(-1, 1), foz: rr(-1, 1),
        });
      }
    }
  }

  // Pick 10 lots near the start (one per block) to become enterable buildings,
  // spanning a range of heights.
  const FLOOR_TIERS = [3, 3, 4, 5, 6, 7, 9, 11, 14, 18];
  {
    const cands = specs
      .filter((s) => s.lot.w >= 18 && s.lot.d >= 18)
      .sort((a, b) => Math.hypot(a.lot.x - START.x, a.lot.z - START.z) - Math.hypot(b.lot.x - START.x, b.lot.z - START.z));
    const usedBlocks = new Set();
    const tiers = FLOOR_TIERS.slice().sort(() => rand() - 0.5);
    let ai = 0, oi = 0;
    for (const s of cands) {
      if (!tiers.length) break;
      const bk = s.bx + "," + s.bz;
      if (usedBlocks.has(bk)) continue;
      usedBlocks.add(bk);
      const F = tiers.pop();
      const kind = F <= 7 && rand() < 0.6 ? "apartment" : "office";
      s.enter = {
        F, kind,
        type: kind === "apartment" ? (F <= 4 ? "brick" : "beige") : F <= 6 ? "office" : "glass",
        name: kind === "apartment" ? NAMES_APT[ai++ % NAMES_APT.length] : NAMES_OFF[oi++ % NAMES_OFF.length],
      };
    }
  }

  for (const s of specs) {
    const { lot } = s;
    if (s.enter) {
      const type = s.enter.type;
      const st = FACADES[type].style;
      const cw = st.cellW;
      const maxCells = Math.floor(lot.w / cw), maxCellsD = Math.floor(lot.d / cw);
      const w = Math.min(maxCells, Math.max(Math.ceil(16 / cw), Math.round((lot.w * s.fw) / cw))) * cw;
      const d = Math.min(maxCellsD, Math.max(Math.ceil(16 / cw), Math.round((lot.d * s.fd) / cw))) * cw;
      const cx = lot.x + ((lot.w - w) / 2) * s.fox;
      const cz = lot.z + ((lot.d - d) / 2) * s.foz;
      const minX = cx - w / 2, maxX = cx + w / 2, minZ = cz - d / 2, maxZ = cz + d / 2;
      const gaps = {
        "-x": minX - (s.bx - 32), "+x": s.bx + 32 - maxX,
        "-z": minZ - (s.bz - 32), "+z": s.bz + 32 - maxZ,
      };
      const door = Object.keys(gaps).sort((a, b) => gaps[a] - gaps[b])[0];
      buildEnterable({
        minX, maxX, minZ, maxZ, F: s.enter.F, fh: st.cellH, type, kind: s.enter.kind,
        door, name: s.enter.name,
      });
    } else {
      const st = FACADES[s.type].style;
      const w = snap(lot.w * s.fw, st.cellW, 2);
      const d = snap(lot.d * s.fd, st.cellW, 2);
      const h = snap(s.h, st.cellH, 3);
      const ox = (Math.max(0, lot.w - w) / 2) * s.fox;
      const oz = (Math.max(0, lot.d - d) / 2) * s.foz;
      buildSolid(lot.x + ox, lot.z + oz, w, d, h, s.type);
    }
  }

  // ---------------------------------------------------------------- street lamps
  // Posts are merged geometry; bulbs and the night-time light pools on the
  // road are instances (the pools are additive gradient decals — fake light).
  const bulbMat = new BABYLON.StandardMaterial("bulbM", scene);
  bulbMat.disableLighting = true;
  bulbMat.emissiveColor = hex("#8d8b84");
  const bulbTemplate = BABYLON.MeshBuilder.CreateBox("bulb", { width: 0.6, height: 0.14, depth: 0.36 }, scene);
  bulbTemplate.material = bulbMat;
  bulbTemplate.setEnabled(false);
  glow.addIncludedOnlyMesh(bulbTemplate);

  const poolTex = radialTex("pool", [[0, "rgba(255,206,130,0.75)"], [0.45, "rgba(255,180,100,0.32)"], [1, "rgba(255,170,90,0)"]]);
  const poolMat = new BABYLON.StandardMaterial("poolM", scene);
  poolMat.disableLighting = true;
  poolMat.emissiveTexture = poolTex;
  poolMat.opacityTexture = poolTex;
  poolMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
  poolMat.zOffset = -2;
  const poolTemplate = BABYLON.MeshBuilder.CreateGround("pool", { width: 15, height: 15 }, scene);
  poolTemplate.material = poolMat;
  poolTemplate.setEnabled(false);

  const lampSpots = [];
  const lampPools = [];
  function addLamp(x, z, tx, tz) {
    // (tx,tz): unit vector from the post toward the road centre
    solidBox(x - 0.1, 0, z - 0.1, x + 0.1, 6.7, z + 0.1, A.lampMetal);
    const ax = x + tx * 1.6, az = z + tz * 1.6;
    addBox(Math.min(x, ax) - 0.05, 6.5, Math.min(z, az) - 0.05, Math.max(x, ax) + 0.05, 6.62, Math.max(z, az) + 0.05, A.lampMetal);
    const b = bulbTemplate.createInstance("bulb");
    b.position.set(x + tx * 1.5, 6.42, z + tz * 1.5);
    if (tx !== 0) b.rotation.y = Math.PI / 2;
    b.freezeWorldMatrix();
    const p = poolTemplate.createInstance("pool");
    p.position.set(x + tx * 3.2, 0.2, z + tz * 3.2);
    p.isVisible = false;
    p.freezeWorldMatrix();
    lampPools.push(p);
    lampSpots.push({ x, z });
  }
  {
    let n = 0;
    for (const rx of roadXs) {
      for (let z = -CITY_MAX + 20; z < CITY_MAX - 10; z += 40) {
        if (roadZs.some((rz) => Math.abs(z - rz) < 11)) continue;
        const side = n++ % 2 ? 1 : -1;
        addLamp(rx + side * 7.3, z, -side, 0);
      }
    }
    for (const rz of roadZs) {
      for (let x = SHORE_X + 24; x < CITY_MAX - 10; x += 40) {
        if (roadXs.some((rx) => Math.abs(x - rx) < 11)) continue;
        const side = n++ % 2 ? 1 : -1;
        addLamp(x, rz + side * 7.3, 0, -side);
      }
    }
  }
  flushAccs();
  glow.addIncludedOnlyMesh(A.light.mesh);

  // ---------------------------------------------------------------- vehicle templates
  function mergedTemplate(name, parts) {
    // parts: [{mesh, mat}] → one mesh; Babylon builds the MultiMaterial and
    // the per-part submesh → material mapping from each part's own material.
    for (const p of parts) p.mesh.material = p.mat;
    const mesh = BABYLON.Mesh.MergeMeshes(parts.map((p) => p.mesh), true, true, undefined, false, true);
    mesh.name = name;
    mesh.setEnabled(false);
    glow.addIncludedOnlyMesh(mesh);
    return mesh;
  }
  const headM = flatMat("headLightM", hex("#f2efe2"), 1);
  const tailM = flatMat("tailLightM", hex("#c0261d"), 1);
  const tyreM = litMat("tyreM", hex("#151515"));
  const chromeM = litMat("chromeM", hex("#55595e"), 0.5);
  const burntM = litMat("burntM", hex("#1b1817"));
  const burntGlassM = litMat("burntGlassM", hex("#0a0a0a"));

  function makeCarTemplate(name, bodyHex, burnt = false) {
    const MB = BABYLON.MeshBuilder;
    const body = MB.CreateBox("body", { width: 1.9, height: 0.62, depth: 4.4 }, scene);
    body.position.y = 0.6;
    const cabin = MB.CreateBox("cabin", { width: 1.66, height: 0.55, depth: 2.2 }, scene);
    cabin.position.set(0, 1.18, -0.25);
    const bodyM = burnt ? burntM : litMat(name + "Body", hex(bodyHex), 0.35);
    if (!burnt) bodyM.specularPower = 64;
    const glassM = burnt ? burntGlassM : litMat(name + "Glass", hex("#1b2126"), 0.4);
    const parts = [{ mesh: body, mat: bodyM }, { mesh: cabin, mat: glassM }];
    for (const sx of [-0.88, 0.88]) for (const sz of [-1.4, 1.4]) {
      const w = MB.CreateCylinder("w", { diameter: 0.68, height: 0.26, tessellation: 12 }, scene);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx, 0.34, sz);
      parts.push({ mesh: w, mat: tyreM });
    }
    if (!burnt) {
      for (const sx of [-0.65, 0.65]) {
        const l = MB.CreateBox("hl", { width: 0.35, height: 0.14, depth: 0.05 }, scene);
        l.position.set(sx, 0.68, 2.2);
        parts.push({ mesh: l, mat: headM });
        const t = MB.CreateBox("tl", { width: 0.3, height: 0.12, depth: 0.05 }, scene);
        t.position.set(sx, 0.7, -2.2);
        parts.push({ mesh: t, mat: tailM });
      }
    }
    return mergedTemplate(name, parts);
  }

  function makeBikeTemplate(name, bodyHex, burnt = false) {
    const MB = BABYLON.MeshBuilder;
    const bodyM = burnt ? burntM : litMat(name + "Body", hex(bodyHex), 0.4);
    const darkM = burnt ? burntM : litMat(name + "Dark", hex("#1c1d20"), 0.2);
    const parts = [];
    const box = (w, h, d, x, y, z, mat, rx = 0) => {
      const m = MB.CreateBox("p", { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z); m.rotation.x = rx;
      parts.push({ mesh: m, mat });
    };
    for (const z of [-0.68, 0.7]) {
      const w = MB.CreateCylinder("w", { diameter: 0.64, height: 0.13, tessellation: 16 }, scene);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, 0.32, z);
      parts.push({ mesh: w, mat: tyreM });
    }
    box(0.12, 0.12, 1.05, 0, 0.6, 0.02, bodyM, -0.12);          // frame spine
    box(0.3, 0.24, 0.55, 0, 0.84, 0.22, bodyM);                 // tank
    box(0.27, 0.1, 0.62, 0, 0.88, -0.28, darkM);                // seat
    box(0.3, 0.32, 0.42, 0, 0.47, 0.02, burnt ? burntM : chromeM); // engine
    box(0.07, 0.62, 0.07, 0, 0.62, 0.6, burnt ? burntM : chromeM, -0.32); // fork
    box(0.72, 0.05, 0.05, 0, 1.0, 0.5, burnt ? burntM : chromeM); // handlebar
    box(0.08, 0.06, 0.55, 0.12, 0.36, -0.35, burnt ? burntM : chromeM, 0.12); // exhaust
    box(0.2, 0.06, 0.4, 0, 0.66, -0.62, bodyM, 0.25);           // rear fender
    if (!burnt) {
      box(0.17, 0.13, 0.06, 0, 0.9, 0.72, headM);
      box(0.13, 0.06, 0.04, 0, 0.78, -0.82, tailM);
    }
    return mergedTemplate(name, parts);
  }

  const carTemplates = [
    makeCarTemplate("carBlack", "#1d1f22"),
    makeCarTemplate("carBlack2", "#26292d"),
    makeCarTemplate("carNavy", "#22314a"),
    makeCarTemplate("carWhite", "#d8d8d4"),
    makeCarTemplate("carRed", "#7a1f1f"),
  ];
  const carTemplateWeights = [0, 0, 0, 1, 1, 2, 2, 3, 4];
  const bikeTemplates = [
    makeBikeTemplate("bikeRed", "#a3262a"),
    makeBikeTemplate("bikeBlue", "#1f4f9a"),
    makeBikeTemplate("bikeBlack", "#222326"),
    makeBikeTemplate("bikeOrange", "#c8681a"),
  ];
  const burntCar = makeCarTemplate("carBurnt", "#000", true);
  const burntBike = makeBikeTemplate("bikeBurnt", "#000", true);

  // Per-kind handling + footprint.
  const VEH = {
    car: {
      hw: 0.95, hd: 2.2, ht: 1.45, circles: [-1.45, 0, 1.45], r: 0.98,
      accel: 13, max: 33, rev: 9, brake: 28, turn: 1.8, camDist: 9, camH: 2.0, hits: 6, label: "Drive car",
    },
    bike: {
      hw: 0.35, hd: 0.95, ht: 1.15, circles: [-0.45, 0.45], r: 0.42,
      accel: 17, max: 40, rev: 4, brake: 32, turn: 2.7, camDist: 6, camH: 1.6, hits: 3, label: "Ride bike",
    },
  };

  // ---------------------------------------------------------------- vehicles
  const vehicles = []; // parked / player-usable (cars + bikes, incl. wrecks)
  function vehicleSolid(v) {
    const c = VEH[v.kind], h = v.heading;
    const ex = Math.abs(Math.cos(h)) * c.hw + Math.abs(Math.sin(h)) * c.hd;
    const ez = Math.abs(Math.sin(h)) * c.hw + Math.abs(Math.cos(h)) * c.hd;
    const p = v.mesh.position;
    const s = addSolid(p.x - ex, p.y, p.z - ez, p.x + ex, p.y + c.ht, p.z + ez);
    s.vehicle = v;
    return s;
  }
  function makeVehicle(kind, template, x, z, heading, y = 0) {
    const mesh = template.createInstance(kind);
    mesh.position.set(x, y, z);
    mesh.rotation.y = heading;
    const v = { kind, mesh, heading, speed: 0, hits: 0, wrecked: false, lean: 0, solid: null };
    v.solid = vehicleSolid(v);
    mesh.freezeWorldMatrix();
    vehicles.push(v);
    return v;
  }

  const nearIntersection = (v, lines, gap) => lines.some((l) => Math.abs(v - l) < gap);
  const nearLamp = (x, z) => lampSpots.some((l) => Math.abs(l.x - x) < 2.5 && Math.abs(l.z - z) < 2.5);

  // A car and two bikes waiting on the beach by the start point.
  makeVehicle("car", carTemplates[3], START.x + 7, START.z + 9, 0);
  makeVehicle("bike", bikeTemplates[0], START.x - 4, START.z + 6, 0.3);
  makeVehicle("bike", bikeTemplates[1], START.x - 5.6, START.z + 6.6, 0.3);

  // Parked cars along the kerbs.
  for (let i = 0; i < 110; i++) {
    const t = carTemplates[pick(carTemplateWeights)];
    if (rand() < 0.5) {
      const x = pick(roadXs);
      let z;
      do { z = rr(-CITY_MAX + 10, CITY_MAX - 10); } while (nearIntersection(z, roadZs, 12));
      const side = rand() < 0.5 ? -1 : 1;
      makeVehicle("car", t, x + side * 3.9, z, side > 0 ? 0 : Math.PI);
    } else {
      const z = pick(roadZs);
      let x;
      do { x = rr(SHORE_X + 10, CITY_MAX - 10); } while (nearIntersection(x, roadXs, 12));
      const side = rand() < 0.5 ? -1 : 1;
      makeVehicle("car", t, x, z + side * 3.9, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  // Bikes parked on the sidewalks, nose to the kerb.
  for (let i = 0; i < 40; i++) {
    const t = pick(bikeTemplates);
    for (let tries = 0; tries < 10; tries++) {
      if (rand() < 0.5) {
        const x = pick(roadXs), side = rand() < 0.5 ? -1 : 1;
        const z = rr(-CITY_MAX + 10, CITY_MAX - 10);
        if (nearIntersection(z, roadZs, 12) || nearLamp(x + side * 6.4, z) || x + side * 6.4 < -470) continue;
        makeVehicle("bike", t, x + side * 6.4, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0.15);
      } else {
        const z = pick(roadZs), side = rand() < 0.5 ? -1 : 1;
        const x = rr(-430, CITY_MAX - 10);
        if (nearIntersection(x, roadXs, 12) || nearLamp(x, z + side * 6.4)) continue;
        makeVehicle("bike", t, x, z + side * 6.4, side > 0 ? Math.PI : 0, 0.15);
      }
      break;
    }
  }

  // Driving traffic: each car sticks to one lane and wraps at the city edge.
  const traffic = [];
  for (let i = 0; i < 70; i++) {
    const c = carTemplates[pick(carTemplateWeights)].createInstance("traffic");
    const alongZ = rand() < 0.5;
    const dir = rand() < 0.5 ? 1 : -1;
    const base = rr(9, 15);
    if (alongZ) {
      const x = pick(roadXs);
      c.position.set(x + dir * 1.6, 0, rr(-CITY_MAX, CITY_MAX));
      c.rotation.y = dir > 0 ? 0 : Math.PI;
    } else {
      const z = pick(roadZs);
      c.position.set(rr(SHORE_X, CITY_MAX), 0, z - dir * 1.6);
      c.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    traffic.push({ mesh: c, alongZ, dir, base, speed: base, hits: 0, stopUntil: 0 });
  }
  const trafficBox = (t) => {
    const p = t.mesh.position;
    const hx = t.alongZ ? 1.0 : 2.3, hz = t.alongZ ? 2.3 : 1.0;
    return { minX: p.x - hx, maxX: p.x + hx, minY: 0, maxY: 1.5, minZ: p.z - hz, maxZ: p.z + hz };
  };

  // ---------------------------------------------------------------- player
  const skinMat = litMat("skin", hex("#c08462"), 0.18);
  skinMat.specularPower = 24;
  const shortsMat = litMat("shorts", hex("#2c2f33"), 0.05);

  const player = new BABYLON.TransformNode("player", scene);
  const cap = (name, r, h, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = BABYLON.MeshBuilder.CreateCapsule(name, { radius: r, height: h, tessellation: 12, subdivisions: 2 }, scene);
    m.material = mat; m.parent = parent;
    m.position.set(x, y, z); m.scaling.set(sx, sy, sz);
    return m;
  };
  const sph = (name, d, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = BABYLON.MeshBuilder.CreateSphere(name, { diameter: d, segments: 12 }, scene);
    m.material = mat; m.parent = parent;
    m.position.set(x, y, z); m.scaling.set(sx, sy, sz);
    return m;
  };
  const pivot = (name, parent, x, y, z) => {
    const n = new BABYLON.TransformNode(name, scene);
    n.parent = parent; n.position.set(x, y, z);
    return n;
  };

  const body = pivot("bodyRoot", player, 0, 0, 0);
  cap("hips", 0.17, 0.34, shortsMat, body, 0, 0.98, 0, 1.3, 1, 0.95);
  cap("abs", 0.17, 0.42, skinMat, body, 0, 1.2, 0, 1.15, 1, 0.85);
  sph("chest", 0.46, skinMat, body, 0, 1.4, 0, 1.45, 0.75, 0.82);
  sph("lats", 0.4, skinMat, body, 0, 1.3, -0.02, 1.5, 0.85, 0.7);
  sph("trapL", 0.16, skinMat, body, -0.12, 1.52, -0.02, 1.2, 0.8, 1);
  sph("trapR", 0.16, skinMat, body, 0.12, 1.52, -0.02, 1.2, 0.8, 1);
  cap("neck", 0.06, 0.16, skinMat, body, 0, 1.58, 0);
  sph("head", 0.24, skinMat, body, 0, 1.72, 0.01, 0.9, 1.05, 1);
  sph("delL", 0.19, skinMat, body, -0.31, 1.47, 0, 1, 1, 1);
  sph("delR", 0.19, skinMat, body, 0.31, 1.47, 0, 1, 1, 1);

  function makeArm(side) {
    const sh = pivot("shoulder", body, side * 0.33, 1.46, 0);
    sh.rotation.z = side * 0.16;
    cap("upperArm", 0.075, 0.34, skinMat, sh, 0, -0.16, 0);
    const el = pivot("elbow", sh, 0, -0.3, 0);
    el.rotation.x = -0.3;
    cap("forearm", 0.06, 0.3, skinMat, el, 0, -0.14, 0);
    sph("fist", 0.1, skinMat, el, 0, -0.31, 0.01);
    return { sh, el };
  }
  function makeLeg(side) {
    const hip = pivot("hip", body, side * 0.11, 0.93, 0);
    cap("thighShort", 0.105, 0.24, shortsMat, hip, 0, -0.07, 0);
    cap("thigh", 0.095, 0.46, skinMat, hip, 0, -0.22, 0);
    const knee = pivot("knee", hip, 0, -0.45, 0);
    cap("shin", 0.072, 0.44, skinMat, knee, 0, -0.21, 0);
    const foot = BABYLON.MeshBuilder.CreateBox("foot", { width: 0.1, height: 0.06, depth: 0.24 }, scene);
    foot.material = skinMat; foot.parent = knee; foot.position.set(0, -0.44, 0.05);
    return { hip, knee };
  }
  const armL = makeArm(-1), armR = makeArm(1);
  const legL = makeLeg(-1), legR = makeLeg(1);

  // Pistol in the right hand; barrel runs along the forearm's -Y axis.
  const gunMat = litMat("gunM", hex("#202226"), 0.5);
  const gun = new BABYLON.TransformNode("gun", scene);
  gun.parent = armR.el;
  gun.position.set(0, -0.33, 0.04);
  for (const [w, h, d, x, y, z] of [[0.05, 0.24, 0.07, 0, -0.07, 0.0], [0.045, 0.07, 0.13, 0, 0.03, 0.05]]) {
    const b = BABYLON.MeshBuilder.CreateBox("gunPart", { width: w, height: h, depth: d }, scene);
    b.material = gunMat; b.parent = gun; b.position.set(x, y, z);
  }
  const muzzle = pivot("muzzle", gun, 0, -0.2, 0);

  const blobTex = radialTex("blob", [[0, "rgba(0,0,0,0.5)"], [0.6, "rgba(0,0,0,0.25)"], [1, "rgba(0,0,0,0)"]]);
  const blob = BABYLON.MeshBuilder.CreateGround("blob", { width: 1.5, height: 1.1 }, scene);
  const blobMat = new BABYLON.StandardMaterial("blobMat", scene);
  blobMat.diffuseTexture = blobTex;
  blobMat.useAlphaFromDiffuseTexture = true;
  blobMat.disableLighting = true;
  blobMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
  blob.material = blobMat;

  // ---------------------------------------------------------------- effects
  const tracerT = emissiveTemplate("tracer", BABYLON.MeshBuilder.CreateBox("tracer", { size: 1 }, scene), hex("#ffe9a0"));
  const sparkT = emissiveTemplate("spark", BABYLON.MeshBuilder.CreateSphere("spark", { diameter: 1, segments: 6 }, scene), hex("#ffb347"));
  const flashT = emissiveTemplate("flash", BABYLON.MeshBuilder.CreateSphere("flash", { diameter: 1, segments: 10 }, scene), hex("#ff9a3c"));
  const effects = [];
  function addEffect(mesh, life, update) { effects.push({ mesh, t: 0, life, update }); }
  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.t += dt;
      if (e.t >= e.life) { e.mesh.dispose(); effects.splice(i, 1); continue; }
      if (e.update) e.update(e.t / e.life, e.mesh);
    }
  }
  function spark(p, size = 0.28, life = 0.12) {
    const s = sparkT.createInstance("s");
    s.position.copyFrom(p);
    addEffect(s, life, (k, m) => m.scaling.setAll(size * (1 - k * 0.7)));
  }
  function tracer(a, b) {
    const len = V3.Distance(a, b);
    if (len < 0.1) return;
    const t = tracerT.createInstance("t");
    t.position = V3.Center(a, b);
    t.scaling.set(0.035, 0.035, len);
    t.lookAt(b);
    addEffect(t, 0.06);
  }
  const smokeTex = radialTex("smoke", [[0, "rgba(255,255,255,0.9)"], [0.5, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]], 64);
  function smoke(pos, seconds) {
    const ps = new BABYLON.ParticleSystem("smoke", 180, scene);
    ps.particleTexture = smokeTex;
    ps.emitter = pos.clone();
    ps.minEmitBox = new V3(-0.8, 0.5, -0.8); ps.maxEmitBox = new V3(0.8, 1.2, 0.8);
    ps.color1 = new BABYLON.Color4(0.22, 0.2, 0.19, 0.55);
    ps.color2 = new BABYLON.Color4(0.08, 0.08, 0.08, 0.5);
    ps.colorDead = new BABYLON.Color4(0, 0, 0, 0);
    ps.minSize = 1.2; ps.maxSize = 3.2;
    ps.minLifeTime = 2.5; ps.maxLifeTime = 4.5;
    ps.emitRate = 22;
    ps.direction1 = new V3(-0.6, 3.5, -0.6); ps.direction2 = new V3(0.6, 5, 0.6);
    ps.minEmitPower = 0.6; ps.maxEmitPower = 1.2;
    ps.gravity = new V3(0.4, 0.3, 0.2);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    setTimeout(() => ps.stop(), seconds * 1000);
    setTimeout(() => ps.dispose(), (seconds + 6) * 1000);

    const fire = new BABYLON.ParticleSystem("fire", 120, scene);
    fire.particleTexture = smokeTex;
    fire.emitter = pos.clone();
    fire.minEmitBox = new V3(-0.7, 0.3, -0.9); fire.maxEmitBox = new V3(0.7, 0.9, 0.9);
    fire.color1 = new BABYLON.Color4(1, 0.6, 0.15, 0.9);
    fire.color2 = new BABYLON.Color4(1, 0.3, 0.05, 0.8);
    fire.colorDead = new BABYLON.Color4(0.2, 0.05, 0, 0);
    fire.minSize = 0.5; fire.maxSize = 1.3;
    fire.minLifeTime = 0.3; fire.maxLifeTime = 0.8;
    fire.emitRate = 60;
    fire.direction1 = new V3(-0.3, 2, -0.3); fire.direction2 = new V3(0.3, 3.5, 0.3);
    fire.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    fire.start();
    setTimeout(() => fire.stop(), seconds * 0.6 * 1000);
    setTimeout(() => fire.dispose(), (seconds * 0.6 + 2) * 1000);
  }

  // ---------------------------------------------------------------- night mode
  // Sky dome with stars + moon (night only).
  const starTex = canvasTex("stars", 2048, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#02040a"); g.addColorStop(0.45, "#0a1226"); g.addColorStop(0.5, "#0d1830"); g.addColorStop(1, "#02040a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      const y = rand() * H * 0.48;
      const a = rr(0.25, 1);
      ctx.fillStyle = `rgba(255,255,${rr(220, 255) | 0},${a})`;
      const s = rand() < 0.04 ? 2.2 : rr(0.8, 1.5);
      ctx.fillRect(rand() * W, y, s, s);
    }
  }, true, 1024);
  const skyDome = BABYLON.MeshBuilder.CreateSphere("sky", { diameter: 2400, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  const skyMat = new BABYLON.StandardMaterial("skyM", scene);
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = starTex;
  skyMat.fogEnabled = false;
  skyMat.backFaceCulling = false;
  skyDome.material = skyMat;
  skyDome.infiniteDistance = true;
  skyDome.setEnabled(false);

  const moonTex = radialTex("moon", [[0, "rgba(255,252,235,1)"], [0.42, "rgba(245,240,220,1)"], [0.48, "rgba(200,210,240,0.35)"], [1, "rgba(160,180,230,0)"]]);
  const moon = BABYLON.MeshBuilder.CreatePlane("moon", { size: 120 }, scene);
  const moonMat = new BABYLON.StandardMaterial("moonM", scene);
  moonMat.disableLighting = true;
  moonMat.emissiveTexture = moonTex;
  moonMat.opacityTexture = moonTex;
  moonMat.fogEnabled = false;
  moon.material = moonMat;
  moon.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  moon.infiniteDistance = true;
  moon.position.set(-700, 520, 650);
  moon.setEnabled(false);

  // Headlight beam decal in front of the vehicle you drive (night only).
  const beamTex = canvasTex("beam", 256, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createLinearGradient(0, S, 0, 0);
    g.addColorStop(0, "rgba(255,245,215,0.75)"); g.addColorStop(1, "rgba(255,245,215,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(S * 0.38, S); ctx.lineTo(S * 0.62, S); ctx.lineTo(S, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
  }, false);
  beamTex.hasAlpha = true;
  beamTex.wrapU = beamTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  const beamMat = new BABYLON.StandardMaterial("beamM", scene);
  beamMat.disableLighting = true;
  beamMat.emissiveTexture = beamTex;
  beamMat.opacityTexture = beamTex;
  beamMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
  beamMat.backFaceCulling = false;
  const beam = BABYLON.MeshBuilder.CreateGround("beam", { width: 9, height: 16 }, scene);
  beam.material = beamMat;
  beam.setEnabled(false);

  let night = false;
  function setNight(on) {
    night = on;
    const sky = on ? NIGHT_SKY : SKY;
    scene.clearColor = new BABYLON.Color4(sky.r, sky.g, sky.b, 1);
    scene.fogColor = sky.clone();
    scene.fogStart = on ? 90 : 280;
    scene.fogEnd = on ? 650 : 1150;
    hemi.intensity = on ? 0.3 : 0.78;
    hemi.diffuse = on ? hex("#8fa3d6") : new BABYLON.Color3(1, 1, 1);
    hemi.groundColor = on ? hex("#1c2233") : new BABYLON.Color3(0.5, 0.5, 0.53);
    sun.intensity = on ? 0.08 : 0.5;
    sandTex.level = on ? 0.2 : 1;
    for (const f of flatMats) f.m.emissiveColor = on ? f.day.scale(f.k) : f.day.clone();
    for (const f of facadeList) {
      f.mat.emissiveTexture = on ? f.nightTex : null;
      f.imat.diffuseTexture = on ? f.itexN : f.itex;
      f.imat.emissiveColor = on ? new BABYLON.Color3(0.5, 0.47, 0.4) : f.imat.__dayEm.clone();
    }
    const warm = new BABYLON.Color3(0.55, 0.5, 0.42);
    for (const m of interiorMats) {
      m.emissiveColor = on ? (m.diffuseTexture ? warm.clone() : m.diffuseColor.multiply(warm)) : m.__dayEm.clone();
    }
    bulbMat.emissiveColor = on ? hex("#ffe3a8") : hex("#8d8b84");
    for (const p of lampPools) p.isVisible = on;
    skyDome.setEnabled(on);
    moon.setEnabled(on);
    glow.intensity = on ? 0.9 : 0.35;
    document.body.classList.toggle("night", on);
  }

  // ---------------------------------------------------------------- input
  const keys = {};
  let lastSpaceAt = 0, superJumpQueued = false, interactQueued = false;
  window.addEventListener("keydown", (e) => {
    if (e.code === "Tab") {
      e.preventDefault();
      document.getElementById("controls").classList.toggle("show");
    }
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (e.code === "Space") {
      const now = performance.now();
      if (now - lastSpaceAt < 320) superJumpQueued = true;
      lastSpaceAt = now;
    }
    if (e.code === "KeyE" || e.code === "Enter") interactQueued = true;
    if (e.code === "KeyN") setNight(!night);
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });
  window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; firing = false; aiming = false; });

  let yaw = 0, pitch = 0.12, camDist = 6;
  let firing = false, aiming = false, lastMouseAt = 0;
  const locked = () => document.pointerLockElement === canvas;
  // Pointer events, not mouse events: Babylon's scene input calls
  // preventDefault() on pointerdown, which suppresses the legacy
  // mousedown/mousemove events. Button state comes from the `buttons`
  // bitmask so holding left + right together (fire while aiming) works.
  const syncButtons = (e) => {
    if (!locked()) return;
    firing = (e.buttons & 1) !== 0;
    aiming = (e.buttons & 2) !== 0;
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!locked()) {
      if (canvas.requestPointerLock) {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {}); // e.g. clicked again too soon after Esc
      }
      return;
    }
    syncButtons(e);
  });
  window.addEventListener("pointerup", syncButtons);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("pointerlockchange", () => {
    document.getElementById("clickToPlay").style.display = locked() ? "none" : "block";
    if (!locked()) { firing = false; aiming = false; }
  });
  document.addEventListener("pointermove", (e) => {
    if (!locked()) return;
    syncButtons(e); // second button pressed/released while the first is held
    const sens = aiming ? 0.0013 : 0.0025;
    yaw += e.movementX * sens;
    pitch = clamp(pitch + e.movementY * sens * 0.8, -0.6, 1.25);
    if (Math.abs(e.movementX) > 1) lastMouseAt = performance.now();
  });
  canvas.addEventListener("wheel", (e) => {
    camDist = clamp(camDist + Math.sign(e.deltaY) * 0.8, 2, 18);
    e.preventDefault();
  }, { passive: false });

  // ---------------------------------------------------------------- on-foot physics
  const RADIUS = 0.4;
  const STEP = 0.42;          // max ledge the player walks up without jumping
  const HEIGHT = 1.8;
  const GRAV = 22;
  const pos = new V3(START.x, 0, START.z);
  let vy = 0, onGround = true, facing = 0, walkPhase = 0, moveAmt = 0;
  let pushX = 0, pushZ = 0;     // knockback velocity (explosions)
  let superJump = null;         // { x, z, clearY } while flying onto a roof
  let aimTimer = 0;             // keeps the gun raised after a shot
  let vehicle = null;           // the vehicle being driven

  function supportHeight(x, z, y) {
    let best = 0;
    const f = 0.28;
    for (const s of query(x - f, x + f, z - f, z + f)) {
      if (s.maxY > y + STEP || s.maxY <= best) continue;
      if (x + f > s.minX && x - f < s.maxX && z + f > s.minZ && z - f < s.maxZ) best = s.maxY;
    }
    return best;
  }
  function ceilingAt(x, z, y) {
    let c = Infinity;
    const f = 0.22;
    for (const s of query(x - f, x + f, z - f, z + f)) {
      if (s.minY < y + 1.0 || s.minY >= c) continue;
      if (x + f > s.minX && x - f < s.maxX && z + f > s.minZ && z - f < s.maxZ) c = s.minY;
    }
    return c;
  }
  function collideHoriz(p) {
    const list = query(p.x - RADIUS - 0.1, p.x + RADIUS + 0.1, p.z - RADIUS - 0.1, p.z + RADIUS + 0.1).slice();
    for (const b of list) {
      if (b.maxY <= p.y + STEP || b.minY >= p.y + HEIGHT - 0.05) continue;
      if (p.x < b.minX - RADIUS || p.x > b.maxX + RADIUS || p.z < b.minZ - RADIUS || p.z > b.maxZ + RADIUS) continue;
      const cx = clamp(p.x, b.minX, b.maxX);
      const cz = clamp(p.z, b.minZ, b.maxZ);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        if (d < RADIUS) { p.x += (dx / d) * (RADIUS - d); p.z += (dz / d) * (RADIUS - d); }
      } else {
        const pushes = [b.minX - RADIUS - p.x, b.maxX + RADIUS - p.x, b.minZ - RADIUS - p.z, b.maxZ + RADIUS - p.z];
        let best = 0;
        for (let i = 1; i < 4; i++) if (Math.abs(pushes[i]) < Math.abs(pushes[best])) best = i;
        if (best < 2) p.x += pushes[best]; else p.z += pushes[best];
      }
    }
  }
  function indoorsNow() {
    for (const e of enterables) {
      if (pos.x > e.minX && pos.x < e.maxX && pos.z > e.minZ && pos.z < e.maxZ && pos.y < e.F * e.fh - 0.5) return e;
    }
    return null;
  }

  // Double-tap Space next to a building → leap onto its roof terrace.
  function roofCandidate() {
    if (vehicle || indoorsNow()) return null;
    let best = null, bestD = 3.2;
    for (const r of roofs) {
      if (r.top < pos.y + 1.5) continue;
      const dx = Math.max(r.minX - pos.x, 0, pos.x - r.maxX);
      const dz = Math.max(r.minZ - pos.z, 0, pos.z - r.maxZ);
      const d = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }
  function startSuperJump() {
    const r = roofCandidate();
    if (!r) return false;
    let tx, tz;
    if (r.landing) { tx = r.landing.x; tz = r.landing.z; }
    else {
      const inset = Math.min(3, (r.maxX - r.minX) / 2 - 0.5, (r.maxZ - r.minZ) / 2 - 0.5);
      tx = clamp(pos.x, r.minX + inset, r.maxX - inset);
      tz = clamp(pos.z, r.minZ + inset, r.maxZ - inset);
      // don't land inside rooftop machinery
      for (const m of r.mechs) {
        if (Math.hypot(tx - m.x, tz - m.z) < m.r) {
          const a = Math.atan2(tz - m.z, tx - m.x);
          tx = clamp(m.x + Math.cos(a) * (m.r + 0.5), r.minX + 1, r.maxX - 1);
          tz = clamp(m.z + Math.sin(a) * (m.r + 0.5), r.minZ + 1, r.maxZ - 1);
        }
      }
    }
    const rise = r.rim + 2.6 - pos.y;
    vy = Math.sqrt(2 * GRAV * rise);
    onGround = false;
    superJump = { x: tx, z: tz, clearY: r.rim + 0.35 };
    facing = Math.atan2(tx - pos.x, tz - pos.z);
    return true;
  }

  function updatePlayer(dt) {
    const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    let mx = 0, mz = 0;
    if (!superJump) {
      if (keys.KeyW || keys.ArrowUp) { mx += fwdX; mz += fwdZ; }
      if (keys.KeyS || keys.ArrowDown) { mx -= fwdX; mz -= fwdZ; }
      if (keys.KeyD || keys.ArrowRight) { mx += rightX; mz += rightZ; }
      if (keys.KeyA || keys.ArrowLeft) { mx -= rightX; mz -= rightZ; }
    }
    const len = Math.hypot(mx, mz);
    const running = (keys.ShiftLeft || keys.ShiftRight) && !aiming;
    const speed = aiming ? 2.6 : running ? 9 : 4.2;
    const gunUp = aiming || aimTimer > 0;

    // Horizontal displacement: input + knockback + super-jump glide.
    let dx = 0, dz = 0;
    if (len > 0) { dx += (mx / len) * speed * dt; dz += (mz / len) * speed * dt; }
    dx += pushX * dt; dz += pushZ * dt;
    const pk = Math.exp(-4 * dt);
    pushX *= pk; pushZ *= pk;
    if (superJump && pos.y > superJump.clearY) {
      const gx = superJump.x - pos.x, gz = superJump.z - pos.z;
      const gd = Math.hypot(gx, gz);
      if (gd > 0.05) { const s = Math.min(gd, 14 * dt); dx += (gx / gd) * s; dz += (gz / gd) * s; }
    }
    const dist = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(dist / 0.15)); // sub-step: no tunnelling through thin walls
    for (let i = 0; i < n; i++) {
      pos.x += dx / n; pos.z += dz / n;
      collideHoriz(pos);
      if (onGround) {
        const g = supportHeight(pos.x, pos.z, pos.y);
        if (g > pos.y) pos.y = g;
      }
    }
    if (gunUp) {
      facing = yaw;
    } else if (len > 0) {
      let diff = Math.atan2(mx, mz) - facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      facing += diff * Math.min(1, dt * 12);
    }
    moveAmt += ((len > 0 ? (running ? 1 : 0.6) : 0) - moveAmt) * Math.min(1, dt * 10);

    // Vertical: jump, gravity, landing, step-down, ceilings.
    if (onGround && keys.Space && !superJump) { vy = 7.2; onGround = false; }
    vy = Math.max(-45, vy - GRAV * dt);
    const gh = supportHeight(pos.x, pos.z, pos.y);
    let ny = pos.y + vy * dt;
    if (vy > 0) {
      const c = ceilingAt(pos.x, pos.z, pos.y);
      if (ny + HEIGHT > c) { ny = c - HEIGHT; vy = 0; }
    }
    if (vy <= 0 && ny <= gh) {
      pos.y = gh; vy = 0; onGround = true; superJump = null;
    } else if (onGround && vy <= 0 && pos.y - gh < 0.45) {
      pos.y = gh; vy = 0;
    } else {
      pos.y = ny; onGround = false;
    }

    pos.x = clamp(pos.x, SHORE_X - 40, CITY_MAX + 40);
    pos.z = clamp(pos.z, -CITY_MAX - 40, CITY_MAX + 40);

    // Passing traffic shoves you aside.
    for (const t of traffic) {
      const p = t.mesh.position;
      const ddx = pos.x - p.x, ddz = pos.z - p.z;
      const d = Math.hypot(ddx, ddz);
      if (d < 2.6 && d > 0.01 && pos.y < 1.5) {
        pos.x += (ddx / d) * (2.6 - d);
        pos.z += (ddz / d) * (2.6 - d);
      }
    }

    player.position.copyFrom(pos);
    player.rotation.y = facing;
    const shadowY = supportHeight(pos.x, pos.z, pos.y + 0.01);
    blob.position.set(pos.x, shadowY + 0.025, pos.z);
    blob.rotation.y = facing;
    const s = Math.max(0.3, 1 - (pos.y - shadowY) * 0.25);
    blob.scaling.set(s, 1, s);

    // Walk cycle + gun pose
    walkPhase += dt * (running ? 11 : 7.5) * (len > 0 ? 1 : 0);
    const a = moveAmt * 0.75;
    const sw = Math.sin(walkPhase);
    if (onGround) {
      legL.hip.rotation.x = -sw * a;
      legR.hip.rotation.x = sw * a;
      legL.knee.rotation.x = Math.max(0, Math.sin(walkPhase + 1.2)) * a * 1.3;
      legR.knee.rotation.x = Math.max(0, -Math.sin(walkPhase + 1.2)) * a * 1.3;
    } else {
      legL.hip.rotation.x = -0.5; legR.hip.rotation.x = -0.2;
      legL.knee.rotation.x = 0.9; legR.knee.rotation.x = 0.5;
    }
    armL.sh.rotation.x = sw * a * 0.9;
    armL.el.rotation.x = -0.3 - moveAmt * 0.5;
    if (gunUp) {
      armR.sh.rotation.x = -Math.PI / 2 + pitch * 0.9;
      armR.sh.rotation.z = 0.05;
      armR.el.rotation.x = 0;
    } else {
      armR.sh.rotation.x = -sw * a * 0.9;
      armR.sh.rotation.z = 0.16;
      armR.el.rotation.x = -0.3 - moveAmt * 0.5;
    }
    aimTimer = Math.max(0, aimTimer - dt);
    const t = performance.now() / 1000;
    body.position.y = Math.abs(Math.cos(walkPhase)) * 0.05 * moveAmt + Math.sin(t * 2) * 0.006;
  }

  // ---------------------------------------------------------------- driving
  function vehicleBlocked(v, x, z, h, y) {
    const c = VEH[v.kind];
    const fx = Math.sin(h), fz = Math.cos(h);
    for (const off of c.circles) {
      const cx = x + fx * off, cz = z + fz * off;
      for (const e of enterables) {
        if (cx > e.minX - 0.5 && cx < e.maxX + 0.5 && cz > e.minZ - 0.5 && cz < e.maxZ + 0.5 && y < e.F * e.fh) return true;
      }
      for (const s of query(cx - c.r, cx + c.r, cz - c.r, cz + c.r)) {
        if (s.maxY <= y + 0.32 || s.minY >= y + 1.3) continue;
        if (circleHitsBox(cx, cz, c.r, s)) return true;
      }
      for (const t of traffic) {
        const p = t.mesh.position;
        if (Math.abs(p.x - cx) > 4 || Math.abs(p.z - cz) > 4) continue;
        for (const o of [-1.4, 0, 1.4]) {
          const tx = p.x + (t.alongZ ? 0 : o), tz = p.z + (t.alongZ ? o : 0);
          if (Math.hypot(tx - cx, tz - cz) < c.r + 1.0) return t;
        }
      }
    }
    return false;
  }

  function enterVehicle(v) {
    vehicle = v;
    v.solid.off = true;
    v.speed = 0;
    v.mesh.unfreezeWorldMatrix();
    superJump = null; firing = false; aiming = false; aimTimer = 0;
    blob.setEnabled(false);
    gun.setEnabled(false);
    yaw = v.heading; lastMouseAt = 0;
    if (v.kind === "car") {
      player.setEnabled(false);
    } else {
      // seat the rider on the bike
      player.parent = v.mesh;
      player.position.set(0, 0.1, -0.22);
      player.rotation.y = 0;
      body.position.y = 0;
      body.rotation.x = 0.28;
      legL.hip.rotation.x = legR.hip.rotation.x = -1.35;
      legL.knee.rotation.x = legR.knee.rotation.x = 1.3;
      armL.sh.rotation.x = armR.sh.rotation.x = -1.05;
      armL.el.rotation.x = armR.el.rotation.x = -0.35;
      armR.sh.rotation.z = 0.16;
    }
  }
  function playerFits(x, y, z) {
    for (const s of query(x - 0.6, x + 0.6, z - 0.6, z + 0.6)) {
      if (s.maxY <= y + STEP || s.minY >= y + HEIGHT) continue;
      if (circleHitsBox(x, z, 0.45, s)) return false;
    }
    return true;
  }
  function exitVehicle() {
    const v = vehicle;
    const c = VEH[v.kind];
    v.speed = 0;
    const p = v.mesh.position, h = v.heading;
    const side = c.hw + 0.9;
    const opts = [
      [-Math.cos(h) * side, Math.sin(h) * side],
      [Math.cos(h) * side, -Math.sin(h) * side],
      [-Math.sin(h) * (c.hd + 1), -Math.cos(h) * (c.hd + 1)],
      [Math.sin(h) * (c.hd + 1), Math.cos(h) * (c.hd + 1)],
    ];
    let spot = null;
    for (const [ox, oz] of opts) {
      const x = p.x + ox, z = p.z + oz;
      const y = supportHeight(x, z, p.y + 0.3);
      if (playerFits(x, y, z)) { spot = [x, y, z]; break; }
    }
    if (!spot) spot = [p.x, p.y + c.ht + 0.1, p.z]; // hop out onto the roof
    vehicle = null;
    v.solid = vehicleSolid(v);
    v.mesh.rotation.z = 0;
    v.mesh.freezeWorldMatrix();
    beam.setEnabled(false);
    player.parent = null;
    player.setEnabled(true);
    body.rotation.x = 0;
    armR.sh.rotation.z = 0.16;
    blob.setEnabled(true);
    gun.setEnabled(true);
    pos.set(spot[0], spot[1], spot[2]);
    vy = 0; onGround = true;
    facing = h;
  }

  function stealTraffic(t) {
    traffic.splice(traffic.indexOf(t), 1);
    const v = { kind: "car", mesh: t.mesh, heading: t.mesh.rotation.y, speed: 0, hits: t.hits, wrecked: false, lean: 0 };
    v.solid = vehicleSolid(v);
    vehicles.push(v);
    return v;
  }

  function nearestUsable() {
    let best = null, bestD = Infinity;
    for (const v of vehicles) {
      if (v.wrecked) continue;
      const d = V3.Distance(v.mesh.position, pos);
      if (d < (v.kind === "car" ? 3.6 : 2.6) && d < bestD) { best = v; bestD = d; }
    }
    for (const t of traffic) {
      const d = V3.Distance(t.mesh.position, pos);
      if (d < 3.6 && d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  function updateVehicle(dt) {
    const v = vehicle, c = VEH[v.kind];
    const throttle = keys.KeyW || keys.ArrowUp, back = keys.KeyS || keys.ArrowDown;
    const steer = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const boost = keys.ShiftLeft || keys.ShiftRight ? 1.3 : 1;
    if (throttle) v.speed += (v.speed < -0.5 ? c.brake : c.accel * boost) * dt;
    if (back) v.speed -= (v.speed > 0.5 ? c.brake : c.accel * 0.7) * dt;
    if (keys.Space) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), c.brake * 1.3 * dt);
    if (!throttle && !back) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), (2.5 + Math.abs(v.speed) * 0.12) * dt);
    v.speed = clamp(v.speed, -c.rev, c.max * boost);

    const sf = clamp(Math.abs(v.speed) / 6, 0, 1) * (1 - 0.45 * clamp(Math.abs(v.speed) / c.max, 0, 1));
    const newH = v.heading + steer * c.turn * sf * Math.sign(v.speed) * dt;
    const p = v.mesh.position;
    const step = v.speed * dt;
    const nx = p.x + Math.sin(newH) * step, nz = p.z + Math.cos(newH) * step;

    let hit = vehicleBlocked(v, nx, nz, newH, p.y);
    if (!hit) {
      p.x = nx; p.z = nz; v.heading = newH;
    } else if (!vehicleBlocked(v, nx, p.z, v.heading, p.y)) {
      p.x = nx; v.speed *= 0.96;            // slide along the obstacle
    } else if (!vehicleBlocked(v, p.x, nz, v.heading, p.y)) {
      p.z = nz; v.speed *= 0.96;
    } else {
      if (hit && hit !== true) hit.stopUntil = performance.now() + 3000;
      v.speed = -v.speed * 0.25;           // bounce
      if (!vehicleBlocked(v, p.x, p.z, newH, p.y)) v.heading = newH;
    }
    const gy = supportHeight(p.x, p.z, p.y + 0.1);
    p.y += (gy - p.y) * Math.min(1, dt * 14);
    p.x = clamp(p.x, SHORE_X - 30, CITY_MAX + 30);
    p.z = clamp(p.z, -CITY_MAX - 30, CITY_MAX + 30);
    v.mesh.rotation.y = v.heading;
    if (v.kind === "bike") {
      const leanT = -steer * clamp(Math.abs(v.speed) / 14, 0, 1) * 0.42;
      v.lean += (leanT - v.lean) * Math.min(1, dt * 6);
      v.mesh.rotation.z = v.lean;
    }

    // Camera swings back behind the vehicle when the mouse is idle.
    if (performance.now() - lastMouseAt > 1200 && Math.abs(v.speed) > 2) {
      let d = v.heading - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 2.5);
    }

    pos.copyFrom(p);
    if (night) {
      beam.setEnabled(true);
      const off = v.kind === "car" ? 10 : 9;
      beam.position.set(p.x + Math.sin(v.heading) * off, p.y + 0.22, p.z + Math.cos(v.heading) * off);
      beam.rotation.y = v.heading;
    } else beam.setEnabled(false);
  }

  // ---------------------------------------------------------------- traffic
  function updateTraffic(dt, now) {
    for (const t of traffic) {
      const p = t.mesh.position;
      const along = t.alongZ ? p.z : p.x;
      const ahead = (qx, qz, r) => {
        const fwd = ((t.alongZ ? qz : qx) - along) * t.dir;
        const lat = t.alongZ ? qx - p.x : qz - p.z;
        return fwd > 1.5 && fwd < 9 && Math.abs(lat) < 1.0 + r;
      };
      let blocked = now < t.stopUntil;
      if (!blocked && pos.y < 2 && ahead(pos.x, pos.z, vehicle ? 1.0 : 0.4)) blocked = true;
      if (!blocked) {
        for (const o of traffic) {
          if (o === t || o.alongZ !== t.alongZ || o.dir !== t.dir) continue;
          if (ahead(o.mesh.position.x, o.mesh.position.z, 0.2)) { blocked = true; break; }
        }
      }
      if (!blocked) {
        const cx = p.x + (t.alongZ ? 0 : t.dir * 5.5), cz = p.z + (t.alongZ ? t.dir * 5.5 : 0);
        const hx = t.alongZ ? 0.9 : 3.5, hz = t.alongZ ? 3.5 : 0.9;
        for (const s of query(cx - hx, cx + hx, cz - hz, cz + hz)) {
          if (s.vehicle && s.maxX > cx - hx && s.minX < cx + hx && s.maxZ > cz - hz && s.minZ < cz + hz) { blocked = true; break; }
        }
      }
      const target = blocked ? 0 : t.base;
      t.speed += clamp(target - t.speed, -24 * dt, 7 * dt);
      if (t.alongZ) {
        p.z += t.dir * t.speed * dt;
        if (p.z > CITY_MAX) p.z = -CITY_MAX;
        if (p.z < -CITY_MAX) p.z = CITY_MAX;
      } else {
        p.x += t.dir * t.speed * dt;
        if (p.x > CITY_MAX) p.x = SHORE_X;
        if (p.x < SHORE_X) p.x = CITY_MAX;
      }
    }
  }

  // ---------------------------------------------------------------- shooting
  function rayBox(o, d, b, tmin, tmax) {
    let t0 = tmin, t1 = tmax;
    for (const [oc, dc, lo, hi] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.minY, b.maxY], [o.z, d.z, b.minZ, b.maxZ]]) {
      if (Math.abs(dc) < 1e-9) { if (oc < lo || oc > hi) return null; continue; }
      let a = (lo - oc) / dc, c = (hi - oc) / dc;
      if (a > c) { const tmp = a; a = c; c = tmp; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return null;
    }
    return t0;
  }
  function raycast(o, d, tmin, tmax) {
    let best = tmax, hit = null;
    for (let t = tmin; t < best; t += 6) {
      const t2 = Math.min(t + 6, best);
      const ax = o.x + d.x * t, az = o.z + d.z * t, bx = o.x + d.x * t2, bz = o.z + d.z * t2;
      for (const s of query(Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz))) {
        const th = rayBox(o, d, s, tmin, best);
        if (th !== null && th < best) { best = th; hit = { solid: s }; }
      }
    }
    for (const t of traffic) {
      const th = rayBox(o, d, trafficBox(t), tmin, best);
      if (th !== null && th < best) { best = th; hit = { traffic: t }; }
    }
    if (d.y < 0) {
      const tg = -o.y / d.y;
      if (tg > tmin && tg < best) { best = tg; hit = { ground: true }; }
    }
    return { t: best, hit };
  }

  function explode(at, scale = 1) {
    const f = flashT.createInstance("boom");
    f.position.copyFrom(at);
    addEffect(f, 0.45, (k, m) => m.scaling.setAll((1.5 + k * 7) * scale * (1 - k * 0.4)));
    smoke(at, 12);
    if (!vehicle) {
      const dx = pos.x - at.x, dz = pos.z - at.z, d = Math.hypot(dx, dz);
      if (d < 7) {
        const k = 1 - d / 7;
        pushX += (dx / (d || 1)) * 14 * k; pushZ += (dz / (d || 1)) * 14 * k;
        vy = Math.max(vy, 7 * k); onGround = false;
      }
    }
  }
  function wreck(v) {
    v.wrecked = true;
    const tpl = v.kind === "car" ? burntCar : burntBike;
    const m = tpl.createInstance("wreck");
    m.position.copyFrom(v.mesh.position);
    m.rotation.y = v.mesh.rotation.y;
    m.freezeWorldMatrix();
    v.mesh.dispose();
    v.mesh = m;
    explode(m.position.add(new V3(0, 0.6, 0)), v.kind === "car" ? 1 : 0.6);
  }
  function damageVehicle(v) {
    if (v.wrecked || v === vehicle) return;
    v.hits++;
    if (v.hits >= VEH[v.kind].hits) wreck(v);
  }
  function damageTraffic(t) {
    t.hits++;
    t.stopUntil = performance.now() + 6000;
    if (t.hits >= VEH.car.hits) {
      const v = stealTraffic(t);
      v.solid.off = true;
      wreck(v);
      v.solid = vehicleSolid(v);
    }
  }

  let shotCooldown = 0;
  function fire() {
    shotCooldown = 0.16;
    aimTimer = 0.7;
    facing = yaw;
    player.rotation.y = facing;
    armR.sh.rotation.x = -Math.PI / 2 + pitch * 0.9;
    armR.el.rotation.x = 0;
    for (const n of [player, body, armR.sh, armR.el, gun, muzzle]) n.computeWorldMatrix(true);
    const o = camera.position.clone();
    const d = camera.getDirection(BABYLON.Axis.Z).normalize();
    const tmin = Math.max(0.3, V3.Distance(camera.position, camTarget) - 0.3);
    const { t, hit } = raycast(o, d, tmin, 260);
    const end = o.add(d.scale(t));
    const m = muzzle.getAbsolutePosition().clone();
    tracer(m, end);
    spark(m, 0.18, 0.05);
    if (hit) {
      spark(end.subtract(d.scale(0.05)));
      if (hit.solid && hit.solid.vehicle) damageVehicle(hit.solid.vehicle);
      else if (hit.traffic) damageTraffic(hit.traffic);
    }
  }

  // ---------------------------------------------------------------- camera
  const camTarget = new V3();
  function pointBlocked(x, y, z) {
    const m = 0.18;
    for (const b of query(x - m, x + m, z - m, z + m)) {
      if (y > b.minY - m && y < b.maxY + m && x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m) return true;
    }
    return false;
  }
  function updateCamera(dt) {
    let dist = camDist, h = 1.55, side = 0;
    if (vehicle) { const c = VEH[vehicle.kind]; dist = Math.max(camDist, c.camDist); h = c.camH; }
    else if (aiming) { dist = 2.6; side = 0.65; h = 1.65; }
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    camTarget.set(pos.x + rx * side, pos.y + h, pos.z + rz * side);
    const p = vehicle ? Math.max(pitch, 0.05) : pitch;
    const cp = Math.cos(p);
    const dx = -Math.sin(yaw) * cp, dy = Math.sin(p), dz = -Math.cos(yaw) * cp;
    let d = dist;
    for (let s = 0.3; s <= dist; s += 0.25) {
      if (pointBlocked(camTarget.x + dx * s, camTarget.y + dy * s, camTarget.z + dz * s)) {
        d = Math.max(0.35, s - 0.3);
        break;
      }
    }
    const want = new V3(camTarget.x + dx * d, Math.max(0.4, camTarget.y + dy * d), camTarget.z + dz * d);
    const cur = V3.Distance(camera.position, camTarget);
    const k = d < cur - 0.05 ? 1 : Math.min(1, dt * (vehicle ? 8 : 12));
    camera.position = V3.Lerp(camera.position, want, k);
    camera.setTarget(camTarget);
    const fovT = aiming && !vehicle ? 0.62 : vehicle ? 1.05 + clamp(Math.abs(vehicle.speed) / 40, 0, 1) * 0.15 : 1.0;
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 10);
  }

  // ---------------------------------------------------------------- HUD
  const el = (id) => document.getElementById(id);
  const locEl = el("location"), promptEl = el("prompt"), speedEl = el("speed"), crossEl = el("crosshair");
  const hudState = {};
  function setHud(key, node, text) {
    if (hudState[key] === text) return;
    hudState[key] = text;
    node.innerHTML = text;
    node.style.display = text ? "block" : "none";
  }
  let hudTimer = 0;
  function updateHud(dt) {
    // location
    let loc = "";
    for (const e of enterables) {
      if (pos.x > e.minX && pos.x < e.maxX && pos.z > e.minZ && pos.z < e.maxZ) {
        const fl = Math.floor((pos.y + 0.4) / e.fh);
        loc = `${e.name} · ${fl === 0 ? "Lobby" : fl >= e.F ? "Roof" : "Floor " + fl}`;
        break;
      }
    }
    if (!loc && !vehicle && pos.y > 8 && onGround) loc = "Rooftop";
    setHud("loc", locEl, loc);
    setHud("speed", speedEl, vehicle ? `${Math.round(Math.abs(vehicle.speed) * 3.6)} <small>km/h</small>` : "");
    crossEl.className = aiming ? "hud aim" : "hud";
    crossEl.style.display = locked() && !vehicle ? "block" : "none";

    hudTimer -= dt;
    if (hudTimer > 0) return;
    hudTimer = 0.12;
    let pr = "";
    if (vehicle) pr = "<kbd>E</kbd> Get out";
    else {
      const u = nearestUsable();
      if (u) pr = `<kbd>E</kbd> ${u.kind === "bike" ? VEH.bike.label : u.alongZ !== undefined ? "Take car" : VEH.car.label}`;
      else if (onGround && roofCandidate()) pr = "<kbd>Space</kbd><kbd>Space</kbd> Jump onto roof";
    }
    setHud("prompt", promptEl, pr);
  }

  // ---------------------------------------------------------------- minimap
  const mm = el("minimap");
  const mctx = mm.getContext("2d");
  const MAP_MIN_X = SHORE_X - 300, MAP_MAX_X = CITY_MAX + 300;
  const MAP_MIN_Z = -CITY_MAX - 300, MAP_MAX_Z = CITY_MAX + 300;
  const baked = document.createElement("canvas");
  baked.width = MAP_MAX_X - MAP_MIN_X;
  baked.height = MAP_MAX_Z - MAP_MIN_Z;
  const toMap = (x, z) => [x - MAP_MIN_X, MAP_MAX_Z - z];
  {
    const c = baked.getContext("2d");
    c.fillStyle = "#16171d";
    c.fillRect(0, 0, baked.width, baked.height);
    c.fillStyle = "#1f5f80";
    c.fillRect(0, 0, toMap(SHORE_X, 0)[0], baked.height);
    c.fillStyle = "#6d7178";
    for (const x of roadXs) {
      const [px, py] = toMap(x - ASPHALT / 2, CITY_MAX);
      c.fillRect(px, py, ASPHALT, 2 * CITY_MAX);
    }
    for (const z of roadZs) {
      const [px, py] = toMap(SHORE_X, z + ASPHALT / 2);
      c.fillRect(px, py, CITY_MAX - SHORE_X, ASPHALT);
    }
    for (const b of mapBuildings) {
      c.fillStyle = b.enter ? "#c4902f" : "#2c2e36";
      const [px, py] = toMap(b.x - b.w / 2, b.z + b.d / 2);
      c.fillRect(px, py, b.w, b.d);
      if (b.enter) {
        const [dx, dy] = toMap(b.x + (b.door[0] * b.w) / 2, b.z + (b.door[1] * b.d) / 2);
        c.fillStyle = "#ffe08a";
        c.beginPath(); c.arc(dx, dy, 3, 0, Math.PI * 2); c.fill();
      }
    }
  }

  function drawMinimap() {
    const W = mm.width, R = W / 2;
    const zoom = 0.9;
    mctx.save();
    mctx.clearRect(0, 0, W, W);
    mctx.beginPath(); mctx.arc(R, R, R, 0, Math.PI * 2); mctx.clip();
    mctx.fillStyle = "#16171d"; mctx.fillRect(0, 0, W, W);

    mctx.translate(R, R);
    mctx.rotate(-yaw);
    mctx.scale(zoom, zoom);
    const [px, pz] = toMap(pos.x, pos.z);
    mctx.drawImage(baked, -px, -pz);
    const dot = (x, z, r, col) => {
      const [tx, tz] = toMap(x, z);
      const dx = tx - px, dz = tz - pz;
      if (Math.abs(dx) > 160 || Math.abs(dz) > 160) return;
      mctx.fillStyle = col;
      mctx.beginPath(); mctx.arc(dx, dz, r, 0, Math.PI * 2); mctx.fill();
    };
    for (const t of traffic) dot(t.mesh.position.x, t.mesh.position.z, 3.2, "#4a8cff");
    for (const v of vehicles) {
      if (v === vehicle || v.wrecked) continue;
      if (v.kind === "bike") dot(v.mesh.position.x, v.mesh.position.z, 2.2, "#7ee3a1");
    }
    mctx.restore();

    mctx.save();
    mctx.translate(R, R);
    mctx.rotate((vehicle ? vehicle.heading : facing) - yaw);
    mctx.fillStyle = "#fff";
    mctx.strokeStyle = "#222";
    mctx.lineWidth = 1.5;
    mctx.beginPath();
    mctx.moveTo(0, -10); mctx.lineTo(7, 8); mctx.lineTo(0, 4); mctx.lineTo(-7, 8); mctx.closePath();
    mctx.fill(); mctx.stroke();
    mctx.restore();

    const nr = R - 16;
    mctx.fillStyle = "#fff";
    mctx.font = "bold 15px Segoe UI, sans-serif";
    mctx.textAlign = "center"; mctx.textBaseline = "middle";
    mctx.fillText("N", R - nr * Math.sin(yaw), R - nr * Math.cos(yaw));
  }

  // ---------------------------------------------------------------- debug hooks
  // URL params: ?night=1  ?b=<building>&f=<floor>  ?yaw= ?pitch= ?dist=
  //             ?ride=car|bike (start in that vehicle)  ?jump=1 (stand by a building)
  window.__city = {
    enterables, vehicles, traffic, pos,
    setNight, fire, startSuperJump,
    setView(y, p, d) { yaw = y; pitch = p; if (d) camDist = d; },
  };

  // ---------------------------------------------------------------- start
  facing = 0;
  yaw = 0.35; // look up the beach with the city on the right
  {
    const q = new URLSearchParams(location.search);
    const bi = q.get("b");
    if (bi !== null && enterables[+bi]) {
      const e = enterables[+bi];
      const fl = Math.min(e.F, +(q.get("f") || 0));
      pos.set(e.minX + 4.5, fl * e.fh, e.maxZ - 7.2);
      yaw = Math.PI * 0.25;
    }
    if (q.get("jump")) {
      const r = roofs.filter((rf) => !rf.landing).sort((a, b) =>
        Math.hypot((a.minX + a.maxX) / 2 - START.x, (a.minZ + a.maxZ) / 2 - START.z) -
        Math.hypot((b.minX + b.maxX) / 2 - START.x, (b.minZ + b.maxZ) / 2 - START.z))[0];
      pos.set(r.minX - 1.5, 0, (r.minZ + r.maxZ) / 2);
      yaw = Math.PI / 2;
    }
    if (q.get("yaw") !== null) yaw = +q.get("yaw");
    if (q.get("pitch") !== null) pitch = +q.get("pitch");
    if (q.get("dist") !== null) camDist = +q.get("dist");
    facing = yaw;
    if (q.get("night")) setNight(true);
    const ride = q.get("ride");
    if (ride === "car" || ride === "bike") {
      const v = vehicles.find((x) => x.kind === ride);
      pos.copyFrom(v.mesh.position);
      enterVehicle(v);
      if (q.get("speed")) v.speed = +q.get("speed");
    }
  }
  camera.position.set(pos.x, pos.y + 3, pos.z - 7);

  // ---------------------------------------------------------------- loop
  let mapTimer = 0;
  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    const now = performance.now();

    if (interactQueued) {
      interactQueued = false;
      if (vehicle) exitVehicle();
      else {
        const u = nearestUsable();
        if (u) enterVehicle(u.alongZ !== undefined ? stealTraffic(u) : u);
      }
    }
    if (superJumpQueued) {
      superJumpQueued = false;
      if (!vehicle) startSuperJump();
    }

    updateTraffic(dt, now);
    if (vehicle) updateVehicle(dt);
    else {
      updatePlayer(dt);
      shotCooldown -= dt;
      if (firing && locked() && shotCooldown <= 0) fire();
    }
    updateCamera(dt);
    updateEffects(dt);
    updateHud(dt);
    mapTimer += dt;
    if (mapTimer > 1 / 30) { mapTimer = 0; drawMinimap(); }
    scene.render();
  });
  window.addEventListener("resize", () => engine.resize());
})();
