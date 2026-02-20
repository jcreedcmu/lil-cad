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

// --- Vertex highlight & path ---
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();

type Vertex = { x: number; z: number };
const path: Vertex[] = [];
let highlightedVertex: Vertex | null = null;

// --- Input state ---
const keys: Record<string, boolean> = {};

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
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
  } else if (highlightedVertex) {
    path.push({ ...highlightedVertex });
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

function drawPath() {
  // Edges
  for (let i = 0; i < path.length - 1; i++) {
    const a = projectToScreen(path[i]);
    const b = projectToScreen(path[i + 1]);
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
  for (const v of path) {
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

  // Vertex highlight
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const groundHit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());

  highlightedVertex = null;
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

  drawPath();
  drawReticle();
}

animate();
