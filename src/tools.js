// ─────────────────────────────────────────────────────
//  tools.js  —  tool system, registrations, debug overlay
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
  if (e.shiftKey && e.altKey && e.key.toLowerCase() === "d") {
    toggleDebug(); return;
  }
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
// Shows ALL nodes (endpoint + mid) within range.
// Highlights the single closest node within snap distance.
var _highlightedNode = null;

function updateSnapNodeVisibility(cursorPos) {
  if (typeof snapNodes === "undefined" || !snapNodes.length) return;
  var closest = null, closestDist = Infinity;

  for (var i = 0; i < snapNodes.length; i++) {
    var n    = snapNodes[i];
    var dist = BABYLON.Vector3.Distance(cursorPos, n.position);

    // Show all nodes within range
    n.mesh.isVisible = (dist < NODE_SHOW_DIST);

    // Track the closest of any type for highlighting
    if (dist < closestDist) { closestDist = dist; closest = n; }
  }

  // Reset previous yellow highlight
  if (_highlightedNode && _highlightedNode !== closest) {
    var prev = _highlightedNode;
    if (prev.isMid) {
      prev.mesh.material = _getMat("mid");
    } else {
      refreshNodeAppearance(prev);
    }
    _highlightedNode = null;
  }

  // Apply yellow highlight to closest if within snap distance
  if (closest && closestDist < NODE_SNAP_DIST) {
    closest.mesh.material = _getMat("active");
    _highlightedNode      = closest;
  }
}

function hideAllSnapNodes() {
  if (typeof snapNodes === "undefined") return;
  for (var i = 0; i < snapNodes.length; i++) {
    snapNodes[i].mesh.isVisible = false;
  }
  if (_highlightedNode) {
    var n = _highlightedNode;
    if (n.isMid) { n.mesh.material = _getMat("mid"); }
    else { refreshNodeAppearance(n); }
    _highlightedNode = null;
  }
}

// ═══════════════════════════════════════════════════
//  DEBUG OVERLAY  (Shift+Alt+D)
// ═══════════════════════════════════════════════════
var _debugVisible = false;
var _debugLines   = [];
var _MAX_LINES    = 100;

(function() {
  var _log   = console.log.bind(console);
  var _warn  = console.warn.bind(console);
  var _error = console.error.bind(console);

  function push(prefix, args) {
    var parts = Array.prototype.slice.call(args).map(function(a) {
      if (a === null)      return "null";
      if (a === undefined) return "undefined";
      if (typeof a === "object") { try { return JSON.stringify(a); } catch(e) { return String(a); } }
      return String(a);
    });
    _debugLines.push({ text: prefix + parts.join(" "), time: Date.now() });
    if (_debugLines.length > _MAX_LINES) _debugLines.shift();
    if (_debugVisible) _refreshDebug();
  }

  console.log   = function() { _log.apply(console,   arguments); push("",    arguments); };
  console.warn  = function() { _warn.apply(console,  arguments); push("⚠ ", arguments); };
  console.error = function() { _error.apply(console, arguments); push("✖ ", arguments); };

  window.addEventListener("error", function(ev) {
    push("✖ ", [ev.message + "  (" + (ev.filename||"") + ":" + ev.lineno + ")"]);
  });
})();

function _escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function _refreshDebug() {
  var stats = document.getElementById("debug-stats");
  var log   = document.getElementById("debug-log");
  if (!stats || !log) return;

  var fps   = engine ? Math.round(engine.getFps()) : "—";
  var nr    = typeof roads     !== "undefined" ? roads.length     : 0;
  var nn    = typeof snapNodes !== "undefined" ? snapNodes.length : 0;
  var phase = typeof rs        !== "undefined" ? rs.phase         : "—";
  var model = typeof roadModelMeshes !== "undefined" && roadModelMeshes.length > 0
    ? "GLB (" + roadModelMeshes.length + ")" : "ribbon";

  stats.textContent = "FPS:" + fps
    + "  Roads:" + nr + "  Nodes:" + nn
    + "  Tool:" + (activeTool||"—") + "  Phase:" + phase
    + "  Road:" + model;

  log.innerHTML = _debugLines.slice().reverse().map(function(l) {
    var isWarn  = l.text.charAt(0) === "⚠";
    var isError = l.text.charAt(0) === "✖";
    var col = isError ? "#ff7070" : isWarn ? "#ffd060" : "#aaffaa";
    return '<div style="color:' + col + ';padding:1px 0;border-bottom:0.5px solid rgba(255,255,255,0.04)">'
      + _escHtml(l.text) + '</div>';
  }).join("");
}

function toggleDebug() {
  _debugVisible = !_debugVisible;
  var panel = document.getElementById("debug-panel");
  if (!panel) return;
  panel.style.display = _debugVisible ? "flex" : "none";
  if (_debugVisible) {
    _refreshDebug();
    if (!window._dbgTimer)
      window._dbgTimer = setInterval(function() { if (_debugVisible) _refreshDebug(); }, 800);
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
    if (!hit || !hit.hit) { if (brushCircle) brushCircle.isVisible = false; return; }
    var wp = hit.pickedPoint;
    if (brushCircle) { brushCircle.isVisible = true; brushCircle.position.set(wp.x, wp.y+0.25, wp.z); }
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
    // Do not show snapDot here — no position yet
    if (snapDot) snapDot.isVisible = false;
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

    // Update all node visuals based on cursor
    updateSnapNodeVisibility(wp);

    // Compute snapped position
    var endPos;
    if (rs.phase === 0) {
      endPos = snapStart(wp);
    } else {
      endPos = snapEnd(rs.A, wp);
    }

    // Move snap dot
    if (snapDot) {
      snapDot.position.set(endPos.x, endPos.y + 0.3, endPos.z);
      snapDot.isVisible = true;
    }

    // Live length
    if (rs.phase >= 1) {
      var el = document.getElementById("road-len");
      if (el) {
        var eNode = snapEndNode(rs.A, wp);
        if (eNode) {
          el.textContent = Math.round(BABYLON.Vector3.Distance(rs.A, endPos)) + " m  [→ node]";
        } else {
          var u = snapUnits(rs.A, wp);
          el.textContent = (u * UNIT) + " m  (" + u + " u)";
        }
      }
    }

    // Preview
    if (rs.phase === 1) rs.updatePreview(rs.A, endPos, endPos);
    if (rs.phase === 2) rs.updatePreview(rs.A, rs.B, endPos);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;

    if (evt.button === 2) {
      // Finish road
      var endPos  = snapEnd(rs.A, hit.pickedPoint);
      var endNode = snapEndNode(rs.A, hit.pickedPoint);

      if (rs.phase === 1) {
        var mid = new BABYLON.Vector3(
          (rs.A.x + endPos.x) * 0.5,
          (rs.A.y + endPos.y) * 0.5,
          (rs.A.z + endPos.z) * 0.5
        );
        buildRoad(rs.A, mid, endPos, rs.startNode, endNode);
        rs.reset(); hideAllSnapNodes();
      } else if (rs.phase === 2) {
        buildRoad(rs.A, rs.B, endPos, rs.startNode, endNode);
        rs.reset(); hideAllSnapNodes();
      } else {
        rs.reset();
      }
      return;
    }

    if (evt.button === 0) {
      var wp = hit.pickedPoint;
      if (rs.phase === 0) {
        rs.A         = snapStart(wp);
        rs.startNode = snapStartNode(wp);
        rs.phase     = 1;
        if (rs.A && typeof rs.A.clone === "function")
          rs.markerA = rs.placeMarker(rs.A);
      } else if (rs.phase === 1) {
        rs.B     = wp.clone();
        rs.phase = 2;
      }
    }
  },

  onUp: function() {}
});

// ═══════════════════════════════════════════════════
//  TOOL: BULLDOZE  (stub)
// ═══════════════════════════════════════════════════
registerTool("bulldoze", {
  key:   "X",
  panel: null,
  hint:  "Bulldoze — coming in v0.5",
  onActivate:   function() { if (snapDot) snapDot.isVisible=false; hideAllSnapNodes(); },
  onDeactivate: function() {},
  onMove:       function() {},
  onDown:       function() {},
  onUp:         function() {}
});
