// ─────────────────────────────────────────────────────
//  roads.js  —  road data, GLB instancing, support columns
//
//  Road model system:
//    Upload a GLB that is exactly UNIT (8m) long, oriented
//    along its LOCAL Z axis, centred at origin.
//    The system places instances every UNIT along the bezier,
//    each rotated to match the curve tangent at that point.
//    Falls back to ribbon mesh if no model loaded.
//
//  Support columns:
//    At each curve sample point, a ray is cast downward.
//    If road Y > terrain Y + COLUMN_THRESHOLD, a column
//    is placed and scaled to bridge the gap.
//    On flat ground columns are underground and invisible.
// ─────────────────────────────────────────────────────

var roads = [];  // all placed road objects

// ── Road model (GLB) ─────────────────────────────────
var roadModelMeshes = [];   // source meshes after loading (setEnabled false)
var ROAD_MODEL_LEN  = UNIT; // assumed GLB length = 1 UNIT
var COLUMN_THRESHOLD = 0.8; // metres above terrain before column shows

// Call this when user uploads a GLB via the file input
function loadRoadModel(file) {
  var url  = URL.createObjectURL(file);
  // Clear any previously loaded model
  roadModelMeshes.forEach(function(m) { m.dispose(); });
  roadModelMeshes = [];

  BABYLON.SceneLoader.ImportMesh("", url, "", scene, function(meshes) {
    for (var i = 0; i < meshes.length; i++) {
      meshes[i].setEnabled(false);
      meshes[i].isPickable = false;
      roadModelMeshes.push(meshes[i]);
    }
    document.getElementById("model-status").textContent =
      "Model loaded (" + meshes.length + " mesh" + (meshes.length > 1 ? "es" : "") + ")";
  }, null, function(err) {
    document.getElementById("model-status").textContent = "Load failed: " + err;
  });
}

// ── Road placement state machine ─────────────────────
// Declared here; all methods assigned before engine init
// so rs is never undefined when buttons fire
var rs = { phase:0, A:null, B:null, preview:null, markerA:null };

rs.reset = function() {
  rs.phase = 0; rs.A = null; rs.B = null;
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  if (rs.markerA) { rs.markerA.dispose(); rs.markerA = null; }
};

rs.placeMarker = function(pos) {
  var m  = BABYLON.MeshBuilder.CreateSphere("nodeA", {diameter:2.4}, scene);
  m.position = pos.clone(); m.position.y += 1.2; m.isPickable = false;
  var mat = new BABYLON.StandardMaterial("nodeAmat", scene);
  mat.diffuseColor  = new BABYLON.Color3(0.2, 0.6, 1.0);
  mat.emissiveColor = new BABYLON.Color3(0.05, 0.2, 0.5);
  m.material = mat;
  return m;
};

// Preview uses a lightweight tube — always, regardless of model state
rs.updatePreview = function(A, handle, end) {
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  if (A.subtract(end).length() < 0.5) return;
  try {
    var curve = BABYLON.Curve3.CreateQuadraticBezier(A, handle, end, 30);
    var pts   = curve.getPoints();
    liftToTerrain(pts, 0.15);
    rs.preview = BABYLON.MeshBuilder.CreateTube("roadPreview", {
      path:pts, radius:2.5, tessellation:6
    }, scene);
    rs.preview.isPickable = false;
    var pm = new BABYLON.StandardMaterial("rpmat", scene);
    pm.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.9);
    pm.alpha        = 0.4;
    rs.preview.material = pm;
  } catch(e) { /* degenerate curve — ignore */ }
};

// ── Build a finalised road ────────────────────────────
function buildRoad(A, handle, C) {
  // Sample curve with enough points for smooth columns + instances
  var curve = BABYLON.Curve3.CreateQuadraticBezier(A, handle, C, 64);
  var pts   = curve.getPoints();
  liftToTerrain(pts, 0.08);

  var rid       = roads.length;
  var instances = [];
  var supports  = [];

  if (roadModelMeshes.length > 0) {
    placeModelInstances(pts, rid, instances);
  } else {
    placeRibbonRoad(pts, rid);
  }

  placeSupports(pts, rid, supports);

  roads.push({
    id:        rid,
    A:         A.clone(),
    handle:    handle.clone(),
    C:         C.clone(),
    curve:     pts,
    instances: instances,
    supports:  supports
  });

  // Update length display
  var totalLen = 0;
  for (var i = 1; i < pts.length; i++)
    totalLen += BABYLON.Vector3.Distance(pts[i], pts[i-1]);
  document.getElementById("road-len").textContent =
    Math.round(totalLen) + " m  (" + Math.round(totalLen/UNIT) + " units)";
}

// Lift each point to terrain surface + offset
function liftToTerrain(pts, offset) {
  for (var i = 0; i < pts.length; i++) {
    pts[i].y = terrainYAt(pts[i].x, pts[i].z) + offset;
  }
}

// ── GLB instancing ────────────────────────────────────
// Places one instance of each source mesh every ROAD_MODEL_LEN
// metres along the curve, oriented to the tangent at that point.
function placeModelInstances(pts, rid, instances) {
  // Walk the curve accumulating distance
  var accum  = 0;
  var placed = 0;

  for (var i = 1; i < pts.length; i++) {
    var seg  = BABYLON.Vector3.Distance(pts[i], pts[i-1]);
    accum   += seg;

    if (accum >= ROAD_MODEL_LEN) {
      accum -= ROAD_MODEL_LEN;

      // Tangent at this point
      var tang  = pts[i].subtract(pts[i-1]).normalize();
      var angle = Math.atan2(tang.x, tang.z);
      var pos   = pts[i].clone();

      for (var m = 0; m < roadModelMeshes.length; m++) {
        var inst = roadModelMeshes[m].createInstance("ri_" + rid + "_" + placed + "_" + m);
        inst.position   = pos.clone();
        inst.rotation.y = angle;
        inst.isPickable = false;
        instances.push(inst);
      }
      placed++;
    }
  }
}

// ── Ribbon fallback ───────────────────────────────────
function placeRibbonRoad(pts, rid) {
  var halfW = 2.5, kerbW = 0.4;
  var left = [], right = [], lk = [], rk = [];

  for (var i = 0; i < pts.length; i++) {
    var prev = pts[Math.max(0, i-1)];
    var next = pts[Math.min(pts.length-1, i+1)];
    var tang = next.subtract(prev).normalize();
    var perp = new BABYLON.Vector3(-tang.z, 0, tang.x);

    left.push( pts[i].add(perp.scale( halfW)));
    right.push(pts[i].add(perp.scale(-halfW)));
    lk.push(   pts[i].add(perp.scale( halfW + kerbW)));
    rk.push(   pts[i].add(perp.scale(-halfW - kerbW)));
  }

  var road = BABYLON.MeshBuilder.CreateRibbon("road"+rid, {
    pathArray:[left, right], closePath:false, closeArray:false
  }, scene);
  road.isPickable = false;
  var rm = new BABYLON.StandardMaterial("rm"+rid, scene);
  rm.diffuseColor  = new BABYLON.Color3(0.18,0.18,0.18);
  rm.specularColor = new BABYLON.Color3(0.04,0.04,0.04);
  road.material    = rm;

  var lkm = BABYLON.MeshBuilder.CreateRibbon("lk"+rid,{pathArray:[lk,left],closePath:false,closeArray:false},scene);
  var rkm = BABYLON.MeshBuilder.CreateRibbon("rk"+rid,{pathArray:[right,rk],closePath:false,closeArray:false},scene);
  var km  = new BABYLON.StandardMaterial("km"+rid, scene);
  km.diffuseColor  = new BABYLON.Color3(0.7,0.68,0.63);
  km.specularColor = new BABYLON.Color3(0.03,0.03,0.03);
  lkm.material = rkm.material = km;
  lkm.isPickable = rkm.isPickable = false;

  addCentreLine(pts, rid);
}

function addCentreLine(pts, rid) {
  var mat = new BABYLON.StandardMaterial("cl"+rid, scene);
  mat.diffuseColor  = new BABYLON.Color3(1,1,1);
  mat.emissiveColor = new BABYLON.Color3(0.4,0.4,0.4);
  for (var i=2; i<pts.length-2; i+=4) {
    var p   = pts[i];
    var nxt = pts[Math.min(i+1,pts.length-1)];
    var dir = nxt.subtract(p).normalize();
    var d   = BABYLON.MeshBuilder.CreateBox("cl"+i+"_"+rid,{width:0.18,depth:2.0,height:0.04},scene);
    d.position   = p.clone(); d.position.y += 0.12;
    d.rotation.y = Math.atan2(dir.x,dir.z);
    d.isPickable = false; d.material = mat;
  }
}

// ── Support columns ───────────────────────────────────
// Column mesh shared across all supports (instanced)
var _columnSource = null;

function getColumnSource() {
  if (_columnSource) return _columnSource;
  _columnSource = BABYLON.MeshBuilder.CreateCylinder("colSrc", {
    diameter:0.6, height:1.0, tessellation:8
  }, scene);
  _columnSource.setEnabled(false);
  _columnSource.isPickable = false;
  var cm = new BABYLON.StandardMaterial("colmat", scene);
  cm.diffuseColor  = new BABYLON.Color3(0.55,0.52,0.48);
  cm.specularColor = new BABYLON.Color3(0.05,0.05,0.05);
  _columnSource.material = cm;
  return _columnSource;
}

function placeSupports(pts, rid, supports) {
  var src = getColumnSource();
  // Sample every 4th point — enough resolution without over-placing
  for (var i = 0; i < pts.length; i += 4) {
    var roadY    = pts[i].y;
    var groundY  = terrainYAt(pts[i].x, pts[i].z);
    var gap      = roadY - groundY;

    if (gap < COLUMN_THRESHOLD) continue; // underground or flush — skip

    var col = src.createInstance("sup_" + rid + "_" + i);
    col.scaling.y = gap;
    col.position.x = pts[i].x;
    col.position.y = groundY + gap / 2;
    col.position.z = pts[i].z;
    col.isPickable  = false;
    supports.push(col);
  }
}
