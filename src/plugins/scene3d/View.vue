<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between">
      <span class="text-sm font-medium text-gray-700 truncate">
        {{ title ?? "Scene" }}
      </span>
      <span class="text-xs text-gray-500 shrink-0">{{ objectCount }} object{{ objectCount === 1 ? "" : "s" }}</span>
    </div>
    <div v-if="parseError" class="p-4 text-sm text-red-700 bg-red-50 border-t border-red-100">Invalid scene document: {{ parseError }}</div>
    <div v-else class="flex-1 relative min-h-0" data-testid="scene3d-canvas-wrapper">
      <!-- window-size on TresCanvas binds to window.innerHeight/width,
           which underfills a flex child (fixed aspect, usually narrow). We
           drop it and use a fully-absolute wrapper so the renderer reads
           the parent box via ResizeObserver instead. -->
      <div class="absolute inset-0">
        <TresCanvas v-if="scene" :clear-color="scene.background">
          <TresPerspectiveCamera :position="cameraPosition" :fov="cameraFov" :look-at="cameraTarget" />
          <OrbitControls :target="cameraTarget" />

          <SceneLights :lights="scene.lights" />
          <TresAxesHelper v-if="scene.axes" :args="[5]" />
          <TresGridHelper v-if="scene.grid" :args="[20, 20, 0x444444, 0x222222]" />

          <SceneObjectRenderer v-for="(object, idx) in scene.objects" :key="idx" :object="object" />
        </TresCanvas>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, type VNode } from "vue";
import { TresCanvas } from "@tresjs/core";
import { OrbitControls } from "@tresjs/cientos";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentScene3dData } from "./index";
import { sceneDocumentSchema, type SceneObject, type LightConfig, type BarObject, type SurfaceObject, type NetworkObject } from "./schema";
import { Vector3, BufferGeometry, Float32BufferAttribute } from "three";

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentScene3dData>;
}>();

const data = computed(() => props.selectedResult.data);
const title = computed(() => data.value?.title ?? data.value?.document?.title);
const objectCount = computed(() => data.value?.document?.objects?.length ?? 0);

const parseError = computed<string | null>(() => {
  const doc = data.value?.document;
  if (!doc) return "missing document";
  const parsed = sceneDocumentSchema.safeParse(doc);
  if (parsed.success) return null;
  return parsed.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
});

const scene = computed(() => {
  const doc = data.value?.document;
  if (!doc) return null;
  const parsed = sceneDocumentSchema.safeParse(doc);
  return parsed.success ? parsed.data : null;
});

const DEFAULT_CAMERA_POSITION: [number, number, number] = [10, 10, 10];
const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 0, 0];
const DEFAULT_CAMERA_FOV = 50;

const cameraPosition = computed(() => scene.value?.camera?.position ?? DEFAULT_CAMERA_POSITION);
const cameraTarget = computed(() => scene.value?.camera?.target ?? DEFAULT_CAMERA_TARGET);
const cameraFov = computed(() => scene.value?.camera?.fov ?? DEFAULT_CAMERA_FOV);

// ── Lights ──────────────────────────────────────────────────────
// Render each light as the matching Tres* element. Defaults to a
// sensible ambient+directional pair when the scene specifies no lights.
const SceneLights = defineComponent({
  name: "SceneLights",
  props: { lights: { type: Array, required: true } },
  setup(innerProps) {
    return () => {
      const lights = innerProps.lights as LightConfig[];
      const effective: LightConfig[] =
        lights.length > 0
          ? lights
          : [
              { kind: "ambient", intensity: 0.4 },
              { kind: "directional", position: [5, 10, 5], intensity: 0.8 },
            ];
      return effective.map((light, idx) => renderLight(light, idx));
    };
  },
});

function renderLight(light: LightConfig, idx: number): VNode {
  if (light.kind === "ambient") {
    return h("TresAmbientLight" as unknown as string, { key: idx, intensity: light.intensity, color: light.color });
  }
  if (light.kind === "directional") {
    return h("TresDirectionalLight" as unknown as string, { key: idx, position: light.position, intensity: light.intensity, color: light.color });
  }
  return h("TresPointLight" as unknown as string, {
    key: idx,
    position: light.position,
    intensity: light.intensity,
    distance: light.distance,
    color: light.color,
  });
}

// ── Object dispatcher ───────────────────────────────────────────

const SceneObjectRenderer = defineComponent({
  name: "SceneObjectRenderer",
  props: { object: { type: Object, required: true } },
  setup(innerProps) {
    return () => renderObject(innerProps.object as SceneObject);
  },
});

function renderObject(obj: SceneObject): VNode | VNode[] {
  switch (obj.kind) {
    case "scatter":
      return renderScatter(obj);
    case "bar":
      return renderBar(obj);
    case "surface":
      return renderSurface(obj);
    case "network":
      return renderNetwork(obj);
    case "sphere":
      return h("TresMesh" as unknown as string, { position: obj.center }, [
        h("TresSphereGeometry" as unknown as string, { args: [obj.radius, 32, 32] }),
        h("TresMeshStandardMaterial" as unknown as string, { color: obj.color }),
      ]);
    case "box":
      return h("TresMesh" as unknown as string, { position: obj.center }, [
        h("TresBoxGeometry" as unknown as string, { args: obj.size }),
        h("TresMeshStandardMaterial" as unknown as string, { color: obj.color }),
      ]);
    case "cylinder": {
      // Cylinder is oriented along Y by default in Three.js; rotate
      // when the user requested X or Z axis alignment.
      const rotation = obj.axis === "x" ? [0, 0, Math.PI / 2] : obj.axis === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0];
      return h("TresMesh" as unknown as string, { position: obj.center, rotation }, [
        h("TresCylinderGeometry" as unknown as string, { args: [obj.radius, obj.radius, obj.height, 32] }),
        h("TresMeshStandardMaterial" as unknown as string, { color: obj.color }),
      ]);
    }
    case "text":
      // v1 text placeholder: render a small billboard sprite so the
      // user sees *something* at the right spot. Upgrading to real
      // 3D text requires a font file (Text3D from cientos needs JSON
      // typeface). Tracked in plans/feat-scene3d-plugin.md Phase 2.
      return h("TresMesh" as unknown as string, { position: obj.position }, [
        h("TresSphereGeometry" as unknown as string, { args: [obj.size * 0.3, 16, 16] }),
        h("TresMeshBasicMaterial" as unknown as string, { color: obj.color }),
      ]);
  }
}

// ── Scatter ─────────────────────────────────────────────────────
// Build a THREE.Points with a BufferGeometry. Per-point colors when
// provided, otherwise the flat object-level color. Uniform size in
// v1 — per-point sizes need a custom shader (Phase 2).

function renderScatter(obj: Extract<SceneObject, { kind: "scatter" }>): VNode {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(obj.points.length * 3);
  for (let i = 0; i < obj.points.length; i++) {
    const point = obj.points[i];
    positions[i * 3] = point[0];
    positions[i * 3 + 1] = point[1];
    positions[i * 3 + 2] = point[2];
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

  if (obj.colors) {
    const colors = new Float32Array(obj.colors.length * 3);
    for (let i = 0; i < obj.colors.length; i++) {
      const hex = obj.colors[i];
      colors[i * 3] = parseInt(hex.slice(1, 3), 16) / 255;
      colors[i * 3 + 1] = parseInt(hex.slice(3, 5), 16) / 255;
      colors[i * 3 + 2] = parseInt(hex.slice(5, 7), 16) / 255;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  }

  return h("TresPoints" as unknown as string, {}, [
    h("primitive", { object: geometry, attach: "geometry" }),
    h("TresPointsMaterial" as unknown as string, {
      size: obj.size,
      color: obj.colors ? undefined : (obj.color ?? "#4a9eff"),
      vertexColors: Boolean(obj.colors),
      sizeAttenuation: true,
    }),
  ]);
}

// ── Bar ─────────────────────────────────────────────────────────
// One mesh per bar. For v1 this is fine up to a few hundred bars; if
// a user ships thousands we'll switch to InstancedMesh in Phase 2.

function renderBar(obj: BarObject): VNode[] {
  return obj.bars.map((bar, idx) => {
    const centerY = bar.height / 2;
    return h("TresMesh" as unknown as string, { key: idx, position: [bar.x, centerY, bar.z] as [number, number, number] }, [
      h("TresBoxGeometry" as unknown as string, { args: [obj.width, bar.height, obj.width] }),
      h("TresMeshStandardMaterial" as unknown as string, { color: bar.color ?? obj.color }),
    ]);
  });
}

// ── Surface ─────────────────────────────────────────────────────
// Build a parametric plane mesh from the grid. Row i corresponds to
// x = xMin + i * (xMax-xMin)/(rows-1); col j to z similarly. Triangles
// are two per quad.

function renderSurface(obj: SurfaceObject): VNode {
  const rows = obj.grid.length;
  const cols = obj.grid[0].length;
  const stepX = (obj.bounds.xMax - obj.bounds.xMin) / (rows - 1);
  const stepZ = (obj.bounds.zMax - obj.bounds.zMin) / (cols - 1);

  const positions = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const idx = (i * cols + j) * 3;
      positions[idx] = obj.bounds.xMin + i * stepX;
      positions[idx + 1] = obj.grid[i][j];
      positions[idx + 2] = obj.bounds.zMin + j * stepZ;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const topLeft = i * cols + j;
      const topRight = topLeft + 1;
      const bottomLeft = (i + 1) * cols + j;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return h("TresMesh" as unknown as string, {}, [
    h("primitive", { object: geometry, attach: "geometry" }),
    h("TresMeshStandardMaterial" as unknown as string, {
      color: obj.color,
      wireframe: obj.wireframe,
      side: 2, // THREE.DoubleSide
    }),
  ]);
}

// ── Network ─────────────────────────────────────────────────────
// Nodes are small spheres; edges are Line segments between node
// positions. All geometry built up-front — no force-directed layout
// in v1 (caller supplies positions).

function renderNetwork(obj: NetworkObject): VNode[] {
  const nodePositionById = new Map<string, [number, number, number]>();
  for (const node of obj.nodes) nodePositionById.set(node.id, node.position);

  const nodes = obj.nodes.map((node, idx) =>
    h("TresMesh" as unknown as string, { key: `n${idx}`, position: node.position }, [
      h("TresSphereGeometry" as unknown as string, { args: [node.size ?? obj.nodeSize, 16, 16] }),
      h("TresMeshStandardMaterial" as unknown as string, { color: node.color ?? obj.nodeColor }),
    ]),
  );

  // One geometry per edge keeps things simple; v2 can collapse to a
  // single LineSegments if edge counts get large.
  const edges = obj.edges.map((edge, idx) => {
    const fromPos = nodePositionById.get(edge.from);
    const toPos = nodePositionById.get(edge.to);
    if (!fromPos || !toPos) return null;
    const geometry = new BufferGeometry().setFromPoints([new Vector3(...fromPos), new Vector3(...toPos)]);
    return h("TresLine" as unknown as string, { key: `e${idx}` }, [
      h("primitive", { object: geometry, attach: "geometry" }),
      h("TresLineBasicMaterial" as unknown as string, { color: edge.color ?? obj.edgeColor }),
    ]);
  });

  return [...nodes, ...edges.filter((edge): edge is VNode => edge !== null)];
}
</script>
