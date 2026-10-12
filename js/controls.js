import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================================
// Camera & Orbit Controls
// ============================================================================
export function createControls(camera, domElement, player) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 2.5;
  controls.maxDistance = 260;
  // Max polar angle slightly above Math.PI / 2 to avoid cutting into the terrain
  controls.maxPolarAngle = Math.PI / 2 - 0.04;

  function resetCameraView() {
    const px = player.group.position.x;
    const py = player.group.position.y;
    const pz = player.group.position.z;

    controls.target.set(px, py + 0.3, pz);
    camera.position.set(px, py + 3.2, pz + 9.5);
    controls.update();
  }

  // Initialize camera position
  resetCameraView();

  return { controls, resetCameraView };
}
