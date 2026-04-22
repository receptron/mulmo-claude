// Zod schemas for the scene3d plugin. Shared between the server
// route (validation) and View.vue (runtime check before rendering).
//
// Design notes:
// - Coordinate convention: Y-up (Three.js default). Documented in the
//   tool definition so Claude emits accordingly.
// - Color format: "#rrggbb" only. Rejects "rgb(...)", named colors, etc.
// - All positions / directions / sizes are Vec3 = [x, y, z] number tuples.
//
// Phase 1 scope: scatter, bar, surface, network, sphere, box, cylinder, text.
// Phase 2 adds: line, path, vector, mesh, voxel, tree.

import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be #rrggbb");
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

// ── Scene-level ─────────────────────────────────────────────────

const cameraSchema = z
  .object({
    position: vec3.optional(),
    target: vec3.optional(),
    fov: z.number().positive().max(180).optional(),
  })
  .strict();

const lightSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ambient"),
      intensity: z.number().nonnegative().default(0.4),
      color: hexColor.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("directional"),
      position: vec3,
      intensity: z.number().nonnegative().default(1),
      color: hexColor.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("point"),
      position: vec3,
      intensity: z.number().nonnegative().default(1),
      distance: z.number().nonnegative().optional(),
      color: hexColor.optional(),
    })
    .strict(),
]);

// ── Objects ─────────────────────────────────────────────────────

const scatterSchema = z
  .object({
    kind: z.literal("scatter"),
    points: z.array(vec3).min(1),
    // Per-point color overrides the object-level color when present.
    colors: z.array(hexColor).optional(),
    color: hexColor.optional(),
    // Per-point size overrides the object-level size when present.
    sizes: z.array(z.number().positive()).optional(),
    size: z.number().positive().default(0.1),
    // Optional text labels shown on hover. Length must match points
    // when provided; validated by the refine below.
    labels: z.array(z.string()).optional(),
  })
  .strict()
  .refine((obj) => !obj.colors || obj.colors.length === obj.points.length, {
    message: "scatter.colors length must match points length",
  })
  .refine((obj) => !obj.sizes || obj.sizes.length === obj.points.length, {
    message: "scatter.sizes length must match points length",
  })
  .refine((obj) => !obj.labels || obj.labels.length === obj.points.length, {
    message: "scatter.labels length must match points length",
  });

const barSchema = z
  .object({
    kind: z.literal("bar"),
    // Each bar: floor-plane position (x, z), height along Y, optional color.
    bars: z
      .array(
        z
          .object({
            x: z.number(),
            z: z.number(),
            height: z.number(),
            color: hexColor.optional(),
            label: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
    // Default bar footprint (side length on XZ plane).
    width: z.number().positive().default(0.8),
    // Fallback color used when a bar omits its own color.
    color: hexColor.default("#4a9eff"),
  })
  .strict();

const surfaceSchema = z
  .object({
    kind: z.literal("surface"),
    // grid[i][j] = z value at (x = xMin + i*dx, z = zMin + j*dz).
    // Not all rows must have the same length; validation enforces it.
    grid: z.array(z.array(z.number()).min(2)).min(2),
    bounds: z
      .object({
        xMin: z.number(),
        xMax: z.number(),
        zMin: z.number(),
        zMax: z.number(),
      })
      .strict()
      .refine((b) => b.xMax > b.xMin && b.zMax > b.zMin, {
        message: "bounds: xMax>xMin and zMax>zMin required",
      }),
    color: hexColor.default("#4a9eff"),
    wireframe: z.boolean().default(false),
  })
  .strict()
  .refine((obj) => obj.grid.every((row) => row.length === obj.grid[0].length), {
    message: "surface.grid rows must all have the same length",
  });

const networkNodeSchema = z
  .object({
    id: z.string(),
    position: vec3,
    label: z.string().optional(),
    color: hexColor.optional(),
    size: z.number().positive().optional(),
  })
  .strict();

const networkEdgeSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    weight: z.number().positive().optional(),
    color: hexColor.optional(),
  })
  .strict();

const networkSchema = z
  .object({
    kind: z.literal("network"),
    nodes: z.array(networkNodeSchema).min(1),
    edges: z.array(networkEdgeSchema).default([]),
    nodeColor: hexColor.default("#4a9eff"),
    edgeColor: hexColor.default("#888888"),
    nodeSize: z.number().positive().default(0.2),
  })
  .strict()
  .refine(
    (obj) => {
      const ids = new Set(obj.nodes.map((node) => node.id));
      return obj.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to));
    },
    { message: "network.edges reference ids not present in nodes" },
  );

const sphereSchema = z
  .object({
    kind: z.literal("sphere"),
    center: vec3,
    radius: z.number().positive(),
    color: hexColor.default("#4a9eff"),
  })
  .strict();

const boxSchema = z
  .object({
    kind: z.literal("box"),
    center: vec3,
    size: vec3,
    color: hexColor.default("#4a9eff"),
  })
  .strict();

const cylinderSchema = z
  .object({
    kind: z.literal("cylinder"),
    center: vec3,
    radius: z.number().positive(),
    height: z.number().positive(),
    // Axis along which the cylinder is oriented. Defaults to Y (up).
    axis: z.enum(["x", "y", "z"]).default("y"),
    color: hexColor.default("#4a9eff"),
  })
  .strict();

const textSchema = z
  .object({
    kind: z.literal("text"),
    position: vec3,
    content: z.string().min(1).max(200),
    size: z.number().positive().default(0.5),
    color: hexColor.default("#ffffff"),
  })
  .strict();

// Discriminated union so TypeScript can narrow by `kind`.
export const sceneObjectSchema = z.discriminatedUnion("kind", [
  scatterSchema,
  barSchema,
  surfaceSchema,
  networkSchema,
  sphereSchema,
  boxSchema,
  cylinderSchema,
  textSchema,
]);

// ── Scene document ──────────────────────────────────────────────

export const sceneDocumentSchema = z
  .object({
    title: z.string().optional(),
    objects: z.array(sceneObjectSchema).min(1).max(1000),
    camera: cameraSchema.optional(),
    lights: z.array(lightSchema).default([]),
    background: hexColor.default("#1a1a1a"),
    axes: z.boolean().default(true),
    grid: z.boolean().default(true),
  })
  .strict();

export type SceneDocument = z.infer<typeof sceneDocumentSchema>;
export type SceneObject = z.infer<typeof sceneObjectSchema>;
export type ScatterObject = z.infer<typeof scatterSchema>;
export type BarObject = z.infer<typeof barSchema>;
export type SurfaceObject = z.infer<typeof surfaceSchema>;
export type NetworkObject = z.infer<typeof networkSchema>;
export type SphereObject = z.infer<typeof sphereSchema>;
export type BoxObject = z.infer<typeof boxSchema>;
export type CylinderObject = z.infer<typeof cylinderSchema>;
export type TextObject = z.infer<typeof textSchema>;
export type LightConfig = z.infer<typeof lightSchema>;
export type CameraConfig = z.infer<typeof cameraSchema>;
