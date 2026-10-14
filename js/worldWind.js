import * as THREE from 'three';

// ============================================================================
// World Wind Environmental Service & Shader System
// ============================================================================
// Centralizes wind propagation front uniforms, mathematical GLSL functions,
// and CPU sampling for dynamic gameplay/audio parity.

export const WORLD_WIND_PARS_GLSL = /* glsl */ `
uniform float uWorldWindTime;
uniform vec2  uWorldWindDirection;
uniform float uWorldWindSpeed;
uniform vec3  uWorldWindGustColor;
uniform float uWorldWindGustStrength;
uniform float uWorldWindIdleStrength;
`;

export const WORLD_WIND_SAMPLER_GLSL = /* glsl */ `
struct WorldWindSample {
  float gustMask;
  float totalBend;
  vec2  direction;
  vec3  gustColor;
};

WorldWindSample sampleWorldWind(vec2 worldXZ, float time, float heightFactor) {
  // Coordinate advancing along the wind direction vector
  float windDist = dot(worldXZ, uWorldWindDirection) - time * uWorldWindSpeed;

  // Multi-harmonic propagation wave ribbons (Option B: Ghibli Gust)
  float waveMain = sin(windDist * 0.05);
  float waveMid  = sin(windDist * 0.11 + worldXZ.x * 0.02);
  float waveFine = sin(windDist * 0.22 - worldXZ.y * 0.018);

  // Shape waves into sharp, glowing ribbons with distinct leading crests
  float ribbon1 = pow(clamp(waveMain * 0.5 + 0.5, 0.0, 1.0), 3.0);
  float ribbon2 = pow(clamp(waveMid  * 0.5 + 0.5, 0.0, 1.0), 4.0);
  float ribbon3 = pow(clamp(waveFine * 0.5 + 0.5, 0.0, 1.0), 5.0);

  // Layered propagating front with crisp threshold
  float combinedFront = ribbon1 * 0.65 + ribbon2 * 0.38 + ribbon3 * 0.25;
  float gustMask = smoothstep(0.22, 0.65, combinedFront);

  // Idle gentle rustle + energetic gust deflection anchored at base with quadratic height curve
  float idleRustle = sin(time * 3.2 + worldXZ.x * 0.45 + worldXZ.y * 0.35) * uWorldWindIdleStrength;
  float hClamped = clamp(heightFactor, 0.0, 1.0);
  float bendCurve = hClamped * hClamped;
  float totalBend = (idleRustle + gustMask * uWorldWindGustStrength) * bendCurve;

  WorldWindSample result;
  result.gustMask   = gustMask;
  result.totalBend  = totalBend;
  result.direction  = uWorldWindDirection;
  result.gustColor  = uWorldWindGustColor;
  return result;
}
`;

export class WorldWind {
  /**
   * @param {Object} [options]
   * @param {THREE.Vector2|{x: number, y: number}} [options.direction] Direction vector in XZ plane (defaults to diagonal [0.707, 0.707])
   * @param {number} [options.speed=24.0] Gust traveling speed across world units
   * @param {THREE.Color|number|string} [options.gustColor=0x94f250] Luminous wave crest color
   * @param {number} [options.gustStrength=1.15] Foliage deflection multiplier during gust
   * @param {number} [options.idleStrength=0.12] Ambient foliage idle rustle multiplier
   */
  constructor(options = {}) {
    this.direction = options.direction instanceof THREE.Vector2
      ? options.direction.clone().normalize()
      : new THREE.Vector2(options.direction?.x ?? 0.707, options.direction?.y ?? 0.707).normalize();

    this.speed = options.speed ?? 24.0;
    this.gustColor = options.gustColor instanceof THREE.Color
      ? options.gustColor.clone()
      : new THREE.Color(options.gustColor ?? 0x94f250);

    this.gustStrength = options.gustStrength ?? 1.15;
    this.idleStrength = options.idleStrength ?? 0.12;

    // Centralized GPU uniforms shared across all subscriber materials
    this.uniforms = {
      uWorldWindTime: { value: 0 },
      uWorldWindDirection: { value: this.direction },
      uWorldWindSpeed: { value: this.speed },
      uWorldWindGustColor: { value: this.gustColor },
      uWorldWindGustStrength: { value: this.gustStrength },
      uWorldWindIdleStrength: { value: this.idleStrength }
    };

    // Reusable GLSL chunks
    this.glslPars = WORLD_WIND_PARS_GLSL;
    this.glslSampler = WORLD_WIND_SAMPLER_GLSL;
    this.glslChunk = `${WORLD_WIND_PARS_GLSL}\n${WORLD_WIND_SAMPLER_GLSL}`;
  }

  /**
   * Ticks the world wind simulation time uniform.
   * @param {number} elapsedTime Total elapsed time from engine clock
   */
  update(elapsedTime) {
    this.uniforms.uWorldWindTime.value = elapsedTime;
  }

  /**
   * Binds all world wind uniforms into a Three.js material shader.
   * @param {THREE.WebGLProgramParametersWithUniforms} shader
   */
  applyToShader(shader) {
    for (const [key, uniform] of Object.entries(this.uniforms)) {
      shader.uniforms[key] = uniform;
    }
  }

  /**
   * Dynamically adjust wind speed.
   * @param {number} newSpeed
   */
  setSpeed(newSpeed) {
    this.speed = newSpeed;
    this.uniforms.uWorldWindSpeed.value = newSpeed;
  }

  /**
   * Dynamically adjust wind direction vector.
   * @param {number} x
   * @param {number} z
   */
  setDirection(x, z) {
    this.direction.set(x, z).normalize();
    this.uniforms.uWorldWindDirection.value = this.direction;
  }

  /**
   * Pure CPU mathematical sampler with 100% parity with GPU GLSL sampleWorldWind.
   * Can be queried by audio engines, particle systems, or player physics.
   * @param {number} x World X coordinate
   * @param {number} z World Z coordinate
   * @param {number} [time] Timestamp (defaults to current simulation time)
   * @param {number} [heightFactor=1.0] Relative foliage height [0..1]
   */
  sample(x, z, time = this.uniforms.uWorldWindTime.value, heightFactor = 1.0) {
    const windDist = (x * this.direction.x + z * this.direction.y) - (time * this.speed);

    const waveMain = Math.sin(windDist * 0.05);
    const waveMid = Math.sin(windDist * 0.11 + x * 0.02);
    const waveFine = Math.sin(windDist * 0.22 - z * 0.018);

    const r1 = Math.pow(Math.min(Math.max(waveMain * 0.5 + 0.5, 0.0), 1.0), 3.0);
    const r2 = Math.pow(Math.min(Math.max(waveMid * 0.5 + 0.5, 0.0), 1.0), 4.0);
    const r3 = Math.pow(Math.min(Math.max(waveFine * 0.5 + 0.5, 0.0), 1.0), 5.0);

    const front = r1 * 0.65 + r2 * 0.38 + r3 * 0.25;
    const t = Math.min(Math.max((front - 0.22) / (0.65 - 0.22), 0.0), 1.0);
    const gustMask = t * t * (3 - 2 * t); // Hermite smoothstep interpolation

    const idle = Math.sin(time * 3.2 + x * 0.45 + z * 0.35) * this.idleStrength;
    const hClamped = Math.min(Math.max(heightFactor, 0.0), 1.0);
    const totalBend = (idle + gustMask * this.gustStrength) * (hClamped * hClamped);

    return {
      gustMask,
      totalBend,
      direction: this.direction,
      speed: this.speed,
      gustColor: this.gustColor
    };
  }
}
