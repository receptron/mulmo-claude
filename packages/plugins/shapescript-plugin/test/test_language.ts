import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { executePresentShapeScript, samples } from "../src/core/index";
import { parseShapeScript } from "../src/shapescript/parser";
import { astToThreeJS } from "../src/shapescript/toThreeJS";
import { disposeObject3D } from "../src/shapescript/dispose";

const context = {} as Parameters<typeof executePresentShapeScript>[0];
function withMesh(script: string, check: (mesh: THREE.Mesh) => void) {
  const group = astToThreeJS(parseShapeScript(script));
  try {
    const meshes: THREE.Mesh[] = [];
    group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
    });
    assert.equal(meshes.length, 1);
    check(meshes[0]!);
  } finally {
    disposeObject3D(group);
  }
}
function volume(mesh: THREE.Mesh): number {
  const p = mesh.geometry.getAttribute("position"),
    index = mesh.geometry.index;
  let value = 0;
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j));
    value += a!.dot(b!.cross(c!)) / 6;
  }
  return value;
}

describe("validation before presentation", () => {
  for (const [script, code, message] of [
    ["cube {", "PARSE_ERROR", /RBRACE/],
    ["cube { size missing }", "EVALUATION_ERROR", /Undefined variable/],
    ["difference { cube imaginaryShape }", "EVALUATION_ERROR", /Unknown shape/],
    ["for i in 1 to 100000000 { cube }", "LIMIT_EXCEEDED", /iterations/],
    ["cube { position (1 / 0) 0 0 }", "EVALUATION_ERROR", /finite/],
    ["loft { square }", "EVALUATION_ERROR", /two cross-sections/],
    ["/* unfinished", "PARSE_ERROR", /Unterminated block comment/],
    ["cube { size 1.2.3 }", "PARSE_ERROR", /Invalid number/],
    ["cube { size 1e999 }", "PARSE_ERROR", /Invalid number/],
    ["cube { size }", "PARSE_ERROR", /Unexpected token/],
  ] as const) {
    it(`returns a diagnostic for ${script}`, async () => {
      const result = await executePresentShapeScript(context, { title: "Invalid", script });
      assert.ok("error" in result);
      assert.equal(result.error.code, code);
      assert.match(result.error.message, message);
      assert.equal(result.data, undefined);
      assert.deepEqual(result.jsonData, { error: result.error });
      if (code === "PARSE_ERROR") {
        assert.ok(result.error.line);
        assert.ok(result.error.column);
      }
    });
  }
  it("validates all shipped samples", async () => {
    for (const sample of samples) {
      const result = await executePresentShapeScript(context, sample.args as unknown as Parameters<typeof executePresentShapeScript>[1]);
      assert.ok(result.data, `${sample.name}: ${result.message}`);
    }
  });
  it("returns invalid arguments without throwing", async () => {
    for (const args of [null, {}, { title: "X", script: 4 }, { title: 42, script: "cube" }]) {
      const result = await executePresentShapeScript(context, args as Parameters<typeof executePresentShapeScript>[1]);
      assert.ok("error" in result);
      assert.equal(result.error.code, "INVALID_ARGUMENT");
    }
  });
});

describe("geometry builders", () => {
  it("lofts two squares into a capped solid of the expected volume", () => {
    withMesh("loft { square translate 0 0 2 square }", (mesh) => {
      assert.ok(Math.abs(volume(mesh) - 2) < 1e-5);
      mesh.geometry.computeBoundingBox();
      assert.equal(mesh.geometry.boundingBox?.max.z, 2);
    });
  });
  it("lofts different profiles and works inside a boolean", () => {
    withMesh("difference { loft { square translate 0 0 2 circle } cube }", (mesh) => {
      assert.ok(volume(mesh) > 0);
    });
  });
  it("forms a convex hull connecting separated cubes", () => {
    withMesh("hull { cube { position -1 0 0 } cube { position 1 0 0 } }", (mesh) => {
      assert.ok(Math.abs(volume(mesh) - 3) < 1e-5);
    });
  });
  it("stencil preserves volume and paints only intersecting surfaces", () => {
    withMesh("stencil { cube { color 1 0 0 } cube { position 0.5 0 0 color 0 1 0 } }", (mesh) => {
      assert.ok(Math.abs(volume(mesh) - 1) < 1e-5, `volume ${volume(mesh)}`);
      assert.ok(Array.isArray(mesh.material));
      const colors = new Set(
        mesh.geometry.groups.filter((g) => g.count > 0).map((g) => (mesh.material as THREE.MeshStandardMaterial[])[g.materialIndex ?? 0]!.color.getHexString()),
      );
      assert.ok(colors.has("ff0000"));
      assert.ok(colors.has("00ff00"));
      mesh.geometry.computeBoundingBox();
      assert.equal(mesh.geometry.boundingBox?.max.x, 0.5);
    });
  });
  it("keeps a state-only command as a CSG child, which produces no object", () => {
    // `color`, `translate`, `define` and friends convert to null — reading a
    // mesh flag off one used to throw a TypeError out of the CSG collector.
    for (const script of ["difference { cube color 1 0 0 sphere }", "difference { cube translate 0.5 0 0 sphere }", "union { detail 8 cube }"]) {
      withMesh(script, (mesh) => assert.ok(mesh.geometry.getAttribute("position")));
    }
  });
  it("refuses a volumeless path as a CSG operand instead of feeding it to the evaluator", () => {
    assert.throws(() => disposeObject3D(astToThreeJS(parseShapeScript("difference { cube path { point 0 0 point 1 0 point 0 1 } }"))), /no volume/);
  });
  it("refunds the vertex budget for builder operands that never enter the scene", () => {
    // Each `hull` builds its two spheres, charges them, then disposes them —
    // they never reach the scene, so their charge must not accumulate. The
    // budget here holds the 24,000 vertices this actually draws with room to
    // spare, but not the ~8,800 of discarded operands on top of them.
    const group = astToThreeJS(parseShapeScript("detail 20 for i in 1 to 10 { hull { sphere { position i 0 0 } sphere { position i 2 0 } } }"), {
      maxVertices: 30_000,
    });
    try {
      let vertices = 0;
      group.traverse((object) => {
        vertices += (object as THREE.Mesh).geometry?.getAttribute("position")?.count ?? 0;
      });
      assert.equal(vertices, 24_000);
    } finally {
      disposeObject3D(group);
    }
  });
  it("refuses a conversion that outruns the wall-clock budget", () => {
    assert.throws(() => disposeObject3D(astToThreeJS(parseShapeScript("detail 32 for i in 1 to 5000 { sphere }"), { maxDurationMs: 0 })), /longer than/);
  });
  it("refuses a path whose accumulated coordinates overflow", () => {
    // Individually finite operands, but the pen is relative: `NaN` positions
    // reach the geometry and every later comparison against them is false.
    for (const script of [
      "lathe path { point 1e308 0 point 1e308 1 }",
      "fill path { point 1e308 0 point 1e308 1e308 point 0 1e308 }",
      "extrude path { for i in 1 to 10 { point 1e307 1e307 } }",
      "lathe path { rotate 1e308 rotate 1e308 point 1 0 point 1 1 }",
    ]) {
      assert.throws(() => disposeObject3D(astToThreeJS(parseShapeScript(script))), /overflow/, script);
    }
  });
  it("refuses a degenerate inline path instead of presenting an empty mesh", () => {
    for (const script of [
      "fill path { point 0 0 }",
      "fill path { point 0 0 point 1 0 }",
      "extrude path { point 0 0 point 1 0 point 2 0 }",
      "path { point 0 0 }",
    ]) {
      assert.throws(() => disposeObject3D(astToThreeJS(parseShapeScript(script))), /encloses an area/, script);
    }
    withMesh("fill path { point 0 0 point 1 0 point 0 1 }", (mesh) => assert.ok(mesh.geometry.getAttribute("position").count >= 3));
  });
  it("lofts sections whose winding a mirroring transform reversed", () => {
    withMesh("loft { square translate 0 0 2 scale -1 1 1 square }", (mesh) => assert.ok(Math.abs(volume(mesh) - 2) < 1e-5, `volume ${volume(mesh)}`));
  });
  it("keeps nested builder transforms when used as CSG operands", () => {
    withMesh("union { group { translate 5 0 0 hull { cube cube { position 1 0 0 } } } }", (mesh) => {
      mesh.geometry.computeBoundingBox();
      const box = new THREE.Box3().setFromObject(mesh);
      assert.equal(box.min.x, 4.5);
      assert.equal(box.max.x, 6.5);
    });
  });
  it("supports a stencil result as another CSG operand", () => {
    withMesh("difference { stencil { cube cube { position 0.5 0 0 color 0 1 0 } } cube { position 0 0.5 0 } }", (mesh) => {
      assert.ok(Math.abs(volume(mesh) - 0.5) < 1e-5);
    });
  });
  it("extrudes a regular polygon", () => {
    withMesh("extrude { polygon { sides 3 } }", (mesh) => {
      assert.ok(volume(mesh) > 1);
    });
  });
  it("fills a planar primitive", () => {
    withMesh("fill { square }", (mesh) => {
      assert.ok(mesh.geometry.getAttribute("position").count >= 4);
    });
  });
  it("samples curved lathe profiles", () => {
    withMesh("lathe path { point 1 0 curve 0 2 1 -1 }", (mesh) => {
      mesh.geometry.computeBoundingBox();
      assert.ok((mesh.geometry.boundingBox?.max.x ?? 0) > 1.1);
    });
  });
});

describe("expressions", () => {
  it("supports chained tuple/string access", () => {
    withMesh('define points ((2 3 4), (5 6 7))\ncube { position points[1].x points[0].y points.count size "abc".count }', (mesh) => {
      assert.deepEqual(mesh.position.toArray(), [5, 3, 2]);
    });
  });
  it("rejects unknown members and out-of-range indices", () => {
    for (const expression of ["(1 2 3).constructor", "(1 2 3)[3]", "(1 2 3)[-1]"]) {
      assert.throws(() => astToThreeJS(parseShapeScript(`cube { size ${expression} }`)), /Unknown member|out of range/);
    }
  });
  it("supports constants, numeric literals, tuple min/max and string functions", () => {
    withMesh("if true { cube { position +2 .5 1e-3 size max((1, 2, 3)) } }", (mesh) => {
      assert.deepEqual(mesh.position.toArray(), [2, 0.5, 0.001]);
    });
    withMesh('cube { size (tau / pi) position trim(" abc ").count join(("a", "b"), "").count 0 }', (mesh) => {
      assert.deepEqual(mesh.position.toArray(), [3, 2, 0]);
    });
  });
  it("uses inline path definitions and loops in builders", () => {
    withMesh("extrude path { define edge 1 point 0 0 for i in 1 to 4 { point edge 0 rotate 0.25 } }", (mesh) => {
      assert.ok(Math.abs(volume(mesh) - 1) < 1e-5);
    });
  });
  it("distinguishes signed tuple components from binary arithmetic", () => {
    for (const vector of ["1 +2 3", "+1 +2 +3", "(1 +2 +3)", "1 (1 + 1) (1+2)"]) {
      withMesh(`cube { position ${vector} }`, (mesh) => assert.deepEqual(mesh.position.toArray(), [1, 2, 3]));
    }
    withMesh("cube { position -1 -2 -3 }", (mesh) => assert.deepEqual(mesh.position.toArray(), [-1, -2, -3]));
    withMesh("extrude path { point +0 +0 point +1 +0 point +0 +1 point -1 +0 }", (mesh) => assert.ok(Math.abs(volume(mesh) - 1) < 1e-5));
    withMesh("extrude path { point 0 0 point (1 + 2 * 3) 0 point 0 1 point -7 0 }", (mesh) => assert.ok(Math.abs(volume(mesh) - 7) < 1e-5));
  });
  it("evaluates `rnd` the same way twice, so validation and rendering agree", () => {
    // The server validates the script and the browser renders it from source;
    // an unseeded generator lets the two runs take different branches.
    const positions = [0, 1].map(() => {
      const group = astToThreeJS(parseShapeScript("for i in 1 to 5 { cube { position rnd rand() rnd } }"));
      try {
        const values: number[] = [];
        group.traverse((object) => values.push(...object.position.toArray()));
        return values;
      } finally {
        disposeObject3D(group);
      }
    });
    assert.deepEqual(positions[0], positions[1]);
    assert.ok(new Set(positions[0]).size > 3, "a seeded generator must still vary within one script");
  });
  it("short circuits boolean expressions", () => {
    withMesh("if 1 or missing { cube }", () => {});
    withMesh("if 0 and missing { sphere } else { cube }", () => {});
  });
});
