// ─────────────────────────────────────────────────────
//  roads.js  —  road data, snap nodes, GLB instancing,
//               ribbon fallback, support columns
//
//  Snap node rule:
//    Every road generates nodes at: start, end, and every
//    UNIT metres along the curve. New roads starting near
//    an existing node MUST start from it (enforced in snap.js).
//    Roads in open terrain can start freely.
// ─────────────────────────────────────────────────────

var roads     = [];  // all placed road objects
var snapNodes = [];  // all snap nodes across all roads

// ── Road model (optional GLB from /models/) ──────────
// Set roadModelPath to a path in your repo.
// If null, ribbon fallback is used.
var roadModelPath   = null;   // e.g. "models/road_2lane.glb"
var roadModelMeshes = [];     // hidden source meshes for instancing

// Call this once at startup if a model path is set
function loadRoadModelFromPath(path) {
  roadModelMeshes.forEach(function(m) { m.dispose(); });
  roadModelMeshes = [];
  BABYLON.SceneLoader.ImportMesh("", path, "", scene,
    function(meshes) {
      for (var i = 0; i < meshes.length; i++) {
        meshes[i].setEnabled(false);
        meshes[i].isPickable = false;
        roadModelMeshes.push(meshes[i]);
      }
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Model loaded (" + meshes.length + " mesh)";
    },
    null,
    function() {
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Model load failed — using ribbon";
    }
  );
}

// ── Snap node shared material (created once) ──────────
var _snMat = null;
function getSnapNodeMat() {
  if (_snMat) return _snMat;
  _snMat = new BABYLON.StandardMaterial("snmat", scene);
  _snMat.diffuseColor    = new BABYLON.Color3(0.15, 0.80, 1.00);
  _snMat.emissiveColor   = new BABYLON.Color3(0.05, 0.35, 0.55);
  _snMat.backFaceCulling = false;
  return _snMat;
}

// ── Create one snap node ─────────────────────────────
function createSnapNode(pos, roadId, indexAlongRoad) {
  var mesh = BABYLON.MeshBuilder.CreateDisc("sn_" + snapNodes.length, {
    radius: 0.9, tessellation: 14
  }, scene);
  mesh.rotation.x  = Math.PI / 2;
  mesh.position    = pos.clone();
  mesh.position.y += 0.35;      // sit just above road surface
  mesh.isPickable  = false;
  mesh.isVisible   = false;     // hidden until mouse is near
  mesh.material    = getSnapNodeMat();

  var node = {
    id:             snapNodes.length,
    position:       pos.clone(),
    roadId:         roadId,
    indexAlongRoad: indexAlongRoad,
    mesh:           mesh
  };
  snapNodes.push(node);
  return node;
}

// ── Generate snap nodes along a built road ────────────
// One at start, one at end, one per UNIT metres in between.
function generateSnapNodes(road) {
  var pts   = road.curve;
  var nodes = [];

  // Start node
  nodes.push(createSnapNode(pts[0], road.id, 0));

  // Walk curve, place node every UNIT metres
  var accum = 0;
  for (var i = 1; i < pts.length - 1; i++) {
    accum += BABYLON.Vector3.Distance(pts[i], pts[i - 1]);
    if (accum >= UNIT) {
      accum -= UNIT;
      nodes.push(createSnapNode(pts[i], road.id, i));
    }
  }

  // End node (always, even if last interval was short)
  nodes.push(createSnapNode(pts[pts.length - 1], road.id, pts.length - 1));

  road.nodes = nodes;
}

// ── Road placement state machine ─────────────────────
var rs = { phase:0, A:null, B:null, preview:null, markerA:null };

rs.reset = function() {
  rs.phase = 0; rs.A = null; rs.B = null;
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  if (rs.markerA) { rs.markerA.dispose(); rs.markerA = null; }
};

rs.placeMarker = function(pos) {
  var m  = BABYLON.MeshBuilder.CreateSphere("nodeA", { diameter:2.4 }, scene);
  m.position   = pos.clone(); m.position.y += 1.2;
  m.isPickable = false;
  var mat = new BABYLON.StandardMaterial("nodeAmat", scene);
  mat.diffuseColor  = new BABYLON.Color3(0.2, 0.6, 1.0);
  mat.emissiveColor = new BABYLON.Color3(0.05, 0.2, 0.5);
  m.material = mat;
  return m;
};

// Preview uses a cheap tube regardless of model state
rs.updatePreview = function(A, handle, end) {
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  if (A.subtract(end).length() < 0.5) return;
  try {
    var curve = BABYLON.Curve3.CreateQuadraticBezier(A, handle, end, 30);
    var pts   = curve.getPoints();
    for (var i = 0; i < pts.length; i++)
      pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.18;

    rs.preview = BABYLON.MeshBuilder.CreateTube("roadPreview", {
      path:pts, radius:2.5, tessellation:6
    }, scene);
    rs.preview.isPickable = false;
    var pm = new BABYLON.StandardMaterial("rpmat", scene);
    pm.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.9);
    pm.alpha        = 0.40;
    rs.preview.material = pm;
  } catch(e) { /* degenerate */ }
};

// ── Build road ────────────────────────────────────────
function buildRoad(A, handle, C) {
  var curve = BABYLON.Curve3.CreateQuadraticBezier(A, handle, C, 64);
  var pts   = curve.getPoints();

  // Lift to terrain
  for (var i = 0; i < pts.length; i++)
    pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.08;

  var rid       = roads.length;
  var instances = [];
  var supports  = [];

  if (roadModelMeshes.length > 0) {
    placeModelInstances(pts, rid, instances);
  } else {
    placeRibbonRoad(pts, rid);
  }

  placeSupports(pts, rid, supports);

  var road = {
    id:        rid,
    A:         A.clone(),
    handle:    handle.clone(),
    C:         C.clone(),
    curve:     pts,
    instances: instances,
    supports:  supports,
    nodes:     []
  };
  roads.push(road);

  generateSnapNodes(road);

  // Update length display in UI
  var totalLen = 0;
  for (var i = 1; i < pts.length; i++)
    totalLen += BABYLON.Vector3.Distance(pts[i], pts[i - 1]);
  var el = document.getElementById("road-len");
  if (el) el.textContent =
    Math.round(totalLen) + " m  (" + Math.round(totalLen / UNIT) + " units)";
}

// ── GLB instancing ────────────────────────────────────
function placeModelInstances(pts, rid, instances) {
  var accum  = 0;
  var placed = 0;
  for (var i = 1; i < pts.length; i++) {
    accum += BABYLON.Vector3.Distance(pts[i], pts[i - 1]);
    if (accum >= UNIT) {
      accum -= UNIT;
      var tang  = pts[i].subtract(pts[i - 1]).normalize();
      var angle = Math.atan2(tang.x, tang.z);
      for (var m = 0; m < roadModelMeshes.length; m++) {
        var inst = roadModelMeshes[m].createInstance("ri_" + rid + "_" + placed + "_" + m);
        inst.position   = pts[i].clone();
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
    var prev = pts[Math.max(0, i - 1)];
    var next = pts[Math.min(pts.length - 1, i + 1)];
    var tang = next.subtract(prev).normalize();
    var perp = new BABYLON.Vector3(-tang.z, 0, tang.x);
    left.push( pts[i].add(perp.scale( halfW)));
    right.push(pts[i].add(perp.scale(-halfW)));
    lk.push(   pts[i].add(perp.scale( halfW + kerbW)));
    rk.push(   pts[i].add(perp.scale(-halfW - kerbW)));
  }

  var road = BABYLON.MeshBuilder.CreateRibbon("road" + rid,
    { pathArray:[left, right], closePath:false, closeArray:false }, scene);
  road.isPickable = false;
  var rm = new BABYLON.StandardMaterial("rm" + rid, scene);
  rm.diffuseColor  = new BABYLON.Color3(0.18, 0.18, 0.18);
  rm.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
  road.material    = rm;

  var lkm = BABYLON.MeshBuilder.CreateRibbon("lk"+rid,
    { pathArray:[lk, left], closePath:false, closeArray:false }, scene);
  var rkm = BABYLON.MeshBuilder.CreateRibbon("rk"+rid,
    { pathArray:[right, rk], closePath:false, closeArray:false }, scene);
  var km = new BABYLON.StandardMaterial("km" + rid, scene);
  km.diffuseColor  = new BABYLON.Color3(0.70, 0.68, 0.63);
  km.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
  lkm.material = rkm.material = km;
  lkm.isPickable = rkm.isPickable = false;

  addCentreLine(pts, rid);
}

function addCentreLine(pts, rid) {
  var mat = new BABYLON.StandardMaterial("cl" + rid, scene);
  mat.diffuseColor  = new BABYLON.Color3(1, 1, 1);
  mat.emissiveColor = new BABYLON.Color3(0.4, 0.4, 0.4);
  for (var i = 2; i < pts.length - 2; i += 4) {
    var p   = pts[i];
    var nxt = pts[Math.min(i + 1, pts.length - 1)];
    var dir = nxt.subtract(p).normalize();
    var d   = BABYLON.MeshBuilder.CreateBox("cl" + i + "_" + rid,
      { width:0.18, depth:2.0, height:0.04 }, scene);
    d.position   = p.clone(); d.position.y += 0.14;
    d.rotation.y = Math.atan2(dir.x, dir.z);
    d.isPickable = false; d.material = mat;
  }
}

// ── Support columns ───────────────────────────────────
var COLUMN_THRESHOLD = 0.8;
var _columnSrc = null;

function getColumnSrc() {
  if (_columnSrc) return _columnSrc;
  _columnSrc = BABYLON.MeshBuilder.CreateCylinder("colSrc",
    { diameter:0.6, height:1.0, tessellation:8 }, scene);
  _columnSrc.setEnabled(false);
  _columnSrc.isPickable = false;
  var cm = new BABYLON.StandardMaterial("colmat", scene);
  cm.diffuseColor  = new BABYLON.Color3(0.55, 0.52, 0.48);
  cm.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  _columnSrc.material = cm;
  return _columnSrc;
}

function placeSupports(pts, rid, supports) {
  var src = getColumnSrc();
  for (var i = 0; i < pts.length; i += 4) {
    var roadY   = pts[i].y;
    var groundY = terrainYAt(pts[i].x, pts[i].z);
    var gap     = roadY - groundY;
    if (gap < COLUMN_THRESHOLD) continue;
    var col = src.createInstance("sup_" + rid + "_" + i);
    col.scaling.y  = gap;
    col.position.x = pts[i].x;
    col.position.y = groundY + gap / 2;
    col.position.z = pts[i].z;
    col.isPickable  = false;
    supports.push(col);
  }
}
