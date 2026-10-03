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

export interface RedditSearchResult {
  posts: RedditPost[];
  after?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dedicated job, hiring, freelance, and remote opportunity subreddits
const PRIMARY_JOB_SUBS = [
  "forhire",
  "freelance_forhire",
  "hiring",
  "jobbit",
  "remotejobs",
  "remotework",
  "WebDeveloperJobs",
  "techjobs",
  "DesignJobs",
  "hiredev",
  "freelance",
  "Jobs4Bitcoins",
  "Jobfair",
  "jobopenings",
  "devopsjobs",
  "freelanceWriters",
  "HireAWriter",
  "CreatorServices",
  "CryptoJobs",
];

// Topic to subreddits mapping
const TOPIC_SUBS: Record<string, string[]> = {
  react: ["reactjs", "reactnative", "webdev", "frontend"],
  flutter: ["FlutterDev", "dartlang", "androiddev", "iOSProgramming", "mobiledev"],
  python: ["Python", "django", "flask", "learnpython"],
  vue: ["vuejs", "frontend", "webdev"],
  angular: ["angular", "frontend", "webdev"],
  node: ["node", "javascript", "typescript", "backend"],
  javascript: ["javascript", "typescript", "frontend", "webdev"],
  typescript: ["typescript", "javascript", "frontend", "webdev"],
  frontend: ["frontend", "webdev", "reactjs", "javascript"],
  backend: ["backend", "node", "golang", "Python", "webdev"],
  fullstack: ["webdev", "reactjs", "node", "frontend", "backend"],
  mobile: ["androiddev", "iOSProgramming", "FlutterDev", "reactnative", "mobiledev"],
  ios: ["iOSProgramming", "swift", "mobiledev"],
  android: ["androiddev", "kotlin", "mobiledev"],
  design: ["uiux", "UXDesign", "graphic_design", "DesignJobs"],
  ui: ["uiux", "UXDesign", "webdev"],
  ux: ["uiux", "UXDesign"],
  ai: ["MachineLearning", "ArtificialInteligence", "ChatGPTCoding", "LocalLLaMA", "AICode"],
  ml: ["MachineLearning", "datascience"],
  data: ["datascience", "dataengineering", "bigdata"],
  sales: ["sales", "leadgeneration", "marketing"],
  marketing: ["marketing", "digitalmarketing", "socialmediamarketing", "SEO"],
  seo: ["SEO", "digitalmarketing", "marketing"],
  writer: ["freelanceWriters", "HireAWriter", "writing", "copywriting"],
  content: ["freelanceWriters", "contentcreation", "copywriting"],
  video: ["CreatorServices", "VideoEditing", "videography", "premiere"],
  crypto: ["CryptoJobs", "Jobs4Bitcoins", "ethdev", "solana"],
  blockchain: ["CryptoJobs", "Jobs4Bitcoins", "ethdev", "solana"],
  wordpress: ["Wordpress", "WordpressPlugins", "webdev"],
  shopify: ["shopify", "ecommerce", "webdev"],
  golang: ["golang", "backend"],
  rust: ["rust", "backend"],
  php: ["PHP", "laravel", "webdev"],
  laravel: ["laravel", "PHP", "webdev"],
  devops: ["devops", "devopsjobs", "aws", "kubernetes"],
  aws: ["aws", "devops", "cloud"],
  cloud: ["cloud", "aws", "devops"],
  qa: ["qualityassurance", "softwaretesting"],
  cybersecurity: ["cybersecurity", "netsec"],
  ruby: ["ruby", "rails"],
  java: ["java", "spring", "backend"],
  csharp: ["csharp", "dotnet"],
  dotnet: ["dotnet", "csharp"],
};

function getSubredditsForQuery(query: string): string[] {
  const qLower = query.toLowerCase();
  const matched = new Set<string>(PRIMARY_JOB_SUBS);

  for (const [key, subs] of Object.entries(TOPIC_SUBS)) {
    if (qLower.includes(key)) {
      subs.forEach((s) => matched.add(s));
    }
  }
  return Array.from(matched);
}

const GENERIC_TOKENS = new Set([
  "job", "jobs", "hiring", "hire", "hired", "remote", "freelance", "freelancer",
  "contract", "contractor", "developer", "dev", "engineer", "senior", "junior",
  "full", "fulltime", "part", "parttime", "position", "role", "opportunity",
  "work", "looking", "seeking", "need", "needed", "wanted", "available", "for",
  "and", "the", "with", "app", "apps", "web", "software", "stack", "startup",
]);

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function postMatchesQuery(post: { title: string; selftext: string; subreddit: string }, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const specificTokens = tokens.filter((t) => !GENERIC_TOKENS.has(t));
  const testTokens = specificTokens.length > 0 ? specificTokens : tokens;
  const text = `${post.title} ${post.subreddit} ${post.selftext}`.toLowerCase();
  return testTokens.some((t) => text.includes(t));
}

interface RedditHttpError extends Error {
  status?: number;
  retryAfter?: string | null;
}

// ── Reliability configuration ────────────────────────────────────────────────
const MIN_REQUEST_INTERVAL_MS = Math.max(0, parseInt(process.env.REDDIT_MIN_INTERVAL_MS || "800", 10));
const MAX_RETRIES = Math.max(0, parseInt(process.env.REDDIT_MAX_RETRIES || "3", 10));
const REQUEST_TIMEOUT_MS = Math.max(3000, parseInt(process.env.REDDIT_TIMEOUT_MS || "15000", 10));
const REDDIT_SORT = process.env.REDDIT_SORT || "new";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);
const REDDIT_HOSTS = ["https://www.reddit.com", "https://old.reddit.com"];

// ── Serialized request queue ─────────────────────────────────────────────────
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
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export class RedditClient {
  constructor(
    private readonly userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ) {}

  private async fetchRaw(url: string): Promise<{ posts: RedditPost[]; after?: string }> {
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
          author: p.author ?? "reddit_user",
          subreddit: p.subreddit ?? "",
          url: `https://www.reddit.com${p.permalink ?? ""}`,
          permalink: p.permalink ?? "",
          selftext: p.selftext ?? "",
          thumbnail: p.thumbnail && p.thumbnail.startsWith("http") ? p.thumbnail : "",
          numComments: p.num_comments ?? 0,
          score: p.score ?? 0,
          createdAt: new Date((p.created_utc ?? Date.now() / 1000) * 1000).toISOString(),
          source: "reddit",
        }));
      return { posts, after: data?.after ?? undefined };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchWithRetry(urlPath: string): Promise<{ posts: RedditPost[]; after?: string }> {
    return enqueue(async () => {
      let lastError: RedditHttpError | null = null;
      const maxAttempts = MAX_RETRIES + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const host = REDDIT_HOSTS[Math.min(attempt - 1, REDDIT_HOSTS.length - 1)];
        const fullUrl = `${host}${urlPath}`;

        try {
          return await this.fetchRaw(fullUrl);
        } catch (err) {
          lastError = err as RedditHttpError;
          const status = lastError.status;
          const retryable =
            status === undefined ||
            RETRYABLE_STATUS.has(status) ||
            lastError.name === "AbortError";
          const isLastAttempt = attempt >= maxAttempts;

          if (!retryable || isLastAttempt) {
            console.error(
              `[Reddit] "${urlPath}" failed after ${attempt} attempt(s): ${lastError.message}`,
            );
            throw lastError;
          }

          const retryAfterSec = parseFloat(lastError.retryAfter || "");
          const backoffMs = Number.isFinite(retryAfterSec)
            ? retryAfterSec * 1000
            : Math.min(10000, 800 * 2 ** (attempt - 1));
          const jitterMs = Math.floor(Math.random() * 300);
          console.warn(
            `[Reddit] attempt ${attempt}/${maxAttempts} failed` +
              `${status ? ` (HTTP ${status})` : ""}. Retrying in ${Math.round(backoffMs + jitterMs)}ms…`,
          );
          await sleep(backoffMs + jitterMs);
        }
      }

      throw lastError ?? new Error("Reddit fetch failed");
    });
  }

  async search(query: string, limit = 20, after?: string): Promise<RedditSearchResult> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return { posts: [] };

    const tokens = queryTokens(cleanQuery);
    const subreddits = getSubredditsForQuery(cleanQuery);
    const subChunk = subreddits.slice(0, 35).join("+");

    // 1. Primary search: Targeted job and topic subreddits with sort=new for ultra-recent postings
    const targetedPath = `/r/${subChunk}/search.json?q=${encodeURIComponent(cleanQuery)}&sort=${REDDIT_SORT}&restrict_sr=1&limit=${limit}${
      after ? `&after=${encodeURIComponent(after)}` : ""
    }`;

    let targetedResult: { posts: RedditPost[]; after?: string } = { posts: [] };
    try {
      targetedResult = await this.fetchWithRetry(targetedPath);
    } catch (err) {
      console.warn(`[Reddit] Targeted search failed, falling back to global search:`, err);
    }

    let allPosts = [...targetedResult.posts];
    let afterNext = targetedResult.after;

    // 2. Global search fallback/supplement if needed (e.g., initial page and under requested limit)
    if (allPosts.length < Math.min(limit, 8) && !after) {
      const globalPath = `/search.json?q=${encodeURIComponent(cleanQuery)}&sort=${REDDIT_SORT}&limit=${limit}`;
      try {
        const globalResult = await this.fetchWithRetry(globalPath);
        const existingIds = new Set(allPosts.map((p) => p.id));
        const filteredGlobal = globalResult.posts.filter(
          (p) => !existingIds.has(p.id) && postMatchesQuery(p, tokens),
        );
        allPosts.push(...filteredGlobal);
        if (!afterNext) afterNext = globalResult.after;
      } catch (err) {
        console.warn(`[Reddit] Global search supplement failed:`, err);
      }
    }

    // 3. Filter for relevance, deduplicate by ID, and sort chronologically (newest first)
    const seen = new Set<string>();
    const relevantPosts = allPosts.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return postMatchesQuery(p, tokens);
    });

    relevantPosts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      posts: relevantPosts.slice(0, limit),
      after: afterNext,
    };
  }
}
