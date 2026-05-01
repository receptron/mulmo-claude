<template>
  <!-- Compact inline summary for non-openApp tool results. The
       openApp envelope routes to View.vue (full app) instead of
       this component; everything that lands here is a
       compact-result action (addEntry, getReport, …). -->
  <div class="text-sm text-gray-700" data-testid="accounting-preview">
    <span class="material-icons text-base align-middle mr-1">account_balance</span>
    <span>{{ summary }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{ data?: unknown; jsonData?: Record<string, unknown> }>();

interface BalanceSheetSection {
  type: string;
  total?: number;
}
interface BalanceSheetLike {
  balanceSheet?: { asOf?: string; sections?: BalanceSheetSection[]; imbalance?: number };
}
interface ProfitLossLike {
  profitLoss?: { from?: string; to?: string; netIncome?: number };
}
interface EntryLike {
  entry?: { id?: string; date?: string };
}
interface BookLike {
  book?: { id?: string; name?: string };
}

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Each summarise* helper returns null when its branch doesn't apply,
// keeping the dispatch in `summary` linear (no nested if-trees).

function summariseError(json: Record<string, unknown>): string | null {
  const { error } = json as { error?: unknown };
  if (typeof error !== "string") return null;
  return t("pluginAccounting.previewError", { error });
}

function summariseEntry(json: Record<string, unknown>): string | null {
  const { entry } = json as EntryLike;
  if (!entry?.id || !entry?.date) return null;
  return t("pluginAccounting.preview.entry", { date: entry.date });
}

function summarisePl(json: Record<string, unknown>): string | null {
  const { profitLoss } = json as ProfitLossLike;
  if (!profitLoss || typeof profitLoss.netIncome !== "number") return null;
  return t("pluginAccounting.preview.pl", {
    from: profitLoss.from ?? "?",
    to: profitLoss.to ?? "?",
    net: formatAmount(profitLoss.netIncome),
  });
}

function summariseBs(json: Record<string, unknown>): string | null {
  const { balanceSheet } = json as BalanceSheetLike;
  if (!balanceSheet?.asOf || !balanceSheet.sections) return null;
  const assets = balanceSheet.sections.find((section) => section.type === "asset");
  return t("pluginAccounting.preview.bs", {
    date: balanceSheet.asOf,
    assets: assets ? formatAmount(assets.total ?? 0) : "?",
  });
}

function summariseBook(json: Record<string, unknown>): string | null {
  const { book } = json as BookLike;
  if (!book?.id || !book?.name) return null;
  return t("pluginAccounting.preview.bookCreated", { name: book.name, id: book.id });
}

function summariseFallback(json: Record<string, unknown>): string {
  const { bookId } = json as { bookId?: unknown };
  if (typeof bookId === "string") return t("pluginAccounting.previewSummary", { bookId });
  return t("pluginAccounting.previewGeneric");
}

function asObject(value: unknown): Record<string, unknown> {
  // Some renderers pass the structured payload via `data`, others
  // via `jsonData`. Accept either so a tool-result like
  // `{ entry: ... }` resolves to the right summariser regardless
  // of which prop the host harness picks.
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const summary = computed<string>(() => {
  const json = { ...asObject(props.data), ...asObject(props.jsonData) };
  return summariseError(json) ?? summariseEntry(json) ?? summarisePl(json) ?? summariseBs(json) ?? summariseBook(json) ?? summariseFallback(json);
});
</script>
