// ─────────────────────────────────────────────────────
//  tools.js  —  pluggable tool system + tool registrations
//
//  Snap node visibility:
//    In road mode, nodes within NODE_SHOW_DIST are shown.
//    The closest node within NODE_SNAP_DIST is highlighted.
//    All nodes are hidden when leaving road mode.
// ─────────────────────────────────────────────────────

var TOOLS        = {};
var activeTool   = null;
var isShift      = false;
var isSculpting  = false;

// How far before nodes become visible (in metres)
var NODE_SHOW_DIST = UNIT * 3;  // show nodes within 24m of cursor

function registerTool(id, def) {
  TOOLS[id] = def;
}

function activateTool(id) {
  if (!TOOLS[id]) return;

  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onDeactivate)
    TOOLS[activeTool].onDeactivate();

  activeTool = id;
  var def    = TOOLS[id];

  // Update HUD buttons
  Object.keys(TOOLS).forEach(function(k) {
    var b = document.getElementById("btn-" + k);
    if (b) b.classList.remove("active", "active-rd");
  });
  var ab = document.getElementById("btn-" + id);
  if (ab) ab.classList.add(id === "bulldoze" ? "active-rd" : "active");

  // Show correct panel, hide others
  document.querySelectorAll(".panel").forEach(function(p) {
    p.style.display = "none";
  });
  if (def.panel) {
    var el = document.getElementById(def.panel);
    if (el) el.style.display = "block";
  }

  document.getElementById("mode-lbl").textContent = id;
  document.getElementById("info").textContent     = def.hint || "";

  if (def.onActivate) def.onActivate();
}

// ── Pointer routing ──────────────────────────────────
scene.onPointerMove = function() {
  var hit = pickTerrain();
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onMove)
    TOOLS[activeTool].onMove(hit);
};

scene.onPointerDown = function(evt) {
  var hit = pickTerrain();
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onDown)
    TOOLS[activeTool].onDown(evt, hit);
};

scene.onPointerUp = function() {
  isSculpting = false;
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onUp)
    TOOLS[activeTool].onUp();
};

canvas.addEventListener("contextmenu", function(e) { e.preventDefault(); });

// ── Keyboard ─────────────────────────────────────────
document.addEventListener("keydown", function(e) {
  if (e.key === "Shift") {
    isShift = true;
    if (activeTool === "terrain" && cam) cam.detachControl(canvas);
    return;
  }
  if (e.key === "Escape") {
    if (typeof rs !== "undefined") rs.reset();
    hideAllSnapNodes();
    activateTool("terrain");
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    Object.keys(TOOLS).forEach(function(k) {
      if (TOOLS[k].key && e.key.toLowerCase() === TOOLS[k].key.toLowerCase())
        activateTool(k);
    });
  }
});

document.addEventListener("keyup", function(e) {
  if (e.key === "Shift") {
    isShift     = false;
    isSculpting = false;
    if (cam) cam.attachControl(canvas, true);
  }
});

// ── Snap node visibility helpers ─────────────────────
// Called every onMove in road mode.
// Shows nodes within NODE_SHOW_DIST, hides others.
// Highlights the closest if within NODE_SNAP_DIST.

var _lastHighlightedNode = null;

var _snNormalMat  = null;  // blue — visible but not snapping
var _snSnapMat    = null;  // bright yellow — will snap to this one

function getSnNormalMat() {
  if (_snNormalMat) return _snNormalMat;
  _snNormalMat = new BABYLON.StandardMaterial("snnormal", scene);
  _snNormalMat.diffuseColor  = new BABYLON.Color3(0.15, 0.75, 1.0);
  _snNormalMat.emissiveColor = new BABYLON.Color3(0.05, 0.35, 0.55);
  _snNormalMat.backFaceCulling = false;
  return _snNormalMat;
}

function getSnSnapMat() {
  if (_snSnapMat) return _snSnapMat;
  _snSnapMat = new BABYLON.StandardMaterial("snsnap", scene);
  _snSnapMat.diffuseColor  = new BABYLON.Color3(1.0, 0.9, 0.1);
  _snSnapMat.emissiveColor = new BABYLON.Color3(0.6, 0.5, 0.0);
  _snSnapMat.backFaceCulling = false;
  return _snSnapMat;
}

function updateSnapNodeVisibility(cursorPos) {
  if (typeof snapNodes === "undefined" || !snapNodes.length) return;

  var closest     = null;
  var closestDist = Infinity;

  for (var i = 0; i < snapNodes.length; i++) {
    var node = snapNodes[i];
    var dist = BABYLON.Vector3.Distance(cursorPos, node.position);

    if (dist < NODE_SHOW_DIST) {
      node.mesh.isVisible = true;
      node.mesh.material  = getSnNormalMat();
    } else {
      node.mesh.isVisible = false;
    }

    if (dist < closestDist) {
      closestDist = dist;
      closest     = node;
    }
  }

  // Highlight the one we'll snap to
  if (closest && closestDist < NODE_SNAP_DIST) {
    closest.mesh.material  = getSnSnapMat();
    _lastHighlightedNode   = closest;
  } else {
    _lastHighlightedNode   = null;
  }
}

function hideAllSnapNodes() {
  if (typeof snapNodes === "undefined") return;
  for (var i = 0; i < snapNodes.length; i++) {
    snapNodes[i].mesh.isVisible = false;
  }
  _lastHighlightedNode = null;
}

// ═══════════════════════════════════════════════════
//  TOOL: TERRAIN
// ═══════════════════════════════════════════════════
registerTool("terrain", {
  key:   "T",
  panel: "tp",
  hint:  "Terrain — hold Shift + drag to sculpt  |  R-click to sample flatten height",

  onActivate: function() {
    if (snapDot) snapDot.isVisible = false;
    hideAllSnapNodes();
  },

  onDeactivate: function() {
    if (brushCircle) brushCircle.isVisible = false;
    isSculpting = false;
    if (cam) cam.attachControl(canvas, true);
  },

  onMove: function(hit) {
    if (!hit || !hit.hit) {
      if (brushCircle) brushCircle.isVisible = false;
      return;
    }
    var wp = hit.pickedPoint;
    if (brushCircle) {
      brushCircle.isVisible = true;
      brushCircle.position.set(wp.x, wp.y + 0.25, wp.z);
    }
    if (isShift && isSculpting) applyBrush(wp);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;
    if (evt.button === 2) { sampleHeight(hit.pickedPoint); return; }
    if (evt.button === 0 && isShift) { isSculpting = true; applyBrush(hit.pickedPoint); }
  },

  onUp: function() { isSculpting = false; }
});

// ═══════════════════════════════════════════════════
//  TOOL: ROAD
// ═══════════════════════════════════════════════════
registerTool("road", {
  key:   "R",
  panel: "rp",
  hint:  "Road — L-click start  •  L-click curve handle  •  R-click finish  (R after 1st = straight)",

  onActivate: function() {
    if (snapDot) snapDot.isVisible = true;
  },

  onDeactivate: function() {
    rs.reset();
    if (snapDot) snapDot.isVisible = false;
    hideAllSnapNodes();
    var el = document.getElementById("road-len");
    if (el) el.textContent = "—";
  },

  onMove: function(hit) {
    if (!hit || !hit.hit) {
      if (snapDot) snapDot.isVisible = false;
      return;
    }

    var wp  = hit.pickedPoint;

    // Always update snap node visibility based on cursor world position
    updateSnapNodeVisibility(wp);

    // Compute snapped endpoint (length-snap from A if road in progress)
    var end = (rs.phase > 0) ? snapLength(rs.A, wp) : snapStart(wp);

    // Move snap dot to endpoint
    if (snapDot) {
      snapDot.isVisible = true;
      snapDot.position.set(end.x, end.y + 0.3, end.z);
    }

    // Live length display when a road is in progress
    if (rs.phase >= 1) {
      var units = snapUnits(rs.A, wp);
      var el    = document.getElementById("road-len");
      if (el) el.textContent = (units * UNIT) + " m  (" + units + " units)";
    }

    // Update preview mesh
    if (rs.phase === 1) rs.updatePreview(rs.A, end, end);
    if (rs.phase === 2) rs.updatePreview(rs.A, rs.B, end);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;

    if (evt.button === 2) {
      // Right-click: finish road
      var C = snapLength(rs.A, hit.pickedPoint);

      if (rs.phase === 1) {
        // Straight road: midpoint as bezier handle
        var mid = rs.A.add(C).scale(0.5);
        buildRoad(rs.A, mid, C);
        rs.reset();
        hideAllSnapNodes();
      } else if (rs.phase === 2) {
        buildRoad(rs.A, rs.B, C);
        rs.reset();
        hideAllSnapNodes();
      } else {
        rs.reset();
      }
      return;
    }

    if (evt.button === 0) {
      var wp = hit.pickedPoint;

      if (rs.phase === 0) {
        // Start: snap to existing node if close, else free placement
        rs.A     = snapStart(wp);
        rs.phase = 1;
        rs.markerA = rs.placeMarker(rs.A);
      } else if (rs.phase === 1) {
        // Handle: free float (shapes the curve, not an endpoint)
        rs.B     = wp.clone();
        rs.phase = 2;
      }
      // phase 2: wait for right-click
    }
  },

  onUp: function() {}
});

// ═══════════════════════════════════════════════════
//  TOOL: BULLDOZE  (stub — v0.5)
// ═══════════════════════════════════════════════════
registerTool("bulldoze", {
  key:   "X",
  panel: null,
  hint:  "Bulldoze — coming in v0.5",
  onActivate:   function() { hideAllSnapNodes(); },
  onDeactivate: function() {},
  onMove:       function() {},
  onDown:       function() {},
  onUp:         function() {}
});
