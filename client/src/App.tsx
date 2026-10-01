import { useEffect, useRef, useState } from "react";
import {
  getFeed,
  searchLinkedIn,
  // searchFacebook,
  getExtensionStatus,
  generateProposal,
  getProfile,
  saveProfile,
  getAppliedJobs,
  saveAppliedJobApi,
  deleteAppliedJobApi,
  getApifyBalances,
  ApifyBalance,
  AppliedJob,
} from "./api";
import FeedCard, {
  FeedItem,
  isTweet,
  isLinkedin,
  isFacebook,
  // XIcon,
  RedditIcon,
  LinkedinIcon,
  // FacebookIcon,
  RefreshIcon,
  TrashIcon,
  getItemContacts,
  getItemJobHighlights,
  getItemMeta,
} from "./FeedCard";
import ProfileModal, { DEFAULT_SEARCH_QUERIES } from "./ProfileModal";
import { useAuth } from "./AuthContext";
import CookieManagerModal from "./CookieManagerModal";
import ApifyKeysModal from "./ApifyKeysModal";
import ProposalDialog from "./ProposalDialog";
import BulkEmailModal from "./BulkEmailModal";


type SourceKey = "x" | "reddit" | "linkedin" | "facebook";

const SOURCES: { key: SourceKey; label: string; icon: React.ReactNode }[] = [
  // X & Facebook are disabled for now — hide their pills (easy re-enable).
  // { key: "x", label: "X (Twitter)", icon: <XIcon size={12} /> },
  { key: "reddit", label: "Reddit", icon: <RedditIcon size={13} /> },
  { key: "linkedin", label: "LinkedIn", icon: <LinkedinIcon size={13} /> },
  // { key: "facebook", label: "Facebook", icon: <FacebookIcon size={13} /> },
];


function itemSource(item: FeedItem): SourceKey {
  if (isTweet(item)) return "x";
  if (isLinkedin(item)) return "linkedin";
  if (isFacebook(item)) return "facebook";
  return "reddit";
}

/** A persisted applied-job record (mirrors the /applied API row). */
interface AppliedRecord {
  appliedAt: string;
  updatedAt?: string;
  title?: string;
  url?: string;
  source?: string;
  author?: string;
  content?: string;
  proposal?: string;
  note?: string;
  item?: FeedItem;
}

function parseStoredItem(raw?: string): FeedItem | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as FeedItem;
  } catch {
    return undefined;
  }
}

/** Map an /applied API row into the client-side applied record shape. */
function applyRowToRecord(job: AppliedJob): AppliedRecord {
  return {
    appliedAt: job.applied_at,
    updatedAt: job.updated_at || undefined,
    title: job.title || undefined,
    url: job.url || undefined,
    source: job.source || undefined,
    author: job.author || undefined,
    content: job.content || undefined,
    proposal: job.proposal || undefined,
    note: job.note || undefined,
    item: parseStoredItem(job.item),
  };
}

const STORAGE_KEYS = {
  QUERY: "multifeed_search_query",
  SAVED_QUERIES: "multifeed_saved_queries",
  ENABLED_SOURCES: "multifeed_enabled_sources",
  THEME: "multifeed_theme",
  APPLIED_JOBS: "multifeed_applied_jobs",
  HIDE_APPLIED: "multifeed_hide_applied",
  AUTO_REFRESH: "multifeed_auto_refresh",
  ITEMS: "multifeed_feed_items",
};

// Cap how many cards we persist so we stay well under the localStorage quota.
const MAX_STORED_ITEMS = 300;

export default function App() {
  const { user, signOutUser } = useAuth();
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
  const [savedQueries, setSavedQueries] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SAVED_QUERIES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn("Failed to parse saved queries from localStorage", e);
    }
    return DEFAULT_SEARCH_QUERIES;
  });
  const [profileModalTab, setProfileModalTab] = useState<"queries" | "profile">("queries");
  const [savedQuerySuccess, setSavedQuerySuccess] = useState(false);
  const [items, setItems] = useState<FeedItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ITEMS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed as FeedItem[];
      }
    } catch (e) {
      console.warn("Failed to parse stored feed items from localStorage", e);
    }
    return [];
  });
  const [enabled, setEnabled] = useState<Record<SourceKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ENABLED_SOURCES);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          // X & Facebook are disabled for now (kept in state for easy re-enable).
          x: typeof parsed.x === "boolean" ? parsed.x : false,
          reddit: typeof parsed.reddit === "boolean" ? parsed.reddit : true,
          linkedin: typeof parsed.linkedin === "boolean" ? parsed.linkedin : true,
          facebook: typeof parsed.facebook === "boolean" ? parsed.facebook : false,
        };
      }
    } catch (e) {
      console.warn("Failed to parse saved enabled sources from localStorage", e);
    }
    return {
      // X & Facebook are disabled for now (kept in state for easy re-enable).
      x: false,
      reddit: true,
      linkedin: true,
      facebook: false,
    };
  });
  const [contactFilter, setContactFilter] = useState<"all" | "email" | "phone" | "any">("all");
  const [workModeFilter, setWorkModeFilter] = useState<"all" | "remote" | "onsite" | "hybrid" | "contract" | "rate">("all");
  const [copiedEmailsStatus, setCopiedEmailsStatus] = useState(false);
  const [copiedPhonesStatus, setCopiedPhonesStatus] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkEmailModal, setShowBulkEmailModal] = useState(false);

  // Persistent applied jobs tracker
  const [appliedJobs, setAppliedJobs] = useState<Record<string, AppliedRecord>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.APPLIED_JOBS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to parse applied jobs from localStorage", e);
    }
    return {};
  });

  // Drafts for the applied-job note editor
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

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
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.AUTO_REFRESH);
      return saved ? Number(saved) : 0;
    } catch {
      return 0;
    }
  });

  const [loadingMore, setLoadingMore] = useState(false);
  const [searchingLinkedin, setSearchingLinkedin] = useState(false);
  // Facebook disabled for now (setter kept for easy re-enable).
  const [searchingFacebook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState("");
  const [linkedinMethod, setLinkedinMethod] = useState<string | null>(null);
  // Facebook disabled for now.
  const [, setFacebookMethod] = useState<string | null>(null);

  // Extension & Balance states
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [apifyBalances, setApifyBalances] = useState<ApifyBalance[]>([]);
  const [showBalanceDropdown, setShowBalanceDropdown] = useState(false);

  // Profile modal
  const [showProfile, setShowProfile] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [showApifyKeys, setShowApifyKeys] = useState(false);

  // Mobile bottom navigation
  const [mobileTab, setMobileTab] = useState<"posts" | "applied" | "profile">("posts");
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 640px)").matches;
  });
  const appliedTabActive = isMobileViewport && mobileTab === "applied";

  // Proposal dialog
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalText, setProposalText] = useState<string | null>(null);
  const [proposalSummary, setProposalSummary] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposalRetry, setProposalRetry] = useState<string | null>(null);
  const [proposalJobTitle, setProposalJobTitle] = useState<string | undefined>();
  const [proposalJobText, setProposalJobText] = useState<string>("");
  const [proposalJobUrl, setProposalJobUrl] = useState<string | undefined>();
  const [proposalDefaultEmail, setProposalDefaultEmail] = useState<string | undefined>();
  const [proposalRecipientPhone, setProposalRecipientPhone] = useState<string | undefined>();
  const [proposalJobId, setProposalJobId] = useState<string | undefined>();

  // Saved applied-proposal viewer
  const [viewProposalOpen, setViewProposalOpen] = useState(false);
  const [viewProposalText, setViewProposalText] = useState("");
  const [viewProposalTitle, setViewProposalTitle] = useState<string | undefined>();

  const openViewProposal = (proposal: string, title?: string) => {
    setViewProposalText(proposal);
    setViewProposalTitle(title);
    setViewProposalOpen(true);
  };

  const toggleAppliedJob = (id: string, title?: string, extras?: Partial<AppliedRecord>) => {
    if (appliedJobs[id]) {
      // Unmark
      setAppliedJobs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      deleteAppliedJobApi(id).catch((e) =>
        console.warn("Failed to delete applied job from DB", e),
      );
    } else {
      // Mark as applied — snapshot everything we know about the post.
      const appliedAt = new Date().toISOString();
      const fullItem = items.find((it) => it.id === id);
      const meta = fullItem ? getItemMeta(fullItem) : undefined;
      const fromProposal = id === proposalJobId;
      const record: AppliedRecord = {
        appliedAt,
        updatedAt: appliedAt,
        title: title || (fromProposal ? proposalJobTitle : "") || meta?.title || "",
        url: (fromProposal ? proposalJobUrl : "") || meta?.url || "",
        source: meta?.source || "",
        author: meta?.author || "",
        content: (fromProposal ? proposalJobText : "") || meta?.content || "",
        proposal: fromProposal ? proposalText || "" : "",
        note: "",
        item: fullItem,
        ...extras,
      };
      setAppliedJobs((prev) => ({ ...prev, [id]: record }));
      saveAppliedJobApi({
        id,
        title: record.title,
        url: record.url,
        source: record.source,
        author: record.author,
        content: record.content,
        proposal: record.proposal,
        note: record.note,
        item: record.item,
        appliedAt,
      }).catch((e) => console.warn("Failed to save applied job to DB", e));
    }
  };

  /** Update an existing applied-job record (note, proposal, url…) and persist it. */
  const updateAppliedJob = (id: string, patch: Partial<AppliedRecord>) => {
    const existing = appliedJobs[id];
    if (!existing) return;
    const merged: AppliedRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    setAppliedJobs((prev) => ({ ...prev, [id]: merged }));
    saveAppliedJobApi({
      id,
      title: merged.title,
      url: merged.url,
      source: merged.source,
      author: merged.author,
      content: merged.content,
      proposal: merged.proposal,
      note: merged.note,
      item: merged.item,
      appliedAt: merged.appliedAt,
    }).catch((e) => console.warn("Failed to update applied job in DB", e));
  };

  async function handleWriteProposal(jobText: string, jobTitle?: string, jobUrl?: string, recipientEmail?: string, jobId?: string, recipientPhone?: string) {
    setProposalJobText(jobText);
    setProposalJobUrl(jobUrl);
    setProposalJobTitle(jobTitle);
    setProposalDefaultEmail(recipientEmail);
    setProposalRecipientPhone(recipientPhone);
    setProposalJobId(jobId);
    setProposalText(null);
    setProposalSummary(null);
    setProposalError(null);
    setProposalRetry(null);
    setProposalOpen(true);
    setProposalLoading(true);
    try {
      const result = await generateProposal(jobText, jobTitle, jobUrl, (attempt, maxAttempts) => {
        setProposalRetry(`Retrying… attempt ${attempt} of ${maxAttempts}`);
      });
      setProposalText(result.proposal);
      setProposalSummary(result.summary);
      // If this job is already marked applied, save the generated proposal.
      if (jobId && appliedJobs[jobId]) {
        updateAppliedJob(jobId, {
          proposal: result.proposal,
          url: jobUrl || appliedJobs[jobId].url,
          title: jobTitle || appliedJobs[jobId].title,
          content: jobText || appliedJobs[jobId].content,
        });
      }
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : "Failed to generate proposal");
    } finally {
      setProposalRetry(null);
      setProposalLoading(false);
    }
  }

  function handleRetryProposal() {
    handleWriteProposal(proposalJobText, proposalJobTitle, proposalJobUrl, proposalDefaultEmail, proposalJobId, proposalRecipientPhone);
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

  // Sync profile & saved queries from backend database on mount
  useEffect(() => {
    getProfile()
      .then((data) => {
        if (Array.isArray(data.queries) && data.queries.length > 0) {
          setSavedQueries(data.queries);
          try {
            localStorage.setItem(STORAGE_KEYS.SAVED_QUERIES, JSON.stringify(data.queries));
          } catch {}
        }
      })
      .catch((err) => console.warn("Failed to sync profile queries from backend DB", err));
  }, []);

  async function handleQuickSaveQuery(qToSave?: string) {
    const target = (qToSave || query).trim();
    if (!target) return;
    if (savedQueries.some((sq) => sq.toLowerCase() === target.toLowerCase())) return;
    const updated = [...savedQueries, target];
    setSavedQueries(updated);
    setSavedQuerySuccess(true);
    setTimeout(() => setSavedQuerySuccess(false), 2000);
    try {
      localStorage.setItem(STORAGE_KEYS.SAVED_QUERIES, JSON.stringify(updated));
      const currentProfile = await getProfile().catch(() => ({ content: "", queries: [], updated_at: null }));
      await saveProfile(currentProfile.content, updated);
    } catch (e) {
      console.warn("Failed to persist saved query", e);
    }
  }

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

  // Load applied jobs from the database on mount, migrating any
  // localStorage-only entries into the DB (one-time migration).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const serverJobs = await getAppliedJobs();
        if (cancelled) return;

        const serverMap: Record<string, AppliedRecord> = {};
        for (const job of serverJobs) {
          serverMap[job.id] = applyRowToRecord(job);
        }

        // Read local cache and migrate entries the DB doesn't have yet.
        let localMap: Record<string, AppliedRecord> = {};
        try {
          const raw = localStorage.getItem(STORAGE_KEYS.APPLIED_JOBS);
          if (raw) localMap = JSON.parse(raw) ?? {};
        } catch {
          localMap = {};
        }

        const localOnly = Object.entries(localMap).filter(([id]) => !serverMap[id]);
        for (const [id, val] of localOnly) {
          saveAppliedJobApi({
            id,
            title: val?.title,
            url: val?.url,
            source: val?.source,
            author: val?.author,
            content: val?.content,
            proposal: val?.proposal,
            note: val?.note,
            item: val?.item,
            appliedAt: val?.appliedAt,
          }).catch(() => undefined);
        }

        const merged: Record<string, AppliedRecord> = { ...serverMap };
        for (const [id, val] of localOnly) merged[id] = val;

        if (!cancelled) setAppliedJobs(merged);
      } catch (e) {
        console.warn("Failed to load applied jobs from DB", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh applied jobs from the API whenever the Applied tab is opened.
  useEffect(() => {
    if (!appliedTabActive) return;
    let cancelled = false;
    getAppliedJobs()
      .then((jobs) => {
        if (cancelled) return;
        setAppliedJobs((prev) => {
          const next = { ...prev };
          for (const job of jobs) {
            const record = applyRowToRecord(job);
            next[job.id] = { ...record, item: record.item ?? prev[job.id]?.item };
          }
          return next;
        });
      })
      .catch((err) => console.warn("Failed to refresh applied jobs", err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedTabActive]);

  // Persist the feed cards to localStorage so they survive a page reload
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items.slice(0, MAX_STORED_ITEMS)));
    } catch (e) {
      // Likely quota exceeded — retry storing a smaller slice.
      try {
        localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items.slice(0, 100)));
      } catch {
        console.warn("Failed to save feed items to localStorage", e);
      }
    }
  }, [items]);

  // Persist hideApplied preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.HIDE_APPLIED, String(hideApplied));
    } catch (e) {
      console.warn("Failed to save hideApplied to localStorage", e);
    }
  }, [hideApplied]);

  // Persist autoRefreshSec preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.AUTO_REFRESH, String(autoRefreshSec));
    } catch (e) {
      console.warn("Failed to save autoRefreshSec to localStorage", e);
    }
  }, [autoRefreshSec]);

  // Sync theme mode to documentElement and localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch (e) {
      console.warn("Failed to save theme to localStorage", e);
    }
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Track small-viewport state for the mobile bottom navigation
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  // The Applied tab is a standalone view driven by the applied-jobs store
  // (loaded from the /applied API), not the current search results.
  const appliedList = Object.entries(appliedJobs)
    .map(([id, meta]) => ({
      id,
      title: meta.title,
      url: meta.url,
      source: meta.source,
      author: meta.author,
      proposal: meta.proposal,
      note: meta.note,
      appliedAt: meta.appliedAt,
      item: meta.item ?? items.find((it) => it.id === id),
    }))
    .sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : -1));

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

  // On small screens the bottom nav can narrow the feed to applied posts only.
  const displayedItems = appliedTabActive
    ? appliedList.filter((entry) => Boolean(entry.item)).map((entry) => entry.item as FeedItem)
    : visibleItems;

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

  // Bulk Selection Handlers
  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllWithEmails = () => {
    const idsWithEmails = displayedItems
      .filter((it) => getItemContacts(it).emails.length > 0)
      .map((it) => it.id);
    setSelectedIds(new Set(idsWithEmails));
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(displayedItems.map((it) => it.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Calculated selected items and their emails
  const selectedItems = items.filter((it) => selectedIds.has(it.id));
  const selectedEmailsCount = new Set(
    selectedItems.flatMap((it) => getItemContacts(it).emails)
  ).size;

  async function checkStatus() {
    try {
      const ext = await getExtensionStatus().catch(() => ({ connected: false }));
      setExtensionConnected(Boolean(ext.connected));
    } catch (err) {
      console.error("Status check error", err);
    }
  }

  async function loadApifyBalances() {
    try {
      const balances = await getApifyBalances().catch(() => []);
      if (Array.isArray(balances)) setApifyBalances(balances);
    } catch (err) {
      console.error("Apify balance fetch error", err);
    }
  }

  async function handleSyncStatus() {
    if (statusSyncing) return;
    setStatusSyncing(true);
    await Promise.all([checkStatus(), loadApifyBalances()]);
    setTimeout(() => setStatusSyncing(false), 500);
  }

  // Check extension status periodically (every 30 seconds); balances on mount + manual sync only
  useEffect(() => {
    checkStatus();
    loadApifyBalances();
    const timer = setInterval(checkStatus, 30000);
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

  // NOTE: no auto-search on load — the user must click Search / Refresh first.

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

      // 1. Reddit feed (X is disabled for now in the API — see src/app.ts /feed).
      if (currentEnabled.reddit) {
        const feedPromise = getFeed({ query: q, sources: ["reddit"] })
          .then((res) => {
            cursors.current = { x: res.xCursorNext ?? "", reddit: res.redditAfterNext ?? "" };
            return [...res.posts] as FeedItem[];
          })
          .catch((err) => {
            console.warn("Feed fetch error:", err);
            return [] as FeedItem[];
          });
        promises.push(feedPromise);
      }

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

      // 3. Facebook is disabled for now (kept commented for easy re-enable).
      // if (currentEnabled.facebook) {
      //   const facebookPromise = searchFacebook(q, 15)
      //     .then((res) => {
      //       setFacebookMethod(res.method ?? (extensionConnected ? "chrome-extension" : "apify"));
      //       return (res.items || []) as FeedItem[];
      //     })
      //     .catch((err) => {
      //       console.warn("Facebook fetch error:", err);
      //       return [] as FeedItem[];
      //     });
      //   promises.push(facebookPromise);
      // }

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
        sources: ["reddit"],
      });
      cursors.current = { x: res.xCursorNext ?? "", reddit: res.redditAfterNext ?? "" };
      const merged: FeedItem[] = [...res.posts];
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

  // Facebook disabled for now.
  // async function handleSearchFacebook(customQuery?: string) {
  //   const q = customQuery || query || searchedFor;
  //   if (!q.trim() || searchingFacebook) return;
  //   setSearchingFacebook(true);
  //   setError(null);
  //   try {
  //     const res = await searchFacebook(q, 15);
  //     const existing = new Set(items.map((i) => i.id));
  //     const newItems = res.items.filter((p) => !existing.has(p.id));
  //     setItems((prev) => {
  //       const combined = [...newItems, ...prev];
  //       combined.sort((a, b) => {
  //         const timeA = new Date((a as any).postedAt || a.createdAt).getTime();
  //         const timeB = new Date((b as any).postedAt || b.createdAt).getTime();
  //         return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
  //       });
  //       return combined;
  //     });
  //     setSearchedFor(q);
  //     setFacebookMethod(res.method ?? (extensionConnected ? "chrome-extension" : "apify"));
  //     setEnabled((prev) => ({ ...prev, facebook: true }));
  //   } catch (err) {
  //     setError(err instanceof Error ? err.message : String(err));
  //   } finally {
  //     setSearchingFacebook(false);
  //   }
  // }

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
      }
      // Facebook disabled for now.
      // else if (key === "facebook") {
      //   handleSearchFacebook(q);
      // }
    }
  }

  function toggleAll() {
    // Only Reddit & LinkedIn are active for now (X & Facebook disabled).
    const nextState = !(enabled.reddit && enabled.linkedin);
    setEnabled({
      x: false,
      reddit: nextState,
      linkedin: nextState,
      facebook: false,
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

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  // Shared details panel (link, saved proposal, editable note) for an applied job.
  function renderAppliedDetails(entry: (typeof appliedList)[number]) {
    const saved = entry.note ?? "";
    const draft = noteDrafts[entry.id] ?? saved;
    const dirty = draft !== saved;
    return (
      <div className="applied-details">
        {entry.url && (
          <a className="applied-detail-link" href={entry.url} target="_blank" rel="noreferrer noopener" title={entry.url}>
            🔗 {entry.url.replace(/^https?:\/\//, "").slice(0, 64)}
          </a>
        )}

        {entry.proposal && (
          <button
            type="button"
            className="applied-view-proposal-btn"
            onClick={() => openViewProposal(entry.proposal || "", entry.title)}
          >
            📄 View Applied Proposal
          </button>
        )}

        <div className="applied-note-row">
          <textarea
            className="applied-note-input"
            value={draft}
            placeholder="Add a note (recruiter, follow-up date…)"
            onChange={(e) => setNoteDrafts((p) => ({ ...p, [entry.id]: e.target.value }))}
          />
          <button
            type="button"
            className="applied-note-save"
            disabled={!dirty}
            onClick={() => {
              updateAppliedJob(entry.id, { note: draft });
              setNoteDrafts((p) => {
                const next = { ...p };
                delete next[entry.id];
                return next;
              });
            }}
          >
            Save note
          </button>
        </div>
      </div>
    );
  }

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
              <p className="brand-subtitle">Live cross-platform intelligence across Reddit & LinkedIn</p>
            </div>
          </div>

          {/* Header Utilities: Profile, Theme, Extension & Apify Balance Badges */}
          <div className="header-status-group">
            {/* Signed-in user */}
            {user && (
              <div className="status-pill pill-user-chip" title={user.email ?? ""}>
                {user.photoURL ? (
                  <img className="user-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="user-avatar user-avatar-fallback">
                    {(user.displayName || user.email || "U")[0]?.toUpperCase()}
                  </span>
                )}
                <span className="pill-text">{user.displayName || user.email}</span>
                <button
                  type="button"
                  className="user-signout-btn"
                  onClick={() => signOutUser()}
                  title="Sign out"
                >
                  Sign out
                </button>
              </div>
            )}
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
              onClick={() => {
                setProfileModalTab("profile");
                setShowProfile(true);
              }}
              title="Edit your freelancer profile & saved queries"
            >
              <span>👤</span>
              <span className="pill-text">My Profile</span>
            </button>

            {/* Cookie Manager Button */}
            <button
              type="button"
              className="status-pill pill-cookies-btn"
              onClick={() => setShowCookies(true)}
              title="Manage LinkedIn / Reddit session cookies"
            >
              <span>🍪</span>
              <span className="pill-text">Cookies</span>
            </button>

            {/* Apify Keys Button */}
            <button
              type="button"
              className="status-pill pill-apify-keys-btn"
              onClick={() => setShowApifyKeys(true)}
              title="Add or remove Apify API keys (stored in the database)"
            >
              <span>⚡</span>
              <span className="pill-text">Apify Keys</span>
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
                    <div className="balance-popover-footer">
                      <button
                        type="button"
                        className="balance-manage-btn"
                        onClick={() => { setShowApifyKeys(true); setShowBalanceDropdown(false); }}
                      >
                        ⚙ Manage keys
                      </button>
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
              placeholder="Search topics, hashtags, roles… (comma-separate for multiple, e.g. Flutter, React Native)"
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

            {/* Quick Bookmark / Save Query Button */}
            {query.trim() && (
              <button
                type="button"
                className={`btn-quick-save-query ${
                  savedQueries.some((sq) => sq.toLowerCase() === query.trim().toLowerCase())
                    ? "is-already-saved"
                    : savedQuerySuccess
                    ? "is-just-saved"
                    : ""
                }`}
                onClick={() => handleQuickSaveQuery(query)}
                disabled={savedQueries.some((sq) => sq.toLowerCase() === query.trim().toLowerCase())}
                title={
                  savedQueries.some((sq) => sq.toLowerCase() === query.trim().toLowerCase())
                    ? "Query is already saved in your profile"
                    : `Save "${query.trim()}" to My Freelancer Profile queries`
                }
                aria-label="Save query to profile"
              >
                <span>{savedQueries.some((sq) => sq.toLowerCase() === query.trim().toLowerCase()) ? "⭐" : "☆"}</span>
                <span className="save-btn-text">
                  {savedQueries.some((sq) => sq.toLowerCase() === query.trim().toLowerCase())
                    ? "Saved"
                    : savedQuerySuccess
                    ? "Saved!"
                    : "Save Query"}
                </span>
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

            {/* Facebook is disabled for now (kept commented for easy re-enable).
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
            */}

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

        {/* Dedicated Saved Queries Row (ALWAYS VISIBLE DIRECTLY UNDER THE INPUT BAR) */}
        <div className="saved-queries-bar-row" aria-label="Saved Search Queries">
          <div className="saved-queries-label-group">
            <span className="star-icon">⭐</span>
            <span className="queries-label-text">My Queries:</span>
          </div>

          <div className="saved-queries-scroll-container">
            {savedQueries.map((s) => (
              <button
                key={s}
                type="button"
                className={`saved-query-chip ${query.toLowerCase() === s.toLowerCase() ? "is-active" : ""}`}
                onClick={() => {
                  setQuery(s);
                  runSearch(s);
                }}
                title={`Click to search for "${s}"`}
              >
                <span className="chip-text">{s}</span>
              </button>
            ))}

            <button
              type="button"
              className="saved-query-chip chip-manage-action"
              onClick={() => {
                setProfileModalTab("queries");
                setShowProfile(true);
              }}
              title="Add, edit or organize queries in My Freelancer Profile"
            >
              <span>⚙️ Manage Queries</span>
            </button>
          </div>
        </div>

        {/* Secondary Controls Bar (Sources & Lead Filters) */}
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
                      disabled={key === "x" || key === "facebook"}
                      title={key === "x" || key === "facebook" ? `${label} is disabled for now` : undefined}
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
                {enabled.reddit && enabled.linkedin ? "Deselect All" : "Select All"}
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
        </div>
      </header>

      {appliedTabActive ? (
        <section className="applied-view">
          <div className="applied-view-header">
            <h2 className="applied-view-title">
              <span className="applied-view-check">✓</span> Applied Jobs
            </h2>
            <span className="applied-view-count">
              {appliedList.length} {appliedList.length === 1 ? "job" : "jobs"}
            </span>
          </div>

          {appliedList.length === 0 ? (
            <div className="empty-state-card">
              <div className="empty-icon-wrap">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="m8.5 12.5 2.5 2.5 4.5-5" />
                </svg>
              </div>
              <h3 className="empty-title">No applied jobs yet</h3>
              <p className="empty-subtitle">
                Mark a post as applied from the Posts tab and it will show up here.
              </p>
            </div>
          ) : (
            <>
              {appliedList.some((entry) => entry.item) && (
                <main className="results-masonry">
                  {appliedList
                    .filter((entry) => entry.item)
                    .map((entry) => (
                      <div key={entry.id} className="applied-card-wrap">
                        <FeedCard
                          item={entry.item as FeedItem}
                          isApplied
                          isSelected={selectedIds.has(entry.id)}
                          onToggleApplied={toggleAppliedJob}
                          onToggleSelect={toggleSelectItem}
                          onDismiss={handleDismissCard}
                          onWriteProposal={handleWriteProposal}
                          savedProposal={entry.proposal}
                          onViewProposal={openViewProposal}
                        />
                        {renderAppliedDetails(entry)}
                      </div>
                    ))}
                </main>
              )}

              {appliedList.some((entry) => !entry.item) && (
                <div className="applied-legacy-list">
                  {appliedList
                    .filter((entry) => !entry.item)
                    .map((entry) => (
                      <div key={entry.id} className="applied-legacy-card">
                        <div className="applied-legacy-top">
                          <div className="applied-legacy-meta">
                            <span className="applied-legacy-title">{entry.title || "Applied job"}</span>
                            <span className="applied-legacy-date">
                              Applied {new Date(entry.appliedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="applied-legacy-remove"
                            onClick={() => toggleAppliedJob(entry.id, entry.title)}
                            title="Remove from applied jobs"
                          >
                            ✕ Remove
                          </button>
                        </div>
                        {renderAppliedDetails(entry)}
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <>
      {/* Results Header Summary Bar (placed outside columns so it spans 100%) */}
      {searchedFor && (
        <div className="results-summary-bar">
          <div className="summary-left">
            <h2 className="summary-query">
              Results for <span className="query-highlight">“{searchedFor}”</span>
            </h2>
            <span className="summary-count-badge">
              {displayedItems.length} {displayedItems.length === 1 ? "post" : "posts"} found
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
            {/* Facebook disabled for now (kept commented for easy re-enable).
            {facebookMethod && (
              <span className={`method-badge ${facebookMethod === "chrome-extension" ? "method-free" : "method-apify"}`}>
                {facebookMethod === "chrome-extension" ? "⚡ Facebook: $0.00 Extension" : "☁️ Facebook: Apify"}
              </span>
            )}
            */}

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
              {/* X disabled for now.
              {enabled.x && sourceCounts.x > 0 && (
                <span className="breakdown-pill breakdown-x">
                  <XIcon size={11} /> {sourceCounts.x} X
                </span>
              )}
              */}
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
              {/* Facebook disabled for now.
              {enabled.facebook && sourceCounts.facebook > 0 && (
                <span className="breakdown-pill breakdown-facebook">
                  <FacebookIcon size={12} /> {sourceCounts.facebook} Facebook
                </span>
              )}
              */}
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
      {!loading && !error && displayedItems.length === 0 && (
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
        {displayedItems.map((item) => (
          <FeedCard
            key={item.id}
            item={item}
            isApplied={Boolean(appliedJobs[item.id])}
            isSelected={selectedIds.has(item.id)}
            onToggleApplied={toggleAppliedJob}
            onToggleSelect={toggleSelectItem}
            onDismiss={handleDismissCard}
            onWriteProposal={handleWriteProposal}
            savedProposal={appliedJobs[item.id]?.proposal}
            onViewProposal={openViewProposal}
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
        </>
      )}

      {/* Profile Modal */}
      <ProfileModal
        open={showProfile}
        initialTab={profileModalTab}
        onClose={() => {
          setShowProfile(false);
          setMobileTab((t) => (t === "profile" ? "posts" : t));
        }}
        onProfileUpdated={(newQueries) => {
          setSavedQueries(newQueries);
          try {
            localStorage.setItem(STORAGE_KEYS.SAVED_QUERIES, JSON.stringify(newQueries));
          } catch {}
        }}
      />

      {/* Cookie Manager Modal */}
      <CookieManagerModal open={showCookies} onClose={() => setShowCookies(false)} />
      <ApifyKeysModal
        open={showApifyKeys}
        onClose={() => { setShowApifyKeys(false); loadApifyBalances(); }}
      />

      {/* Proposal Dialog */}
      <ProposalDialog
        open={proposalOpen}
        proposal={proposalText}
        summary={proposalSummary}
        loading={proposalLoading}
        error={proposalError}
        retryStatus={proposalRetry}
        jobTitle={proposalJobTitle}
        defaultEmail={proposalDefaultEmail}
        jobUrl={proposalJobUrl}
        recipientPhone={proposalRecipientPhone}
        jobId={proposalJobId}
        isApplied={proposalJobId ? Boolean(appliedJobs[proposalJobId]) : false}
        onClose={() => setProposalOpen(false)}
        onRetry={handleRetryProposal}
        onToggleApplied={toggleAppliedJob}
      />

      {/* Saved Applied Proposal Viewer */}
      {viewProposalOpen && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setViewProposalOpen(false); }}
        >
          <div className="modal-panel applied-proposal-modal" role="dialog" aria-modal="true" aria-label="Saved applied proposal">
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon">📄</span>
                <div>
                  <h2 className="modal-title">Applied Proposal</h2>
                  {viewProposalTitle && <p className="modal-subtitle">{viewProposalTitle}</p>}
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setViewProposalOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <pre className="applied-proposal-modal-text">{viewProposalText}</pre>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-bulk-compose-action"
                onClick={() => copyText(viewProposalText)}
              >
                📋 Copy proposal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <aside className="floating-bulk-actions-bar" aria-label="Bulk actions for selected posts">
          <div className="bulk-bar-left">
            <span className="bulk-bar-count-badge">
              ✓ {selectedIds.size} post{selectedIds.size > 1 ? "s" : ""} selected
            </span>
            <span className="bulk-bar-emails-badge">
              ✉️ {selectedEmailsCount} email lead{selectedEmailsCount !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="bulk-bar-actions">
            <button
              type="button"
              className="btn-bulk-compose-action"
              onClick={() => setShowBulkEmailModal(true)}
              disabled={selectedEmailsCount === 0}
              title={
                selectedEmailsCount === 0
                  ? "Select posts containing email addresses to send proposals"
                  : "Compose & send bulk email proposals"
              }
            >
              <span>✉️ Compose & Send Bulk Email</span>
            </button>

            {itemsWithEmailCount > 0 && (
              <button
                type="button"
                className="btn-bulk-select-emails"
                onClick={selectAllWithEmails}
                title="Select all visible posts with extracted email leads"
              >
                <span>⚡ Select with Email ({itemsWithEmailCount})</span>
              </button>
            )}

            {selectedIds.size < displayedItems.length && (
              <button
                type="button"
                className="btn-bulk-select-emails"
                onClick={selectAllVisible}
                title="Select all visible posts"
              >
                <span>Select All ({displayedItems.length})</span>
              </button>
            )}

            <button
              type="button"
              className="btn-bulk-clear-selection"
              onClick={clearSelection}
              title="Clear current selection"
            >
              <span>✕ Clear</span>
            </button>
          </div>
        </aside>
      )}

      {/* Bulk Email Proposal Modal */}
      <BulkEmailModal
        open={showBulkEmailModal}
        selectedItems={selectedItems}
        onClose={() => setShowBulkEmailModal(false)}
        onApplied={(ids, proposal) => {
          ids.forEach((id) => {
            if (!appliedJobs[id]) toggleAppliedJob(id, undefined, proposal ? { proposal } : undefined);
          });
        }}
      />

      {/* Mobile Bottom Navigation (small screens only) */}
      {isMobileViewport && (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          <button
            type="button"
            className={`mobile-nav-item ${mobileTab === "posts" ? "is-active" : ""}`}
            onClick={() => setMobileTab("posts")}
            aria-current={mobileTab === "posts" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <span>Posts</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${mobileTab === "applied" ? "is-active" : ""}`}
            onClick={() => setMobileTab("applied")}
            aria-current={mobileTab === "applied" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="m8.5 12.5 2.5 2.5 4.5-5" />
            </svg>
            <span>Applied</span>
            {totalAppliedInCurrentItems > 0 && (
              <span className="mobile-nav-badge">{totalAppliedInCurrentItems}</span>
            )}
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${mobileTab === "profile" ? "is-active" : ""}`}
            onClick={() => {
              setMobileTab("profile");
              setProfileModalTab("profile");
              setShowProfile(true);
            }}
            aria-current={mobileTab === "profile" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
            </svg>
            <span>Profile</span>
          </button>
        </nav>
      )}
    </div>
  );
}