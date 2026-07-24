// Remote-host command-channel protocol — the browser-safe contract shared by a
// host (MulmoClaude, MulmoTerminal) and the remote/mobile client (mulmoserver).
//
// A host signs in to Firebase as the user, listens to that user's per-host
// command queue in Firestore, runs a handler, and writes the result back; the
// remote writes commands and reads results via a real-time listener. This module
// owns the wire types + the Firestore path helpers. It is the single source of
// truth so the host runner and the client never drift on the protocol.
//
// Ported from ../mulmoserver/src/firestore/commandChannel.ts and the per-host
// copy that lived in MulmoClaude's server/remoteHost/. The one change vs. those
// copies: the path helpers take the `firestore` instance as a parameter (rather
// than importing a module-level singleton) so a single extracted module serves
// every host's own Firebase init. The hostId is host-specific ("mulmoclaude",
// "mulmoterminal") and is supplied by each host — there is no discovery.
import { CollectionReference, DocumentData, DocumentReference, Firestore, collection, doc } from "firebase/firestore";

// JSON payloads carried by the command channel. Explicit JSON types keep the
// channel typed without resorting to any/unknown.
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

// A channel routes commands to one specific host. Both sides agree on a
// hardcoded hostId per use case (e.g. "mulmoclaude", "mulmoterminal"); there is
// no discovery — the remote and host just share the id.
export interface Channel {
  uid: string;
  hostId: string;
}

export type CommandStatus = "queued" | "processing" | "done" | "error";

export interface CommandError {
  code: string;
  message: string;
}

// One document in a channel's commands subcollection is one API-call-like
// request. The remote (mobile) writes method/params; the host writes
// result/error/status.
export interface Command {
  method: string;
  params: JsonObject;
  status: CommandStatus;
  result: JsonValue;
  error: CommandError | null;
  createdBy: "remote" | "host";
  // Offline-queue fields (all optional; absent ⇒ pre-offline-queue behaviour, so
  // this is backward-compatible with every deployed client). Epoch-millisecond
  // NUMBERS set by the remote at enqueue time — deliberately plain numbers, not
  // Firestore Timestamps, so `isExpired` / `byCreatedAt` stay pure + browser-safe
  // and unit-testable without a Firestore fake. Clock skew over a multi-day expiry
  // window is immaterial. See plans/done/feat-remote-offline-queue.md.
  createdAt?: number; // enqueue time — age/display + best-effort dispatch bias (NOT a strict order guarantee; chat is async)
  expiresAt?: number; // deadline; past it the host deletes the command + its staged attachments
  queuedOffline?: boolean; // emitted while the host was offline (gates the remote's attachment rollback)
}

// A command is expired once `now` reaches its remote-set deadline. Absent
// `expiresAt` ⇒ it never expires (pre-offline-queue commands). Pure with an
// injected `now` for deterministic tests; the runner passes `Date.now()`.
export const isExpired = (command: Pick<Command, "expiresAt">, now: number): boolean => typeof command.expiresAt === "number" && now >= command.expiresAt;

// Best-effort dispatch bias for a drained batch: oldest enqueue first. This is
// NOT an ordering guarantee — commands run concurrently and may complete out of
// order (chat is asynchronous, by design); it only nudges which one starts first.
// A command with no `createdAt` sorts as oldest (0) so it is never starved.
export const byCreatedAt = (left: Pick<Command, "createdAt">, right: Pick<Command, "createdAt">): number => (left.createdAt ?? 0) - (right.createdAt ?? 0);

export type CommandHandler = (params: JsonObject) => JsonValue | Promise<JsonValue>;
export type CommandHandlers = Record<string, CommandHandler>;

// Bumped when the command-channel wire protocol changes in a way the remote must
// gate on. Advertised in the presence doc so the remote can check compatibility
// before issuing commands.
//
// v2: offline queueing. The host honours `expiresAt` (deletes an expired command
// + its staged attachments instead of spawning a stale chat). A remote MUST see
// protocolVersion >= 2 before queueing a startChat while the host is offline —
// a v1 host silently ignores `expiresAt`, so a queued chat would spawn stale on
// reconnect with its uploads never cleaned up.
export const REMOTE_HOST_PROTOCOL_VERSION = 2;

// The presence doc's payload: online flag + a capability advertisement. Written
// by the host on every heartbeat; the remote reads it from the presence listener
// it already runs (no extra round trip, known the instant the host is online).
// Browser-safe so the mobile client compiles against the same shape.
// `updatedAt` (a Firestore serverTimestamp) is added by the runner at write time
// and is intentionally not part of this capability contract.
export interface HostPresence {
  online: boolean;
  hostId: string;
  protocolVersion: number;
  // Method names the host serves — the keys of the live handler table.
  capabilities: string[];
}

// Build the presence payload from the live handler table. Capabilities are
// `Object.keys(handlers)` so registering a handler is the ONLY step needed to
// advertise it — there is no second list to keep in sync.
export const buildHostPresence = (channel: Channel, handlers: CommandHandlers, online: boolean): HostPresence => ({
  online,
  hostId: channel.hostId,
  protocolVersion: REMOTE_HOST_PROTOCOL_VERSION,
  capabilities: Object.keys(handlers),
});

// Per-host command queue: users/{uid}/hosts/{hostId}/commands.
export const commandsCollection = (firestore: Firestore, channel: Channel): CollectionReference<DocumentData> =>
  collection(firestore, "users", channel.uid, "hosts", channel.hostId, "commands");

// Presence doc for a host: users/{uid}/hosts/{hostId}. The host heartbeats
// { online, updatedAt } here; the remote reads it to know if the host is up.
export const hostDoc = (firestore: Firestore, channel: Channel): DocumentReference<DocumentData> =>
  doc(firestore, "users", channel.uid, "hosts", channel.hostId);
