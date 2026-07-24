// onExpire cleanup for the remote-host runner (plans/done/feat-remote-offline-queue.md).
//
// When the shared runner drops a command for being past its `expiresAt`, it calls
// this BEFORE deleting the command doc so an expired `startChat` leaves nothing
// behind: we delete the full-res attachment bytes the remote staged in Firebase
// Storage for it (`users/{uid}/uploads/{storage_id}`). The Storage lifecycle TTL
// is only the last-resort backstop for the one case this can't cover — a host
// that never reconnects at all.
//
// `uid` is the runner's session uid, passed in by the runner (channel.uid) rather
// than read from a global — a concurrent reconnect as a different account must not
// point this cleanup at the new user's Storage path.
//
// Best-effort throughout: a failed delete logs and leaves the orphan for the TTL
// sweep, and this must never throw back into the runner (the doc deletion runs
// regardless). Unlike startChat's strict `readStorageIds`, extraction here is
// lenient — this is cleanup, so a malformed entry is skipped, not surfaced.
import { deleteObject, ref } from "firebase/storage";
import type { Command, JsonObject } from "@mulmoclaude/core/remote-host";

import { errorMessage } from "../utils/errors.js";
import { log } from "../system/logger/index.js";
import { currentStorage } from "./session.js";

const PREFIX = "remote-host";

// Same safe-token guard ingestAttachments applies before interpolating a
// storage_id into the Storage path (no `/`, no `..`).
const STORAGE_ID_RE = /^[A-Za-z0-9-]+$/;

// Pull the staged storage_ids out of a command's `{ attachments: [{ storage_id }] }`
// params, skipping anything malformed. Absent / wrong-shaped ⇒ [].
const stagedStorageIds = (params: JsonObject): string[] => {
  const { attachments } = params;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((entry) => {
    const rawId = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.storage_id : undefined;
    return typeof rawId === "string" && STORAGE_ID_RE.test(rawId) ? [rawId] : [];
  });
};

export const onExpire = async (command: Command, uid: string): Promise<void> => {
  for (const storageId of stagedStorageIds(command.params)) {
    try {
      await deleteObject(ref(currentStorage(), `users/${uid}/uploads/${storageId}`));
    } catch (error) {
      log.warn(PREFIX, "failed to delete staged upload for expired command; leaving orphan for TTL sweep", { storageId, error: errorMessage(error) });
    }
  }
};
