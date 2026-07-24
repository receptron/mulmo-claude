// Host side of the command channel: claim queued commands, run handlers, write
// results back, and announce presence via heartbeat.
//
// Extracted into core from MulmoClaude's server/remoteHost/hostRunner.ts (itself
// ported from ../mulmoserver). The only signature change vs. that copy: the
// `firestore` instance is a parameter (each host supplies its own Firebase init),
// and the heartbeat interval is an option (defaults to one minute).
import { DocumentReference, Firestore, deleteDoc, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";

import { errorMessage } from "../../collection/core/errorMessage.js";
import {
  Channel,
  Command,
  CommandHandler,
  CommandHandlers,
  JsonObject,
  buildHostPresence,
  byCreatedAt,
  commandsCollection,
  hostDoc,
  isExpired,
} from "../index.js";

const DEFAULT_HEARTBEAT_MS = 60_000;

export interface HostEvent {
  phase: "received" | "done" | "error";
  method: string;
  message?: string;
}

export interface HostRunnerOptions {
  onEvent?: (event: HostEvent) => void;
  // Called once when the listener dies fatally (after presence has been set
  // offline), so the lifecycle owner can reconcile its own state — e.g. clear
  // the runner handle so status() no longer reports connected. NOT called on a
  // normal stop().
  onClosed?: () => void;
  // Called when a command is dropped for being past its `expiresAt`, BEFORE the
  // doc is deleted, so the host can clean up out-of-band resources the command
  // referenced (e.g. staged attachment uploads in Storage). `uid` is THIS runner's
  // session uid (channel.uid) — passed in rather than read from a global so a
  // concurrent reconnect as a different account can't point cleanup at the wrong
  // user's Storage path. Best-effort: a throw is logged via onEvent and does NOT
  // block the doc deletion. Absent ⇒ the expired doc is simply deleted.
  onExpire?: (command: Command, uid: string) => void | Promise<void>;
  // Presence heartbeat interval; defaults to one minute.
  heartbeatMs?: number;
}

interface Claim {
  method: string;
  params: JsonObject;
}

const noop = () => undefined;

// The remote may have deleted the doc on timeout, so ignore write-after-delete.
const writeError = (ref: DocumentReference, code: string, message: string) =>
  updateDoc(ref, { status: "error", error: { code, message }, updatedAt: serverTimestamp() }).catch(noop);

// Atomically move a command queued -> processing so it is handled exactly once.
// Returns the method/params to run, or null if another handler already took it.
const claimCommand = (firestore: Firestore, ref: DocumentReference): Promise<Claim | null> =>
  runTransaction(firestore, async (txn) => {
    const data = (await txn.get(ref)).data() as Command | undefined;
    if (!data || data.status !== "queued") {
      return null;
    }
    txn.update(ref, { status: "processing", updatedAt: serverTimestamp() });
    return { method: data.method, params: data.params ?? {} };
  });

// Own-property lookup: a bare `handlers[method]` with a method name written by a
// remote terminal resolves `constructor` / `toString` to an Object.prototype
// function, which is truthy and slips past the unknown-method check (#2319).
export const resolveCommandHandler = (handlers: CommandHandlers, method: string): CommandHandler | undefined =>
  Object.hasOwn(handlers, method) ? handlers[method] : undefined;

const runHandler = async (ref: DocumentReference, claim: Claim, handler: CommandHandler): Promise<HostEvent> => {
  try {
    const result = await handler(claim.params);
    await updateDoc(ref, { status: "done", result: result ?? null, updatedAt: serverTimestamp() });
    return { phase: "done", method: claim.method };
  } catch (error) {
    const message = errorMessage(error);
    await writeError(ref, "handler_error", message);
    return { phase: "error", method: claim.method, message };
  }
};

// A command past its deadline is removed entirely rather than run: give the host
// a chance to clean up out-of-band resources (staged attachments), then delete
// the doc so it is neither reprocessed nor left as a stale error. Both steps are
// best-effort/idempotent, so a snapshot replay surfacing the same expired doc
// twice is harmless (no claim transaction needed — see plan edge #3).
const expireCommand = async (ref: DocumentReference, command: Command, options: HostRunnerOptions, uid: string) => {
  try {
    await options.onExpire?.(command, uid);
  } catch (error) {
    options.onEvent?.({ phase: "error", method: command.method, message: `onExpire failed: ${errorMessage(error)}` });
  }
  // Surface a delete failure (permissions / transient network) the same way the
  // onExpire failure above is surfaced — otherwise the expired doc lingers as
  // "queued" with no signal as to why cleanup didn't happen.
  await deleteDoc(ref).catch((error) => {
    options.onEvent?.({ phase: "error", method: command.method, message: `expire delete failed: ${errorMessage(error)}` });
  });
  options.onEvent?.({ phase: "done", method: command.method, message: "expired" });
};

// Per-runner constants bundled into one context so processCommand stays under the
// max-params cap: firestore, the handler table, options, and the session uid are
// all fixed for the runner's lifetime; only ref/command/now vary per command.
interface RunnerContext {
  firestore: Firestore;
  handlers: CommandHandlers;
  options: HostRunnerOptions;
  uid: string;
}

const processCommand = async (ctx: RunnerContext, ref: DocumentReference, command: Command, now: number) => {
  const { handlers, options } = ctx;
  // Drop an expired command before claiming it — it must never reach a handler.
  if (isExpired(command, now)) {
    await expireCommand(ref, command, options, ctx.uid);
    return;
  }
  const claim = await claimCommand(ctx.firestore, ref);
  if (!claim) {
    return;
  }
  options.onEvent?.({ phase: "received", method: claim.method });
  const handler = resolveCommandHandler(handlers, claim.method);
  if (!handler) {
    await writeError(ref, "unknown_method", `No handler for method: ${claim.method}`);
    options.onEvent?.({ phase: "error", method: claim.method, message: "unknown method" });
    return;
  }
  options.onEvent?.(await runHandler(ref, claim, handler));
};

// startHostRunner subscribes to queued commands for the given channel and runs
// each one through the supplied handler table. It also announces presence (a
// heartbeat on users/{uid}/hosts/{hostId}) so the remote can tell it is online.
// Returns a stop function that goes offline and detaches the listener.
export const startHostRunner = (firestore: Firestore, channel: Channel, handlers: CommandHandlers, options: HostRunnerOptions = {}): (() => void) => {
  const presence = hostDoc(firestore, channel);
  // Advertise online/offline + the capability set (method names + protocol
  // version) on the same doc the remote already listens to for presence.
  // Returns void, not the promise: presence is advertised best-effort from
  // three call sites (announce, the snapshot-error path, the teardown), none of
  // which can await. Terminating the chain here with `.catch(noop)` keeps every
  // caller from floating a promise it has no way to handle.
  const writePresence = (online: boolean): void => {
    setDoc(presence, { ...buildHostPresence(channel, handlers, online), updatedAt: serverTimestamp() }).catch(noop);
  };
  const announce = () => {
    writePresence(true);
  };
  announce();
  const beat = setInterval(announce, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);

  const queuedCommands = query(commandsCollection(firestore, channel), where("status", "==", "queued"));
  const ctx: RunnerContext = { firestore, handlers, options, uid: channel.uid };
  const unsubscribe = onSnapshot(
    queuedCommands,
    (snapshot) => {
      const now = Date.now();
      // Best-effort oldest-first DISPATCH only. Commands are processed
      // concurrently (not awaited in turn) and out-of-order completion is fine by
      // design — chat is asynchronous — so this sort just biases which command
      // starts first; it is not an ordering guarantee. We still sort in memory
      // rather than orderBy("createdAt") on the query because a Firestore orderBy
      // silently EXCLUDES docs missing the field — which would drop every
      // pre-offline-queue command (no createdAt) from the queue entirely.
      const added = snapshot
        .docChanges()
        .filter((change) => change.type === "added")
        .map((change) => ({ ref: change.doc.ref, command: change.doc.data() as Command }))
        .sort((left, right) => byCreatedAt(left.command, right.command));
      added.forEach(({ ref, command }) => {
        processCommand(ctx, ref, command, now).catch(noop);
      });
    },
    (error) => {
      options.onEvent?.({ phase: "error", method: "listen", message: error.message });
      // A Firestore onSnapshot error terminates the listener and it does not
      // recover on its own. Stop advertising presence (clear the heartbeat +
      // write online:false) so remotes see the host as offline instead of a
      // live host that silently consumes no commands.
      clearInterval(beat);
      writePresence(false);
      options.onClosed?.();
    },
  );

  return () => {
    clearInterval(beat);
    writePresence(false);
    unsubscribe();
  };
};
