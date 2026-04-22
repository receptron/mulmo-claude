import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sceneDocumentSchema, sceneObjectSchema } from "../../../src/plugins/scene3d/schema";

// Happy paths: every v1 object kind parses.

describe("sceneDocumentSchema — accepts", () => {
  it("accepts a minimal scatter-only scene", () => {
    const parsed = sceneDocumentSchema.safeParse({
      objects: [
        {
          kind: "scatter",
          points: [
            [0, 0, 0],
            [1, 1, 1],
          ],
        },
      ],
    });
    assert.equal(parsed.success, true);
  });

  it("fills in defaults for scene-level flags", () => {
    const parsed = sceneDocumentSchema.parse({
      objects: [{ kind: "sphere", center: [0, 0, 0], radius: 1 }],
    });
    assert.equal(parsed.background, "#1a1a1a");
    assert.equal(parsed.axes, true);
    assert.equal(parsed.grid, true);
    assert.deepEqual(parsed.lights, []);
  });

  it("accepts every v1 object kind", () => {
    const parsed = sceneDocumentSchema.safeParse({
      title: "Kitchen sink",
      objects: [
        { kind: "scatter", points: [[0, 0, 0]] },
        { kind: "bar", bars: [{ x: 0, z: 0, height: 1 }] },
        {
          kind: "surface",
          grid: [
            [0, 1],
            [1, 2],
          ],
          bounds: { xMin: 0, xMax: 1, zMin: 0, zMax: 1 },
        },
        {
          kind: "network",
          nodes: [
            { id: "a", position: [0, 0, 0] },
            { id: "b", position: [1, 0, 0] },
          ],
          edges: [{ from: "a", to: "b" }],
        },
        { kind: "sphere", center: [0, 0, 0], radius: 1 },
        { kind: "box", center: [0, 0, 0], size: [1, 1, 1] },
        { kind: "cylinder", center: [0, 0, 0], radius: 1, height: 2 },
        { kind: "text", position: [0, 0, 0], content: "hi" },
      ],
    });
    assert.equal(parsed.success, true);
  });

  it("accepts all three light kinds", () => {
    const parsed = sceneDocumentSchema.safeParse({
      objects: [{ kind: "sphere", center: [0, 0, 0], radius: 1 }],
      lights: [
        { kind: "ambient", intensity: 0.5 },
        { kind: "directional", position: [1, 1, 1], intensity: 0.8 },
        { kind: "point", position: [0, 2, 0], intensity: 1, distance: 10 },
      ],
    });
    assert.equal(parsed.success, true);
  });
});

// Rejection paths: bad color / mismatched array lengths / empty inputs.

describe("sceneDocumentSchema — rejects", () => {
  it("rejects non-hex colors", () => {
    const result = sceneDocumentSchema.safeParse({
      objects: [{ kind: "sphere", center: [0, 0, 0], radius: 1, color: "red" }],
    });
    assert.equal(result.success, false);
  });

  it("rejects rgb()-style colors", () => {
    const result = sceneDocumentSchema.safeParse({
      objects: [{ kind: "sphere", center: [0, 0, 0], radius: 1, color: "rgb(255,0,0)" }],
    });
    assert.equal(result.success, false);
  });

  it("rejects empty objects array", () => {
    const result = sceneDocumentSchema.safeParse({ objects: [] });
    assert.equal(result.success, false);
  });

  it("rejects scatter with zero points", () => {
    const result = sceneObjectSchema.safeParse({ kind: "scatter", points: [] });
    assert.equal(result.success, false);
  });

  it("rejects scatter where colors length does not match points length", () => {
    const result = sceneObjectSchema.safeParse({
      kind: "scatter",
      points: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      colors: ["#ff0000"],
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.issues[0]?.message ?? "", /length must match/);
    }
  });

  it("rejects surface with ragged grid", () => {
    const result = sceneObjectSchema.safeParse({
      kind: "surface",
      grid: [
        [1, 2, 3],
        [1, 2],
      ],
      bounds: { xMin: 0, xMax: 1, zMin: 0, zMax: 1 },
    });
    assert.equal(result.success, false);
  });

  it("rejects surface with inverted bounds", () => {
    const result = sceneObjectSchema.safeParse({
      kind: "surface",
      grid: [
        [0, 0],
        [0, 0],
      ],
      bounds: { xMin: 1, xMax: 0, zMin: 0, zMax: 1 },
    });
    assert.equal(result.success, false);
  });

  it("rejects network edges pointing at unknown node ids", () => {
    const result = sceneObjectSchema.safeParse({
      kind: "network",
      nodes: [{ id: "a", position: [0, 0, 0] }],
      edges: [{ from: "a", to: "ghost" }],
    });
    assert.equal(result.success, false);
  });

  it("rejects unknown object kind", () => {
    const result = sceneObjectSchema.safeParse({ kind: "pyramid", center: [0, 0, 0] });
    assert.equal(result.success, false);
  });

  it("rejects negative radius on sphere", () => {
    const result = sceneObjectSchema.safeParse({ kind: "sphere", center: [0, 0, 0], radius: -1 });
    assert.equal(result.success, false);
  });

  it("rejects cylinder with non-xyz axis", () => {
    const result = sceneObjectSchema.safeParse({
      kind: "cylinder",
      center: [0, 0, 0],
      radius: 1,
      height: 2,
      axis: "w",
    });
    assert.equal(result.success, false);
  });
});
