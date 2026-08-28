import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

const COOKIE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "reddit_cookies.txt",
);

function loadCookieHeader(): string {
  const content = readFileSync(COOKIE_FILE, "utf8");
  return content
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [domain, , , , , name, ...valueParts] = line.split("\t");
      const value = valueParts.join("\t");
      const includeHostOnly = !domain.startsWith(".");
      const includeSecure = domain.startsWith(".");
      return { name, value, includeHostOnly, includeSecure };
    })
    .filter((c) => c.value && c.name)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export class RedditClient {
  constructor(
    private readonly userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ) {}

  async search(query: string, limit = 20): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        "user-agent": this.userAgent,
        accept: "application/json",
        cookie: loadCookieHeader(),
      },
    });

    if (!res.ok) {
      throw new Error(`Reddit API error ${res.status}`);
    }

    const json = (await res.json()) as any;
    const children = json?.data?.children ?? [];
    return children
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
  }
}