# feat: scene3d plugin

Tracks: #600

## Goal

Add a `scene3d` plugin that renders declarative 3D data visualizations. Claude Code emits a single JSON document describing a scene; the plugin renders it with TresJS (Vue 3 Three.js bindings). Read-only viewer for now — no editing, no events back to the agent.

## Why TresJS over raw Three.js

- Declarative Vue templating is the house style. TresJS maps `<primitive object>` / `<TresMesh>` tags one-to-one to Three.js nodes, so the scene graph reads as templated Vue instead of imperative setup.
- Reactivity is opt-in — unchanged scene descriptions do not re-upload buffers.
- Cientos bundles OrbitControls + common geometries, eliminating the boilerplate 80% of our types need.

## Why a declarative JSON (over Plotly / ECharts-GL)

- Claude Code emits small, zod-validatable JSON; ECharts-GL/Plotly formats are huge and varied.
- Adds ~150 KB gzipped (TresJS + Three.js core + cientos partial) vs 1.5 MB for Plotly or 500 KB for echarts-gl.
- The plugin owns the visual style, so output looks consistent across scene types and across sessions.

## Schema (v1)

One scene document per call, persisted to `artifacts/scenes/<slug>.scene.json`.

```jsonc
{
  "title": "Cluster view",
  "objects": [
    {
      "kind": "scatter",
      "points": [[1, 2, 3], [4, 5, 6]],
      "color": "#4a9eff",
      "size": 0.1,
      "labels": ["A", "B"]
    }
  ],
  "camera": { "position": [10, 10, 10], "target": [0, 0, 0], "fov": 50 },
  "lights": [
    { "kind": "ambient", "intensity": 0.4 },
    { "kind": "directional", "position": [5, 10, 5], "intensity": 0.8 }
  ],
  "background": "#1a1a1a",
  "axes": true,
  "grid": true
}
```

### 13 object `kind`s

| kind        | shape                                               | purpose                                   |
| ----------- | --------------------------------------------------- | ----------------------------------------- |
| `scatter`   | `points: [x,y,z][]` + optional per-point color/size | point clouds, embeddings, clusters        |
| `line`      | `points: [x,y,z][]`                                 | trajectories, curves                      |
| `path`      | `points: [x,y,z][]` + `radius`                      | tube-thickened line                       |
| `vector`    | `arrows: [{origin, direction, length?}]`            | vector fields, gradients                  |
| `bar`       | `bars: [{x,z,height, color?}]`                      | 3D bar chart                              |
| `surface`   | `grid: number[][]` + `bounds`                       | height map z = f(x, y)                    |
| `mesh`      | `vertices`, `faces`, optional `colors`              | arbitrary geometry                        |
| `voxel`     | `cells: [{x,y,z, color?}]` + `size`                 | voxel grid                                |
| `network`   | `nodes[]` + `edges[]`                               | graph visualization                       |
| `tree`      | `nodes[]` with `parent` refs                        | hierarchical layout                       |
| `sphere`    | `center`, `radius`, `color?`                        | primitive                                 |
| `box`       | `center`, `size`, `color?`                          | primitive                                 |
| `cylinder`  | `center`, `radius`, `height`, `axis?`, `color?`     | primitive                                 |
| `text`      | `position`, `content`, `size?`, `color?`            | 3D label                                  |

Zod schemas live in `src/plugins/scene3d/schema.ts`, shared between server validation and View.vue runtime check.

## Architecture

Mirrors `presentChart` (see `server/api/routes/chart.ts`, `src/plugins/chart/`).

### Files added

```
src/plugins/scene3d/
  definition.ts          — ToolDefinition for gui-chat-protocol
  index.ts               — ToolPlugin wiring + types
  schema.ts              — Zod schemas (SceneDoc, Object*, Lights, ...)
  View.vue               — TresJS canvas + type-dispatch
  Preview.vue            — sidebar card
  renderers/
    Scatter.vue
    Line.vue
    Path.vue
    Vector.vue
    Bar.vue
    Surface.vue
    Mesh.vue
    Voxel.vue
    Network.vue
    Tree.vue
    Primitive.vue         (sphere/box/cylinder)
    Text.vue

server/api/routes/scene3d.ts  — POST /api/present-scene3d → writeWorkspaceText
test/plugins/scene3d/
  test_schema.ts              (zod round-trip, reject invalid)
  test_route.ts               (happy path + validation failures)
```

### Wiring touchpoints

- `src/tools/index.ts` — register `presentScene3d: scene3dPlugin`
- `src/config/roles.ts` — add `presentScene3d` to roles that should have it (default: same roles that have `presentChart`)
- `src/config/apiRoutes.ts` — `scene3d: { present: "/api/present-scene3d" }`
- `server/index.ts` — `app.use(scene3dRoutes)`
- `server/workspace/paths.ts` — `WORKSPACE_DIRS.scenes = "artifacts/scenes"` + entry in `WORKSPACE_PATHS` + add `"scenes"` to `EAGER_WORKSPACE_DIRS` if applicable

No MCP tool server entry — `presentScene3d` is a local plugin like `presentChart`, not a sandbox-side MCP bridge.

## Dependencies

```
yarn add three @tresjs/core @tresjs/cientos
yarn add -D @types/three
```

Size budget check: Three.js core (~150 KB gzipped), TresJS (~15 KB), cientos partial-import (~20 KB). Loads lazily on first scene open — importing the plugin's View.vue is dynamic in the existing plugin mount path.

## Phases

### Phase 1 — minimum viable 3D viewer

- Dependencies added + `yarn install` clean
- `WORKSPACE_DIRS.scenes` + `WORKSPACE_PATHS.scenes`
- Zod schema for `scatter`, `bar`, `surface`, `network`, `sphere`, `box`, `cylinder`, `text`, with scene-level `camera` / `lights` / `axes` / `grid` / `background`
- Server route + write-to-disk + response matching `presentChart`
- View.vue with TresJS canvas, OrbitControls, per-`kind` dispatcher component
- Preview.vue mirroring chart's preview
- Tool definition with every `kind`'s parameters inlined so Claude sees them on first use
- Unit tests: schema accept/reject, route happy path, route validation
- Sample `example.scene.json` fixture committed under `test/plugins/scene3d/` for manual smoke

### Phase 2 — remaining types + polish

- Add `line`, `path`, `vector`, `mesh`, `voxel`, `tree`
- Hover tooltips for scatter labels (html overlay via `Html` from cientos)
- Axes tick labels when `axes: true` is set
- Camera presets (`front`, `iso`, `top`) that the agent can request via `camera.preset`
- Performance: InstancedMesh for scatter with >1000 points, BufferGeometry reuse for voxel grids

### Out of scope (explicit)

- Animation / timelines
- WebXR / VR
- Runtime editing — this is a read-only viewer
- Agent-visible selection events — maybe v2
- Export to GLB / screenshot — maybe v2
- Streaming partial updates — maybe v2

## Open questions

- **Coordinate convention**: Y-up (Three.js default) vs Z-up (common in scientific data). Proposal: Y-up for consistency with TresJS default, document this at the top of the tool description so Claude emits accordingly.
- **Default point density**: how many scatter points before InstancedMesh kicks in? Proposal: 1000.
- **Color format**: accept `"#rrggbb"` only in v1 (not `rgb()`, not named). Simpler validation, matches ECharts convention.

## Risks

- **Three.js bundle**: +150 KB gzipped is non-trivial. Mitigated by lazy import — the dependency only loads when a scene is opened. Existing plugin mount path in `src/tools/index.ts` already loads plugins on demand.
- **TresJS API churn**: TresJS is pre-1.0 at time of writing. Pin minor version, watch for breaking changes on upgrade.
- **Schema surface area**: 13 types × scene-level options = a lot for Claude to learn. Mitigated by inlining the schema in the tool definition's `parameters.properties.document` (same trick `presentChart` uses for ECharts).

## Test plan

- `yarn lint` / `yarn typecheck` / `yarn test` — green
- Unit: zod round-trip for every `kind`, rejection for malformed input, route 400 on schema failure
- Manual: open a sample `.scene.json` via file explorer, verify OrbitControls + axes + scatter renders
- E2E (Phase 2): Playwright spec that mocks `/api/present-scene3d` and checks the canvas mounts without throwing
