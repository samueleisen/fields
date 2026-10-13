import * as THREE from 'three';
import { TERRAIN_SIZE, TERRAIN_SEGMENTS } from './constants.js';

// ============================================================================
// Static Uneven Wavy Green Ground
// ============================================================================
// Richly undulating rolling hills with visible curves in all directions + gentle horizon curvature
export function getTerrainHeight(x, z) {
  // Layered wave curves: medium & rolling wavelengths for prominent hill curves
  const w1 = Math.sin(x * 0.036) * Math.cos(z * 0.036) * 6.5;
  const w2 = Math.sin(x * 0.072 - z * 0.06) * 3.2;
  const w3 = Math.cos(x * 0.018 + z * 0.022) * 4.2;

  // Gentle spherical horizon curvature: subtly curves the ground downward into the distance
  const distSq = x * x + z * z;
  const horizonCurve = -distSq * 0.00008;

  return w1 + w2 + w3 + horizonCurve;
}

export function createTerrain(scene, worldWind) {
  const terrainGeometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS
  );
  // Rotate so plane lies horizontally on the X-Z plane
  terrainGeometry.rotateX(-Math.PI / 2);

  const positionAttribute = terrainGeometry.attributes.position;
  // Bake static wavy elevation into the geometry once at startup
  for (let i = 0; i < positionAttribute.count; i++) {
    const vx = positionAttribute.getX(i);
    const vz = positionAttribute.getZ(i);
    positionAttribute.setY(i, getTerrainHeight(vx, vz));
  }
  terrainGeometry.computeVertexNormals();

  // Base terrain material
  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0x48a846,
    roughness: 0.82,
    metalness: 0.04,
    flatShading: false
  });

  // World Wind Shader Integration (Option B: Stylized Ribbon / Ghibli Gust)
  if (worldWind) {
    terrainMaterial.onBeforeCompile = (shader) => {
      worldWind.applyToShader(shader);

      // 1. Pass world position from vertex to fragment shader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        varying vec3 vTerrainWorldPos;
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

      // 2. In fragment shader, sample the centralized world wind wave front
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `
        #include <common>
        varying vec3 vTerrainWorldPos;
        ${worldWind.glslChunk}
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        WorldWindSample windSample = sampleWorldWind(vTerrainWorldPos.xz, uWorldWindTime, 0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, windSample.gustColor, windSample.gustMask * 0.85);
        `
      );
    };
  }

  const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Subtle terrain edge skirt or base ring to prevent any visible void
  const groundBaseGeo = new THREE.CylinderGeometry(
    TERRAIN_SIZE * 0.49,
    TERRAIN_SIZE * 0.49,
    6,
    64,
    1,
    true
  );
  const groundBaseMat = new THREE.MeshBasicMaterial({ color: 0x3b8b3a, side: THREE.BackSide });
  const groundBaseMesh = new THREE.Mesh(groundBaseGeo, groundBaseMat);
  groundBaseMesh.position.y = -3;
  scene.add(groundBaseMesh);

  return {
    mesh: terrainMesh,
    material: terrainMaterial,
    windUniforms: worldWind ? worldWind.uniforms : null
  };
}
