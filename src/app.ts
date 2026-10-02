import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { XSearchClient } from "./xClient.js";
import { RedditClient } from "./redditClient.js";
import { LinkedinClient } from "./linkedinClient.js";
import { ApifyClient } from "./apifyClient.js";
import {
  getProfile,
  saveProfile,
  saveCookie,
  deleteCookie,
  getAppliedJobs,
  saveAppliedJob,
  deleteAppliedJob,
  saveResumeRecord,
  deleteResumeRecord,
  getApifyKeys,
  addApifyKey,
  deleteApifyKey,
} from "./db.js";
import { generateProposal, chatWithAI } from "./proposalHelper.js";
import { sendProposalEmail, sendBulkProposalEmails, getResumeInfo } from "./email.js";
import { verifyEmailsComprehensive } from "./emailVerifier.js";
import {
  COOKIE_PLATFORMS,
  cleanCookieText,
  getCookieStatuses,
  verifyCookies,
  type CookiePlatform,
} from "./cookies.js";
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

interface ApifyTokenEntry {
  label: string;
  token: string;
  source: "env" | "database";
  id?: string;
}

/** Merge env-provided APIFY_TOKEN* keys with keys stored in the database. */
async function getAllApifyTokens(): Promise<ApifyTokenEntry[]> {
  const cfg = getConfig();
  const envKeys: ApifyTokenEntry[] = [
    { label: "APIFY_TOKEN", token: cfg.apifyToken || "" },
    { label: "APIFY_TOKEN2", token: cfg.apifyToken2 || "" },
    { label: "APIFY_TOKEN3", token: cfg.apifyToken3 || "" },
    { label: "APIFY_TOKEN4", token: cfg.apifyToken4 || "" },
  ]
    .filter((k) => k.token)
    .map((k) => ({ ...k, source: "env" as const }));

  let dbKeys: ApifyTokenEntry[] = [];
  try {
    const rows = await getApifyKeys();
    dbKeys = rows.map((r) => ({
      label: r.label || "DB key",
      token: r.token,
      source: "database" as const,
      id: r.id,
    }));
  } catch {
    dbKeys = [];
  }

  const seen = new Set<string>();
  return [...envKeys, ...dbKeys].filter((k) => k.token && !seen.has(k.token) && seen.add(k.token));
}

async function getApify(): Promise<ApifyClient | null> {
  const list = await getAllApifyTokens();
  return list.length > 0 ? new ApifyClient(list.map((k) => k.token)) : null;
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 12) return `${token.slice(0, 4)}…`;
  return `${token.slice(0, 12)}…${token.slice(-4)}`;
}

// Words that signal a job/opportunity post vs. generic content.
const LINKEDIN_INTENT_WORDS = new Set([
  "job", "jobs", "hiring", "hire", "remote", "contract", "contractor", "freelance", "freelancer",
  "internship", "role", "roles", "position", "positions", "opening", "openings", "vacancy",
  "vacancies", "developer", "developers", "engineer", "engineers", "dev", "fulltime", "parttime",
  "c2c", "w2", "recruiter", "recruiting",
]);

/**
 * Keep only LinkedIn posts that (a) mention the query's non-generic terms and
 * (b) don't look like spam (hashtag-stuffed or very long promo posts). Falls
 * back to the original list if filtering would remove everything.
 */
function filterLinkedinRelevant<T extends { content?: string; authorHeadline?: string; authorName?: string }>(
  items: T[],
  query: string,
): T[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return items;

  const specific = tokens.filter((t) => !LINKEDIN_INTENT_WORDS.has(t));

  const kept = items.filter((it) => {
    const content = String(it?.content || "");
    const hay = `${content} ${it?.authorHeadline || ""} ${it?.authorName || ""}`.toLowerCase();

    if (specific.length > 0 && !specific.some((t) => hay.includes(t))) return false;

    const hashtags = (content.match(/#[\p{L}\d_]+/gu) || []).length;
    if (hashtags > 6) return false; // hashtag-stuffed promo/spam
    if (content.length > 1800) return false; // spam long-form

    return true;
  });

  return specific.length === 0 ? items : kept;
}

/**
 * Fetch Apify account balance info
 */
async function fetchApifyBalances() {
  const tokens = await getAllApifyTokens();

  const results = await Promise.all(
    tokens.map(async ({ label, token, source }) => {
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
          key: label,
          username: user?.username ?? "Unknown",
          email: user?.email ?? "",
          plan: user?.plan?.id ?? "FREE",
          maxMonthlyUsageUsd: maxUsd,
          monthlyUsageUsd: usedUsd,
          remainingUsd,
          percentRemaining: Number(((remainingUsd / maxUsd) * 100).toFixed(1)),
          status: "active" as const,
          source,
        };
      } catch (err) {
        return {
          key: label,
          username: "Error",
          email: "",
          plan: "UNKNOWN",
          maxMonthlyUsageUsd: 0,
          monthlyUsageUsd: 0,
          remainingUsd: 0,
          percentRemaining: 0,
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
          source,
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
  const path = rawPath.replace(/^\/api(?=\/|$)/, "") || "/";

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

  // Apify live balance endpoint (all configured APIFY_TOKEN* keys)
  if (path === "/apify/balance" && req.method === "GET") {
    try {
      const balances = await fetchApifyBalances();
      res.end(JSON.stringify({ balances }, null, 2));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // Apify keys list (masked) — env + database. ?reveal=1 also returns full tokens.
  if (path === "/apify/keys" && req.method === "GET") {
    try {
      const list = await getAllApifyTokens();
      const keys = list.map((k) => ({
        id: k.id || k.label,
        label: k.label,
        source: k.source,
        masked: maskToken(k.token),
        removable: k.source === "database",
      }));
      const reveal = url.searchParams.get("reveal") === "1" || url.searchParams.get("reveal") === "true";
      const payload: Record<string, unknown> = { keys };
      if (reveal) payload.tokens = list.map((k) => k.token);
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // Add Apify key(s). Accepts { tokens: string[] } (one per line) or { token }.
  // Names are auto-assigned (Apify username, else "Apify key N").
  if (path === "/apify/keys" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { label, token, tokens, force, replace } = JSON.parse(body) as {
        label?: string;
        token?: string;
        tokens?: string[];
        force?: boolean;
        replace?: boolean;
      };

      const rawList = Array.isArray(tokens)
        ? tokens
        : (typeof token === "string" ? token.split(/[\n,]+/) : []);
      const seen = new Set<string>();
      const cleaned = rawList
        .map((t) => String(t).trim())
        .filter((t) => t && !seen.has(t) && seen.add(t));

      if (cleaned.length === 0 && !replace) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "No keys provided" }));
        return;
      }

      // Replace mode: reconcile the stored DB keys to exactly this list.
      let removed = 0;
      const existingDb = await getApifyKeys();
      if (replace) {
        const desired = new Set(cleaned);
        for (const row of existingDb) {
          if (!desired.has(row.token)) {
            await deleteApifyKey(row.id);
            removed++;
          }
        }
      }

      const cfg = getConfig();
      const envTokens = new Set(
        [cfg.apifyToken, cfg.apifyToken2, cfg.apifyToken3, cfg.apifyToken4].filter(Boolean) as string[],
      );
      const existingTokens = new Set(existingDb.map((r) => r.token));

      // In replace mode, tokens already provided via env are left as-is (read-only).
      const toProcess = replace ? cleaned.filter((t) => !envTokens.has(t)) : cleaned;

      const results: Array<{
        masked: string;
        label: string;
        saved: boolean;
        ok: boolean;
        kept?: boolean;
        username?: string;
        message?: string;
      }> = [];
      let kept = 0;

      for (let i = 0; i < toProcess.length; i++) {
        const clean = toProcess[i];
        if (replace && existingTokens.has(clean)) {
          kept++;
          continue;
        }

        let verification: { ok: boolean; status?: number; username?: string; message?: string };
        try {
          const r = await fetch("https://api.apify.com/v2/users/me", {
            headers: { authorization: `Bearer ${clean}` },
          });
          if (r.ok) {
            const user = ((await r.json()) as any)?.data;
            verification = { ok: true, status: r.status, username: user?.username };
          } else {
            verification = { ok: false, status: r.status, message: `Apify returned HTTP ${r.status}` };
          }
        } catch (verr) {
          verification = { ok: false, message: verr instanceof Error ? verr.message : String(verr) };
        }

        const shouldSave = verification.ok || force === true;
        const name = (label || "").trim() || verification.username || `Apify key ${i + 1}`;
        if (shouldSave) {
          await addApifyKey(name, clean);
        }
        results.push({
          masked: maskToken(clean),
          label: name,
          saved: shouldSave,
          ok: verification.ok,
          username: verification.username,
          message: verification.message,
        });
      }

      const added = results.filter((r) => r.saved).length;
      const failed = results.filter((r) => !r.saved).length;
      res.statusCode = failed > 0 && added === 0 && kept === 0 ? 422 : 200;
      res.end(JSON.stringify({ ok: true, added, removed, kept, total: cleaned.length, results }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // Remove a stored Apify key
  if (path === "/apify/keys" && req.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      if (!id) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing query param: id" }));
        return;
      }
      await deleteApifyKey(id);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

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
        const items = filterLinkedinRelevant(
          (await Promise.all(queries.map((q) => linkedinClient.searchPosts(q, count)))).flat(),
          queries.join(" "),
        );
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
          const items = filterLinkedinRelevant(
            (await Promise.all(queries.map((q) => searchLinkedInViaExtension(q, count, 6000)))).flat(),
            queries.join(" "),
          );
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
      const apify = await getApify();
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

  // Facebook search is DISABLED for now (endpoint disabled).
  // Re-enable by restoring the original handler below.
  if (path === "/facebook" && req.method === "GET") {
    res.statusCode = 410;
    res.end(
      JSON.stringify({
        queries: parseQueries(),
        source: "facebook",
        method: "none",
        count: 0,
        items: [],
        warning: "Facebook search is disabled.",
      }, null, 2),
    );
    return;
  }

  // Original Facebook handler (Extension $0.00 first, Apify fallback) — disabled.
  // if (path === "/facebook" && req.method === "GET") {
  //   const queries = parseQueries();
  //   if (queries.length === 0) {
  //     res.statusCode = 400;
  //     res.end(JSON.stringify({ error: "Missing required query param: q" }));
  //     return;
  //   }
  //   const count = Math.min(Number(url.searchParams.get("count") ?? 15), 50);
  //
  //   try {
  //     if (isExtensionConnected()) {
  //       try {
  //         const items = (
  //           await Promise.all(queries.map((q) => searchFacebookViaExtension(q, count, 6000)))
  //         ).flat();
  //         if (items.length > 0) {
  //           const seen = new Set<string>();
  //           const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  //           res.end(JSON.stringify({ queries, source: "facebook", method: "chrome-extension", count: deduped.length, items: deduped }, null, 2));
  //           return;
  //         }
  //       } catch (extErr) {
  //         console.warn("[Extension FB search timed out/failed]:", extErr instanceof Error ? extErr.message : String(extErr));
  //       }
  //     }
  //     res.end(JSON.stringify({ queries, source: "facebook", method: "none", count: 0, items: [], warning: "No Facebook results returned." }, null, 2));
  //   } catch (err) {
  //     res.statusCode = 500;
  //     res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
  //   }
  //   return;
  // }

  // X (Twitter) search is DISABLED for now (endpoint disabled).
  if (path === "/search" && req.method === "GET") {
    res.statusCode = 410;
    res.end(
      JSON.stringify({
        queries: parseQueries(),
        product: url.searchParams.get("product") === "Top" ? "Top" : "Latest",
        count: 0,
        results: [],
        warning: "X (Twitter) search is disabled.",
      }, null, 2),
    );
    return;
  }

  // Original X search handler — disabled.
  // if (path === "/search" && req.method === "GET") {
  //   const queries = parseQueries();
  //   if (queries.length === 0) {
  //     res.statusCode = 400;
  //     res.end(JSON.stringify({ error: "Missing required query param: q" }));
  //     return;
  //   }
  //   const product = url.searchParams.get("product") === "Top" ? "Top" : "Latest";
  //   const count = Math.min(Number(url.searchParams.get("count") ?? 20), 100);
  //
  //   try {
  //     const results = await Promise.all(
  //       queries.map(async (q) => ({ query: q, tweets: (await getXClient().search(q, { product, count })).tweets })),
  //     );
  //     res.end(JSON.stringify({ queries, product, count, results }, null, 2));
  //   } catch (err) {
  //     res.statusCode = 502;
  //     res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
  //   }
  //   return;
  // }

  if (path === "/feed" && req.method === "GET") {
    const queries = parseQueries();
    if (queries.length === 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing required query param: q" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 20), 100);

    // Per-source selection via ?source=reddit (repeatable or comma-separated).
    // Defaults to reddit only. Unknown / disabled sources are rejected.
    const ALLOWED_SOURCES = ["reddit", "linkedin"] as const;
    type FeedSource = (typeof ALLOWED_SOURCES)[number];
    const requested = url.searchParams
      .getAll("source")
      .flatMap((s) => s.split(","))
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const sources = (requested.length > 0 ? [...new Set(requested)] : ["reddit"]) as string[];
    const invalid = sources.filter((s) => !ALLOWED_SOURCES.includes(s as FeedSource));
    if (invalid.length > 0) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          error: `Invalid source(s): ${invalid.join(", ")}. Allowed: ${ALLOWED_SOURCES.join(", ")}`,
        }),
      );
      return;
    }
    const wantReddit = sources.includes("reddit");
    const wantLinkedin = sources.includes("linkedin");

    // X (Twitter) is disabled for now — its cursor is intentionally ignored.
    const redditAfter = url.searchParams.get("redditAfter") ?? undefined;

    const tasks: Promise<any>[] = [];
    if (wantReddit) {
      queries.forEach((q, i) =>
        tasks.push(reddit.search(q, count, i === 0 ? redditAfter : undefined)),
      );
    }
    if (wantLinkedin) {
      queries.forEach((q) => tasks.push(linkedinClient.searchPosts(q, count).then((items) => ({ items }))));
    }
    // X disabled (kept commented for easy re-enable).
    // queries.forEach((q, i) => tasks.push(getXClient().search(q, { product: "Latest", count, cursor: i === 0 ? xCursor : undefined })));

    const settled = await Promise.allSettled(tasks);

    const tweets: any[] = [];
    const posts: any[] = [];
    const linkedinItems: any[] = [];
    const xCursorNext: string | undefined = undefined;
    let redditAfterNext: string | undefined;

    let idx = 0;
    if (wantReddit) {
      queries.forEach((q, i) => {
        const r = settled[idx++];
        if (r.status === "fulfilled") {
          posts.push(...r.value.posts);
          if (i === 0) redditAfterNext = r.value.after;
        } else {
          console.error(
            `Reddit search failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
          );
        }
      });
    }
    if (wantLinkedin) {
      queries.forEach(() => {
        const r = settled[idx++];
        if (r.status === "fulfilled") {
          linkedinItems.push(...(r.value.items ?? []));
        } else {
          console.error(
            `LinkedIn search failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
          );
        }
      });
    }

    const dedupe = (items: any[]) => {
      const seen = new Set<string>();
      return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
    };

    res.end(
      JSON.stringify(
        {
          queries,
          count,
          sources,
          tweets: dedupe(tweets),
          posts: dedupe(posts),
          linkedin: dedupe(linkedinItems),
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

    // Apify is used only for LinkedIn. Facebook through Apify is disabled.
    if (source !== "linkedin") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Apify is only available for source=linkedin" }));
      return;
    }

    try {
      const apify = await getApify();
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
          queries.map((q) => apify.searchLinkedInPosts(q, count, sortBy, postedLimit)),
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

  // ── Applied Jobs: GET /applied ─────────────────────────────────────────────
  if (path === "/applied" && req.method === "GET") {
    try {
      const jobs = await getAppliedJobs();
      res.end(JSON.stringify({ jobs }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Applied Jobs: POST /applied { id, title?, url?, source?, author?, content?, proposal?, note?, item?, appliedAt? } ─
  if (path === "/applied" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const input = JSON.parse(body) as {
        id?: string;
        title?: string;
        url?: string;
        source?: string;
        author?: string;
        author_avatar?: string;
        authorAvatar?: string;
        content?: string;
        proposal?: string;
        note?: string;
        item?: any;
        appliedAt?: string;
      };
      if (!input.id) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing field: id" }));
        return;
      }
      let avatar = input.author_avatar || input.authorAvatar || "";
      if (!avatar && input.item && typeof input.item === "object") {
        avatar =
          input.item.authorPicture ||
          input.item.profilePicture ||
          input.item.user?.profileImageUrl ||
          input.item.user?.profileImageUrlHttps ||
          input.item.user?.profile_image_url_https ||
          input.item.thumbnail ||
          "";
      }
      let authorUrl = (input as any).author_url || (input as any).authorUrl || "";
      if (!authorUrl && input.item && typeof input.item === "object") {
        authorUrl =
          input.item.authorUrl ||
          input.item.author_url ||
          (input.item.user?.screenName ? `https://x.com/${input.item.user.screenName}` : "") ||
          (input.item.author && input.item.subreddit ? `https://www.reddit.com/user/${input.item.author}` : "") ||
          input.item.pageUrl ||
          "";
      }
      const saved = await saveAppliedJob({
        id: input.id,
        title: input.title,
        url: input.url,
        source: input.source,
        author: input.author,
        author_avatar: avatar,
        authorAvatar: avatar,
        author_url: authorUrl,
        authorUrl: authorUrl,
        content: input.content,
        proposal: input.proposal,
        note: input.note,
        item: input.item ? (typeof input.item === "string" ? input.item : JSON.stringify(input.item)) : undefined,
        appliedAt: input.appliedAt,
      });
      res.end(JSON.stringify({ ok: true, job: saved }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Applied Jobs: DELETE /applied?id=... ───────────────────────────────────
  if (path === "/applied" && req.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      if (!id) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing query param: id" }));
        return;
      }
      await deleteAppliedJob(id);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Cookies: GET /cookies ─────────────────────────────────────────────────
  if (path === "/cookies" && req.method === "GET") {
    try {
      const platforms = await getCookieStatuses();
      res.end(JSON.stringify({ platforms }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Cookies: POST /cookies (clean → verify → save) ─────────────────────────
  if (path === "/cookies" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { platform, content, force } = JSON.parse(body) as {
        platform?: string;
        content?: string;
        force?: boolean;
      };

      if (!platform || !COOKIE_PLATFORMS.includes(platform as CookiePlatform)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: `platform must be one of: ${COOKIE_PLATFORMS.join(", ")}` }));
        return;
      }
      if (!content || !content.trim()) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing field: content (paste your cookies)" }));
        return;
      }

      // 1. Clean / normalize the pasted cookies
      const cleaned = cleanCookieText(content);
      if (cleaned.count === 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "No valid cookies found. Paste a Netscape cookie file or a Cookie header." }));
        return;
      }

      // 2. Verify against the live platform
      const verification = await verifyCookies(platform as CookiePlatform, cleaned.cleaned);

      // 3. Only persist when verified (or explicitly forced)
      if (!verification.ok && !force) {
        res.statusCode = 422;
        res.end(
          JSON.stringify({
            ok: false,
            saved: false,
            count: cleaned.count,
            format: cleaned.format,
            verification,
            message: "Cookies were cleaned but did not verify. Fix them, or retry with force=true to save anyway.",
          }),
        );
        return;
      }

      await saveCookie(platform, cleaned.cleaned);
      res.end(
        JSON.stringify({
          ok: true,
          saved: true,
          count: cleaned.count,
          format: cleaned.format,
          verification,
          message: verification.ok
            ? "Cookies verified and saved."
            : "Cookies saved without verification (forced).",
        }),
      );
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Cookies: DELETE /cookies?platform=linkedin ─────────────────────────────
  if (path === "/cookies" && req.method === "DELETE") {
    try {
      const platform = url.searchParams.get("platform");
      if (!platform || !COOKIE_PLATFORMS.includes(platform as CookiePlatform)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: `platform must be one of: ${COOKIE_PLATFORMS.join(", ")}` }));
        return;
      }
      await deleteCookie(platform);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
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

  // ── AI Career Chat: POST /ai-chat ──────────────────────────────────────────
  if (path === "/ai-chat" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const {
        messages,
        profileContent,
        appliedJobsSummary,
        currentSearchQuery,
        systemPromptOverride,
      } = JSON.parse(body) as {
        messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
        profileContent?: string;
        appliedJobsSummary?: string;
        currentSearchQuery?: string;
        systemPromptOverride?: string;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing or invalid field: messages (array)" }));
        return;
      }

      let resolvedProfile = profileContent;
      if (!resolvedProfile) {
        const profileRow = await getProfile();
        resolvedProfile = profileRow?.content?.trim() || "";
      }

      const result = await chatWithAI({
        messages,
        profileContent: resolvedProfile,
        appliedJobsSummary,
        currentSearchQuery,
        systemPromptOverride,
      });

      res.end(JSON.stringify({ message: result.message }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Resume Info: GET /resume-info ─────────────────────────────────────────
  if (path === "/resume-info" && req.method === "GET") {
    try {
      const info = await getResumeInfo();
      res.end(JSON.stringify(info));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Resume: POST /resume { filename, contentBase64 } (upload) ──────────────
  if (path === "/resume" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { filename, contentBase64 } = JSON.parse(body) as {
        filename?: string;
        contentBase64?: string;
      };
      if (!contentBase64 || !contentBase64.trim()) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing field: contentBase64" }));
        return;
      }

      const cleaned = contentBase64.replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
      const buf = Buffer.from(cleaned, "base64");
      if (buf.length === 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Invalid or empty PDF data" }));
        return;
      }
      if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Uploaded file is not a valid PDF" }));
        return;
      }

      const name = filename || "resume.pdf";
      await saveResumeRecord(name, buf.toString("base64"));
      res.end(JSON.stringify({ ok: true, filename: name, size: buf.length }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // ── Resume: DELETE /resume ─────────────────────────────────────────────────
  if (path === "/resume" && req.method === "DELETE") {
    try {
      await deleteResumeRecord();
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
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

  // ── Email Verifier: POST /verify-emails or GET /verify-email (Apify fatihtahta/email-verifier-free-to-use + DNS) ─
  if ((path === "/verify-emails" || path === "/verify-email") && (req.method === "POST" || req.method === "GET")) {
    try {
      let emails: string[] = [];
      if (req.method === "POST") {
        const body = await readBody(req);
        const parsed = JSON.parse(body || "{}") as { emails?: string[]; email?: string };
        if (Array.isArray(parsed.emails)) {
          emails = parsed.emails;
        } else if (parsed.email) {
          emails = [parsed.email];
        }
      } else {
        const emailParam = url.searchParams.get("email") || url.searchParams.get("emails");
        if (emailParam) {
          emails = emailParam.split(",").map((s) => s.trim()).filter(Boolean);
        }
      }

      if (emails.length === 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing required parameter: emails (array) or email (string)" }));
        return;
      }

      const apify = await getApify();
      const results = await verifyEmailsComprehensive(emails, apify);
      res.end(JSON.stringify({ ok: true, count: results.length, results }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  res.end(JSON.stringify({ error: "Not found. Try GET /search?q=your+query" }));
}

export { fetchApifyBalances };
