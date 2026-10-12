import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

// ============================================================================
// Spaced 2-Unit 3D Pole Grass Field with GPU Wind Bending
// ============================================================================
export function createGrass(scene, windUniforms) {
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

  // 3. GPU Vertex Shader Bending + Propagation Front
  poleMaterial.onBeforeCompile = (shader) => {
    // Share exact same wind uniforms from terrain
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDirection = windUniforms.uWindDirection;
    shader.uniforms.uWindSpeed = windUniforms.uWindSpeed;
    shader.uniforms.uGustColor = windUniforms.uGustColor;

    // Inject varying and uniforms into vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      varying float vPoleGustFactor;
      uniform float uTime;
      uniform vec2 uWindDirection;
      uniform float uWindSpeed;
      uniform vec3 uGustColor;
      `
    );

    // Apply quadratic bending rooted at base (y=0) and deflected along wind propagation front
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
      float bendCurve = h * h; // Quadratic bend: base stays anchored, tip deflects smoothly

      // Sample traveling wind propagation front at this pole's instance location
      float windDist = dot(instanceRootPos.xz, uWindDirection) - uTime * uWindSpeed;

      // Harmonic waves forming the propagating wind front ribbons
      float waveMain = sin(windDist * 0.05);
      float waveMid  = sin(windDist * 0.11 + instanceRootPos.x * 0.02);
      float waveFine = sin(windDist * 0.22 - instanceRootPos.z * 0.018);

      float ribbon1 = pow(clamp(waveMain * 0.5 + 0.5, 0.0, 1.0), 3.0);
      float ribbon2 = pow(clamp(waveMid  * 0.5 + 0.5, 0.0, 1.0), 4.0);
      float ribbon3 = pow(clamp(waveFine * 0.5 + 0.5, 0.0, 1.0), 5.0);

      float combinedFront = ribbon1 * 0.65 + ribbon2 * 0.38 + ribbon3 * 0.25;
      float gustMask = smoothstep(0.22, 0.65, combinedFront);

      // Idle gentle rustle + energetic gust deflection
      float idleRustle = sin(uTime * 3.2 + instanceRootPos.x * 0.45 + instanceRootPos.z * 0.35) * 0.12;
      float totalBend = (idleRustle + gustMask * 1.15) * bendCurve;

      // Deflect the pole along the traveling wind direction vector
      transformed.xz += uWindDirection * (totalBend * 0.85);

      // Arc downward to maintain physical pole stalk length
      transformed.y  -= (totalBend * totalBend) * 0.28;

      // Pass gust factor to fragment shader for tip illumination
      vPoleGustFactor = gustMask * h;
      `
    );

    // Fragment Shader: highlight the bent tips as the glowing gust sweeps through
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      varying float vPoleGustFactor;
      uniform vec3 uGustColor;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, uGustColor, vPoleGustFactor * 0.65);
      `
    );
  };

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
