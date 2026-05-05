// ─────────────────────────────────────────────────────
//  roads.js  —  road network, junctions, GLB instancing
// ─────────────────────────────────────────────────────

var roads     = [];
var snapNodes = [];

// ── Road type definitions ────────────────────────────
var ROAD_TYPES = {
  street: {
    halfWidth: 2.5,
    kerbWidth: 0.4,
    modelPath: "models/road_2lane.glb"
  }
};
var DEFAULT_ROAD_TYPE = "street";

// ── Road model cache ──────────────────────────────────
var _roadModels = {};

function loadModelForType(typeName) {
  var def = ROAD_TYPES[typeName];
  if (!def || !def.modelPath) return;
  if (_roadModels[typeName] !== undefined) return;
  _roadModels[typeName] = null; // mark as loading

  var path = def.modelPath;
  var last = path.lastIndexOf("/");
  var root = last >= 0 ? path.substring(0, last + 1) : "./";
  var file = last >= 0 ? path.substring(last + 1)    : path;

  BABYLON.SceneLoader.ImportMesh("", root, file, scene,
    function(meshes) {
      var loaded = [];

      // Collect all real meshes (not __root__ transform node)
      var realMeshes = [];
      for (var i = 0; i < meshes.length; i++) {
        if (meshes[i].name !== "__root__") realMeshes.push(meshes[i]);
      }

      for (var i = 0; i < realMeshes.length; i++) {
        var m = realMeshes[i];

        // Bake the full world matrix (includes __root__ scale + rotation)
        // into the mesh vertices so instances inherit correct geometry.
        m.computeWorldMatrix(true);
        m.bakeCurrentTransformIntoVertices();

        // Reset transform to identity — instances only need position/rotation.y
        m.position    = BABYLON.Vector3.Zero();
        m.rotation    = BABYLON.Vector3.Zero();
        m.scaling     = BABYLON.Vector3.One();
        m.parent      = null;

        m.setEnabled(false);
        m.isPickable  = false;
        loaded.push(m);
      }

      // Dispose __root__ cleanly now that children are detached
      for (var i = 0; i < meshes.length; i++) {
        if (meshes[i].name === "__root__") { meshes[i].dispose(); break; }
      }

      _roadModels[typeName] = loaded;
      console.log("Road model loaded:", file, "(" + loaded.length + " meshes)");
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Road model: " + file + " (" + loaded.length + " mesh)";
    },
    null,
    function(scene2, msg) {
      console.warn("Road model load failed:", msg);
      _roadModels[typeName] = [];
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Ribbon fallback — model not found";
    }
  );
}

loadModelForType(DEFAULT_ROAD_TYPE);

// ── Node materials ────────────────────────────────────
var _mats = {};
function _getMat(type) {
  if (_mats[type]) return _mats[type];
  var m = new BABYLON.StandardMaterial("sn_" + type, scene);
  m.backFaceCulling = false;
  if (type === "endpoint") {
    m.diffuseColor  = new BABYLON.Color3(0.15, 0.70, 1.0);
    m.emissiveColor = new BABYLON.Color3(0.03, 0.28, 0.45);
  } else if (type === "mid") {
    m.diffuseColor  = new BABYLON.Color3(0.15, 0.45, 0.65);
    m.emissiveColor = new BABYLON.Color3(0.02, 0.15, 0.25);
    m.alpha = 0.55;
  } else if (type === "junction") {
    m.diffuseColor  = new BABYLON.Color3(1.0, 0.55, 0.05);
    m.emissiveColor = new BABYLON.Color3(0.5, 0.22, 0.0);
  } else if (type === "active") {
    m.diffuseColor  = new BABYLON.Color3(1.0, 0.95, 0.1);
    m.emissiveColor = new BABYLON.Color3(0.6, 0.55, 0.0);
  }
  _mats[type] = m;
  return m;
}

var _junctionMat = null;
function getJunctionMat() {
  if (_junctionMat) return _junctionMat;
  _junctionMat = new BABYLON.StandardMaterial("jmat", scene);
  _junctionMat.diffuseColor  = new BABYLON.Color3(0.17, 0.17, 0.17);
  _junctionMat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
  return _junctionMat;
}

// ── Nodes ─────────────────────────────────────────────
var _nodeCounter = 0;

function createNode(pos, roadId, curveIndex, isMid) {
  var mesh = BABYLON.MeshBuilder.CreateDisc("sn_" + _nodeCounter, {
    radius: isMid ? 0.5 : 1.0, tessellation: 14
  }, scene);
  mesh.rotation.x  = Math.PI / 2;
  mesh.position    = pos.clone();
  mesh.position.y += 0.35;
  mesh.isPickable  = false;
  mesh.isVisible   = false;
  mesh.material    = _getMat(isMid ? "mid" : "endpoint");

  var node = {
    id:          "n_" + (_nodeCounter++),
    position:    pos.clone(),
    roadId:      roadId,
    curveIndex:  curveIndex,
    isMid:       isMid,
    connections: [],
    capMesh:     null,
    mesh:        mesh
  };
  snapNodes.push(node);
  return node;
}

function findNodeAt(pos) {
  for (var i = 0; i < snapNodes.length; i++) {
    var n = snapNodes[i];
    if (n.isMid) continue;
    if (BABYLON.Vector3.Distance(pos, n.position) < 0.1) return n;
  }
  return null;
}

function refreshNodeAppearance(node) {
  if (!node || node.isMid) return;
  if (node.connections.length >= 2) {
    node.mesh.material  = _getMat("junction");
    node.mesh.scaling.x = node.mesh.scaling.z = 1.5;
  } else {
    node.mesh.material  = _getMat("endpoint");
    node.mesh.scaling.x = node.mesh.scaling.z = 1.0;
  }
}

// ── Procedural junction cap ───────────────────────────
function buildJunctionCap(node) {
  if (node.capMesh) { node.capMesh.dispose(); node.capMesh = null; }
  if (node.connections.length < 2) return;

  var edgePoints = [];

  for (var c = 0; c < node.connections.length; c++) {
    var road = null;
    for (var r = 0; r < roads.length; r++) {
      if (roads[r].id === node.connections[c]) { road = roads[r]; break; }
    }
    if (!road) continue;

    var typeDef = ROAD_TYPES[road.typeName] || ROAD_TYPES[DEFAULT_ROAD_TYPE];
    var halfW   = typeDef.halfWidth + typeDef.kerbWidth;
    var pts     = road.curve;
    var isStart = (road.startNodeId === node.id);
    var idx, tang;

    if (isStart) {
      idx  = 0;
      tang = pts[Math.min(1, pts.length-1)].subtract(pts[0]).normalize();
    } else {
      idx  = pts.length - 1;
      tang = pts[idx].subtract(pts[Math.max(0, idx-1)]).normalize();
    }

    var perp = new BABYLON.Vector3(-tang.z, 0, tang.x);
    var base = pts[idx];
    edgePoints.push({ x: base.x + perp.x * halfW, z: base.z + perp.z * halfW });
    edgePoints.push({ x: base.x - perp.x * halfW, z: base.z - perp.z * halfW });
  }

  edgePoints.push({ x: node.position.x, z: node.position.z });
  if (edgePoints.length < 3) return;

  var hull = convexHull2D(edgePoints);
  if (!hull || hull.length < 3) return;

  try {
    var groundY = terrainYAt(node.position.x, node.position.z) + 0.07;
    var corners = [];
    for (var i = 0; i < hull.length; i++)
      corners.push(new BABYLON.Vector2(hull[i].x, hull[i].z));

    var poly = new BABYLON.PolygonMeshBuilder("jcap_" + node.id, corners, scene,
      window.earcut || null);
    var cap = poly.build(false, 0.12);
    cap.position.y = groundY;
    cap.isPickable = false;
    cap.material   = getJunctionMat();
    node.capMesh   = cap;
  } catch(e) {
    console.warn("Junction cap failed:", e.message);
  }
}

function convexHull2D(pts) {
  if (pts.length < 3) return pts;
  var start = 0;
  for (var i = 1; i < pts.length; i++)
    if (pts[i].x < pts[start].x) start = i;
  var hull = [], current = start;
  do {
    hull.push(pts[current]);
    var next = 0;
    for (var i = 1; i < pts.length; i++) {
      if (next === current) { next = i; continue; }
      var ax=pts[next].x-pts[current].x, az=pts[next].z-pts[current].z;
      var bx=pts[i].x-pts[current].x,   bz=pts[i].z-pts[current].z;
      var cross = ax*bz - az*bx;
      if (cross < 0) next = i;
      else if (cross === 0 && (bx*bx+bz*bz) > (ax*ax+az*az)) next = i;
    }
    current = next;
    if (hull.length > pts.length + 2) break;
  } while (current !== start);
  return hull;
}

// ── Road state machine ────────────────────────────────
var rs = { phase:0, A:null, B:null, startNode:null, preview:null, markerA:null };

rs.reset = function() {
  rs.phase=0; rs.A=null; rs.B=null; rs.startNode=null;
  if (rs.preview) { rs.preview.dispose(); rs.preview=null; }
  if (rs.markerA) { rs.markerA.dispose(); rs.markerA=null; }
};

rs.placeMarker = function(pos) {
  if (!pos || typeof pos.clone !== "function") return null;
  var m = BABYLON.MeshBuilder.CreateSphere("markerA", {diameter:2.2}, scene);
  m.position=pos.clone(); m.position.y+=1.1; m.isPickable=false;
  var mat=new BABYLON.StandardMaterial("markerAmat",scene);
  mat.diffuseColor=new BABYLON.Color3(0.2,0.6,1.0);
  mat.emissiveColor=new BABYLON.Color3(0.05,0.2,0.5);
  m.material=mat; return m;
};

rs.updatePreview = function(A, handle, end) {
  if (rs.preview) { rs.preview.dispose(); rs.preview=null; }
  if (!A||!end||typeof A.subtract!=="function") return;
  if (A.subtract(end).length()<0.5) return;
  try {
    var h=handle||A.add(end).scale(0.5);
    var curve=BABYLON.Curve3.CreateQuadraticBezier(A,h,end,30);
    var pts=curve.getPoints();
    for (var i=0;i<pts.length;i++) pts[i].y=terrainYAt(pts[i].x,pts[i].z)+0.18;
    rs.preview=BABYLON.MeshBuilder.CreateTube("roadPreview",{path:pts,radius:2.5,tessellation:6},scene);
    rs.preview.isPickable=false;
    var pm=new BABYLON.StandardMaterial("rpmat",scene);
    pm.diffuseColor=new BABYLON.Color3(0.3,0.5,0.9); pm.alpha=0.38;
    rs.preview.material=pm;
  } catch(e) {}
};

// ── Build road ────────────────────────────────────────
function buildRoad(A, handle, C, startNodeRef, endNodeRef, typeName) {
  if (!A||!C) return;
  typeName = typeName || DEFAULT_ROAD_TYPE;
  var typeDef = ROAD_TYPES[typeName] || ROAD_TYPES[DEFAULT_ROAD_TYPE];
  var h = handle || A.add(C).scale(0.5);
  var curve = BABYLON.Curve3.CreateQuadraticBezier(A,h,C,64);
  var pts = curve.getPoints();
  for (var i=0;i<pts.length;i++) pts[i].y=terrainYAt(pts[i].x,pts[i].z)+0.08;

  var rid=roads.length, instances=[], supports=[];
  var models=_roadModels[typeName];

  if (models && models.length>0) {
    placeModelInstances(pts,rid,models,instances);
  } else {
    placeRibbonRoad(pts,rid,typeDef);
  }
  placeSupports(pts,rid,supports);

  var road={
    id:rid, typeName:typeName,
    A:A.clone(), handle:h.clone(), C:C.clone(),
    curve:pts, instances:instances, supports:supports,
    nodes:[], startNodeId:null, endNodeId:null
  };
  roads.push(road);

  var sNode=startNodeRef||(findNodeAt(pts[0])||createNode(pts[0],rid,0,false));
  sNode.connections.push(rid);
  refreshNodeAppearance(sNode);
  buildJunctionCap(sNode);
  road.startNodeId=sNode.id; road.nodes.push(sNode);

  var accum=0, NODE_SPACING=UNIT*2;
  for (var i=1;i<pts.length-1;i++) {
    accum+=BABYLON.Vector3.Distance(pts[i],pts[i-1]);
    if (accum>=NODE_SPACING) { accum-=NODE_SPACING; road.nodes.push(createNode(pts[i],rid,i,true)); }
  }

  var eNode=endNodeRef||(findNodeAt(pts[pts.length-1])||createNode(pts[pts.length-1],rid,pts.length-1,false));
  eNode.connections.push(rid);
  refreshNodeAppearance(eNode);
  buildJunctionCap(eNode);
  road.endNodeId=eNode.id; road.nodes.push(eNode);

  if (sNode.connections.length>1) console.log("Junction @ start",sNode.id,"roads:",sNode.connections);
  if (eNode.connections.length>1) console.log("Junction @ end",  eNode.id,"roads:",eNode.connections);

  var totalLen=0;
  for (var i=1;i<pts.length;i++) totalLen+=BABYLON.Vector3.Distance(pts[i],pts[i-1]);
  var el=document.getElementById("road-len");
  if (el) el.textContent=Math.round(totalLen)+" m  ("+Math.round(totalLen/UNIT)+" u)";
}

// ── GLB instancing ────────────────────────────────────
function placeModelInstances(pts, rid, models, instances) {
  var accum=0, placed=0;
  for (var i=1;i<pts.length;i++) {
    accum+=BABYLON.Vector3.Distance(pts[i],pts[i-1]);
    if (accum>=UNIT) {
      accum-=UNIT;
      var tang=pts[i].subtract(pts[i-1]).normalize();
      var angle=Math.atan2(tang.x,tang.z);
      for (var m=0;m<models.length;m++) {
        var inst=models[m].createInstance("ri_"+rid+"_"+placed+"_"+m);
        inst.position=pts[i].clone();
        inst.rotation.y=angle;
        inst.isPickable=false;
        instances.push(inst);
      }
      placed++;
    }
  }
}

// ── Ribbon fallback ───────────────────────────────────
function placeRibbonRoad(pts, rid, typeDef) {
  var halfW=typeDef.halfWidth, kerbW=typeDef.kerbWidth;
  var left=[],right=[],lk=[],rk=[];
  for (var i=0;i<pts.length;i++) {
    var prev=pts[Math.max(0,i-1)], next=pts[Math.min(pts.length-1,i+1)];
    var tang=next.subtract(prev).normalize();
    var perp=new BABYLON.Vector3(-tang.z,0,tang.x);
    left.push(pts[i].add(perp.scale( halfW)));
    right.push(pts[i].add(perp.scale(-halfW)));
    if (kerbW>0) {
      lk.push(pts[i].add(perp.scale( halfW+kerbW)));
      rk.push(pts[i].add(perp.scale(-halfW-kerbW)));
    }
  }
  var road=BABYLON.MeshBuilder.CreateRibbon("road"+rid,{pathArray:[left,right],closePath:false,closeArray:false},scene);
  road.isPickable=false;
  var rm=new BABYLON.StandardMaterial("rm"+rid,scene);
  rm.diffuseColor=new BABYLON.Color3(0.18,0.18,0.18);
  rm.specularColor=new BABYLON.Color3(0.04,0.04,0.04);
  road.material=rm;
  if (kerbW>0) {
    var lkm=BABYLON.MeshBuilder.CreateRibbon("lk"+rid,{pathArray:[lk,left],closePath:false,closeArray:false},scene);
    var rkm=BABYLON.MeshBuilder.CreateRibbon("rk"+rid,{pathArray:[right,rk],closePath:false,closeArray:false},scene);
    var km=new BABYLON.StandardMaterial("km"+rid,scene);
    km.diffuseColor=new BABYLON.Color3(0.70,0.68,0.63);
    km.specularColor=new BABYLON.Color3(0.03,0.03,0.03);
    lkm.material=rkm.material=km;
    lkm.isPickable=rkm.isPickable=false;
  }
  addCentreLine(pts,rid);
}

function addCentreLine(pts,rid) {
  var mat=new BABYLON.StandardMaterial("cl"+rid,scene);
  mat.diffuseColor=new BABYLON.Color3(1,1,1); mat.emissiveColor=new BABYLON.Color3(0.4,0.4,0.4);
  for (var i=2;i<pts.length-2;i+=4) {
    var p=pts[i],nxt=pts[Math.min(i+1,pts.length-1)];
    var dir=nxt.subtract(p).normalize();
    var d=BABYLON.MeshBuilder.CreateBox("cl"+i+"_"+rid,{width:0.18,depth:2.0,height:0.04},scene);
    d.position=p.clone(); d.position.y+=0.14;
    d.rotation.y=Math.atan2(dir.x,dir.z);
    d.isPickable=false; d.material=mat;
  }
}

// ── Support columns ───────────────────────────────────
var COLUMN_THRESHOLD=0.8,_colSrc=null;
function getColSrc() {
  if (_colSrc) return _colSrc;
  _colSrc=BABYLON.MeshBuilder.CreateCylinder("colSrc",{diameter:0.6,height:1.0,tessellation:8},scene);
  _colSrc.setEnabled(false); _colSrc.isPickable=false;
  var cm=new BABYLON.StandardMaterial("colmat",scene);
  cm.diffuseColor=new BABYLON.Color3(0.55,0.52,0.48); _colSrc.material=cm; return _colSrc;
}
function placeSupports(pts,rid,supports) {
  var src=getColSrc();
  for (var i=0;i<pts.length;i+=4) {
    var gap=pts[i].y-terrainYAt(pts[i].x,pts[i].z);
    if (gap<COLUMN_THRESHOLD) continue;
    var col=src.createInstance("sup_"+rid+"_"+i);
    col.scaling.y=gap; col.position.x=pts[i].x;
    col.position.y=terrainYAt(pts[i].x,pts[i].z)+gap/2;
    col.position.z=pts[i].z; col.isPickable=false; supports.push(col);
  }
}
