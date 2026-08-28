import { useEffect, useState } from "react";
import { getFeed, FeedResponse } from "./api";
import FeedCard, { FeedItem } from "./FeedCard";

export default function App() {
  const [query, setQuery] = useState("image 2 app ui");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState("");

  useEffect(() => {
    runSearch("image 2 app ui");
  }, []);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res: FeedResponse = await getFeed(q);
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
      </main>
    </div>
  );
}