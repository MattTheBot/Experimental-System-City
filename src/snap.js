// ─────────────────────────────────────────────────────
//  snap.js  —  length-based road snapping + soft angle snap
//
//  No XZ grid for road placement.
//  Roads snap by LENGTH only (whole multiples of UNIT metres).
//  Angle is free; soft snap nudges toward nice angles when close.
// ─────────────────────────────────────────────────────

var UNIT           = 8;                    // metres per snap unit
var SNAP_THRESHOLD = 6 * Math.PI / 180;   // 6° soft-snap window

// Downward ray to get terrain Y at any world XZ.
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

// Given start A and raw cursor world position, returns snapped endpoint:
//   - Direction: free, soft-nudged toward nice angles
//   - Distance: nearest whole UNIT (min 1 unit)
//   - Y: terrain height at the snapped XZ point
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

  var snappedLen = Math.max(UNIT, Math.round(len / UNIT) * UNIT);
  var ex = A.x + nx * snappedLen;
  var ez = A.z + nz * snappedLen;
  return new BABYLON.Vector3(ex, terrainYAt(ex, ez), ez);
}

// Returns integer unit count for HUD display
function snapUnits(A, rawCursor) {
  var dx  = rawCursor.x - A.x;
  var dz  = rawCursor.z - A.z;
  var len = Math.sqrt(dx * dx + dz * dz);
  return Math.max(1, Math.round(len / UNIT));
}

// Candidate angles: road-relative if near a node, else cardinal+diagonal
function getCandidateAngles(fromPos) {
  if (typeof roads !== "undefined") {
    for (var i = 0; i < roads.length; i++) {
      var r = roads[i];
      if (!r.curve || r.curve.length < 2) continue;
      var pts = r.curve;
      if (BABYLON.Vector3.Distance(fromPos, r.C) < UNIT * 1.5) {
        return makeAngles(Math.atan2(
          pts[pts.length-1].x - pts[pts.length-2].x,
          pts[pts.length-1].z - pts[pts.length-2].z
        ));
      }
      if (BABYLON.Vector3.Distance(fromPos, r.A) < UNIT * 1.5) {
        return makeAngles(Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z));
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

function nearNode(pos, threshold) {
  if (typeof roads === "undefined") return null;
  for (var i = 0; i < roads.length; i++) {
    var nodes = [roads[i].A, roads[i].C];
    for (var j = 0; j < 2; j++) {
      if (nodes[j] && BABYLON.Vector3.Distance(pos, nodes[j]) < threshold)
        return nodes[j].clone();
    }
  }
  return null;
}
