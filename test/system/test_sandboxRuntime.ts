import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appleContainerImageLabel, sandboxRuntimeCommand } from "../../server/system/docker.js";

describe("sandbox runtime helpers", () => {
  it("maps runtime ids to their CLI binaries", () => {
    assert.equal(sandboxRuntimeCommand("docker"), "docker");
    assert.equal(sandboxRuntimeCommand("apple-container"), "container");
  });

  it("reads the Dockerfile hash label from Apple container inspect JSON", () => {
    const json = JSON.stringify([
      {
        variants: [
          {
            config: {
              config: {
                Labels: {
                  "mulmoclaude.dockerfile.sha256": "abc123",
                },
              },
            },
          },
        ],
      },
    ]);
    assert.equal(appleContainerImageLabel(json, "mulmoclaude.dockerfile.sha256"), "abc123");
  });

  it("returns undefined for missing labels or malformed inspect output", () => {
    assert.equal(appleContainerImageLabel("[]", "missing"), undefined);
    assert.equal(appleContainerImageLabel("not-json", "missing"), undefined);
  });
});
