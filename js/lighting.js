import * as THREE from 'three';

// ============================================================================
// Lighting Setup
// ============================================================================
export function createLighting(scene) {
  // Warm Sun Directional Light highlighting the rolling wavy landscape
  const sunLight = new THREE.DirectionalLight(0xfff8ea, 2.0);
  const sunOffset = new THREE.Vector3(40, 45, 30);
  sunLight.position.copy(sunOffset);

  // Shadow Map Configuration
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 150;
  sunLight.shadow.camera.left = -30;
  sunLight.shadow.camera.right = 30;
  sunLight.shadow.camera.top = 30;
  sunLight.shadow.camera.bottom = -30;
  sunLight.shadow.bias = -0.0003;
  sunLight.shadow.radius = 2.5;

  scene.add(sunLight);
  scene.add(sunLight.target); // Required in Three.js so target transforms take effect

  // Hemisphere Light (Sky ambient + Ground bounce)
  const hemiLight = new THREE.HemisphereLight(0x9bd8ff, 0x2e6628, 0.8);
  scene.add(hemiLight);

  // Subtle Ambient Fill
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambientLight);

  // Follow the player so the shadow camera frustum always stays centered on the character
  function update(playerPos) {
    if (!playerPos) return;
    sunLight.target.position.copy(playerPos);
    sunLight.position.copy(playerPos).add(sunOffset);
    sunLight.target.updateMatrixWorld();
  }

  return { sunLight, hemiLight, ambientLight, update };
}
