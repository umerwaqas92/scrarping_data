import { getCookieHeader } from "./cookies.js";

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  url: string;
  permalink: string;
  selftext: string;
  thumbnail: string;
  numComments: number;
  score: number;
  createdAt: string;
  source: "reddit";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reddit's relevance search still returns some unrelated posts. Keep only
// posts that actually mention one of the query terms (in title, body or
// subreddit). If that would remove everything, fall back to the raw results.
function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function filterRelevant<T extends { title: string; selftext: string; subreddit: string }>(
  posts: T[],
  tokens: string[],
): T[] {
  if (tokens.length === 0) return posts;
  const kept = posts.filter((p) => {
    const haystack = `${p.title} ${p.selftext} ${p.subreddit}`.toLowerCase();
    return tokens.some((t) => haystack.includes(t));
  });
  return kept.length > 0 ? kept : posts;
}

interface RedditHttpError extends Error {
  status?: number;
  retryAfter?: string | null;
}

// ── Reliability configuration ────────────────────────────────────────────────
// Reddit's public JSON endpoint rate-limits aggressively (HTTP 429) when
// multiple queries fire in parallel. We serialize requests, space them out and
// retry with backoff. Results are never cached — every request is live.
const MIN_REQUEST_INTERVAL_MS = Math.max(0, parseInt(process.env.REDDIT_MIN_INTERVAL_MS || "1500", 10));
const MAX_RETRIES = Math.max(0, parseInt(process.env.REDDIT_MAX_RETRIES || "3", 10));
const REQUEST_TIMEOUT_MS = Math.max(3000, parseInt(process.env.REDDIT_TIMEOUT_MS || "15000", 10));

// Reddit's `sort=new` on the public search JSON returns unrelated posts (it
// seems to ignore the query). `relevance` + a time window returns genuinely
// relevant recent posts instead.
const REDDIT_SORT = process.env.REDDIT_SORT || "relevance";
const REDDIT_TIME = process.env.REDDIT_TIME || "month";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);
const REDDIT_HOSTS = ["https://www.reddit.com", "https://old.reddit.com"];

export interface RedditSearchResult {
  posts: RedditPost[];
  after?: string;
}

// ── Serialized request queue (one Reddit request in flight at a time) ─────────
let lastRequestAt = 0;
let queueTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  // Keep the chain alive even when a task rejects.
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ── Serialized request queue, de-duplicates concurrent requests ──────────────
// (No result caching — every request returns live data.)

export class RedditClient {
  constructor(
    private readonly userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ) {}

  private async fetchOnce(url: string): Promise<RedditSearchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": this.userAgent,
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
          cookie: await getCookieHeader("reddit"),
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const err: RedditHttpError = new Error(`Reddit API error ${res.status}`);
        err.status = res.status;
        err.retryAfter = res.headers.get("retry-after");
        throw err;
      }

      const json = (await res.json()) as any;
      const data = json?.data;
      const children = data?.children ?? [];
      const posts: RedditPost[] = children
        .map((child: any) => child.data)
        .filter((p: any) => p?.title)
        .map((p: any): RedditPost => ({
          id: p.id,
          title: p.title,
          author: p.author,
          subreddit: p.subreddit,
          url: `https://www.reddit.com${p.permalink ?? ""}`,
          permalink: p.permalink,
          selftext: p.selftext ?? "",
          thumbnail: p.thumbnail && p.thumbnail.startsWith("http") ? p.thumbnail : "",
          numComments: p.num_comments ?? 0,
          score: p.score ?? 0,
          createdAt: new Date(p.created_utc * 1000).toString(),
          source: "reddit",
        }));
      return { posts, after: data?.after ?? undefined };
    } finally {
      clearTimeout(timer);
    }
  }

  async search(query: string, limit = 20, after?: string): Promise<RedditSearchResult> {
    const tokens = queryTokens(query);
    return enqueue(async () => {
      let lastError: RedditHttpError | null = null;
      const maxAttempts = MAX_RETRIES + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const host = REDDIT_HOSTS[Math.min(attempt - 1, REDDIT_HOSTS.length - 1)];
        const url =
          `${host}/search.json?q=${encodeURIComponent(query)}&sort=${REDDIT_SORT}&t=${REDDIT_TIME}&limit=${limit}` +
          (after ? `&after=${encodeURIComponent(after)}` : "");

        try {
          const result = await this.fetchOnce(url);
          return { ...result, posts: filterRelevant(result.posts, tokens) };
        } catch (err) {
          lastError = err as RedditHttpError;
          const status = lastError.status;
          const retryable =
            status === undefined || // network / timeout errors
            RETRYABLE_STATUS.has(status) ||
            lastError.name === "AbortError";
          const isLastAttempt = attempt >= maxAttempts;

          if (!retryable || isLastAttempt) {
            console.error(
              `[Reddit] "${query}" failed after ${attempt} attempt(s): ${lastError.message}`,
            );
            throw lastError;
          }

          const retryAfterSec = parseFloat(lastError.retryAfter || "");
          const backoffMs = Number.isFinite(retryAfterSec)
            ? retryAfterSec * 1000
            : Math.min(15000, 1000 * 2 ** (attempt - 1));
          const jitterMs = Math.floor(Math.random() * 400);
          console.warn(
            `[Reddit] "${query}" attempt ${attempt}/${maxAttempts} failed` +
              `${status ? ` (HTTP ${status})` : ""}. Retrying in ${Math.round(backoffMs + jitterMs)}ms…`,
          );
          await sleep(backoffMs + jitterMs);
        }
      }

      throw lastError ?? new Error("Reddit search failed");
    });
  }
}
