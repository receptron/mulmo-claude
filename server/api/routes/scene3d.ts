import { Router, Request, Response } from "express";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeWorkspaceText } from "../../utils/files/workspace-io.js";
import { buildArtifactPath } from "../../utils/files/naming.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { sceneDocumentSchema, type SceneDocument } from "../../../src/plugins/scene3d/schema.js";

const router = Router();

// See plans/feat-scene3d-plugin.md. Claude sends a declarative scene
// document; we validate with zod, persist to
// artifacts/scenes/<slug>-<ts>.scene.json, and echo back the parsed
// document + filePath so the client can render it.

interface PresentScene3dBody {
  document?: unknown;
  title?: unknown;
}

interface PresentScene3dSuccessResponse {
  message: string;
  instructions: string;
  data: { document: SceneDocument; title?: string; filePath: string };
}

interface PresentScene3dErrorResponse {
  error: string;
}

type PresentScene3dResponse = PresentScene3dSuccessResponse | PresentScene3dErrorResponse;

router.post(API_ROUTES.scene3d.present, async (req: Request<object, unknown, PresentScene3dBody>, res: Response<PresentScene3dResponse>) => {
  const { document, title } = req.body;

  if (title !== undefined && typeof title !== "string") {
    badRequest(res, "title must be a string when provided");
    return;
  }

  const parsed = sceneDocumentSchema.safeParse(document);
  if (!parsed.success) {
    // zod's `.issues` is the most actionable form for the agent.
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .slice(0, 5)
      .join("; ");
    badRequest(res, `invalid scene document: ${message}`);
    return;
  }
  const sceneDoc = parsed.data;

  try {
    const baseLabel = title ?? sceneDoc.title ?? "scene";
    const filePath = buildArtifactPath(WORKSPACE_DIRS.scenes, baseLabel, ".scene.json", "scene");
    await writeWorkspaceText(filePath, `${JSON.stringify(sceneDoc, null, 2)}\n`);
    const data: PresentScene3dSuccessResponse["data"] = { document: sceneDoc, filePath };
    if (title !== undefined) data.title = title;
    res.json({
      message: `Saved 3D scene to ${filePath}`,
      instructions:
        `Acknowledge that the 3D scene has been presented to the user. The scene contains ${sceneDoc.objects.length} ` +
        `object${sceneDoc.objects.length === 1 ? "" : "s"}.`,
      data,
    });
  } catch (err) {
    serverError(res, errorMessage(err));
  }
});

export default router;
