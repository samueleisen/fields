import * as THREE from 'three';
import { SKY_COLOR } from './constants.js';

// ============================================================================
// Scene, Camera, Renderer & Fog Initialization
// ============================================================================
export function createScene() {
  const canvas = document.getElementById('webgl-canvas');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);

  // Subtle Far Horizon Fog: Starts at 240 and smoothly gradates out to 670
  const horizonFog = new THREE.Fog(SKY_COLOR, 240, 670);
  scene.fog = horizonFog;

  // Camera with extended far clipping plane
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    2500
  );

  // High performance WebGL Renderer with ACES tone mapping & soft shadows
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  // Responsive window resize handling
  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  return { canvas, scene, camera, renderer, horizonFog };
}
