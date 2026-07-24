// Serialises the mutations of a client store that owns its whole state
// and persists it with a replace-all PUT (pinned shortcuts, dashboard
// layout).
//
// Two such saves in flight at once can land out of order, which
// resurrects a removed entry or drops a newly added one — both in the UI
// (the later response overwrites the ref) and on disk. Running every
// mutation through one queue removes the interleaving entirely.
//
// It also closes the cold-load race: each queued task awaits `load()`
// first, so the authoritative server state is in the ref before any task
// reads its `previous` snapshot. Without the queue a click during the
// boot GET persists `[]` plus the new entry, wiping everything already
// stored.
//
// Neither race reproduces on demand, so an implementation that drops the
// serialisation still looks correct in manual testing.

export interface MutationQueue {
  /** Run `task` only after every previously enqueued task has settled.
   *  Resolves/rejects with that task's own outcome. */
  enqueue: <T>(task: () => Promise<T>) => Promise<T>;
}

/** One independent queue per store. */
export function createMutationQueue(): MutationQueue {
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    // `task` sits in both handler slots so a rejected predecessor can
    // never stall the queue, even if the re-arm below stops swallowing.
    const run = chain.then(task, task);
    // Re-arm from a handled continuation: a task's failure is its own
    // caller's business and must not reach the tasks queued behind it.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return { enqueue };
}
