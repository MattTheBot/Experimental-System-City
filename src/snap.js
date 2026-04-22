// ─────────────────────────────────────────────────────
//  snap.js — grid snapping + terrain height sampling
//
//  Road snap model (CS2-style):
//    - Endpoints snap to 8m XZ grid (clean lengths)
//    - Y always follows the actual terrain surface
//    - Angle between roads is completely free
//    - Bezier handle B is free-float (shapes curve, not an endpoint)
// ─────────────────────────────────────────────────────

var GRID = 8; // metres per grid cell (XZ only — Y is terrain-sampled)

// Cast a ray straight down to get terrain height at any world XZ position.
// Much more accurate than nearest-vertex lookup.
function terrainYAt(x, z) {
  var ray = new BABYLON.Ray(
    new BABYLON.Vector3(x, 500, z),
    new BABYLON.Vector3(0, -1, 0),
    1000
  );
  var hit = scene.pickWithRay(ray, function(m) { return m.name === "terrain"; });
  return (hit && hit.hit) ? hit.pickedPoint.y : 0;
}

// Snap a world position to the nearest XZ grid intersection.
// Y is overridden with the actual terrain height at that grid point.
function snapXZ(p) {
  var sx = Math.round(p.x / GRID) * GRID;
  var sz = Math.round(p.z / GRID) * GRID;
  return new BABYLON.Vector3(sx, terrainYAt(sx, sz), sz);
}

// Find nearest existing road endpoint within threshold metres.
// Returns a clone of that node's position, or null.
function nearNode(pos, threshold) {
  for (var i = 0; i < roads.length; i++) {
    var nodes = [roads[i].A, roads[i].C];
    for (var j = 0; j < 2; j++) {
      if (nodes[j] && BABYLON.Vector3.Distance(pos, nodes[j]) < threshold) {
        return nodes[j].clone();
      }
    }
  }
  return null;
}
