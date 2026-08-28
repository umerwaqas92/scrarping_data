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

export function splitQueries(input: string): string[] {
  return [...new Set(input.split(",").map((q) => q.trim()).filter(Boolean))];
}

export async function getFeed({ query, count = 20, xCursor, redditAfter }: FeedParams): Promise<FeedResponse> {
  const queries = splitQueries(query);
  const params = new URLSearchParams({ count: String(count) });
  queries.forEach((q) => params.append("q", q));
  if (xCursor) params.set("xCursor", xCursor);
  if (redditAfter) params.set("redditAfter", redditAfter);
  const res = await fetch(`/api/feed?${params.toString()}`);
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
  const res = await fetch(`/api/apify?${params.toString()}`);
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
  const res = await fetch(`/api/linkedin?${params.toString()}`);
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
  const res = await fetch(`/api/facebook?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function getApifyBalances(): Promise<ApifyBalance[]> {
  const res = await fetch("/api/apify/balance");
  if (!res.ok) throw new Error("Failed to fetch Apify balance");
  const data = await res.json();
  return data.balances ?? [];
}

export async function getExtensionStatus(): Promise<{ connected: boolean; clientsCount: number }> {
  const res = await fetch("/api/extension/status");
  if (!res.ok) return { connected: false, clientsCount: 0 };
  return res.json();
}

// ── Profile ──────────────────────────────────────────────────────────────────

export interface ProfileData {
  content: string;
  updated_at: string | null;
}

export async function getProfile(): Promise<ProfileData> {
  const res = await fetch("/api/profile");
  if (!res.ok) return { content: "", updated_at: null };
  return res.json();
}

export async function saveProfile(content: string): Promise<void> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Save profile failed (${res.status})`);
  }
}

// ── Proposal ─────────────────────────────────────────────────────────────────

export async function generateProposal(
  jobText: string,
  jobTitle?: string,
  jobUrl?: string,
): Promise<string> {
  const res = await fetch("/api/proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobText, jobTitle, jobUrl }),
  });
  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok) throw new Error(data?.error ?? `Proposal failed (${res.status})`);
  return data.proposal as string;
}

export async function sendProposalEmail(
  to: string,
  proposal: string,
  jobTitle?: string,
  subject?: string,
): Promise<{ ok: boolean; messageId: string }> {
  const res = await fetch("/api/send-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, proposal, jobTitle, subject }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error ?? `Send email failed (${res.status})`);
  return data;
}