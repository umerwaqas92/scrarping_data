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

export interface FeedResponse {
  query: string;
  count: number;
  tweets: XTweet[];
  posts: RedditPost[];
  xCursorNext?: string;
  redditAfterNext?: string;
}

export interface ApifyResponse<T> {
  query: string;
  source: "linkedin" | "facebook";
  count: number;
  items: T[];
}

export interface FeedParams {
  query: string;
  count?: number;
  xCursor?: string;
  redditAfter?: string;
}

export async function getFeed({ query, count = 20, xCursor, redditAfter }: FeedParams): Promise<FeedResponse> {
  const params = new URLSearchParams({ q: query, count: String(count) });
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
  const res = await fetch(`/api/apify?source=${source}&q=${encodeURIComponent(query)}&count=${count}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}