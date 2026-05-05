// ─────────────────────────────────────────────────────
//  snap.js
//
//  NODE SNAP RULES:
//    - ALL nodes (including mid-road ones) can be snapped to.
//      This prevents roads crossing without connecting.
//    - NODE_SNAP_DIST is large enough that you physically
//      cannot draw a road across another without hitting a node.
//    - Endpoint nodes (isMid=false) are preferred for junctions.
//    - Mid nodes can be snapped to start/end a road but don't
//      become junction nodes — they just enforce the connection.
// ─────────────────────────────────────────────────────

var UNIT           = 8;
var NODE_SNAP_DIST = UNIT * 0.85;     // 6.8m — large enough to block road-crossing
var NODE_SHOW_DIST = UNIT * 3.5;      // 28m — visibility radius
var ANGLE_SOFT_DEG = 6 * Math.PI / 180;

// ── Terrain height via downward ray ──────────────────
function terrainYAt(x, z) {
  var ray = new BABYLON.Ray(
    new BABYLON.Vector3(x, 500, z),
    new BABYLON.Vector3(0, -1, 0), 1000
  );
  var hit = scene.pickWithRay(ray, function(m) {
    return m.name === "terrain";
  });
  return (hit && hit.hit) ? hit.pickedPoint.y : 0;
}

// ── Find nearest snap node within threshold ───────────
// Checks ALL nodes — both endpoint and mid.
// Prefers endpoint nodes (isMid=false) if one is equally close.
function nearestNode(pos, threshold) {
  if (typeof snapNodes === "undefined") return null;
  var bestEndpoint = null, bestEndDist = threshold;
  var bestMid      = null, bestMidDist = threshold;

  for (var i = 0; i < snapNodes.length; i++) {
    var n = snapNodes[i];
    var d = BABYLON.Vector3.Distance(pos, n.position);
    if (d >= threshold) continue;

    if (!n.isMid) {
      if (d < bestEndDist) { bestEndDist = d; bestEndpoint = n; }
    } else {
      if (d < bestMidDist) { bestMidDist = d; bestMid = n; }
    }
  }

  // Prefer endpoint nodes — they become junctions
  return bestEndpoint || bestMid;
}

// ── snapStart ─────────────────────────────────────────
// Position for road start. Hard-locks to any nearby node.
function snapStart(rawCursor) {
  var node = nearestNode(rawCursor, NODE_SNAP_DIST);
  if (node) return node.position.clone();
  var p = rawCursor.clone();
  p.y   = terrainYAt(rawCursor.x, rawCursor.z);
  return p;
}

// Which node we snapped to at start (or null)
function snapStartNode(rawCursor) {
  return nearestNode(rawCursor, NODE_SNAP_DIST);
}

// ── snapEnd ───────────────────────────────────────────
// Position for road end. Node snap overrides length snap.
function snapEnd(A, rawCursor) {
  var node = nearestNode(rawCursor, NODE_SNAP_DIST);
  if (node) return node.position.clone();
  return snapLength(A, rawCursor);
}

// Which node we snapped to at end (or null)
function snapEndNode(A, rawCursor) {
  return nearestNode(rawCursor, NODE_SNAP_DIST);
}

// ── snapLength ────────────────────────────────────────
// Free direction, whole-unit distance, terrain Y.
function snapLength(A, rawCursor) {
  var dx  = rawCursor.x - A.x;
  var dz  = rawCursor.z - A.z;
  var len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.5) return A.clone();

  var nx = dx / len, nz = dz / len;

  var rawAngle  = Math.atan2(nx, nz);
  var cands     = getCandidateAngles(A);
  var bestAngle = rawAngle, bestDiff = Infinity;
  for (var i = 0; i < cands.length; i++) {
    var diff = Math.abs(angleDelta(rawAngle, cands[i]));
    if (diff < bestDiff) { bestDiff = diff; bestAngle = cands[i]; }
  }
  if (bestDiff < ANGLE_SOFT_DEG) {
    nx = Math.sin(bestAngle); nz = Math.cos(bestAngle);
  }

  var snappedLen = Math.max(UNIT, Math.round(len / UNIT) * UNIT);
  var ex = A.x + nx * snappedLen;
  var ez = A.z + nz * snappedLen;
  return new BABYLON.Vector3(ex, terrainYAt(ex, ez), ez);
}

// Integer unit count for HUD display
function snapUnits(A, rawCursor) {
  var dx  = rawCursor.x - A.x;
  var dz  = rawCursor.z - A.z;
  return Math.max(1, Math.round(Math.sqrt(dx*dx + dz*dz) / UNIT));
}

// Candidate angles for soft snap (road-relative or cardinal)
function getCandidateAngles(fromPos) {
  if (typeof snapNodes !== "undefined") {
    for (var i = 0; i < snapNodes.length; i++) {
      var n = snapNodes[i];
      if (BABYLON.Vector3.Distance(fromPos, n.position) > UNIT * 1.5) continue;
      if (typeof roads === "undefined") break;
      for (var j = 0; j < roads.length; j++) {
        if (roads[j].id !== n.roadId) continue;
        var pts = roads[j].curve;
        if (!pts || pts.length < 2) break;
        var idx  = Math.min(n.curveIndex, pts.length - 1);
        var prev = pts[Math.max(0, idx - 1)];
        var next = pts[Math.min(pts.length - 1, idx + 1)];
        return makeAngles(Math.atan2(
          next.x - prev.x, next.z - prev.z
        ));
      }
    }
  }
  return makeAngles(0);
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
