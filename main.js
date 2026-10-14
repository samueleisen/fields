// ============================================================================
// Application Entry Point
// ============================================================================
import * as THREE from 'three';
import { createScene } from './js/scene.js';
import { createLighting } from './js/lighting.js';
import { WorldWind } from './js/worldWind.js';
import { createTerrain, getTerrainHeight } from './js/terrain.js';
import { createPlayer } from './js/player.js';
import { createGrass } from './js/grass.js';
import { createControls } from './js/controls.js';
import { setupPlayerMovement } from './js/movement.js';
import { setupUI } from './js/ui.js';
import { attachDiagnostics } from './js/diagnostics.js';

// 1. Initialize Scene, Camera, Renderer & Fog
const { scene, camera, renderer, horizonFog } = createScene();

// Detachable telemetry & computational diagnostics (removable at any time)
const diagnostics = attachDiagnostics({ renderer, scene });

// 2. Setup Lighting (Sun, Hemisphere, Ambient)
const lighting = createLighting(scene);

// 3. Initialize World Wind Environmental System
const worldWind = new WorldWind({ speed: 24.0 });

// 4. Create Static Wavy Terrain with World Wind Ribbon Shader
const terrain = createTerrain(scene, worldWind);

// 5. Create Spaced 2-Unit 3D Pole Grass Field with World Wind Bending
const grass = createGrass(scene, worldWind);

// 6. Create Vertical Capsule Player
const player = createPlayer(scene);

// 7. Setup Camera & Orbit Controls (Tracking Player)
const { controls, resetCameraView } = createControls(camera, renderer.domElement, player);

// 8. Setup Player Movement & Third-Person Camera Tracking
const playerMovement = setupPlayerMovement(player, camera, controls);

// 9. Bind UI Dock Handlers
setupUI({ scene, horizonFog, terrainMaterial: terrain.material, resetCameraView });

// 10. 60 FPS Render Loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.1);
  const elapsedTime = clock.getElapsedTime();

  // Tick the World Wind environmental system
  worldWind.update(elapsedTime);

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
  window.game = { player, controls, camera, playerMovement, getTerrainHeight, lighting, terrain, grass, worldWind, diagnostics };
}

// Export player, grass, world wind and elevation helper for modular extension
export { player, grass, worldWind, getTerrainHeight, playerMovement };
