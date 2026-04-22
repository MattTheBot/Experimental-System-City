// ─────────────────────────────────────────────────────
//  tools.js — pluggable tool system
//
//  Each tool is a plain object registered with registerTool().
//  Tools can be added by mods without touching this file.
//
//  Tool definition:
//  {
//    key:          string  — keyboard shortcut (single char)
//    label:        string  — HUD display name
//    panel:        string  — panel element ID to show, or null
//    hint:         string  — info bar text
//    onActivate:   fn()    — called when tool is selected
//    onDeactivate: fn()    — called when another tool is selected
//    onMove:       fn(hit) — called on every pointer move
//    onDown:       fn(evt, hit) — called on pointer down
//    onUp:         fn()    — called on pointer up
//  }
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

  // Deactivate current tool
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onDeactivate) {
    TOOLS[activeTool].onDeactivate();
  }

  activeTool = id;
  var def    = TOOLS[id];

  // Update HUD button states
  Object.keys(TOOLS).forEach(function(k) {
    var b = document.getElementById("btn-" + k);
    if (b) b.classList.remove("active", "active-rd");
  });
  var ab = document.getElementById("btn-" + id);
  if (ab) ab.classList.add(id === "bulldoze" ? "active-rd" : "active");

  // Show correct side panel, hide all others
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
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onMove) {
    TOOLS[activeTool].onMove(hit);
  }
};

scene.onPointerDown = function(evt) {
  var hit = pickTerrain();
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onDown) {
    TOOLS[activeTool].onDown(evt, hit);
  }
};

scene.onPointerUp = function() {
  isSculpting = false;
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onUp) {
    TOOLS[activeTool].onUp();
  }
};

canvas.addEventListener("contextmenu", function(e) { e.preventDefault(); });

// ── Keyboard ─────────────────────────────────────────
document.addEventListener("keydown", function(e) {
  if (e.key === "Shift") {
    isShift = true;
    // Detach camera so Shift+drag sculpts instead of orbiting
    if (activeTool === "terrain" && cam) cam.detachControl(canvas);
    return;
  }
  if (e.key === "Escape") {
    if (rs) rs.reset();
    activateTool("terrain");
    return;
  }
  // Check all registered tool key bindings
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    Object.keys(TOOLS).forEach(function(k) {
      var def = TOOLS[k];
      if (def.key && e.key.toLowerCase() === def.key.toLowerCase()) {
        activateTool(k);
      }
    });
  }
});

document.addEventListener("keyup", function(e) {
  if (e.key === "Shift") {
    isShift     = false;
    isSculpting = false;
    if (cam) cam.attachControl(canvas, true); // restore camera
  }
});

// ═════════════════════════════════════════════════════
//  TOOL REGISTRATIONS
//  Add new tools here, or from a mod file loaded after tools.js
// ═════════════════════════════════════════════════════

// ── Terrain tool ─────────────────────────────────────
registerTool("terrain", {
  key:   "T",
  label: "Terrain",
  panel: "tp",
  hint:  "Terrain — hold Shift + drag to sculpt  |  R-click to sample height for flatten",

  onActivate: function() {
    if (snapDot)    snapDot.isVisible    = false;
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
    if (evt.button === 2) {
      // Right-click: sample terrain height as flatten target
      sampleHeight(hit.pickedPoint);
      return;
    }
    if (evt.button === 0 && isShift) {
      isSculpting = true;
      applyBrush(hit.pickedPoint);
    }
  },

  onUp: function() { isSculpting = false; }
});

// ── Road tool ─────────────────────────────────────────
registerTool("road", {
  key:   "R",
  label: "Road",
  panel: "rp",
  hint:  "Road — L-click start  •  L-click curve handle  •  R-click finish  (R after 1st = straight)",

  onActivate: function() {
    if (snapDot) snapDot.isVisible = true;
  },
  onDeactivate: function() {
    rs.reset();
    if (snapDot) snapDot.isVisible = false;
  },

  onMove: function(hit) {
    if (!hit || !hit.hit) {
      if (snapDot) snapDot.isVisible = false;
      return;
    }
    var wp = hit.pickedPoint;
    var sn = snapXZ(wp);
    if (snapDot) {
      snapDot.isVisible = true;
      snapDot.position.set(sn.x, sn.y + 0.3, sn.z);
    }
    if (rs.phase === 1) rs.updatePreview(rs.A, sn, sn);
    if (rs.phase === 2) rs.updatePreview(rs.A, rs.B, sn);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;

    if (evt.button === 2) {
      // Right-click: finish road
      var C = snapXZ(hit.pickedPoint);
      if (rs.phase === 1) {
        // Straight road: midpoint = bezier handle → perfectly straight
        var mid = new BABYLON.Vector3(
          (rs.A.x + C.x) * 0.5,
          (rs.A.y + C.y) * 0.5,
          (rs.A.z + C.z) * 0.5
        );
        buildRoad(rs.A, mid, C);
        rs.reset();
      } else if (rs.phase === 2) {
        // Curved road: use stored handle
        buildRoad(rs.A, rs.B, C);
        rs.reset();
      } else {
        rs.reset(); // cancel if idle
      }
      return;
    }

    if (evt.button === 0) {
      var sn = snapXZ(hit.pickedPoint);
      if (rs.phase === 0) {
        // Phase 0→1: place start node (snap to existing node if close)
        rs.A     = nearNode(sn, 7) || sn;
        rs.phase = 1;
        rs.markerA = rs.placeMarker(rs.A);
      } else if (rs.phase === 1) {
        // Phase 1→2: place bezier handle (free float, not grid-snapped)
        rs.B     = hit.pickedPoint.clone();
        rs.phase = 2;
      }
      // Phase 2: nothing — wait for right-click to finish
    }
  },

  onUp: function() {}
});

// ── Bulldoze tool (placeholder — v0.5 feature) ───────
registerTool("bulldoze", {
  key:   "X",
  label: "Bulldoze",
  panel: null,
  hint:  "Bulldoze — coming in v0.5",
  onActivate:   function() {},
  onDeactivate: function() {},
  onMove:       function() {},
  onDown:       function() {},
  onUp:         function() {}
});
