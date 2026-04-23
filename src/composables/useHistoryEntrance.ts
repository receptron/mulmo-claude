// Tracks the fullPath of the page the user was on just before they
// navigated INTO the /history route. Used by the history-close button
// so it can push-forward back to where the user came from, instead of
// using router.back() — "close" is an explicit user intent and should
// create a new history entry, not rewind. (See review thread on #681
// for the full rationale.)
//
// Scope:
//   - Records `from.fullPath` on every non-history → /history transition.
//   - Value is NOT cleared when the user leaves /history. It gets
//     overwritten on the NEXT entrance. This keeps the value meaningful
//     across a session click (/history → /chat/<id>) without losing
//     the original pre-history URL if the user immediately opens
//     /history again from the same place.
//   - When the user deep-links into /history directly (no prior entry),
//     `preHistoryUrl` stays null — the caller falls back to /chat.

import { ref, type Ref } from "vue";
import { useRouter } from "vue-router";
import { PAGE_ROUTES } from "../router";

export function useHistoryEntrance(): { preHistoryUrl: Ref<string | null> } {
  const router = useRouter();
  const preHistoryUrl = ref<string | null>(null);

  router.afterEach((nextRoute, prevRoute) => {
    const enteringHistory = nextRoute.name === PAGE_ROUTES.history && prevRoute.name !== PAGE_ROUTES.history;
    // Skip the synthetic START_LOCATION (prevRoute.name === undefined),
    // which fires on initial navigation when the user deep-links
    // straight to /history. No real "pre-history page" exists in that
    // case — leaving preHistoryUrl null makes handleHistoryClick fall
    // back to /chat instead of pushing to the bogus "/" root.
    if (enteringHistory && prevRoute.name != null && typeof prevRoute.fullPath === "string" && prevRoute.fullPath.length > 0) {
      preHistoryUrl.value = prevRoute.fullPath;
    }
  });

  return { preHistoryUrl };
}
