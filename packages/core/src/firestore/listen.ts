// What is true of a Firestore LISTENER, whatever it is listening to.
//
// A `onSnapshot` error terminates that listener and never recovers on its own,
// so every long-lived listener in this package needs the same three answers:
// is this error worth re-subscribing for, how long to wait before trying, and
// when to stop trying. Those answers are about Firestore, not about the feature
// on top of it.
//
// Extracted from `remote-host/server/hostRunner.ts` when the shared-collection
// store grew a listener of its own. Kept in ONE place deliberately: the two
// would drift, and drift here is silent — one subsystem would keep retrying a
// revoked grant forever while the other gave up on a network blip. `hostRunner`
// re-exports these under their original names, so its published surface (which
// MulmoTerminal imports) is unchanged.

import { isRecord } from "@mulmoclaude/common";

// Firestore listen errors worth re-subscribing for: network / backend blips, plus
// `unauthenticated` — the SDK refreshes tokens on its own, so an expired one is
// fixed by trying again, and stopping the host at the first expiry was far too
// strong (#2633). Everything else — permission-denied and any unrecognized code —
// is fatal: re-listening can't restore a revoked grant, and an open-ended retry on
// an unknown code would loop forever. Retrying is bounded by LISTEN_RETRY_WINDOW_MS
// either way, so even a doomed retry ends in an escalation rather than a spin.
const TRANSIENT_LISTEN_ERROR_CODES = new Set(["aborted", "cancelled", "deadline-exceeded", "internal", "resource-exhausted", "unauthenticated", "unavailable"]);

const listenErrorCode = (error: unknown): string => (isRecord(error) && typeof error.code === "string" ? error.code : "");

export const classifyListenerError = (error: unknown): "transient" | "fatal" =>
  TRANSIENT_LISTEN_ERROR_CODES.has(listenErrorCode(error)) ? "transient" : "fatal";

const BASE_LISTEN_RETRY_MS = 1_000;
const MAX_LISTEN_RETRY_MS = 30_000;
// How long a listener may keep failing before its owner stops retrying in place
// and escalates (re-auth, re-mount). Bounding this by a RETRY COUNT instead made
// it ~31s of wall clock — shorter than any laptop sleep or network move, after
// which the host never re-subscribed (#2633).
export const LISTEN_RETRY_WINDOW_MS = 5 * 60_000;

// The outage is measured from its first failure, not from the last attempt: a
// backoff ladder that keeps failing must not extend its own deadline.
export const shouldGiveUpListening = (downSinceMs: number, now: number, windowMs: number = LISTEN_RETRY_WINDOW_MS): boolean => now - downSinceMs >= windowMs;

// Exponential backoff, capped: attempt 0 → 1s, 1 → 2s, … saturating at 30s.
export const backoffDelayMs = (attempt: number): number => Math.min(MAX_LISTEN_RETRY_MS, BASE_LISTEN_RETRY_MS * 2 ** attempt);
