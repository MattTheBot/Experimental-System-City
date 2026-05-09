// ─────────────────────────────────────────────────────
//  tools.js
//
//  Camera is restricted to middle+right mouse in core.js.
//  No cam.detachControl/attachControl anywhere — that was
//  breaking Babylon's pointer state and preventing Shift
//  from working.  Left mouse is always free for tools.
// ─────────────────────────────────────────────────────

var TOOLS={}, activeTool=null, isShift=false, isSculpting=false;

function registerTool(id,def){ TOOLS[id]=def; }

function activateTool(id){
  if(!TOOLS[id])return;
  if(activeTool&&TOOLS[activeTool]&&TOOLS[activeTool].onDeactivate) TOOLS[activeTool].onDeactivate();
  activeTool=id;
  var def=TOOLS[id];
  Object.keys(TOOLS).forEach(function(k){var b=document.getElementById("btn-"+k);if(b)b.classList.remove("active","active-rd");});
  var ab=document.getElementById("btn-"+id);
  if(ab)ab.classList.add(id==="bulldoze"?"active-rd":"active");
  document.querySelectorAll(".panel").forEach(function(p){p.style.display="none";});
  if(def.panel){var el=document.getElementById(def.panel);if(el)el.style.display="block";}
  document.getElementById("mode-lbl").textContent=id;
  document.getElementById("info").textContent=def.hint||"";
  if(def.onActivate)def.onActivate();
}

// ── Pointer routing ───────────────────────────────────
scene.onPointerMove=function(){var hit=pickTerrain();if(activeTool&&TOOLS[activeTool]&&TOOLS[activeTool].onMove)TOOLS[activeTool].onMove(hit);};
scene.onPointerDown=function(evt){var hit=pickTerrain();if(activeTool&&TOOLS[activeTool]&&TOOLS[activeTool].onDown)TOOLS[activeTool].onDown(evt,hit);};
scene.onPointerUp=function(){isSculpting=false;if(activeTool&&TOOLS[activeTool]&&TOOLS[activeTool].onUp)TOOLS[activeTool].onUp();};
canvas.addEventListener("contextmenu",function(e){e.preventDefault();});

// ── Keyboard ──────────────────────────────────────────
document.addEventListener("keydown",function(e){
  if(e.shiftKey&&e.altKey&&e.key.toLowerCase()==="d"){toggleDebug();return;}
  if(e.key==="Shift"){isShift=true;return;}
  if(e.key==="Escape"){if(typeof rs!=="undefined")rs.reset();hideAllSnapNodes();activateTool("terrain");return;}
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey){
    Object.keys(TOOLS).forEach(function(k){if(TOOLS[k].key&&e.key.toLowerCase()===TOOLS[k].key.toLowerCase())activateTool(k);});
  }
});
document.addEventListener("keyup",function(e){if(e.key==="Shift"){isShift=false;isSculpting=false;}});

// ── Snap node visibility ──────────────────────────────
var _highlightedNode=null;

function updateSnapNodeVisibility(cursorPos){
  if(typeof snapNodes==="undefined"||!snapNodes.length)return;
  var closest=null,closestDist=Infinity;
  for(var i=0;i<snapNodes.length;i++){
    var n=snapNodes[i],dist=BABYLON.Vector3.Distance(cursorPos,n.position);
    n.mesh.isVisible=(dist<NODE_SHOW_DIST);
    if(dist<closestDist){closestDist=dist;closest=n;}
  }
  if(_highlightedNode&&_highlightedNode!==closest){refreshNodeAppearance(_highlightedNode);_highlightedNode=null;}
  if(closest&&closestDist<NODE_SNAP_DIST){closest.mesh.material=_getMat("active");_highlightedNode=closest;}
}

function hideAllSnapNodes(){
  if(typeof snapNodes==="undefined")return;
  for(var i=0;i<snapNodes.length;i++)snapNodes[i].mesh.isVisible=false;
  if(_highlightedNode){refreshNodeAppearance(_highlightedNode);_highlightedNode=null;}
}

// ═══════════════════════════════════════════════════
//  DEBUG  (Shift+Alt+D)
// ═══════════════════════════════════════════════════
var _dbgVisible=false,_dbgLines=[],_MAX_LINES=100;
(function(){
  var _l=console.log.bind(console),_w=console.warn.bind(console),_e=console.error.bind(console);
  function push(prefix,args){
    var text=prefix+Array.prototype.slice.call(args).map(function(a){
      if(a===null)return"null";if(a===undefined)return"undefined";
      if(typeof a==="object"){try{return JSON.stringify(a);}catch(e){return String(a);}}
      return String(a);
    }).join(" ");
    _dbgLines.push({text:text});if(_dbgLines.length>_MAX_LINES)_dbgLines.shift();
    if(_dbgVisible)_refreshDebug();
  }
  console.log=function(){_l.apply(console,arguments);push("",arguments);};
  console.warn=function(){_w.apply(console,arguments);push("⚠ ",arguments);};
  console.error=function(){_e.apply(console,arguments);push("✖ ",arguments);};
  window.addEventListener("error",function(ev){push("✖ ",[ev.message+" ("+ev.lineno+")"]);});
})();

function _esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function _refreshDebug(){
  var stats=document.getElementById("debug-stats"),log=document.getElementById("debug-log");
  if(!stats||!log)return;
  var fps=engine?Math.round(engine.getFps()):"—";
  var nr=typeof roads!=="undefined"?roads.length:0;
  var nn=typeof snapNodes!=="undefined"?snapNodes.length:0;
  stats.textContent="FPS:"+fps+" Roads:"+nr+" Nodes:"+nn+" Tool:"+(activeTool||"—")+" Phase:"+(typeof rs!=="undefined"?rs.phase:"—");
  log.innerHTML=_dbgLines.slice().reverse().map(function(l){
    var w=l.text.charAt(0)==="⚠",er=l.text.charAt(0)==="✖";
    var col=er?"#ff7070":w?"#ffd060":"#aaffaa";
    return'<div style="color:'+col+';padding:1px 0;border-bottom:0.5px solid rgba(255,255,255,0.04)">'+_esc(l.text)+'</div>';
  }).join("");
}
function toggleDebug(){
  _dbgVisible=!_dbgVisible;
  var p=document.getElementById("debug-panel");
  if(!p)return;
  p.style.display=_dbgVisible?"flex":"none";
  if(_dbgVisible){_refreshDebug();if(!window._dbgTimer)window._dbgTimer=setInterval(function(){if(_dbgVisible)_refreshDebug();},800);}
}

// ═══════════════════════════════════════════════════
//  TOOL: TERRAIN
// ═══════════════════════════════════════════════════
registerTool("terrain",{
  key:"T", panel:"tp",
  hint:"Terrain — hold Shift + drag to sculpt  |  R-click to sample flatten height",
  onActivate:function(){if(snapDot)snapDot.isVisible=false;hideAllSnapNodes();},
  onDeactivate:function(){if(brushCircle)brushCircle.isVisible=false;isSculpting=false;},
  onMove:function(hit){
    if(!hit||!hit.hit){if(brushCircle)brushCircle.isVisible=false;return;}
    var wp=hit.pickedPoint;
    if(brushCircle){brushCircle.isVisible=true;brushCircle.position.set(wp.x,wp.y+0.25,wp.z);}
    // Sculpt while Shift held and mouse button down
    if(isShift&&isSculpting)applyBrush(wp);
  },
  onDown:function(evt,hit){
    if(!hit||!hit.hit)return;
    if(evt.button===2){sampleHeight(hit.pickedPoint);return;}
    // Left click + Shift = start sculpting
    if(evt.button===0&&isShift){isSculpting=true;applyBrush(hit.pickedPoint);}
  },
  onUp:function(){isSculpting=false;}
});

// ═══════════════════════════════════════════════════
//  TOOL: ROAD
// ═══════════════════════════════════════════════════
registerTool("road",{
  key:"R", panel:"rp",
  hint:"Road — L-click start  •  L-click curve handle  •  R-click finish",
  onActivate:function(){if(snapDot)snapDot.isVisible=false;},
  onDeactivate:function(){
    rs.reset();if(snapDot)snapDot.isVisible=false;hideAllSnapNodes();
    var el=document.getElementById("road-len");if(el)el.textContent="—";
  },
  onMove:function(hit){
    if(!hit||!hit.hit){if(snapDot)snapDot.isVisible=false;return;}
    var wp=hit.pickedPoint;
    updateSnapNodeVisibility(wp);
    var endPos=rs.phase===0?snapStart(wp):snapEnd(rs.A,wp);
    if(snapDot){snapDot.position.set(endPos.x,endPos.y+0.3,endPos.z);snapDot.isVisible=true;}
    if(rs.phase>=1){
      var el=document.getElementById("road-len");
      if(el){
        var eNode=snapEndNode(rs.A,wp);
        if(eNode){el.textContent=Math.round(BABYLON.Vector3.Distance(rs.A,endPos))+" m  [→ node]";}
        else{var u=snapUnits(rs.A,wp);el.textContent=(u*UNIT)+" m  ("+u+" u)";}
      }
    }
    if(rs.phase===1)rs.updatePreview(rs.A,endPos,endPos);
    if(rs.phase===2)rs.updatePreview(rs.A,rs.B,endPos);
  },
  onDown:function(evt,hit){
    if(!hit||!hit.hit)return;
    if(evt.button===2){
      var endPos=snapEnd(rs.A,hit.pickedPoint),endNode=snapEndNode(rs.A,hit.pickedPoint);
      if(rs.phase===1){buildRoad(rs.A,rs.A.add(endPos).scale(0.5),endPos,rs.startNode,endNode);rs.reset();hideAllSnapNodes();}
      else if(rs.phase===2){buildRoad(rs.A,rs.B,endPos,rs.startNode,endNode);rs.reset();hideAllSnapNodes();}
      else rs.reset();
      return;
    }
    if(evt.button===0){
      var wp=hit.pickedPoint;
      if(rs.phase===0){rs.A=snapStart(wp);rs.startNode=snapStartNode(wp);rs.phase=1;if(rs.A&&typeof rs.A.clone==="function")rs.markerA=rs.placeMarker(rs.A);}
      else if(rs.phase===1){rs.B=wp.clone();rs.phase=2;}
    }
  },
  onUp:function(){}
});

// ═══════════════════════════════════════════════════
//  TOOL: BULLDOZE (stub)
// ═══════════════════════════════════════════════════
registerTool("bulldoze",{
  key:"X",panel:null,hint:"Bulldoze — coming in v0.5",
  onActivate:function(){if(snapDot)snapDot.isVisible=false;hideAllSnapNodes();},
  onDeactivate:function(){},onMove:function(){},onDown:function(){},onUp:function(){}
});
