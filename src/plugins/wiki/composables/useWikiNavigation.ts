import { computed, type ComputedRef } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import { WIKI_ACTION, WIKI_ROUTE_SECTION, buildWikiRouteParams, type WikiTarget } from "@mulmoclaude/core/wiki";
import { resolveWikiSlug } from "../currentSlug";

export type WikiTabView = typeof WIKI_ACTION.log | typeof WIKI_ACTION.lintReport | typeof WIKI_ACTION.graph;

interface WikiNavigationDeps {
  pageWikiRoute: string;
  // Slug carried by an embedded manageWiki tool-result (WikiView mounted inside
  // /chat). On the standalone /wiki route the URL param wins over this.
  pageNameFromResult: () => string | null;
}

export interface WikiNavigation {
  currentSlugReactive: ComputedRef<string | null>;
  currentSlug: () => string | null;
  isStandaloneWikiRoute: ComputedRef<boolean>;
  pushWiki: (target: WikiTarget) => void;
  navigate: (newAction: typeof WIKI_ACTION.index | WikiTabView) => void;
  navigatePage: (pageName: string) => void;
}

export function useWikiNavigation(deps: WikiNavigationDeps): WikiNavigation {
  const route = useRoute();
  const router = useRouter();

  const currentSlugReactive = computed<string | null>(() =>
    resolveWikiSlug({
      onWikiRoute: route.name === deps.pageWikiRoute,
      onPagesSection: route.params.section === WIKI_ROUTE_SECTION.pages,
      routeSlug: route.params.slug,
      resultPageName: deps.pageNameFromResult(),
    }),
  );

  // Imperative accessor for the same value, for call sites that read the slug
  // at a specific moment (fetch endpoint, mid-flight save guard).
  const currentSlug = (): string | null => currentSlugReactive.value;

  const isStandaloneWikiRoute = computed(() => route.name === deps.pageWikiRoute);

  function pushWiki(target: WikiTarget): void {
    router.push({ name: deps.pageWikiRoute, params: buildWikiRouteParams(target) }).catch((err: unknown) => {
      if (!isNavigationFailure(err)) console.error("[wiki] navigation failed:", err);
    });
  }

  function navigate(newAction: typeof WIKI_ACTION.index | WikiTabView): void {
    pushWiki(newAction === WIKI_ACTION.index ? { kind: "index" } : { kind: newAction });
  }

  function navigatePage(pageName: string): void {
    pushWiki({ kind: "page", slug: pageName });
  }

  return { currentSlugReactive, currentSlug, isStandaloneWikiRoute, pushWiki, navigate, navigatePage };
}
