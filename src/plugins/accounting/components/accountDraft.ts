// Shared draft shape for the AccountsModal editor row. Lives in
// its own module so AccountsModal.vue and AccountEditor.vue can
// both type the prop / emit without one importing the other —
// they form a parent / child pair, not a re-export chain.

import type { AccountType } from "../api";

export interface AccountDraft {
  code: string;
  name: string;
  type: AccountType;
  note: string;
}
