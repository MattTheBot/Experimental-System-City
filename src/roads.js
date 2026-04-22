// ─────────────────────────────────────────────────────
//  roads.js — road data, state machine, building
//
//  v0.3 road model:
//    - Endpoints snap to 8m XZ grid, Y follows terrain
//    - Angle between roads is completely free
//    - Bezier handle (B) is free-float — shapes curve
//    - Curve points follow terrain Y (road hugs ground)
//    - No plot/zone generation in v0.3 (v0.5 feature)
// ─────────────────────────────────────────────────────

var roads = []; // all placed road objects

// ── Road placement state machine ────────────────────
// rs is an object with all methods attached before engine init,
// so it's never undefined when buttons are clicked.
var rs = { phase:0, A:null, B:null, preview:null, markerA:null };

rs.reset = function() {
  rs.phase = 0; rs.A = null; rs.B = null;
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  if (rs.markerA) { rs.markerA.dispose(); rs.markerA = null; }
};

rs.placeMarker = function(pos) {
  var m   = BABYLON.MeshBuilder.CreateSphere("nodeA", { diameter:2.4 }, scene);
  m.position   = pos.clone(); m.position.y += 1.2;
  m.isPickable = false;
  var mat = new BABYLON.StandardMaterial("nodeAmat", scene);
  mat.diffuseColor  = new BABYLON.Color3(0.2, 0.6, 1.0);
  mat.emissiveColor = new BABYLON.Color3(0.05, 0.2, 0.5);
  m.material = mat;
  return m;
};

rs.updatePreview = function(A, handle, end) {
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  // Don't draw preview if start and end are the same point
  if (A.subtract(end).length() < 0.5) return;
  try {
    var curve = BABYLON.Curve3.CreateQuadraticBezier(A, handle, end, 30);
    var pts   = curve.getPoints();
    // Lift preview points to terrain surface
    for (var i = 0; i < pts.length; i++) {
      pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.12;
    }
    rs.preview = BABYLON.MeshBuilder.CreateTube("roadPreview", {
      path: pts, radius: 2.5, tessellation: 6
    }, scene);
    rs.preview.isPickable = false;
    var pm = new BABYLON.StandardMaterial("roadPreviewMat", scene);
    pm.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.9);
    pm.alpha        = 0.42;
    rs.preview.material = pm;
  } catch(e) { /* ignore degenerate curve */ }
};

// ── Build a finalised road ───────────────────────────
function buildRoad(A, handle, C) {
  // Generate bezier curve
  var curve = BABYLON.Curve3.CreateQuadraticBezier(A, handle, C, 48);
  var pts   = curve.getPoints();

  // Clamp every curve point's Y to terrain surface + small offset
  for (var i = 0; i < pts.length; i++) {
    pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.08;
  }

  // Road surface tube
  var mesh = BABYLON.MeshBuilder.CreateTube("road" + roads.length, {
    path: pts, radius: 2.5, tessellation: 8
  }, scene);
  mesh.isPickable = false;
  var rm = new BABYLON.StandardMaterial("roadmat" + roads.length, scene);
  rm.diffuseColor  = new BABYLON.Color3(0.18, 0.18, 0.18);
  rm.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
  mesh.material    = rm;

  // Centre-line dashes
  addCentreDashes(pts, roads.length);

  // Store road data (no plots in v0.3)
  roads.push({
    id:     roads.length,
    A:      A,
    handle: handle,
    C:      C,
    curve:  pts,
    mesh:   mesh
  });
}

function addCentreDashes(pts, roadId) {
  var dm = new BABYLON.StandardMaterial("dashmat" + roadId, scene);
  dm.diffuseColor  = new BABYLON.Color3(1, 1, 1);
  dm.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35);

  for (var i = 3; i < pts.length - 3; i += 5) {
    var p   = pts[i];
    var nxt = pts[Math.min(i + 1, pts.length - 1)];
    var dir = nxt.subtract(p).normalize();
    var d   = BABYLON.MeshBuilder.CreateBox("dash" + i + "_" + roadId, {
      width:0.3, depth:1.5, height:0.06
    }, scene);
    d.position   = p.clone();
    d.position.y += 0.14;
    d.rotation.y  = Math.atan2(dir.x, dir.z);
    d.isPickable  = false;
    d.material    = dm;
  }
}
