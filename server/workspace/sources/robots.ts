// robots.txt parser + rule evaluator.
//
// Phase-1 fetchers call `isAllowedByRobots(robotsText, userAgent, path)`
// before GET-ing a URL on a host we haven't fetched from recently.
// The robots text itself comes from a 24h cache populated elsewhere —
// this module only deals with parsing and rule evaluation.
//
// Supported directives:
//   User-agent: <name>   — group selector
//   Disallow:   <path>   — path-prefix block (empty value == allow all)
//   Allow:      <path>   — path-prefix exception
//   Crawl-delay: <secs>  — minimum seconds between fetches for this UA
//
// Deliberately NOT supported:
//   Sitemap:             — irrelevant for fetchers
//   Request-rate:        — rarely used in the wild
//   Visit-time:          — same
//   Host:                — Yandex-only extension
//
// Matching semantics follow the de-facto Google robots.txt rules
// (draft IETF "robotstxt-00"): longest-prefix wins between Allow
// and Disallow; `*` in paths is treated as a wildcard; `$` at
// end-of-path anchors to end-of-URL.
//
// Pure — no I/O, no network, fully testable.

export interface RobotsGroup {
  // Lowercased user-agent names this group applies to. May contain
  // "*" meaning "any agent not matched by a more-specific group".
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySec: number | null;
}

export interface RobotsRule {
  kind: "allow" | "disallow";
  // Raw path pattern as it appeared in the file, minus the leading
  // directive. Wildcards preserved.
  pattern: string;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
}

// Parse a robots.txt body into structured groups. Completely
// lenient: unknown directives are skipped, malformed lines are
// skipped, empty input yields an empty group list (which means
// "everything allowed" downstream).
export function parseRobots(text: string): ParsedRobots {
  // State machine driven by one helper per directive kind — keeps
  // the main loop free of nested branching.
  //
  // `collectingAgents` is true while we're inside a run of
  // consecutive User-agent lines before the first rule. Additional
  // User-agent lines extend the same group; once a rule appears,
  // the next User-agent starts a new group.
  const state: ParseState = {
    groups: [],
    current: null,
    collectingAgents: false,
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const parsed = parseDirective(line);
    if (!parsed) continue;
    applyDirective(state, parsed.name, parsed.value);
  }
  return { groups: state.groups };
}

interface ParseState {
  groups: RobotsGroup[];
  current: RobotsGroup | null;
  collectingAgents: boolean;
}

function applyDirective(state: ParseState, name: string, value: string): void {
  if (name === "user-agent") {
    applyUserAgent(state, value);
    return;
  }
  // Any non-user-agent directive ends the "collecting agents"
  // window. If we see a rule before any User-agent (malformed),
  // drop it — robots.txt without a User-agent scope is
  // meaningless.
  state.collectingAgents = false;
  if (!state.current) return;
  applyRule(state.current, name, value);
}

function applyUserAgent(state: ParseState, value: string): void {
  if (!state.collectingAgents || state.current === null) {
    state.current = { userAgents: [], rules: [], crawlDelaySec: null };
    state.groups.push(state.current);
    state.collectingAgents = true;
  }
  state.current.userAgents.push(value.toLowerCase());
}

function applyRule(group: RobotsGroup, name: string, value: string): void {
  if (name === "disallow") {
    group.rules.push({ kind: "disallow", pattern: value });
  } else if (name === "allow") {
    group.rules.push({ kind: "allow", pattern: value });
  } else if (name === "crawl-delay") {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) group.crawlDelaySec = seconds;
  }
  // Any other directive: ignored.
}

function stripComment(line: string): string {
  const hashIdx = line.indexOf("#");
  return hashIdx === -1 ? line : line.slice(0, hashIdx);
}

function parseDirective(line: string): { name: string; value: string } | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx <= 0) return null;
  const name = line.slice(0, colonIdx).trim().toLowerCase();
  const value = line.slice(colonIdx + 1).trim();
  return { name, value };
}

// Pick the group whose User-agent directive best matches `userAgent`.
// Ordering of preference:
//   1. All exact-match groups (case-insensitive) merged together.
//   2. All prefix-match groups tied for longest prefix, merged.
//   3. All `*` groups merged together.
//   4. No group at all → null (caller treats as "everything allowed").
//
// Per REP (IETF draft `robotstxt-00`): when multiple groups apply
// equally to the same agent, their rules are combined into a single
// rule set before the Allow/Disallow decision is made. Returning the
// first match only (old behaviour) let a later Disallow in a
// duplicate group get ignored, which could silently let a fetcher
// hit a path the site explicitly blocked.
export function selectGroup(robots: ParsedRobots, userAgent: string): RobotsGroup | null {
  const agent = userAgent.toLowerCase();
  const exacts: RobotsGroup[] = [];
  const stars: RobotsGroup[] = [];
  let bestPrefixScore = -1;
  let prefixMatches: RobotsGroup[] = [];
  for (const group of robots.groups) {
    const outcome = scoreGroupAgainstAgent(group, agent);
    if (outcome.kind === "exact") exacts.push(outcome.group);
    else if (outcome.kind === "star") stars.push(outcome.group);
    else if (outcome.kind === "prefix") {
      if (outcome.score > bestPrefixScore) {
        bestPrefixScore = outcome.score;
        prefixMatches = [outcome.group];
      } else if (outcome.score === bestPrefixScore) {
        prefixMatches.push(outcome.group);
      }
    }
  }
  if (exacts.length > 0) return mergeGroups(exacts);
  if (prefixMatches.length > 0) return mergeGroups(prefixMatches);
  if (stars.length > 0) return mergeGroups(stars);
  return null;
}

// Merge an array of groups into one. Concatenates rules (preserving
// per-group order) and takes the smallest non-null crawlDelaySec
// (the most conservative value) if any group specifies one.
function mergeGroups(groups: readonly RobotsGroup[]): RobotsGroup {
  if (groups.length === 1) return groups[0];
  const rules: RobotsRule[] = [];
  const userAgents: string[] = [];
  let crawlDelaySec: number | null = null;
  for (const group of groups) {
    rules.push(...group.rules);
    userAgents.push(...group.userAgents);
    if (group.crawlDelaySec !== null) {
      crawlDelaySec = crawlDelaySec === null ? group.crawlDelaySec : Math.min(crawlDelaySec, group.crawlDelaySec);
    }
  }
  return { userAgents, rules, crawlDelaySec };
}

type AgentMatch =
  | { kind: "exact"; group: RobotsGroup }
  | { kind: "prefix"; group: RobotsGroup; score: number }
  | { kind: "star"; group: RobotsGroup }
  | { kind: "none" };

function scoreGroupAgainstAgent(group: RobotsGroup, agent: string): AgentMatch {
  let bestPrefix = -1;
  let hasStar = false;
  for (const listed of group.userAgents) {
    if (listed === "*") {
      hasStar = true;
      continue;
    }
    if (listed === agent) return { kind: "exact", group };
    if (agent.startsWith(listed) && listed.length > bestPrefix) {
      bestPrefix = listed.length;
    }
  }
  if (bestPrefix >= 0) return { kind: "prefix", group, score: bestPrefix };
  if (hasStar) return { kind: "star", group };
  return { kind: "none" };
}

// Decide whether `path` (the URL's path + query, e.g. "/a/b?c=d")
// is permitted for `userAgent` by the parsed robots text. Returns
// `true` when allowed, `false` when disallowed. Empty / missing
// groups default to allowed, matching the robots.txt convention.
//
// Rule resolution follows the Google / IETF robots draft:
// longest-prefix match wins between Allow and Disallow; tie goes
// to Allow (the more permissive outcome).
export function isAllowedByRobots(robots: ParsedRobots, userAgent: string, path: string): boolean {
  const group = selectGroup(robots, userAgent);
  if (!group) return true;
  const { bestAllow, bestDisallow } = scoreRules(group, path);
  if (bestAllow < 0 && bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}

// For each rule in `group`, compute the length of the longest
// matching prefix; return the best Allow and Disallow lengths.
// Returns -1 in either slot when no rule of that kind matched.
// Empty patterns (from `Disallow:` with no value) never match in
// `matchesPattern`, so they correctly fall through to the
// allow-all default.
function scoreRules(group: RobotsGroup, path: string): { bestAllow: number; bestDisallow: number } {
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const rule of group.rules) {
    const matchLen = matchesPattern(rule.pattern, path);
    if (matchLen < 0) continue;
    if (rule.kind === "allow" && matchLen > bestAllow) bestAllow = matchLen;
    else if (rule.kind === "disallow" && matchLen > bestDisallow) {
      bestDisallow = matchLen;
    }
  }
  return { bestAllow, bestDisallow };
}

// Returns the length of the matched prefix (for longest-prefix
// arbitration), or -1 if the pattern doesn't match. An empty
// pattern never matches (special-cased so `Disallow:` with empty
// value doesn't block everything). Wildcards:
//
//   `*`  — matches any sequence of characters
//   `$`  — at end of pattern, anchors the match to end-of-path
//
// The return value is the length of the pattern consumed (i.e.
// pattern length with wildcards counted literally). This ranking
// isn't perfect for patterns with multiple `*` but good enough
// for real-world robots.txt where rule specificity rarely
// depends on wildcard placement.
export function matchesPattern(pattern: string, path: string): number {
  if (pattern === "") return -1;
  // Fast path: no wildcards means literal prefix match.
  if (!pattern.includes("*") && !pattern.endsWith("$")) {
    return path.startsWith(pattern) ? pattern.length : -1;
  }
  // Compile to a regex. Escape everything except `*` / end-$.
  const endAnchored = pattern.endsWith("$");
  const body = endAnchored ? pattern.slice(0, -1) : pattern;
  const regexBody = body
    .split("*")
    .map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${regexBody}${endAnchored ? "$" : ""}`);
  return regex.test(path) ? pattern.length : -1;
}
