// ============================================================================
// Standalone Detachable Computation & Telemetry Diagnostics Module
// ============================================================================
// Zero external dependencies. Self-injects its own UI and styles.
// Fully detachable at runtime via .detach() or clicking the close button,
// leaving zero traces in the workspace or DOM.

export function attachDiagnostics({ renderer, scene, hotkey = 'Backquote' }) {
  if (!renderer) {
    console.warn('[Diagnostics] Cannot attach: renderer is required.');
    return null;
  }

  // State & Metrics Ring Buffer
  const SAMPLE_SIZE = 120;
  const frameTimes = new Float32Array(SAMPLE_SIZE);
  const renderTimes = new Float32Array(SAMPLE_SIZE);
  let sampleIndex = 0;
  let sampleCount = 0;

  let lastFrameTime = performance.now();
  let frameCount = 0;
  let totalHitches = 0; // Frames taking > 16.67ms
  let isExpanded = true;
  let isVisible = false;
  let isDetached = false;

  // Cached scene stats (updated every 1 second to avoid per-frame traversal)
  let instancedBladesCount = 0;
  let instancedVRAMBytes = 0;
  let lastSceneScan = 0;

  // Detect GPU information via WebGL debug extension if available
  let gpuRendererName = 'WebGL2 Hardware';
  try {
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      gpuRendererName = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || gpuRendererName;
      // Truncate long driver strings
      if (gpuRendererName.length > 38) {
        gpuRendererName = gpuRendererName.substring(0, 35) + '...';
      }
    }
  } catch (e) {
    // Graceful fallback
  }

  // Scan scene for instanced meshes and calculate buffer footprint
  function scanScene() {
    if (!scene) return;
    let blades = 0;
    scene.traverse((obj) => {
      if (obj.isInstancedMesh && obj.count) {
        blades += obj.count;
      }
    });
    instancedBladesCount = blades;
    // 16 floats * 4 bytes per instance matrix
    instancedVRAMBytes = blades * 16 * 4;
  }
  scanScene();

  // --------------------------------------------------------------------------
  // Inject Scoped Stylesheet
  // --------------------------------------------------------------------------
  const styleEl = document.createElement('style');
  styleEl.id = 'telemetry-diagnostics-styles';
  styleEl.textContent = `
    .diag-root {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      user-select: none;
      pointer-events: auto;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .diag-root.hidden {
      display: none !important;
    }
    .diag-panel {
      width: 320px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05);
      color: #e2e8f0;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: diagFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .diag-pill {
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 24px;
      padding: 6px 14px;
      color: #f1f5f9;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      transition: all 0.2s ease;
    }
    .diag-pill:hover {
      background: rgba(30, 41, 59, 0.95);
      border-color: rgba(56, 189, 248, 0.4);
      transform: translateY(-1px);
    }
    .diag-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 8px;
    }
    .diag-title-row {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .diag-status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e;
      transition: background 0.3s ease, box-shadow 0.3s ease;
    }
    .diag-status-indicator.amber {
      background: #f59e0b;
      box-shadow: 0 0 8px #f59e0b;
    }
    .diag-status-indicator.red {
      background: #ef4444;
      box-shadow: 0 0 8px #ef4444;
    }
    .diag-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #94a3b8;
    }
    .diag-actions {
      display: flex;
      gap: 4px;
    }
    .diag-btn-icon {
      background: transparent;
      border: none;
      color: #94a3b8;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s ease;
    }
    .diag-btn-icon:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }
    .diag-btn-detach:hover {
      background: rgba(239, 68, 68, 0.2);
      color: #f87171;
    }
    .diag-gpu-tag {
      font-size: 10px;
      color: #64748b;
      background: rgba(255, 255, 255, 0.04);
      padding: 3px 6px;
      border-radius: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .diag-metric-hero {
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: rgba(255, 255, 255, 0.03);
      padding: 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .diag-hero-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }
    .diag-hero-value {
      font-size: 24px;
      font-weight: 700;
      color: #38bdf8;
      letter-spacing: -0.02em;
    }
    .diag-hero-unit {
      font-size: 13px;
      font-weight: 500;
      color: #94a3b8;
      margin-left: 2px;
    }
    .diag-hero-budget {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
    }
    .diag-meter-track {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 4px;
    }
    .diag-meter-fill {
      height: 100%;
      width: 0%;
      background: #38bdf8;
      border-radius: 3px;
      transition: width 0.2s ease, background 0.2s ease;
    }
    .diag-stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .diag-stat-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      padding: 7px 9px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .diag-stat-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      font-weight: 600;
    }
    .diag-stat-val {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
    }
    .diag-footer {
      font-size: 10px;
      color: #475569;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 6px;
    }
    .diag-kbd {
      background: rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      padding: 1px 4px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 9px;
    }
    @keyframes diagFadeIn {
      from { opacity: 0; transform: translateY(-6px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(styleEl);

  // --------------------------------------------------------------------------
  // Inject Root Container into DOM
  // --------------------------------------------------------------------------
  const rootEl = document.createElement('div');
  rootEl.id = 'telemetry-diagnostics-container';
  rootEl.className = 'diag-root hidden';
  rootEl.innerHTML = `
    <!-- Expanded Telemetry Panel -->
    <div id="diag-panel" class="diag-panel">
      <div class="diag-header">
        <div class="diag-title-row">
          <div id="diag-indicator" class="diag-status-indicator"></div>
          <span class="diag-title">Engine Telemetry</span>
        </div>
        <div class="diag-actions">
          <button id="diag-btn-minimize" class="diag-btn-icon" title="Minimize (or press ~)">_</button>
          <button id="diag-btn-detach" class="diag-btn-icon diag-btn-detach" title="Detach diagnostics from workspace">✕</button>
        </div>
      </div>

      <div class="diag-gpu-tag" title="${gpuRendererName}">
        ⚡ ${gpuRendererName}
      </div>

      <div class="diag-metric-hero">
        <div class="diag-hero-top">
          <div>
            <span id="diag-frame-ms" class="diag-hero-value">0.0</span>
            <span class="diag-hero-unit">ms / frame</span>
          </div>
          <div id="diag-budget-pct" class="diag-hero-budget">0% of 16.6ms</div>
        </div>
        <div class="diag-meter-track">
          <div id="diag-meter-bar" class="diag-meter-fill"></div>
        </div>
      </div>

      <div class="diag-stats-grid">
        <div class="diag-stat-card">
          <span class="diag-stat-label">Triangles</span>
          <span id="diag-val-tris" class="diag-stat-val">0</span>
        </div>
        <div class="diag-stat-card">
          <span class="diag-stat-label">Draw Calls</span>
          <span id="diag-val-calls" class="diag-stat-val">0</span>
        </div>
        <div class="diag-stat-card">
          <span class="diag-stat-label">3D Grass Blades</span>
          <span id="diag-val-blades" class="diag-stat-val">0</span>
        </div>
        <div class="diag-stat-card">
          <span class="diag-stat-label">Instance VRAM</span>
          <span id="diag-val-vram" class="diag-stat-val">0 KB</span>
        </div>
        <div class="diag-stat-card">
          <span class="diag-stat-label">Render Time</span>
          <span id="diag-val-render-ms" class="diag-stat-val">0.0 ms</span>
        </div>
        <div class="diag-stat-card">
          <span class="diag-stat-label">P99 Spike / Hitches</span>
          <span id="diag-val-p99" class="diag-stat-val">0.0 ms (0)</span>
        </div>
      </div>

      <div class="diag-footer">
        <span>Toggle: <span class="diag-kbd">~</span> or <span class="diag-kbd">F3</span></span>
        <span id="diag-heap-stat">JS Heap: --</span>
      </div>
    </div>

    <!-- Collapsed Micro-Pill -->
    <div id="diag-pill" class="diag-pill" style="display: none;">
      <div id="diag-pill-indicator" class="diag-status-indicator"></div>
      <span id="diag-pill-text">⚡ 0.0ms | 0k tris</span>
    </div>
  `;
  document.body.appendChild(rootEl);

  // Cached DOM query references
  const panelEl = rootEl.querySelector('#diag-panel');
  const pillEl = rootEl.querySelector('#diag-pill');
  const indicatorEl = rootEl.querySelector('#diag-indicator');
  const pillIndicatorEl = rootEl.querySelector('#diag-pill-indicator');
  const frameMsEl = rootEl.querySelector('#diag-frame-ms');
  const budgetPctEl = rootEl.querySelector('#diag-budget-pct');
  const meterBarEl = rootEl.querySelector('#diag-meter-bar');
  const valTrisEl = rootEl.querySelector('#diag-val-tris');
  const valCallsEl = rootEl.querySelector('#diag-val-calls');
  const valBladesEl = rootEl.querySelector('#diag-val-blades');
  const valVramEl = rootEl.querySelector('#diag-val-vram');
  const valRenderMsEl = rootEl.querySelector('#diag-val-render-ms');
  const valP99El = rootEl.querySelector('#diag-val-p99');
  const heapStatEl = rootEl.querySelector('#diag-heap-stat');
  const pillTextEl = rootEl.querySelector('#diag-pill-text');

  // Interactive buttons
  rootEl.querySelector('#diag-btn-minimize').addEventListener('click', toggleCollapse);
  rootEl.querySelector('#diag-btn-detach').addEventListener('click', detach);
  pillEl.addEventListener('click', toggleCollapse);

  function toggleCollapse() {
    isExpanded = !isExpanded;
    panelEl.style.display = isExpanded ? 'flex' : 'none';
    pillEl.style.display = isExpanded ? 'none' : 'flex';
  }

  function toggleVisibility() {
    isVisible = !isVisible;
    rootEl.classList.toggle('hidden', !isVisible);
  }

  // Global Hotkey Listener (~ or F3)
  const onKeyDown = (e) => {
    if (e.code === hotkey || e.key === '`' || e.key === 'F3') {
      e.preventDefault();
      toggleVisibility();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // --------------------------------------------------------------------------
  // Non-Invasive Wrapped Render Interceptor
  // --------------------------------------------------------------------------
  const originalRender = renderer.render.bind(renderer);

  renderer.render = function (activeScene, activeCamera) {
    if (isDetached) {
      return originalRender(activeScene, activeCamera);
    }

    const frameStart = performance.now();
    const frameDelta = frameStart - lastFrameTime;
    lastFrameTime = frameStart;

    // Track frame delta in ring buffer (skip first frame anomaly)
    if (frameCount > 0 && frameDelta < 500) {
      frameTimes[sampleIndex] = frameDelta;
      if (frameDelta > 16.67) totalHitches++;
    }

    // Execute Three.js rendering pass while measuring draw execution
    const renderStart = performance.now();
    originalRender(activeScene, activeCamera);
    const renderEnd = performance.now();

    renderTimes[sampleIndex] = renderEnd - renderStart;

    sampleIndex = (sampleIndex + 1) % SAMPLE_SIZE;
    sampleCount = Math.min(sampleCount + 1, SAMPLE_SIZE);
    frameCount++;

    return;
  };

  // --------------------------------------------------------------------------
  // Periodic UI Flush (Throttled to 4Hz to produce zero profiling overhead)
  // --------------------------------------------------------------------------
  const uiInterval = setInterval(() => {
    if (isDetached || !isVisible || sampleCount === 0) return;

    // Refresh scene instance counts periodically
    const now = performance.now();
    if (now - lastSceneScan > 1500) {
      scanScene();
      lastSceneScan = now;
    }

    // Compute metrics over sample window
    let sumFrame = 0;
    let sumRender = 0;
    const sortedFrames = [];

    for (let i = 0; i < sampleCount; i++) {
      const ft = frameTimes[i];
      sumFrame += ft;
      sumRender += renderTimes[i];
      sortedFrames.push(ft);
    }

    const avgFrame = sumFrame / sampleCount;
    const avgRender = sumRender / sampleCount;

    // P99 frame calculation
    sortedFrames.sort((a, b) => a - b);
    const p99Index = Math.min(Math.floor(sortedFrames.length * 0.99), sortedFrames.length - 1);
    const p99Val = sortedFrames[p99Index] || avgFrame;

    // Budget utilization relative to 60 FPS (16.66ms)
    const budgetPct = Math.round((avgFrame / 16.666) * 100);

    // Three.js renderer stats
    const info = renderer.info;
    const tris = info.render.triangles;
    const calls = info.render.calls;

    // Color status thresholds
    let statusClass = '';
    let barColor = '#38bdf8';
    if (budgetPct >= 85) {
      statusClass = 'red';
      barColor = '#ef4444';
    } else if (budgetPct >= 50) {
      statusClass = 'amber';
      barColor = '#f59e0b';
    }

    // Update Expanded Panel
    frameMsEl.textContent = avgFrame.toFixed(1);
    budgetPctEl.textContent = `${budgetPct}% of 16.6ms`;
    budgetPctEl.style.color = budgetPct >= 85 ? '#f87171' : budgetPct >= 50 ? '#fbbf24' : '#94a3b8';

    meterBarEl.style.width = `${Math.min(budgetPct, 100)}%`;
    meterBarEl.style.background = barColor;

    indicatorEl.className = `diag-status-indicator ${statusClass}`;
    pillIndicatorEl.className = `diag-status-indicator ${statusClass}`;

    valTrisEl.textContent = tris.toLocaleString();
    valCallsEl.textContent = calls;
    valBladesEl.textContent = instancedBladesCount > 0 ? instancedBladesCount.toLocaleString() : 'N/A';

    const vramKB = (instancedVRAMBytes / 1024).toFixed(1);
    valVramEl.textContent = instancedVRAMBytes > 1048576 ? `${(instancedVRAMBytes / 1048576).toFixed(2)} MB` : `${vramKB} KB`;

    valRenderMsEl.textContent = `${avgRender.toFixed(1)} ms`;
    valP99El.textContent = `${p99Val.toFixed(1)} ms (${totalHitches})`;

    // Memory Heap (Chromium)
    if (window.performance && window.performance.memory) {
      const heapMB = (window.performance.memory.usedJSHeapSize / 1048576).toFixed(1);
      heapStatEl.textContent = `JS Heap: ${heapMB} MB`;
    }

    // Update Collapsed Pill text
    const trisK = tris >= 1000 ? `${(tris / 1000).toFixed(1)}k` : tris;
    pillTextEl.textContent = `⚡ ${avgFrame.toFixed(1)}ms (${budgetPct}%) | ${trisK} tris | ${calls} calls`;
  }, 250);

  // --------------------------------------------------------------------------
  // Clean Detach / Teardown
  // --------------------------------------------------------------------------
  function detach() {
    if (isDetached) return;
    isDetached = true;

    // 1. Restore original renderer.render function
    renderer.render = originalRender;

    // 2. Clear intervals and remove listeners
    clearInterval(uiInterval);
    window.removeEventListener('keydown', onKeyDown);

    // 3. Remove DOM elements and styles
    if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);

    // 4. Remove global reference if set
    if (window.game && window.game.diagnostics) {
      delete window.game.diagnostics;
    }

    console.log('%c[Diagnostics] Detached cleanly from workspace.', 'color: #38bdf8; font-weight: bold;');
  }

  // --------------------------------------------------------------------------
  // Public Diagnostic Controller Interface
  // --------------------------------------------------------------------------
  const controller = {
    detach,
    toggle: toggleVisibility,
    toggleCollapse,
    getReport: () => {
      const info = renderer.info;
      const report = {
        avgFrameTimeMs: (frameTimes.reduce((a, b) => a + b, 0) / (sampleCount || 1)).toFixed(2),
        avgRenderTimeMs: (renderTimes.reduce((a, b) => a + b, 0) / (sampleCount || 1)).toFixed(2),
        triangles: info.render.triangles,
        drawCalls: info.render.calls,
        instancedBlades: instancedBladesCount,
        instancedVramBytes: instancedVRAMBytes,
        totalHitchesOver16ms: totalHitches
      };
      console.table(report);
      return report;
    }
  };

  return controller;
}
