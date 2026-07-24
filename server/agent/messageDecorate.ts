// Decoration applied to a user message strictly on the path to Claude. The
// persisted (jsonl) and broadcast (UI) message stays the raw text — anything
// added here is invisible to the user and only teaches the model about
// attachments and prior-session context.

import { prependJournalPointer } from "./prompt.js";

const UNSAFE_MARKER_CHARS_RE = /[\r\n\]]/;

type MarkerPosition = "prepend" | "append";

/** Marker telling the model which workspace files are attached / selected for
 *  this turn. One `[Attached file: <path>]` line per path so multi-file flows
 *  (e.g. paste one image + pick another → "combine these") surface every path
 *  to the model — `editImages` then receives the full list in `imagePaths`.
 *  The system prompt teaches the model how to interpret them.
 *
 *  `position` defaults to `"prepend"`; a command turn passes `"append"` so the
 *  leading `/` stays at position 0 (see `decorateMessageForCli`). */
export function withAttachedFileMarker(message: string, attachedFilePaths: string[], position: MarkerPosition = "prepend"): string {
  const safePaths = attachedFilePaths.filter((relPath) => !UNSAFE_MARKER_CHARS_RE.test(relPath));
  if (safePaths.length === 0) return message;
  const markerLines = safePaths.map((relPath) => `[Attached file: ${relPath}]`).join("\n");
  return position === "append" ? `${message}\n\n${markerLines}` : `${markerLines}\n\n${message}`;
}

/** Build the CLI-bound message, preserving a leading `/` as the CLI's
 *  deterministic slash-command trigger. The CLI resolves a slash command only
 *  when the message STARTS with `/name`; any decoration pushed in front of it
 *  silently drops skill selection back to the model guessing from descriptions
 *  (#2134). A slash-first message is a command, not an open question — so skip
 *  the journal pointer (prior-session context is irrelevant to a command) and
 *  append the file markers after the body instead of prepending. Detection is
 *  position-0 `startsWith` to match the CLI; the collection UI and manual entry
 *  emit no leading whitespace. */
export function decorateMessageForCli(args: { message: string; workspaceDir: string; attachedFilePaths: string[]; resumed: boolean }): string {
  const { message, workspaceDir, attachedFilePaths, resumed } = args;
  const isCommand = message.startsWith("/");
  const base = resumed || isCommand ? message : prependJournalPointer(message, workspaceDir);
  return withAttachedFileMarker(base, attachedFilePaths, isCommand ? "append" : "prepend");
}
