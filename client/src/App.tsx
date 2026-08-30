import { useEffect, useRef, useState } from "react";
import {
  getFeed,
  searchLinkedIn,
  searchFacebook,
  getApifyBalances,
  getExtensionStatus,
  generateProposal,
  ApifyBalance,
} from "./api";
import FeedCard, {
  FeedItem,
  isTweet,
  isLinkedin,
  isFacebook,
  XIcon,
  RedditIcon,
  LinkedinIcon,
  FacebookIcon,
  RefreshIcon,
  TrashIcon,
  getItemContacts,
  getItemJobHighlights,
} from "./FeedCard";
import ProfileModal from "./ProfileModal";
import ProposalDialog from "./ProposalDialog";


type SourceKey = "x" | "reddit" | "linkedin" | "facebook";

const SOURCES: { key: SourceKey; label: string; icon: React.ReactNode }[] = [
  { key: "x", label: "X (Twitter)", icon: <XIcon size={12} /> },
  { key: "reddit", label: "Reddit", icon: <RedditIcon size={13} /> },
  { key: "linkedin", label: "LinkedIn", icon: <LinkedinIcon size={13} /> },
  { key: "facebook", label: "Facebook", icon: <FacebookIcon size={13} /> },
];

const SUGGESTIONS = [
  "React Native",
  "@gmail.com",
  "Claude Code",
  "AI Agents",
  "contact email",
  "phone WhatsApp",
  "Next.js",
  "Python",
  "Flutter",
  "hiring contact",
];

function itemSource(item: FeedItem): SourceKey {
  if (isTweet(item)) return "x";
  if (isLinkedin(item)) return "linkedin";
  if (isFacebook(item)) return "facebook";
  return "reddit";
}

const STORAGE_KEYS = {
  QUERY: "multifeed_search_query",
  ENABLED_SOURCES: "multifeed_enabled_sources",
  THEME: "multifeed_theme",
  APPLIED_JOBS: "multifeed_applied_jobs",
  HIDE_APPLIED: "multifeed_hide_applied",
};

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.THEME);
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      return "light";
    }
    return "light";
  });
  const [query, setQuery] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.QUERY);
      return saved !== null ? saved : "React Native";
    } catch {
      return "React Native";
    }
  });
  const [items, setItems] = useState<FeedItem[]>([]);
  const [enabled, setEnabled] = useState<Record<SourceKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ENABLED_SOURCES);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          x: typeof parsed.x === "boolean" ? parsed.x : true,
          reddit: typeof parsed.reddit === "boolean" ? parsed.reddit : true,
          linkedin: typeof parsed.linkedin === "boolean" ? parsed.linkedin : true,
          facebook: typeof parsed.facebook === "boolean" ? parsed.facebook : true,
        };
      }
    } catch (e) {
      console.warn("Failed to parse saved enabled sources from localStorage", e);
    }
    return {
      x: true,
      reddit: true,
      linkedin: true,
      facebook: true,
    };
  });
  const [contactFilter, setContactFilter] = useState<"all" | "email" | "phone" | "any">("all");
  const [workModeFilter, setWorkModeFilter] = useState<"all" | "remote" | "onsite" | "hybrid" | "contract" | "rate">("all");
  const [copiedEmailsStatus, setCopiedEmailsStatus] = useState(false);
  const [copiedPhonesStatus, setCopiedPhonesStatus] = useState(false);

  // Persistent applied jobs tracker
  const [appliedJobs, setAppliedJobs] = useState<Record<string, { appliedAt: string; title?: string }>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.APPLIED_JOBS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to parse applied jobs from localStorage", e);
    }
    return {};
  });

  // Toggle to hide already applied jobs
  const [hideApplied, setHideApplied] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.HIDE_APPLIED);
      return saved === "true";
    } catch {
      return false;
    }
  });

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusSyncing, setStatusSyncing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(new Date());
  const [timeSinceRefresh, setTimeSinceRefresh] = useState<string>("just now");
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(0);

  const [loadingMore, setLoadingMore] = useState(false);
  const [searchingLinkedin, setSearchingLinkedin] = useState(false);
  const [searchingFacebook, setSearchingFacebook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState("");
  const [linkedinMethod, setLinkedinMethod] = useState<string | null>(null);
  const [facebookMethod, setFacebookMethod] = useState<string | null>(null);

  // Extension & Balance states
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [apifyBalances, setApifyBalances] = useState<ApifyBalance[]>([]);
  const [showBalanceDropdown, setShowBalanceDropdown] = useState(false);

  // Profile modal
  const [showProfile, setShowProfile] = useState(false);

  // Proposal dialog
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalText, setProposalText] = useState<string | null>(null);
  const [proposalSummary, setProposalSummary] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposalJobTitle, setProposalJobTitle] = useState<string | undefined>();
  const [proposalJobText, setProposalJobText] = useState<string>("");
  const [proposalJobUrl, setProposalJobUrl] = useState<string | undefined>();
  const [proposalDefaultEmail, setProposalDefaultEmail] = useState<string | undefined>();
  const [proposalJobId, setProposalJobId] = useState<string | undefined>();

  const toggleAppliedJob = (id: string, title?: string) => {
    setAppliedJobs((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = { appliedAt: new Date().toISOString(), title };
      }
      return next;
    });
  };

  async function handleWriteProposal(jobText: string, jobTitle?: string, jobUrl?: string, recipientEmail?: string, jobId?: string) {
    setProposalJobText(jobText);
    setProposalJobUrl(jobUrl);
    setProposalJobTitle(jobTitle);
    setProposalDefaultEmail(recipientEmail);
    setProposalJobId(jobId);
    setProposalText(null);
    setProposalSummary(null);
    setProposalError(null);
    setProposalOpen(true);
    setProposalLoading(true);
    try {
      const result = await generateProposal(jobText, jobTitle, jobUrl);
      setProposalText(result.proposal);
      setProposalSummary(result.summary);
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : "Failed to generate proposal");
    } finally {
      setProposalLoading(false);
    }
  }

  function handleRetryProposal() {
    handleWriteProposal(proposalJobText, proposalJobTitle, proposalJobUrl, proposalDefaultEmail, proposalJobId);
  }


  const cursors = useRef({ x: "", reddit: "" });
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Persist query to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.QUERY, query);
    } catch (e) {
      console.warn("Failed to save query to localStorage", e);
    }
  }, [query]);

  // Persist enabled sources to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ENABLED_SOURCES, JSON.stringify(enabled));
    } catch (e) {
      console.warn("Failed to save enabled sources to localStorage", e);
    }
  }, [enabled]);

  // Persist applied jobs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.APPLIED_JOBS, JSON.stringify(appliedJobs));
    } catch (e) {
      console.warn("Failed to save applied jobs to localStorage", e);
    }
  }, [appliedJobs]);

  // Persist hideApplied preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.HIDE_APPLIED, String(hideApplied));
    } catch (e) {
      console.warn("Failed to save hideApplied to localStorage", e);
    }
  }, [hideApplied]);

  // Sync theme mode to documentElement and localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch (e) {
      console.warn("Failed to save theme to localStorage", e);
    }
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Extracted contacts aggregation
  const allExtractedEmails = Array.from(
    new Set(items.flatMap((item) => getItemContacts(item).emails))
  );
  const allExtractedPhones = Array.from(
    new Set(items.flatMap((item) => getItemContacts(item).phones))
  );

  const itemsWithEmailCount = items.filter((item) => getItemContacts(item).emails.length > 0).length;
  const itemsWithPhoneCount = items.filter((item) => getItemContacts(item).phones.length > 0).length;
  const itemsWithAnyContactCount = items.filter((item) => {
    const c = getItemContacts(item);
    return c.emails.length > 0 || c.phones.length > 0;
  }).length;

  // Work Mode Counts
  const remoteCount = items.filter((item) => getItemJobHighlights(item).some((h) => h.type === "remote")).length;
  const onsiteCount = items.filter((item) => getItemJobHighlights(item).some((h) => h.type === "onsite")).length;
  const hybridCount = items.filter((item) => getItemJobHighlights(item).some((h) => h.type === "hybrid")).length;
  const contractCount = items.filter((item) => getItemJobHighlights(item).some((h) => h.type === "contract")).length;
  const rateCount = items.filter((item) => getItemJobHighlights(item).some((h) => h.type === "rate")).length;

  const totalAppliedInCurrentItems = items.filter((item) => Boolean(appliedJobs[item.id])).length;

  const visibleItems = items
    .filter((item) => enabled[itemSource(item)])
    .filter((item) => {
      if (hideApplied && appliedJobs[item.id]) return false;
      if (contactFilter !== "all") {
        const c = getItemContacts(item);
        if (contactFilter === "email" && c.emails.length === 0) return false;
        if (contactFilter === "phone" && c.phones.length === 0) return false;
        if (contactFilter === "any" && c.emails.length === 0 && c.phones.length === 0) return false;
      }
      if (workModeFilter !== "all") {
        const hl = getItemJobHighlights(item);
        if (workModeFilter === "remote" && !hl.some((h) => h.type === "remote")) return false;
        if (workModeFilter === "onsite" && !hl.some((h) => h.type === "onsite")) return false;
        if (workModeFilter === "hybrid" && !hl.some((h) => h.type === "hybrid")) return false;
        if (workModeFilter === "contract" && !hl.some((h) => h.type === "contract")) return false;
        if (workModeFilter === "rate" && !hl.some((h) => h.type === "rate")) return false;
      }
      return true;
    });

  // Count items per source
  const sourceCounts = items.reduce(
    (acc, item) => {
      const src = itemSource(item);
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    },
    { x: 0, reddit: 0, linkedin: 0, facebook: 0 } as Record<SourceKey, number>,
  );

  const handleCopyAllEmails = async () => {
    if (allExtractedEmails.length === 0) return;
    const text = allExtractedEmails.join("\n");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedEmailsStatus(true);
      setTimeout(() => setCopiedEmailsStatus(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCopyAllPhones = async () => {
    if (allExtractedPhones.length === 0) return;
    const text = allExtractedPhones.join("\n");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedPhonesStatus(true);
      setTimeout(() => setCopiedPhonesStatus(false), 2000);
    } catch {
      // Fallback
    }
  };

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

  async function handleSyncStatus() {
    if (statusSyncing) return;
    setStatusSyncing(true);
    await checkStatus();
    setTimeout(() => setStatusSyncing(false), 500);
  }

  // Check extension status and apify balance periodically
  useEffect(() => {
    checkStatus();
    const timer = setInterval(checkStatus, 3500);
    return () => clearInterval(timer);
  }, []);

  // Update relative time since last refresh
  useEffect(() => {
    if (!lastRefreshedAt) return;
    const updateTimer = () => {
      const sec = Math.max(0, Math.floor((Date.now() - lastRefreshedAt.getTime()) / 1000));
      if (sec < 8) {
        setTimeSinceRefresh("just now");
      } else if (sec < 60) {
        setTimeSinceRefresh(`${sec}s ago`);
      } else {
        const min = Math.floor(sec / 60);
        setTimeSinceRefresh(`${min}m ago`);
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 5000);
    return () => clearInterval(interval);
  }, [lastRefreshedAt]);

  // Handle auto-refresh interval
  useEffect(() => {
    if (autoRefreshSec <= 0) return;
    const timer = setInterval(() => {
      const q = query || searchedFor;
      if (q.trim() && !loading && !refreshing && !searchingLinkedin && !searchingFacebook) {
        handleRefresh(q);
      }
    }, autoRefreshSec * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshSec, query, searchedFor, enabled, loading, refreshing, searchingLinkedin, searchingFacebook]);

  useEffect(() => {
    if (query.trim()) {
      runSearch(query, enabled);
    }
  }, []);

  async function handleRefresh(customQuery?: string) {
    const targetQuery = customQuery || query || searchedFor;
    if (!targetQuery.trim() || loading || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        runSearch(targetQuery, enabled),
        checkStatus(),
      ]);
      setLastRefreshedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }

  async function runSearch(q: string, currentEnabled: Record<SourceKey, boolean> = enabled) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const promises: Promise<FeedItem[]>[] = [];

      // 1. Always query X & Reddit feed
      const feedPromise = getFeed({ query: q })
        .then((res) => {
          cursors.current = { x: res.xCursorNext ?? "", reddit: res.redditAfterNext ?? "" };
          return [...res.tweets, ...res.posts] as FeedItem[];
        })
        .catch((err) => {
          console.warn("Feed fetch error:", err);
          return [] as FeedItem[];
        });
      promises.push(feedPromise);

      // 2. Query LinkedIn if checked / enabled
      if (currentEnabled.linkedin) {
        const linkedinPromise = searchLinkedIn(q, 15)
          .then((res) => {
            setLinkedinMethod(res.method ?? (extensionConnected ? "chrome-extension" : "apify"));
            return (res.items || []) as FeedItem[];
          })
          .catch((err) => {
            console.warn("LinkedIn fetch error:", err);
            return [] as FeedItem[];
          });
        promises.push(linkedinPromise);
      }

      // 3. Query Facebook if checked / enabled
      if (currentEnabled.facebook) {
        const facebookPromise = searchFacebook(q, 15)
          .then((res) => {
            setFacebookMethod(res.method ?? (extensionConnected ? "chrome-extension" : "apify"));
            return (res.items || []) as FeedItem[];
          })
          .catch((err) => {
            console.warn("Facebook fetch error:", err);
            return [] as FeedItem[];
          });
        promises.push(facebookPromise);
      }

      const results = await Promise.all(promises);
      const merged: FeedItem[] = results.flat();

      // Deduplicate by ID
      const seenIds = new Set<string>();
      const deduped = merged.filter((item) => {
        if (!item.id || seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      });

      // Sort newest first
      deduped.sort((a, b) => {
        const timeA = new Date((a as any).postedAt || a.createdAt).getTime();
        const timeB = new Date((b as any).postedAt || b.createdAt).getTime();
        return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
      });

      setItems(deduped);
      setSearchedFor(q);
      setLastRefreshedAt(new Date());
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

  async function handleSearchLinkedin(customQuery?: string) {
    const q = customQuery || query || searchedFor;
    if (!q.trim() || searchingLinkedin) return;
    setSearchingLinkedin(true);
    setError(null);
    try {
      const res = await searchLinkedIn(q, 15);
      const existing = new Set(items.map((i) => i.id));
      const newItems = res.items.filter((p) => !existing.has(p.id));
      setItems((prev) => {
        const combined = [...newItems, ...prev];
        combined.sort((a, b) => {
          const timeA = new Date((a as any).postedAt || a.createdAt).getTime();
          const timeB = new Date((b as any).postedAt || b.createdAt).getTime();
          return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
        });
        return combined;
      });
      setSearchedFor(q);
      setLinkedinMethod(res.method ?? (extensionConnected ? "chrome-extension" : "apify"));
      setEnabled((prev) => ({ ...prev, linkedin: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchingLinkedin(false);
    }
  }

  async function handleSearchFacebook(customQuery?: string) {
    const q = customQuery || query || searchedFor;
    if (!q.trim() || searchingFacebook) return;
    setSearchingFacebook(true);
    setError(null);
    try {
      const res = await searchFacebook(q, 15);
      const existing = new Set(items.map((i) => i.id));
      const newItems = res.items.filter((p) => !existing.has(p.id));
      setItems((prev) => {
        const combined = [...newItems, ...prev];
        combined.sort((a, b) => {
          const timeA = new Date((a as any).postedAt || a.createdAt).getTime();
          const timeB = new Date((b as any).postedAt || b.createdAt).getTime();
          return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
        });
        return combined;
      });
      setSearchedFor(q);
      setFacebookMethod(res.method ?? (extensionConnected ? "chrome-extension" : "apify"));
      setEnabled((prev) => ({ ...prev, facebook: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchingFacebook(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  function toggleSource(key: SourceKey) {
    const nextVal = !enabled[key];
    setEnabled((prev) => ({ ...prev, [key]: nextVal }));

    // If enabling a source that has 0 items and we have an active search, fetch it automatically
    if (nextVal && (sourceCounts[key] || 0) === 0 && (searchedFor || query)) {
      const q = searchedFor || query;
      if (key === "linkedin") {
        handleSearchLinkedin(q);
      } else if (key === "facebook") {
        handleSearchFacebook(q);
      }
    }
  }

  function toggleAll() {
    const allEnabled = Object.values(enabled).every(Boolean);
    const nextState = !allEnabled;
    setEnabled({
      x: nextState,
      reddit: nextState,
      linkedin: nextState,
      facebook: nextState,
    });
  }

  function handleClearCards() {
    setItems([]);
    setSearchedFor("");
    cursors.current = { x: "", reddit: "" };
    setError(null);
    setLinkedinMethod(null);
    setFacebookMethod(null);
  }

  function handleDismissCard(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
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
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <div className="brand-info">
              <h1 className="brand-title">MultiFeed Search</h1>
              <p className="brand-subtitle">Live cross-platform intelligence across X, Reddit, LinkedIn & Facebook</p>
            </div>
          </div>

          {/* Header Utilities: Profile, Theme, Extension & Apify Balance Badges */}
          <div className="header-status-group">
            {/* Theme Toggle Button */}
            <button
              type="button"
              className="status-pill pill-theme-toggle"
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              title={`Switch to ${theme === "light" ? "Dark" : "Light"} mode`}
              aria-label={`Switch to ${theme === "light" ? "Dark" : "Light"} mode`}
            >
              <span>{theme === "light" ? "☀️" : "🌙"}</span>
              <span className="pill-text">{theme === "light" ? "Light Mode" : "Dark Mode"}</span>
            </button>

            {/* My Profile Button */}
            <button
              type="button"
              className="status-pill pill-profile-btn"
              onClick={() => setShowProfile(true)}
              title="Edit your freelancer profile (used for AI proposals)"
            >
              <span>👤</span>
              <span className="pill-text">My Profile</span>
            </button>

            {/* Sync / Refresh Status Pill */}
            <button
              type="button"
              className={`status-pill pill-sync-status ${statusSyncing ? "is-syncing" : ""}`}
              onClick={handleSyncStatus}
              title="Sync Chrome Extension connection & Apify balance"
            >
              <RefreshIcon size={11} className={statusSyncing ? "spin-icon" : ""} />
              <span className="pill-text">{statusSyncing ? "Syncing…" : "Sync Status"}</span>
            </button>

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
            <svg className="search-input-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
              autoComplete="off"
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
            <button type="submit" className="btn-search-primary" disabled={loading || refreshing}>
              {loading && !refreshing ? (
                <>
                  <span className="btn-spinner" />
                  Searching…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  Search All
                </>
              )}
            </button>

            <button
              type="button"
              className={`btn-quick-source btn-refresh-feed ${refreshing ? "is-refreshing" : ""}`}
              onClick={() => handleRefresh()}
              disabled={loading || refreshing || (!query.trim() && !searchedFor.trim())}
              title="Refresh feed with latest posts"
            >
              <RefreshIcon size={13} className={refreshing ? "spin-icon" : ""} />
              <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
            </button>

            <button
              type="button"
              className={`btn-quick-source btn-linkedin-fetch ${extensionConnected ? "btn-linkedin-free" : ""}`}
              onClick={() => handleSearchLinkedin()}
              disabled={searchingLinkedin}
              title={
                extensionConnected
                  ? "Scrape LinkedIn via Chrome Extension ($0.00)"
                  : "Scrape LinkedIn via Apify Cloud"
              }
            >
              <LinkedinIcon size={13} />
              {searchingLinkedin
                ? "Scraping…"
                : extensionConnected
                  ? "+ LinkedIn ($0.00)"
                  : "+ LinkedIn"}
            </button>

            <button
              type="button"
              className={`btn-quick-source btn-facebook-fetch ${extensionConnected ? "btn-facebook-free" : ""}`}
              onClick={() => handleSearchFacebook()}
              disabled={searchingFacebook}
              title={
                extensionConnected
                  ? "Scrape Facebook via Chrome Extension ($0.00)"
                  : "Scrape Facebook via Apify Cloud"
              }
            >
              <FacebookIcon size={13} />
              {searchingFacebook
                ? "Scraping…"
                : extensionConnected
                  ? "+ Facebook ($0.00)"
                  : "+ Facebook"}
            </button>

            <button
              type="button"
              className="btn-quick-source btn-clear-cards"
              onClick={handleClearCards}
              disabled={items.length === 0}
              title="Clear all cards"
              aria-label="Clear all cards"
            >
              <TrashIcon size={13} />
              <span>Clear Cards</span>
            </button>
          </div>
        </form>

        {/* Combined Secondary Controls Bar (Sources & Leads on Left, Popular on Right) */}
        <div className="header-controls-row">
          <div className="filters-bar">
            <div className="filters-group-left">
              <span className="controls-label">Sources:</span>
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

            {/* Lead / Contact Filters */}
            {items.length > 0 && (
              <div className="contact-filters-bar">
                <span className="controls-label">Leads:</span>
                <div className="contact-filter-pills">
                  <button
                    type="button"
                    className={`contact-filter-pill ${contactFilter === "all" ? "filter-active" : ""}`}
                    onClick={() => setContactFilter("all")}
                    title="Show all posts"
                  >
                    All ({items.length})
                  </button>
                  <button
                    type="button"
                    className={`contact-filter-pill ${contactFilter === "any" ? "filter-active" : ""}`}
                    onClick={() => setContactFilter(contactFilter === "any" ? "all" : "any")}
                    title="Filter posts containing either email or phone number"
                  >
                    <span className="pill-lead-icon">⚡</span>
                    <span>Any Lead</span>
                    <span className="contact-badge-num">{itemsWithAnyContactCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`contact-filter-pill filter-email ${contactFilter === "email" ? "filter-active" : ""}`}
                    onClick={() => setContactFilter(contactFilter === "email" ? "all" : "email")}
                    title="Filter posts containing email addresses"
                  >
                    <span className="pill-lead-icon">✉️</span>
                    <span>With Email</span>
                    <span className="contact-badge-num">{itemsWithEmailCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`contact-filter-pill filter-phone ${contactFilter === "phone" ? "filter-active" : ""}`}
                    onClick={() => setContactFilter(contactFilter === "phone" ? "all" : "phone")}
                    title="Filter posts containing phone numbers"
                  >
                    <span className="pill-lead-icon">📞</span>
                    <span>With Phone</span>
                    <span className="contact-badge-num">{itemsWithPhoneCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`contact-filter-pill filter-applied ${hideApplied ? "filter-active" : ""}`}
                    onClick={() => setHideApplied(!hideApplied)}
                    title={hideApplied ? "Currently hiding applied jobs. Click to show all posts." : "Click to hide jobs you already applied to."}
                  >
                    <span className="pill-lead-icon">{hideApplied ? "🚫" : "✓"}</span>
                    <span>{hideApplied ? "Applied Hidden" : "Hide Applied"}</span>
                    {totalAppliedInCurrentItems > 0 && (
                      <span className="contact-badge-num">{totalAppliedInCurrentItems}</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Work Mode & Keyword Filters */}
            {items.length > 0 && (remoteCount > 0 || onsiteCount > 0 || hybridCount > 0 || contractCount > 0 || rateCount > 0) && (
              <div className="contact-filters-bar work-mode-filters-bar">
                <span className="controls-label">Mode:</span>
                <div className="contact-filter-pills">
                  {remoteCount > 0 && (
                    <button
                      type="button"
                      className={`contact-filter-pill filter-work-remote ${workModeFilter === "remote" ? "filter-active" : ""}`}
                      onClick={() => setWorkModeFilter(workModeFilter === "remote" ? "all" : "remote")}
                      title="Filter remote & work-from-home jobs"
                    >
                      <span className="pill-lead-icon">🌐</span>
                      <span>Remote</span>
                      <span className="contact-badge-num">{remoteCount}</span>
                    </button>
                  )}
                  {onsiteCount > 0 && (
                    <button
                      type="button"
                      className={`contact-filter-pill filter-work-onsite ${workModeFilter === "onsite" ? "filter-active" : ""}`}
                      onClick={() => setWorkModeFilter(workModeFilter === "onsite" ? "all" : "onsite")}
                      title="Filter on-site positions"
                    >
                      <span className="pill-lead-icon">🏢</span>
                      <span>Onsite</span>
                      <span className="contact-badge-num">{onsiteCount}</span>
                    </button>
                  )}
                  {hybridCount > 0 && (
                    <button
                      type="button"
                      className={`contact-filter-pill filter-work-hybrid ${workModeFilter === "hybrid" ? "filter-active" : ""}`}
                      onClick={() => setWorkModeFilter(workModeFilter === "hybrid" ? "all" : "hybrid")}
                      title="Filter hybrid positions"
                    >
                      <span className="pill-lead-icon">🔄</span>
                      <span>Hybrid</span>
                      <span className="contact-badge-num">{hybridCount}</span>
                    </button>
                  )}
                  {contractCount > 0 && (
                    <button
                      type="button"
                      className={`contact-filter-pill filter-work-contract ${workModeFilter === "contract" ? "filter-active" : ""}`}
                      onClick={() => setWorkModeFilter(workModeFilter === "contract" ? "all" : "contract")}
                      title="Filter C2C, W2 & Contract positions"
                    >
                      <span className="pill-lead-icon">💼</span>
                      <span>C2C / Contract</span>
                      <span className="contact-badge-num">{contractCount}</span>
                    </button>
                  )}
                  {rateCount > 0 && (
                    <button
                      type="button"
                      className={`contact-filter-pill filter-work-rate ${workModeFilter === "rate" ? "filter-active" : ""}`}
                      onClick={() => setWorkModeFilter(workModeFilter === "rate" ? "all" : "rate")}
                      title="Filter positions with specified salary or hourly rate"
                    >
                      <span className="pill-lead-icon">💵</span>
                      <span>With Rate</span>
                      <span className="contact-badge-num">{rateCount}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="controls-divider" />

          {/* Suggestions Bar */}
          <div className="suggestions-container">
            <span className="controls-label">Popular:</span>
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
            {totalAppliedInCurrentItems > 0 && (
              <span className="applied-count-summary-badge" title="Number of jobs in current results you already marked as applied">
                ✓ {totalAppliedInCurrentItems} applied
              </span>
            )}
            {linkedinMethod && (
              <span className={`method-badge ${linkedinMethod === "chrome-extension" || linkedinMethod === "direct-cookies" ? "method-free" : "method-apify"}`}>
                {linkedinMethod === "direct-cookies"
                  ? "⚡ LinkedIn: $0.00 Direct Cookies"
                  : linkedinMethod === "chrome-extension"
                    ? "⚡ LinkedIn: $0.00 Extension"
                    : "☁️ LinkedIn: Apify"}
              </span>
            )}
            {facebookMethod && (
              <span className={`method-badge ${facebookMethod === "chrome-extension" ? "method-free" : "method-apify"}`}>
                {facebookMethod === "chrome-extension" ? "⚡ Facebook: $0.00 Extension" : "☁️ Facebook: Apify"}
              </span>
            )}

            {/* Bulk Copy Leads Actions */}
            {(allExtractedEmails.length > 0 || allExtractedPhones.length > 0) && (
              <div className="leads-quick-copy-group">
                {allExtractedEmails.length > 0 && (
                  <button
                    type="button"
                    className={`btn-bulk-copy btn-bulk-email ${copiedEmailsStatus ? "is-copied" : ""}`}
                    onClick={handleCopyAllEmails}
                    title="Copy all extracted emails"
                  >
                    <span>✉️</span>
                    <span>
                      {copiedEmailsStatus
                        ? `Copied ${allExtractedEmails.length} Email${allExtractedEmails.length > 1 ? "s" : ""}!`
                        : `Copy ${allExtractedEmails.length} Email${allExtractedEmails.length > 1 ? "s" : ""}`}
                    </span>
                  </button>
                )}
                {allExtractedPhones.length > 0 && (
                  <button
                    type="button"
                    className={`btn-bulk-copy btn-bulk-phone ${copiedPhonesStatus ? "is-copied" : ""}`}
                    onClick={handleCopyAllPhones}
                    title="Copy all extracted phone numbers"
                  >
                    <span>📞</span>
                    <span>
                      {copiedPhonesStatus
                        ? `Copied ${allExtractedPhones.length} Phone${allExtractedPhones.length > 1 ? "s" : ""}!`
                        : `Copy ${allExtractedPhones.length} Phone${allExtractedPhones.length > 1 ? "s" : ""}`}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="summary-right">
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
              {enabled.facebook && sourceCounts.facebook > 0 && (
                <span className="breakdown-pill breakdown-facebook">
                  <FacebookIcon size={12} /> {sourceCounts.facebook} Facebook
                </span>
              )}
            </div>

            <div className="summary-refresh-controls">
              <span className="summary-updated-tag" title={lastRefreshedAt ? `Last refreshed: ${lastRefreshedAt.toLocaleTimeString()}` : ""}>
                <span className={`live-pulse-dot ${refreshing ? "dot-pulsing" : ""}`} />
                Updated {timeSinceRefresh}
              </span>

              <button
                type="button"
                className={`btn-summary-refresh ${refreshing ? "is-refreshing" : ""}`}
                onClick={() => handleRefresh()}
                disabled={loading || refreshing}
                title="Refresh current results"
              >
                <RefreshIcon size={13} className={refreshing ? "spin-icon" : ""} />
                <span>Refresh</span>
              </button>

              <button
                type="button"
                className="btn-summary-clear"
                onClick={handleClearCards}
                title="Clear all cards"
                aria-label="Clear all cards"
              >
                <TrashIcon size={12} />
                <span>Clear All</span>
              </button>

              <div className="auto-refresh-wrap" title="Auto-refresh interval">
                <span className="auto-refresh-label">Auto:</span>
                <select
                  className={`auto-refresh-select ${autoRefreshSec > 0 ? "select-active" : ""}`}
                  value={autoRefreshSec}
                  onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
                  aria-label="Auto refresh interval"
                >
                  <option value={0}>Off</option>
                  <option value={30}>30s</option>
                  <option value={60}>1m</option>
                  <option value={120}>2m</option>
                  <option value={300}>5m</option>
                </select>
              </div>
            </div>
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
            onClick={() => handleRefresh()}
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
          <h3 className="empty-title">{searchedFor ? "No matching posts found" : "Cards cleared"}</h3>
          <p className="empty-subtitle">
            {searchedFor
              ? "Try adjusting your search terms, toggling on all sources, or refreshing the feed."
              : "Search for a keyword above or click a popular topic to load posts."}
          </p>
          <button
            type="button"
            className="empty-refresh-btn"
            onClick={() => handleRefresh()}
            disabled={refreshing || loading || (!query.trim() && !searchedFor.trim())}
          >
            <RefreshIcon size={14} className={refreshing ? "spin-icon" : ""} />
            <span>{refreshing ? "Refreshing…" : "Load Feed"}</span>
          </button>
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
          <FeedCard
            key={item.id}
            item={item}
            isApplied={Boolean(appliedJobs[item.id])}
            onToggleApplied={toggleAppliedJob}
            onDismiss={handleDismissCard}
            onWriteProposal={handleWriteProposal}
          />
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

      {/* Profile Modal */}
      <ProfileModal open={showProfile} onClose={() => setShowProfile(false)} />

      {/* Proposal Dialog */}
      <ProposalDialog
        open={proposalOpen}
        proposal={proposalText}
        summary={proposalSummary}
        loading={proposalLoading}
        error={proposalError}
        jobTitle={proposalJobTitle}
        defaultEmail={proposalDefaultEmail}
        jobId={proposalJobId}
        isApplied={proposalJobId ? Boolean(appliedJobs[proposalJobId]) : false}
        onClose={() => setProposalOpen(false)}
        onRetry={handleRetryProposal}
        onToggleApplied={toggleAppliedJob}
      />
    </div>
  );
}