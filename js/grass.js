import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

// ============================================================================
// Spaced 2-Unit 3D Pole Grass Field with GPU Wind Bending
// ============================================================================
export function createGrass(scene, worldWind) {
  const POLE_HEIGHT = 2.0;
  const POLE_RADIUS_BOTTOM = 0.07;
  const POLE_RADIUS_TOP = 0.015;

  // 1. Tapered 3-sided pole geometry (triangular prism: 3D from all angles, ultra-lightweight)
  const poleGeometry = new THREE.CylinderGeometry(
    POLE_RADIUS_TOP,
    POLE_RADIUS_BOTTOM,
    POLE_HEIGHT,
    3, // 3 radial segments = 3D volume from any camera orbit angle
    3, // 3 height segments = 4 vertical vertex levels for smooth bending
    false
  );
  // Shift origin so the base of the pole sits exactly at y = 0
  poleGeometry.translate(0, POLE_HEIGHT * 0.5, 0);

  // 2. Base stylized grass material
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x4aa842,
    roughness: 0.65,
    metalness: 0.05,
    flatShading: false
  });

  // 3. GPU Vertex Shader Bending via World Wind System
  if (worldWind) {
    poleMaterial.onBeforeCompile = (shader) => {
      worldWind.applyToShader(shader);

      // Inject varying and World Wind GLSL chunk into vertex shader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        varying float vPoleGustFactor;
        ${worldWind.glslChunk}
        `
      );

      // Sample World Wind and apply cantilever bending + arc length conservation
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>

        #ifdef USE_INSTANCING
          vec3 instanceRootPos = instanceMatrix[3].xyz;
        #else
          vec3 instanceRootPos = vec3(0.0);
        #endif

        // Height factor along pole (0.0 at base root, 1.0 at tip)
        float h = clamp(position.y / ${POLE_HEIGHT.toFixed(1)}, 0.0, 1.0);

        // Sample centralized world wind system (incorporating idle rustle + gust wave)
        WorldWindSample wind = sampleWorldWind(instanceRootPos.xz, uWorldWindTime, h);

        // Deflect the pole along the traveling wind direction vector
        transformed.xz += wind.direction * (wind.totalBend * 0.85);

        // Arc downward to maintain physical pole stalk length
        transformed.y  -= (wind.totalBend * wind.totalBend) * 0.28;

        // Pass gust factor to fragment shader for tip illumination
        vPoleGustFactor = wind.gustMask * h;
        `
      );

      // Fragment Shader: highlight the bent tips as the glowing gust sweeps through
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `
        #include <common>
        varying float vPoleGustFactor;
        ${worldWind.glslPars}
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uWorldWindGustColor, vPoleGustFactor * 0.65);
        `
      );
    };
  }

  // 4. Generate Spaced Test Grid of Poles around Center Origin
  const FIELD_RADIUS = 35.0;
  const SPACING = 1.9; // Spaced out for lightweight performance and clear readability
  const positions = [];

  for (let x = -FIELD_RADIUS; x <= FIELD_RADIUS; x += SPACING) {
    for (let z = -FIELD_RADIUS; z <= FIELD_RADIUS; z += SPACING) {
      const dist = Math.sqrt(x * x + z * z);
      if (dist <= FIELD_RADIUS) {
        // Natural position jitter
        const jx = x + (Math.random() - 0.5) * (SPACING * 0.6);
        const jz = z + (Math.random() - 0.5) * (SPACING * 0.6);
        const jy = getTerrainHeight(jx, jz);
        positions.push({ x: jx, y: jy, z: jz });
      }
    }
  }

  const poleCount = positions.length;
  const instancedPoles = new THREE.InstancedMesh(poleGeometry, poleMaterial, poleCount);
  instancedPoles.castShadow = true;
  instancedPoles.receiveShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < poleCount; i++) {
    const p = positions[i];
    dummy.position.set(p.x, p.y, p.z);
    // Subtle height and width variety
    const scaleXZ = 0.85 + Math.random() * 0.3;
    const scaleY = 0.9 + Math.random() * 0.25;
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();
    instancedPoles.setMatrixAt(i, dummy.matrix);
  }

  instancedPoles.instanceMatrix.needsUpdate = true;
  scene.add(instancedPoles);

  return {
    mesh: instancedPoles,
    material: poleMaterial,
    count: poleCount
  };
}
