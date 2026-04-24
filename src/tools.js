// ─────────────────────────────────────────────────────
//  tools.js  —  pluggable tool system + tool registrations
//
//  Each tool is a plain object with lifecycle methods.
//  Register new tools with registerTool(id, def).
//  Key bindings declared per tool, all rebindable.
// ─────────────────────────────────────────────────────

var TOOLS      = {};
var activeTool = null;
var isShift    = false;
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

  // Update HUD buttons
  Object.keys(TOOLS).forEach(function(k) {
    var b = document.getElementById("btn-" + k);
    if (b) b.classList.remove("active", "active-rd");
  });
  var ab = document.getElementById("btn-" + id);
  if (ab) ab.classList.add(id === "bulldoze" ? "active-rd" : "active");

  // Show correct panel
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
    if (rs) rs.reset();
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

// ═══════════════════════════════════════════════════
//  TOOL: TERRAIN
// ═══════════════════════════════════════════════════
registerTool("terrain", {
  key:   "T",
  panel: "tp",
  hint:  "Terrain — hold Shift + drag to sculpt  |  R-click to sample flatten height",

  onActivate:   function() { if (snapDot) snapDot.isVisible = false; },
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
// Length display updated live in onMove
registerTool("road", {
  key:   "R",
  panel: "rp",
  hint:  "Road — L-click start  •  L-click curve handle  •  R-click finish  (R after 1st click = straight)",

  onActivate: function() {
    if (snapDot) snapDot.isVisible = true;
  },

  onDeactivate: function() {
    rs.reset();
    if (snapDot) snapDot.isVisible = false;
    document.getElementById("road-len").textContent = "—";
  },

  onMove: function(hit) {
    if (!hit || !hit.hit) {
      if (snapDot) snapDot.isVisible = false;
      return;
    }
    var wp  = hit.pickedPoint;
    var end = rs.phase > 0 ? snapLength(rs.A, wp) : wp;

    if (snapDot) {
      snapDot.isVisible = true;
      snapDot.position.set(end.x, end.y + 0.3, end.z);
    }

    // Live length readout while placing
    if (rs.phase === 1 || rs.phase === 2) {
      var units = snapUnits(rs.A, wp);
      document.getElementById("road-len").textContent =
        (units * UNIT) + " m  (" + units + " units)";
    }

    // Preview
    if (rs.phase === 1) rs.updatePreview(rs.A, end, end);
    if (rs.phase === 2) rs.updatePreview(rs.A, rs.B, end);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;

    if (evt.button === 2) {
      if (rs.phase === 1) {
        var C   = snapLength(rs.A, hit.pickedPoint);
        // Midpoint as handle = straight road
        var mid = rs.A.add(C).scale(0.5);
        buildRoad(rs.A, mid, C);
        rs.reset();
      } else if (rs.phase === 2) {
        var C = snapLength(rs.A, hit.pickedPoint);
        buildRoad(rs.A, rs.B, C);
        rs.reset();
      } else {
        rs.reset();
      }
      return;
    }

    if (evt.button === 0) {
      var sn = hit.pickedPoint;

      if (rs.phase === 0) {
        // Snap to existing node if close enough
        rs.A     = nearNode(sn, UNIT * 0.6) || sn;
        rs.A.y   = terrainYAt(rs.A.x, rs.A.z);
        rs.phase = 1;
        rs.markerA = rs.placeMarker(rs.A);
      } else if (rs.phase === 1) {
        // Free-float handle — shapes the curve, not an endpoint
        rs.B     = sn.clone();
        rs.phase = 2;
      }
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
  onActivate:   function() {},
  onDeactivate: function() {},
  onMove:       function() {},
  onDown:       function() {},
  onUp:         function() {}
});
