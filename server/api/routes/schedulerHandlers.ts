// Pure action handlers for the scheduler POST route. Each handler
// takes the current items + the relevant body fields and returns
// a discriminated result describing either an HTTP error or the
// next state. The route handler in scheduler.ts dispatches to one
// of these and translates the result into an HTTP response.
//
// Keeping the action logic pure (no I/O, no globals) makes it
// straightforward to unit-test every case in isolation, and brings
// the cognitive complexity of the route handler under the lint
// threshold.

import type { ScheduledItem } from "./scheduler.js";
import { makeId } from "../../utils/id.js";

export interface SchedulerActionInput {
  title?: string;
  id?: string;
  props?: Record<string, string | number | boolean | null>;
  items?: ScheduledItem[];
}

export type SchedulerActionResult =
  | { kind: "error"; status: number; error: string }
  | {
      kind: "success";
      items: ScheduledItem[];
      message: string;
      jsonData: Record<string, unknown>;
    };

// Coerces the untrusted `props` payload into a safe-to-store
// object. Two responsibilities:
//
// 1. Non-object input (a number / string / array / null from
//    untrusted JSON) becomes an empty props object — `"endDate"
//    in 1` would otherwise throw a TypeError and surface as a
//    500 via the asyncHandler.
// 2. Non-string `endDate` (number / array / object) is dropped —
//    downstream comparisons (`end < start`) only make sense for
//    strings, and a stray number triggers a coercion bug.
//
// Notably we DO preserve malformed `endDate` STRINGS (e.g. "next
// Friday", "2026-05-25" before a start of "2026-05-27"). The view
// surfaces those as a "broken range" chip so the user/LLM gets
// visible feedback instead of having the bad data silently erased.
export function sanitizeProps(props: unknown): ScheduledItem["props"] {
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return {};
  }
  const record = props as ScheduledItem["props"];
  if (!("endDate" in record)) return record;
  if (typeof record.endDate === "string") return record;
  if (record.endDate === null) return record;
  const next = { ...record };
  Reflect.deleteProperty(next, "endDate");
  return next;
}

export function sortItems(items: ScheduledItem[]): ScheduledItem[] {
  return [...items].sort((left, right) => {
    const leftDate = typeof left.props.date === "string" ? left.props.date : null;
    const rightDate = typeof right.props.date === "string" ? right.props.date : null;
    const leftTime = typeof left.props.time === "string" ? left.props.time : "00:00";
    const rightTime = typeof right.props.time === "string" ? right.props.time : "00:00";
    const leftKey = leftDate ? `0_${leftDate}_${leftTime}` : `1_${left.createdAt}`;
    const rightKey = rightDate ? `0_${rightDate}_${rightTime}` : `1_${right.createdAt}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function handleShow(items: ScheduledItem[]): SchedulerActionResult {
  return {
    kind: "success",
    items,
    message: `Showing ${items.length} scheduled item(s)`,
    jsonData: {},
  };
}

export function handleAdd(items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  if (!input.title) {
    return { kind: "error", status: 400, error: "title required" };
  }
  const item: ScheduledItem = {
    id: makeId("sched"),
    title: input.title,
    createdAt: Date.now(),
    props: sanitizeProps(input.props ?? {}),
  };
  const next = sortItems([...items, item]);
  return {
    kind: "success",
    items: next,
    message: `Added: "${input.title}"`,
    jsonData: { added: item.id },
  };
}

export function handleDelete(items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  if (!input.id) {
    return { kind: "error", status: 400, error: "id required" };
  }
  const next = items.filter((i) => i.id !== input.id);
  const found = next.length < items.length;
  return {
    kind: "success",
    items: next,
    message: found ? `Deleted item ${input.id}` : `Item not found: ${input.id}`,
    jsonData: { deleted: input.id },
  };
}

function applyPropPatch(current: ScheduledItem["props"], patch: Record<string, string | number | boolean | null>): ScheduledItem["props"] {
  const next: ScheduledItem["props"] = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      Reflect.deleteProperty(next, key);
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function handleUpdate(items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  if (!input.id) {
    return { kind: "error", status: 400, error: "id required" };
  }
  const target = items.find((i) => i.id === input.id);
  if (!target) {
    return {
      kind: "success",
      items,
      message: `Item not found: ${input.id}`,
      jsonData: {},
    };
  }
  const mergedProps = input.props !== undefined ? applyPropPatch(target.props, input.props) : target.props;
  const updated: ScheduledItem = {
    ...target,
    title: input.title !== undefined ? input.title : target.title,
    props: sanitizeProps(mergedProps),
  };
  const next = sortItems(items.map((i) => (i.id === input.id ? updated : i)));
  return {
    kind: "success",
    items: next,
    message: `Updated: "${updated.title}"`,
    jsonData: { updated: input.id },
  };
}

// `replace` accepts an arbitrary array from untrusted JSON, so
// every item needs the same shape narrowing the in-memory store
// guarantees: a non-empty string `id` (the dispatch primary key
// AND the input to the per-event colour-hash, both of which crash
// or misbehave on non-strings), a string `title`, a numeric
// `createdAt`, and a sanitised `props`. Non-object items are
// dropped; objects with missing/malformed required fields get a
// safe default (newly minted id, empty title, current timestamp)
// rather than failing the whole replace.
export function sanitizeItem(raw: unknown): ScheduledItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Partial<ScheduledItem>;
  const itemId = typeof obj.id === "string" && obj.id.length > 0 ? obj.id : makeId("sched");
  const title = typeof obj.title === "string" ? obj.title : "";
  const createdAt = typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt) ? obj.createdAt : Date.now();
  return { id: itemId, title, createdAt, props: sanitizeProps(obj.props) };
}

export function handleReplace(_items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  if (!Array.isArray(input.items)) {
    return { kind: "error", status: 400, error: "items array required" };
  }
  const sanitized = input.items.map(sanitizeItem).filter((item): item is ScheduledItem => item !== null);
  const next = sortItems(sanitized);
  return {
    kind: "success",
    items: next,
    message: `Replaced all items (${next.length} total)`,
    jsonData: { count: next.length, dropped: input.items.length - next.length },
  };
}

const HANDLERS: Record<string, (items: ScheduledItem[], input: SchedulerActionInput) => SchedulerActionResult> = {
  show: handleShow,
  add: handleAdd,
  delete: handleDelete,
  update: handleUpdate,
  replace: handleReplace,
};

export function dispatchScheduler(action: string, items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  // Own-property guard: a bare `HANDLERS[action]` with an untrusted action name
  // resolves `constructor` / `toString` to an Object.prototype function, which
  // is truthy and slips past the unknown-action check (#2319).
  const handler = Object.hasOwn(HANDLERS, action) ? HANDLERS[action] : undefined;
  if (!handler) {
    return { kind: "error", status: 400, error: `Unknown action: ${action}` };
  }
  return handler(items, input);
}
