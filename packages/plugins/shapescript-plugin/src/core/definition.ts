export const TOOL_NAME = "presentShapeScript";

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: TOOL_NAME,
  description:
    "Display interactive 3D visualizations using ShapeScript with expressions, variables, control flow, and functions. A new `script` is saved to `artifacts/shapes/` and the returned `filePath` names it; pass `path` instead to present a source that already exists.",
  parameters: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description: "Title for the 3D visualization",
      },
      script: {
        type: "string",
        description: `ShapeScript code defining the 3D scene. Supported features and syntax are listed below. Syntax, evaluation, geometry and resource-limit errors are returned as diagnostics; correct the script and retry.

## SYNTAX OVERVIEW:

### Expressions & Operators:
- Arithmetic: +, -, *, /, % with proper precedence
- Comparison: =, <>, <, <=, >, >=
- Boolean: and, or, not
- Parentheses for grouping: (2 + 3) * 4

### Variables:
define radius 2
define red (1 0 0)
sphere { size radius color red }

### Control Flow:

For loops with variables:
for i in 1 to 5 {
    cube { position (i * 2) 0 0 size 1 }
}

For loops with step:
for i in 0 to 10 step 2 {
    sphere { position 0 i 0 }
}

If/else conditionals:
define showSphere 1
if showSphere {
    sphere { size 2 }
} else {
    cube { size 2 }
}

Switch statements:
define shape 2
switch shape {
case 1
    cube
case 2
    sphere
else
    cone
}

### Built-in Functions:

Math: round, floor, ceil, abs, sign, sqrt, pow, min, max
Trig: sin, cos, tan, asin, acos, atan, atan2 (uses radians)
Vector: dot, cross, length, normalize, sum

IMPORTANT: Function calls require NO space between name and parenthesis:
- sin(x) ✓ function call
- sin (x) ✗ NOT a function call (identifier + parenthesized expression)

Examples:
for i in 1 to 8 {
    define angle (i * 0.785)  // 45 degrees in radians
    cube { position (cos(angle) * 3) 0 (sin(angle) * 3) }
}

### Primitives & Properties:

Shapes: cube, sphere, cylinder, cone, torus, circle, square, polygon (sides 3–256)
Properties: position X Y Z, rotation X Y Z, size X Y Z
Materials: color R G B (0-1), opacity (0-1)

### CSG Operations:
union, difference, intersection, xor, stencil

Example:
difference {
    sphere { size 2 color (1 0.5 0) }
    cube { size 1.5 }
}

### Builders:
- extrude: extrude { polygon { sides 3 } } or extrude path { point 0 0 point 1 0 point 0 1 }
- fill: fill { square } or fill path { ... }
- lathe: lathe path { point 1 0 curve 0 2 1 -1 } (revolves about Y)
- loft: loft { square translate 0 0 2 circle } (closed planar sections joined with caps)
- hull: hull { cube { position -1 0 0 } cube { position 1 0 0 } } (convex envelope)
- stencil preserves the first shape and paints its surface with later shapes' materials.
Loft sections must each have one perimeter and enclose an area; extrude/fill primitive profiles must lie in XY.

### Additional Expressions:
- Constants: pi, tau, true, false
- Scientific notation and unary plus: 1e-3, +2
- Tuple/vector members: vector.x, vector.y, vector.z; color.red/green/blue/alpha
- Tuple/string length: value.count; zero-based indexing: values[0]
- String literals, join(...), trim(...); min/max also accept tuples
- Custom shapes with options:
define post { option height 2 cylinder { size 0.2 height } }
post { height 3 }

### Compatibility:
This plugin implements the documented modeling subset, not all upstream ShapeScript syntax.
Function calls use name(...); trig functions and rotation/orientation properties use radians.
Relative rotate/orientation commands and path rotate use turns (1 = 360 degrees).
Path point/curve coordinates are relative steps. Curves accept optional control-point offsets.
Imports, textures, text/fonts, arbitrary objects, and general user-defined functions are not supported.

### Comments:
// Single-line comment
/* Multi-line
   comment */

## COMPLETE EXAMPLES:

Linear arrangement with expressions:
define spacing 1.5
for i in 1 to 4 {
    cylinder { position ((i - 2.5) * spacing) 0 0 size 0.4 1 }
}

Circular pattern:
define count 12
for i in 1 to count {
    define angle ((i / count) * 6.283)  // 2 * PI
    cube {
        position (cos(angle) * 3) 0 (sin(angle) * 3)
        color (i / count) 0.5 (1 - i / count)
        size 0.5
    }
}

Conditional geometry:
define makeHollow 1
if makeHollow {
    difference {
        sphere { size 2 color (1 0 0) }
        sphere { size 1.7 }
    }
} else {
    sphere { size 2 color (1 0 0) }
}

Mathematical visualization:
for x in -5 to 5 {
    for z in -5 to 5 {
        define height (sin(x * 0.5) * cos(z * 0.5) * 2)
        cube {
            position (x * 0.3) height (z * 0.3)
            size 0.25 (abs(height) + 0.1) 0.25
            color (0.5 + height * 0.25) 0.3 (0.5 - height * 0.25)
        }
    }
}`,
      },
      path: {
        type: "string",
        description:
          "Path to an EXISTING ShapeScript source to present in place, instead of `script` — a `.shape` file this tool saved earlier (`artifacts/shapes/…`) or any other on disk. Provide either `script` or `path`, never both. Edits the user makes in the view write back to that same file.",
      },
    },
    required: ["title"],
  },
};
