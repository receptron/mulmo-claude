import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "@mulmobridge/protocol";
import { createRelay } from "../src/relay.ts";
import type { ChatStateStore, TransportChatState } from "../src/chat-state.ts";
import type { Logger, SessionEventListener, StartChatParams } from "../src/types.ts";

const logger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

describe("relayMessage", () => {
  it("serializes concurrent turns for the same external chat before creating state", async () => {
    let state: TransportChatState | null = null;
    let sessionCounter = 0;
    const startCalls: StartChatParams[] = [];
    const listeners = new Map<string, SessionEventListener[]>();

    const store: ChatStateStore = {
      getChatState: async () => state,
      setChatState: async (_transportId, nextState) => {
        state = nextState;
      },
      resetChatState: async (transportId, externalChatId, roleId) => {
        const now = new Date().toISOString();
        const nextState: TransportChatState = {
          externalChatId,
          sessionId: `${transportId}-${externalChatId}-${++sessionCounter}`,
          roleId,
          startedAt: now,
          updatedAt: now,
        };
        state = nextState;
        return nextState;
      },
      connectSession: async () => null,
      generateSessionId: (transportId, externalChatId) => `${transportId}-${externalChatId}-generated`,
    };

    const relay = createRelay({
      store,
      handleCommand: async () => null,
      startChat: async (params) => {
        startCalls.push(params);
        return { kind: "started", chatSessionId: params.chatSessionId };
      },
      onSessionEvent: (sessionId, listener) => {
        const sessionListeners = listeners.get(sessionId) ?? [];
        sessionListeners.push(listener);
        listeners.set(sessionId, sessionListeners);
        return () => {
          const current = listeners.get(sessionId) ?? [];
          listeners.set(
            sessionId,
            current.filter((candidate) => candidate !== listener),
          );
        };
      },
      getRole: (roleId) => ({ id: roleId, name: roleId }),
      defaultRoleId: "general",
      logger,
    });

    const first = relay({ transportId: "slack", externalChatId: "channel1", text: "first" });
    const second = relay({ transportId: "slack", externalChatId: "channel1", text: "second" });

    await waitFor(() => startCalls.length >= 1, "first relay did not start");
    await waitFor(() => listenerCount(listeners, startCalls[0].chatSessionId) > 0, "first relay did not subscribe to events");
    await flushAsync();
    const callsBeforeFirstFinished = startCalls.length;

    const finishedCallIndexes = new Set<number>();
    const finishCall = async (index: number, text: string) => {
      if (finishedCallIndexes.has(index)) return;
      await waitFor(() => listenerCount(listeners, startCalls[index].chatSessionId) > 0, "relay did not subscribe to events");
      finishedCallIndexes.add(index);
      const sessionId = startCalls[index].chatSessionId;
      for (const listener of listeners.get(sessionId) ?? []) {
        listener({ type: EVENT_TYPES.text, message: text });
        listener({ type: EVENT_TYPES.sessionFinished });
      }
    };

    await finishCall(0, "first reply");
    if (startCalls[1]) {
      await finishCall(1, "second reply");
    }

    await waitFor(() => startCalls.length >= 2, "second relay did not start");
    await finishCall(1, "second reply");

    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(callsBeforeFirstFinished, 1);
    assert.equal(startCalls[0].chatSessionId, startCalls[1].chatSessionId);
    assert.deepEqual(firstResult, { kind: "ok", reply: "first reply" });
    assert.deepEqual(secondResult, { kind: "ok", reply: "second reply" });
  });
});

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (condition()) return;
    await flushAsync();
  }
  assert.fail(message);
}

function listenerCount(listeners: Map<string, SessionEventListener[]>, sessionId: string): number {
  return listeners.get(sessionId)?.length ?? 0;
}
