// ─────────────────────────────────────────────────────
//  terrain.js — mesh, brush, slope colour, export
// ─────────────────────────────────────────────────────

var TS = 512;  // world size in metres
var TG = 150;  // subdivisions per side (150×150 = 22,801 vertices)

var terrain = BABYLON.MeshBuilder.CreateGround("terrain", {
  width: TS, height: TS, subdivisions: TG, updatable: true
}, scene);

var tMat = new BABYLON.StandardMaterial("tmat", scene);
// White diffuse so vertex colours are the full colour
tMat.diffuseColor         = new BABYLON.Color3(1, 1, 1);
tMat.specularColor        = new BABYLON.Color3(0.03, 0.03, 0.03);
tMat.vertexColorsEnabled  = true;
terrain.material           = tMat;

// ── Vertex helpers ──────────────────────────────────
function getV() {
  return terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
}
function setV(v) {
  terrain.updateVerticesData(BABYLON.VertexBuffer.PositionKind, v);
  terrain.createNormals(false);   // recompute lighting normals
  updateTerrainColors();          // recolour based on new normals
}

// ── Slope-based vertex colouring ────────────────────
// After every brush stroke, each vertex is coloured by slope:
//   ny close to 1 → flat ground → grass green
//   ny close to 0 → cliff face  → dirt brown
//
// Transition: smoothstep between ny=0.65 and ny=0.85
//   (roughly 31° → 49° slope angle)
var GRASS_R = 0.27, GRASS_G = 0.54, GRASS_B = 0.17;
var DIRT_R  = 0.52, DIRT_G  = 0.38, DIRT_B  = 0.22;

function updateTerrainColors() {
  var norms = terrain.getVerticesData(BABYLON.VertexBuffer.NormalKind);
  if (!norms) return;

  var n    = norms.length / 3;
  var cols = new Float32Array(n * 4);

  for (var i = 0; i < n; i++) {
    var ny = norms[i * 3 + 1]; // Y component: 1=flat, 0=vertical
    // smoothstep: t=1 at ny≥0.85 (flat), t=0 at ny≤0.65 (steep)
    var t  = Math.max(0, Math.min(1, (ny - 0.65) / 0.20));
    cols[i * 4]     = GRASS_R * t + DIRT_R * (1 - t);
    cols[i * 4 + 1] = GRASS_G * t + DIRT_G * (1 - t);
    cols[i * 4 + 2] = GRASS_B * t + DIRT_B * (1 - t);
    cols[i * 4 + 3] = 1;
  }

  terrain.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, true);
}

// Initialise colours on a flat terrain (all normals point up → all grass)
updateTerrainColors();

// ── Brush state ─────────────────────────────────────
var brushMode    = "raise";
var brushRadius  = 12;
var brushStr     = 0.5;
var flattenTarget = null; // sampled height for flatten tool (0.5m snapped)

// ── Brush maths (ported, engine-agnostic) ────────────
function applyBrush(hp) {
  var v   = getV();
  var hx  = hp.x, hz = hp.z, hy = hp.y;
  var rL  = (TG + 1) * 3;
  var i, j, n, dx, dz, d, fo, dt, nb, sum, cnt;
  var flatY = (brushMode === "flatten" && flattenTarget !== null) ? flattenTarget : hy;

  if (brushMode === "smooth") {
    var cp = v.slice();
    for (i = 0; i < v.length; i += 3) {
      dx = v[i] - hx; dz = v[i + 2] - hz;
      d  = Math.sqrt(dx * dx + dz * dz); if (d > brushRadius) continue;
      fo  = 1 - d / brushRadius;
      nb  = [i - 3, i + 3, i - rL, i + rL];
      sum = cp[i + 1]; cnt = 1;
      for (j = 0; j < 4; j++) {
        n = nb[j];
        if (n >= 0 && n < cp.length) { sum += cp[n + 1]; cnt++; }
      }
      v[i + 1] += ((sum / cnt) - v[i + 1]) * fo * brushStr * 0.4;
    }
  } else {
    for (i = 0; i < v.length; i += 3) {
      dx = v[i] - hx; dz = v[i + 2] - hz;
      d  = Math.sqrt(dx * dx + dz * dz); if (d > brushRadius) continue;
      fo = 1 - d / brushRadius;
      dt = brushStr * fo;
      if (brushMode === "raise")   v[i + 1] += dt;
      if (brushMode === "lower")   v[i + 1] -= dt;
      if (brushMode === "flatten") v[i + 1] += (flatY - v[i + 1]) * fo * 0.25;
      v[i + 1] = Math.max(-30, Math.min(80, v[i + 1]));
    }
  }
  setV(v); // also calls updateTerrainColors
}

// Right-click: sample terrain height, snap to nearest 0.5m layer
function sampleHeight(hp) {
  flattenTarget = Math.round(hp.y / 0.5) * 0.5;
  document.getElementById("layer-val").textContent = flattenTarget.toFixed(1) + " m";
}

// ── Heightmap export ─────────────────────────────────
function exportHM() {
  var sz  = TG + 1;
  var v   = getV();
  var cv  = document.createElement("canvas");
  cv.width = cv.height = sz;
  var ctx = cv.getContext("2d");
  var img = ctx.createImageData(sz, sz);
  var mn  = Infinity, mx = -Infinity;
  for (var i = 1; i < v.length; i += 3) {
    if (v[i] < mn) mn = v[i];
    if (v[i] > mx) mx = v[i];
  }
  var rng = mx - mn || 1;
  for (var r = 0; r < sz; r++) {
    for (var c = 0; c < sz; c++) {
      var vi = (r * sz + c) * 3;
      var pv = Math.round(((v[vi + 1] - mn) / rng) * 255);
      var pi = (r * sz + c) * 4;
      img.data[pi] = img.data[pi+1] = img.data[pi+2] = pv;
      img.data[pi + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  var a  = document.createElement("a");
  a.download = "system-city-heightmap.png";
  a.href     = cv.toDataURL();
  a.click();
}

// ── Brush circle (CreateLines in XZ plane — always flat) ──
var brushCircle = null;
var _red4 = new BABYLON.Color4(1, 0.2, 0.2, 1);

function rebuildCircle() {
  if (brushCircle) { brushCircle.dispose(); brushCircle = null; }
  var pts = [], cols = [];
  for (var i = 0; i <= 48; i++) {
    var a = (i / 48) * Math.PI * 2;
    pts.push(new BABYLON.Vector3(Math.cos(a) * brushRadius, 0, Math.sin(a) * brushRadius));
    cols.push(_red4);
  }
  brushCircle = BABYLON.MeshBuilder.CreateLines("bc", { points: pts, colors: cols }, scene);
  brushCircle.isPickable = false;
  brushCircle.isVisible  = false;
}
rebuildCircle();

// ── Snap dot ─────────────────────────────────────────
var snapDot      = BABYLON.MeshBuilder.CreateDisc("sd", { radius:1.4, tessellation:16 }, scene);
snapDot.rotation.x    = Math.PI / 2; // disc is XY by default — rotate to lie flat
snapDot.isPickable    = false;
snapDot.isVisible     = false;
var sdMat = new BABYLON.StandardMaterial("sdmat", scene);
sdMat.diffuseColor    = new BABYLON.Color3(1, 0.9, 0.1);
sdMat.emissiveColor   = new BABYLON.Color3(0.5, 0.45, 0);
sdMat.backFaceCulling = false;
snapDot.material      = sdMat;

// ── UI helper for brush buttons ───────────────────────
function setBrush(mode, btn) {
  brushMode = mode;
  document.querySelectorAll("#bmodes button").forEach(function(b) {
    b.classList.remove("active");
  });
  btn.classList.add("active");
}
