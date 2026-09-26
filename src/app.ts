import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { XSearchClient } from "./xClient.js";
import { RedditClient } from "./redditClient.js";
import { LinkedinClient } from "./linkedinClient.js";
import { ApifyClient } from "./apifyClient.js";
import { getProfile, saveProfile } from "./db.js";
import { generateProposal } from "./proposalHelper.js";
import { sendProposalEmail, sendBulkProposalEmails, getResumeInfo } from "./email.js";
import {
  extensionClients,
  isExtensionConnected,
  searchLinkedInViaExtension,
  searchFacebookViaExtension,
} from "./extensionBridge.js";

// Config and clients are created lazily so a missing env var only fails the
// route that needs it instead of crashing the entire serverless function.
let _config: ReturnType<typeof loadConfig> | null = null;
function getConfig(): ReturnType<typeof loadConfig> {
  if (!_config) _config = loadConfig();
  return _config;
}

let _xClient: XSearchClient | null = null;
function getXClient(): XSearchClient {
  if (!_xClient) _xClient = new XSearchClient(getConfig());
  return _xClient;
}

const reddit = new RedditClient();
const linkedinClient = new LinkedinClient();

let _apify: ApifyClient | null | undefined;
function getApify(): ApifyClient | null {
  if (_apify === undefined) {
    const cfg = getConfig();
    _apify = cfg.apifyToken
      ? new ApifyClient([cfg.apifyToken, cfg.apifyToken2, cfg.apifyToken3].filter(Boolean) as string[])
      : null;
  }
  return _apify;
}

/**
 * Fetch Apify account balance info
 */
async function fetchApifyBalances() {
  const cfg = getConfig();
  const tokens = [
    { name: "APIFY_TOKEN", token: cfg.apifyToken },
    { name: "APIFY_TOKEN2", token: cfg.apifyToken2 },
    { name: "APIFY_TOKEN3", token: cfg.apifyToken3 },
  ].filter((t): t is { name: string; token: string } => Boolean(t.token));

  const results = await Promise.all(
    tokens.map(async ({ name, token }) => {
      try {
        const [uRes, lRes] = await Promise.all([
          fetch("https://api.apify.com/v2/users/me", { headers: { authorization: `Bearer ${token}` } }),
          fetch("https://api.apify.com/v2/users/me/limits", { headers: { authorization: `Bearer ${token}` } }),
        ]);
        const user = ((await uRes.json()) as any)?.data;
        const limits = ((await lRes.json()) as any)?.data;
        const maxUsd = limits?.limits?.maxMonthlyUsageUsd ?? user?.plan?.maxMonthlyUsageUsd ?? 5;
        const usedUsd = limits?.current?.monthlyUsageUsd ?? 0;
        const remainingUsd = Math.max(0, maxUsd - usedUsd);
        return {
          key: name,
          username: user?.username ?? "Unknown",
          email: user?.email ?? "",
          plan: user?.plan?.id ?? "FREE",
          maxMonthlyUsageUsd: maxUsd,
          monthlyUsageUsd: usedUsd,
          remainingUsd,
          percentRemaining: Number(((remainingUsd / maxUsd) * 100).toFixed(1)),
          status: "active" as const,
        };
      } catch (err) {
        return {
          key: name,
          username: "Error",
          email: "",
          plan: "UNKNOWN",
          maxMonthlyUsageUsd: 0,
          monthlyUsageUsd: 0,
          remainingUsd: 0,
          percentRemaining: 0,
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return results;
}

/** Read the full request body as a string (supports Vercel's pre-parsed body). */
function readBody(req: IncomingMessage): Promise<string> {
  const maybeParsed = (req as unknown as { body?: unknown }).body;
  if (maybeParsed !== undefined && maybeParsed !== null) {
    return Promise.resolve(typeof maybeParsed === "string" ? maybeParsed : JSON.stringify(maybeParsed));
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const rawPath = url.pathname;
  const path = rawPath.replace(/^\/api/, "") || "/";

  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  function parseQueries(): string[] {
    const qs = url.searchParams
      .getAll("q")
      .flatMap((q) => q.split(","))
      .map((q) => q.trim())
      .filter(Boolean);
    return [...new Set(qs)];
  }

  // Extension status endpoint
  if (path === "/extension/status" && req.method === "GET") {
    res.end(
      JSON.stringify({
        connected: isExtensionConnected(),
        clientsCount: extensionClients.size,
      }),
    );
    return;
  }

  // Google Autocomplete Suggestions endpoint
  if (path === "/suggestions" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) {
      res.end(JSON.stringify({ query: "", suggestions: [] }));
      return;
    }

    try {
      const googleUrl = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`;
      const response = await fetch(googleUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0",
        },
      });

      if (!response.ok) {
        // Fallback to toolbar XML if client=firefox fails
        const xmlUrl = `https://suggestqueries.google.com/complete/search?output=toolbar&q=${encodeURIComponent(q)}`;
        const xmlRes = await fetch(xmlUrl);
        const xmlText = await xmlRes.text();
        const matches = [...xmlText.matchAll(/<suggestion data="([^"]+)"\/>/g)].map((m) => m[1]);
        res.end(JSON.stringify({ query: q, suggestions: matches }));
        return;
      }

      const data = await response.json();
      const suggestions = Array.isArray(data) && Array.isArray(data[1]) ? (data[1] as string[]) : [];
      res.end(JSON.stringify({ query: q, suggestions }));
    } catch (err) {
      res.end(JSON.stringify({ query: q, suggestions: [], error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // Apify live balance endpoint (temporarily disabled/commented out)
  // if (path === "/apify/balance" && req.method === "GET") {
  //   try {
  //     const balances = await fetchApifyBalances();
  //     res.end(JSON.stringify({ balances }, null, 2));
  //   } catch (err) {
  //     res.statusCode = 500;
  //     res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  //   }
  //   return;
  // }

  // Direct LinkedIn endpoint (supports Direct Cookies, Extension, with fallback to Apify)
  if (path === "/linkedin" && req.method === "GET") {
    const queries = parseQueries();
    if (queries.length === 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing query param: q" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 15), 50);
    const sortBy = (url.searchParams.get("sortBy") as "date" | "relevance") || "date";
    const postedLimit = url.searchParams.get("postedLimit") || undefined;

    try {
      // 1. Try Direct Cookies scraper first ($0.00 cost, fastest, no extension or apify required)
      try {
        const items = (
          await Promise.all(queries.map((q) => linkedinClient.searchPosts(q, count)))
        ).flat();
        if (items.length > 0) {
          const seen = new Set<string>();
          const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
          res.end(JSON.stringify({ queries, source: "linkedin", method: "direct-cookies", count: deduped.length, items: deduped }, null, 2));
          return;
        }
      } catch (cookieErr) {
        console.warn("[Direct cookie search failed, falling back]:", cookieErr instanceof Error ? cookieErr.message : String(cookieErr));
      }

      // 2. Try Chrome Extension ($0.00 cost) with 6s timeout
      if (isExtensionConnected()) {
        try {
          const items = (
            await Promise.all(queries.map((q) => searchLinkedInViaExtension(q, count, 6000)))
          ).flat();
          if (items.length > 0) {
            const seen = new Set<string>();
            const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
            res.end(JSON.stringify({ queries, source: "linkedin", method: "chrome-extension", count: deduped.length, items: deduped }, null, 2));
            return;
          }
        } catch (extErr) {
          console.warn("[Extension search timed out/failed, falling back to Apify]:", extErr instanceof Error ? extErr.message : String(extErr));
        }
      }

      // 3. Fallback to Apify
      const apify = getApify();
      if (apify) {
        try {
          const items = (
            await Promise.all(queries.map((q) => apify.searchLinkedInPosts(q, count, sortBy, postedLimit)))
          ).flat();
          const seen = new Set<string>();
          const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
          res.end(JSON.stringify({ queries, source: "linkedin", method: "apify", count: deduped.length, items: deduped }, null, 2));
          return;
        } catch (apifyErr) {
          console.warn("[Apify LinkedIn search failed]:", apifyErr instanceof Error ? apifyErr.message : String(apifyErr));
        }
      }

      res.end(
        JSON.stringify({
          queries,
          source: "linkedin",
          method: "none",
          count: 0,
          items: [],
          warning: "No LinkedIn results returned. Please verify linkedin_cookies.txt or connect Chrome Extension.",
        }, null, 2),
      );
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
    }
    return;
  }

  // Facebook Search Endpoint (Extension $0.00 first, Apify fallback)
  if (path === "/facebook" && req.method === "GET") {
    const queries = parseQueries();
    if (queries.length === 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing required query param: q" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 15), 50);

    try {
      // 1. Try Chrome Extension first ($0.00 cost)
      if (isExtensionConnected()) {
        try {
          const items = (
            await Promise.all(queries.map((q) => searchFacebookViaExtension(q, count, 6000)))
          ).flat();
          if (items.length > 0) {
            const seen = new Set<string>();
            const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
            res.end(JSON.stringify({ queries, source: "facebook", method: "chrome-extension", count: deduped.length, items: deduped }, null, 2));
            return;
          }
        } catch (extErr) {
          console.warn("[Extension FB search timed out/failed, falling back to Apify]:", extErr instanceof Error ? extErr.message : String(extErr));
        }
      }

      // 2. Fallback to Apify
      const apify = getApify();
      if (apify) {
        try {
          const items = (
            await Promise.all(queries.map((q) => apify.searchFacebook(q, count)))
          ).flat();
          const seen = new Set<string>();
          const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
          res.end(JSON.stringify({ queries, source: "facebook", method: "apify", count: deduped.length, items: deduped }, null, 2));
          return;
        } catch (apifyErr) {
          console.warn("[Apify Facebook search failed]:", apifyErr instanceof Error ? apifyErr.message : String(apifyErr));
        }
      }

      res.end(
        JSON.stringify({
          queries,
          source: "facebook",
          method: "none",
          count: 0,
          items: [],
          warning: "No Facebook results returned. Please load the Chrome Extension or configure APIFY_TOKEN in .env",
        }, null, 2),
      );
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
    }
    return;
  }

  if (path === "/search" && req.method === "GET") {
    const queries = parseQueries();
    if (queries.length === 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing required query param: q" }));
      return;
    }
    const product = url.searchParams.get("product") === "Top" ? "Top" : "Latest";
    const count = Math.min(Number(url.searchParams.get("count") ?? 20), 100);

    try {
      const results = await Promise.all(
        queries.map(async (q) => ({ query: q, tweets: (await getXClient().search(q, { product, count })).tweets })),
      );
      res.end(JSON.stringify({ queries, product, count, results }, null, 2));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
    }
    return;
  }

  if (path === "/feed" && req.method === "GET") {
    const queries = parseQueries();
    if (queries.length === 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing required query param: q" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 20), 100);
    const xCursor = url.searchParams.get("xCursor") ?? undefined;
    const redditAfter = url.searchParams.get("redditAfter") ?? undefined;

    const [xFirst, redditFirst] = await Promise.allSettled([
      getXClient().search(queries[0], { product: "Latest", count, cursor: xCursor }),
      reddit.search(queries[0], count, redditAfter),
    ]);
    const xCursorNext = xFirst.status === "fulfilled" ? xFirst.value.nextCursor : undefined;
    const redditAfterNext = redditFirst.status === "fulfilled" ? redditFirst.value.after : undefined;

    const rest = await Promise.allSettled(
      queries.slice(1).flatMap((q): Promise<any[]>[] => [
        getXClient().search(q, { product: "Latest", count }).then((r) => r.tweets),
        reddit.search(q, count).then((r) => r.posts),
      ]),
    );

    const firstTweets = xFirst.status === "fulfilled" ? xFirst.value.tweets : [];
    const firstPosts = redditFirst.status === "fulfilled" ? redditFirst.value.posts : [];
    const restTweets = rest.flatMap((r, i) => (r.status === "fulfilled" && i % 2 === 0 ? r.value : []));
    const restPosts = rest.flatMap((r, i) => (r.status === "fulfilled" && i % 2 === 1 ? r.value : []));
    [xFirst, redditFirst, ...rest].forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`${i === 1 ? "Reddit" : "X"} search failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });

    const dedupe = (items: any[]) => {
      const seen = new Set<string>();
      return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
    };

    res.end(
      JSON.stringify(
        {
          queries,
          count,
          tweets: dedupe([...firstTweets, ...restTweets]),
          posts: dedupe([...firstPosts, ...restPosts]),
          xCursorNext,
          redditAfterNext,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (path === "/apify" && req.method === "GET") {
    const queries = parseQueries();
    const source = url.searchParams.get("source");
    if (queries.length === 0 || (source !== "linkedin" && source !== "facebook")) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Required params: q, source=linkedin|facebook" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 10), 50);
    const sortBy = (url.searchParams.get("sortBy") as "date" | "relevance") || "date";
    const postedLimit = url.searchParams.get("postedLimit") || undefined;

    try {
      const apify = getApify();
      // If LinkedIn: try direct cookies scraper first ($0.00)
      if (source === "linkedin") {
        try {
          const items = (
            await Promise.all(queries.map((q) => linkedinClient.searchPosts(q, count)))
          ).flat();
          if (items.length > 0) {
            const seen = new Set<string>();
            const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
            res.end(JSON.stringify({ queries, source, count, method: "direct-cookies", items: deduped }, null, 2));
            return;
          }
        } catch (cookieErr) {
          console.warn("[/apify Direct cookie search failed, falling back]:", cookieErr instanceof Error ? cookieErr.message : String(cookieErr));
        }
      }

      // If LinkedIn and Extension is connected, use Extension for $0.00
      if (source === "linkedin" && isExtensionConnected()) {
        const items = (
          await Promise.all(queries.map((q) => searchLinkedInViaExtension(q, count)))
        ).flat();
        const seen = new Set<string>();
        const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
        res.end(JSON.stringify({ queries, source, count, method: "chrome-extension", items: deduped }, null, 2));
        return;
      }

      if (!apify) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "No scraper available. Connect the Chrome Extension or set APIFY_TOKEN in .env" }));
        return;
      }

      const items = (
        await Promise.all(
          queries.map(async (q) =>
            source === "linkedin"
              ? await apify.searchLinkedInPosts(q, count, sortBy, postedLimit)
              : await apify.searchFacebook(q, count),
          ),
        )
      ).flat();
      const seen = new Set<string>();
      const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
      res.end(JSON.stringify({ queries, source, count, method: "apify", items: deduped }, null, 2));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
    }
    return;
  }

  if (path === "/health") {
    res.end(JSON.stringify({ ok: true, extensionConnected: isExtensionConnected() }));
    return;
  }

  // ── Profile: GET /profile ──────────────────────────────────────────────────
  if (path === "/profile" && req.method === "GET") {
    try {
      const row = await getProfile();
      res.end(JSON.stringify({
        content: row?.content ?? "",
        queries: row?.queries ?? [],
        updated_at: row?.updated_at ?? null,
      }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Profile: POST /profile ─────────────────────────────────────────────────
  if (path === "/profile" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as { content?: string; queries?: string[] };
      const { content, queries } = parsed;

      if (typeof content !== "string" && !Array.isArray(queries)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing field: content (string) or queries (array)" }));
        return;
      }

      const existing = await getProfile();
      const newContent = typeof content === "string" ? content.trim() : (existing?.content ?? "");
      const newQueries = Array.isArray(queries)
        ? queries.map((q) => String(q).trim()).filter(Boolean)
        : (existing?.queries ?? []);

      await saveProfile(newContent, newQueries);
      res.end(JSON.stringify({ ok: true, content: newContent, queries: newQueries }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Proposal: POST /proposal ───────────────────────────────────────────────
  if (path === "/proposal" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { jobText, jobTitle, jobUrl } = JSON.parse(body) as { jobText?: string; jobTitle?: string; jobUrl?: string };
      if (!jobText) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing field: jobText" }));
        return;
      }
      const profileRow = await getProfile();
      const profileContent = profileRow?.content?.trim() || "(No profile info provided)";
      const result = await generateProposal(profileContent, jobText, jobTitle, jobUrl);
      res.end(JSON.stringify({ summary: result.summary, proposal: result.proposal }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Resume Info: GET /resume-info ─────────────────────────────────────────
  if (path === "/resume-info" && req.method === "GET") {
    const info = getResumeInfo();
    res.end(JSON.stringify(info));
    return;
  }

  // ── Send Proposal Email: POST /send-proposal ──────────────────────────────
  if (path === "/send-proposal" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { to, subject, proposal, jobTitle, summary, attachResume, resumePath } = JSON.parse(body) as {
        to?: string;
        subject?: string;
        proposal?: string;
        jobTitle?: string;
        summary?: string;
        attachResume?: boolean;
        resumePath?: string;
      };

      if (!to) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing required recipient field: to" }));
        return;
      }
      if (!proposal) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing required field: proposal" }));
        return;
      }

      const result = await sendProposalEmail({
        to,
        subject,
        body: proposal,
        jobTitle,
        summary,
        attachResume,
        resumePath,
      });

      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Send Bulk Proposal Emails: POST /send-bulk-proposals ───────────────────
  if (path === "/send-bulk-proposals" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body) as {
        items?: Array<{
          to: string;
          subject?: string;
          proposal: string;
          jobTitle?: string;
          summary?: string;
          jobId?: string;
          attachResume?: boolean;
          resumePath?: string;
        }>;
        recipients?: string[];
        subject?: string;
        proposal?: string;
        summary?: string;
        attachResume?: boolean;
        resumePath?: string;
      };

      let emailItems: Array<{
        to: string;
        subject?: string;
        body: string;
        jobTitle?: string;
        summary?: string;
        jobId?: string;
        attachResume?: boolean;
        resumePath?: string;
      }> = [];

      if (Array.isArray(payload.items) && payload.items.length > 0) {
        emailItems = payload.items.map((it) => ({
          to: it.to,
          subject: it.subject,
          body: it.proposal,
          jobTitle: it.jobTitle,
          summary: it.summary,
          jobId: it.jobId,
          attachResume: it.attachResume ?? payload.attachResume,
          resumePath: it.resumePath ?? payload.resumePath,
        }));
      } else if (Array.isArray(payload.recipients) && payload.recipients.length > 0 && payload.proposal) {
        emailItems = payload.recipients.map((recip) => ({
          to: recip,
          subject: payload.subject,
          body: payload.proposal!,
          summary: payload.summary,
          attachResume: payload.attachResume,
          resumePath: payload.resumePath,
        }));
      }

      if (emailItems.length === 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing or empty items/recipients array" }));
        return;
      }

      const report = await sendBulkProposalEmails(emailItems);
      res.end(JSON.stringify(report));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  res.end(JSON.stringify({ error: "Not found. Try GET /search?q=your+query" }));
}

export { fetchApifyBalances };
