import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentShapeScript",
  apiNamespace: "shapescript",
  apiRoutes: {
    /** POST /api/shapescript — validate a ShapeScript source and present it. */
    create: { method: "POST", path: "" },
  },
  mcpDispatch: "create",
  workspaceDirs: {
    /** Saved ShapeScript sources (`artifacts/shapes/<slug>-<ms>.shape`). Flat
     *  rather than `YYYY/MM`-partitioned: a model is opened by name, and one
     *  directory keeps that browsable. */
    shapes: "artifacts/shapes",
  },
});
