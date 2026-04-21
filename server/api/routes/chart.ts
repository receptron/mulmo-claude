import { Router, Request, Response } from "express";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeWorkspaceText } from "../../utils/files/workspace-io.js";
import { buildArtifactPath } from "../../utils/files/naming.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { isRecord } from "../../utils/types.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

const router = Router();

// See plans/done/feat-chart-plugin.md for the full design. The LLM sends an
// ECharts option object per chart; we persist the whole document to
// <workspace>/charts/<slug>-<timestamp>.chart.json so it can be
// browsed in the files explorer and (eventually) wikified.

interface ChartEntry {
  title?: string;
  type?: string;
  option: Record<string, unknown>;
}

interface ChartDocument {
  title?: string;
  charts: ChartEntry[];
}

interface PresentChartBody {
  document?: ChartDocument;
  title?: string;
}

interface PresentChartSuccessResponse {
  message: string;
  instructions: string;
  data: { document: ChartDocument; title?: string; filePath: string };
}

interface PresentChartErrorResponse {
  error: string;
}

type PresentChartResponse = PresentChartSuccessResponse | PresentChartErrorResponse;

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

export function isValidChartDocument(value: unknown): value is ChartDocument {
  if (!isRecord(value)) return false;
  const candidate = value;
  if (!isOptionalString(candidate.title)) return false;
  if (!Array.isArray(candidate.charts)) return false;
  if (candidate.charts.length === 0) return false;
  return candidate.charts.every((entry) => isValidChartEntry(entry));
}

function isValidChartEntry(value: unknown): value is ChartEntry {
  if (!isRecord(value)) return false;
  const candidate = value;
  if (!isOptionalString(candidate.title)) return false;
  if (!isOptionalString(candidate.type)) return false;
  if (!isRecord(candidate.option)) {
    return false;
  }
  return true;
}

router.post(API_ROUTES.chart.present, async (req: Request<object, unknown, PresentChartBody>, res: Response<PresentChartResponse>) => {
  const { document, title } = req.body;

  if (!isValidChartDocument(document)) {
    badRequest(res, "document must be { charts: [{ option: {...}, title?, type? }, ...] } with at least one entry");
    return;
  }

  if (title !== undefined && typeof title !== "string") {
    badRequest(res, "title must be a string when provided");
    return;
  }

  try {
    const baseLabel = title ?? document.title ?? "chart";
    const filePath = buildArtifactPath(WORKSPACE_DIRS.charts, baseLabel, ".chart.json", "chart");
    await writeWorkspaceText(filePath, `${JSON.stringify(document, null, 2)}\n`);
    res.json({
      message: `Saved chart document to ${filePath}`,
      instructions:
        "Acknowledge that the chart(s) have been presented to the user. The document contains " +
        `${document.charts.length} chart${document.charts.length === 1 ? "" : "s"}.`,
      data: { document, title, filePath },
    });
  } catch (err) {
    serverError(res, errorMessage(err));
  }
});

export default router;
