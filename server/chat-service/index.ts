import { Router } from "express";
import type { Request, Response } from "express";
import { connectSession } from "./chat-state.js";
import { relayMessage } from "./relay.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";

const router = Router();

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

// ── POST /api/chat/:transportId/:externalChatId ──────────────
//
// The HTTP bridge transport. Kept alongside the socket.io
// transport (see `attachChatSocket`) until Phase D deprecates it.

router.post(
  API_ROUTES.chatService.message,
  async (
    req: Request<ChatRequestParams, unknown, ChatRequestBody>,
    res: Response,
  ) => {
    const { transportId, externalChatId } = req.params;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

    if (!text) {
      badRequest(res, "text is required");
      return;
    }

    const result = await relayMessage({ transportId, externalChatId, text });

    if (result.kind === "ok") {
      res.json({ reply: result.reply });
      return;
    }

    res.status(result.status).json({ reply: result.message });
  },
);

// ── POST /api/chat/:transportId/:externalChatId/connect ──────
//
// Reassign the active session pointer for a transport chat.

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

    const updated = await connectSession(
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

export default router;
