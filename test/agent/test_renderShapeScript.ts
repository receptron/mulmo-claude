// Pure-logic coverage for the `renderShapeScript` MCP tool. The rasterisation
// itself needs a headless browser, so it is exercised by hand rather than in
// this suite; what is testable without one — the camera angles, the sheet
// layout, and the tool's argument contract — lives here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderShapeScript, viewAngles } from "../../server/agent/mcp-tools/renderShapeScript.js";
import { gridFor } from "@mulmoclaude/shapescript-plugin/render";

describe("renderShapeScript view angles", () => {
  // The default is four views, and that IS the feature: one projection is
  // ambiguous about depth, and a model asked to judge a single image gets
  // "which of these is in front" wrong. Three around plus a top settles it.
  it("defaults to four distinct angles, three around the model plus a top-down", () => {
    const views = viewAngles(30, 25, false);
    assert.equal(views.length, 4);
    assert.deepEqual(
      views.map((view) => view.azimuth),
      [30, 120, 210, 30],
    );
    assert.deepEqual(
      views.map((view) => view.elevation),
      [25, 25, 25, 85],
    );
  });

  it("renders only the requested angle in single mode", () => {
    const views = viewAngles(45, 10, true);
    assert.equal(views.length, 1);
    assert.equal(views[0]?.azimuth, 45);
    assert.equal(views[0]?.elevation, 10);
  });

  // The caption is how the reader knows which way they are looking; a sheet of
  // four unlabelled tiles is four guesses.
  it("labels every tile with its name and rounded angles", () => {
    const [first] = viewAngles(30.000000000000004, 25, false);
    assert.equal(first?.label, "front-right — az 30°, el 25°");
  });
});

describe("contact sheet layout", () => {
  it("tiles into the squarest grid that holds every view", () => {
    assert.deepEqual(gridFor(1), { columns: 1, rows: 1 });
    assert.deepEqual(gridFor(2), { columns: 2, rows: 1 });
    assert.deepEqual(gridFor(3), { columns: 2, rows: 2 });
    assert.deepEqual(gridFor(4), { columns: 2, rows: 2 });
  });
});

describe("renderShapeScript arguments", () => {
  it("requires one source and refuses both", async () => {
    await assert.rejects(() => renderShapeScript.handler({}), /Provide either `script`/);
    await assert.rejects(() => renderShapeScript.handler({ script: "cube", path: "artifacts/shapes/a.shape" }), /not both/);
  });

  it("refuses a path that is not a .shape file", async () => {
    await assert.rejects(() => renderShapeScript.handler({ path: "artifacts/shapes/a.txt" }), /must name a .shape file/);
  });

  // Nothing else gates this: the tool is offered only to roles that list it,
  // so a missing entry in `TOOL_NAMES` would leave it uncallable.
  it("declares a name matching its registry entry", () => {
    assert.equal(renderShapeScript.definition.name, "renderShapeScript");
  });
});
