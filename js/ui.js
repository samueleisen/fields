// ============================================================================
// Interactive UI Dock Handlers
// ============================================================================
export function setupUI({ scene, horizonFog, terrainMaterial, resetCameraView }) {
  let fogActive = true;
  let wireframeActive = false;

  const btnResetCam = document.getElementById('btn-reset-cam');
  const btnToggleFog = document.getElementById('btn-toggle-fog');
  const btnToggleWireframe = document.getElementById('btn-toggle-wireframe');

  const fogLabel = document.getElementById('fog-label');
  const wireframeLabel = document.getElementById('wireframe-label');

  if (btnResetCam) {
    btnResetCam.addEventListener('click', () => {
      resetCameraView();
    });
  }

  if (btnToggleFog) {
    btnToggleFog.addEventListener('click', () => {
      fogActive = !fogActive;
      scene.fog = fogActive ? horizonFog : null;
      btnToggleFog.classList.toggle('active', fogActive);
      if (fogLabel) fogLabel.textContent = `Horizon Fog: ${fogActive ? 'On' : 'Off'}`;
    });
  }

  if (btnToggleWireframe) {
    btnToggleWireframe.addEventListener('click', () => {
      wireframeActive = !wireframeActive;
      terrainMaterial.wireframe = wireframeActive;
      btnToggleWireframe.classList.toggle('active', wireframeActive);
      if (wireframeLabel) wireframeLabel.textContent = `Wireframe: ${wireframeActive ? 'On' : 'Off'}`;
    });
  }

  // Press 'H' to toggle HUD visibility
  window.addEventListener('keydown', (e) => {
    // Avoid interfering if focus is in an input
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'h' || e.key === 'H') {
      document.body.classList.toggle('show-hud');
    }
  });
}
