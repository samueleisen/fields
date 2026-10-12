// ============================================================================
// Application Entry Point
// ============================================================================
import { createScene } from './js/scene.js';
import { createLighting } from './js/lighting.js';
import { createTerrain, getTerrainHeight } from './js/terrain.js';
import { createPlayer } from './js/player.js';
import { createControls } from './js/controls.js';
import { setupUI } from './js/ui.js';

// 1. Initialize Scene, Camera, Renderer & Fog
const { scene, camera, renderer, horizonFog } = createScene();

// 2. Setup Lighting (Sun, Hemisphere, Ambient)
createLighting(scene);

// 3. Create Static Wavy Terrain
const { material: terrainMaterial } = createTerrain(scene);

// 4. Create Static Vertical Capsule Player
const player = createPlayer(scene);

// 5. Setup Camera & Orbit Controls
const { controls, resetCameraView } = createControls(camera, renderer.domElement, player.yPosition);

// 6. Bind UI Dock Handlers
setupUI({ scene, horizonFog, terrainMaterial, resetCameraView });

// 7. Lean 60 FPS Render Loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// Export player and elevation helper for modular extension
export { player, getTerrainHeight };
