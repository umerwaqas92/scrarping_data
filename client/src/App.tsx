import { useEffect, useRef, useState } from "react";
import {
  getFeed,
  searchLinkedIn,
  getApifyBalances,
  getExtensionStatus,
  ApifyBalance,
} from "./api";
import FeedCard, {
  FeedItem,
  isTweet,
  isLinkedin,
  XIcon,
  RedditIcon,
  LinkedinIcon,
} from "./FeedCard";

type SourceKey = "x" | "reddit" | "linkedin";

const SOURCES: { key: SourceKey; label: string; icon: React.ReactNode }[] = [
  { key: "x", label: "X (Twitter)", icon: <XIcon size={12} /> },
  { key: "reddit", label: "Reddit", icon: <RedditIcon size={13} /> },
  { key: "linkedin", label: "LinkedIn", icon: <LinkedinIcon size={13} /> },
];

const SUGGESTIONS = [
  "React Native",
  "Claude Code",
  "AI Agents",
  "Next.js",
  "Node.js",
  "Python",
  "Flutter",
  "Mobile App",
  "UI/UX Design",
  "Tech Startup",
];

function itemSource(item: FeedItem): SourceKey {
  if (isTweet(item)) return "x";
  if (isLinkedin(item)) return "linkedin";
  return "reddit";
}

export default function App() {
  const [query, setQuery] = useState("React Native");
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
  const [linkedinMethod, setLinkedinMethod] = useState<string | null>(null);

  // Extension & Balance states
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [apifyBalances, setApifyBalances] = useState<ApifyBalance[]>([]);
  const [showBalanceDropdown, setShowBalanceDropdown] = useState(false);

  const cursors = useRef({ x: "", reddit: "" });
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const visibleItems = items.filter((item) => enabled[itemSource(item)]);

  // Count items per source
  const sourceCounts = items.reduce(
    (acc, item) => {
      const src = itemSource(item);
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    },
    { x: 0, reddit: 0, linkedin: 0 } as Record<SourceKey, number>,
  );

  // Check extension status and apify balance
  useEffect(() => {
    async function checkStatus() {
      try {
        const [ext, balances] = await Promise.all([
          getExtensionStatus().catch(() => ({ connected: false })),
          getApifyBalances().catch(() => []),
        ]);
        setExtensionConnected(Boolean(ext.connected));
        if (Array.isArray(balances)) {
          setApifyBalances(balances);
        }
      } catch (err) {
        console.error("Status check error", err);
      }
    }

    checkStatus();
    const timer = setInterval(checkStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    runSearch("React Native");
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
      setSearchedFor(res.queries?.join(", ") ?? q);
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

  async function handleSearchLinkedin() {
    if (!query.trim() || searchingLinkedin) return;
    setSearchingLinkedin(true);
    setError(null);
    try {
      const res = await searchLinkedIn(query, 15);
      const existing = new Set(items.map((i) => i.id));
      const newItems = res.items.filter((p) => !existing.has(p.id));
      setItems((prev) => [...newItems, ...prev]);
      setSearchedFor(res.queries?.join(", ") ?? query);
      setLinkedinMethod(res.method ?? (extensionConnected ? "chrome-extension" : "apify"));
      setEnabled((prev) => ({ ...prev, linkedin: true }));
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

  function toggleAll() {
    const allEnabled = Object.values(enabled).every(Boolean);
    setEnabled({
      x: !allEnabled,
      reddit: !allEnabled,
      linkedin: !allEnabled,
    });
  }

  // Calculate total apify balance
  const totalRemainingUsd = apifyBalances.reduce((acc, b) => acc + (b.remainingUsd || 0), 0);
  const totalMaxUsd = apifyBalances.reduce((acc, b) => acc + (b.maxMonthlyUsageUsd || 0), 0);

  return (
    <div className="app-container">
      {/* Sticky Header */}
      <header className="app-header">
        <div className="header-top">
          <div className="brand-badge">
            <div className="brand-logo">
              <span className="brand-dot" />
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <div className="brand-info">
              <h1 className="brand-title">MultiFeed Search</h1>
              <p className="brand-subtitle">Live cross-platform intelligence across X, Reddit & LinkedIn</p>
            </div>
          </div>

          {/* Header Utilities: Extension & Apify Balance Badges */}
          <div className="header-status-group">
            {/* Chrome Extension Status Pill */}
            <div
              className={`status-pill ${extensionConnected ? "pill-ext-online" : "pill-ext-offline"}`}
              title={
                extensionConnected
                  ? "Chrome Extension Connected ($0.00 Free LinkedIn scraping)"
                  : "Chrome Extension Offline (Using Apify fallback)"
              }
            >
              <span className={`status-indicator-dot ${extensionConnected ? "dot-online" : "dot-offline"}`} />
              <span className="pill-text">
                {extensionConnected ? "Extension: $0.00 Active" : "Extension: Offline"}
              </span>
            </div>

            {/* Apify Balance Pill with Dropdown */}
            {apifyBalances.length > 0 && (
              <div className="apify-balance-wrap">
                <button
                  type="button"
                  className="status-pill pill-balance"
                  onClick={() => setShowBalanceDropdown(!showBalanceDropdown)}
                  title="Click to view all Apify tokens"
                >
                  <span className="balance-icon">⚡</span>
                  <span className="pill-text">
                    Apify: ${totalRemainingUsd.toFixed(2)} / ${totalMaxUsd.toFixed(2)}
                  </span>
                </button>

                {showBalanceDropdown && (
                  <div className="balance-popover">
                    <div className="popover-header">
                      <span>Apify Token Balances</span>
                      <button
                        type="button"
                        className="popover-close"
                        onClick={() => setShowBalanceDropdown(false)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="tokens-list">
                      {apifyBalances.map((b) => (
                        <div key={b.key} className="token-item">
                          <div className="token-meta">
                            <span className="token-key">{b.key}</span>
                            <span className="token-user">{b.username}</span>
                          </div>
                          <div className="token-val">
                            <span className="token-rem">${b.remainingUsd.toFixed(2)} left</span>
                            <div className="token-bar-bg">
                              <div
                                className="token-bar-fill"
                                style={{ width: `${Math.min(100, b.percentRemaining)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Search Bar Form */}
        <form onSubmit={onSubmit} className="search-bar-form">
          <div className="search-input-wrapper">
            <svg className="search-input-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search topics, questions, hashtags across platforms..."
              aria-label="Search query"
            />
            {query && (
              <button
                type="button"
                className="clear-input-btn"
                onClick={() => setQuery("")}
                title="Clear input"
                aria-label="Clear search input"
              >
                ✕
              </button>
            )}
          </div>

          <div className="search-actions">
            <button type="submit" className="btn-search-primary" disabled={loading}>
              {loading ? (
                <>
                  <span className="btn-spinner" />
                  Searching…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  Search All
                </>
              )}
            </button>

            <button
              type="button"
              className={`btn-quick-source btn-linkedin-fetch ${extensionConnected ? "btn-linkedin-free" : ""}`}
              onClick={handleSearchLinkedin}
              disabled={searchingLinkedin}
              title={
                extensionConnected
                  ? "Scrape LinkedIn via Chrome Extension ($0.00)"
                  : "Scrape LinkedIn via Apify Cloud"
              }
            >
              <LinkedinIcon size={14} />
              {searchingLinkedin
                ? "Scraping…"
                : extensionConnected
                ? "+ LinkedIn ($0.00)"
                : "+ LinkedIn"}
            </button>
          </div>
        </form>

        {/* Suggestions Bar */}
        <div className="suggestions-container">
          <span className="suggestions-label">Popular:</span>
          <div className="suggestions-list">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={`suggestion-pill ${query.toLowerCase() === s.toLowerCase() ? "suggestion-active" : ""}`}
                onClick={() => {
                  setQuery(s);
                  runSearch(s);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Source Filter Toggles */}
        <div className="filters-bar">
          <span className="filters-label">Sources:</span>
          <div className="filters-toggles">
            {SOURCES.map(({ key, label, icon }) => {
              const isActive = enabled[key];
              const count = sourceCounts[key] || 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSource(key)}
                  className={`source-toggle-pill toggle-${key} ${isActive ? "is-active" : "is-inactive"}`}
                  aria-pressed={isActive}
                >
                  <span className="source-checkbox">
                    {isActive ? "✓" : ""}
                  </span>
                  <span className="source-icon">{icon}</span>
                  <span className="source-name">{label}</span>
                  {items.length > 0 && (
                    <span className="source-count">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="toggle-all-btn"
            onClick={toggleAll}
          >
            {Object.values(enabled).every(Boolean) ? "Deselect All" : "Select All"}
          </button>
        </div>
      </header>

      {/* Results Header Summary Bar (placed outside columns so it spans 100%) */}
      {searchedFor && (
        <div className="results-summary-bar">
          <div className="summary-left">
            <h2 className="summary-query">
              Results for <span className="query-highlight">“{searchedFor}”</span>
            </h2>
            <span className="summary-count-badge">
              {visibleItems.length} {visibleItems.length === 1 ? "post" : "posts"} found
            </span>
            {linkedinMethod && (
              <span className={`method-badge ${linkedinMethod === "chrome-extension" ? "method-free" : "method-apify"}`}>
                {linkedinMethod === "chrome-extension" ? "⚡ LinkedIn: $0.00 Extension" : "☁️ LinkedIn: Apify"}
              </span>
            )}
          </div>

          <div className="summary-breakdown">
            {enabled.x && sourceCounts.x > 0 && (
              <span className="breakdown-pill breakdown-x">
                <XIcon size={11} /> {sourceCounts.x} X
              </span>
            )}
            {enabled.reddit && sourceCounts.reddit > 0 && (
              <span className="breakdown-pill breakdown-reddit">
                <RedditIcon size={12} /> {sourceCounts.reddit} Reddit
              </span>
            )}
            {enabled.linkedin && sourceCounts.linkedin > 0 && (
              <span className="breakdown-pill breakdown-linkedin">
                <LinkedinIcon size={12} /> {sourceCounts.linkedin} LinkedIn
              </span>
            )}
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="error-card">
          <div className="error-icon">⚠️</div>
          <div className="error-content">
            <p className="error-title">Search request failed</p>
            <p className="error-desc">{error}</p>
          </div>
          <button
            type="button"
            className="error-retry-btn"
            onClick={() => runSearch(query)}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && visibleItems.length === 0 && (
        <div className="empty-state-card">
          <div className="empty-icon-wrap">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
              <path d="M8 11h6" />
            </svg>
          </div>
          <h3 className="empty-title">No matching posts found</h3>
          <p className="empty-subtitle">
            Try adjusting your search terms or toggling on all sources (X, Reddit, LinkedIn).
          </p>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && items.length === 0 && (
        <div className="results-masonry">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="feed-card skeleton-card">
              <div className="skeleton-header">
                <div className="skeleton-avatar skeleton-pulse" />
                <div className="skeleton-meta">
                  <div className="skeleton-line skeleton-line-title skeleton-pulse" />
                  <div className="skeleton-line skeleton-line-sub skeleton-pulse" />
                </div>
              </div>
              <div className="skeleton-line skeleton-line-body skeleton-pulse" />
              <div className="skeleton-line skeleton-line-body skeleton-pulse" style={{ width: "85%" }} />
              <div className="skeleton-line skeleton-line-body skeleton-pulse" style={{ width: "60%" }} />
              <div className="skeleton-footer skeleton-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Masonry Results Grid */}
      <main className="results-masonry">
        {visibleItems.map((item) => (
          <FeedCard key={item.id} item={item} />
        ))}
      </main>

      {/* Infinite Scroll / Load More Footer */}
      <div className="footer-sentinel-wrap">
        {loadingMore && (
          <div className="loading-more-pill">
            <span className="btn-spinner" />
            <span>Loading more posts…</span>
          </div>
        )}
        <div ref={sentinelRef} className="sentinel-anchor" />
      </div>
    </div>
  );
}