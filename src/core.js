// ─────────────────────────────────────────────────────
//  core.js — engine, scene, camera, lights
//  Loaded first. All vars become globals for other files.
// ─────────────────────────────────────────────────────

var canvas = document.getElementById("c");
var engine = new BABYLON.Engine(canvas, true);
var scene  = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.52, 0.71, 0.87, 1);

// Camera — city-builder perspective, no inputs manipulation
var cam = new BABYLON.ArcRotateCamera(
  "cam", -Math.PI / 2, Math.PI / 3, 130, BABYLON.Vector3.Zero(), scene
);
cam.attachControl(canvas, true);
cam.lowerRadiusLimit     = 8;
cam.upperRadiusLimit     = 500;
cam.lowerBetaLimit       = 0.15;
cam.upperBetaLimit       = 1.48;
cam.panningSensibility   = 50;
cam.wheelDeltaPercentage = 0.012;

// Sun + ambient
var sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-1, -2, -1), scene);
sun.intensity = 1.1;
sun.position  = new BABYLON.Vector3(80, 150, 80);

var amb = new BABYLON.HemisphericLight("amb", new BABYLON.Vector3(0, 1, 0), scene);
amb.intensity = 0.5;

// Shared ray-pick helper — only hits the terrain mesh
function pickTerrain() {
  return scene.pick(scene.pointerX, scene.pointerY, function(m) {
    return m.name === "terrain";
  });
}
