import { Router } from "express";
import type { Request, Response } from "express";
import { log } from "../logger/index.js";
import { getRole } from "../roles.js";
import { DEFAULT_ROLE_ID } from "../../src/config/roles.js";
import { startChat } from "../routes/agent.js";
import { onSessionEvent } from "../session-store/index.js";
import {
  getChatState,
  setChatState,
  resetChatState,
  connectSession,
} from "./chat-state.js";
import { handleCommand } from "./commands.js";

const router = Router();

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

// ── POST /api/chat/:transportId/:externalChatId ──────────────
//
// The main endpoint bridges call. Send text, get a reply.

router.post(
  "/chat/:transportId/:externalChatId",
  async (
    req: Request<ChatRequestParams, unknown, ChatRequestBody>,
    res: Response,
  ) => {
    const { transportId, externalChatId } = req.params;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    log.info("chat-service", "message received", {
      transportId,
      externalChatId,
      textLength: text.length,
    });

    // Load or create chat state
    let chatState = await getChatState(transportId, externalChatId);
    if (!chatState) {
      const defaultRole = getRole(DEFAULT_ROLE_ID);
      chatState = await resetChatState(
        transportId,
        externalChatId,
        defaultRole.id,
      );
    }

    // Check for slash commands
    const commandResult = await handleCommand(text, transportId, chatState);
    if (commandResult) {
      res.json({ reply: commandResult.reply });
      return;
    }

    // Relay message through startChat()
    const result = await startChat({
      message: text,
      roleId: chatState.roleId,
      chatSessionId: chatState.sessionId,
    });

    if (result.kind === "error") {
      // Session may be busy (409) — tell the bridge
      const status = result.status ?? 500;
      if (status === 409) {
        res.status(409).json({
          reply: "A previous message is still being processed. Please wait.",
        });
        return;
      }
      log.error("chat-service", "startChat failed", {
        transportId,
        externalChatId,
        error: result.error,
      });
      res.status(status).json({ reply: `Error: ${result.error}` });
      return;
    }

    // Collect agent response via in-process event listener
    try {
      const reply = await collectAgentReply(chatState.sessionId);

      // Update chat state timestamp
      await setChatState(transportId, {
        ...chatState,
        updatedAt: new Date().toISOString(),
      });

      res.json({ reply });
    } catch (err) {
      log.error("chat-service", "reply collection failed", {
        transportId,
        externalChatId,
        error: String(err),
      });
      res.status(500).json({ reply: "Error: failed to collect agent reply" });
    }
  },
);

// ── POST /api/chat/:transportId/:externalChatId/connect ──────
//
// Reassign the active session pointer for a transport chat.

router.post(
  "/chat/:transportId/:externalChatId/connect",
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
      res.status(400).json({ error: "chatSessionId is required" });
      return;
    }

    const updated = await connectSession(
      transportId,
      externalChatId,
      chatSessionId,
    );
    if (!updated) {
      res.status(404).json({ error: "No chat state found for this transport" });
      return;
    }

    res.json({ ok: true });
  },
);

// ── Event collection helper ──────────────────────────────────

const REPLY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function collectAgentReply(chatSessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const textChunks: string[] = [];

    const timer = setTimeout(() => {
      unsubscribe();
      resolve(
        textChunks.join("") ||
          "The request timed out before a reply was generated.",
      );
    }, REPLY_TIMEOUT_MS);

    const unsubscribe = onSessionEvent(chatSessionId, (event) => {
      const type = event.type as string;

      if (type === "text") {
        textChunks.push(event.message as string);
      }

      if (type === "error") {
        clearTimeout(timer);
        unsubscribe();
        resolve(`Error: ${event.message as string}`);
      }

      if (type === "session_finished") {
        clearTimeout(timer);
        unsubscribe();
        resolve(
          textChunks.join("") ||
            "The assistant completed the request but produced no text reply.",
        );
      }
    });
  });
}

export default router;
