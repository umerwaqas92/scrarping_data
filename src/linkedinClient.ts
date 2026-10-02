import { getCookieText, parseCookieText } from "./cookies.js";

const LI_TIMEOUT_MS = Math.max(3000, parseInt(process.env.LINKEDIN_TIMEOUT_MS || "10000", 10));

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

export class LinkedinClient {
  private userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  private async loadCookies(): Promise<{ cookieHeader: string; csrfToken: string | null }> {
    const text = await getCookieText("linkedin");
    if (!text.trim()) {
      return { cookieHeader: "", csrfToken: null };
    }

    const parsed = parseCookieText(text);
    const jsession = parsed.cookies.find((c) => c.name === "JSESSIONID");

    return {
      cookieHeader: parsed.header,
      csrfToken: jsession ? jsession.value.replace(/^"|"$/g, "") : null,
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LI_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private extractPostsFromJson(json: any, query: string): LinkedinPost[] {
    const posts: LinkedinPost[] = [];
    const items = json?.included || json?.elements || (Array.isArray(json) ? json : [json]);

    for (const item of items) {
      if (!item || typeof item !== "object") continue;

      const text =
        item.commentary?.text?.text ||
        item.commentary?.text ||
        item.text?.text ||
        item.summary?.text ||
        item.title?.text ||
        item.header?.text?.text ||
        item.value?.commentary?.text?.text ||
        item.value?.text?.text;

      if (!text || typeof text !== "string" || text.trim().length < 5) continue;
      if (posts.some((p) => p.content === text.trim())) continue;

      const actor = item.actor || item.owner || item.value?.actor || item.value?.owner || {};
      const authorName =
        actor.name?.text ||
        actor.title?.text ||
        actor.name ||
        "LinkedIn Member";
      const authorHeadline =
        actor.description?.text ||
        actor.subDescription?.text ||
        actor.subtitle?.text ||
        "";
      
      // Resolve full avatar URL (vectorImage requires concatenating rootUrl + fileIdentifyingUrlPathSegment)
      const vectorImg =
        actor.image?.attributes?.[0]?.detailData?.nonEntityProfilePicture?.vectorImage ||
        actor.image?.attributes?.[0]?.detailData?.companyLogo?.vectorImage ||
        actor.image?.attributes?.[0]?.detailData?.union?.vectorImage ||
        actor.image?.attributes?.[0]?.detailData?.profilePicture?.vectorImage ||
        actor.picture?.vectorImage ||
        actor.vectorImage;

      let authorPicture = "";
      if (vectorImg?.rootUrl) {
        const artifacts = Array.isArray(vectorImg.artifacts) ? vectorImg.artifacts : [];
        const bestSeg =
          artifacts.find((a: any) => a.fileIdentifyingUrlPathSegment?.includes("200_200"))?.fileIdentifyingUrlPathSegment ||
          artifacts.find((a: any) => a.fileIdentifyingUrlPathSegment?.includes("100_100"))?.fileIdentifyingUrlPathSegment ||
          artifacts.find((a: any) => a.fileIdentifyingUrlPathSegment?.includes("400_400"))?.fileIdentifyingUrlPathSegment ||
          artifacts[artifacts.length - 1]?.fileIdentifyingUrlPathSegment ||
          artifacts[0]?.fileIdentifyingUrlPathSegment ||
          "";
        authorPicture = vectorImg.rootUrl + bestSeg;
      }
      if (!authorPicture) {
        authorPicture =
          (typeof actor.picture === "string" ? actor.picture : actor.picture?.rootUrl) ||
          actor.pictureUrl ||
          actor.imageUrl ||
          actor.photoUrl ||
          "";
      }
      const urn =
        item.urn ||
        item.entityUrn ||
        item.updateMetadata?.urn ||
        item.value?.entityUrn ||
        item.value?.urn ||
        `urn:li:activity:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const linkedinUrl = urn.includes("urn:li:activity:")
        ? `https://www.linkedin.com/feed/update/${urn}`
        : actor.navigationUrl || `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;

      const socialDetail = item.socialDetail || item.value?.socialDetail || {};
      const likes =
        socialDetail.totalSocialActivityCounts?.numLikes ||
        socialDetail.numLikes ||
        0;
      const comments =
        socialDetail.totalSocialActivityCounts?.numComments ||
        socialDetail.numComments ||
        0;
      const shares =
        socialDetail.totalSocialActivityCounts?.numShares ||
        socialDetail.numShares ||
        0;

      let postedAt = new Date().toISOString();
      if (typeof urn === "string") {
        const match = urn.match(/\d{15,22}/);
        if (match) {
          try {
            const timestampMs = Number(BigInt(match[0]) >> 22n);
            if (timestampMs > 1500000000000 && timestampMs < 2500000000000) {
              postedAt = new Date(timestampMs).toISOString();
            }
          } catch {}
        }
      }

      posts.push({
        id: urn,
        content: text.trim(),
        linkedinUrl,
        authorName,
        authorUrl: actor.navigationUrl || "",
        authorHeadline,
        authorPicture,
        postedAt,
        likes,
        comments,
        shares,
        createdAt: postedAt,
        source: "linkedin",
      });
    }
    return posts;
  }

  private async fetchSingleQuery(query: string, cookieHeader: string, csrfToken: string | null): Promise<LinkedinPost[]> {
    // 1. Try Voyager API first (~200ms)
    try {
      const voyagerUrl = `https://www.linkedin.com/voyager/api/search/dash/clusters?decorationId=com.linkedin.voyager.dash.deco.search.SearchClusterCollection-185&origin=GLOBAL_SEARCH_HEADER&q=all&query=(keywords:${encodeURIComponent(
        query
      )},flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(CONTENT)),(key:sortBy,value:List(date_posted))))&count=15`;
      const vHeaders: Record<string, string> = {
        accept: "application/vnd.linkedin.normalized+json+2.1, application/json",
        "x-restli-protocol-version": "2.0.0",
        "user-agent": this.userAgent,
        cookie: cookieHeader,
      };
      if (csrfToken) vHeaders["csrf-token"] = csrfToken;
      const vRes = await this.fetchWithTimeout(voyagerUrl, { headers: vHeaders });
      if (vRes.ok) {
        const vJson = await vRes.json();
        const vPosts = this.extractPostsFromJson(vJson, query);
        if (vPosts.length > 0) return vPosts;
      }
    } catch {}

    // 2. Fetch HTML page & parse embedded <code> JSON blocks and slug patterns
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

    const res = await this.fetchWithTimeout(url, { headers });
    if (!res.ok) return [];

    const html = await res.text();
    const posts: LinkedinPost[] = [];

    // Parse <code> JSON blocks
    const codeBlocks = html.match(/<code[^>]*>([\s\S]*?)<\/code>/gi) || [];
    for (const block of codeBlocks) {
      const raw = block.replace(/<\/?code[^>]*>/gi, "").trim();
      if (!raw.includes("{") || !raw.includes("}")) continue;
      if (!raw.includes("commentary") && !raw.includes("urn:li") && !raw.includes("actor") && !raw.includes("text")) {
        continue;
      }
      try {
        const decoded = raw
          .replace(/&quot;/g, '"')
          .replace(/&#34;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'");
        const json = JSON.parse(decoded);
        const parsed = this.extractPostsFromJson(json, query);
        for (const p of parsed) {
          if (!posts.some((existing) => existing.content === p.content)) {
            posts.push(p);
          }
        }
      } catch {}
    }

    if (posts.length > 0) return posts;

    // Fallback to slug matching
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
      const res = await this.fetchWithTimeout(p.linkedinUrl, {
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
    const { cookieHeader, csrfToken } = await this.loadCookies();
    if (!cookieHeader) {
      throw new Error("No LinkedIn cookies configured. Add them in the Cookie Manager dialog or set LINKEDIN_COOKIES.");
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

    return enriched;
  }

  /**
   * Directly fetch and parse a specific LinkedIn post by URL via curl/HTTP ($0.00, no Apify required).
   */
  async fetchPostByUrl(targetUrl: string): Promise<LinkedinPost> {
    const rawUrl = targetUrl.trim();
    if (!rawUrl) {
      throw new Error("Missing LinkedIn post URL");
    }

    let html = "";

    // 1. Primary: Direct clean curl execution (bypasses TLS fingerprints and works instantly on public posts)
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      const curlArgs = [
        "-s", "-L",
        "-A", this.userAgent,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: en-US,en;q=0.9",
        rawUrl,
      ];

      const { stdout } = await execFileAsync("curl", curlArgs, { timeout: LI_TIMEOUT_MS });
      if (stdout && stdout.length > 500) {
        html = stdout;
      }
    } catch (curlErr) {
      console.warn("[LinkedIn] guest curl failed, trying node fetch:", curlErr instanceof Error ? curlErr.message : String(curlErr));
    }

    // 2. Secondary: Node fetch
    if (!html || html.length < 500) {
      try {
        const headers: Record<string, string> = {
          "user-agent": this.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        };

        const res = await this.fetchWithTimeout(rawUrl, { headers });
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 500) {
            html = text;
          }
        }
      } catch (fetchErr) {
        console.warn("[LinkedIn] fetch failed:", fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
      }
    }

    if (!html || html.length < 100) {
      throw new Error("Unable to retrieve LinkedIn post. The page could not be accessed.");
    }

    // Parse the HTML content
    const post = this.parsePostHtml(html, rawUrl);

    // If post content or author is missing and cookies are available, try enrichPost
    const { cookieHeader, csrfToken } = await this.loadCookies();
    if ((!post.content || post.authorName === "LinkedIn Member") && cookieHeader) {
      try {
        return await this.enrichPost(post, cookieHeader, csrfToken);
      } catch {}
    }

    return post;
  }

  private parsePostHtml(html: string, originalUrl: string): LinkedinPost {
    let authorName = "";
    let authorUrl = "";
    let authorHeadline = "";
    let authorPicture = "";
    let content = "";
    let postedAt = "";
    let likes = 0;
    let comments = 0;

    // 1. Try application/ld+json structured schema
    const ldMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
    for (const m of ldMatches) {
      try {
        const parsed = JSON.parse(m[1]);
        const obj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (obj && (obj["@type"] === "SocialMediaPosting" || obj.articleBody || obj.author)) {
          if (obj.articleBody && typeof obj.articleBody === "string") {
            content = obj.articleBody;
          }
          if (obj.headline && typeof obj.headline === "string") {
            authorHeadline = obj.headline;
          }
          if (obj.datePublished && typeof obj.datePublished === "string") {
            postedAt = obj.datePublished;
          }
          if (obj.author && typeof obj.author === "object") {
            authorName = obj.author.name || authorName;
            authorUrl = obj.author.url || authorUrl;
            if (obj.author.image) {
              authorPicture = typeof obj.author.image === "string" ? obj.author.image : obj.author.image.url || "";
            }
          }
          if (Array.isArray(obj.interactionStatistic)) {
            for (const stat of obj.interactionStatistic) {
              const count = Number(stat.userInteractionCount);
              if (!isNaN(count)) {
                if (stat.interactionType?.includes("LikeAction")) likes = count;
                if (stat.interactionType?.includes("CommentAction")) comments = count;
              }
            }
          }
          break;
        }
      } catch {}
    }

    // 2. OpenGraph / Meta tags fallback
    if (!content) {
      const ogDesc = html.match(/<meta (?:property="og:description"|name="description") content="([^"]+)"/i);
      if (ogDesc) {
        content = ogDesc[1]
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
      }
    }

    if (!authorName) {
      const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i);
      if (ogTitle) {
        const decoded = ogTitle[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
        const parts = decoded.split("|").map((s) => s.trim());
        if (parts.length > 1) {
          authorName = parts[parts.length - 1];
          if (!authorHeadline) authorHeadline = parts[0];
        } else {
          authorName = decoded;
        }
      }
    }

    if (!authorPicture) {
      const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/i);
      if (ogImage && !ogImage[1].includes("aero-v1/sc/h/c45fy346jw096z9pbphyyhdz7")) {
        authorPicture = ogImage[1];
      }
    }

    // 3. Extract URN activity ID
    const urnMatch = (originalUrl + " " + html).match(/urn:li:(?:activity|ugcPost):(\d+)/);
    const id = urnMatch ? urnMatch[0] : `urn:li:activity:${Date.now()}`;

    // Extract approximate publication time from snowflake ID if not set
    if (!postedAt && urnMatch?.[1]) {
      try {
        const ms = Number(BigInt(urnMatch[1]) >> 22n);
        if (ms > 1500000000000 && ms < 2500000000000) {
          postedAt = new Date(ms).toISOString();
        }
      } catch {}
    }
    if (!postedAt) postedAt = new Date().toISOString();

    // Canonical URL
    const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/i) || html.match(/<meta property="og:url" content="([^"]+)"/i);
    const linkedinUrl = canonicalMatch ? canonicalMatch[1] : originalUrl;

    if (!authorUrl && authorName && authorName !== "LinkedIn Member") {
      authorUrl = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(authorName)}`;
    }

    return {
      id,
      content: content.trim() || `LinkedIn Post (${linkedinUrl})`,
      linkedinUrl,
      authorName: authorName || "LinkedIn Member",
      authorUrl: authorUrl || linkedinUrl,
      authorHeadline: authorHeadline || "LinkedIn Post",
      authorPicture: authorPicture || "",
      postedAt,
      likes,
      comments,
      shares: 0,
      createdAt: postedAt,
      source: "linkedin",
    };
  }
}
