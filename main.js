// ============================================================================
// Application Entry Point
// ============================================================================
import * as THREE from 'three';
import { createScene } from './js/scene.js';
import { createLighting } from './js/lighting.js';
import { createTerrain, getTerrainHeight } from './js/terrain.js';
import { createPlayer } from './js/player.js';
import { createControls } from './js/controls.js';
import { setupPlayerMovement } from './js/movement.js';
import { setupUI } from './js/ui.js';

// 1. Initialize Scene, Camera, Renderer & Fog
const { scene, camera, renderer, horizonFog } = createScene();

// 2. Setup Lighting (Sun, Hemisphere, Ambient)
const lighting = createLighting(scene);

// 3. Create Static Wavy Terrain
const { material: terrainMaterial } = createTerrain(scene);

// 4. Create Vertical Capsule Player
const player = createPlayer(scene);

// 5. Setup Camera & Orbit Controls (Tracking Player)
const { controls, resetCameraView } = createControls(camera, renderer.domElement, player);

// 6. Setup Player Movement & Third-Person Camera Tracking
const playerMovement = setupPlayerMovement(player, camera, controls);

// 7. Bind UI Dock Handlers
setupUI({ scene, horizonFog, terrainMaterial, resetCameraView });

// 8. 60 FPS Render Loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.1);

  // Update player movement and camera tracking
  playerMovement.update(delta);

  // Update sun light & shadow map frustum to follow the player
  lighting.update(player.group.position);

  // Update orbit camera controls
  controls.update();

  renderer.render(scene, camera);
}
animate();

// Expose game instance for testing and debugging
if (typeof window !== 'undefined') {
  window.game = { player, controls, camera, playerMovement, getTerrainHeight, lighting };
}

// Export player and elevation helper for modular extension
export { player, getTerrainHeight, playerMovement };
