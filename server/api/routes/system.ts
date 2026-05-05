import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { env } from "../../system/env.js";

// Lightweight host-level runtime-config endpoint. The frontend reads
// this once on boot via `useSystemConfig()` so flags driven by the
// server's `.env` (currently just `DEV_MODE`) can shape the UI
// without baking values into the bundle. Adding a new flag is one
// field on the response shape plus a read in `env.ts`.

export interface SystemConfigResponse {
  devMode: boolean;
}

const router = Router();

router.get(API_ROUTES.system.config, (_req: Request, res: Response<SystemConfigResponse>) => {
  res.json({ devMode: env.devMode });
});

export default router;
