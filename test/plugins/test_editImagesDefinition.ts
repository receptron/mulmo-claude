// Schema-shape checks for the editImages plugin. The MCP layer
// derives the tool contract from this definition, so a typo or
// regression here changes what the LLM is told the tool accepts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import editImagesDef, { TOOL_NAME } from "../../src/plugins/editImages/definition.ts";

interface SchemaProperty {
  type: string;
  items?: { type: string };
  description?: string;
}

interface ParametersShape {
  type: string;
  properties: Record<string, SchemaProperty>;
  required: string[];
}

describe("editImages tool definition", () => {
  it("uses the editImages tool name", () => {
    assert.equal(TOOL_NAME, "editImages");
    assert.equal(editImagesDef.name, "editImages");
  });

  it("declares prompt + imagePaths as required parameters", () => {
    const params = editImagesDef.parameters as ParametersShape;
    assert.equal(params.type, "object");
    assert.deepEqual([...params.required].sort(), ["imagePaths", "prompt"]);
  });

  it("types imagePaths as an array of strings", () => {
    const params = editImagesDef.parameters as ParametersShape;
    const { imagePaths } = params.properties;
    assert.ok(imagePaths, "imagePaths property missing");
    assert.equal(imagePaths.type, "array");
    assert.deepEqual(imagePaths.items, { type: "string" });
    assert.ok(
      typeof imagePaths.description === "string" && imagePaths.description.length > 0,
      "imagePaths needs a non-empty description so the LLM knows what to pass",
    );
  });

  it("types prompt as a string", () => {
    const params = editImagesDef.parameters as ParametersShape;
    const { prompt } = params.properties;
    assert.ok(prompt, "prompt property missing");
    assert.equal(prompt.type, "string");
  });

  it("mentions imagePaths in the LLM prompt so single-image calls still pass an array", () => {
    assert.match(editImagesDef.prompt ?? "", /imagepaths/i);
  });
});
