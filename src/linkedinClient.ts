import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

const COOKIE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "linkedin_cookies.txt",
);

export class LinkedinClient {
  private userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  private loadCookies(): { cookieHeader: string; csrfToken: string | null } {
    if (!existsSync(COOKIE_FILE)) {
      return { cookieHeader: "", csrfToken: null };
    }

    const content = readFileSync(COOKIE_FILE, "utf8");
    const cookiePairs: string[] = [];
    let csrfToken: string | null = null;

    content
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .forEach((line) => {
        const parts = line.split("\t");
        if (parts.length >= 7) {
          const name = parts[5]?.trim();
          const rawVal = parts[6]?.trim();
          if (name && rawVal) {
            cookiePairs.push(`${name}=${rawVal}`);
            if (name === "JSESSIONID") {
              csrfToken = rawVal.replace(/^"|"$/g, "");
            }
          }
        }
      });

    return {
      cookieHeader: cookiePairs.join("; "),
      csrfToken,
    };
  }

  private async fetchSingleQuery(query: string, cookieHeader: string, csrfToken: string | null): Promise<LinkedinPost[]> {
    const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(
      query,
    )}&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22`;

    const headers: Record<string, string> = {
      "user-agent": this.userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      cookie: cookieHeader,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    };

    if (csrfToken) {
      headers["csrf-token"] = csrfToken;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) return [];

    const html = await res.text();
    const posts: LinkedinPost[] = [];
    const postSlugMatches = [...html.matchAll(/postSlugUrl\\?":\s*\\?"(https:[^\\"]+)\\"?/g)];

    for (const m of postSlugMatches) {
      const postUrl = m[1].replace(/\\/g, "");
      const idx = m.index;
      const chunk = html.slice(Math.max(0, idx - 6000), Math.min(html.length, idx + 6000));

      const urnMatch = chunk.match(/urn:li:(?:activity|ugcPost):(\d+)/);
      const id = urnMatch ? urnMatch[0] : `urn:li:activity:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const actorMatch = chunk.match(/actorName\\?":\s*\\?"([^\\"]+)\\"?/);
      let authorName = actorMatch ? actorMatch[1] : "";
      if (!authorName) {
        const nameMatch = chunk.match(/&quot;name&quot;:\{&quot;textDirection&quot;:&quot;[A-Z_]+&quot;,&quot;text&quot;:&quot;([^&"]+)&quot;/);
        authorName = nameMatch ? nameMatch[1] : "LinkedIn Member";
      }

      let authorHeadline = "";
      const headlineMatch = chunk.match(/&quot;description&quot;:\{&quot;textDirection&quot;:&quot;[A-Z_]+&quot;,&quot;text&quot;:&quot;([^&"]+)&quot;/);
      if (headlineMatch) {
        authorHeadline = headlineMatch[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      }

      let postedAt = new Date().toISOString();
      const idDigits = id.match(/\d{15,22}/);
      if (idDigits) {
        try {
          const timestampMs = Number(BigInt(idDigits[0]) >> 22n);
          if (timestampMs > 1500000000000 && timestampMs < 2500000000000) {
            postedAt = new Date(timestampMs).toISOString();
          }
        } catch {}
      }

      const slugTitle = postUrl.split("/posts/")[1]?.split("-share-")[0]?.split("-ugcPost-")[0]?.replace(/^[a-z0-9-]+_/i, "")?.replace(/-/g, " ") || "";
      const content = slugTitle ? slugTitle.charAt(0).toUpperCase() + slugTitle.slice(1) : `${query} on LinkedIn`;

      posts.push({
        id,
        content,
        linkedinUrl: postUrl,
        authorName,
        authorUrl: `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(authorName)}`,
        authorHeadline: authorHeadline || "LinkedIn Professional",
        authorPicture: "",
        postedAt,
        createdAt: postedAt,
        likes: 0,
        comments: 0,
        shares: 0,
        source: "linkedin",
      });
    }

    return posts;
  }

  async searchPosts(query: string, limit = 15): Promise<LinkedinPost[]> {
    const { cookieHeader, csrfToken } = this.loadCookies();
    if (!cookieHeader) {
      throw new Error("No cookies found in linkedin_cookies.txt. Please paste your LinkedIn cookies into linkedin_cookies.txt");
    }

    const subQueries = [
      query,
      `${query} developer`,
      `${query} engineer`,
      `${query} hiring`,
      `${query} job`,
      `${query} mobile`,
      `${query} app`,
      `${query} remote`,
      `${query} project`,
      `${query} tech`,
    ];

    const allPosts: LinkedinPost[] = [];
    const seenUrls = new Set<string>();

    for (const sq of subQueries) {
      if (allPosts.length >= limit) break;
      const items = await this.fetchSingleQuery(sq, cookieHeader, csrfToken);
      for (const item of items) {
        if (!seenUrls.has(item.linkedinUrl)) {
          seenUrls.add(item.linkedinUrl);
          allPosts.push(item);
        }
      }
    }

    allPosts.sort((a, b) => {
      const timeA = new Date(a.postedAt || a.createdAt).getTime();
      const timeB = new Date(b.postedAt || b.createdAt).getTime();
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });

    return allPosts.slice(0, limit);
  }
}
