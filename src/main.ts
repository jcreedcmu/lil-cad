import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- Renderer ---
const sidebar = document.getElementById('sidebar')!;
function viewWidth() { return window.innerWidth - sidebar.offsetWidth; }
function viewHeight() { return window.innerHeight; }

const renderer = new THREE.WebGLRenderer();
renderer.setSize(viewWidth(), viewHeight());
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- 2D overlay canvas ---
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const olCtx = overlay.getContext('2d')!;

function resizeOverlay() {
  const dpr = window.devicePixelRatio;
  overlay.width = viewWidth() * dpr;
  overlay.height = viewHeight() * dpr;
  overlay.style.width = viewWidth() + 'px';
  overlay.style.height = viewHeight() + 'px';
  overlay.style.left = sidebar.offsetWidth + 'px';
  olCtx.scale(dpr, dpr);
}
resizeOverlay();

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // light blue sky

// --- Camera ---
const camera = new THREE.PerspectiveCamera(75, viewWidth() / viewHeight(), 0.1, 1000);
camera.position.set(0, 1.6, 5); // eye height ~1.6m

// --- Checkerboard floor ---
const floorSize = 100;
const tileCount = 50; // tiles per side
const texCanvas = document.createElement('canvas');
texCanvas.width = tileCount * 2;
texCanvas.height = tileCount * 2;
const texCtx = texCanvas.getContext('2d')!;
for (let y = 0; y < tileCount * 2; y++) {
  for (let x = 0; x < tileCount * 2; x++) {
    texCtx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#bbbbbb';
    texCtx.fillRect(x, y, 1, 1);
  }
}
const floorTexture = new THREE.CanvasTexture(texCanvas);
floorTexture.magFilter = THREE.NearestFilter;
floorTexture.minFilter = THREE.NearestFilter;
floorTexture.wrapS = THREE.RepeatWrapping;
floorTexture.wrapT = THREE.RepeatWrapping;

const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// --- Post-processing (SSAO) ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssaoPass = new SSAOPass(scene, camera, viewWidth(), viewHeight());
ssaoPass.kernelRadius = 16;
ssaoPass.minDistance = 0.001;
ssaoPass.maxDistance = 0.3;
composer.addPass(ssaoPass);
composer.addPass(new OutputPass());

// --- Physics world ---
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
(world.solver as CANNON.GSSolver).iterations = 10;
world.defaultContactMaterial.friction = 0;

const groundBody = new CANNON.Body({ mass: 0 });
groundBody.addShape(new CANNON.Plane());
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const playerHalfExtents = new CANNON.Vec3(0.25, 1, 0.25); // 0.5m x 2m x 0.5m
const playerMaterial = new CANNON.Material({ friction: 0 });
const playerBody = new CANNON.Body({
  mass: 5,
  shape: new CANNON.Box(playerHalfExtents),
  fixedRotation: true,
  position: new CANNON.Vec3(0, playerHalfExtents.y, 5),
  material: playerMaterial,
});
world.addBody(playerBody);

function checkCanJump(): boolean {
  const from = new CANNON.Vec3(
    playerBody.position.x,
    playerBody.position.y,
    playerBody.position.z,
  );
  const to = new CANNON.Vec3(from.x, from.y - playerHalfExtents.y - 0.15, from.z);
  const result = new CANNON.RaycastResult();
  world.raycastClosest(from, to, {}, result);
  return result.hasHit && result.body !== playerBody;
}

const eyeOffset = 0.6; // eye at ~1.6m (body center at 1.0 + offset 0.6)

// --- Types ---
type Vertex = { x: number; z: number };

function vertexEqual(a: Vertex, b: Vertex): boolean {
  return a.x === b.x && a.z === b.z;
}

type UxState =
  | { t: 'idle' }
  | { t: 'drawing'; vertices: Vertex[] }
  | { t: 'polygon'; vertices: Vertex[]; extrusion: number };

// --- State ---
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
let uxState: UxState = { t: 'idle' };
let highlightedVertex: Vertex | null = null;

// --- Extrusion preview ---
let previewMesh: THREE.Mesh | null = null;

function makeExtrudedGeo(vertices: Vertex[], height: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(vertices[0].x, -vertices[0].z);
  for (let i = 1; i < vertices.length; i++) {
    shape.lineTo(vertices[i].x, -vertices[i].z);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
}

function clearPreview() {
  if (previewMesh) {
    scene.remove(previewMesh);
    previewMesh.geometry.dispose();
    (previewMesh.material as THREE.Material).dispose();
    previewMesh = null;
  }
}

function updatePreview(vertices: Vertex[], extrusion: number) {
  clearPreview();
  if (extrusion <= 0) return;
  const geo = makeExtrudedGeo(vertices, extrusion);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.5,
  });
  previewMesh = new THREE.Mesh(geo, mat);
  previewMesh.rotation.x = -Math.PI / 2;
  scene.add(previewMesh);
}

function isConvexCCW(verts: Vertex[]): boolean {
  const n = verts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n], c = verts[(i + 2) % n];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (cross < 0) return false;
  }
  return true;
}

function ensureCCW(verts: Vertex[]): Vertex[] {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    area += verts[i].x * verts[j].z - verts[j].x * verts[i].z;
  }
  return area > 0 ? verts : [...verts].reverse();
}

function addConvexBody(verts: Vertex[], height: number): boolean {
  const ccw = ensureCCW(verts);
  if (!isConvexCCW(ccw)) return false;

  const n = ccw.length;

  // Compute centroid so we can center vertices at origin (like CANNON.Box does)
  let cx = 0, cz = 0;
  for (const v of ccw) { cx += v.x; cz += v.z; }
  cx /= n;
  cz /= n;
  const cy = height / 2;

  const cannonVerts: CANNON.Vec3[] = [];
  for (const v of ccw) cannonVerts.push(new CANNON.Vec3(v.x - cx, -cy, v.z - cz));
  for (const v of ccw) cannonVerts.push(new CANNON.Vec3(v.x - cx, cy, v.z - cz));

  const faces: number[][] = [];

  // Bottom face
  const bottom: number[] = [];
  for (let i = 0; i < n; i++) bottom.push(i);
  faces.push(bottom);

  // Top face
  const top: number[] = [];
  for (let i = n - 1; i >= 0; i--) top.push(n + i);
  faces.push(top);

  // Side faces
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    faces.push([next, i, n + i, n + next]);
  }

  const shape = new CANNON.ConvexPolyhedron({ vertices: cannonVerts, faces });

  const body = new CANNON.Body({ mass: 0 });
  body.addShape(shape);
  body.position.set(cx, cy, cz);
  world.addBody(body);
  return true;
}

function acceptExtrusion(vertices: Vertex[], extrusion: number): boolean {
  clearPreview();
  if (!addConvexBody(vertices, extrusion)) {
    console.warn('Polygon is not convex, rejecting extrusion');
    return false;
  }
  const geo = makeExtrudedGeo(vertices, extrusion);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  return true;
}

// --- Default geometry: 3-step staircase ---
for (let i = 0; i < 3; i++) {
  const z = -2 - i * 2;
  const height = i + 1;
  const verts: Vertex[] = [
    { x: -1, z: z },
    { x: 1, z: z },
    { x: 1, z: z - 2 },
    { x: -1, z: z - 2 },
  ];
  acceptExtrusion(verts, height);
}

// --- Input state ---
const keys: Record<string, boolean> = {};

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' && checkCanJump()) {
    playerBody.velocity.y = 6;
  }

  if (uxState.t === 'polygon') {
    if (e.code === 'ArrowUp') {
      uxState.extrusion++;
      updatePreview(uxState.vertices, uxState.extrusion);
    } else if (e.code === 'ArrowDown') {
      uxState.extrusion = Math.max(0, uxState.extrusion - 1);
      updatePreview(uxState.vertices, uxState.extrusion);
    }
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// --- Mouselook ---
let yaw = 0;
let pitch = 0;

renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
    return;
  }

  switch (uxState.t) {
    case 'idle':
      if (highlightedVertex) {
        uxState = { t: 'drawing', vertices: [{ ...highlightedVertex }] };
      }
      break;
    case 'drawing':
      if (highlightedVertex) {
        const v = { ...highlightedVertex };
        if (uxState.vertices.length >= 3 && vertexEqual(v, uxState.vertices[0])) {
          uxState = { t: 'polygon', vertices: uxState.vertices, extrusion: 0 };
        } else if (!vertexEqual(v, uxState.vertices[uxState.vertices.length - 1])) {
          uxState.vertices.push(v);
        }
      }
      break;
    case 'polygon':
      if (uxState.extrusion > 0) {
        if (acceptExtrusion(uxState.vertices, uxState.extrusion)) {
          uxState = { t: 'idle' };
        }
      }
      break;
  }
});

renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (uxState.t === 'polygon') {
    clearPreview();
    uxState = { t: 'idle' };
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  const sensitivity = 0.002;
  yaw -= e.movementX * sensitivity;
  pitch -= e.movementY * sensitivity;
  pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
});

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = viewWidth() / viewHeight();
  camera.updateProjectionMatrix();
  renderer.setSize(viewWidth(), viewHeight());
  composer.setSize(viewWidth(), viewHeight());
  resizeOverlay();
});

// --- Helpers ---
type ScreenPoint = { x: number; y: number };

function viewToScreen(view: THREE.Vector3): ScreenPoint {
  const ndc = view.clone().applyMatrix4(camera.projectionMatrix);
  return {
    x: (ndc.x * 0.5 + 0.5) * viewWidth(),
    y: (-ndc.y * 0.5 + 0.5) * viewHeight(),
  };
}

function projectVertex(v: Vertex): ScreenPoint | null {
  const worldPos = new THREE.Vector3(v.x, 0, v.z);
  const view = worldPos.applyMatrix4(camera.matrixWorldInverse);
  if (view.z > -0.2) return null; // behind near plane
  return viewToScreen(view);
}

function projectEdge(a: Vertex, b: Vertex): [ScreenPoint, ScreenPoint] | null {
  const nearZ = -0.2;
  const viewA = new THREE.Vector3(a.x, 0, a.z).applyMatrix4(camera.matrixWorldInverse);
  const viewB = new THREE.Vector3(b.x, 0, b.z).applyMatrix4(camera.matrixWorldInverse);

  if (viewA.z > nearZ && viewB.z > nearZ) return null; // both behind

  let clippedA = viewA;
  let clippedB = viewB;

  if (viewA.z > nearZ) {
    const t = (nearZ - viewB.z) / (viewA.z - viewB.z);
    clippedA = viewB.clone().lerp(viewA, t);
  } else if (viewB.z > nearZ) {
    const t = (nearZ - viewA.z) / (viewB.z - viewA.z);
    clippedB = viewA.clone().lerp(viewB, t);
  }

  return [viewToScreen(clippedA), viewToScreen(clippedB)];
}

function drawReticle() {
  const cx = viewWidth() / 2;
  const cy = viewHeight() / 2;
  const size = 8;

  olCtx.lineWidth = 4;
  olCtx.strokeStyle = 'black';
  olCtx.beginPath();
  olCtx.moveTo(cx, cy - size);
  olCtx.lineTo(cx, cy + size);
  olCtx.moveTo(cx - size, cy);
  olCtx.lineTo(cx + size, cy);
  olCtx.stroke();

  olCtx.lineWidth = 2;
  olCtx.strokeStyle = 'white';
  olCtx.beginPath();
  olCtx.moveTo(cx, cy - size);
  olCtx.lineTo(cx, cy + size);
  olCtx.moveTo(cx - size, cy);
  olCtx.lineTo(cx + size, cy);
  olCtx.stroke();
}

function drawHighlight(sx: number, sy: number) {
  olCtx.beginPath();
  olCtx.arc(sx, sy, 9, 0, Math.PI * 2);
  olCtx.lineWidth = 3;
  olCtx.strokeStyle = 'black';
  olCtx.stroke();
  olCtx.lineWidth = 1.5;
  olCtx.strokeStyle = 'yellow';
  olCtx.stroke();
}

function drawUxState() {
  if (uxState.t === 'idle') return;
  const verts = uxState.vertices;
  const closed = uxState.t === 'polygon';

  // Edges
  const edgeCount = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    const edge = projectEdge(verts[i], verts[(i + 1) % verts.length]);
    if (!edge) continue;
    const [a, b] = edge;
    olCtx.beginPath();
    olCtx.moveTo(a.x, a.y);
    olCtx.lineTo(b.x, b.y);
    olCtx.lineWidth = 3;
    olCtx.strokeStyle = '#444';
    olCtx.lineCap = 'round';
    olCtx.stroke();
  }

  // Vertices
  for (const v of verts) {
    const s = projectVertex(v);
    if (!s) continue;
    olCtx.beginPath();
    olCtx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    olCtx.fillStyle = 'white';
    olCtx.fill();
    olCtx.lineWidth = 2;
    olCtx.strokeStyle = '#444';
    olCtx.stroke();
  }
}

// --- Game loop ---
const moveSpeed = 5; // units per second
let prevTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  prevTime = now;

  // Apply mouselook rotation
  const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);

  // Movement relative to camera facing direction (horizontal plane only)
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(camera.quaternion);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3(1, 0, 0);
  right.applyQuaternion(camera.quaternion);
  right.y = 0;
  right.normalize();

  const inputVel = new THREE.Vector3();

  if (keys['KeyW']) inputVel.add(forward);
  if (keys['KeyS']) inputVel.sub(forward);
  if (keys['KeyD']) inputVel.add(right);
  if (keys['KeyA']) inputVel.sub(right);

  if (inputVel.lengthSq() > 0) {
    inputVel.normalize().multiplyScalar(moveSpeed);
  }

  const onGround = checkCanJump();
  const airAccel = 0.05;
  const airDecel = 0.05;

  if (onGround) {
    playerBody.velocity.x = inputVel.x;
    playerBody.velocity.z = inputVel.z;
  } else {
    const airBlend = inputVel.lengthSq() > 0 ? airAccel : airDecel;
    playerBody.velocity.x += (inputVel.x - playerBody.velocity.x) * airBlend;
    playerBody.velocity.z += (inputVel.z - playerBody.velocity.z) * airBlend;
  }

  world.step(1 / 60, dt, 3);

  if (onGround) {
    playerBody.velocity.x = inputVel.x;
    playerBody.velocity.z = inputVel.z;
  }

  camera.position.set(
    playerBody.position.x,
    playerBody.position.y + eyeOffset,
    playerBody.position.z,
  );


  // --- Render 3D ---
  composer.render();

  // --- Render 2D overlay ---
  olCtx.clearRect(0, 0, viewWidth(), viewHeight());

  // Vertex highlight (only in idle/drawing states)
  highlightedVertex = null;
  if (uxState.t !== 'polygon') {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const groundHit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
    if (groundHit) {
      const vx = Math.round(groundHit.x);
      const vz = Math.round(groundHit.z);
      const vertexWorld = new THREE.Vector3(vx, 0, vz);
      const distToCamera = camera.position.distanceTo(vertexWorld);

      if (distToCamera < 8) {
        const ndc = vertexWorld.clone().project(camera);
        const screenDist = Math.sqrt(ndc.x * ndc.x + ndc.y * ndc.y);

        const ndcThreshold = 0.15 / distToCamera;
        if (screenDist < ndcThreshold) {
          highlightedVertex = { x: vx, z: vz };
          const sx = (ndc.x * 0.5 + 0.5) * viewWidth();
          const sy = (-ndc.y * 0.5 + 0.5) * viewHeight();
          drawHighlight(sx, sy);
        }
      }
    }
  } // end if not polygon

  drawUxState();
  drawReticle();
}

animate();

// --- Sidebar: physics test ---
const testBoxHalf = new CANNON.Vec3(0.3, 0.3, 0.3);
const testMeshes: THREE.Mesh[] = [];
const testBodies: CANNON.Body[] = [];

function launchTestBox(x: number, y: number, z: number, vx = 0, vz = 0) {
  const geo = new THREE.BoxGeometry(testBoxHalf.x * 2, testBoxHalf.y * 2, testBoxHalf.z * 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff4444 });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  testMeshes.push(mesh);

  const body = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Box(testBoxHalf),
    position: new CANNON.Vec3(x, y, z),
  });
  body.velocity.set(vx, 0, vz);
  world.addBody(body);
  testBodies.push(body);
}

document.getElementById('btn-test1')!.addEventListener('click', () => {
  launchTestBox(0, 8, -3.8);
});

document.getElementById('btn-test2')!.addEventListener('click', () => {
  launchTestBox(0, testBoxHalf.y, 2, 0, -5);
});

document.getElementById('btn-clear')!.addEventListener('click', () => {
  for (const mesh of testMeshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  for (const body of testBodies) {
    world.removeBody(body);
  }
  testMeshes.length = 0;
  testBodies.length = 0;
});

// Sync test sphere meshes with physics in the animation loop
const origAnimate = animate;
function syncTestBodies() {
  for (let i = 0; i < testBodies.length; i++) {
    const b = testBodies[i];
    const m = testMeshes[i];
    m.position.set(b.position.x, b.position.y, b.position.z);
    m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  }
}
// Inject sync into the render loop by patching the composer
const origRender = composer.render.bind(composer);
composer.render = function (...args: Parameters<typeof composer.render>) {
  syncTestBodies();
  return origRender(...args);
};
