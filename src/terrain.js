// ─────────────────────────────────────────────────────
//  terrain.js  —  mesh, brush, texture blend
//
//  Textures at: terrain-textures/grass.jpg
//               terrain-textures/dirt.jpg
//               terrain-textures/sand.jpg  (future v0.5 water)
//
//  Falls back to vertex colours if any texture 404s.
// ─────────────────────────────────────────────────────

var TS=512, TG=150;

var terrain=BABYLON.MeshBuilder.CreateGround("terrain",
  {width:TS,height:TS,subdivisions:TG,updatable:true},scene);

// ── Vertex colour material (always works, used as fallback) ──
var _vcMat=null;
function applyVertexColourMat(){
  if(!_vcMat){
    _vcMat=new BABYLON.StandardMaterial("tmat_vc",scene);
    _vcMat.diffuseColor=new BABYLON.Color3(1,1,1);
    _vcMat.specularColor=new BABYLON.Color3(0.03,0.03,0.03);
    _vcMat.vertexColorsEnabled=true;
  }
  terrain.material=_vcMat;
  _useShader=false;
  updateTerrainColors();
}

var _useShader=false;

// ── Texture shader material ───────────────────────────
function applyTextureMat(){
  try {
    var mat=new BABYLON.ShaderMaterial("terrainShader",scene,{
      vertexSource:`
        precision highp float;
        attribute vec3 position;
        attribute vec3 normal;
        attribute vec2 uv;
        uniform mat4 worldViewProjection;
        varying vec3 vNorm;
        varying vec3 vPos;
        varying vec2 vUV;
        void main(){
          vNorm=normal; vPos=position; vUV=uv*40.0;
          gl_Position=worldViewProjection*vec4(position,1.0);
        }
      `,
      fragmentSource:`
        precision highp float;
        uniform sampler2D grassTex;
        uniform sampler2D dirtTex;
        uniform sampler2D sandTex;
        varying vec3 vNorm;
        varying vec3 vPos;
        varying vec2 vUV;
        void main(){
          float ny=clamp(vNorm.y,0.0,1.0);
          float h=vPos.y;
          float slopeT=smoothstep(0.62,0.88,ny);
          float sandT=1.0-smoothstep(0.0,2.5,h);
          vec4 grass=texture2D(grassTex,vUV);
          vec4 dirt =texture2D(dirtTex, vUV);
          vec4 sand =texture2D(sandTex, vUV);
          vec4 col=mix(dirt,grass,slopeT);
          col=mix(col,sand,sandT*0.85);
          gl_FragColor=col;
        }
      `
    },{
      attributes:["position","normal","uv"],
      uniforms:["worldViewProjection","grassTex","dirtTex","sandTex"]
    });
    mat.backFaceCulling=false;

    var loaded=0, failed=false;
    function onLoad(){ loaded++; if(loaded===3){ terrain.material=mat; _useShader=true; console.log("Terrain textures loaded"); } }
    function onFail(url){ if(!failed){ failed=true; console.warn("Texture not found:",url,"— using vertex colours"); applyVertexColourMat(); } }

    var grassTex=new BABYLON.Texture("terrain-textures/grass.jpg",scene,false,true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,onLoad,function(){onFail("grass.jpg");});
    var dirtTex =new BABYLON.Texture("terrain-textures/dirt.jpg", scene,false,true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,onLoad,function(){onFail("dirt.jpg");});
    var sandTex =new BABYLON.Texture("terrain-textures/sand.jpg", scene,false,true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,onLoad,function(){onFail("sand.jpg");});

    [grassTex,dirtTex,sandTex].forEach(function(t){
      t.wrapU=t.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
    });

    mat.setTexture("grassTex",grassTex);
    mat.setTexture("dirtTex", dirtTex);
    mat.setTexture("sandTex", sandTex);

    // Apply vertex colours immediately as placeholder until textures load
    applyVertexColourMat();
    // ShaderMaterial will be applied once all three textures confirm loaded

  } catch(e) {
    console.warn("Shader failed:",e.message);
    applyVertexColourMat();
  }
}

applyTextureMat();

// ── Vertex helpers ────────────────────────────────────
function getV(){ return terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind); }
function setV(v){
  terrain.updateVerticesData(BABYLON.VertexBuffer.PositionKind,v);
  terrain.createNormals(false);
  if(!_useShader) updateTerrainColors();
}

var GRASS=[0.27,0.54,0.17], DIRT=[0.52,0.38,0.22];
function updateTerrainColors(){
  var norms=terrain.getVerticesData(BABYLON.VertexBuffer.NormalKind);
  if(!norms) return;
  var n=norms.length/3, cols=new Float32Array(n*4);
  for(var i=0;i<n;i++){
    var ny=norms[i*3+1];
    var t=Math.max(0,Math.min(1,(ny-0.65)/0.20));
    cols[i*4]  =GRASS[0]*t+DIRT[0]*(1-t);
    cols[i*4+1]=GRASS[1]*t+DIRT[1]*(1-t);
    cols[i*4+2]=GRASS[2]*t+DIRT[2]*(1-t);
    cols[i*4+3]=1;
  }
  terrain.setVerticesData(BABYLON.VertexBuffer.ColorKind,cols,true);
}

// ── Brush ─────────────────────────────────────────────
var brushMode="raise",brushRadius=12,brushStr=0.5;
var flattenTarget=null,raiseTarget=null,lowerTarget=null;

function applyBrush(hp){
  var v=getV(),hx=hp.x,hz=hp.z,hy=hp.y,rL=(TG+1)*3;
  var i,j,n,dx,dz,d,fo,dt,nb,sum,cnt;
  var flatY=(brushMode==="flatten"&&flattenTarget!==null)?flattenTarget:hy;
  if(brushMode==="smooth"){
    var cp=v.slice();
    for(i=0;i<v.length;i+=3){
      dx=v[i]-hx;dz=v[i+2]-hz;d=Math.sqrt(dx*dx+dz*dz);if(d>brushRadius)continue;
      fo=1-d/brushRadius;nb=[i-3,i+3,i-rL,i+rL];sum=cp[i+1];cnt=1;
      for(j=0;j<4;j++){n=nb[j];if(n>=0&&n<cp.length){sum+=cp[n+1];cnt++;}}
      v[i+1]+=((sum/cnt)-v[i+1])*fo*brushStr*0.4;
    }
  } else {
    for(i=0;i<v.length;i+=3){
      dx=v[i]-hx;dz=v[i+2]-hz;d=Math.sqrt(dx*dx+dz*dz);if(d>brushRadius)continue;
      fo=1-d/brushRadius;dt=brushStr*fo;
      if(brushMode==="raise"){v[i+1]+=dt;if(raiseTarget!==null&&v[i+1]>raiseTarget)v[i+1]=raiseTarget;}
      if(brushMode==="lower"){v[i+1]-=dt;if(lowerTarget!==null&&v[i+1]<lowerTarget)v[i+1]=lowerTarget;}
      if(brushMode==="flatten")v[i+1]+=(flatY-v[i+1])*fo*0.25;
      v[i+1]=Math.max(-30,Math.min(80,v[i+1]));
    }
  }
  setV(v);
}

function sampleHeight(hp){
  flattenTarget=Math.round(hp.y/0.5)*0.5;
  var el=document.getElementById("layer-val");
  if(el)el.textContent=flattenTarget.toFixed(1)+" m";
}
function setRaiseTarget(val){raiseTarget=(val===""||isNaN(+val))?null:+val;}
function setLowerTarget(val){lowerTarget=(val===""||isNaN(+val))?null:+val;}

function exportHM(){
  var sz=TG+1,v=getV();
  var cv=document.createElement("canvas");cv.width=cv.height=sz;
  var ctx=cv.getContext("2d"),img=ctx.createImageData(sz,sz);
  var mn=Infinity,mx=-Infinity;
  for(var i=1;i<v.length;i+=3){if(v[i]<mn)mn=v[i];if(v[i]>mx)mx=v[i];}
  var rng=mx-mn||1;
  for(var r=0;r<sz;r++)for(var c=0;c<sz;c++){
    var vi=(r*sz+c)*3,pv=Math.round(((v[vi+1]-mn)/rng)*255);
    var pi=(r*sz+c)*4;img.data[pi]=img.data[pi+1]=img.data[pi+2]=pv;img.data[pi+3]=255;
  }
  ctx.putImageData(img,0,0);
  var a=document.createElement("a");a.download="heightmap.png";a.href=cv.toDataURL();a.click();
}

// ── Brush circle ──────────────────────────────────────
var brushCircle=null,_red4=new BABYLON.Color4(1,0.2,0.2,1);
function rebuildCircle(){
  if(brushCircle){brushCircle.dispose();brushCircle=null;}
  var pts=[],cols=[];
  for(var i=0;i<=48;i++){
    var a=(i/48)*Math.PI*2;
    pts.push(new BABYLON.Vector3(Math.cos(a)*brushRadius,0,Math.sin(a)*brushRadius));
    cols.push(_red4);
  }
  brushCircle=BABYLON.MeshBuilder.CreateLines("bc",{points:pts,colors:cols},scene);
  brushCircle.isPickable=false;brushCircle.isVisible=false;
}
rebuildCircle();

// ── Snap dot ──────────────────────────────────────────
var snapDot=BABYLON.MeshBuilder.CreateDisc("sd",{radius:1.4,tessellation:16},scene);
snapDot.rotation.x=Math.PI/2;snapDot.isPickable=false;snapDot.isVisible=false;
var sdMat=new BABYLON.StandardMaterial("sdmat",scene);
sdMat.diffuseColor=new BABYLON.Color3(1,0.9,0.1);
sdMat.emissiveColor=new BABYLON.Color3(0.5,0.45,0);
sdMat.backFaceCulling=false;snapDot.material=sdMat;

function setBrush(mode,btn){
  brushMode=mode;
  document.querySelectorAll("#bmodes button").forEach(function(b){b.classList.remove("active");});
  btn.classList.add("active");
}
