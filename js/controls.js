import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================================
// Camera & Orbit Controls
// ============================================================================
export function createControls(camera, domElement, playerYPosition) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 2.5;
  controls.maxDistance = 260;
  // Max polar angle slightly above Math.PI / 2 to avoid cutting into the terrain
  controls.maxPolarAngle = Math.PI / 2 - 0.04;

  function resetCameraView() {
    const defaultCamPos = new THREE.Vector3(0, playerYPosition + 3.2, 9.5);
    camera.position.copy(defaultCamPos);
    controls.target.set(0, playerYPosition + 0.3, 0);
    controls.update();
  }

  // Initialize camera position
  resetCameraView();

  return { controls, resetCameraView };
}
