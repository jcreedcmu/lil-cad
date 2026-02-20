import * as THREE from 'three';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- 2D overlay canvas ---
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const olCtx = overlay.getContext('2d')!;

function resizeOverlay() {
  const dpr = window.devicePixelRatio;
  overlay.width = window.innerWidth * dpr;
  overlay.height = window.innerHeight * dpr;
  overlay.style.width = window.innerWidth + 'px';
  overlay.style.height = window.innerHeight + 'px';
  olCtx.scale(dpr, dpr);
}
resizeOverlay();

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // light blue sky

// --- Camera ---
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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

function acceptExtrusion(vertices: Vertex[], extrusion: number) {
  clearPreview();
  const geo = makeExtrudedGeo(vertices, extrusion);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
}

// --- Input state ---
const keys: Record<string, boolean> = {};

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
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
        acceptExtrusion(uxState.vertices, uxState.extrusion);
        uxState = { t: 'idle' };
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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeOverlay();
});

// --- Helpers ---
function projectToScreen(v: Vertex): { x: number; y: number } | null {
  const world = new THREE.Vector3(v.x, 0, v.z);
  const ndc = world.project(camera);
  if (ndc.z > 1) return null; // behind camera
  return {
    x: (ndc.x * 0.5 + 0.5) * window.innerWidth,
    y: (-ndc.y * 0.5 + 0.5) * window.innerHeight,
  };
}

function drawReticle() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
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
    const a = projectToScreen(verts[i]);
    const b = projectToScreen(verts[(i + 1) % verts.length]);
    if (!a || !b) continue;
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
    const s = projectToScreen(v);
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

  const velocity = new THREE.Vector3();

  if (keys['KeyW']) velocity.add(forward);
  if (keys['KeyS']) velocity.sub(forward);
  if (keys['KeyD']) velocity.add(right);
  if (keys['KeyA']) velocity.sub(right);

  if (velocity.lengthSq() > 0) {
    velocity.normalize().multiplyScalar(moveSpeed * dt);
    camera.position.add(velocity);
  }

  // --- Render 3D ---
  renderer.render(scene, camera);

  // --- Render 2D overlay ---
  olCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

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
        const sx = (ndc.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
        drawHighlight(sx, sy);
      }
    }
  }
  } // end if not polygon

  drawUxState();
  drawReticle();
}

animate();
