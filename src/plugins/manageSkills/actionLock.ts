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
