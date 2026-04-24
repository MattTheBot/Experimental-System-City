// ─────────────────────────────────────────────────────
//  snap.js  —  snap node lookup + length snap + soft angle snap
//
//  snapNodes[] is declared in roads.js and populated when
//  roads are built. snap.js only reads it — never writes.
// ─────────────────────────────────────────────────────

var UNIT           = 8;                    // 1 road unit = 8 metres
var SNAP_THRESHOLD = 6 * Math.PI / 180;   // 6° soft-angle snap window
var NODE_SNAP_DIST = UNIT * 0.6;          // within this → lock to snap node

// ── Terrain height at any world XZ ──────────────────
function terrainYAt(x, z) {
  var ray = new BABYLON.Ray(
    new BABYLON.Vector3(x, 500, z),
    new BABYLON.Vector3(0, -1, 0),
    1000
  );
  var hit = scene.pickWithRay(ray, function(m) {
    return m.name === "terrain";
  });
  return (hit && hit.hit) ? hit.pickedPoint.y : 0;
}

// ── Nearest snap node within threshold ──────────────
// Returns the snap node object, or null.
function nearestSnapNode(pos, threshold) {
  if (typeof snapNodes === "undefined" || !snapNodes.length) return null;
  var best = null, bestDist = Infinity;
  for (var i = 0; i < snapNodes.length; i++) {
    var d = BABYLON.Vector3.Distance(pos, snapNodes[i].position);
    if (d < threshold && d < bestDist) {
      bestDist = d;
      best     = snapNodes[i];
    }
  }
  return best;
}

// ── snapStart ────────────────────────────────────────
// For placing a road's START POINT.
// If near a snap node: lock to it (roads connect at whole-unit intervals).
// Otherwise: free placement at cursor Y.
function snapStart(rawCursor) {
  var node = nearestSnapNode(rawCursor, NODE_SNAP_DIST);
  if (node) return node.position.clone();
  // Free placement — just use terrain height
  rawCursor.y = terrainYAt(rawCursor.x, rawCursor.z);
  return rawCursor.clone();
}

// ── snapLength ───────────────────────────────────────
// For the road's END POINT (right-click to finish).
// Direction: free, soft-nudged toward nice angles.
// Distance from A: snapped to nearest whole UNIT.
// Y: terrain height at snapped XZ.
function snapLength(A, rawCursor) {
  var dx  = rawCursor.x - A.x;
  var dz  = rawCursor.z - A.z;
  var len = Math.sqrt(dx * dx + dz * dz);

  if (len < 0.5) return A.clone();

  var nx = dx / len;
  var nz = dz / len;

  // Soft angle snap
  var rawAngle  = Math.atan2(nx, nz);
  var cands     = getCandidateAngles(A);
  var bestAngle = rawAngle;
  var bestDiff  = Infinity;
  for (var i = 0; i < cands.length; i++) {
    var diff = Math.abs(angleDelta(rawAngle, cands[i]));
    if (diff < bestDiff) { bestDiff = diff; bestAngle = cands[i]; }
  }
  if (bestDiff < SNAP_THRESHOLD) {
    nx = Math.sin(bestAngle);
    nz = Math.cos(bestAngle);
  }

  // Length snap — nearest whole UNIT, min 1 unit
  var snappedLen = Math.max(UNIT, Math.round(len / UNIT) * UNIT);
  var ex = A.x + nx * snappedLen;
  var ez = A.z + nz * snappedLen;
  return new BABYLON.Vector3(ex, terrainYAt(ex, ez), ez);
}

// Integer unit count for HUD display
function snapUnits(A, rawCursor) {
  var dx  = rawCursor.x - A.x;
  var dz  = rawCursor.z - A.z;
  var len = Math.sqrt(dx * dx + dz * dz);
  return Math.max(1, Math.round(len / UNIT));
}

// ── Candidate snap angles ────────────────────────────
// Road-relative (multiples of 45° from nearest connected road)
// or cardinal if no road is nearby.
function getCandidateAngles(fromPos) {
  if (typeof snapNodes !== "undefined") {
    var node = nearestSnapNode(fromPos, UNIT * 1.5);
    if (node && node.roadId !== undefined) {
      var road = getRoadById(node.roadId);
      if (road && road.curve && road.curve.length >= 2) {
        var pts  = road.curve;
        var idx  = node.indexAlongRoad;
        var prev = pts[Math.max(0, idx - 1)];
        var next = pts[Math.min(pts.length - 1, idx + 1)];
        var tang = next.subtract(prev).normalize();
        return makeAngles(Math.atan2(tang.x, tang.z));
      }
    }
  }
  return makeAngles(0); // cardinal + diagonal fallback
}

function makeAngles(base) {
  var out = [];
  for (var k = 0; k < 8; k++) out.push(base + k * Math.PI / 4);
  return out;
}

function angleDelta(from, to) {
  var d = to - from;
  while (d >  Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Helper: get road by ID (roads[] declared in roads.js)
function getRoadById(id) {
  if (typeof roads === "undefined") return null;
  for (var i = 0; i < roads.length; i++) {
    if (roads[i].id === id) return roads[i];
  }
  return null;
}
