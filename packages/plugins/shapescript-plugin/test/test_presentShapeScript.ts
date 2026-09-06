// Smoke coverage for the ported ShapeScript plugin: the tool's execute path,
// the parser, and the Three.js conversion. The renderer runs headless here —
// `astToThreeJS` builds geometry objects without touching a WebGL context.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TOOL_NAME, TOOL_DEFINITION, executePresentShapeScript } from "../src/core/index";
import { parseShapeScript } from "../src/shapescript/parser";
import { astToThreeJS } from "../src/shapescript/toThreeJS";

const context = {} as Parameters<typeof executePresentShapeScript>[0];

describe("presentShapeScript tool", () => {
  it("exposes the renamed tool name on both the constant and the definition", () => {
    assert.equal(TOOL_NAME, "presentShapeScript");
    assert.equal(TOOL_DEFINITION.name, "presentShapeScript");
  });

  // `data` is the host's render-eligibility signal: MulmoClaude's MCP bridge
  // pushes a tool result into the session — the event the canvas renders the
  // View from — ONLY when the handler set it. Dropping it would leave the LLM
  // reporting success while the user sees no 3D view, with nothing logged.
  it("returns the script as tool data, which is what makes the View render", async () => {
    const script = "cube { size 1 }";
    const result = await executePresentShapeScript(context, { title: "Cube", script });
    assert.equal(result.title, "Cube");
    assert.notEqual(result.data, undefined);
    assert.equal(result.data.script, script);
  });

  it("carries data for every shape of script, including CSG and loops", async () => {
    const scripts = ["cube { size 1 }", "difference {\n  sphere { size 2 }\n  sphere { size 1.7 }\n}", "for i in 1 to 4 {\n  cube { position (i * 2) 0 0 }\n}"];
    for (const script of scripts) {
      const result = await executePresentShapeScript(context, { title: "T", script });
      assert.notEqual(result.data, undefined, `no data for: ${script}`);
      assert.equal(result.data.script, script);
    }
  });

  it("rejects an empty script", async () => {
    await assert.rejects(() => executePresentShapeScript(context, { title: "Empty", script: "   " }), /ShapeScript code is required/);
  });
});

describe("ShapeScript pipeline", () => {
  it("parses primitives with properties", () => {
    const nodes = parseShapeScript("cube { position 1 2 3 size 0.5 color (1 0 0) }");
    assert.equal(nodes.length, 1);
    const node = nodes[0];
    assert.equal(node?.type, "shape");
    assert.equal(node?.type === "shape" ? node.primitive : undefined, "cube");
  });

  it("unrolls a for loop into one node per iteration", () => {
    const group = astToThreeJS(parseShapeScript("for i in 1 to 4 {\n  cube { position (i * 2) 0 0 size 1 }\n}"));
    const meshes: string[] = [];
    group.traverse((object) => {
      if (object.type === "Mesh") meshes.push(object.type);
    });
    assert.equal(meshes.length, 4);
  });

  it("evaluates built-in functions inside expressions", () => {
    const nodes = parseShapeScript("define angle 0\ncube { position (cos(angle) * 3) 0 (sin(angle) * 3) }");
    assert.doesNotThrow(() => astToThreeJS(nodes));
  });

  it("builds a CSG difference", () => {
    const group = astToThreeJS(parseShapeScript("difference {\n  sphere { size 2 }\n  sphere { size 1.7 }\n}"));
    assert.ok(group.children.length > 0);
  });
});
