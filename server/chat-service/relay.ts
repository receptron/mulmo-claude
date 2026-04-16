// @package-contract — see ./types.ts
//
// Shared core of the bridge chat flow. HTTP (router) and socket.io
// transports both call `relayMessage`. Kept DI-pure: everything
// this module needs (store, command handler, startChat,
// onSessionEvent, role lookup, logger) arrives through
// `createRelay` so the module has no direct imports from the host
// app.

import { EVENT_TYPES } from "../../src/types/events.js";
import type { ChatStateStore } from "./chat-state.js";
import type { CommandHandler } from "./commands.js";
import type { Logger, OnSessionEventFn, Role, StartChatFn } from "./types.js";

// ── Types ────────────────────────────────────────────────────

export interface RelayParams {
  transportId: string;
  externalChatId: string;
  text: string;
}

export type RelayResult =
  | { kind: "ok"; reply: string }
  | { kind: "error"; status: number; message: string };

export type RelayFn = (params: RelayParams) => Promise<RelayResult>;

// ── Constants ────────────────────────────────────────────────

const REPLY_TIMEOUT_MS = 5 * 60 * 1000;

// ── Factory ──────────────────────────────────────────────────

export interface RelayDeps {
  store: ChatStateStore;
  handleCommand: CommandHandler;
  startChat: StartChatFn;
  onSessionEvent: OnSessionEventFn;
  getRole: (roleId: string) => Role;
  defaultRoleId: string;
  logger: Logger;
}

export function createRelay(deps: RelayDeps): RelayFn {
  const {
    store,
    handleCommand,
    startChat,
    onSessionEvent,
    getRole,
    defaultRoleId,
    logger,
  } = deps;

  return async function relayMessage(
    params: RelayParams,
  ): Promise<RelayResult> {
    const { transportId, externalChatId, text } = params;

    logger.info("chat-service", "message received", {
      transportId,
      externalChatId,
      textLength: text.length,
    });

    let chatState = await store.getChatState(transportId, externalChatId);
    if (!chatState) {
      const defaultRole = getRole(defaultRoleId);
      chatState = await store.resetChatState(
        transportId,
        externalChatId,
        defaultRole.id,
      );
    }

    const commandResult = await handleCommand(text, transportId, chatState);
    if (commandResult) {
      return { kind: "ok", reply: commandResult.reply };
    }

    const result = await startChat({
      message: text,
      roleId: chatState.roleId,
      chatSessionId: chatState.sessionId,
    });

    if (result.kind === "error") {
      const status = result.status ?? 500;
      if (status === 409) {
        return {
          kind: "ok",
          reply: "A previous message is still being processed. Please wait.",
        };
      }
      logger.error("chat-service", "startChat failed", {
        transportId,
        externalChatId,
        error: result.error,
      });
      return {
        kind: "error",
        status,
        message: `Error: ${result.error}`,
      };
    }

    try {
      const reply = await collectAgentReply(
        onSessionEvent,
        chatState.sessionId,
      );
      await store.setChatState(transportId, {
        ...chatState,
        updatedAt: new Date().toISOString(),
      });
      return { kind: "ok", reply };
    } catch (err) {
      logger.error("chat-service", "reply collection failed", {
        transportId,
        externalChatId,
        error: String(err),
      });
      return {
        kind: "error",
        status: 500,
        message: "Error: failed to collect agent reply",
      };
    }
  };
}

// ── Internals ────────────────────────────────────────────────

function collectAgentReply(
  onSessionEvent: OnSessionEventFn,
  chatSessionId: string,
): Promise<string> {
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

      if (type === EVENT_TYPES.text) {
        textChunks.push(event.message as string);
      }

      if (type === EVENT_TYPES.error) {
        clearTimeout(timer);
        unsubscribe();
        resolve(`Error: ${event.message as string}`);
      }

      if (type === EVENT_TYPES.sessionFinished) {
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
