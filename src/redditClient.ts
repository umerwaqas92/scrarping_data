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

// Reddit's relevance search returns a lot of unrelated noise (memes, off-topic
// subreddits, skill chatter, rants). We only want actual JOB posts, so a post
// must satisfy BOTH:
//   1. SKILL match — a distinctive term from the query (e.g. "flutter", "react")
//      appears in the title/subreddit (or repeatedly in the body).
//   2. JOB-INTENT match — a hiring signal appears (e.g. "hiring", "[hiring]",
//      "we're looking for", "job opening", "apply", "salary", "contract"…).
// Generic-only queries (e.g. "remote jobs") relax rule 1 to the raw tokens.
// If the strict pass removes everything we fall back progressively so the feed
// is never empty.
const GENERIC_TOKENS = new Set([
  "job", "jobs", "hiring", "hire", "hired", "remote", "freelance", "freelancer",
  "contract", "contractor", "developer", "dev", "engineer", "senior", "junior",
  "full", "fulltime", "part", "parttime", "position", "role", "opportunity",
  "work", "looking", "seeking", "need", "needed", "wanted", "available", "for",
  "and", "the", "with", "app", "apps", "web", "software", "stack", "startup",
]);

// Signals that a post is actually offering/hiring for a job (vs. a discussion
// about a job, a rant, a meme, or a "should I quit?" post).
const JOB_INTENT_PATTERNS: RegExp[] = [
  /\[hiring\]/i,
  /\bhiring\b/i,
  /\bwe(?:'| a)?re? (?:looking|hiring|seeking)\b/i,
  /\b(?:we are|we're) (?:looking|hiring|seeking)\b/i,
  /\blooking to (?:hire|fill)\b/i,
  /\bjob (?:opening|opportunity|posting|available|vacancy)\b/i,
  /\bopen (?:role|position|position:|roles)\b/i,
  /\b(?:full[- ]?time|part[- ]?time|contract|freelance) (?:role|position|opportunity|job)\b/i,
  /\bapply (?:now|here|today)?\b/i,
  /\bsend (?:your )?(?:cv|resume)\b/i,
  /\b(?:dm|message) me\b/i,
  /\b(?:salary|budget|compensation|per hour|hourly|monthly)\b/i,
  /\b\d+\s?(?:k|usd|eur|gbp|\$|€|£)\b/i,
  /\bremote (?:job|role|position|developer|engineer)\b/i,
  /\bjob board\b/i,
  /\bvacanc(?:y|ies)\b/i,
  /\bnow hiring\b/i,
];

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

// Titles that signal a discussion / question / rant / JOB-SEEKING post rather
// than an actual job OFFER. These are excluded even when they mention a skill
// and job words. (We want posts where someone is HIRING, not someone asking
// for work — e.g. "Flutter dev (retrenched) open to freelance/contract work".)
const NON_JOB_PATTERNS: RegExp[] = [
  /\bshould i\b/i,
  /\bis (?:it|this|the .* market)\b.*\?/i,
  /\bhow (?:do|can|to)\b/i,
  /\bwhat (?:do|should|is)\b/i,
  /\bwhy (?:do|is|are|did)\b/i,
  /\bany(?:one|body) (?:else|know)\b/i,
  /\bmy (?:boss|manager|company|team)\b/i,
  /\bcareer (?:advice|gaps|change|path)\b/i,
  /\blaid off\b/i,
  /\bunemployed\b/i,
  /\b(?:rant|vent|discussion|question)\b/i,
  /\badvice (?:needed|wanted)\b/i,
  /\bam i\b/i,
  /\bi(?:'m| am) (?:a |an )?(?:dev|developer|engineer|freelancer)\b.*\?/i,
  // Self-promotion / availability (person seeking work, not hiring):
  /\bopen to (?:work|freelance|contract|opportunit)/i,
  /\bavailable for (?:work|freelance|contract|hire|projects)/i,
  /\bfor hire\b/i,
  /\bhire me\b/i,
  /\bjob seeking\b/i,
  /\bseeking (?:work|opportunit|roles?|jobs?|employment)\b/i,
  /\bopen to (?:remote|full[- ]?time|part[- ]?time)\b/i,
  /\b(?:retrenched|laid off|between jobs?)\b/i,
  /\bmy (?:portfolio|resume|cv)\b/i,
  /\b(?:looking for|seeking) (?:work|a job|new role|opportunit)/i,
  /\bwho(?:'s| is) hiring\b/i,
  /\bi (?:can |will )?(?:build|develop|code) for\b/i,
  /\[for hire\]/i,
];

function hasJobIntent(text: string): boolean {
  if (!JOB_INTENT_PATTERNS.some((re) => re.test(text))) return false;
  return !NON_JOB_PATTERNS.some((re) => re.test(text));
}

function skillMatches<T extends { title: string; selftext: string; subreddit: string }>(
  p: T,
  qualifiers: string[],
): boolean {
  // Title + subreddit are the real topic signal; reddit bodies are long and
  // often mention a skill in passing.
  const titleAndSub = `${p.title} ${p.subreddit}`.toLowerCase();
  if (qualifiers.some((t) => titleAndSub.includes(t))) return true;
  // Body match only when the term repeats (>=2), i.e. it's genuinely the topic.
  const body = (p.selftext || "").toLowerCase();
  return qualifiers.some((t) => {
    const first = body.indexOf(t);
    if (first === -1) return false;
    return body.indexOf(t, first + t.length) !== -1;
  });
}

function filterRelevant<T extends { title: string; selftext: string; subreddit: string }>(
  posts: T[],
  tokens: string[],
): T[] {
  if (tokens.length === 0) {
    return posts.filter((p) => hasJobIntent(`${p.title} ${p.selftext || ""}`));
  }

  // Distinctive = the meaningful skills/roles from the query. If the whole
  // query is generic (e.g. "remote jobs"), fall back to the raw tokens.
  const distinctive = tokens.filter((t) => !GENERIC_TOKENS.has(t));
  const qualifiers = distinctive.length > 0 ? distinctive : tokens;

  // Pass 1 (strict): skill match AND job intent.
  const strict = posts.filter((p) => {
    if (!skillMatches(p, qualifiers)) return false;
    return hasJobIntent(`${p.title} ${p.selftext || ""} ${p.subreddit}`);
  });
  if (strict.length > 0) return strict;

  // Pass 2 (relaxed): skill match only (job-intent wording varies a lot).
  const relaxed = posts.filter((p) => skillMatches(p, qualifiers));
  if (relaxed.length > 0) return relaxed;

  // Pass 3: never return an empty feed — fall back to raw results.
  return posts;
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
