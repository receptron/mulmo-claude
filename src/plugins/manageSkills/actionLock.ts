export interface AcquireResult {
  acquired: boolean;
  /** The key to store: the requested key on success, the still-held key otherwise. */
  key: string | null;
}

// Acquire the single-action lock only when idle. Selecting a different entry
// and firing a second action while one is in flight would otherwise let a
// stale completion clear the lock out from under the newer action.
export const acquireActionKey = (current: string | null, requested: string): AcquireResult =>
  current === null ? { acquired: true, key: requested } : { acquired: false, key: current };

// Release only if the caller still owns the lock — a superseded action's
// late completion must never clear a newer holder.
export const releaseActionKey = (current: string | null, owner: string): string | null => (current === owner ? null : current);

// A repo action (install/update/uninstall) is blocked when the same class of
// action is already running (`selfInFlight`), OR the OPPOSITE action is
// running against the SAME repo (`otherInFlight === repoId`). The server has
// no lock, so a same-repo update/uninstall overlap can resurrect a deleted
// repo or leave a half-copied dir. Different repos never block each other.
export const repoActionBlocked = (selfInFlight: string | null, otherInFlight: string | null, repoId: string): boolean =>
  selfInFlight !== null || otherInFlight === repoId;
