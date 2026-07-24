import { computed, ref, type ComputedRef, type Ref } from "vue";
import { WIKI_ACTION, incomingLinks, type WikiGraph, type WikiGraphNode } from "@mulmoclaude/core/wiki";
import type { WikiData } from "../index";
import { apiPost } from "../../../utils/api";
import { shouldLazyLoadGraph } from "../helpers";

interface WikiGraphDeps {
  action: Ref<string>;
  pageExists: Ref<boolean>;
  currentSlug: Ref<string | null>;
  endpointBase: string;
}

export interface WikiGraphState {
  graphData: Ref<WikiGraph | null>;
  graphError: Ref<string | null>;
  loadGraph: () => Promise<void>;
  syncGraphFromResult: (data: Partial<WikiData> | undefined) => void;
  linkedReferences: ComputedRef<WikiGraphNode[]>;
}

export function useWikiGraph(deps: WikiGraphDeps): WikiGraphState {
  // Loaded lazily once per browsing session and reused for both the Graph tab
  // and the per-page "Linked references" panel (the graph is global, so one
  // fetch serves every page's backlinks). Refreshed on the Graph tab fetch and
  // after a page save / restore so edited links propagate.
  const graphData = ref<WikiGraph | null>(null);
  const graphError = ref<string | null>(null);

  async function loadGraph(): Promise<void> {
    graphError.value = null;
    const response = await apiPost<{ data?: { graph?: WikiGraph } }>(deps.endpointBase, { action: WIKI_ACTION.graph });
    if (!response.ok) {
      graphError.value = response.status === 0 ? response.error : `Wiki graph error ${response.status}: ${response.error}`;
      return;
    }
    graphData.value = response.data.data?.graph ?? { nodes: [], edges: [] };
  }

  // Graph tab response carries the link graph directly. On a page view, lazily
  // fetch the graph once so the "Linked references" panel has data.
  function syncGraphFromResult(data: Partial<WikiData> | undefined): void {
    if (data?.graph) {
      // Clear any stale error from an earlier failed loadGraph so a fresh graph
      // payload isn't hidden behind the error banner.
      graphError.value = null;
      graphData.value = data.graph;
      return;
    }
    if (shouldLazyLoadGraph(deps.action.value, deps.pageExists.value, graphData.value !== null)) void loadGraph();
  }

  // Pages that link TO the page currently being viewed. Empty until the graph
  // loads (lazily, on the first page view).
  const linkedReferences = computed<WikiGraphNode[]>(() => {
    const slug = deps.currentSlug.value;
    if (graphData.value === null || slug === null) return [];
    return incomingLinks(graphData.value, slug);
  });

  return { graphData, graphError, loadGraph, syncGraphFromResult, linkedReferences };
}
