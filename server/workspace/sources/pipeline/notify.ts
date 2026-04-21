// Notify phase — score items by user interests and publish
// notifications for interesting findings (#466).
//
// Inserted between dedup and summarize in the pipeline.
// Skipped entirely when config/interests.json doesn't exist.

import { publishNotification } from "../../../events/notifications.js";
import { NOTIFICATION_KINDS, NOTIFICATION_PRIORITIES, NOTIFICATION_ACTION_TYPES, NOTIFICATION_VIEWS } from "../../../../src/types/notification.js";
import { loadInterests, scoreAndFilter, type ScoredItem } from "../interests.js";
import type { SourceItem } from "../types.js";

export interface NotifyPhaseResult {
  notified: ScoredItem[];
  skippedReason: string | null;
}

export function runNotifyPhase(items: readonly SourceItem[], workspaceRoot?: string): NotifyPhaseResult {
  const profile = loadInterests(workspaceRoot);
  if (!profile) {
    return { notified: [], skippedReason: "no interests profile" };
  }

  const interesting = scoreAndFilter(items, profile);
  if (interesting.length === 0) {
    return { notified: [], skippedReason: "no items above threshold" };
  }

  publishBatchNotification(interesting);
  return { notified: interesting, skippedReason: null };
}

function formatSingleBody(item: SourceItem): string {
  const suffix = item.summary ? " \u2014 " + item.summary : "";
  return "From " + item.sourceSlug + suffix;
}

function publishBatchNotification(scored: readonly ScoredItem[]): void {
  if (scored.length === 1) {
    const { item } = scored[0];
    publishNotification({
      kind: NOTIFICATION_KINDS.push,
      title: item.title,
      body: formatSingleBody(item),
      priority: item.severity === "critical" ? NOTIFICATION_PRIORITIES.high : NOTIFICATION_PRIORITIES.normal,
      action: {
        type: NOTIFICATION_ACTION_TYPES.navigate,
        view: NOTIFICATION_VIEWS.files,
      },
    });
    return;
  }

  const bullets = scored
    .slice(0, 5)
    .map((s) => `\u2022 ${s.item.title} (${s.item.sourceSlug})`)
    .join("\n");
  const extra = scored.length > 5 ? `\n+${scored.length - 5} more` : "";

  // Preserve high priority if any item in the batch is critical
  const hasCritical = scored.some((s) => s.item.severity === "critical");

  publishNotification({
    kind: NOTIFICATION_KINDS.push,
    title: `${scored.length} interesting articles found`,
    body: `${bullets}${extra}`,
    priority: hasCritical ? NOTIFICATION_PRIORITIES.high : NOTIFICATION_PRIORITIES.normal,
    action: {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      view: NOTIFICATION_VIEWS.files,
    },
  });
}
