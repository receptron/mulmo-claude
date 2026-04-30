// File-change publisher. Single place that knows how to broadcast
// "this workspace file changed" — every route that writes through the
// app should call `publishFileChange(relPath)` after a successful
// write so that subscribed UI tabs (and other browsers) refetch.
//
// Module-singleton + `init…` pattern, mirroring `session-store`. The
// singleton is null at import time so unit-tested route handlers can
// skip wiring and simply observe a no-op publish.
//
// Channel name + payload shape live in `src/config/pubsubChannels.ts`
// so subscribers can't drift from the publisher.

import { stat } from "node:fs/promises";
import path from "node:path";
import type { IPubSub } from "./pub-sub/index.js";
import { fileChannel, toPosixWorkspacePath, type FileChannelPayload } from "../../src/config/pubsubChannels.js";
import { workspacePath } from "../workspace/workspace.js";
import { log } from "../system/logger/index.js";

let pubsub: IPubSub | null = null;

export function initFileChangePublisher(instance: IPubSub): void {
  pubsub = instance;
}

/**
 * Publish a file-change event for a workspace-relative path. Reads
 * the post-write `mtimeMs` via `stat` so subscribers get a monotonic
 * timestamp suitable for both cache-busting (`?v=<mtime>`) and
 * out-of-order drops. If the stat fails (file just got deleted, race
 * with another writer, etc.) we fall back to `Date.now()` rather than
 * dropping the event — losing the notification is worse than an
 * approximate timestamp.
 */
export async function publishFileChange(relativePath: string): Promise<void> {
  if (!pubsub) return;
  const absPath = path.join(workspacePath, relativePath);
  let mtimeMs: number;
  try {
    ({ mtimeMs } = await stat(absPath));
  } catch (err) {
    log.warn("file-change", "stat failed; falling back to Date.now()", {
      pathPreview: relativePath,
      error: err instanceof Error ? err.message : String(err),
    });
    mtimeMs = Date.now();
  }
  // Normalise once so `payload.path` and the channel suffix can't drift
  // on Windows / mixed-separator inputs.
  const posixPath = toPosixWorkspacePath(relativePath);
  const payload: FileChannelPayload = { path: posixPath, mtimeMs };
  // Callers fire-and-forget via `void publishFileChange(...)`, so a
  // throw here would surface as an unhandled rejection (Node terminates
  // the process by default). Missing one notification is strictly less
  // bad than killing the server.
  try {
    pubsub.publish(fileChannel(posixPath), payload);
  } catch (err) {
    log.warn("file-change", "publish failed; subscribers will miss this event", {
      pathPreview: posixPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Test-only — clear the module singleton so each test starts clean. */
export function _resetFileChangePublisherForTesting(): void {
  pubsub = null;
}
