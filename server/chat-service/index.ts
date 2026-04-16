// @package-contract — see ./types.ts
//
// Factory for the transport chat bridge. `createChatService(deps)`
// returns an Express `Router` (HTTP transport, mounted via
// `app.use`), an `attachSocket(httpServer)` helper (socket.io
// transport, see #268 Phase A), and the shared `relay` function
// both transports dispatch through. All host-app dependencies
// arrive via `deps`; the module has no direct imports from
// `../routes/…`, `../roles.js`, `../session-store/…`, or
// `../logger/…` so it can be lifted into a standalone npm package
// without internal edits. See #269 / #305 for the packaging
// rationale.

import type http from "http";
import { Router } from "express";
import type { Request, Response } from "express";
import type { Server as SocketServer } from "socket.io";
import { API_ROUTES } from "../../src/config/apiRoutes.js";
import { createChatStateStore } from "./chat-state.js";
import { createCommandHandler } from "./commands.js";
import { createRelay } from "./relay.js";
import type { RelayFn } from "./relay.js";
import { attachChatSocket } from "./socket.js";
import type { ChatServiceDeps } from "./types.js";

// ── Types ────────────────────────────────────────────────────

interface ChatRequestBody {
  text: string;
}

interface ChatRequestParams {
  transportId: string;
  externalChatId: string;
}

interface ConnectRequestBody {
  chatSessionId: string;
}

interface ConnectRequestParams {
  transportId: string;
  externalChatId: string;
}

export interface ChatService {
  router: Router;
  /** Relay used by the HTTP router. Exposed so alternate transports
   *  or tests can share the same flow without going through HTTP. */
  relay: RelayFn;
  /** Mount the socket.io transport at `/ws/chat` on the host HTTP server. */
  attachSocket(httpServer: http.Server): SocketServer;
}

// Inlined (not imported from `../utils/httpError.js`) so the module
// has no outbound dependency on the host app's utility modules.
// See `@package-contract` in ./types.ts.
const badRequest = (res: Response, error: string) =>
  res.status(400).json({ error });
const notFound = (res: Response, error: string) =>
  res.status(404).json({ error });

// ── Factory ──────────────────────────────────────────────────

export function createChatService(deps: ChatServiceDeps): ChatService {
  const {
    startChat,
    onSessionEvent,
    loadAllRoles,
    getRole,
    defaultRoleId,
    tokenProvider,
  } = deps;
  const logger = deps.logger;
  const store = createChatStateStore({
    transportsDir: deps.transportsDir,
    logger,
  });
  const handleCommand = createCommandHandler({
    loadAllRoles,
    getRole,
    resetChatState: store.resetChatState,
  });
  const relay = createRelay({
    store,
    handleCommand,
    startChat,
    onSessionEvent,
    getRole,
    defaultRoleId,
    logger,
  });

  const router = Router();

  // POST /api/transports/:transportId/chats/:externalChatId — send text, get a reply.
  router.post(
    API_ROUTES.chatService.message,
    async (
      req: Request<ChatRequestParams, unknown, ChatRequestBody>,
      res: Response,
    ) => {
      const { transportId, externalChatId } = req.params;
      const text =
        typeof req.body?.text === "string" ? req.body.text.trim() : "";

      if (!text) {
        badRequest(res, "text is required");
        return;
      }

      const result = await relay({ transportId, externalChatId, text });

      if (result.kind === "ok") {
        res.json({ reply: result.reply });
        return;
      }
      res.status(result.status).json({ reply: result.message });
    },
  );

  // POST /api/transports/:transportId/chats/:externalChatId/connect —
  // reassign the active session pointer for a transport chat.
  router.post(
    API_ROUTES.chatService.connect,
    async (
      req: Request<ConnectRequestParams, unknown, ConnectRequestBody>,
      res: Response,
    ) => {
      const { transportId, externalChatId } = req.params;
      const chatSessionId =
        typeof req.body?.chatSessionId === "string"
          ? req.body.chatSessionId.trim()
          : "";

      if (!chatSessionId) {
        badRequest(res, "chatSessionId is required");
        return;
      }

      const updated = await store.connectSession(
        transportId,
        externalChatId,
        chatSessionId,
      );
      if (!updated) {
        notFound(res, "No chat state found for this transport");
        return;
      }

      res.json({ ok: true });
    },
  );

  return {
    router,
    relay,
    attachSocket: (httpServer) =>
      attachChatSocket(httpServer, { relay, logger, tokenProvider }),
  };
}

export type {
  ChatServiceDeps,
  StartChatFn,
  OnSessionEventFn,
} from "./types.js";
