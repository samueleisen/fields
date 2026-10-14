import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

// ============================================================================
// Dual-Generation 3D Pole Grass Field (Gen 1: Hero Bending + Gen 2: Rigid)
// ============================================================================
export function createGrass(scene, worldWind) {
  const POLE_HEIGHT = 2.0;
  const POLE_RADIUS_BOTTOM = 0.37;
  const POLE_RADIUS_TOP = 0.05;

  const dummy = new THREE.Object3D();

  // ==========================================================================
  // Generation 1: Hero Field (0m <= r <= 40m) with GPU Cantilever Bending
  // ==========================================================================
  const GEN1_RADIUS = 60.0;
  const GEN1_SPACING = 0.8;

  // Tapered 3-sided pole geometry (triangular prism: 3D from all angles, 3 height segments for bending)
  const poleGeoGen1 = new THREE.CylinderGeometry(
    POLE_RADIUS_TOP,
    POLE_RADIUS_BOTTOM,
    POLE_HEIGHT,
    3, // 3 radial segments = 3D volume from any camera orbit angle
    3, // 3 height segments = 4 vertical vertex levels for smooth bending
    false
  );
  poleGeoGen1.translate(0, POLE_HEIGHT * 0.5, 0); // Base sits at y = 0

  const poleMaterialGen1 = new THREE.MeshStandardMaterial({
    color: 0x4aa842,
    roughness: 0.65,
    metalness: 0.05,
    flatShading: false
  });

  // GPU Vertex Shader Bending via World Wind System on Generation 1
  if (worldWind) {
    poleMaterialGen1.onBeforeCompile = (shader) => {
      worldWind.applyToShader(shader);

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        varying float vPoleGustFactor;
        ${worldWind.glslChunk}
        `
      );

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

        // Sample centralized world wind system (idle rustle + gust wave front)
        WorldWindSample wind = sampleWorldWind(instanceRootPos.xz, uWorldWindTime, h);

        // Deflect along the traveling wind direction vector
        transformed.xz += wind.direction * (wind.totalBend * 0.85);

        // Arc downward to maintain physical stalk length
        transformed.y  -= (wind.totalBend * wind.totalBend) * 0.28;

        // Pass gust factor to fragment shader for tip illumination
        vPoleGustFactor = wind.gustMask * h;
        `
      );

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

  // Populate Gen 1 positions (circular hero field)
  const gen1Positions = [];
  for (let x = -GEN1_RADIUS; x <= GEN1_RADIUS; x += GEN1_SPACING) {
    for (let z = -GEN1_RADIUS; z <= GEN1_RADIUS; z += GEN1_SPACING) {
      const dist = Math.sqrt(x * x + z * z);
      if (dist <= GEN1_RADIUS) {
        const jx = x + (Math.random() - 0.5) * (GEN1_SPACING * 0.6);
        const jz = z + (Math.random() - 0.5) * (GEN1_SPACING * 0.6);
        const jy = getTerrainHeight(jx, jz);
        gen1Positions.push({ x: jx, y: jy, z: jz });
      }
    }
  }

  const gen1Count = gen1Positions.length;
  const instancedPolesGen1 = new THREE.InstancedMesh(poleGeoGen1, poleMaterialGen1, gen1Count);
  instancedPolesGen1.name = 'GrassGen1_Hero';
  instancedPolesGen1.castShadow = true;
  instancedPolesGen1.receiveShadow = true;

  for (let i = 0; i < gen1Count; i++) {
    const p = gen1Positions[i];
    dummy.position.set(p.x, p.y, p.z);
    const scaleXZ = 0.85 + Math.random() * 0.3;
    const scaleY = 0.9 + Math.random() * 0.25;
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();
    instancedPolesGen1.setMatrixAt(i, dummy.matrix);
  }
  instancedPolesGen1.instanceMatrix.needsUpdate = true;
  scene.add(instancedPolesGen1);

  // ==========================================================================
  // Generation 2: Outer Field (40m < r <= 90m) - Rigid (No Bending)
  // ==========================================================================
  const GEN2_RADIUS_INNER = GEN1_RADIUS;
  const GEN2_RADIUS_OUTER = 90.0;
  const GEN2_SPACING = 1.2;

  // Geometry: Same tapered triangular prism, optimized to 1 height segment (6 tris vs 18 tris)
  const poleGeoGen2 = new THREE.CylinderGeometry(
    POLE_RADIUS_TOP,
    POLE_RADIUS_BOTTOM,
    POLE_HEIGHT,
    3, // 3 radial segments
    1, // 1 height segment (rigid: identical silhouette, cuts triangle count by 66%)
    false
  );
  poleGeoGen2.translate(0, POLE_HEIGHT * 0.5, 0);

  // Material: Same stylized appearance with wind gust color shader (rigid, no bending)
  const poleMaterialGen2 = new THREE.MeshStandardMaterial({
    color: 0x4aa842,
    roughness: 0.65,
    metalness: 0.05,
    flatShading: false
  });

  // Wind Gust Tip Illumination Shader (Rigid - Zero Vertex Displacement)
  if (worldWind) {
    poleMaterialGen2.onBeforeCompile = (shader) => {
      worldWind.applyToShader(shader);

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        varying float vPoleGustFactor;
        ${worldWind.glslChunk}
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>

        #ifdef USE_INSTANCING
          vec3 instanceRootPos = instanceMatrix[3].xyz;
        #else
          vec3 instanceRootPos = vec3(0.0);
        #endif

        // Height factor along pole (0.0 at base, 1.0 at tip)
        float h = clamp(position.y / ${POLE_HEIGHT.toFixed(1)}, 0.0, 1.0);

        // Sample centralized world wind front
        WorldWindSample wind = sampleWorldWind(instanceRootPos.xz, uWorldWindTime, h);

        // Rigid: zero vertex displacement (no bending)
        // Pass gust factor to fragment shader for traveling wave illumination
        vPoleGustFactor = wind.gustMask * h;
        `
      );

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

  // Populate Gen 2 positions (annular outer ring)
  const gen2Positions = [];
  for (let x = -GEN2_RADIUS_OUTER; x <= GEN2_RADIUS_OUTER; x += GEN2_SPACING) {
    for (let z = -GEN2_RADIUS_OUTER; z <= GEN2_RADIUS_OUTER; z += GEN2_SPACING) {
      const dist = Math.sqrt(x * x + z * z);
      if (dist > GEN2_RADIUS_INNER && dist <= GEN2_RADIUS_OUTER) {
        const jx = x + (Math.random() - 0.5) * (GEN2_SPACING * 0.6);
        const jz = z + (Math.random() - 0.5) * (GEN2_SPACING * 0.6);
        const jy = getTerrainHeight(jx, jz);
        gen2Positions.push({ x: jx, y: jy, z: jz });
      }
    }
  }

  const gen2Count = gen2Positions.length;
  const instancedPolesGen2 = new THREE.InstancedMesh(poleGeoGen2, poleMaterialGen2, gen2Count);
  instancedPolesGen2.name = 'GrassGen2_OuterRigid';
  instancedPolesGen2.castShadow = true; // Cast shadows dynamically
  instancedPolesGen2.receiveShadow = true;

  for (let i = 0; i < gen2Count; i++) {
    const p = gen2Positions[i];
    dummy.position.set(p.x, p.y, p.z);
    const scaleXZ = 0.85 + Math.random() * 0.3;
    const scaleY = 0.9 + Math.random() * 0.25;
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();
    instancedPolesGen2.setMatrixAt(i, dummy.matrix);
  }
  instancedPolesGen2.instanceMatrix.needsUpdate = true;
  scene.add(instancedPolesGen2);

  return {
    mesh: instancedPolesGen1,
    meshGen1: instancedPolesGen1,
    meshGen2: instancedPolesGen2,
    material: poleMaterialGen1,
    materialGen2: poleMaterialGen2,
    countGen1: gen1Count,
    countGen2: gen2Count,
    count: gen1Count + gen2Count
  };
}
