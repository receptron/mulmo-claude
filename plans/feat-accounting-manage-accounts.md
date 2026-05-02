# Plan: Accounting plugin — Manage Accounts modal

The accounting plugin ships a `getAccounts` / `upsertAccount` REST + MCP surface, but the only path to add or rename an account today is for the user to ask Claude. The journal entry and opening balances forms both depend on the account dropdowns, and a user mid-form who notices a missing or mistyped account has to context-switch to a chat turn just to fix it.

This plan adds an inline **Manage accounts** modal triggered from both forms, reusing the existing server endpoints.

GA itself (route registration, launcher button, role inclusion) remains gated by `plans/feat-accounting-followups.md` — this PR only changes the in-canvas UI.

## Scope

One PR, four code-touching pieces plus i18n:

1. **`AccountsModal.vue`** — new component, list + inline upsert
2. **Trigger buttons** — add into `JournalEntryForm.vue` and `OpeningBalancesForm.vue` headers
3. **Pub/sub-driven refresh** — `View.vue` refetches `accounts` on `bookVersion` bump
4. **i18n** — `pluginAccounting.accounts.*` block in all 8 locales

Out of scope:

- **Account deletion.** No `deleteAccount` action exists server-side, and adding one needs rules for accounts with posted entries (refuse vs. require-zero-balance vs. soft-delete). Defer to a follow-up if user feedback asks for it.
- **Bulk import.** A "paste a CSV chart of accounts" affordance is tempting but out of scope; the LLM `upsertAccount` route already covers the bulk case for power users.
- **Server changes.** Existing `upsertAccount` already validates code-prefix `_` and account-type-change-when-posted. The modal just consumes those errors verbatim.

## 1. AccountsModal.vue

New file: `src/plugins/accounting/components/AccountsModal.vue`.

**Props**

```ts
{ bookId: string; accounts: Account[] }
```

**Emits**

```ts
{ close: []; changed: [] }
```

`changed` fires after every successful `upsertAccount`. Parent forms re-emit upward so `View.vue` can refetch (covered by Section 3 — but the explicit emit is kept as a fallback in case pub/sub is unavailable in some test contexts).

**Layout**

Modal uses the same overlay pattern as `NewBookForm.vue` (modal mode) — `fixed inset-0 z-50 bg-black/20 flex items-center justify-center`. Backdrop click + `Esc` key + Cancel button all close. Body is a fixed-width card (`w-[28rem]` or so), max-height capped to viewport with scrolling so a long chart of accounts doesn't blow the layout.

```
┌─ Manage accounts ─────────────────────── ✕ ─┐
│                                              │
│  Assets                                      │
│    1000  Cash             asset      [Edit] │
│    1010  Bank — Checking  asset      [Edit] │
│    …                                         │
│                                              │
│  Liabilities                                 │
│    2000  Accounts Payable liability  [Edit] │
│    …                                         │
│                                              │
│  Equity / Income / Expense                   │
│    …                                         │
│                                              │
│  ─────────────────────────────────────       │
│  [+ Add account]                             │
│                                              │
└──────────────────────────────────────────────┘
```

When the user clicks `[Edit]` on a row OR `[+ Add account]`, the row (or the trailing block) expands into an inline editor:

```
  ┌────────────────────────────────────────┐
  │ Code  [____]  Name  [_______________]  │
  │ Type  [select v]  Note  [__________]   │
  │ [Cancel]  [Save]                       │
  └────────────────────────────────────────┘
```

Only one editor is open at a time — opening a second collapses the first.

**Behavior**

- `code` is editable both for new and existing accounts. The server matches on `code`, so editing the code of an existing row creates a new account row rather than renaming the original. To keep the modal honest, we mark `code` as **read-only when editing an existing account**; the placeholder workflow for renaming a code is "create a new account → re-post entries → leave the old one." (A real rename needs server work — out of scope.)
- `type` is a plain `<select>` over the 5 `AccountType` values. The server accepts type changes (it invalidates all snapshots on change so balances re-derive correctly). No client-side gating needed.
- `note` is optional, free-form.
- Client-side validation before the API call:
  - `code` non-empty
  - `code` does not start with `_` (server-reserved for synthetic report rows)
  - `name` non-empty
  - On a brand-new (add) editor, `code` must not collide with an existing account's `code` in the local list — surface a clear "already exists" message rather than letting the user accidentally edit the existing row in place.
- Successful save → call parent's `changed` emit, collapse the editor, show a transient (~2s) success line at the top of the modal. Modal stays open so the user can edit several accounts in a row.
- Backdrop / Cancel / Esc → close (no confirm — the user hasn't lost anything; saves are per-row).

**Accessibility**

- Root has `role="dialog"` and `aria-modal="true"`.
- Initial focus lands on the close button (or the first editor input when the modal opens directly into add-mode — see Section 2).
- `Esc` closes the modal regardless of where focus is.

**Data refresh**

The modal does **not** maintain a local copy of `accounts`. It re-derives groups from `props.accounts`. Section 3 ensures the parent re-fetches and re-passes the prop after every save, so the list re-renders with the new account on the next tick.

## 2. Trigger buttons in the two forms

`JournalEntryForm.vue` and `OpeningBalancesForm.vue` both have an `<h3>` form title at the top. Add a **Manage accounts** button (icon + label pill, chrome-standard `h-8 px-2.5`) right-aligned on the same row.

```vue
<div class="flex items-center justify-between">
  <h3 class="text-base font-semibold">{{ t("pluginAccounting.entryForm.title") }}</h3>
  <button
    type="button"
    class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
    data-testid="accounting-manage-accounts"
    @click="showAccountsModal = true"
  >
    <span class="material-icons text-base">tune</span>
    <span>{{ t("pluginAccounting.accounts.manageButton") }}</span>
  </button>
</div>
```

State + mount:

```ts
const showAccountsModal = ref(false);
```

```vue
<AccountsModal
  v-if="showAccountsModal"
  :book-id="bookId"
  :accounts="accounts"
  @close="showAccountsModal = false"
  @changed="emit('accounts-changed')"
/>
```

Both forms surface a new event `accounts-changed` so the parent (`View.vue`) can refetch. This event is **not strictly required** if Section 3 lands — the pub/sub version bump already triggers refetch — but the explicit path is cheap and keeps the modal usable in any future test/host that doesn't run pub/sub.

`data-testid` map:

| Element | testid |
|---|---|
| Trigger button | `accounting-manage-accounts` |
| Modal root | `accounting-accounts-modal` |
| Add-account CTA | `accounting-accounts-add` |
| Edit button per row | `accounting-accounts-edit-{code}` |
| Code input (editor) | `accounting-accounts-form-code` |
| Name input | `accounting-accounts-form-name` |
| Type select | `accounting-accounts-form-type` |
| Save button | `accounting-accounts-form-save` |
| Cancel button | `accounting-accounts-form-cancel` |
| Error line | `accounting-accounts-form-error` |
| Success line | `accounting-accounts-success` |

## 3. View.vue — refetch accounts on bookVersion bump

`server/accounting/service.ts` already publishes `BookChange{kind:"accounts"}` after every `upsertAccount`, and `View.vue` already subscribes via `useAccountingChannel(activeBookId)`. But the existing `refetchAccounts` only fires on `activeBookId` change, so today an LLM-driven `upsertAccount` doesn't refresh the dropdowns in an open `JournalEntryForm` either — this is a latent staleness bug the modal would otherwise inherit.

Fix:

```ts
watch(
  () => [activeBookId.value, bookVersion.value],
  () => {
    if (activeBookId.value) void refetchAccounts();
  },
  { immediate: true },
);
```

(Replaces the existing `watch(activeBookId, …)` — `bookVersion.value` already includes `pubsubVersion + localVersion`, so the new watcher subsumes the old one.)

`refetchAccounts` is a small JSON read; firing it on every bookVersion bump (entries, voids, openings, account upserts, snapshot rebuilds) is cheap and removes a class of dropdown-staleness bugs. Confirmed via `server/accounting/eventPublisher.ts` that the publish surface for accounts is already in place — no server changes.

## 4. i18n — all 8 locales in lockstep

New `pluginAccounting.accounts` block alongside the existing `pluginAccounting.settings` etc.

Schema (English values shown; localized values in each file):

```ts
pluginAccounting: {
  // …existing keys…
  accounts: {
    manageButton: "Manage accounts",
    modalTitle: "Manage accounts",
    addAccount: "Add account",
    sectionTitle: {
      asset: "Assets",
      liability: "Liabilities",
      equity: "Equity",
      income: "Income",
      expense: "Expenses",
    },
    columnCode: "Code",
    columnName: "Name",
    columnType: "Type",
    columnNote: "Note",
    typeOption: {
      asset: "Asset",
      liability: "Liability",
      equity: "Equity",
      income: "Income",
      expense: "Expense",
    },
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    saving: "Saving…",
    errorEmptyCode: "Code is required.",
    errorReservedCode: "Codes starting with “_” are reserved for system rows.",
    errorEmptyName: "Name is required.",
    errorDuplicateCode: "An account with this code already exists.",
    success: "Account saved.",
    codeReadOnlyHint: "Code can't be changed once an account is created.",
    noteOptional: "(optional)",
  },
},
```

Locales to update in lockstep (CLAUDE.md requirement): `en.ts`, `ja.ts`, `zh.ts`, `ko.ts`, `es.ts`, `pt-BR.ts`, `fr.ts`, `de.ts`. Brand / type names stay English where consistent with existing convention (account type labels are localized — they're user-facing, not API tokens).

## Test plan

**Unit / typecheck / lint** — full `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build` clean.

**Manual smoke** in the dev server:

1. Open accounting → New entry → click **Manage accounts** → modal opens listing 18 default accounts grouped by type.
2. Click `[Edit]` on `5100 Rent` → change name to "Rent — Office" → Save → success line appears, list re-renders with the new name.
3. Reopen the entry form's account dropdown — new name shows.
4. Click `[+ Add account]` → enter `5500` / "Marketing" / expense / "" → Save → list shows the new row under Expenses.
5. Try `[+ Add account]` with code `_synthetic` → client-side error.
6. Try editing an account that has a posted entry and switch its type → server-side error surfaces inline.
7. Edit `5100 Rent` → switch its type from expense to asset → Save → list re-renders with the new type. (Server invalidates snapshots; reports recompute on next view.)
8. Repeat steps 1–4 from the **Opening** tab → identical flow.
9. With the accounts modal open in window A, run `manageAccounting upsertAccount` from a chat turn → modal list refreshes within ~1s (pub/sub).

**E2E (Playwright)** — defer to a follow-up. The flow is straightforward but the existing `e2e/accounting.spec.ts` is already large; a separate PR can add a `manage-accounts.spec.ts` covering the add / edit / validation paths once this UI lands and stabilizes. Note in the PR description so reviewers know it's intentional.

**Manual testing checklist** entry — append a new row to `docs/manual-testing.md` under the Accounting section once it lands.

## Rollout notes

- No server changes, no migrations.
- No new permissions or routes.
- Behaviour change behind the existing manageAccounting plugin — opt-in role only.
- PR title: `feat(accounting): manage accounts modal`.
