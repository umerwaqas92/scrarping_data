import { useEffect, useRef, useState } from "react";
import { getFeed } from "./api";
import FeedCard, { FeedItem } from "./FeedCard";

export default function App() {
  const [query, setQuery] = useState("image 2 app ui");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState("");
  const cursors = useRef({ x: "", reddit: "" });
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    runSearch("image 2 app ui");
  }, []);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getFeed({ query: q });
      cursors.current = { x: res.xCursorNext ?? "", reddit: res.redditAfterNext ?? "" };
      const merged: FeedItem[] = [...res.tweets, ...res.posts];
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setItems(merged);
      setSearchedFor(res.query);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (loading || loadingMore) return;
    if (!cursors.current.x && !cursors.current.reddit) return;
    setLoadingMore(true);
    try {
      const res = await getFeed({
        query: searchedFor,
        xCursor: cursors.current.x || undefined,
        redditAfter: cursors.current.reddit || undefined,
      });
      cursors.current = { x: res.xCursorNext ?? "", reddit: res.redditAfterNext ?? "" };
      const merged: FeedItem[] = [...res.tweets, ...res.posts];
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id));
        return [...prev, ...merged.filter((i) => !ids.has(i.id))];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🐦 X + Reddit Search</h1>
        <form onSubmit={onSubmit} className="search-form">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tweets + reddit..."
            aria-label="Search query"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
      </header>

      <main className="results">
        {searchedFor && <p className="query-label">Results for “{searchedFor}”</p>}
        {error && <p className="error">{error}</p>}
        {!error && items.length === 0 && !loading && <p className="empty">No results yet.</p>}
        {items.map((item) => (
          <FeedCard key={item.id} item={item} />
        ))}
        {loadingMore && <p className="empty">Loading more…</p>}
        <div ref={sentinelRef} />
      </main>
    </div>
  );
}