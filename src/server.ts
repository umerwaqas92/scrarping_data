import "dotenv/config";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig } from "./config.js";
import { XSearchClient } from "./xClient.js";
import { RedditClient } from "./redditClient.js";
import { ApifyClient } from "./apifyClient.js";

const config = loadConfig();
const client = new XSearchClient(config);
const reddit = new RedditClient();
const apify = config.apifyToken
  ? new ApifyClient([config.apifyToken, config.apifyToken2, config.apifyToken3].filter(Boolean) as string[])
  : null;

// Track active Chrome Extension WebSockets
const extensionClients = new Set<WebSocket>();
const pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }>();

/**
 * Execute LinkedIn search via connected Chrome Extension
 */
function searchLinkedInViaExtension(query: string, count = 15, timeoutMs = 20000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const activeWs = [...extensionClients].find((s) => s.readyState === WebSocket.OPEN);
    if (!activeWs) {
      return reject(new Error("No Chrome Extension connected. Please enable the MultiFeed extension in Chrome."));
    }

    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Extension search request timed out"));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timer });

    activeWs.send(
      JSON.stringify({
        id,
        type: "SEARCH_LINKEDIN",
        query,
        count,
      }),
    );
  });
}

/**
 * Fetch Apify account balance info
 */
async function fetchApifyBalances() {
  const tokens = [
    { name: "APIFY_TOKEN", token: config.apifyToken },
    { name: "APIFY_TOKEN2", token: config.apifyToken2 },
    { name: "APIFY_TOKEN3", token: config.apifyToken3 },
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  res.setHeader("content-type", "application/json; charset=utf-8");

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
        connected: extensionClients.size > 0,
        clientsCount: extensionClients.size,
      }),
    );
    return;
  }

  // Apify live balance endpoint
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

  // Direct LinkedIn endpoint (supports Extension with fallback to Apify)
  if (path === "/linkedin" && req.method === "GET") {
    const queries = parseQueries();
    if (queries.length === 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing query param: q" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 15), 50);

    try {
      // 1. Try Chrome Extension first ($0.00 cost) with 5s timeout
      if (extensionClients.size > 0) {
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
          console.warn("[Extension search timed out/failed, seamlessly falling back to Apify]:", extErr instanceof Error ? extErr.message : String(extErr));
        }
      }

      // 2. Fallback to Apify
      if (apify) {
        const items = (
          await Promise.all(queries.map((q) => apify.searchLinkedInPosts(q, count)))
        ).flat();
        const seen = new Set<string>();
        const deduped = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
        res.end(JSON.stringify({ queries, source: "linkedin", method: "apify", count: deduped.length, items: deduped }, null, 2));
        return;
      }

      res.statusCode = 503;
      res.end(
        JSON.stringify({
          error: "LinkedIn scraper unavailable. Please load the Chrome Extension or configure APIFY_TOKEN in .env",
        }),
      );
    } catch (err) {
      res.statusCode = 502;
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
        queries.map(async (q) => ({ query: q, tweets: (await client.search(q, { product, count })).tweets })),
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
      client.search(queries[0], { product: "Latest", count, cursor: xCursor }),
      reddit.search(queries[0], count, redditAfter),
    ]);
    const xCursorNext = xFirst.status === "fulfilled" ? xFirst.value.nextCursor : undefined;
    const redditAfterNext = redditFirst.status === "fulfilled" ? redditFirst.value.after : undefined;

    const rest = await Promise.allSettled(
      queries.slice(1).flatMap((q): Promise<any[]>[] => [
        client.search(q, { product: "Latest", count }).then((r) => r.tweets),
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

    try {
      // If LinkedIn and Extension is connected, use Extension for $0.00
      if (source === "linkedin" && extensionClients.size > 0) {
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
              ? await apify.searchLinkedInPosts(q, count)
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
    res.end(JSON.stringify({ ok: true, extensionConnected: extensionClients.size > 0 }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found. Try GET /search?q=your+query" }));
});

// Setup WebSocket server with explicit upgrade handler
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/ws" || url.pathname === "/ws/") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  console.log("🔗 Chrome Extension connected to /ws");
  extensionClients.add(ws);

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "PING") {
        ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
        return;
      }
      if (data.id && pendingRequests.has(data.id)) {
        const { resolve, reject, timer } = pendingRequests.get(data.id)!;
        clearTimeout(timer);
        pendingRequests.delete(data.id);

        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data.items || []);
        }
      }
    } catch (err) {
      console.error("Failed to parse extension message:", err);
    }
  });

  ws.on("close", () => {
    console.log("❌ Chrome Extension disconnected from /ws");
    extensionClients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("Extension WebSocket error:", err);
    extensionClients.delete(ws);
  });
});

server.listen(config.port, () => {
  console.log(`x-search-api listening on http://localhost:${config.port}`);
  console.log(`WebSocket server ready on ws://localhost:${config.port}/ws`);
});