import { useEffect, useRef, useState } from "react";
import { getFeed, getApify, LinkedinProfile } from "./api";
import FeedCard, { FeedItem, isTweet } from "./FeedCard";

type SourceKey = "x" | "reddit" | "linkedin";

const SOURCES: { key: SourceKey; label: string }[] = [
  { key: "x", label: "X" },
  { key: "reddit", label: "Reddit" },
  { key: "linkedin", label: "LinkedIn" },
];

function itemSource(item: FeedItem): SourceKey {
  if (isTweet(item)) return "x";
  if (item.source === "linkedin") return "linkedin";
  return "reddit";
}

export default function App() {
  const [query, setQuery] = useState("image 2 app ui");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [enabled, setEnabled] = useState<Record<SourceKey, boolean>>({
    x: true,
    reddit: true,
    linkedin: true,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchingLinkedin, setSearchingLinkedin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState("");
  const cursors = useRef({ x: "", reddit: "" });
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const visibleItems = items.filter((item) => enabled[itemSource(item)]);

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

  async function searchLinkedin() {
    if (!query.trim() || searchingLinkedin) return;
    setSearchingLinkedin(true);
    setError(null);
    try {
      const res = await getApify<LinkedinProfile>("linkedin", query, 10);
      const existing = new Set(items.map((i) => i.id));
      const newItems = res.items.filter((p) => !existing.has(p.id));
      setItems((prev) => [...newItems, ...prev]);
      setSearchedFor(res.query);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchingLinkedin(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  function toggleSource(key: SourceKey) {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🐦 X + Reddit + LinkedIn</h1>
        <form onSubmit={onSubmit} className="search-form">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tweets + reddit + linkedin..."
            aria-label="Search query"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
          <button type="button" onClick={searchLinkedin} disabled={searchingLinkedin}>
            {searchingLinkedin ? "LinkedIn…" : "LinkedIn"}
          </button>
        </form>
        <div className="source-toggles">
          {SOURCES.map(({ key, label }) => (
            <label key={key} className={`source-toggle source-${key}`}>
              <input
                type="checkbox"
                checked={enabled[key]}
                onChange={() => toggleSource(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </header>

      <main className="results">
        {searchedFor && <p className="query-label">Results for “{searchedFor}”</p>}
        {error && <p className="error">{error}</p>}
        {!error && visibleItems.length === 0 && !loading && <p className="empty">No results yet.</p>}
        {visibleItems.map((item) => (
          <FeedCard key={item.id} item={item} />
        ))}
        {loadingMore && <p className="empty">Loading more…</p>}
        <div ref={sentinelRef} />
      </main>
    </div>
  );
}