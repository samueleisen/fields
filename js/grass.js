import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

// ============================================================================
// Dual-Generation 3D Pole Grass Field (Gen 1: Hero Bending + Gen 2: Rigid)
// ============================================================================

// Reusable GPU GLSL chunk for evaluating undulating terrain elevation in vertex shaders
export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
float getTerrainHeightGLSL(vec2 p) {
  float w1 = sin(p.x * 0.036) * cos(p.y * 0.036) * 6.5;
  float w2 = sin(p.x * 0.072 - p.y * 0.06) * 3.2;
  float w3 = cos(p.x * 0.018 + p.y * 0.022) * 4.2;
  float distSq = dot(p, p);
  float horizonCurve = -distSq * 0.00008;
  return w1 + w2 + w3 + horizonCurve;
}
`;

export function createGrass(scene, worldWind) {
  const POLE_HEIGHT = 2.0;
  const POLE_RADIUS_BOTTOM = 0.37;
  const POLE_RADIUS_TOP = 0.05;

  const dummy = new THREE.Object3D();

  // ==========================================================================
  // Foliage Multi-Tier Spatial Coverage & Overlap Configuration
  // ==========================================================================
  // An explicit +5m offset is applied to Gen 1 (65m reach vs 60m base), enabling
  // high-detail hero grass with bending & trampling collision to reach into Gen 2's
  // zone, creating an organic 15-meter interlocking blend zone [50m, 65m].
  const FOLIAGE_CONFIG = {
    gen1: {
      radius: 250.0,                         // Extended reach (+5m offset past 60m)
      gridCount: 160,                       // 160 x 160 = 25,600 blades
      spacing: 0.815,          // 0.8125m (exact seamless periodic tile)
      fadeStart: 240.0,                      // Begins gentle fade out
      fadeEnd: 250.0                         // Completely drops to 0 at tile boundary
    },
    gen2: {
      radius: 95.0,                         // Extended reach (+5m offset past 90m)
      gridCount: 190,                       // 190 x 190 = 36,100 blades
      spacing: 0.82,          // 1.0m (exact seamless periodic tile)
      fadeInnerStart: 50.0,                 // Begins rising at 50m (touches & overlaps Gen 1)
      fadeInnerEnd: 60.0,                   // Reaches full scale by 60m
      fadeOuterStart: 85.0,                 // Begins gentle fade into Gen 3
      fadeOuterEnd: 95.0                    // Completely drops to 0 at 95m boundary
    },
    gen3: {
      radius: 500.0,                        // 360m period (tile width)
      spacing: 1.4,                         // 200 x 200 = 40,000 blades
      fadeInnerStart: 80.0,                 // Overlaps Gen 2 in [80m, 95m]
      fadeInnerEnd: 90.0,                   // Reaches full scale by 90m
      fadeOuterStart: 160.0,                // Soft horizon dissolve
      fadeOuterEnd: 500.0                   // Completely drops to 0 at horizon boundary
    }
  };

  const GEN1_RADIUS = FOLIAGE_CONFIG.gen1.radius;
  const GEN1_SPACING = FOLIAGE_CONFIG.gen1.spacing;
  const GEN2_RADIUS_OUTER = FOLIAGE_CONFIG.gen2.radius;
  const GEN2_SPACING = FOLIAGE_CONFIG.gen2.spacing;
  const GEN3_RADIUS_OUTER = FOLIAGE_CONFIG.gen3.radius;
  const GEN3_SPACING = FOLIAGE_CONFIG.gen3.spacing;

  // ==========================================================================
  // Generation 1: Hero Field (0m <= r <= 65m) with GPU Cantilever Bending
  // ==========================================================================

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

  // ==========================================================================
  // Generation 1 Dynamic Player Collision Uniforms (0.00ms CPU overhead)
  // ==========================================================================
  const collisionUniforms = {
    uPlayerPosition: { value: new THREE.Vector3(0, 0, 0) },
    uCollisionRadius: { value: 1.5 },
    uCollisionStrength: { value: 1.35 }
  };

  // Shared GLSL uniform declarations for Gen 1 hero foliage
  const collisionParsGLSL = /* glsl */ `
    uniform vec3  uPlayerPosition;
    uniform float uCollisionRadius;
    uniform float uCollisionStrength;
  `;

  // Shared vertex displacement chunk: Toroidal Tracking + World Wind + Player Trampling
  const gen1VertexBendingGLSL = /* glsl */ `
    #include <begin_vertex>

    #ifdef USE_INSTANCING
      vec3 instanceRootPos = instanceMatrix[3].xyz;
    #else
      vec3 instanceRootPos = vec3(0.0);
    #endif

    // 1. Toroidal Wrap & Snapped Grid Tracking on GPU (0.00ms CPU overhead)
    const float GEN1_WIDTH = ${(FOLIAGE_CONFIG.gen1.radius * 2.0).toFixed(1)};
    vec2 wrapOffset = floor((uPlayerPosition.xz - instanceRootPos.xz + ${FOLIAGE_CONFIG.gen1.radius.toFixed(1)}) / GEN1_WIDTH) * GEN1_WIDTH;
    vec2 worldBladeXZ = instanceRootPos.xz + wrapOffset;
    float worldTerrainY = getTerrainHeightGLSL(worldBladeXZ);
    vec3 worldDelta = vec3(wrapOffset.x, worldTerrainY - instanceRootPos.y, wrapOffset.y);

    // 2. Soft Edge Distance Attenuation (shrinks to 0 height at boundary, eliminating pop-in)
    float distFromPlayer = length(worldBladeXZ - uPlayerPosition.xz);
    float edgeFade = 1.0 - smoothstep(${FOLIAGE_CONFIG.gen1.fadeStart.toFixed(1)}, ${FOLIAGE_CONFIG.gen1.fadeEnd.toFixed(1)}, distFromPlayer);
    transformed *= edgeFade;

    // Height factor along pole (0.0 at base root in soil, 1.0 at tip)
    float h = clamp(position.y / ${POLE_HEIGHT.toFixed(1)}, 0.0, 1.0);

    // 3. Environmental World Wind Deflection (cantilever bend)
    ${worldWind ? `
    WorldWindSample wind = sampleWorldWind(worldBladeXZ, uWorldWindTime, h);
    vec2 windDeflection = wind.direction * (wind.totalBend * 0.85);
    ` : `
    vec2 windDeflection = vec2(0.0);
    `}

    // 4. Dynamic Player Capsule Trampling / Parting Collision
    vec2 toBlade = worldBladeXZ - uPlayerPosition.xz;
    float distToPlayer = length(toBlade);

    // Radial push direction pointing outward away from player footprint
    vec2 pushDir = distToPlayer > 0.001 ? toBlade / distToPlayer : vec2(0.0, 1.0);

    // Interaction envelope: smooth falloff up to uCollisionRadius (1.5m)
    float pushMask = 1.0 - smoothstep(0.25, uCollisionRadius, distToPlayer);

    // Vertical proximity check: ensure player is near the ground level of this blade
    float footElevation = uPlayerPosition.y - 1.4;
    float vertDist = abs(worldTerrainY - footElevation);
    float vertMask = 1.0 - smoothstep(1.2, 2.4, vertDist);
    pushMask *= vertMask;

    // Root is anchored at soil (h = 0.0 -> push = 0.0). Deflection scales quadratically with height.
    float pushFactor = pushMask * (h * h) * uCollisionStrength;
    vec2 playerDeflection = pushDir * pushFactor;

    // 5. Combined Horizontal Deflection Vector
    vec2 totalHorizontal = windDeflection + playerDeflection;
    transformed.xz += totalHorizontal;

    // 6. Stalk Length Conservation: arc downward under horizontal tilt
    float stalkDrop = dot(totalHorizontal, totalHorizontal) * 0.22;
    transformed.y = max(transformed.y - stalkDrop, 0.02 * h);
  `;

  // GPU Vertex Shader Bending via World Wind System, Player Collision & GPU Tracking on Gen 1
  poleMaterialGen1.onBeforeCompile = (shader) => {
    if (worldWind) {
      worldWind.applyToShader(shader);
    }
    for (const [key, uniform] of Object.entries(collisionUniforms)) {
      shader.uniforms[key] = uniform;
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      ${TERRAIN_HEIGHT_GLSL}
      ${collisionParsGLSL}
      varying float vPoleGustFactor;
      ${worldWind ? worldWind.glslChunk : ''}
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      ${gen1VertexBendingGLSL}

      // Pass gust factor to fragment shader for tip illumination
      ${worldWind ? 'vPoleGustFactor = wind.gustMask * h;' : ''}
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        mvPosition = batchingMatrix * mvPosition;
      #endif
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        mvPosition.xyz += worldDelta;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `
      #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
        vec4 worldPosition = vec4( transformed, 1.0 );
        #ifdef USE_BATCHING
          worldPosition = batchingMatrix * worldPosition;
        #endif
        #ifdef USE_INSTANCING
          worldPosition = instanceMatrix * worldPosition;
          worldPosition.xyz += worldDelta;
        #endif
        worldPosition = modelMatrix * worldPosition;
      #endif
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      varying float vPoleGustFactor;
      ${worldWind ? worldWind.glslPars : ''}
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      ${worldWind ? 'diffuseColor.rgb = mix(diffuseColor.rgb, uWorldWindGustColor, vPoleGustFactor * 0.65);' : ''}
      `
    );
  };

  // Custom Depth Material: mirrors identical tracking, wind & collision displacement in sun shadow pass
  const customDepthMaterialGen1 = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking
  });

  customDepthMaterialGen1.onBeforeCompile = (shader) => {
    if (worldWind) {
      worldWind.applyToShader(shader);
    }
    for (const [key, uniform] of Object.entries(collisionUniforms)) {
      shader.uniforms[key] = uniform;
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      ${TERRAIN_HEIGHT_GLSL}
      ${collisionParsGLSL}
      ${worldWind ? worldWind.glslChunk : ''}
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      gen1VertexBendingGLSL
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        mvPosition = batchingMatrix * mvPosition;
      #endif
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        mvPosition.xyz += worldDelta;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
      `
    );
  };

  // Populate Gen 1 positions: exact periodic tile [-GEN1_RADIUS, +GEN1_RADIUS)
  // With 150 x 150 instances spaced at 0.8m (120m period), toroidal wrapping tiles the infinite plane seamlessly
  const gen1Positions = [];
  for (let x = -GEN1_RADIUS; x < GEN1_RADIUS - 0.001; x += GEN1_SPACING) {
    for (let z = -GEN1_RADIUS; z < GEN1_RADIUS - 0.001; z += GEN1_SPACING) {
      const jx = x + (Math.random() - 0.5) * (GEN1_SPACING * 0.6);
      const jz = z + (Math.random() - 0.5) * (GEN1_SPACING * 0.6);
      const jy = getTerrainHeight(jx, jz);
      gen1Positions.push({ x: jx, y: jy, z: jz });
    }
  }

  const gen1Count = gen1Positions.length;
  const instancedPolesGen1 = new THREE.InstancedMesh(poleGeoGen1, poleMaterialGen1, gen1Count);
  instancedPolesGen1.name = 'GrassGen1_Hero';
  instancedPolesGen1.castShadow = true;
  instancedPolesGen1.receiveShadow = true;
  instancedPolesGen1.frustumCulled = false; // Always render dynamic tracking mesh
  instancedPolesGen1.customDepthMaterial = customDepthMaterialGen1;

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

  // Geometry: Same tapered triangular prism, optimized to 1 height segment (6 tris vs 18 tris)
  const poleGeoGen2 = new THREE.CylinderGeometry(
    POLE_RADIUS_TOP - 0.05,
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

  // Wind Gust Tip Illumination & Toroidal Grid Tracking on Gen 2
  poleMaterialGen2.onBeforeCompile = (shader) => {
    if (worldWind) {
      worldWind.applyToShader(shader);
    }
    for (const [key, uniform] of Object.entries(collisionUniforms)) {
      shader.uniforms[key] = uniform;
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      ${TERRAIN_HEIGHT_GLSL}
      uniform vec3 uPlayerPosition;
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

      // 1. Toroidal Wrap & Snapped Grid Tracking on GPU (0.00ms CPU overhead)
      const float GEN2_WIDTH = ${(FOLIAGE_CONFIG.gen2.radius * 2.0).toFixed(1)};
      vec2 wrapOffset = floor((uPlayerPosition.xz - instanceRootPos.xz + ${FOLIAGE_CONFIG.gen2.radius.toFixed(1)}) / GEN2_WIDTH) * GEN2_WIDTH;
      vec2 worldBladeXZ = instanceRootPos.xz + wrapOffset;
      float worldTerrainY = getTerrainHeightGLSL(worldBladeXZ);
      vec3 worldDelta = vec3(wrapOffset.x, worldTerrainY - instanceRootPos.y, wrapOffset.y);

      // 2. Soft Cross-Fade: inner blend with Gen 1, outer blend with Gen 3
      float distFromPlayer = length(worldBladeXZ - uPlayerPosition.xz);
      float innerFade = smoothstep(${FOLIAGE_CONFIG.gen2.fadeInnerStart.toFixed(1)}, ${FOLIAGE_CONFIG.gen2.fadeInnerEnd.toFixed(1)}, distFromPlayer);
      float outerFade = 1.0 - smoothstep(${FOLIAGE_CONFIG.gen2.fadeOuterStart.toFixed(1)}, ${FOLIAGE_CONFIG.gen2.fadeOuterEnd.toFixed(1)}, distFromPlayer);
      transformed *= (innerFade * outerFade);

      // Height factor along pole (0.0 at base, 1.0 at tip)
      float h = clamp(position.y / ${POLE_HEIGHT.toFixed(1)}, 0.0, 1.0);

      // Sample centralized world wind front
      WorldWindSample wind = sampleWorldWind(worldBladeXZ, uWorldWindTime, h);
      vPoleGustFactor = wind.gustMask * h;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        mvPosition = batchingMatrix * mvPosition;
      #endif
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        mvPosition.xyz += worldDelta;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `
      #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
        vec4 worldPosition = vec4( transformed, 1.0 );
        #ifdef USE_BATCHING
          worldPosition = batchingMatrix * worldPosition;
        #endif
        #ifdef USE_INSTANCING
          worldPosition = instanceMatrix * worldPosition;
          worldPosition.xyz += worldDelta;
        #endif
        worldPosition = modelMatrix * worldPosition;
      #endif
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      varying float vPoleGustFactor;
      ${worldWind ? worldWind.glslPars : ''}
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

  // Custom Depth Material for Gen 2 (sun shadow map tracking parity)
  const customDepthMaterialGen2 = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking
  });

  customDepthMaterialGen2.onBeforeCompile = (shader) => {
    for (const [key, uniform] of Object.entries(collisionUniforms)) {
      shader.uniforms[key] = uniform;
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      ${TERRAIN_HEIGHT_GLSL}
      uniform vec3 uPlayerPosition;
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

      const float GEN2_WIDTH = ${(FOLIAGE_CONFIG.gen2.radius * 2.0).toFixed(1)};
      vec2 wrapOffset = floor((uPlayerPosition.xz - instanceRootPos.xz + ${FOLIAGE_CONFIG.gen2.radius.toFixed(1)}) / GEN2_WIDTH) * GEN2_WIDTH;
      vec2 worldBladeXZ = instanceRootPos.xz + wrapOffset;
      float worldTerrainY = getTerrainHeightGLSL(worldBladeXZ);
      vec3 worldDelta = vec3(wrapOffset.x, worldTerrainY - instanceRootPos.y, wrapOffset.y);

      float distFromPlayer = length(worldBladeXZ - uPlayerPosition.xz);
      float innerFade = smoothstep(${FOLIAGE_CONFIG.gen2.fadeInnerStart.toFixed(1)}, ${FOLIAGE_CONFIG.gen2.fadeInnerEnd.toFixed(1)}, distFromPlayer);
      float outerFade = 1.0 - smoothstep(${FOLIAGE_CONFIG.gen2.fadeOuterStart.toFixed(1)}, ${FOLIAGE_CONFIG.gen2.fadeOuterEnd.toFixed(1)}, distFromPlayer);
      transformed *= (innerFade * outerFade);
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        mvPosition = batchingMatrix * mvPosition;
      #endif
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        mvPosition.xyz += worldDelta;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
      `
    );
  };

  // Populate Gen 2 positions: exact periodic tile [-GEN2_RADIUS_OUTER, +GEN2_RADIUS_OUTER)
  // With 150 x 150 instances spaced at 1.2m (180m period), toroidal wrapping tiles the infinite plane seamlessly
  const gen2Positions = [];
  for (let x = -GEN2_RADIUS_OUTER; x < GEN2_RADIUS_OUTER - 0.001; x += GEN2_SPACING) {
    for (let z = -GEN2_RADIUS_OUTER; z < GEN2_RADIUS_OUTER - 0.001; z += GEN2_SPACING) {
      const jx = x + (Math.random() - 0.5) * (GEN2_SPACING * 0.6);
      const jz = z + (Math.random() - 0.5) * (GEN2_SPACING * 0.6);
      const jy = getTerrainHeight(jx, jz);
      gen2Positions.push({ x: jx, y: jy, z: jz });
    }
  }

  const gen2Count = gen2Positions.length;
  const instancedPolesGen2 = new THREE.InstancedMesh(poleGeoGen2, poleMaterialGen2, gen2Count);
  instancedPolesGen2.name = 'GrassGen2_OuterRigid';
  instancedPolesGen2.castShadow = true; // Cast shadows dynamically
  instancedPolesGen2.receiveShadow = true;
  instancedPolesGen2.frustumCulled = false; // Always render dynamic tracking mesh
  instancedPolesGen2.customDepthMaterial = customDepthMaterialGen2;

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

  // Single flat 2D triangle geometry (1 triangle = 3 vertices) - enlarged for distant horizon visibility
  const GEN3_WIDTH = 2.4;  // Expanded base width (1.40m)
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
    uGen3ColorNorth: { value: new THREE.Color(0x338235) },          // Factor 1: Bright yellow-green (North)
    uGen3ColorSouth: { value: new THREE.Color(0x165420) }           // Factor 0: Deep meadow green (South)
  };

  // Perspective Billboarding + Player Gradient (North 1 / South 0) + Wind Gust Highlight + GPU Tracking
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
      ${TERRAIN_HEIGHT_GLSL}
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

      // 1. Toroidal Wrap & Snapped Grid Tracking on GPU (0.00ms CPU overhead)
      const float GEN3_WIDTH = ${(FOLIAGE_CONFIG.gen3.radius * 2.0).toFixed(1)};
      vec2 wrapOffset = floor((uGen3PlayerPos.xz - instanceRootPos.xz + ${FOLIAGE_CONFIG.gen3.radius.toFixed(1)}) / GEN3_WIDTH) * GEN3_WIDTH;
      vec2 worldBladeXZ = instanceRootPos.xz + wrapOffset;
      float worldTerrainY = getTerrainHeightGLSL(worldBladeXZ);
      vec3 worldDelta = vec3(wrapOffset.x, worldTerrainY - instanceRootPos.y, wrapOffset.y);

      // 2. Soft Cross-Fade: inner blend with Gen 2, outer blend into horizon fog
      float distFromPlayer = length(worldBladeXZ - uGen3PlayerPos.xz);
      float innerFade = smoothstep(${FOLIAGE_CONFIG.gen3.fadeInnerStart.toFixed(1)}, ${FOLIAGE_CONFIG.gen3.fadeInnerEnd.toFixed(1)}, distFromPlayer);
      float outerFade = 1.0 - smoothstep(${FOLIAGE_CONFIG.gen3.fadeOuterStart.toFixed(1)}, ${FOLIAGE_CONFIG.gen3.fadeOuterEnd.toFixed(1)}, distFromPlayer);
      float fadeFactor = innerFade * outerFade;

      // 1. Perspective Billboard Tracking:
      // Rotate around Y-axis so flat triangle always faces the camera perspective from its actual world position
      vec2 toView = cameraPosition.xz - worldBladeXZ;
      float viewDistSq = dot(toView, toView);
      vec2 forwardDir = viewDistSq > 0.0001 ? normalize(toView) : vec2(0.0, 1.0);
      vec2 rightDir = vec2(-forwardDir.y, forwardDir.x);

      // Orient flat triangle along tangent axis and apply soft fade
      transformed.xz = rightDir * (position.x * fadeFactor);
      transformed.y  = position.y * fadeFactor;

      // 2. Player-relative North/South gradient (North = factor 1, South = factor 0):
      vec2 offsetFromPlayer = worldBladeXZ - uGen3PlayerPos.xz;
      float offsetLen = length(offsetFromPlayer);
      vec2 dirFromPlayer = offsetLen > 0.01 ? offsetFromPlayer / offsetLen : vec2(0.0, -1.0);

      // Dot product with North direction vector (0, -1):
      float rawSide = dot(dirFromPlayer, uGen3SouthDir) * 0.5 + 0.5;
      vGen3SideFactor = smoothstep(0.05, 0.95, clamp(rawSide, 0.0, 1.0));

      // 3. Sample World Wind gust front for tip color illumination
      float h = clamp(position.y / ${GEN3_HEIGHT.toFixed(1)}, 0.0, 1.0);
      WorldWindSample wind = sampleWorldWind(worldBladeXZ, uWorldWindTime, h);
      vPoleGustFactor = wind.gustMask * h;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        mvPosition = batchingMatrix * mvPosition;
      #endif
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        mvPosition.xyz += worldDelta;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
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
      diffuseColor.rgb = mix(diffuseColor.rgb, uWorldWindGustColor, vPoleGustFactor * 0.1);
      `
    );
  };

  // Populate Gen 3 positions: exact periodic tile [-GEN3_RADIUS_OUTER, +GEN3_RADIUS_OUTER)
  // With 200 x 200 instances spaced at 1.8m (360m period), toroidal wrapping tiles the infinite horizon seamlessly
  const gen3Positions = [];
  for (let x = -GEN3_RADIUS_OUTER; x < GEN3_RADIUS_OUTER - 0.001; x += GEN3_SPACING) {
    for (let z = -GEN3_RADIUS_OUTER; z < GEN3_RADIUS_OUTER - 0.001; z += GEN3_SPACING) {
      const jx = x + (Math.random() - 0.5) * (GEN3_SPACING * 0.6);
      const jz = z + (Math.random() - 0.5) * (GEN3_SPACING * 0.6);
      const jy = getTerrainHeight(jx, jz);
      gen3Positions.push({ x: jx, y: jy, z: jz });
    }
  }

  const gen3Count = gen3Positions.length;
  const instancedPolesGen3 = new THREE.InstancedMesh(triangleGeo, poleMaterialGen3, gen3Count);
  instancedPolesGen3.name = 'GrassGen3_HorizonBillboard';
  instancedPolesGen3.castShadow = false;    // Strictly NO shadow casting for maximum performance
  instancedPolesGen3.receiveShadow = false; // Zero shadow receiving (pure unlit flat color)
  instancedPolesGen3.frustumCulled = false; // Always render dynamic tracking mesh

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
      collisionUniforms.uPlayerPosition.value.copy(playerPos);
      gen3Uniforms.uGen3PlayerPos.value.copy(playerPos);
    }
  }

  function setPlayer(playerPos) {
    if (playerPos) {
      collisionUniforms.uPlayerPosition.value.copy(playerPos);
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
    customDepthMaterialGen1,
    customDepthMaterialGen2,
    collisionUniforms,
    gen3Uniforms,
    update,
    setPlayer,
    swapGradient,
    countGen1: gen1Count,
    countGen2: gen2Count,
    countGen3: gen3Count,
    count: gen1Count + gen2Count + gen3Count,
    config: FOLIAGE_CONFIG
  };
}
