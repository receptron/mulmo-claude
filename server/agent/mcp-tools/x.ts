import { errorMessage } from "../../utils/errors.js";
import { safeResponseText } from "../../utils/http.js";
import { toUtcIsoDate } from "../../utils/date.js";
import { env } from "../../system/env.js";

const X_API_BASE = "https://api.twitter.com/2";
const TWEET_FIELDS = "tweet.fields=created_at,author_id,public_metrics,entities";
const EXPANSIONS = "expansions=author_id";
const USER_FIELDS = "user.fields=name,username";

interface XUser {
  id: string;
  name: string;
  username: string;
}

interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
}

interface XApiResponse {
  data?: XTweet | XTweet[];
  includes?: { users?: XUser[] };
  errors?: { detail: string }[];
  meta?: { result_count: number };
}

async function fetchX(path: string): Promise<XApiResponse> {
  const token = env.xBearerToken;
  if (!token) throw new Error("X_BEARER_TOKEN is not configured in .env");

  let response: Response;
  try {
    response = await fetch(`${X_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
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

function formatTweet(tweet: XTweet, author?: XUser, url?: string): string {
  const date = tweet.created_at ? toUtcIsoDate(new Date(tweet.created_at)) : "";
  const dateSuffix = date ? ` · ${date}` : "";
  const byline = author ? `@${author.username} (${author.name})${dateSuffix}` : date;
  const metrics = tweet.public_metrics
    ? `Likes: ${tweet.public_metrics.like_count} | Retweets: ${tweet.public_metrics.retweet_count} | Replies: ${tweet.public_metrics.reply_count}`
    : "";
  const link = url ?? "";
  return [byline, "", tweet.text, "", metrics, link]
    .filter((line) => line !== undefined)
    .join("\n")
    .trimEnd();
}

// ── readXPost ──────────────────────────────────────────────────────────────────

export const readXPost = {
  definition: {
    name: "readXPost",
    description: "Fetch the content of a single X (Twitter) post by URL or tweet ID. Returns the author, text, and engagement metrics.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full X post URL (https://x.com/user/status/ID) or bare tweet ID.",
        },
      },
      required: ["url"],
    },
  },

  requiredEnv: ["X_BEARER_TOKEN"],

  prompt: "Use the readXPost tool whenever the user shares a URL from x.com or twitter.com.",

  async handler(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url ?? "");
    const match = url.match(/status\/(\d+)/);
    const tweetId = match ? match[1] : /^\d+$/.test(url) ? url : null;
    if (!tweetId) return `Could not extract a tweet ID from: ${url}. Provide a full x.com URL or a numeric tweet ID.`;

    let data: XApiResponse;
    try {
      data = await fetchX(`/tweets/${tweetId}?${TWEET_FIELDS}&${EXPANSIONS}&${USER_FIELDS}`);
    } catch (err) {
      return errorMessage(err);
    }

    if (data.errors?.length) return `X API error: ${data.errors.map((err) => err.detail).join("; ")}`;

    const tweet = data.data as XTweet | undefined;
    if (!tweet) return "Tweet not found.";

    const author = data.includes?.users?.find((user) => user.id === tweet.author_id);
    const canonicalUrl = author ? `https://x.com/${author.username}/status/${tweet.id}` : undefined;
    return formatTweet(tweet, author, canonicalUrl);
  },
};

// ── searchX ───────────────────────────────────────────────────────────────────

export const searchX = {
  definition: {
    name: "searchX",
    description: "Search recent X (Twitter) posts by keyword or query. Returns up to max_results posts (default 10, max 100).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "X search query. Supports operators like from:user, #hashtag, -excludeword.",
        },
        max_results: {
          type: "number",
          description: "Number of results to return (10–100). Defaults to 10.",
        },
        sort_order: {
          type: "string",
          enum: ["recency", "relevancy"],
          description: "'recency' = latest tweets first (default). 'relevancy' = most relevant (Top) first.",
        },
      },
      required: ["query"],
    },
  },

  requiredEnv: ["X_BEARER_TOKEN"],

  prompt: "Use the searchX tool to find recent posts on X by keyword or topic.",

  async handler(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? "").trim();
    if (!query) return "A search query is required.";

    const maxResults = Math.min(100, Math.max(10, Number(args.max_results ?? 10)));

    let data: XApiResponse;
    try {
      const sortOrder = args.sort_order === "relevancy" ? "relevancy" : "recency";
      const params = new URLSearchParams({
        query,
        max_results: String(maxResults),
        sort_order: sortOrder,
      });
      params.append("tweet.fields", "created_at,author_id,public_metrics");
      params.append("expansions", "author_id");
      params.append("user.fields", "name,username");
      data = await fetchX(`/tweets/search/recent?${params.toString()}`);
    } catch (err) {
      return errorMessage(err);
    }

    if (data.errors?.length) return `X API error: ${data.errors.map((err) => err.detail).join("; ")}`;

    const tweets = Array.isArray(data.data) ? data.data : [];
    if (tweets.length === 0) return `No recent posts found for: "${query}"`;

    const users = data.includes?.users ?? [];
    const userMap = new Map(users.map((user) => [user.id, user]));

    const lines: string[] = [`Search: "${query}" — ${tweets.length} result${tweets.length !== 1 ? "s" : ""}`, ""];
    tweets.forEach((tweet, i) => {
      const author = tweet.author_id ? userMap.get(tweet.author_id) : undefined;
      lines.push(`${i + 1}. ${formatTweet(tweet, author)}`);
      lines.push("");
    });

    return lines.join("\n").trimEnd();
  },
};
