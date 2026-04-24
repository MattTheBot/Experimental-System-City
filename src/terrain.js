// ─────────────────────────────────────────────────────
//  terrain.js  —  mesh, brush, slope colouring, export
// ─────────────────────────────────────────────────────

var TS = 512;
var TG = 150;

var terrain = BABYLON.MeshBuilder.CreateGround("terrain", {
  width:TS, height:TS, subdivisions:TG, updatable:true
}, scene);

var tMat = new BABYLON.StandardMaterial("tmat", scene);
tMat.diffuseColor        = new BABYLON.Color3(1, 1, 1);
tMat.specularColor       = new BABYLON.Color3(0.03, 0.03, 0.03);
tMat.vertexColorsEnabled = true;
terrain.material         = tMat;

// ── Vertex helpers ──────────────────────────────────
function getV() {
  return terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
}
function setV(v) {
  terrain.updateVerticesData(BABYLON.VertexBuffer.PositionKind, v);
  terrain.createNormals(false);
  updateTerrainColors();
}

// ── Slope vertex colours ────────────────────────────
var GRASS = [0.27, 0.54, 0.17];
var DIRT  = [0.52, 0.38, 0.22];

function updateTerrainColors() {
  var norms = terrain.getVerticesData(BABYLON.VertexBuffer.NormalKind);
  if (!norms) return;
  var n    = norms.length / 3;
  var cols = new Float32Array(n * 4);
  for (var i = 0; i < n; i++) {
    var ny = norms[i * 3 + 1];
    var t  = Math.max(0, Math.min(1, (ny - 0.65) / 0.20));
    cols[i*4]   = GRASS[0]*t + DIRT[0]*(1-t);
    cols[i*4+1] = GRASS[1]*t + DIRT[1]*(1-t);
    cols[i*4+2] = GRASS[2]*t + DIRT[2]*(1-t);
    cols[i*4+3] = 1;
  }
  terrain.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, true);
}
updateTerrainColors();

// ── Brush state ─────────────────────────────────────
var brushMode    = "raise";
var brushRadius  = 12;
var brushStr     = 0.5;
var flattenTarget = null;  // sampled height for flatten (0.5m snapped)
var raiseTarget  = null;   // optional ceiling for raise brush
var lowerTarget  = null;   // optional floor for lower brush

// ── Core brush ──────────────────────────────────────
function applyBrush(hp) {
  var v  = getV();
  var hx = hp.x, hz = hp.z, hy = hp.y;
  var rL = (TG + 1) * 3;
  var i, j, n, dx, dz, d, fo, dt, nb, sum, cnt;
  var flatY = (brushMode === "flatten" && flattenTarget !== null) ? flattenTarget : hy;

  if (brushMode === "smooth") {
    var cp = v.slice();
    for (i = 0; i < v.length; i += 3) {
      dx = v[i]-hx; dz = v[i+2]-hz;
      d = Math.sqrt(dx*dx+dz*dz); if (d > brushRadius) continue;
      fo = 1-d/brushRadius;
      nb = [i-3, i+3, i-rL, i+rL]; sum = cp[i+1]; cnt = 1;
      for (j=0;j<4;j++){n=nb[j];if(n>=0&&n<cp.length){sum+=cp[n+1];cnt++;}}
      v[i+1] += ((sum/cnt)-v[i+1]) * fo * brushStr * 0.4;
    }
  } else {
    for (i = 0; i < v.length; i += 3) {
      dx = v[i]-hx; dz = v[i+2]-hz;
      d = Math.sqrt(dx*dx+dz*dz); if (d > brushRadius) continue;
      fo = 1-d/brushRadius;
      dt = brushStr * fo;

      if (brushMode === "raise") {
        v[i+1] += dt;
        // Clamp to raiseTarget if set
        if (raiseTarget !== null && v[i+1] > raiseTarget) v[i+1] = raiseTarget;
      }
      if (brushMode === "lower") {
        v[i+1] -= dt;
        // Clamp to lowerTarget if set
        if (lowerTarget !== null && v[i+1] < lowerTarget) v[i+1] = lowerTarget;
      }
      if (brushMode === "flatten") {
        v[i+1] += (flatY - v[i+1]) * fo * 0.25;
      }
      v[i+1] = Math.max(-30, Math.min(80, v[i+1]));
    }
  }
  setV(v);
}

// Right-click samples height for flatten, snapped to 0.5m
function sampleHeight(hp) {
  flattenTarget = Math.round(hp.y / 0.5) * 0.5;
  var el = document.getElementById("layer-val");
  if (el) el.textContent = flattenTarget.toFixed(1) + " m";
}

// Parse raise/lower target from UI inputs
function setRaiseTarget(val) {
  var n = parseFloat(val);
  raiseTarget = isNaN(n) ? null : n;
}
function setLowerTarget(val) {
  var n = parseFloat(val);
  lowerTarget = isNaN(n) ? null : n;
}

// ── Heightmap export ─────────────────────────────────
function exportHM() {
  var sz = TG+1, v = getV();
  var cv = document.createElement("canvas");
  cv.width = cv.height = sz;
  var ctx = cv.getContext("2d"), img = ctx.createImageData(sz, sz);
  var mn = Infinity, mx = -Infinity;
  for (var i=1;i<v.length;i+=3){if(v[i]<mn)mn=v[i];if(v[i]>mx)mx=v[i];}
  var rng = mx-mn||1;
  for (var r=0;r<sz;r++) for (var c=0;c<sz;c++) {
    var vi=(r*sz+c)*3, pv=Math.round(((v[vi+1]-mn)/rng)*255);
    var pi=(r*sz+c)*4;
    img.data[pi]=img.data[pi+1]=img.data[pi+2]=pv; img.data[pi+3]=255;
  }
  ctx.putImageData(img,0,0);
  var a = document.createElement("a");
  a.download="heightmap.png"; a.href=cv.toDataURL(); a.click();
}

// ── Brush circle (CreateLines in XZ — always flat) ───
var brushCircle = null;
var _red4 = new BABYLON.Color4(1, 0.2, 0.2, 1);

function rebuildCircle() {
  if (brushCircle) { brushCircle.dispose(); brushCircle = null; }
  var pts = [], cols = [];
  for (var i=0; i<=48; i++) {
    var a = (i/48)*Math.PI*2;
    pts.push(new BABYLON.Vector3(Math.cos(a)*brushRadius, 0, Math.sin(a)*brushRadius));
    cols.push(_red4);
  }
  brushCircle = BABYLON.MeshBuilder.CreateLines("bc", {points:pts, colors:cols}, scene);
  brushCircle.isPickable = false;
  brushCircle.isVisible  = false;
}
rebuildCircle();

// ── Snap dot (flat disc) ─────────────────────────────
var snapDot = BABYLON.MeshBuilder.CreateDisc("sd", {radius:1.4, tessellation:16}, scene);
snapDot.rotation.x    = Math.PI/2;
snapDot.isPickable    = false;
snapDot.isVisible     = false;
var sdMat = new BABYLON.StandardMaterial("sdmat", scene);
sdMat.diffuseColor    = new BABYLON.Color3(1, 0.9, 0.1);
sdMat.emissiveColor   = new BABYLON.Color3(0.5, 0.45, 0);
sdMat.backFaceCulling = false;
snapDot.material      = sdMat;

// ── UI helpers (called from onclick) ─────────────────
function setBrush(mode, btn) {
  brushMode = mode;
  document.querySelectorAll("#bmodes button").forEach(function(b) {
    b.classList.remove("active");
  });
  btn.classList.add("active");
}
