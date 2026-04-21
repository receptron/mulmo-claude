// Writable computed that bridges activeSession.selectedResultUuid
// with the URL's ?result= query parameter.

import { computed, watch, type ComputedRef, type WritableComputedRef } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import type { ActiveSession } from "../types/session";

export function useSelectedResult(opts: {
  activeSession: ComputedRef<ActiveSession | undefined>;
  sessionMap: Map<string, ActiveSession>;
  currentSessionId: { readonly value: string };
}): {
  selectedResultUuid: WritableComputedRef<string | null>;
} {
  const { activeSession } = opts;
  const route = useRoute();
  const router = useRouter();

  const selectedResultUuid = computed({
    get: () => activeSession.value?.selectedResultUuid ?? null,
    set: (val: string | null) => {
      if (activeSession.value) activeSession.value.selectedResultUuid = val;
      const { result: __result, ...restQuery } = route.query;
      const nextQuery = val ? { ...restQuery, result: val } : restQuery;
      router.replace({ query: nextQuery }).catch((err: unknown) => {
        if (!isNavigationFailure(err)) {
          console.error("[selectedResultUuid] navigation failed:", err);
        }
      });
    },
  });

  // External URL changes for ?result= → sync into the session.
  watch(
    () => route.query.result,
    (newResult) => {
      const session = opts.sessionMap.get(opts.currentSessionId.value);
      if (!session) return;
      // Ignore malformed (array) values rather than clobbering state.
      if (Array.isArray(newResult)) return;
      const resultId = typeof newResult === "string" ? newResult : null;
      if (resultId !== session.selectedResultUuid) {
        session.selectedResultUuid = resultId;
      }
    },
  );

  return { selectedResultUuid };
}
