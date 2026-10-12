import * as THREE from 'three';
import {
  CAPSULE_RADIUS,
  CAPSULE_LENGTH,
  TOTAL_PLAYER_HEIGHT,
  CAPSULE_HALF_HEIGHT
} from './constants.js';
import { getTerrainHeight } from './terrain.js';

// ============================================================================
// Static Vertical Capsule Shape Player
// ============================================================================
export function createPlayer(scene) {
  const playerGroup = new THREE.Group();

  // Upright capsule geometry (Y axis vertical)
  const capsuleGeometry = new THREE.CapsuleGeometry(
    CAPSULE_RADIUS,
    CAPSULE_LENGTH,
    24,
    36
  );

  // High-visibility stylish energetic coral capsule body
  const capsuleMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6347, // Tomato / Energetic Coral
    roughness: 0.32,
    metalness: 0.12
  });

  const capsuleMesh = new THREE.Mesh(capsuleGeometry, capsuleMaterial);
  capsuleMesh.castShadow = true;
  capsuleMesh.receiveShadow = true;
  playerGroup.add(capsuleMesh);

  // Stylized sleek dark visor accent on the player's front
  const visorGeometry = new THREE.BoxGeometry(0.68, 0.28, 0.38);
  const visorMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.1,
    metalness: 0.85
  });
  const visorMesh = new THREE.Mesh(visorGeometry, visorMaterial);
  visorMesh.position.set(0, 0.45, 0.42);
  visorMesh.castShadow = true;
  playerGroup.add(visorMesh);

  // Visor cyan glow trim
  const glowBarGeo = new THREE.BoxGeometry(0.58, 0.06, 0.4);
  const glowBarMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const glowBarMesh = new THREE.Mesh(glowBarGeo, glowBarMat);
  glowBarMesh.position.set(0, 0.45, 0.43);
  playerGroup.add(glowBarMesh);

  // Capsule base anchor ring
  const ringGeo = new THREE.TorusGeometry(0.58, 0.04, 16, 40);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.4,
    metalness: 0.7
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.y = 0;
  playerGroup.add(ringMesh);

  // Position the static capsule player vertically on top of the ground
  const groundCenterHeight = getTerrainHeight(0, 0);
  const playerYPosition = groundCenterHeight + CAPSULE_HALF_HEIGHT;
  playerGroup.position.set(0, playerYPosition, 0);
  scene.add(playerGroup);

  // Export player object and helper for seamless future player movement support
  return {
    group: playerGroup,
    radius: CAPSULE_RADIUS,
    height: TOTAL_PLAYER_HEIGHT,
    halfHeight: CAPSULE_HALF_HEIGHT,
    yPosition: playerYPosition,
    getGroundY: (x, z) => getTerrainHeight(x, z) + CAPSULE_HALF_HEIGHT
  };
}
