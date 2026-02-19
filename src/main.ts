import * as THREE from 'three';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // light blue sky

// --- Camera ---
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 5); // eye height ~1.6m

// --- Checkerboard floor ---
const floorSize = 100;
const tileCount = 50; // tiles per side
const canvas = document.createElement('canvas');
canvas.width = tileCount * 2;
canvas.height = tileCount * 2;
const ctx = canvas.getContext('2d')!;
for (let y = 0; y < tileCount * 2; y++) {
  for (let x = 0; x < tileCount * 2; x++) {
    ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#bbbbbb';
    ctx.fillRect(x, y, 1, 1);
  }
}
const floorTexture = new THREE.CanvasTexture(canvas);
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

// --- Vertex highlight ---
const vertexHighlight = document.getElementById('vertex-highlight') as HTMLElement;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();

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
  renderer.domElement.requestPointerLock();
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
});

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

  // --- Vertex highlight ---
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const groundHit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());

  vertexHighlight.style.display = 'none';
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
        const sx = (ndc.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
        vertexHighlight.style.left = `${sx}px`;
        vertexHighlight.style.top = `${sy}px`;
        vertexHighlight.style.transform = 'translate(-50%, -50%)';
        vertexHighlight.style.display = '';
      }
    }
  }

  renderer.render(scene, camera);
}

animate();
