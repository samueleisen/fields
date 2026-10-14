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

  // ==========================================================================
  // Generation 3: Horizon Field (90m < r <= 160m) - Flat Triangle Tracking Perspective
  // ==========================================================================
  const GEN3_RADIUS_INNER = GEN2_RADIUS_OUTER;
  const GEN3_RADIUS_OUTER = 160.0;
  const GEN3_SPACING = 1.3;

  // Single flat 2D triangle geometry (1 triangle = 3 vertices) - enlarged for distant horizon visibility
  const GEN3_WIDTH = 1.4;  // Expanded base width (1.40m)
  const GEN3_HEIGHT = 3.5; // Expanded height (3.50m)
  const TRI_BASE_HALF = GEN3_WIDTH * 0.5;

  const triangleGeo = new THREE.BufferGeometry();
  const triPositions = new Float32Array([
    -TRI_BASE_HALF, 0.0, 0.0,        // Vertex 0: Bottom-left
    TRI_BASE_HALF, 0.0, 0.0,        // Vertex 1: Bottom-right
    0.0, GEN3_HEIGHT, 0.0 // Vertex 2: Top-center tip
  ]);
  const triNormals = new Float32Array([
    0.0, 1, 0,
    0.0, 1, 0,
    0.0, 1, 0
  ]);
  const triUvs = new Float32Array([
    0.0, 0.0,
    1.0, 0.0,
    0.5, 1.0
  ]);
  const triIndices = new Uint16Array([0, 1, 2]);

  triangleGeo.setAttribute('position', new THREE.BufferAttribute(triPositions, 3));
  triangleGeo.setAttribute('normal', new THREE.BufferAttribute(triNormals, 3));
  triangleGeo.setAttribute('uv', new THREE.BufferAttribute(triUvs, 2));
  triangleGeo.setIndex(new THREE.BufferAttribute(triIndices, 1));

  // Unlit flat basic material for Gen 3: 100% full pure color, zero shadow receiving, zero lighting dimming
  const poleMaterialGen3 = new THREE.MeshBasicMaterial({
    color: 0xffffff, // White base diffuse so shader mix(North, South) determines exact RGB
    side: THREE.DoubleSide
  });

  // Player-relative gradient uniforms (Swapped: North = factor 1 / bright, South = factor 0)
  const gen3Uniforms = {
    uGen3PlayerPos: { value: new THREE.Vector3(0, 0, 0) },
    uGen3SouthDir: { value: new THREE.Vector2(0, -1).normalize() }, // Points North (-Z): North is factor 1, South is factor 0
    uGen3ColorNorth: { value: new THREE.Color(0x42a03a) },          // Factor 1: Bright yellow-green (North)
    uGen3ColorSouth: { value: new THREE.Color(0x00440e) }           // Factor 0: Deep meadow green (South)
  };

  // Perspective Billboarding + Player Gradient (North 1 / South 0) + Wind Gust Highlight
  poleMaterialGen3.onBeforeCompile = (shader) => {
    if (worldWind) {
      worldWind.applyToShader(shader);
    }

    for (const [key, uniform] of Object.entries(gen3Uniforms)) {
      shader.uniforms[key] = uniform;
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform vec3 uGen3PlayerPos;
      uniform vec2 uGen3SouthDir;
      varying float vGen3SideFactor;
      varying float vPoleGustFactor;
      ${worldWind ? worldWind.glslChunk : ''}
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

      // 1. Perspective Billboard Tracking:
      // Rotate around Y-axis so flat triangle always faces the camera perspective
      vec2 toView = cameraPosition.xz - instanceRootPos.xz;
      float viewDistSq = dot(toView, toView);
      vec2 forwardDir = viewDistSq > 0.0001 ? normalize(toView) : vec2(0.0, 1.0);
      vec2 rightDir = vec2(-forwardDir.y, forwardDir.x);

      // Orient flat triangle along tangent axis
      transformed.xz = rightDir * position.x;
      transformed.y  = position.y;

      // 2. Player-relative North/South gradient (North = factor 1, South = factor 0):
      vec2 offsetFromPlayer = instanceRootPos.xz - uGen3PlayerPos.xz;
      float offsetLen = length(offsetFromPlayer);
      vec2 dirFromPlayer = offsetLen > 0.01 ? offsetFromPlayer / offsetLen : vec2(0.0, -1.0);

      // Dot product with North direction vector (0, -1):
      // North blade (-Z) -> dot is +1.0 -> factor is 1.0 (uGen3ColorNorth: bright)
      // South blade (+Z) -> dot is -1.0 -> factor is 0.0 (uGen3ColorSouth: dark)
      float rawSide = dot(dirFromPlayer, uGen3SouthDir) * 0.5 + 0.5;
      vGen3SideFactor = smoothstep(0.05, 0.95, clamp(rawSide, 0.0, 1.0));

      // 3. Sample World Wind gust front for tip color illumination
      float h = clamp(position.y / ${GEN3_HEIGHT.toFixed(1)}, 0.0, 1.0);
      WorldWindSample wind = sampleWorldWind(instanceRootPos.xz, uWorldWindTime, h);
      vPoleGustFactor = wind.gustMask * h;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform vec3 uGen3ColorNorth;
      uniform vec3 uGen3ColorSouth;
      varying float vGen3SideFactor;
      varying float vPoleGustFactor;
      ${worldWind ? worldWind.glslPars : ''}
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // Factor 0 is South, Factor 1 is North
      vec3 gen3BaseColor = mix(uGen3ColorSouth, uGen3ColorNorth, vGen3SideFactor);
      diffuseColor.rgb = gen3BaseColor;

      // Layer World Wind gust wave highlight on top
      diffuseColor.rgb = mix(diffuseColor.rgb, uWorldWindGustColor, vPoleGustFactor * 0.05);
      `
    );
  };

  // Populate Gen 3 positions (annular outer horizon ring: 90m to 160m)
  const gen3Positions = [];
  for (let x = -GEN3_RADIUS_OUTER; x <= GEN3_RADIUS_OUTER; x += GEN3_SPACING) {
    for (let z = -GEN3_RADIUS_OUTER; z <= GEN3_RADIUS_OUTER; z += GEN3_SPACING) {
      const dist = Math.sqrt(x * x + z * z);
      if (dist > GEN3_RADIUS_INNER && dist <= GEN3_RADIUS_OUTER) {
        const jx = x + (Math.random() - 0.5) * (GEN3_SPACING * 0.6);
        const jz = z + (Math.random() - 0.5) * (GEN3_SPACING * 0.6);
        const jy = getTerrainHeight(jx, jz);
        gen3Positions.push({ x: jx, y: jy, z: jz });
      }
    }
  }

  const gen3Count = gen3Positions.length;
  const instancedPolesGen3 = new THREE.InstancedMesh(triangleGeo, poleMaterialGen3, gen3Count);
  instancedPolesGen3.name = 'GrassGen3_HorizonBillboard';
  instancedPolesGen3.castShadow = false;    // Strictly NO shadow casting for maximum performance
  instancedPolesGen3.receiveShadow = false; // Zero shadow receiving (pure unlit flat color)

  for (let i = 0; i < gen3Count; i++) {
    const p = gen3Positions[i];
    dummy.position.set(p.x, p.y, p.z);
    const scaleXZ = 0.85 + Math.random() * 0.3;
    const scaleY = 0.9 + Math.random() * 0.25;
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();
    instancedPolesGen3.setMatrixAt(i, dummy.matrix);
  }
  instancedPolesGen3.instanceMatrix.needsUpdate = true;
  scene.add(instancedPolesGen3);

  function update(playerPos) {
    if (playerPos) {
      gen3Uniforms.uGen3PlayerPos.value.copy(playerPos);
    }
  }

  function setPlayer(playerPos) {
    if (playerPos) {
      gen3Uniforms.uGen3PlayerPos.value = playerPos;
    }
  }

  function swapGradient() {
    gen3Uniforms.uGen3SouthDir.value.negate();
    console.log('[Grass] Gen 3 gradient swapped. Reference vector is now:', gen3Uniforms.uGen3SouthDir.value);
    return gen3Uniforms.uGen3SouthDir.value;
  }

  return {
    mesh: instancedPolesGen1,
    meshGen1: instancedPolesGen1,
    meshGen2: instancedPolesGen2,
    meshGen3: instancedPolesGen3,
    material: poleMaterialGen1,
    materialGen2: poleMaterialGen2,
    materialGen3: poleMaterialGen3,
    gen3Uniforms,
    update,
    setPlayer,
    swapGradient,
    countGen1: gen1Count,
    countGen2: gen2Count,
    countGen3: gen3Count,
    count: gen1Count + gen2Count + gen3Count
  };
}
