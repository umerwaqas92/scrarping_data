import "dotenv/config";
import http from "node:http";
import { loadConfig } from "./config.js";
import { XSearchClient } from "./xClient.js";
import { RedditClient } from "./redditClient.js";
import { ApifyClient } from "./apifyClient.js";

const config = loadConfig();
const client = new XSearchClient(config);
const reddit = new RedditClient();
const apify = config.apifyToken ? new ApifyClient([config.apifyToken, config.apifyToken2].filter(Boolean) as string[]) : null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  res.setHeader("content-type", "application/json; charset=utf-8");

  function parseQueries(): string[] {
    const qs = url.searchParams.getAll("q")
      .flatMap((q) => q.split(","))
      .map((q) => q.trim())
      .filter(Boolean);
    return [...new Set(qs)];
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
      JSON.stringify({
        queries,
        count,
        tweets: dedupe([...firstTweets, ...restTweets]),
        posts: dedupe([...firstPosts, ...restPosts]),
        xCursorNext,
        redditAfterNext,
      }, null, 2),
    );
    return;
  }

  if (path === "/apify" && req.method === "GET") {
    if (!apify) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Apify token not configured. Set APIFY_TOKEN in .env" }));
      return;
    }
    const queries = parseQueries();
    const source = url.searchParams.get("source");
    if (queries.length === 0 || (source !== "linkedin" && source !== "facebook")) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Required params: q, source=linkedin|facebook" }));
      return;
    }
    const count = Math.min(Number(url.searchParams.get("count") ?? 10), 50);

    try {
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
      res.end(JSON.stringify({ queries, source, count, items: deduped }, null, 2));
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