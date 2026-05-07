// ─────────────────────────────────────────────────────
//  roads.js
//
//  ROAD GEOMETRY: ExtrudeShapeCustom
//    A 2D cross-section profile is defined once per road
//    type. Babylon sweeps it along the bezier path,
//    producing ONE continuous mesh with no gaps or overlaps
//    on any curve.
//
//  CROSS-SECTION (viewed from the front, left to right):
//    [left kerb outer] → [left kerb top] → [left road edge]
//    → [road centre] → [right road edge]
//    → [right kerb top] → [right kerb outer]
//
//  The profile X axis maps to world-perpendicular.
//  The profile Y axis maps to world-up.
//  Babylon rotates every cross-section slice to the
//  curve tangent automatically — no manual orientation.
//
//  ROAD MARKINGS (v0.4+):
//    Centre line and edge lines will be thin flat ribbon
//    meshes placed 2mm above the road surface, sampled
//    at the same curve points. Kept separate so they can
//    have their own dashed material.
// ─────────────────────────────────────────────────────

var roads     = [];
var snapNodes = [];

// ── Road type definitions ────────────────────────────
// halfWidth:   half the drivable road width (m)
// kerbWidth:   pavement/sidewalk strip width (m)
// kerbHeight:  how much the kerb rises above road surface (m)
// Future types: just add an entry here. Everything reads these values.
var ROAD_TYPES = {
  street: {
    halfWidth:  2.5,
    kerbWidth:  0.5,
    kerbHeight: 0.12
  }
  // path:    { halfWidth:1.2, kerbWidth:0,   kerbHeight:0    }
  // highway: { halfWidth:7.0, kerbWidth:0.8, kerbHeight:0.12 }
};
var DEFAULT_ROAD_TYPE = "street";

// ── Build the 2D cross-section for a road type ────────
// Points are in the XY plane:
//   X = distance from road centre (negative = left)
//   Y = height above road base
// Babylon extrudes these perpendicular to the path tangent.
function buildProfile(td) {
  var hw = td.halfWidth;
  var kw = td.kerbWidth;
  var kh = td.kerbHeight;

  // Left to right — 8 control points
  return [
    new BABYLON.Vector3(-(hw + kw), 0,    0),   // left kerb outer base
    new BABYLON.Vector3(-(hw + kw), kh,   0),   // left kerb outer top
    new BABYLON.Vector3(-hw,        kh,   0),   // left kerb inner top
    new BABYLON.Vector3(-hw,        0,    0),   // left road edge
    new BABYLON.Vector3( hw,        0,    0),   // right road edge
    new BABYLON.Vector3( hw,        kh,   0),   // right kerb inner top
    new BABYLON.Vector3( hw + kw,   kh,   0),   // right kerb outer top
    new BABYLON.Vector3( hw + kw,   0,    0),   // right kerb outer base
  ];
}

// ── Node materials ─────────────────────────────────────
var _mats = {};
function _getMat(type) {
  if (_mats[type]) return _mats[type];
  var m = new BABYLON.StandardMaterial("sn_" + type, scene);
  m.backFaceCulling = false;
  var defs = {
    endpoint: { d:[0.15,0.70,1.0], e:[0.03,0.28,0.45] },
    mid:      { d:[0.15,0.45,0.65], e:[0.02,0.15,0.25], a:0.55 },
    junction: { d:[1.0, 0.55,0.05], e:[0.50,0.22,0.00] },
    active:   { d:[1.0, 0.95,0.10], e:[0.60,0.55,0.00] }
  };
  var def = defs[type] || defs.endpoint;
  m.diffuseColor  = new BABYLON.Color3(def.d[0],def.d[1],def.d[2]);
  m.emissiveColor = new BABYLON.Color3(def.e[0],def.e[1],def.e[2]);
  if (def.a) m.alpha = def.a;
  _mats[type] = m;
  return m;
}

var _jMat = null;
function getJMat() {
  if (_jMat) return _jMat;
  _jMat = new BABYLON.StandardMaterial("jmat", scene);
  _jMat.diffuseColor  = new BABYLON.Color3(0.17,0.17,0.17);
  _jMat.specularColor = new BABYLON.Color3(0.04,0.04,0.04);
  return _jMat;
}

// ── Shared road material (asphalt grey) ───────────────
var _roadMat = null;
function getRoadMat() {
  if (_roadMat) return _roadMat;
  _roadMat = new BABYLON.StandardMaterial("roadmat", scene);
  _roadMat.diffuseColor  = new BABYLON.Color3(0.20, 0.20, 0.20);
  _roadMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  return _roadMat;
}

// ── Nodes ──────────────────────────────────────────────
var _nc = 0;
function createNode(pos, roadId, curveIndex, isMid) {
  var mesh = BABYLON.MeshBuilder.CreateDisc("sn_"+_nc,
    { radius:isMid?0.5:1.0, tessellation:14 }, scene);
  mesh.rotation.x  = Math.PI / 2;
  mesh.position    = pos.clone(); mesh.position.y += 0.35;
  mesh.isPickable  = false; mesh.isVisible = false;
  mesh.material    = _getMat(isMid ? "mid" : "endpoint");
  var node = {
    id:"n_"+(_nc++), position:pos.clone(), roadId:roadId,
    curveIndex:curveIndex, isMid:isMid, connections:[], capMesh:null, mesh:mesh
  };
  snapNodes.push(node);
  return node;
}

function findNodeAt(pos) {
  for (var i = 0; i < snapNodes.length; i++) {
    var n = snapNodes[i];
    if (n.isMid) continue;
    if (BABYLON.Vector3.Distance(pos, n.position) < 0.1) return n;
  }
  return null;
}

function refreshNodeAppearance(node) {
  if (!node || node.isMid) return;
  if (node.connections.length >= 2) {
    node.mesh.material  = _getMat("junction");
    node.mesh.scaling.x = node.mesh.scaling.z = 1.5;
  } else {
    node.mesh.material  = _getMat("endpoint");
    node.mesh.scaling.x = node.mesh.scaling.z = 1.0;
  }
}

// ── Junction cap ───────────────────────────────────────
function buildJunctionCap(node) {
  if (node.capMesh) { node.capMesh.dispose(); node.capMesh = null; }
  if (node.connections.length < 2) return;

  var pts2D = [];
  for (var c = 0; c < node.connections.length; c++) {
    var road = null;
    for (var r = 0; r < roads.length; r++) {
      if (roads[r].id === node.connections[c]) { road = roads[r]; break; }
    }
    if (!road) continue;
    var td = ROAD_TYPES[road.typeName] || ROAD_TYPES[DEFAULT_ROAD_TYPE];
    var hw = td.halfWidth + td.kerbWidth;
    var pts = road.curve;
    var isStart = (road.startNodeId === node.id);
    var idx = isStart ? 0 : pts.length - 1;
    var tang = isStart
      ? pts[Math.min(1, pts.length-1)].subtract(pts[0]).normalize()
      : pts[idx].subtract(pts[Math.max(0, idx-1)]).normalize();
    var perp = new BABYLON.Vector3(-tang.z, 0, tang.x);
    var base = pts[idx];
    pts2D.push({ x: base.x + perp.x*hw, z: base.z + perp.z*hw });
    pts2D.push({ x: base.x - perp.x*hw, z: base.z - perp.z*hw });
  }
  pts2D.push({ x: node.position.x, z: node.position.z });
  if (pts2D.length < 3) return;

  var hull = convexHull2D(pts2D);
  if (!hull || hull.length < 3) return;

  try {
    var gy = terrainYAt(node.position.x, node.position.z) + 0.07;
    var corners = hull.map(function(p) { return new BABYLON.Vector2(p.x, p.z); });
    var poly = new BABYLON.PolygonMeshBuilder("jcap_"+node.id, corners, scene, window.earcut||null);
    var cap = poly.build(false, 0.12);
    cap.position.y = gy; cap.isPickable = false; cap.material = getJMat();
    node.capMesh = cap;
  } catch(e) { console.warn("Cap:", e.message); }
}

function convexHull2D(pts) {
  if (pts.length < 3) return pts;
  var s = 0;
  for (var i = 1; i < pts.length; i++) if (pts[i].x < pts[s].x) s = i;
  var hull = [], cur = s;
  do {
    hull.push(pts[cur]); var nxt = 0;
    for (var i = 1; i < pts.length; i++) {
      if (nxt === cur) { nxt = i; continue; }
      var ax=pts[nxt].x-pts[cur].x, az=pts[nxt].z-pts[cur].z;
      var bx=pts[i].x-pts[cur].x,   bz=pts[i].z-pts[cur].z;
      var cross = ax*bz - az*bx;
      if (cross < 0) nxt = i;
      else if (cross === 0 && (bx*bx+bz*bz) > (ax*ax+az*az)) nxt = i;
    }
    cur = nxt; if (hull.length > pts.length + 2) break;
  } while (cur !== s);
  return hull;
}

// ── Road state machine ─────────────────────────────────
var rs = { phase:0, A:null, B:null, startNode:null, preview:null, markerA:null };

rs.reset = function() {
  rs.phase=0; rs.A=null; rs.B=null; rs.startNode=null;
  if (rs.preview) { rs.preview.dispose(); rs.preview=null; }
  if (rs.markerA) { rs.markerA.dispose(); rs.markerA=null; }
};

rs.placeMarker = function(pos) {
  if (!pos || typeof pos.clone !== "function") return null;
  var m = BABYLON.MeshBuilder.CreateSphere("markerA", { diameter:2.2 }, scene);
  m.position = pos.clone(); m.position.y += 1.1; m.isPickable = false;
  var mat = new BABYLON.StandardMaterial("mAmat", scene);
  mat.diffuseColor  = new BABYLON.Color3(0.2, 0.6, 1.0);
  mat.emissiveColor = new BABYLON.Color3(0.05, 0.2, 0.5);
  m.material = mat; return m;
};

rs.updatePreview = function(A, handle, end) {
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  if (!A || !end || typeof A.subtract !== "function") return;
  if (A.subtract(end).length() < 0.5) return;
  try {
    var h = handle || A.add(end).scale(0.5);
    var curve = BABYLON.Curve3.CreateQuadraticBezier(A, h, end, 30);
    var pts = curve.getPoints();
    for (var i = 0; i < pts.length; i++)
      pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.18;
    rs.preview = BABYLON.MeshBuilder.CreateTube("roadPreview",
      { path:pts, radius:2.5, tessellation:6 }, scene);
    rs.preview.isPickable = false;
    var pm = new BABYLON.StandardMaterial("rpmat", scene);
    pm.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.9); pm.alpha = 0.38;
    rs.preview.material = pm;
  } catch(e) {}
};

// ── Build road ─────────────────────────────────────────
function buildRoad(A, handle, C, startNodeRef, endNodeRef, typeName) {
  if (!A || !C) return;
  typeName = typeName || DEFAULT_ROAD_TYPE;
  var td = ROAD_TYPES[typeName] || ROAD_TYPES[DEFAULT_ROAD_TYPE];
  var h  = handle || A.add(C).scale(0.5);

  // High-res curve: 128 points = smooth extrusion on tight curves
  var curve = BABYLON.Curve3.CreateQuadraticBezier(A, h, C, 128);
  var pts   = curve.getPoints();
  // Lift each point to terrain surface
  for (var i = 0; i < pts.length; i++)
    pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.06;

  var rid = roads.length;
  var supports = [];

  // ── Build extruded cross-section road ──────────────
  buildExtrudedRoad(pts, rid, td);
  placeSupports(pts, rid, supports);

  var road = {
    id:rid, typeName:typeName,
    A:A.clone(), handle:h.clone(), C:C.clone(),
    curve:pts, supports:supports,
    nodes:[], startNodeId:null, endNodeId:null
  };
  roads.push(road);

  // Start node
  var sNode = startNodeRef || (findNodeAt(pts[0]) || createNode(pts[0], rid, 0, false));
  sNode.connections.push(rid); refreshNodeAppearance(sNode); buildJunctionCap(sNode);
  road.startNodeId = sNode.id; road.nodes.push(sNode);

  // Mid nodes every 2 units
  var accum = 0, NS = UNIT * 2;
  for (var i = 1; i < pts.length-1; i++) {
    accum += BABYLON.Vector3.Distance(pts[i], pts[i-1]);
    if (accum >= NS) { accum -= NS; road.nodes.push(createNode(pts[i], rid, i, true)); }
  }

  // End node
  var eNode = endNodeRef || (findNodeAt(pts[pts.length-1]) || createNode(pts[pts.length-1], rid, pts.length-1, false));
  eNode.connections.push(rid); refreshNodeAppearance(eNode); buildJunctionCap(eNode);
  road.endNodeId = eNode.id; road.nodes.push(eNode);

  if (sNode.connections.length > 1) console.log("Junction @ start", sNode.id, sNode.connections);
  if (eNode.connections.length > 1) console.log("Junction @ end",   eNode.id, eNode.connections);

  var totalLen = 0;
  for (var i = 1; i < pts.length; i++)
    totalLen += BABYLON.Vector3.Distance(pts[i], pts[i-1]);
  var el = document.getElementById("road-len");
  if (el) el.textContent = Math.round(totalLen) + " m  (" + Math.round(totalLen/UNIT) + " u)";
}

// ── ExtrudeShapeCustom road builder ────────────────────
// Sweeps the 2D cross-section profile along the bezier path.
// Babylon automatically orients each cross-section slice to
// the path tangent, producing a smooth continuous mesh.
function buildExtrudedRoad(pts, rid, td) {
  var profile = buildProfile(td);

  // ExtrudeShapeCustom options:
  //   shape:           the 2D cross-section
  //   path:            the 3D curve to sweep along
  //   scaleFunction:   constant scale (1.0) at every point
  //   rotationFunction: no twist (0.0) at every point
  //   sideOrientation: DOUBLESIDE so it's visible from above and below
  var mesh = BABYLON.MeshBuilder.ExtrudeShapeCustom("road"+rid, {
    shape:            profile,
    path:             pts,
    scaleFunction:    function() { return 1.0; },
    rotationFunction: function() { return 0.0; },
    sideOrientation:  BABYLON.Mesh.DOUBLESIDE,
    updatable:        false
  }, scene);

  mesh.isPickable = false;
  mesh.material   = getRoadMat();
}

// ── Support columns ────────────────────────────────────
var COLUMN_THRESHOLD = 0.8, _colSrc = null;
function getColSrc() {
  if (_colSrc) return _colSrc;
  _colSrc = BABYLON.MeshBuilder.CreateCylinder("colSrc",
    { diameter:0.6, height:1.0, tessellation:8 }, scene);
  _colSrc.setEnabled(false); _colSrc.isPickable = false;
  var cm = new BABYLON.StandardMaterial("colmat", scene);
  cm.diffuseColor  = new BABYLON.Color3(0.55, 0.52, 0.48);
  _colSrc.material = cm;
  return _colSrc;
}
function placeSupports(pts, rid, supports) {
  var src = getColSrc();
  for (var i = 0; i < pts.length; i += 4) {
    var gap = pts[i].y - terrainYAt(pts[i].x, pts[i].z);
    if (gap < COLUMN_THRESHOLD) continue;
    var col = src.createInstance("sup_"+rid+"_"+i);
    col.scaling.y  = gap;
    col.position.x = pts[i].x;
    col.position.y = terrainYAt(pts[i].x, pts[i].z) + gap/2;
    col.position.z = pts[i].z;
    col.isPickable  = false;
    supports.push(col);
  }
}
