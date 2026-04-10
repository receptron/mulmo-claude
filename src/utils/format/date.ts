// Pure formatting helpers used by the sidebar / history pane.

// "Apr 11 06:32" — short month, numeric day, 24h hour:minute. The
// implementation is locale-aware on purpose; tests assert structural
// properties only, not exact strings, since the locale of the test
// environment is not pinned.
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}
