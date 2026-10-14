# Three.js 3D Horizon & World Wind Playground

A stylized, performant 3D web experience built with Three.js featuring rolling wavy terrain, procedural wind wave ribbons, 3D instanced cantilever grass, and third-person player movement.

---

## Current Architecture & Active State

| Subsystem | Source File | Current Configuration |
| :--- | :--- | :--- |
| **World Wind Engine** | [`js/worldWind.js`](js/worldWind.js) | Centralized atmospheric service with synchronized GPU GLSL chunks and CPU sampler (`speed = 24.0`). |
| **Ground Terrain** | [`js/terrain.js`](js/terrain.js) | Static undulating mesh ($1,400\text{m}$ size, 280 segments, 156.8k tris) with standard PBR shading (fragment wind wave disabled for optimal fillrate). |
| **Foliage / Grass** | [`js/grass.js`](js/grass.js) | **Tri-Tier Generation System**: <br>• **Gen 1 (Hero)**: $0 \le r \le 60\text{m}$, spacing $0.8\text{m}$, tapered 3-sided poles ($r_{\text{base}} = 0.37, r_{\text{tip}} = 0.05, 18\text{ tris}$) with GPU cantilever bending ($h^2$) and shadow casting.<br>• **Gen 2 (Mid)**: $60\text{m} < r \le 90\text{m}$, spacing $1.2\text{m}$, rigid triangular prism ($6\text{ tris}$, no bending, shadow casting enabled, gust wave highlight enabled).<br>• **Gen 3 (Horizon)**: $90\text{m} < r \le 160\text{m}$, spacing $1.6\text{m}$, single flat 2D triangle ($1\text{ tri}$) with GPU Y-axis perspective billboard tracking, double-sided shading, gust wave highlight, shadow casting disabled. |
| **Lighting & Shadows** | [`js/lighting.js`](js/lighting.js) | Directional sunlight with $2048 \times 2048$ shadow map tracking player (`SHADOW_EXTENT = 70`), hemisphere ambient light. |
| **Controls & Player** | [`js/controls.js`](js/controls.js), [`js/movement.js`](js/movement.js), [`js/player.js`](js/player.js) | Capsule character with WASD movement and damped OrbitControls camera. |
| **Diagnostics** | [`js/diagnostics.js`](js/diagnostics.js) | Detachable real-time computation and telemetry HUD (frame time, budget %, draw calls, triangles, VRAM, and p99 hitches). |

---

## Documentation Index (`docs/`)

- [`docs/grass-shape-and-bending.md`](docs/grass-shape-and-bending.md): **Active Grass Specification** — geometry dimensions, vertex shader bending math ($h^2$), and triangular prism volume.
- [`docs/world-wind-architecture.md`](docs/world-wind-architecture.md): **World Wind Subsystem** — architecture, uniforms, and shader integration guide.
- [`docs/computational-analysis.md`](docs/computational-analysis.md): **Scalability Benchmark** — detailed performance and arithmetic audit of high-density stress tests.
- [`docs/grass-behavior-breakdown.md`](docs/grass-behavior-breakdown.md): **Historical Benchmark** — reference document for dense prairie experiments.
