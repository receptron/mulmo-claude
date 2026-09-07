# @mulmoclaude/shapescript-plugin

`presentShapeScript` — interactive 3D visualizations authored in the **ShapeScript** language.
The plugin ships its own ShapeScript parser / evaluator and a Three.js renderer (CSG via
`three-bvh-csg`), so a model is described as text and rendered in the chat canvas.

Ported from [`@gui-chat-plugin/present3d`](https://github.com/receptron/GUIChatPluginPresent3D)
(MIT, same authors). The tool is named `presentShapeScript` here — the upstream `present3D`
name, and the `Present3D*` type names, are renamed throughout.

## Exports

| Entry         | Contents                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `.`           | `TOOL_NAME`, `TOOL_DEFINITION`, `executePresentShapeScript`, `pluginCore`, `samples`, `parseShapeScript`, `astToThreeJS` |
| `./vue`       | the `ToolPlugin` (View + Preview + `SYSTEM_PROMPT`), plus everything on `.`                                              |
| `./style.css` | the compiled component styles (Vite lib mode does not auto-inject them)                                                  |

```ts
import type { ToolContext } from "gui-chat-protocol";
import { executePresentShapeScript } from "@mulmoclaude/shapescript-plugin";

// The handler does not read the context; the host passes its own.
const context = {} as ToolContext;

const result = await executePresentShapeScript(context, {
  title: "Circular Pattern",
  script: `
define count 12
for i in 1 to count {
    define angle ((i / count) * 6.283)
    cube {
        position (cos(angle) * 3) 0 (sin(angle) * 3)
        color (i / count) 0.5 (1 - i / count)
        size 0.5
    }
}`,
});
```

## ShapeScript language

- **Primitives**: `cube`, `sphere`, `cylinder`, `cone`, `torus`, `circle`, `square`, `polygon`
- **Properties**: `position X Y Z`, `rotation X Y Z`, `size X Y Z`, `color R G B` (0–1), `opacity`
- **CSG**: `union`, `difference`, `intersection`, `xor`, `stencil`
- **Builders**: `extrude`, `loft`, `lathe`, `fill`, `hull`
- **Variables & expressions**: `define`, arithmetic / comparison / boolean operators, parentheses
- **Control flow**: `for … in … to … step`, `if` / `else`, `switch` / `case`
- **Built-ins**: `round floor ceil abs sign sqrt pow min max`, `sin cos tan asin acos atan atan2`
  (radians), `dot cross length normalize sum`

A function call takes **no space** before its parenthesis: `sin(x)` is a call, `sin (x)` is not.

## Validation and errors

`executePresentShapeScript` checks arguments, parses the source, evaluates expressions,
and builds geometry headlessly before returning success. Temporary geometry is disposed.
Failures are returned as values, with **no `data` field**, so the host does not open a
broken visualization. The same diagnostic is available as `error` and `jsonData.error`
(the latter is included in the calling agent's tool response):

```ts
const result = await executePresentShapeScript(context, {
  title: "Example", script: "cube { size missing }",
});
if ("error" in result) {
  console.log(result.error.code, result.error.message);
  // EVALUATION_ERROR, "Undefined variable: missing"
}
```

Codes: `INVALID_ARGUMENT`, `PARSE_ERROR`, `EVALUATION_ERROR`, `LIMIT_EXCEEDED`.
Parse diagnostics include `line` and `column` when available. Invalid input does not
throw from the tool handler. Successful results retain their existing `{ title, data: { script } }`
contract. Validation executes the script, including geometry construction; the browser
constructs it again for display. The source editor also validates geometry before saving.

## Builders and additional expressions

```text
// Loft joins sections and caps the ends; hull forms a convex envelope.
loft {
    square
    translate 0 0 2
    circle
}
hull {
    cube { position -1 0 0 }
    cube { position 1 0 0 }
}
extrude { polygon { sides 5 } }
fill { square }
lathe path { point 1 0 curve 0 2 1 -1 }

// Stencil changes surface material without cutting away the first shape.
stencil {
    cube { color 1 0 0 }
    cube { position 0.5 0 0 color 0 1 0 }
}

define offsets ((1 2 3), (4 5 6))
cube { position offsets[0].x offsets[1].y offsets.count }
```

Also supported: `pi`, `tau`, `true`, `false`, scientific notation, unary `+`,
short-circuit `and`/`or`, string literals, `join`/`trim`, tuple arguments to `min`/`max`,
zero-based tuple/string subscripts, `.count`, vector `.x/.y/.z/.w`, color
`.red/.green/.blue/.alpha` (or `.r/.g/.b/.a`), custom shape definitions with options,
and `polygon { sides N }` (integer 3–256). Lathe samples curved profiles, and inline
builder paths use the same parser as nested paths, including loops and definitions.

## Compatibility and limits

This is the plugin's documented modeling subset, **not complete compatibility with
[upstream ShapeScript](https://shapescript.info/mac/)**. It preserves existing plugin
conventions: primitive sphere/circle sizes specify radii; rotation/orientation properties
and trig functions use radians; relative rotate/orientation commands and path rotation
use turns (`1 = 360°`). Path point/curve coordinates are relative steps, and curve
control coordinates are offsets from the endpoint. Upstream uses different conventions.

Loft accepts ordered, closed planar sections with one perimeter each, resamples differing
vertex counts, interpolates linearly, and triangulates the end caps. Sections must enclose
a volume. Hull accepts geometry from child meshes and filled paths. Primitive profiles
for fill/extrude must lie in XY; holes, swept/twisted extrusion, and arbitrary 3D path
commands are not implemented. Imports, textures, text/fonts, lights/camera declarations,
arbitrary objects, and general user-defined functions remain outside this subset.
Unsupported commands and failed CSG operations return errors instead of silently
substituting different geometry. As with other polygonal CSG engines, degenerate or
self-intersecting inputs may fail.

`rnd` and `rand()` draw from a seeded generator (`randomSeed`, default
`DEFAULT_RANDOM_SEED`) rather than `Math.random()`: one script is evaluated twice — once
on the server, which validates it, and again in the browser, which renders it — and an
unseeded generator lets those two runs take different branches.

Conversion limits cover nodes, loop/path work, detail, aggregate vertices (including CSG
intermediates), and a coarse wall-clock budget checked between nodes — it refuses to start
the next node once the budget is spent, but cannot interrupt one long boolean.

## Scripts

```bash
yarn build      # vite build + d.ts emit
yarn typecheck  # vue-tsc --noEmit
yarn lint
yarn test       # node:test — tool execute + parser + Three.js conversion
```
