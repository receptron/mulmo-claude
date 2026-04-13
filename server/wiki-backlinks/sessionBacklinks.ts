// Pure helpers for wiki page session-backlink appendix (#109).
//
// Each wiki page that was touched during a chat session gets a small
// machine-managed appendix at the end listing the sessions that
// modified it. The appendix is demarcated by an HTML comment so
// renderers don't show the marker and our parser can find the
// boundary without a regex:
//
//   ... user-authored page body ...
//
//   <!-- journal-session-backlinks -->
//   ## History
//
//   - [session 3e0382cb](../../chat/3e0382cb-f02f-4f5b-a9a3-a71e50d7ad0c.jsonl)
//   - [session 4d7f5377](../../chat/4d7f5377-1bac-460c-8ec5-ea054fa0492d.jsonl)
//
// Contract: `updateSessionBacklinks(existingContent, sessionId,
// linkHref)` returns the content that should be written back. If the
// sessionId is already listed in the appendix, the return value is
// byte-for-byte equal to `existingContent` so the caller can skip the
// write.

export const BACKLINKS_MARKER = "<!-- journal-session-backlinks -->";
const HISTORY_HEADING = "## History";
const SESSION_ID_SHORT_LEN = 8;

/**
 * Append a backlink for `sessionId` to the appendix of `existingContent`.
 *
 * If the appendix doesn't exist yet it is created at the end of the
 * content. If it exists and already lists `sessionId` the content is
 * returned unchanged (idempotent).
 */
export function updateSessionBacklinks(
  existingContent: string,
  sessionId: string,
  linkHref: string,
): string {
  if (!sessionId) return existingContent;

  const markerIdx = existingContent.indexOf(BACKLINKS_MARKER);
  if (markerIdx === -1) {
    return appendFreshAppendix(existingContent, sessionId, linkHref);
  }

  const bodyBeforeAppendix = existingContent.slice(0, markerIdx);
  const appendixSection = existingContent.slice(markerIdx);
  const existingSessionIds = extractSessionIdsFromAppendix(appendixSection);
  if (existingSessionIds.has(sessionId)) return existingContent;

  const newBullet = buildBullet(sessionId, linkHref);
  const updatedAppendix = appendBulletToAppendix(appendixSection, newBullet);
  return bodyBeforeAppendix + updatedAppendix;
}

function buildBullet(sessionId: string, linkHref: string): string {
  const short = sessionId.slice(0, SESSION_ID_SHORT_LEN) || sessionId;
  return `- [session ${short}](${linkHref})`;
}

function appendFreshAppendix(
  body: string,
  sessionId: string,
  linkHref: string,
): string {
  const bullet = buildBullet(sessionId, linkHref);
  const separator = body.length === 0 || body.endsWith("\n") ? "" : "\n";
  const leadingBlank = body.length === 0 ? "" : "\n";
  return `${body}${separator}${leadingBlank}${BACKLINKS_MARKER}\n${HISTORY_HEADING}\n\n${bullet}\n`;
}

// Walk the appendix section looking for `- [...](...)` bullets and
// collect the session id from each link href. No regex — the href
// format is tightly constrained (one bracket pair then one paren
// pair) so a character scan is sufficient and faster than a
// backtracking regex.
function extractSessionIdsFromAppendix(appendix: string): Set<string> {
  const ids = new Set<string>();
  for (const rawLine of appendix.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- ") && !line.startsWith("* ")) continue;
    const href = extractHrefFromBullet(line);
    if (!href) continue;
    const id = extractSessionIdFromHref(href);
    if (id) ids.add(id);
  }
  return ids;
}

// Given a bullet line like `- [session abc](../../chat/abc-123.jsonl)`,
// return the href. Returns null for malformed bullets.
function extractHrefFromBullet(line: string): string | null {
  const bracketOpen = line.indexOf("[");
  if (bracketOpen === -1) return null;
  const bracketClose = line.indexOf("]", bracketOpen + 1);
  if (bracketClose === -1) return null;
  if (line[bracketClose + 1] !== "(") return null;
  const parenClose = line.indexOf(")", bracketClose + 2);
  if (parenClose === -1) return null;
  return line.slice(bracketClose + 2, parenClose);
}

// Pull the session id out of an href that ends with a `.jsonl`
// filename under some `chat/` segment. Supports both workspace-
// absolute (`/chat/<id>.jsonl`) and relative (`../../chat/<id>.jsonl`)
// forms so the dedupe is robust to the caller's path choice.
function extractSessionIdFromHref(href: string): string | null {
  const JSONL_SUFFIX = ".jsonl";
  // Strip optional #fragment or ?query tail.
  const cleanHref = stripFragmentAndQuery(href);
  if (!cleanHref.endsWith(JSONL_SUFFIX)) return null;
  const lastSlash = cleanHref.lastIndexOf("/");
  if (lastSlash === -1) return null;
  const parentSegment = findPrecedingSegment(cleanHref, lastSlash);
  if (parentSegment !== "chat") return null;
  const id = cleanHref.slice(
    lastSlash + 1,
    cleanHref.length - JSONL_SUFFIX.length,
  );
  if (id.length === 0 || id.includes("/")) return null;
  return id;
}

function stripFragmentAndQuery(s: string): string {
  let end = s.length;
  const hash = s.indexOf("#");
  if (hash !== -1) end = hash;
  const query = s.indexOf("?");
  if (query !== -1 && query < end) end = query;
  return s.slice(0, end);
}

// Given `.../chat/abc.jsonl` and the index of the last `/`, return
// the segment immediately before the filename (here: `"chat"`).
function findPrecedingSegment(s: string, lastSlash: number): string {
  const prevSlash = s.lastIndexOf("/", lastSlash - 1);
  return s.slice(prevSlash + 1, lastSlash);
}

// Insert `newBullet` at the end of the History list inside the
// appendix. The appendix already contains the marker + heading +
// zero or more bullets; we simply append another bullet line,
// preserving any trailing blank lines the user may have added.
function appendBulletToAppendix(appendix: string, newBullet: string): string {
  // Normalise: ensure exactly one trailing newline before adding.
  // Hand-rolled rtrim so sonarjs/slow-regex stays quiet.
  let end = appendix.length;
  while (end > 0) {
    const ch = appendix.charCodeAt(end - 1);
    // Whitespace codepoints we expect here: \n, \r, \t, space.
    if (ch !== 10 && ch !== 13 && ch !== 9 && ch !== 32) break;
    end--;
  }
  return `${appendix.slice(0, end)}\n${newBullet}\n`;
}
