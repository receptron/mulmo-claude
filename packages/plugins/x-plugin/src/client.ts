import { errorMessage, toUtcIsoDate } from "@mulmoclaude/common";
import { fetchWithTimeout, ONE_SECOND_MS, safeResponseText } from "./internal";

const X_API_BASE = "https://api.twitter.com/2";

// X API can stall under rate limit — a 10 s default (used for internal
// localhost calls) would produce false timeouts. 20 s gives enough
// headroom for a slow but real response while still bailing long
// before the MCP client's tool-call timeout fires.
export const X_API_TIMEOUT_MS = 20 * ONE_SECOND_MS;

export const TWEET_FIELDS = "tweet.fields=created_at,author_id,public_metrics,entities,note_tweet,article";
export const EXPANSIONS = "expansions=author_id";
export const USER_FIELDS = "user.fields=name,username";

export interface XUser {
  id: string;
  name: string;
  username: string;
}

export interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  // Long-form Post (>280 chars): full body lives here, not in `text`.
  note_tweet?: { text: string };
  // X Article (rich long-form, up to 100k chars): `text` only holds the t.co
  // link, so the body must be read from `article.plain_text`.
  article?: { title?: string; plain_text?: string };
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
}

export interface XApiResponse {
  data?: XTweet | XTweet[];
  includes?: { users?: XUser[] };
  errors?: { detail: string }[];
  meta?: { result_count: number };
}

/** Resolve the X API bearer token from the environment. The host gates the
 *  tools on `requiredEnv: ["X_BEARER_TOKEN"]` before dispatch, but the body
 *  re-checks so direct/test callers get a clear error. */
export function xBearerToken(): string | undefined {
  return process.env.X_BEARER_TOKEN;
}

export async function fetchX(path: string): Promise<XApiResponse> {
  const token = xBearerToken();
  if (!token) throw new Error("X_BEARER_TOKEN is not configured in .env");

  let response: Response;
  try {
    response = await fetchWithTimeout(`${X_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: X_API_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(`Network error calling X API: ${errorMessage(err)}`);
  }

  if (response.status === 401) throw new Error("X API error 401: Invalid or expired Bearer Token.");
  if (response.status === 429) throw new Error("X API error 429: Rate limit exceeded. Please wait before retrying.");
  if (!response.ok) {
    const body = await safeResponseText(response);
    throw new Error(`X API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<XApiResponse>;
}

// `text` caps at 280 chars; long-form Posts and Articles carry their real body
// in `note_tweet` / `article`. Prefer those so the LLM sees the full content.
export function tweetBody(tweet: XTweet): string {
  if (tweet.note_tweet?.text) return tweet.note_tweet.text;
  const { article } = tweet;
  if (article?.plain_text) {
    return [article.title, article.plain_text].filter(Boolean).join("\n\n");
  }
  return tweet.text;
}

export function formatTweet(tweet: XTweet, author?: XUser, url?: string): string {
  const date = tweet.created_at ? toUtcIsoDate(new Date(tweet.created_at)) : "";
  const dateSuffix = date ? ` · ${date}` : "";
  const byline = author ? `@${author.username} (${author.name})${dateSuffix}` : date;
  const metrics = tweet.public_metrics
    ? `Likes: ${tweet.public_metrics.like_count} | Retweets: ${tweet.public_metrics.retweet_count} | Replies: ${tweet.public_metrics.reply_count}`
    : "";
  const link = url ?? "";
  return [byline, "", tweetBody(tweet), "", metrics, link]
    .filter((line) => line !== undefined)
    .join("\n")
    .trimEnd();
}

/** Extract a numeric tweet id from a full x.com/twitter.com status URL or a
 *  bare id. Returns null when neither form matches. */
export function extractTweetId(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  if (match) return match[1];
  return /^\d+$/.test(url) ? url : null;
}
