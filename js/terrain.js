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

  // Base terrain material: Pure matte (Lambertian, zero specular highlight / glare)
  const terrainMaterial = new THREE.MeshLambertMaterial({
    color: 0x1e942b,
    flatShading: false
  });

  // 2-Color Directional Gradation Uniforms (Gen 3 Grass Harmony)
  const terrainUniforms = {
    uPlayerPosition: { value: new THREE.Vector3(0, 0, 0) },
    uNorthColor: { value: new THREE.Color(0x1e942b) }, // User Base Terrain Material Color (North)
    uSouthColor: { value: new THREE.Color(0x086618) }, // Gen 3 South Match (Deep meadow green)
    uNorthDir: { value: new THREE.Vector2(0, -1).normalize() }, // Points North (-Z)
    uGradationMix: { value: 1.0 },                       // 1.0 = active, 0.0 = solid 0x1e942b base
    uInnerRadius: { value: 25.0 },                      // 100% base color underfoot
    uOuterRadius: { value: 70.0 }                       // Blend out to full North/South gradation
  };

  terrainMaterial.customProgramCacheKey = () => 'terrain_2color_gradation_lambert_v1';

  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayerPosition = terrainUniforms.uPlayerPosition;
    shader.uniforms.uNorthColor = terrainUniforms.uNorthColor;
    shader.uniforms.uSouthColor = terrainUniforms.uSouthColor;
    shader.uniforms.uNorthDir = terrainUniforms.uNorthDir;
    shader.uniforms.uGradationMix = terrainUniforms.uGradationMix;
    shader.uniforms.uInnerRadius = terrainUniforms.uInnerRadius;
    shader.uniforms.uOuterRadius = terrainUniforms.uOuterRadius;

    // 1. Vertex Shader Injection: compute distance-weighted directional factor per-vertex
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform vec3 uPlayerPosition;
      uniform vec2 uNorthDir;
      uniform float uGradationMix;
      uniform float uInnerRadius;
      uniform float uOuterRadius;
      varying float vTerrainSideFactor;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `
      #include <worldpos_vertex>
      vec4 terrainWorldPos = modelMatrix * vec4( transformed, 1.0 );
      vec2 toVertex = terrainWorldPos.xz - uPlayerPosition.xz;
      float dist = length(toVertex);
      vec2 dir = dist > 0.05 ? toVertex / dist : vec2(0.0, -1.0);
      float rawSide = dot(dir, uNorthDir) * 0.5 + 0.5;

      // Distance-weighted blend:
      // 0 - 25m: 100% Base color (0x1e942b) underfoot (rock-solid stability)
      // 25m - 70m: gradual transition into North/South gradation (matches Gen 3 horizon foliage)
      float distWeight = smoothstep(uInnerRadius, uOuterRadius, dist);
      float directionalFactor = smoothstep(0.05, 0.95, clamp(rawSide, 0.0, 1.0));
      vTerrainSideFactor = mix(1.0, directionalFactor, distWeight * uGradationMix);
      `
    );

    // 2. Fragment Shader Injection: modulate base PBR albedo
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform vec3 uNorthColor;
      uniform vec3 uSouthColor;
      varying float vTerrainSideFactor;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // Factor 1.0 = North (0x1e942b), Factor 0.0 = South (0x02470f)
      diffuseColor.rgb = mix(uSouthColor, uNorthColor, vTerrainSideFactor);
      `
    );
  };

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

  function update(playerPos) {
    if (playerPos) {
      terrainUniforms.uPlayerPosition.value.copy(playerPos);
    }
  }

  function setColors(northHex, southHex) {
    if (northHex !== undefined) terrainUniforms.uNorthColor.value.set(northHex);
    if (southHex !== undefined) terrainUniforms.uSouthColor.value.set(southHex);
  }

  function swapDirection() {
    terrainUniforms.uNorthDir.value.negate();
    return terrainUniforms.uNorthDir.value;
  }

  function setGradationMix(val) {
    terrainUniforms.uGradationMix.value = Math.max(0.0, Math.min(1.0, val));
  }

  function setRadii(inner, outer) {
    if (inner !== undefined) terrainUniforms.uInnerRadius.value = inner;
    if (outer !== undefined) terrainUniforms.uOuterRadius.value = outer;
  }

  return {
    mesh: terrainMesh,
    material: terrainMaterial,
    uniforms: terrainUniforms,
    windUniforms: worldWind ? worldWind.uniforms : null,
    update,
    setColors,
    swapDirection,
    setGradationMix,
    setRadii
  };
}
