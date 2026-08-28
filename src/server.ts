import "dotenv/config";
import http from "node:http";
import { loadConfig } from "./config.js";
import { XSearchClient } from "./xClient.js";
import { RedditClient } from "./redditClient.js";

const config = loadConfig();
const client = new XSearchClient(config);
const reddit = new RedditClient();

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

    const [xResult, redditResult] = await Promise.allSettled([
      client.search(q, { product: "Latest", count }),
      reddit.search(q, count),
    ]);

    const tweets = xResult.status === "fulfilled" ? xResult.value : [];
    const posts = redditResult.status === "fulfilled" ? redditResult.value : [];
    if (xResult.status === "rejected") {
      console.error(`X search failed: ${xResult.reason instanceof Error ? xResult.reason.message : String(xResult.reason)}`);
    }
    if (redditResult.status === "rejected") {
      console.error(`Reddit search failed: ${redditResult.reason instanceof Error ? redditResult.reason.message : String(redditResult.reason)}`);
    }

    res.end(JSON.stringify({ query: q, count, tweets, posts }, null, 2));
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