// Shared helpers for GitHub fetchers (releases + issues).
//
// Phase-1 scope: UNAUTHENTICATED public REST access only. GitHub
// grants 60 req/hour/IP without a token, which is plenty for a
// personal workspace with a handful of registered repos. Adding
// a `github-authed` fetcher with a PAT lives in phase 3.
//
// Everything in this module is pure or uses the already-injected
// `fetchPolite` — no direct HTTP. Tests stub HTTP at the
// FetcherDeps boundary.

import type { HttpFetcherDeps } from "../httpFetcher.js";
import { fetchPolite } from "../httpFetcher.js";
import { hasStringProp } from "../../../utils/types.js";

// GitHub REST API base. Factored out so tests / local dev can
// point at a stub server by patching this module — rare enough
// that we don't bother with an env var today.
export const GITHUB_API_BASE = "https://api.github.com";

// Owner / repo slugs on GitHub accept letters, digits, hyphen,
// underscore, dot. Lengths are loose but we cap at 100 each —
// any real repo comes in well under that.
//
// The slug doubles as a URL path segment: rejecting `..` / `/`
// / whitespace defends against a user-supplied (or LLM-suggested)
// `github_repo` that would craft a malicious request URL.
// Owner must start with an alphanumeric (GitHub usernames /
// org names can't begin with a dot).
const OWNER_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// Repo can start with a dot — GitHub has the special `.github`
// repository used for org-wide community health files, so the
// repo-name regex is slightly looser than the owner one.
const REPO_SEGMENT_RE = /^[A-Za-z0-9.][A-Za-z0-9._-]{0,99}$/;

export interface RepoSlug {
  owner: string;
  repo: string;
}

// Validate + parse an `owner/repo` string from source
// frontmatter. Returns null on any shape violation — callers
// treat null as "skip this source" rather than crashing the pass.
export function parseRepoSlug(raw: string): RepoSlug | null {
  if (typeof raw !== "string") return null;
  const parts = raw.trim().split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!OWNER_SEGMENT_RE.test(owner) || !REPO_SEGMENT_RE.test(repo)) return null;
  // Reject path-traversal-ish repo names even though the regex
  // would accept them (`.`, `..` can both start with a dot).
  if (repo === "." || repo === "..") return null;
  if (owner.endsWith(".") || repo.endsWith(".")) return null;
  return { owner, repo };
}

// Named error for any non-2xx GitHub response. Carries the status
// code so the pipeline can decide whether to backoff harder (403
// rate-limit) or surface a "source broken" warning (404 /
// repo-not-found).
export class GithubFetcherError extends Error {
  readonly url: string;
  readonly status: number;
  readonly apiMessage: string | null;
  constructor(url: string, status: number, apiMessage: string | null) {
    const suffix = apiMessage ? ` — ${apiMessage}` : "";
    super(`GitHub fetch ${url} failed with HTTP ${status}${suffix}`);
    this.name = "GithubFetcherError";
    this.url = url;
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

// Tight helper: issue a GET against the GitHub API, decode the
// JSON body, and surface non-2xx responses as typed errors.
// Errors from fetchPolite (including `RobotsDisallowedError`) pass
// through untouched.
//
// GitHub API responses always include an `X-GitHub-Request-Id` and
// many include a `message` body field on errors. We include the
// body message in the thrown error for easier log reading.
export async function githubFetchJson(url: string, http: HttpFetcherDeps): Promise<unknown> {
  const res = await fetchPolite(url, http);
  if (!res.ok) {
    // Body may or may not be JSON — try both. Not throwing on
    // a failed body read so the HTTP status is always reported.
    let apiMessage: string | null = null;
    try {
      const bodyJson: unknown = await res.json();
      if (hasStringProp(bodyJson, "message")) {
        apiMessage = bodyJson.message;
      }
    } catch {
      // Ignore — just means the body wasn't JSON.
    }
    throw new GithubFetcherError(url, res.status, apiMessage);
  }
  return res.json();
}

// Small type-guard used by the json-shape parsers below. Keeping
// it here (rather than duplicated per fetcher) so adding a new
// GitHub endpoint stays boilerplate-free.
// Re-export so existing callers that import from this module keep working.
export { isRecord } from "../../../utils/types.js";
