import { ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { loadPageEdit } from "../pageEditLoader";

interface WikiPageEditDeps {
  content: Ref<string>;
}

export interface WikiPageEditState {
  // Snapshot's own timestamp (header subtitle); null once reset / not a snapshot.
  pageEditTs: Ref<string | null>;
  // Shown only when the snapshot was gc'd and we fell back to the live page.
  pageEditBanner: Ref<string | null>;
  // Flips on when neither the snapshot nor the live page survives (genuine deletion).
  pageEditDeleted: Ref<boolean>;
  // Set on a transient load failure (network / 5xx) — the page may still exist.
  pageEditError: Ref<string | null>;
  loadPageEditData: (slug: string, stamp: string) => Promise<void>;
  resetPageEdit: () => void;
}

// `page-edit` action state (Stage 3a, #963). Populated when an LLM Write/Edit
// toolResult is mounted: the body comes from the snapshot endpoint, not the
// live-page /api/wiki fetch.
export function useWikiPageEdit(deps: WikiPageEditDeps): WikiPageEditState {
  const { t } = useI18n();
  const pageEditTs = ref<string | null>(null);
  const pageEditBanner = ref<string | null>(null);
  const pageEditDeleted = ref(false);
  const pageEditError = ref<string | null>(null);

  function resetPageEdit(): void {
    pageEditTs.value = null;
    pageEditBanner.value = null;
    pageEditDeleted.value = false;
    pageEditError.value = null;
  }

  // Monotonic token so a slow load for one toolResult can't overwrite the
  // state of a different one the user selected while it was in flight.
  let loadToken = 0;

  async function loadPageEditData(slug: string, stamp: string): Promise<void> {
    const token = ++loadToken;
    resetPageEdit();
    deps.content.value = "";

    const result = await loadPageEdit(slug, stamp);
    if (token !== loadToken) return;
    if (result.kind === "snapshot") {
      pageEditTs.value = result.ts;
      deps.content.value = result.content;
      return;
    }
    if (result.kind === "current") {
      pageEditBanner.value = t("pluginWiki.snapshotExpired");
      deps.content.value = result.content;
      return;
    }
    if (result.kind === "error") {
      pageEditError.value = t("pluginWiki.snapshotLoadError");
      return;
    }
    pageEditDeleted.value = true;
  }

  return { pageEditTs, pageEditBanner, pageEditDeleted, pageEditError, loadPageEditData, resetPageEdit };
}
