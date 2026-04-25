// ─────────────────────────────────────────────────────
//  tools.js  —  pluggable tool system + tool registrations
//
//  Key fix in road tool:
//    onMove and onDown now use snapEnd() for the endpoint,
//    which checks existing snap nodes FIRST before falling
//    back to length snap. This means dragging toward any
//    node on any road will hard-lock to it, overriding
//    the normal whole-unit length constraint.
// ─────────────────────────────────────────────────────

var TOOLS       = {};
var activeTool  = null;
var isShift     = false;
var isSculpting = false;

function registerTool(id, def) {
  TOOLS[id] = def;
}

function activateTool(id) {
  if (!TOOLS[id]) return;
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onDeactivate)
    TOOLS[activeTool].onDeactivate();

  activeTool = id;
  var def    = TOOLS[id];

  Object.keys(TOOLS).forEach(function(k) {
    var b = document.getElementById("btn-" + k);
    if (b) b.classList.remove("active", "active-rd");
  });
  var ab = document.getElementById("btn-" + id);
  if (ab) ab.classList.add(id === "bulldoze" ? "active-rd" : "active");

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

// ── Snap node visibility ──────────────────────────────
var _highlightedNode = null;

function updateSnapNodeVisibility(cursorPos) {
  if (typeof snapNodes === "undefined" || !snapNodes.length) return;
  var closest = null, closestDist = Infinity;

  for (var i = 0; i < snapNodes.length; i++) {
    var n    = snapNodes[i];
    var dist = BABYLON.Vector3.Distance(cursorPos, n.position);

    if (dist < NODE_SHOW_DIST) {
      n.mesh.isVisible = true;
    } else {
      n.mesh.isVisible = false;
    }

    // Track closest connectable node for highlight
    if (!n.isMid && dist < closestDist) {
      closestDist = dist;
      closest     = n;
    }
  }

  // Reset previous highlight
  if (_highlightedNode && _highlightedNode !== closest) {
    refreshNodeAppearance(_highlightedNode);
    _highlightedNode = null;
  }

  // Highlight the node we'll hard-snap to (within NODE_SNAP_DIST)
  if (closest && closestDist < NODE_SNAP_DIST) {
    closest.mesh.material = _getMat("active");
    _highlightedNode      = closest;
  }
}

function hideAllSnapNodes() {
  if (typeof snapNodes === "undefined") return;
  for (var i = 0; i < snapNodes.length; i++)
    snapNodes[i].mesh.isVisible = false;
  if (_highlightedNode) {
    refreshNodeAppearance(_highlightedNode);
    _highlightedNode = null;
  }
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
  hint:  "Road — L-click start  •  L-click curve handle  •  R-click finish",

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
    var wp = hit.pickedPoint;

    // Always update node visibility relative to cursor
    updateSnapNodeVisibility(wp);

    // Compute the snapped endpoint:
    //   Phase 0 (no road started): snapStart — hard-locks to nearby junction node
    //   Phase 1/2 (road in progress): snapEnd — checks nodes FIRST, then length snap
    var endSnap, end;
    if (rs.phase === 0) {
      endSnap = snapStart(wp);
      end     = endSnap.pos;
    } else {
      endSnap = snapEnd(rs.A, wp);
      end     = endSnap.pos;
    }

    // Move snap dot to the resolved endpoint
    if (snapDot) {
      snapDot.isVisible = true;
      snapDot.position.set(end.x, end.y + 0.3, end.z);
    }

    // Live length display
    if (rs.phase >= 1) {
      var units = snapUnits(rs.A, wp);
      // If we're hard-snapping to a node, show exact distance instead
      if (endSnap.node) {
        var exactDist = BABYLON.Vector3.Distance(rs.A, end);
        units = Math.round(exactDist / UNIT * 10) / 10; // 1 decimal
      }
      var el = document.getElementById("road-len");
      if (el) el.textContent = endSnap.node
        ? (Math.round(BABYLON.Vector3.Distance(rs.A, end)) + " m  [snapped to node]")
        : ((Math.round(snapUnits(rs.A, wp) * UNIT)) + " m  (" + snapUnits(rs.A, wp) + " units)");
    }

    // Update preview ghost mesh
    if (rs.phase === 1) rs.updatePreview(rs.A, end, end);
    if (rs.phase === 2) rs.updatePreview(rs.A, rs.B, end);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;

    if (evt.button === 2) {
      // ── RIGHT CLICK: finish road ─────────────────
      // Use snapEnd — node snap overrides length snap
      var endSnap = snapEnd(rs.A, hit.pickedPoint);
      var C       = endSnap.pos;

      if (rs.phase === 1) {
        // Straight road: midpoint as bezier handle
        var mid = new BABYLON.Vector3(
          (rs.A.x + C.x) * 0.5,
          (rs.A.y + C.y) * 0.5,
          (rs.A.z + C.z) * 0.5
        );
        buildRoad(rs.A, mid, C, rs.startNode, endSnap.node);
        rs.reset();
        hideAllSnapNodes();
      } else if (rs.phase === 2) {
        buildRoad(rs.A, rs.B, C, rs.startNode, endSnap.node);
        rs.reset();
        hideAllSnapNodes();
      } else {
        rs.reset();
      }
      return;
    }

    if (evt.button === 0) {
      // ── LEFT CLICK: place start or handle ────────
      var wp = hit.pickedPoint;

      if (rs.phase === 0) {
        // Use snapStart — locks to existing node or free placement
        var startSnap = snapStart(wp);
        rs.A          = startSnap.pos;
        rs.startNode  = startSnap.node;  // may be null for free start
        rs.phase      = 1;
        rs.markerA    = rs.placeMarker(rs.A);
      } else if (rs.phase === 1) {
        // Handle is always free-float — it shapes the curve
        rs.B     = wp.clone();
        rs.phase = 2;
      }
      // Phase 2: nothing — wait for right-click
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
