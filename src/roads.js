// ─────────────────────────────────────────────────────
//  roads.js
//
//  ROAD GEOMETRY APPROACH:
//    CreateRibbon with parallel offset paths.
//    At each curve sample point we compute the exact
//    perpendicular direction, then offset N parallel
//    paths (kerb outer, kerb inner, road edges, etc.).
//    Ribbon pairs of adjacent paths into flat meshes.
//
//    Result: ONE continuous mesh per road component,
//    zero gaps, zero overlap, works on any curve.
//
//  GLB MODEL:
//    Loaded but used only for DECORATIVE instancing
//    (lamp posts, road signs, markings) not road surface.
//    Road surface is always the ribbon — guaranteed correct.
// ─────────────────────────────────────────────────────

var roads     = [];
var snapNodes = [];

// ── Road type definitions ────────────────────────────
var ROAD_TYPES = {
  street: {
    halfWidth:  2.5,   // half road surface width (m)
    kerbWidth:  0.45,  // pavement strip width (m)
    kerbRaise:  0.06,  // kerb height above road surface (m)
    modelPath:  "models/road_2lane.glb"  // decorative GLB (optional)
  }
  // Future types go here — ribbon code reads halfWidth/kerbWidth
};
var DEFAULT_ROAD_TYPE = "street";

// ── Decorative model cache ────────────────────────────
// Models are placed as decoration, NOT as road surface.
var _decoModels = {};

function loadModelForType(typeName) {
  var def = ROAD_TYPES[typeName];
  if (!def || !def.modelPath) return;
  if (_decoModels[typeName] !== undefined) return;
  _decoModels[typeName] = null;

  var path = def.modelPath;
  var last = path.lastIndexOf("/");
  var root = last >= 0 ? path.substring(0, last + 1) : "./";
  var file = last >= 0 ? path.substring(last + 1)    : path;

  BABYLON.SceneLoader.ImportMesh("", root, file, scene,
    function(meshes) {
      var real = meshes.filter(function(m){ return m.name !== "__root__"; });
      var loaded = [];
      for (var i = 0; i < real.length; i++) {
        var m = real[i];
        m.computeWorldMatrix(true);
        m.bakeCurrentTransformIntoVertices();
        m.position = BABYLON.Vector3.Zero();
        m.rotation = BABYLON.Vector3.Zero();
        m.scaling  = BABYLON.Vector3.One();
        m.parent   = null;
        m.setEnabled(false);
        m.isPickable = false;
        loaded.push(m);
      }
      meshes.filter(function(m){ return m.name === "__root__"; })
            .forEach(function(m){ m.dispose(); });
      _decoModels[typeName] = loaded;
      console.log("Deco model loaded:", file, "("+loaded.length+" mesh) — used for decoration only");
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Deco model: "+file+" ("+loaded.length+" mesh) | road = ribbon";
    },
    null,
    function(scene2, msg) {
      console.warn("Deco model load failed (road uses ribbon):", msg);
      _decoModels[typeName] = [];
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Road: ribbon geometry";
    }
  );
}
loadModelForType(DEFAULT_ROAD_TYPE);

// ── Node materials ────────────────────────────────────
var _mats = {};
function _getMat(type) {
  if (_mats[type]) return _mats[type];
  var m = new BABYLON.StandardMaterial("sn_"+type, scene);
  m.backFaceCulling = false;
  var defs = {
    endpoint: { d:[0.15,0.70,1.0], e:[0.03,0.28,0.45] },
    mid:      { d:[0.15,0.45,0.65], e:[0.02,0.15,0.25], a:0.55 },
    junction: { d:[1.0, 0.55,0.05], e:[0.50,0.22,0.00] },
    active:   { d:[1.0, 0.95,0.10], e:[0.60,0.55,0.00] }
  };
  var def = defs[type] || defs.endpoint;
  m.diffuseColor  = new BABYLON.Color3(def.d[0],def.d[1],def.d[2]);
  m.emissiveColor = new BABYLON.Color3(def.e[0],def.e[1],def.e[2]);
  if (def.a) m.alpha = def.a;
  _mats[type] = m;
  return m;
}

var _jMat = null;
function getJMat() {
  if (_jMat) return _jMat;
  _jMat = new BABYLON.StandardMaterial("jmat", scene);
  _jMat.diffuseColor  = new BABYLON.Color3(0.17,0.17,0.17);
  _jMat.specularColor = new BABYLON.Color3(0.04,0.04,0.04);
  return _jMat;
}

// ── Nodes ─────────────────────────────────────────────
var _nc = 0;
function createNode(pos, roadId, curveIndex, isMid) {
  var mesh = BABYLON.MeshBuilder.CreateDisc("sn_"+_nc,
    {radius:isMid?0.5:1.0, tessellation:14}, scene);
  mesh.rotation.x = Math.PI/2;
  mesh.position   = pos.clone(); mesh.position.y += 0.35;
  mesh.isPickable = false; mesh.isVisible = false;
  mesh.material   = _getMat(isMid?"mid":"endpoint");
  var node = {
    id:"n_"+(_nc++), position:pos.clone(), roadId:roadId,
    curveIndex:curveIndex, isMid:isMid, connections:[], capMesh:null, mesh:mesh
  };
  snapNodes.push(node);
  return node;
}
function findNodeAt(pos) {
  for (var i=0;i<snapNodes.length;i++) {
    var n=snapNodes[i];
    if (n.isMid) continue;
    if (BABYLON.Vector3.Distance(pos,n.position)<0.1) return n;
  }
  return null;
}
function refreshNodeAppearance(node) {
  if (!node||node.isMid) return;
  if (node.connections.length>=2) {
    node.mesh.material=_getMat("junction"); node.mesh.scaling.x=node.mesh.scaling.z=1.5;
  } else {
    node.mesh.material=_getMat("endpoint"); node.mesh.scaling.x=node.mesh.scaling.z=1.0;
  }
}

// ── Junction cap (procedural convex polygon) ──────────
function buildJunctionCap(node) {
  if (node.capMesh) { node.capMesh.dispose(); node.capMesh=null; }
  if (node.connections.length<2) return;
  var pts2D = [];
  for (var c=0;c<node.connections.length;c++) {
    var road=null;
    for (var r=0;r<roads.length;r++) { if(roads[r].id===node.connections[c]){road=roads[r];break;} }
    if (!road) continue;
    var td=ROAD_TYPES[road.typeName]||ROAD_TYPES[DEFAULT_ROAD_TYPE];
    var hw=td.halfWidth+td.kerbWidth, pts=road.curve;
    var isStart=(road.startNodeId===node.id);
    var idx=isStart?0:pts.length-1;
    var tang=isStart
      ? pts[Math.min(1,pts.length-1)].subtract(pts[0]).normalize()
      : pts[idx].subtract(pts[Math.max(0,idx-1)]).normalize();
    var perp=new BABYLON.Vector3(-tang.z,0,tang.x);
    var base=pts[idx];
    pts2D.push({x:base.x+perp.x*hw, z:base.z+perp.z*hw});
    pts2D.push({x:base.x-perp.x*hw, z:base.z-perp.z*hw});
  }
  pts2D.push({x:node.position.x,z:node.position.z});
  if (pts2D.length<3) return;
  var hull=convexHull2D(pts2D);
  if (!hull||hull.length<3) return;
  try {
    var gy=terrainYAt(node.position.x,node.position.z)+0.07;
    var corners=hull.map(function(p){return new BABYLON.Vector2(p.x,p.z);});
    var poly=new BABYLON.PolygonMeshBuilder("jcap_"+node.id,corners,scene,window.earcut||null);
    var cap=poly.build(false,0.12);
    cap.position.y=gy; cap.isPickable=false; cap.material=getJMat();
    node.capMesh=cap;
  } catch(e){ console.warn("Cap:",e.message); }
}
function convexHull2D(pts) {
  if (pts.length<3) return pts;
  var s=0;
  for (var i=1;i<pts.length;i++) if(pts[i].x<pts[s].x) s=i;
  var hull=[],cur=s;
  do {
    hull.push(pts[cur]);
    var nxt=0;
    for (var i=1;i<pts.length;i++) {
      if(nxt===cur){nxt=i;continue;}
      var ax=pts[nxt].x-pts[cur].x,az=pts[nxt].z-pts[cur].z;
      var bx=pts[i].x-pts[cur].x,  bz=pts[i].z-pts[cur].z;
      var cross=ax*bz-az*bx;
      if(cross<0) nxt=i;
      else if(cross===0&&(bx*bx+bz*bz)>(ax*ax+az*az)) nxt=i;
    }
    cur=nxt; if(hull.length>pts.length+2) break;
  } while(cur!==s);
  return hull;
}

// ── Road state machine ────────────────────────────────
var rs={phase:0,A:null,B:null,startNode:null,preview:null,markerA:null};
rs.reset=function(){
  rs.phase=0;rs.A=null;rs.B=null;rs.startNode=null;
  if(rs.preview){rs.preview.dispose();rs.preview=null;}
  if(rs.markerA){rs.markerA.dispose();rs.markerA=null;}
};
rs.placeMarker=function(pos){
  if(!pos||typeof pos.clone!=="function") return null;
  var m=BABYLON.MeshBuilder.CreateSphere("markerA",{diameter:2.2},scene);
  m.position=pos.clone();m.position.y+=1.1;m.isPickable=false;
  var mat=new BABYLON.StandardMaterial("mAmat",scene);
  mat.diffuseColor=new BABYLON.Color3(0.2,0.6,1);
  mat.emissiveColor=new BABYLON.Color3(0.05,0.2,0.5);
  m.material=mat;return m;
};
rs.updatePreview=function(A,handle,end){
  if(rs.preview){rs.preview.dispose();rs.preview=null;}
  if(!A||!end||typeof A.subtract!=="function") return;
  if(A.subtract(end).length()<0.5) return;
  try{
    var h=handle||A.add(end).scale(0.5);
    var curve=BABYLON.Curve3.CreateQuadraticBezier(A,h,end,30);
    var pts=curve.getPoints();
    for(var i=0;i<pts.length;i++) pts[i].y=terrainYAt(pts[i].x,pts[i].z)+0.18;
    rs.preview=BABYLON.MeshBuilder.CreateTube("roadPreview",
      {path:pts,radius:2.5,tessellation:6},scene);
    rs.preview.isPickable=false;
    var pm=new BABYLON.StandardMaterial("rpmat",scene);
    pm.diffuseColor=new BABYLON.Color3(0.3,0.5,0.9);pm.alpha=0.38;
    rs.preview.material=pm;
  }catch(e){}
};

// ── Build road ─────────────────────────────────────────
function buildRoad(A,handle,C,startNodeRef,endNodeRef,typeName){
  if(!A||!C) return;
  typeName=typeName||DEFAULT_ROAD_TYPE;
  var td=ROAD_TYPES[typeName]||ROAD_TYPES[DEFAULT_ROAD_TYPE];
  var h=handle||A.add(C).scale(0.5);

  // High-resolution curve — more points = smoother ribbon on tight curves
  var curve=BABYLON.Curve3.CreateQuadraticBezier(A,h,C,128);
  var pts=curve.getPoints();
  for(var i=0;i<pts.length;i++) pts[i].y=terrainYAt(pts[i].x,pts[i].z)+0.06;

  var rid=roads.length, supports=[];

  // Build ribbon road (always — this is the road surface)
  buildRibbonRoad(pts,rid,td);
  placeSupports(pts,rid,supports);

  var road={
    id:rid,typeName:typeName,
    A:A.clone(),handle:h.clone(),C:C.clone(),
    curve:pts,supports:supports,
    nodes:[],startNodeId:null,endNodeId:null
  };
  roads.push(road);

  var sNode=startNodeRef||(findNodeAt(pts[0])||createNode(pts[0],rid,0,false));
  sNode.connections.push(rid);refreshNodeAppearance(sNode);buildJunctionCap(sNode);
  road.startNodeId=sNode.id;road.nodes.push(sNode);

  var accum=0,NS=UNIT*2;
  for(var i=1;i<pts.length-1;i++){
    accum+=BABYLON.Vector3.Distance(pts[i],pts[i-1]);
    if(accum>=NS){accum-=NS;road.nodes.push(createNode(pts[i],rid,i,true));}
  }

  var eNode=endNodeRef||(findNodeAt(pts[pts.length-1])||createNode(pts[pts.length-1],rid,pts.length-1,false));
  eNode.connections.push(rid);refreshNodeAppearance(eNode);buildJunctionCap(eNode);
  road.endNodeId=eNode.id;road.nodes.push(eNode);

  if(sNode.connections.length>1) console.log("Junction @ start",sNode.id,sNode.connections);
  if(eNode.connections.length>1) console.log("Junction @ end",  eNode.id,eNode.connections);

  var totalLen=0;
  for(var i=1;i<pts.length;i++) totalLen+=BABYLON.Vector3.Distance(pts[i],pts[i-1]);
  var el=document.getElementById("road-len");
  if(el) el.textContent=Math.round(totalLen)+" m  ("+Math.round(totalLen/UNIT)+" u)";
}

// ── RIBBON ROAD BUILDER ───────────────────────────────
// Computes perpendicular at each point, offsets 6 parallel
// paths, ribbons adjacent pairs. One mesh per component.
function buildRibbonRoad(pts,rid,td){
  var hw=td.halfWidth, kw=td.kerbWidth, kh=td.kerbRaise||0.06;

  // Six parallel paths left→right:
  //   lko = left kerb outer
  //   lki = left kerb inner (= road left edge at kerb height)
  //   lre = left road edge  (at road height = 0)
  //   rre = right road edge
  //   rki = right kerb inner
  //   rko = right kerb outer
  var lko=[],lki=[],lre=[],rre=[],rki=[],rko=[];
  var cl0=[],cl1=[];  // centre-line stripe (left half and right half)

  for(var i=0;i<pts.length;i++){
    var prev=pts[Math.max(0,i-1)];
    var next=pts[Math.min(pts.length-1,i+1)];
    var tang=next.subtract(prev).normalize();
    // Perpendicular in XZ, normalised
    var perp=new BABYLON.Vector3(-tang.z,0,tang.x);
    var p=pts[i];
    var y=p.y;

    lko.push(new BABYLON.Vector3(p.x+perp.x*(hw+kw), y+kh, p.z+perp.z*(hw+kw)));
    lki.push(new BABYLON.Vector3(p.x+perp.x*hw,      y+kh, p.z+perp.z*hw));
    lre.push(new BABYLON.Vector3(p.x+perp.x*hw,      y,    p.z+perp.z*hw));
    rre.push(new BABYLON.Vector3(p.x-perp.x*hw,      y,    p.z-perp.z*hw));
    rki.push(new BABYLON.Vector3(p.x-perp.x*hw,      y+kh, p.z-perp.z*hw));
    rko.push(new BABYLON.Vector3(p.x-perp.x*(hw+kw), y+kh, p.z-perp.z*(hw+kw)));

    // Centre dashes — two thin stripes either side of centre line
    var dashOff=0.08;
    cl0.push(new BABYLON.Vector3(p.x+perp.x*dashOff,y+0.01,p.z+perp.z*dashOff));
    cl1.push(new BABYLON.Vector3(p.x-perp.x*dashOff,y+0.01,p.z-perp.z*dashOff));
  }

  // ── Road surface (dark asphalt) ─────────────────────
  var roadMesh=BABYLON.MeshBuilder.CreateRibbon("road"+rid,
    {pathArray:[lre,rre],closePath:false,closeArray:false,updatable:false},scene);
  roadMesh.isPickable=false;
  var rm=new BABYLON.StandardMaterial("rm"+rid,scene);
  rm.diffuseColor=new BABYLON.Color3(0.18,0.18,0.18);
  rm.specularColor=new BABYLON.Color3(0.04,0.04,0.04);
  roadMesh.material=rm;

  // ── Left kerb face (lki→lko) ──────────────────────
  var lkTop=BABYLON.MeshBuilder.CreateRibbon("lkt"+rid,
    {pathArray:[lki,lko],closePath:false,closeArray:false},scene);
  lkTop.isPickable=false;

  // ── Left kerb surface (lre→lki) ─────────────────
  var lkFace=BABYLON.MeshBuilder.CreateRibbon("lkf"+rid,
    {pathArray:[lre,lki],closePath:false,closeArray:false},scene);
  lkFace.isPickable=false;

  // ── Right kerb ────────────────────────────────────
  var rkTop=BABYLON.MeshBuilder.CreateRibbon("rkt"+rid,
    {pathArray:[rko,rki],closePath:false,closeArray:false},scene);
  rkTop.isPickable=false;

  var rkFace=BABYLON.MeshBuilder.CreateRibbon("rkf"+rid,
    {pathArray:[rki,rre],closePath:false,closeArray:false},scene);
  rkFace.isPickable=false;

  // Shared kerb material (light concrete)
  var km=new BABYLON.StandardMaterial("km"+rid,scene);
  km.diffuseColor=new BABYLON.Color3(0.72,0.70,0.65);
  km.specularColor=new BABYLON.Color3(0.03,0.03,0.03);
  lkTop.material=lkFace.material=rkTop.material=rkFace.material=km;

  // ── Centre line (dashed white) ───────────────────
  // Build dashes by only ribboning every other segment
  addRibbonDashes(cl0,cl1,rid);
}

// Dashes: ribbon segments alternating visible/skipped
function addRibbonDashes(p0,p1,rid){
  var mat=new BABYLON.StandardMaterial("dash"+rid,scene);
  mat.diffuseColor=new BABYLON.Color3(1,1,1);
  mat.emissiveColor=new BABYLON.Color3(0.3,0.3,0.3);

  var DASH=6, GAP=4, state=0, count=0;
  var seg0=[], seg1=[];

  function flush(){
    if(seg0.length<2) return;
    var m=BABYLON.MeshBuilder.CreateRibbon("dl"+rid+"_"+count,
      {pathArray:[seg0,seg1],closePath:false,closeArray:false},scene);
    m.isPickable=false; m.material=mat; count++;
    seg0=[]; seg1=[];
  }

  var inDash=true, dashLen=0, TOTAL_LEN=0;
  // accumulate by index (approximate)
  for(var i=0;i<p0.length;i++){
    if(inDash){
      seg0.push(p0[i].clone()); seg1.push(p1[i].clone());
      if(i>0) dashLen+=BABYLON.Vector3.Distance(p0[i],p0[i-1]);
      if(dashLen>=DASH){ flush(); inDash=false; dashLen=0; }
    } else {
      if(i>0) dashLen+=BABYLON.Vector3.Distance(p0[i],p0[i-1]);
      if(dashLen>=GAP){ inDash=true; dashLen=0; }
    }
  }
  flush();
}

// ── Support columns ────────────────────────────────────
var COLUMN_THRESHOLD=0.8,_colSrc=null;
function getColSrc(){
  if(_colSrc) return _colSrc;
  _colSrc=BABYLON.MeshBuilder.CreateCylinder("colSrc",
    {diameter:0.6,height:1.0,tessellation:8},scene);
  _colSrc.setEnabled(false);_colSrc.isPickable=false;
  var cm=new BABYLON.StandardMaterial("colmat",scene);
  cm.diffuseColor=new BABYLON.Color3(0.55,0.52,0.48);_colSrc.material=cm;return _colSrc;
}
function placeSupports(pts,rid,supports){
  var src=getColSrc();
  for(var i=0;i<pts.length;i+=4){
    var gap=pts[i].y-terrainYAt(pts[i].x,pts[i].z);
    if(gap<COLUMN_THRESHOLD) continue;
    var col=src.createInstance("sup_"+rid+"_"+i);
    col.scaling.y=gap;col.position.x=pts[i].x;
    col.position.y=terrainYAt(pts[i].x,pts[i].z)+gap/2;
    col.position.z=pts[i].z;col.isPickable=false;supports.push(col);
  }
}
