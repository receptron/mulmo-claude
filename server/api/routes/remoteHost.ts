// HTTP routes for the remote-host runner.
//
//   POST /api/remote-host/connect     { idToken }  → { status, session }
//   POST /api/remote-host/reconnect   { session }  → { status, session }
//   POST /api/remote-host/disconnect               → { status, session: null }
//   GET  /api/remote-host/status                   → { status, session }
//
// connect signs in to Firebase as the user with the browser-minted Google ID
// token and starts the host runner (command loop + presence heartbeat); reconnect
// restores a browser-parked session blob (case A', mulmoserver#50) without a
// popup; disconnect stops the runner and signs out. Every response carries the
// current session blob so the browser can keep its localStorage copy fresh (null
// when disconnected). Bearer-guarded like every /api route (the browser's apiPost
// attaches the token); the idToken and session blob are secrets carried in the
// POST body over the loopback listener only — never logged.
import { Router, Request, Response } from "express";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { connect, disconnect, exportSession, reconnect, RemoteHostSessionExpiredError, status, type RemoteHostStatus } from "../../remoteHost/index.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError, unauthorized } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";

const PREFIX = "remote-host";
const router = Router();

interface StatusResponse {
  status: RemoteHostStatus;
  // The session blob the browser parks in localStorage; null when disconnected.
  session: string | null;
}

const respond = (res: Response<StatusResponse>, hostStatus: RemoteHostStatus): void => {
  res.json({ status: hostStatus, session: exportSession() });
};

router.post(API_ROUTES.remoteHost.connect, async (req: Request<object, unknown, { idToken?: string }>, res: Response<StatusResponse>) => {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "";
  if (!idToken) {
    badRequest(res, "Request body must be { idToken: string }");
    return;
  }
  try {
    respond(res, await connect(idToken));
  } catch (err) {
    // Never include idToken in the message.
    log.warn(PREFIX, "connect failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err, "remote-host connect failed"));
  }
});

router.post(API_ROUTES.remoteHost.reconnect, async (req: Request<object, unknown, { session?: string }>, res: Response<StatusResponse>) => {
  const session = typeof req.body?.session === "string" ? req.body.session : "";
  if (!session) {
    badRequest(res, "Request body must be { session: string }");
    return;
  }
  try {
    respond(res, await reconnect(session));
  } catch (err) {
    // Only a genuinely expired/invalid blob is 401 (client drops it and falls
    // back to a normal connect). Transient failures (network, backend, Firebase
    // init) are 5xx so the client KEEPS the blob and can retry later — a blip
    // must not force a re-login. Never log the blob.
    if (err instanceof RemoteHostSessionExpiredError) {
      log.info(PREFIX, "reconnect rejected (blob expired)");
      unauthorized(res, "remote-host session could not be restored");
      return;
    }
    log.warn(PREFIX, "reconnect failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err, "remote-host reconnect failed"));
  }
});

router.post(API_ROUTES.remoteHost.disconnect, async (_req: Request, res: Response<StatusResponse>) => {
  try {
    respond(res, await disconnect());
  } catch (err) {
    log.warn(PREFIX, "disconnect failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err, "remote-host disconnect failed"));
  }
});

router.get(API_ROUTES.remoteHost.status, (_req: Request, res: Response<StatusResponse>) => {
  respond(res, status());
});

export default router;
