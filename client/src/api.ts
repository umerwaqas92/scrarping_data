export interface XUser {
  id: string;
  screenName: string;
  name: string;
}

export interface XTweet {
  id: string;
  url: string;
  createdAt: string;
  text: string;
  user: XUser | null;
  replyCount?: number;
  retweetCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number;
  media?: string[];
}

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

export interface LinkedinProfile {
  id: string;
  publicIdentifier: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline: string;
  location?: string;
  currentPosition?: string;
  profilePicture?: string;
  createdAt: string;
  source: "linkedin";
}

export interface LinkedinPost {
  id: string;
  content: string;
  linkedinUrl: string;
  authorName: string;
  authorUrl: string;
  authorHeadline: string;
  authorPicture: string;
  postedAt: string;
  likes?: number;
  comments?: number;
  shares?: number;
  createdAt: string;
  source: "linkedin";
}

export interface FacebookPost {
  id: string;
  content?: string;
  text?: string;
  url: string;
  pageUrl?: string;
  pageName?: string;
  authorName?: string;
  authorPicture?: string;
  authorHeadline?: string;
  postedAt?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  followers?: number;
  location?: string;
  createdAt: string;
  source: "facebook";
}

export interface FeedResponse {
  query?: string;
  queries: string[];
  count: number;
  tweets: XTweet[];
  posts: RedditPost[];
  xCursorNext?: string;
  redditAfterNext?: string;
}

export interface ApifyResponse<T> {
  query?: string;
  queries: string[];
  source: "linkedin" | "facebook";
  count: number;
  method?: "chrome-extension" | "apify" | "direct-cookies";
  items: T[];
}

export interface ApifyBalance {
  key: string;
  username: string;
  email: string;
  plan: string;
  maxMonthlyUsageUsd: number;
  monthlyUsageUsd: number;
  remainingUsd: number;
  percentRemaining: number;
  status: "active" | "error";
  error?: string;
}

export interface FeedParams {
  query: string;
  count?: number;
  xCursor?: string;
  redditAfter?: string;
}

export const API_BASE = (import.meta as any).env?.VITE_API_URL || (typeof window !== "undefined" && (window.location.port === "5174" || window.location.port === "5173") ? "http://localhost:3001" : "/api");

export function splitQueries(input: string): string[] {
  return [...new Set(input.split(",").map((q) => q.trim()).filter(Boolean))];
}

export async function getFeed({ query, count = 20, xCursor, redditAfter }: FeedParams): Promise<FeedResponse> {
  const queries = splitQueries(query);
  const params = new URLSearchParams({ count: String(count) });
  queries.forEach((q) => params.append("q", q));
  if (xCursor) params.set("xCursor", xCursor);
  if (redditAfter) params.set("redditAfter", redditAfter);
  const res = await fetch(`${API_BASE}/feed?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function getApify<T>(
  source: "linkedin" | "facebook",
  query: string,
  count = 10,
): Promise<ApifyResponse<T>> {
  const queries = splitQueries(query);
  const params = new URLSearchParams({ source, count: String(count) });
  queries.forEach((q) => params.append("q", q));
  const res = await fetch(`${API_BASE}/apify?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function searchLinkedIn(
  query: string,
  count = 15,
): Promise<ApifyResponse<LinkedinPost>> {
  const queries = splitQueries(query);
  const params = new URLSearchParams({ count: String(count) });
  queries.forEach((q) => params.append("q", q));
  const res = await fetch(`${API_BASE}/linkedin?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function searchFacebook(
  query: string,
  count = 15,
): Promise<ApifyResponse<FacebookPost>> {
  const queries = splitQueries(query);
  const params = new URLSearchParams({ count: String(count) });
  queries.forEach((q) => params.append("q", q));
  const res = await fetch(`${API_BASE}/facebook?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function getApifyBalances(): Promise<ApifyBalance[]> {
  // Commented out:
  // const res = await fetch(`${API_BASE}/apify/balance`);
  // if (!res.ok) throw new Error("Failed to fetch Apify balance");
  // const data = await res.json();
  // return data.balances ?? [];
  return [];
}

export async function getExtensionStatus(): Promise<{ connected: boolean; clientsCount: number }> {
  const res = await fetch(`${API_BASE}/extension/status`);
  if (!res.ok) return { connected: false, clientsCount: 0 };
  return res.json();
}

// ── Profile ──────────────────────────────────────────────────────────────────

export interface ProfileData {
  content: string;
  queries: string[];
  updated_at: string | null;
}

export async function getProfile(): Promise<ProfileData> {
  const res = await fetch(`${API_BASE}/profile`);
  if (!res.ok) return { content: "", queries: [], updated_at: null };
  return res.json();
}

export async function saveProfile(content: string, queries?: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, queries }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Save profile failed (${res.status})`);
  }
}

// ── Cookies ──────────────────────────────────────────────────────────────────

export type CookiePlatform = "linkedin" | "reddit" | "facebook";

export interface CookieStatus {
  platform: CookiePlatform;
  configured: boolean;
  source: "database" | "env" | "file" | "none";
  updated_at: string | null;
  cookieCount: number;
  hasSession: boolean;
}

export interface CookieVerification {
  ok: boolean;
  status?: number;
  message: string;
  account?: string;
}

export interface CookieSaveResult {
  ok: boolean;
  saved: boolean;
  count?: number;
  format?: string;
  verification: CookieVerification;
  message?: string;
  error?: string;
}

export async function getCookieStatuses(): Promise<CookieStatus[]> {
  const res = await fetch(`${API_BASE}/cookies`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to load cookies (${res.status})`);
  }
  const data = (await res.json()) as { platforms?: CookieStatus[] };
  return Array.isArray(data.platforms) ? data.platforms : [];
}

export async function savePlatformCookies(
  platform: CookiePlatform,
  content: string,
  force = false,
): Promise<CookieSaveResult> {
  const res = await fetch(`${API_BASE}/cookies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, content, force }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<CookieSaveResult>;
  return {
    ok: res.ok && Boolean(data.ok),
    saved: Boolean(data.saved),
    count: data.count,
    format: data.format,
    verification: data.verification ?? {
      ok: false,
      message: data.error ?? `Request failed (${res.status})`,
    },
    message: data.message,
    error: data.error,
  };
}

export async function deletePlatformCookies(platform: CookiePlatform): Promise<void> {
  const res = await fetch(`${API_BASE}/cookies?platform=${platform}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Delete failed (${res.status})`);
  }
}

// ── Applied jobs ─────────────────────────────────────────────────────────────

export interface AppliedJob {
  id: string;
  title: string;
  applied_at: string;
}

export async function getAppliedJobs(): Promise<AppliedJob[]> {
  const res = await fetch(`${API_BASE}/applied`);
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { jobs?: AppliedJob[] };
  return Array.isArray(data.jobs) ? data.jobs : [];
}

export async function saveAppliedJobApi(id: string, title?: string, appliedAt?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/applied`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title, appliedAt }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Save applied job failed (${res.status})`);
  }
}

export async function deleteAppliedJobApi(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/applied?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Delete applied job failed (${res.status})`);
  }
}

// ── Proposal ─────────────────────────────────────────────────────────────────

const PROPOSAL_RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export async function generateProposal(
  jobText: string,
  jobTitle?: string,
  jobUrl?: string,
  onRetry?: (attempt: number, maxAttempts: number) => void,
): Promise<{ summary: string; proposal: string }> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobText, jobTitle, jobUrl }),
      });
      const data = await res.json().catch(() => ({})) as any;

      if (!res.ok) {
        const err = new Error(data?.error ?? `Proposal failed (${res.status})`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      if (!data?.proposal) {
        const err = new Error("Received an empty proposal from the server") as Error & { status?: number };
        err.status = 502;
        throw err;
      }
      return { summary: data.summary || "", proposal: data.proposal as string };
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const retryable =
        status === undefined || // network failure / server unreachable
        err instanceof TypeError ||
        PROPOSAL_RETRYABLE_STATUS.has(status);

      if (attempt >= maxAttempts || !retryable) {
        throw err;
      }

      onRetry?.(attempt + 1, maxAttempts);
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt + Math.random() * 300));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to generate proposal");
}

export interface ResumeInfo {
  exists: boolean;
  filename: string;
  path: string;
  source?: "database" | "env" | "file" | "none";
  size?: number;
}

export async function getResumeInfo(): Promise<ResumeInfo> {
  try {
    const res = await fetch(`${API_BASE}/resume-info`);
    if (!res.ok) return { exists: false, filename: "Umer_Waqas_Software_Engineer_Resume.pdf", path: "" };
    return res.json();
  } catch {
    return { exists: false, filename: "Umer_Waqas_Software_Engineer_Resume.pdf", path: "" };
  }
}

export interface SaveResumeResult {
  ok: boolean;
  filename: string;
  size: number;
}

export async function saveResume(filename: string, contentBase64: string): Promise<SaveResumeResult> {
  const res = await fetch(`${API_BASE}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentBase64 }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<SaveResumeResult> & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return { ok: true, filename: data.filename ?? filename, size: data.size ?? 0 };
}

export async function deleteResume(): Promise<void> {
  const res = await fetch(`${API_BASE}/resume`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Delete failed (${res.status})`);
  }
}

export async function sendProposalEmail(
  to: string,
  proposal: string,
  jobTitle?: string,
  subject?: string,
  summary?: string,
  attachResume?: boolean,
  resumePath?: string,
): Promise<{ ok: boolean; messageId: string }> {
  const res = await fetch(`${API_BASE}/send-proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, proposal, jobTitle, subject, summary, attachResume, resumePath }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error ?? `Send email failed (${res.status})`);
  return data;
}

export interface BulkEmailItem {
  to: string;
  subject?: string;
  proposal: string;
  jobTitle?: string;
  summary?: string;
  jobId?: string;
  attachResume?: boolean;
  resumePath?: string;
}

export interface BulkEmailResult {
  to: string;
  ok: boolean;
  messageId?: string;
  error?: string;
  jobId?: string;
}

export interface BulkEmailReport {
  total: number;
  sent: number;
  failed: number;
  results: BulkEmailResult[];
}

export async function sendBulkProposals(
  items: BulkEmailItem[]
): Promise<BulkEmailReport> {
  const res = await fetch(`${API_BASE}/send-bulk-proposals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error ?? `Send bulk emails failed (${res.status})`);
  return data as BulkEmailReport;
}

// ── Google Autocomplete Suggestions ──────────────────────────────────────────

export async function getGoogleSuggestions(q: string): Promise<string[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  try {
    const res = await fetch(`${API_BASE}/suggestions?q=${encodeURIComponent(trimmed)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  }
}