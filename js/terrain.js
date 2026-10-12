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

export function createTerrain(scene) {
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

  // Wind Propagation Wave Uniforms (Option B: Stylized Ribbon / Ghibli Gust)
  const windUniforms = {
    uTime: { value: 0 },
    uWindDirection: { value: new THREE.Vector2(0.707, 0.707).normalize() },
    uWindSpeed: { value: 24.0 }, // Gust travel speed across hills
    uGustColor: { value: new THREE.Color(0x94f250) } // Glowing sunlit lime-green wave crest
  };

  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDirection = windUniforms.uWindDirection;
    shader.uniforms.uWindSpeed = windUniforms.uWindSpeed;
    shader.uniforms.uGustColor = windUniforms.uGustColor;

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

    // 2. In fragment shader, calculate the traveling propagation front
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      varying vec3 vTerrainWorldPos;
      uniform float uTime;
      uniform vec2 uWindDirection;
      uniform float uWindSpeed;
      uniform vec3 uGustColor;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>

      // Coordinate advancing along the wind direction vector
      float windDist = dot(vTerrainWorldPos.xz, uWindDirection) - uTime * uWindSpeed;

      // Stylized Ghibli Ribbon Waves:
      // Primary sweeping gust wave (frequent enough to always see in both foreground & hills)
      float waveMain = sin(windDist * 0.05);
      // Harmonic undulating ripples
      float waveMid  = sin(windDist * 0.11 + vTerrainWorldPos.x * 0.02);
      float waveFine = sin(windDist * 0.22 - vTerrainWorldPos.z * 0.018);

      // Shape waves into sharp, glowing ribbons with distinct leading crests
      float ribbon1 = pow(clamp(waveMain * 0.5 + 0.5, 0.0, 1.0), 3.0);
      float ribbon2 = pow(clamp(waveMid  * 0.5 + 0.5, 0.0, 1.0), 4.0);
      float ribbon3 = pow(clamp(waveFine * 0.5 + 0.5, 0.0, 1.0), 5.0);

      // Layered propagating front with crisp threshold
      float combinedFront = ribbon1 * 0.65 + ribbon2 * 0.38 + ribbon3 * 0.25;
      float gustMask = smoothstep(0.22, 0.65, combinedFront);

      // Blend base grass color with glowing sunlit gust ribbon
      diffuseColor.rgb = mix(diffuseColor.rgb, uGustColor, gustMask * 0.85);
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

  return { mesh: terrainMesh, material: terrainMaterial, windUniforms };
}
