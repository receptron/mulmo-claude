interface EditorReloadInput {
  current: string;
  fresh: string | null;
  wasDirty: boolean;
}

// A dirty editor must survive an external file change even when the user
// deliberately cleared it to "" — an empty string is a valid edit, not a
// "nothing loaded yet" sentinel.
export const resolveEditorTextAfterReload = ({ current, fresh, wasDirty }: EditorReloadInput): string => {
  if (fresh === null || wasDirty) return current;
  return fresh;
};
