// @package-contract — see ./types.ts
//
// In-memory FIFO queue for server→bridge pushes that fire while no
// bridge socket is connected. One queue per transportId. On socket
// reconnect, the attaching socket's handler drains its transport's
// queue and emits the messages to that specific socket.
//
// Kept DI-free: no host-app imports, no fs writes. A future Phase
// B.2 can swap this out for a durable queue with the same interface.
//
// Not bounded — bridges reconnect quickly enough in normal operation
// that the steady state is zero. An adversarial producer could OOM
// the process; revisit if that threat model changes.

export interface PushMessage {
  chatId: string;
  message: string;
  enqueuedAt: number;
}

export interface PushQueue {
  /** Append a message to the transport's queue. */
  enqueue(transportId: string, message: PushMessage): void;
  /** Remove and return all queued messages for `transportId`. */
  drainFor(transportId: string): PushMessage[];
  /** How many messages are currently queued for `transportId` (test aid). */
  sizeFor(transportId: string): number;
}

export function createPushQueue(): PushQueue {
  const queues = new Map<string, PushMessage[]>();

  return {
    enqueue(transportId, message) {
      const existing = queues.get(transportId);
      if (existing) {
        existing.push(message);
      } else {
        queues.set(transportId, [message]);
      }
    },
    drainFor(transportId) {
      const existing = queues.get(transportId);
      if (!existing) return [];
      queues.delete(transportId);
      return existing;
    },
    sizeFor(transportId) {
      return queues.get(transportId)?.length ?? 0;
    },
  };
}
