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

// In-memory result cache: cacheKey -> { posts, expiresAt }
const resultCache = new Map<string, { posts: LinkedinPost[]; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

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
    )}&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D`;

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

  private async enrichPost(p: LinkedinPost, cookieHeader: string, csrfToken: string | null): Promise<LinkedinPost> {
    try {
      const res = await fetch(p.linkedinUrl, {
        headers: {
          "user-agent": this.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          cookie: cookieHeader,
          ...(csrfToken ? { "csrf-token": csrfToken } : {}),
        },
      });

      if (!res.ok) return p;
      const html = await res.text();

      // 1. Author Name — look for MiniProfile firstName+lastName or name text block
      const miniProfileMatch = html.match(/&quot;firstName&quot;:&quot;([^&"]+)&quot;[\s\S]{0,200}?&quot;lastName&quot;:&quot;([^&"]+)&quot;/);
      if (miniProfileMatch) {
        p.authorName = (miniProfileMatch[1] + " " + miniProfileMatch[2]).trim();
      } else {
        const nameMatch = html.match(/&quot;name&quot;:\{&quot;textDirection&quot;:&quot;[^&"]*&quot;,&quot;text&quot;:&quot;([^&"]+)&quot;/);
        if (nameMatch) {
          p.authorName = nameMatch[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
        }
      }

      // 2. Author Headline — it appears as "description".text with USER_LOCALE direction, near the bottom of the page
      // Collect all description blocks with USER_LOCALE (actor card headline)
      const userLocaleDescMatches = [...html.matchAll(/&quot;description&quot;:\{&quot;textDirection&quot;:&quot;USER_LOCALE&quot;,&quot;text&quot;:&quot;((?:(?!&quot;)[\s\S])+?)&quot;/g)];
      const realDesc = userLocaleDescMatches.find(m => {
        const v = m[1].trim();
        return v.length > 5 && v.length < 300 && !v.match(/^[\s•·]+$/) && !v.includes("com.linkedin");
      });
      if (realDesc) {
        p.authorHeadline = realDesc[1]
          .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      }
      // Fallback: try &quot;headline&quot; key that is a human-readable string
      if (!p.authorHeadline || p.authorHeadline === "LinkedIn Professional") {
        const allHeadlineMatches = [...html.matchAll(/&quot;headline&quot;:&quot;((?:(?!&quot;)[\s\S])+?)&quot;/g)];
        const realHeadline = allHeadlineMatches.find(m => {
          const v = m[1].trim();
          return v.length > 3 && v.length < 300 && !v.includes("com.linkedin") && !v.includes("/");
        });
        if (realHeadline) {
          p.authorHeadline = realHeadline[1]
            .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
        }
      }

      // 3. Post Content (extract longest full commentary block)
      const textMatches = [...html.matchAll(/&quot;textDirection&quot;:&quot;[^&"]*&quot;,&quot;text&quot;:&quot;([\s\S]*?)&quot;/g)]
        .map((m) => m[1])
        .filter((t) => t !== p.authorHeadline && !t.startsWith("http") && !t.includes("&quot;") && t.length > 20);

      textMatches.sort((a, b) => b.length - a.length);
      if (textMatches[0]) {
        p.content = textMatches[0]
          .replace(/&#92;n/g, "\n")
          .replace(/\\n/g, "\n")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#92;u[0-9a-fA-F]{4}/g, "")
          .replace(/\\u[0-9a-fA-F]{4}/g, "");
      }

      // 4. Author Picture — target the post actor's avatar (nonEntityProfilePicture / nonEntityCompanyLogo / companyLogo)
      // This ensures we get the actual post author's photo rather than the viewer's/logged-in profile photo from the nav
      const actorPicMatches = [...html.matchAll(/&quot;(?:nonEntityProfilePicture|nonEntityCompanyLogo|companyLogo)&quot;:\{&quot;[^t][\s\S]*?&quot;rootUrl&quot;:&quot;(https:\/\/media\.licdn\.com\/dms\/image\/v2\/[^&"]+)&quot;/g)];
      for (const m of actorPicMatches) {
        const rootUrl = m[1];
        const chunk = m[0];
        const segMatches = [...chunk.matchAll(/&quot;fileIdentifyingUrlPathSegment&quot;:&quot;((?:(?!&quot;)[\s\S])+?)&quot;/g)];
        const bestSeg = segMatches.find(s => s[1].includes("200_200")) ||
                        segMatches.find(s => s[1].includes("100_100")) ||
                        segMatches.find(s => s[1].includes("400_400")) ||
                        segMatches[segMatches.length - 1];
        if (bestSeg) {
          const seg = bestSeg[1]
            .replace(/&amp;/g, "&")
            .replace(/&#61;/g, "=");
          p.authorPicture = rootUrl + seg;
          break;
        }
      }

      // 5. Engagement
      const likesMatch = html.match(/&quot;numLikes&quot;:(\d+)/);
      if (likesMatch) p.likes = parseInt(likesMatch[1], 10);
      const commentsMatch = html.match(/&quot;numComments&quot;:(\d+)/);
      if (commentsMatch) p.comments = parseInt(commentsMatch[1], 10);

    } catch (err) {}
    return p;
  }

  async searchPosts(query: string, limit = 15): Promise<LinkedinPost[]> {
    const { cookieHeader, csrfToken } = this.loadCookies();
    if (!cookieHeader) {
      throw new Error("No cookies found in linkedin_cookies.txt. Please paste your LinkedIn cookies into linkedin_cookies.txt");
    }

    // --- Cache check ---
    const cacheKey = `${query.toLowerCase().trim()}:${limit}`;
    const cached = resultCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      console.log(`[LinkedIn] Cache hit for "${query}" (${limit})`);
      return cached.posts;
    }

    // --- Parallel sub-queries (all fired at once, not sequentially) ---
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

    console.log(`[LinkedIn] Firing ${subQueries.length} sub-queries in parallel for "${query}"`);
    const t0 = Date.now();

    const results = await Promise.allSettled(
      subQueries.map((sq) => this.fetchSingleQuery(sq, cookieHeader, csrfToken))
    );

    const allPosts: LinkedinPost[] = [];
    const seenUrls = new Set<string>();

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          if (!seenUrls.has(item.linkedinUrl)) {
            seenUrls.add(item.linkedinUrl);
            allPosts.push(item);
          }
        }
      }
    }

    console.log(`[LinkedIn] Sub-queries done in ${Date.now() - t0}ms, found ${allPosts.length} unique posts`);

    allPosts.sort((a, b) => {
      const timeA = new Date(a.postedAt || a.createdAt).getTime();
      const timeB = new Date(b.postedAt || b.createdAt).getTime();
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });

    const targetPosts = allPosts.slice(0, limit);

    // --- Parallel enrichment (already was parallel, kept as-is) ---
    const t1 = Date.now();
    const enriched = await Promise.all(
      targetPosts.map((p) => this.enrichPost(p, cookieHeader, csrfToken))
    );
    console.log(`[LinkedIn] Enrichment done in ${Date.now() - t1}ms for ${enriched.length} posts`);

    // --- Store in cache ---
    resultCache.set(cacheKey, { posts: enriched, expiresAt: Date.now() + CACHE_TTL_MS });

    return enriched;
  }
}
