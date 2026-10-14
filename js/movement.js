import * as THREE from 'three';
import { TERRAIN_SIZE, CAPSULE_HALF_HEIGHT } from './constants.js';
import { getTerrainHeight } from './terrain.js';

// ============================================================================
// Player Movement & Input Controller
// ============================================================================
export function setupPlayerMovement(player, camera, controls) {
  const MOVE_SPEED = 16.0; // Units per second
  const TURN_SPEED = 14.0; // Angular slerp rate
  const MAX_RADIUS = (TERRAIN_SIZE * 0.5) - 30.0; // Boundary limit inside terrain

  const keys = {
    forward: false,
    backward: false,
    left: false,
    right: false
  };

  // Keyboard Event Listeners
  window.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = true;
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = false;
        break;
    }
  });

  // Reusable vectors for performance
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const moveDirection = new THREE.Vector3();
  const currentVelocity = new THREE.Vector3();
  const targetVelocity = new THREE.Vector3();
  const targetRotation = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);

  // Track previous player position for camera delta translation
  const previousPlayerPos = player.group.position.clone();

  function update(delta) {
    // 1. Calculate camera-relative forward and right vectors on horizontal X-Z plane
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) {
      forward.set(0, 0, -1);
    } else {
      forward.normalize();
    }

    right.crossVectors(forward, yAxis).normalize();

    // 2. Assemble input direction
    moveDirection.set(0, 0, 0);
    if (keys.forward) moveDirection.add(forward);
    if (keys.backward) moveDirection.sub(forward);
    if (keys.right) moveDirection.add(right);
    if (keys.left) moveDirection.sub(right);

    const isMoving = moveDirection.lengthSq() > 0.001;

    if (isMoving) {
      moveDirection.normalize();
      targetVelocity.copy(moveDirection).multiplyScalar(MOVE_SPEED);

      // Smoothly rotate the player group to face the movement direction
      const targetAngle = Math.atan2(moveDirection.x, moveDirection.z);
      targetRotation.setFromAxisAngle(yAxis, targetAngle);
      player.group.quaternion.slerp(targetRotation, 1.0 - Math.exp(-TURN_SPEED * delta));
    } else {
      targetVelocity.set(0, 0, 0);
    }

    // 3. Smooth acceleration / deceleration
    currentVelocity.lerp(targetVelocity, 1.0 - Math.exp(-12.0 * delta));

    // 4. Update horizontal position
    if (currentVelocity.lengthSq() > 0.0001) {
      player.group.position.x += currentVelocity.x * delta;
      player.group.position.z += currentVelocity.z * delta;

      // Clamp position within the terrain boundary
      const distFromCenter = Math.sqrt(
        player.group.position.x * player.group.position.x +
        player.group.position.z * player.group.position.z
      );
      if (distFromCenter > MAX_RADIUS) {
        const scale = MAX_RADIUS / distFromCenter;
        player.group.position.x *= scale;
        player.group.position.z *= scale;
      }
    }

    // 5. Update vertical position according to the static uneven terrain height
    const groundHeight = getTerrainHeight(player.group.position.x, player.group.position.z);
    player.group.position.y = groundHeight + CAPSULE_HALF_HEIGHT;

    // 6. Third-Person Tracking Camera Follow:
    // Translate camera position and orbit target by the player's movement delta
    const deltaX = player.group.position.x - previousPlayerPos.x;
    const deltaY = player.group.position.y - previousPlayerPos.y;
    const deltaZ = player.group.position.z - previousPlayerPos.z;

    if (Math.abs(deltaX) > 1e-5 || Math.abs(deltaY) > 1e-5 || Math.abs(deltaZ) > 1e-5) {
      controls.target.x += deltaX;
      controls.target.y += deltaY;
      controls.target.z += deltaZ;

      camera.position.x += deltaX;
      camera.position.y += deltaY;
      camera.position.z += deltaZ;
    }

    previousPlayerPos.copy(player.group.position);
  }

  function teleport(x, z) {
    player.group.position.x = x;
    player.group.position.z = z;
    const groundHeight = getTerrainHeight(x, z);
    player.group.position.y = groundHeight + CAPSULE_HALF_HEIGHT;
    previousPlayerPos.copy(player.group.position);
    controls.target.copy(player.group.position);
    camera.position.set(x, player.group.position.y + 3.2, z + 7.5);
    camera.lookAt(controls.target);
    controls.update();
  }

  return { update, keys, teleport };
}
