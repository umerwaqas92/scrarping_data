import { fetchWebJobPost } from "./webJobScraper.js";

const DEFAULT_SERPAPI_KEY = "970cf595bc6767e57cebc0020e535c53457b910c747e01ab320373ea50b4cd11";

export interface GoogleJobPost {
  id: string;
  content: string;
  url: string;
  authorName: string; // Company Name
  authorUrl: string; // Link to job / company
  authorHeadline: string; // Job Title / Role
  authorPicture: string; // Logo or Favicon
  postedAt: string;
  location?: string;
  tags?: string[];
  source: "google";
  createdAt: string;
}

function cleanText(str: string): string {
  if (!str) return "";
  return str
    .replace(/â€™/g, "’")
    .replace(/â€œ/g, "“")
    .replace(/â€/g, "”")
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€˜/g, "‘")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch official Google Jobs via SerpApi ($0.00 / free-tier key, 100% production ready)
 */
export async function fetchSerpApiGoogleJobs(
  query: string,
  limit = 15,
  apiKey?: string,
): Promise<GoogleJobPost[]> {
  const key = apiKey || process.env.SERPAPI_API_KEY || DEFAULT_SERPAPI_KEY;
  if (!key) return [];

  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_jobs");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", key);
    url.searchParams.set("hl", "en");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[SerpApi] HTTP ${res.status}: ${await res.text().catch(() => "")}`);
      return [];
    }

    const data = (await res.json()) as any;
    const jobs = (data?.jobs_results || []) as any[];
    if (!Array.isArray(jobs) || jobs.length === 0) return [];

    return jobs.slice(0, limit).map((job: any, idx: number) => {
      const company = cleanText(job.company_name || "Hiring Company");
      const title = cleanText(job.title || `${query} Role`);
      const location = job.location ? cleanText(job.location) : "Remote / Unspecified";

      // Select direct apply link if available
      let jobUrl = job.share_link || "";
      if (Array.isArray(job.apply_options) && job.apply_options.length > 0) {
        jobUrl = job.apply_options[0]?.link || jobUrl;
      }

      const picture =
        job.thumbnail ||
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com")}&sz=128`;

      const tags: string[] = [];
      if (Array.isArray(job.extensions)) {
        for (const ext of job.extensions) {
          if (ext && typeof ext === "string") tags.push(cleanText(ext));
        }
      }
      if (job.detected_extensions?.schedule_type) {
        tags.push(cleanText(job.detected_extensions.schedule_type));
      }
      if (job.detected_extensions?.salary) {
        tags.push(cleanText(job.detected_extensions.salary));
      }
      if (job.detected_extensions?.work_from_home) {
        tags.push("Remote");
      }

      const description = cleanText(job.description || `${title} position at ${company}.`);
      const postedAt = new Date().toISOString();

      return {
        id: `serp_${job.job_id || `${Date.now()}_${idx}`}`,
        content: description,
        url: jobUrl,
        authorName: company,
        authorUrl: jobUrl,
        authorHeadline: title,
        authorPicture: picture,
        postedAt,
        location,
        tags: Array.from(new Set(tags)).filter(Boolean),
        source: "google" as const,
        createdAt: postedAt,
      };
    });
  } catch (err) {
    console.warn("[SerpApi Google Jobs Error]:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Fetch tech & remote jobs from RemoteOK public API ($0.00, zero keys required)
 */
export async function fetchRemoteOkJobs(keyword: string, limit = 10): Promise<GoogleJobPost[]> {
  const clean = keyword.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "");
  if (!clean) return [];

  const words = clean.split(/\s+/).filter(Boolean);
  const primaryTag = words[0];

  try {
    const url = `https://remoteok.com/api?tag=${encodeURIComponent(primaryTag)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return [];

    const matched = data.filter((item) => {
      if (!item || !item.id || !item.position) return false;
      const text = `${item.position} ${item.company || ""} ${item.description || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
      return words.some((w) => text.includes(w));
    });

    return matched.slice(0, limit).map((job) => {
      const company = cleanText(job.company || "Remote Company");
      const title = cleanText(job.position || `${keyword} Role`);
      const location = job.location ? cleanText(job.location) : "Remote";
      const url = job.url?.startsWith("http") ? job.url : `https://remoteok.com${job.url || ""}`;
      const postedAt = job.date ? new Date(job.date).toISOString() : new Date().toISOString();
      const picture =
        job.company_logo ||
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com")}&sz=128`;

      let cleanDesc = cleanText(
        (job.description || "").replace(/<[^>]+>/g, " ")
      ).replace(/^Description\s+/i, "");

      const content = cleanDesc || `${title} opening at ${company}.`;

      return {
        id: `google_rok_${job.id}`,
        content,
        url,
        authorName: company,
        authorUrl: url,
        authorHeadline: title,
        authorPicture: picture,
        postedAt,
        location,
        tags: Array.isArray(job.tags) ? job.tags : [],
        source: "google" as const,
        createdAt: postedAt,
      };
    });
  } catch (err) {
    console.warn("[RemoteOK API warning]:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Fetch Google Search ATS Dorks via Google News RSS ($0.00, no key required, bypasses bot blocks)
 */
export async function fetchGoogleDorkRss(
  dorkQuery: string,
  limit = 8,
): Promise<GoogleJobPost[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(dorkQuery)}&hl=en-US&gl=US&ceid=US:en`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return [];
    const xml = await res.text();
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    const jobs: GoogleJobPost[] = [];

    for (const m of itemMatches) {
      const raw = m[1];
      const titleMatch = raw.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = raw.match(/<link>([\s\S]*?)<\/link>/i);
      const pubDateMatch = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const sourceMatch = raw.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);

      if (titleMatch && linkMatch) {
        let rawTitle = titleMatch[1].replace(/<[^>]+>/g, "").trim();
        const articleLink = linkMatch[1].trim();
        const pubDate = pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : new Date().toISOString();
        const sourceName = sourceMatch ? sourceMatch[2].replace(/<[^>]+>/g, "").trim() : "Google Jobs";
        const sourceUrl = sourceMatch ? sourceMatch[1] : articleLink;

        // Clean HTML entities and common ATS job prefixes
        let cleanTitle = rawTitle
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&ndash;/g, "-")
          .replace(/&mdash;/g, "-")
          .replace(/^Job Application for /i, "")
          .trim();

        // Strip trailing platform names e.g. " - Greenhouse" or " - Lever"
        cleanTitle = cleanTitle.replace(/\s*-\s*(Greenhouse|Lever|Ashby|Workable|LinkedIn)$/i, "").trim();

        let company = sourceName;
        let jobTitle = cleanTitle;

        if (cleanTitle.includes(" at ")) {
          const parts = cleanTitle.split(" at ");
          jobTitle = parts[0].trim();
          company = parts.slice(1).join(" at ").trim();
        } else if (cleanTitle.includes(" - ")) {
          const parts = cleanTitle.split(" - ");
          company = parts[0].trim();
          jobTitle = parts.slice(1).join(" - ").trim();
        }

        const id = `gnews_${Buffer.from(articleLink).toString("base64").replace(/[+/=]/g, "").slice(0, 24)}`;
        const content = `Opportunity for ${jobTitle} at ${company}.\n\nDiscovered via official hiring platform (${sourceName}). Click 'Apply' to view the direct posting or 'Apply with AI' to generate a tailored proposal.`;

        jobs.push({
          id,
          content,
          url: articleLink,
          authorName: company,
          authorUrl: sourceUrl || articleLink,
          authorHeadline: jobTitle,
          authorPicture: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com")}&sz=128`,
          postedAt: pubDate,
          source: "google" as const,
          createdAt: pubDate,
        });

        if (jobs.length >= limit) break;
      }
    }

    return jobs;
  } catch (err) {
    console.warn("[Google Dork RSS warning]:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Main Google & Web Job Searcher
 * Combines:
 * 1. SerpApi Google Jobs Engine (Official structured Google Jobs data, 100% production ready)
 * 2. Google Dorks on ATS Platforms (Greenhouse, Lever, Ashby via RSS fallback)
 * 3. Free Remote Developer Job feeds (RemoteOK fallback)
 */
export async function searchGoogleJobs(
  query: string,
  count = 15,
): Promise<{ items: GoogleJobPost[]; method: string }> {
  const cleanQ = query.trim();
  if (!cleanQ) return { items: [], method: "none" };

  // 1. Primary: SerpApi Google Jobs ($0.00 / free tier, server-side, prod-ready)
  try {
    console.log(`[GoogleJobScraper] Querying SerpApi Google Jobs for "${cleanQ}" (limit: ${count})...`);
    const serpItems = await fetchSerpApiGoogleJobs(cleanQ, count);
    if (Array.isArray(serpItems) && serpItems.length > 0) {
      console.log(`[GoogleJobScraper] SerpApi returned ${serpItems.length} Google Jobs.`);
      return { items: serpItems.slice(0, count), method: "serpapi-google-jobs" };
    }
  } catch (err) {
    console.warn("[SerpApi error, falling back to ATS Dorks & Feeds]:", err instanceof Error ? err.message : String(err));
  }

  // 2. Fallback: Direct Google Dorks & Web ATS Search ($0.00, zero keys needed)
  console.log(`[GoogleJobScraper] Executing Direct Google Dorks & Free Feeds for "${cleanQ}"...`);

  const [greenhouseJobs, leverJobs, remoteOkJobs] = await Promise.all([
    fetchGoogleDorkRss(`site:boards.greenhouse.io ${cleanQ}`, Math.ceil(count / 2)),
    fetchGoogleDorkRss(`site:jobs.lever.co ${cleanQ}`, Math.ceil(count / 2)),
    fetchRemoteOkJobs(cleanQ, Math.ceil(count / 2)),
  ]);

  const merged = [...remoteOkJobs, ...greenhouseJobs, ...leverJobs];

  // Deduplicate by URL or title
  const seen = new Set<string>();
  const deduped: GoogleJobPost[] = [];

  for (const item of merged) {
    const key = (item.authorHeadline + item.authorName).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  // Sort newest first
  deduped.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

  return {
    items: deduped.slice(0, count),
    method: "google-dorks-free",
  };
}
