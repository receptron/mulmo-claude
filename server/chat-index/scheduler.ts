import { indexStale } from "./indexer.js";

const refreshHours = Number(process.env.CHAT_INDEX_REFRESH_HOURS ?? 6);
const batchSize = Number(process.env.CHAT_INDEX_BATCH_SIZE ?? 20);
const HOUR_MS = 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runOnce(): Promise<void> {
  // Single-flight: if a previous cycle is still running, skip this
  // tick rather than overlap. The next tick picks up where it left.
  if (running) return;
  running = true;
  try {
    const n = await indexStale({ limit: batchSize });
    if (n > 0) {
      console.log(`[chat-index] refreshed ${n} session(s)`);
    }
  } catch (err) {
    console.error(
      "[chat-index] refresh failed:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    running = false;
  }
}

export function startChatIndexer(): void {
  // Initial pass on startup, fire-and-forget so it does not block
  // server boot. Errors are logged inside runOnce.
  void runOnce();
  if (refreshHours > 0) {
    timer = setInterval(runOnce, refreshHours * HOUR_MS);
  }
  console.log(
    `[chat-index] started (refresh=${refreshHours}h, batch=${batchSize})`,
  );
}

export function stopChatIndexer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
