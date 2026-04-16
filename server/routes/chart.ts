import { Router, Request, Response } from "express";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../workspace-paths.js";
import { slugify } from "../utils/slug.js";
import { errorMessage } from "../utils/errors.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";

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

type PresentChartResponse =
  | PresentChartSuccessResponse
  | PresentChartErrorResponse;

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

export function isValidChartDocument(value: unknown): value is ChartDocument {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isOptionalString(candidate.title)) return false;
  if (!Array.isArray(candidate.charts)) return false;
  if (candidate.charts.length === 0) return false;
  return candidate.charts.every((entry) => isValidChartEntry(entry));
}

function isValidChartEntry(value: unknown): value is ChartEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isOptionalString(candidate.title)) return false;
  if (!isOptionalString(candidate.type)) return false;
  if (
    typeof candidate.option !== "object" ||
    candidate.option === null ||
    Array.isArray(candidate.option)
  ) {
    return false;
  }
  return true;
}

router.post(
  API_ROUTES.chart.present,
  async (
    req: Request<object, unknown, PresentChartBody>,
    res: Response<PresentChartResponse>,
  ) => {
    const { document, title } = req.body;

    if (!isValidChartDocument(document)) {
      res.status(400).json({
        error:
          "document must be { charts: [{ option: {...}, title?, type? }, ...] } with at least one entry",
      });
      return;
    }

    if (title !== undefined && typeof title !== "string") {
      res.status(400).json({ error: "title must be a string when provided" });
      return;
    }

    try {
      const baseLabel = title ?? document.title ?? "chart";
      const slug = slugify(baseLabel) || "chart";
      const fname = `${slug}-${Date.now()}.chart.json`;
      const chartsDir = WORKSPACE_PATHS.charts;
      await mkdir(chartsDir, { recursive: true });
      await writeFile(
        path.join(chartsDir, fname),
        `${JSON.stringify(document, null, 2)}\n`,
        "utf-8",
      );

      const filePath = `${WORKSPACE_DIRS.charts}/${fname}`;
      res.json({
        message: `Saved chart document to ${filePath}`,
        instructions:
          "Acknowledge that the chart(s) have been presented to the user. The document contains " +
          `${document.charts.length} chart${document.charts.length === 1 ? "" : "s"}.`,
        data: { document, title, filePath },
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

export default router;
