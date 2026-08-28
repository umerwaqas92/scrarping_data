import "dotenv/config";
import http from "node:http";
import { loadConfig } from "./config.js";
import { XSearchClient } from "./xClient.js";
import { RedditClient } from "./redditClient.js";
import { ApifyClient } from "./apifyClient.js";

const config = loadConfig();
const client = new XSearchClient(config);
const reddit = new RedditClient();
const apify = config.apifyToken ? new ApifyClient(config.apifyToken) : null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  res.setHeader("content-type", "application/json; charset=utf-8");

  if (path === "/search" && req.method === "GET") {
    const q = url.searchParams.get("q")?.trim();
    if (!q) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing required query param: q" }));
      return;
    }
    const product = url.searchParams.get("product") === "Top" ? "Top" : "Latest";
    const count = Math.min(Number(url.searchParams.get("count") ?? 20), 100);

    try {
      const tweets = await client.search(q, { product, count });
      res.end(JSON.stringify({ query: q, product, count, tweets }, null, 2));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
    }
    return;
  }

  if (path === "/feed" && req.method === "GET") {
    const q = url.searchParams.get("q")?.trim();
    if (!q) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing required query param: q" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 20), 100);
    const xCursor = url.searchParams.get("xCursor") ?? undefined;
    const redditAfter = url.searchParams.get("redditAfter") ?? undefined;

    const [xResult, redditResult] = await Promise.allSettled([
      client.search(q, { product: "Latest", count, cursor: xCursor }),
      reddit.search(q, count, redditAfter),
    ]);

    const tweets = xResult.status === "fulfilled" ? xResult.value.tweets : [];
    const xCursorNext = xResult.status === "fulfilled" ? xResult.value.nextCursor : undefined;
    const posts = redditResult.status === "fulfilled" ? redditResult.value.posts : [];
    const redditAfterNext = redditResult.status === "fulfilled" ? redditResult.value.after : undefined;
    if (xResult.status === "rejected") {
      console.error(`X search failed: ${xResult.reason instanceof Error ? xResult.reason.message : String(xResult.reason)}`);
    }
    if (redditResult.status === "rejected") {
      console.error(`Reddit search failed: ${redditResult.reason instanceof Error ? redditResult.reason.message : String(redditResult.reason)}`);
    }

    res.end(
      JSON.stringify({ query: q, count, tweets, posts, xCursorNext, redditAfterNext }, null, 2),
    );
    return;
  }

  if (path === "/apify" && req.method === "GET") {
    if (!apify) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Apify token not configured. Set APIFY_TOKEN in .env" }));
      return;
    }
    const q = url.searchParams.get("q")?.trim();
    const source = url.searchParams.get("source");
    if (!q || (source !== "linkedin" && source !== "facebook")) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Required params: q, source=linkedin|facebook" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 10), 50);

    try {
      const items =
        source === "linkedin" ? await apify.searchLinkedIn(q, count) : await apify.searchFacebook(q, count);
      res.end(JSON.stringify({ query: q, source, count, items }, null, 2));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
    }
    return;
  }

  if (path === "/health") {
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found. Try GET /search?q=your+query" }));
});

server.listen(config.port, () => {
  console.log(`x-search-api listening on http://localhost:${config.port}`);
  console.log(`Try: http://localhost:${config.port}/search?q=image%202%20app%20ui`);
});