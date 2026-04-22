import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentScene3d";

// Tool definition for the scene3d plugin. Document the schema inline
// so Claude sees every object `kind` on first invocation without
// having to probe. Keep the description dense — the full formal spec
// lives in src/plugins/scene3d/schema.ts.
//
// Coordinate convention: Y-up (Three.js default). All positions and
// directions are [x, y, z] number tuples. Colors are "#rrggbb" hex
// strings only (no "rgb()", no named colors).

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "Render a 3D data visualization. Pass a declarative scene document; the plugin draws it with Three.js + OrbitControls. " +
    "Use this for point clouds, 3D bar charts, height-map surfaces, graph/network layouts, or any scene that benefits from spatial rotation. " +
    "Coordinate system is Y-up. All colors MUST be `#rrggbb` hex strings. " +
    "Supported object kinds (v1): scatter, bar, surface, network, sphere, box, cylinder, text. " +
    "The document is persisted to artifacts/scenes/<slug>.scene.json so the user can re-open it from the file explorer.",
  parameters: {
    type: "object",
    properties: {
      document: {
        type: "object",
        description:
          "Scene document. `objects` is the primary payload; the scene-level `camera` / `lights` / `axes` / `grid` / `background` fields are optional.",
        properties: {
          title: {
            type: "string",
            description: "Optional human-friendly title. Used as the file slug and the preview label.",
          },
          objects: {
            type: "array",
            description:
              "Scene objects in rendering order. Each object is tagged by `kind`:\n" +
              "- scatter: { points: [x,y,z][], size?, color?, colors?[], sizes?[], labels?[] }\n" +
              "- bar: { bars: [{x,z,height, color?, label?}], width?, color? }\n" +
              "- surface: { grid: number[][], bounds: {xMin,xMax,zMin,zMax}, color?, wireframe? }\n" +
              "- network: { nodes: [{id, position, label?, color?, size?}], edges: [{from, to, weight?, color?}], nodeColor?, edgeColor?, nodeSize? }\n" +
              "- sphere: { center, radius, color? }\n" +
              "- box: { center, size, color? }\n" +
              "- cylinder: { center, radius, height, axis?, color? }\n" +
              "- text: { position, content, size?, color? }",
            items: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: ["scatter", "bar", "surface", "network", "sphere", "box", "cylinder", "text"],
                },
              },
              required: ["kind"],
            },
          },
          camera: {
            type: "object",
            description: "Optional camera pose. `position` and `target` are [x,y,z]; `fov` is degrees (default 50).",
            properties: {
              position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
              target: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
              fov: { type: "number" },
            },
          },
          lights: {
            type: "array",
            description:
              "Optional lights. Each: { kind: 'ambient' | 'directional' | 'point', intensity?, color?, position? (directional/point), distance? (point) }. " +
              "If omitted, the renderer adds a sensible default ambient + directional pair.",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["ambient", "directional", "point"] },
              },
              required: ["kind"],
            },
          },
          background: {
            type: "string",
            description: "Canvas background color as #rrggbb. Default #1a1a1a (dark charcoal).",
          },
          axes: {
            type: "boolean",
            description: "Show XYZ axis helper at origin. Default true.",
          },
          grid: {
            type: "boolean",
            description: "Show ground-plane grid helper. Default true.",
          },
        },
        required: ["objects"],
      },
      title: {
        type: "string",
        description: "Short label for the canvas preview. Defaults to document.title, or 'Scene' when both are blank.",
      },
    },
    required: ["document"],
  },
};

export default toolDefinition;
