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
  stripSocialCounts,
} from "./FeedCard";
import ProfileModal, { DEFAULT_SEARCH_QUERIES } from "./ProfileModal";
import { useAuth } from "./AuthContext";
import CookieManagerModal from "./CookieManagerModal";
import ApifyKeysModal from "./ApifyKeysModal";
import ProposalDialog from "./ProposalDialog";
import BulkEmailModal from "./BulkEmailModal";
import WhatsAppModal from "./WhatsAppModal";
import { AppliedJobCompactCard, AppliedJobDetailModal, AppliedJobRecord } from "./AppliedJobCard";
import { AIChatView } from "./AIChatView";


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
  CONTACT_FILTER: "multifeed_contact_filter",
  WORK_MODE_FILTER: "multifeed_work_mode_filter",
  SEARCHED_FOR: "multifeed_searched_for",
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
  const [contactFilter, setContactFilter] = useState<"all" | "email" | "phone" | "any">(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CONTACT_FILTER);
      if (saved === "email" || saved === "phone" || saved === "any" || saved === "all") return saved;
    } catch {
      /* ignore */
    }
    return "all";
  });
  const [workModeFilter, setWorkModeFilter] = useState<"all" | "remote" | "onsite" | "hybrid" | "contract" | "rate">(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.WORK_MODE_FILTER);
      if (saved === "remote" || saved === "onsite" || saved === "hybrid" || saved === "contract" || saved === "rate" || saved === "all") return saved;
    } catch {
      /* ignore */
    }
    return "all";
  });
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

  // Applied tab search & filter controls
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedPlatform, setAppliedPlatform] = useState<string>("all");
  const [appliedLeadFilter, setAppliedLeadFilter] = useState<"all" | "proposal" | "email" | "phone">("all");

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
  const [searchedFor, setSearchedFor] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SEARCHED_FOR) ?? "";
    } catch {
      return "";
    }
  });
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
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Unified Navigation Tab (Posts, Applied, Chat, Profile) & independent scroll position per tab
  const [currentTab, setCurrentTab] = useState<"posts" | "applied" | "chat" | "profile">("posts");
  const previousTabRef = useRef<"posts" | "applied" | "chat">("posts");
  const tabScrollPositions = useRef<{ posts: number; applied: number; chat: number }>({
    posts: 0,
    applied: 0,
    chat: 0,
  });

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 640px)").matches;
  });
  const appliedTabActive = currentTab === "applied";

  // Handle switching tabs with independent scroll positions on web and mobile
  const handleTabChange = (targetTab: "posts" | "applied" | "chat" | "profile") => {
    if (targetTab === currentTab && targetTab !== "profile") {
      // Tapping the currently active tab scrolls smoothly to top
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Save current scroll position for the current tab before switching
    if (currentTab === "posts" || currentTab === "applied" || currentTab === "chat") {
      tabScrollPositions.current[currentTab] = window.scrollY;
    }

    if (targetTab === "profile") {
      setProfileModalTab("profile");
      setShowProfile(true);
      return;
    }

    previousTabRef.current = targetTab;
    setCurrentTab(targetTab);

    // Restore saved scroll position for target tab
    requestAnimationFrame(() => {
      const savedY = tabScrollPositions.current[targetTab] || 0;
      window.scrollTo({ top: savedY, behavior: "instant" });
    });
  };

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

  // Selected applied job for compact card detail modal / bottom sheet
  const [selectedAppliedJob, setSelectedAppliedJob] = useState<AppliedJobRecord | null>(null);

  // WhatsApp Modal state & handler
  const [whatsAppModal, setWhatsAppModal] = useState<{
    open: boolean;
    phone?: string;
    detectedPhones?: string[];
    recipientName?: string;
    jobTitle?: string;
    jobUrl?: string;
    proposalText?: string;
    contextText?: string;
  } | null>(null);

  const handleOpenWhatsAppModal = (item: FeedItem, phone?: string) => {
    const contacts = getItemContacts(item);
    const meta = getItemMeta(item);
    const appliedEntry = appliedJobs[item.id];
    setWhatsAppModal({
      open: true,
      phone: phone || contacts.phones[0] || "",
      detectedPhones: contacts.phones,
      recipientName: meta.author,
      jobTitle: meta.title,
      jobUrl: meta.url,
      proposalText: appliedEntry?.proposal || "",
      contextText: meta.content,
    });
  };

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
    const cleanText = stripSocialCounts(jobText);
    const cleanTitle = stripSocialCounts(jobTitle) || undefined;
    setProposalJobText(cleanText);
    setProposalJobUrl(jobUrl);
    setProposalJobTitle(cleanTitle);
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
      const result = await generateProposal(cleanText, cleanTitle, jobUrl, (attempt, maxAttempts) => {
        setProposalRetry(`Retrying… attempt ${attempt} of ${maxAttempts}`);
      });
      setProposalText(result.proposal);
      setProposalSummary(result.summary);
      // If this job is already marked applied, save the generated proposal.
      if (jobId && appliedJobs[jobId]) {
        updateAppliedJob(jobId, {
          proposal: result.proposal,
          url: jobUrl || appliedJobs[jobId].url,
          title: cleanTitle || appliedJobs[jobId].title,
          content: cleanText || appliedJobs[jobId].content,
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
          } catch { }
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


  // Persist autoRefreshSec preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.AUTO_REFRESH, String(autoRefreshSec));
    } catch (e) {
      console.warn("Failed to save autoRefreshSec to localStorage", e);
    }
  }, [autoRefreshSec]);

  // Persist the lead / contact filter (All, With Email, With Phone, Any)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CONTACT_FILTER, contactFilter);
    } catch (e) {
      console.warn("Failed to save contactFilter to localStorage", e);
    }
  }, [contactFilter]);

  // Persist the work-mode filter (remote, onsite, hybrid, contract, rate)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.WORK_MODE_FILTER, workModeFilter);
    } catch (e) {
      console.warn("Failed to save workModeFilter to localStorage", e);
    }
  }, [workModeFilter]);

  // Persist the last searched term so the restored feed shows its heading
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SEARCHED_FOR, searchedFor);
    } catch (e) {
      console.warn("Failed to save searchedFor to localStorage", e);
    }
  }, [searchedFor]);

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

  // Check if an item has already been applied to (matches by ID, clean ID, URL, or author+title)
  const isItemApplied = (item: FeedItem): boolean => {
    if (!item) return false;
    if (appliedJobs[item.id]) return true;

    // Substring / stripped ID matching (e.g. "linkedin-activity-751..." vs "activity-751...")
    const rawId = item.id.replace(/^(reddit|linkedin|x|facebook|fb)-/i, "");
    for (const appliedId of Object.keys(appliedJobs)) {
      const cleanAppliedId = appliedId.replace(/^(reddit|linkedin|x|facebook|fb)-/i, "");
      if (rawId && cleanAppliedId && (rawId === cleanAppliedId || item.id.includes(appliedId) || appliedId.includes(item.id))) {
        return true;
      }
    }

    const meta = getItemMeta(item);
    if (meta.url) {
      const cleanUrl = meta.url
        .split("?")[0]
        .split("#")[0]
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/+$/, "")
        .trim()
        .toLowerCase();
      if (cleanUrl) {
        for (const applied of Object.values(appliedJobs)) {
          if (applied.url) {
            const appliedCleanUrl = applied.url
              .split("?")[0]
              .split("#")[0]
              .replace(/^https?:\/\//i, "")
              .replace(/^www\./i, "")
              .replace(/\/+$/, "")
              .trim()
              .toLowerCase();
            if (
              appliedCleanUrl &&
              (cleanUrl === appliedCleanUrl ||
                cleanUrl.includes(appliedCleanUrl) ||
                appliedCleanUrl.includes(cleanUrl))
            ) {
              return true;
            }
          }
        }
      }
    }

    if (meta.author && meta.title) {
      const auth = meta.author.trim().toLowerCase();
      const tit = meta.title.trim().toLowerCase();
      if (auth.length > 1 && tit.length > 3) {
        for (const applied of Object.values(appliedJobs)) {
          const aAuth = applied.author?.trim().toLowerCase() || "";
          const aTit = applied.title?.trim().toLowerCase() || "";
          if (
            (aAuth && (aAuth === auth || auth.includes(aAuth) || aAuth.includes(auth))) &&
            (aTit && (aTit === tit || tit.includes(aTit) || aTit.includes(tit)))
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const visibleItems = items
    .filter((item) => enabled[itemSource(item)])
    .filter((item) => {
      // Applied posts MUST ALWAYS be hidden from the Posts feed!
      if (isItemApplied(item)) return false;
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

  // Filtered applied list for the Applied tab
  const filteredAppliedList = appliedList.filter((entry) => {
    if (appliedPlatform !== "all" && entry.source !== appliedPlatform) return false;
    const item = entry.item;
    const contacts = item ? getItemContacts(item) : { emails: [], phones: [] };
    if (appliedLeadFilter === "proposal" && !entry.proposal) return false;
    if (appliedLeadFilter === "email" && contacts.emails.length === 0) return false;
    if (appliedLeadFilter === "phone" && contacts.phones.length === 0) return false;
    if (appliedSearch.trim()) {
      const q = appliedSearch.toLowerCase().trim();
      const matchTitle = entry.title?.toLowerCase().includes(q);
      const matchAuthor = entry.author?.toLowerCase().includes(q);
      const matchNote = entry.note?.toLowerCase().includes(q);
      const matchProposal = entry.proposal?.toLowerCase().includes(q);
      const matchUrl = entry.url?.toLowerCase().includes(q);
      if (!matchTitle && !matchAuthor && !matchNote && !matchProposal && !matchUrl) return false;
    }
    return true;
  });

  const handleExportAppliedCsv = () => {
    if (appliedList.length === 0) return;
    const headers = ["Title", "Author", "Platform", "URL", "Applied Date", "Emails", "Phones", "Proposal", "Notes"];
    const rows = appliedList.map((entry) => {
      const item = entry.item;
      const contacts = item ? getItemContacts(item) : { emails: [], phones: [] };
      return [
        `"${(entry.title || "").replace(/"/g, '""')}"`,
        `"${(entry.author || "").replace(/"/g, '""')}"`,
        `"${(entry.source || "").replace(/"/g, '""')}"`,
        `"${(entry.url || "").replace(/"/g, '""')}"`,
        `"${(entry.appliedAt || "").replace(/"/g, '""')}"`,
        `"${contacts.emails.join("; ").replace(/"/g, '""')}"`,
        `"${contacts.phones.join("; ").replace(/"/g, '""')}"`,
        `"${(entry.proposal || "").replace(/"/g, '""')}"`,
        `"${(entry.note || "").replace(/"/g, '""')}"`,
      ].join(",");
    });
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `applied_jobs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearAllApplied = () => {
    if (appliedList.length === 0) return;
    if (window.confirm(`Are you sure you want to remove all ${appliedList.length} applied jobs from your tracking list?`)) {
      setAppliedJobs({});
      try {
        localStorage.removeItem(STORAGE_KEYS.APPLIED_JOBS);
      } catch (e) {
        console.warn("Failed to clear applied jobs from localStorage", e);
      }
    }
  };

  const displayedItems = appliedTabActive
    ? filteredAppliedList.filter((entry) => Boolean(entry.item)).map((entry) => entry.item as FeedItem)
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

  return (
    <div className="app-container">
      {/* Sticky Header */}
      <header className="app-header">
        {/* Mobile Native App Bar (Visible on mobile viewports only) */}
        <div className="mobile-app-bar">
          <div className="mobile-app-bar-left">
            {currentTab === "chat" ? (
              <div className="mobile-screen-title-wrap">
                <div className="mobile-applied-icon" style={{ background: "linear-gradient(135deg, #6366f1, #9333ea)", boxShadow: "0 2px 8px rgba(147, 51, 234, 0.35)" }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
                  </svg>
                </div>
                <span className="mobile-screen-title">AI Copilot</span>
              </div>
            ) : appliedTabActive ? (
              <div className="mobile-screen-title-wrap">
                <div className="mobile-applied-icon">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span className="mobile-screen-title">Applied Jobs</span>
                <span className="mobile-title-count-pill">{appliedList.length}</span>
              </div>
            ) : (
              <div className="mobile-brand-wrap">
                <div className="mobile-brand-logo">
                  <span className={`mobile-status-dot ${extensionConnected ? "dot-online" : "dot-offline"}`} />
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </div>
                <div className="mobile-brand-text">
                  <span className="mobile-app-name">MultiFeed</span>
                  <span className="mobile-app-status-sub">
                    {extensionConnected ? "⚡ Free Extension Active" : "☁️ Cloud Mode"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mobile-app-bar-right">
            <button
              type="button"
              className={`mobile-icon-btn ${statusSyncing ? "is-syncing" : ""}`}
              onClick={handleSyncStatus}
              title="Sync status"
              aria-label="Sync status"
            >
              <RefreshIcon size={14} className={statusSyncing ? "spin-icon" : ""} />
            </button>

            <button
              type="button"
              className="mobile-icon-btn"
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              title={`Switch to ${theme === "light" ? "Dark" : "Light"} mode`}
              aria-label="Toggle theme"
            >
              <span>{theme === "light" ? "☀️" : "🌙"}</span>
            </button>

            <button
              type="button"
              className="mobile-icon-btn mobile-menu-btn"
              onClick={() => setShowMobileMenu(true)}
              title="Tools & Settings"
              aria-label="Open settings and tools menu"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
                <circle cx="5" cy="12" r="1.5" />
              </svg>
            </button>

            {user && (
              <button
                type="button"
                className="mobile-avatar-btn"
                onClick={() => {
                  setProfileModalTab("profile");
                  setShowProfile(true);
                }}
                title="Freelancer Profile"
                aria-label="Open freelancer profile"
              >
                {user.photoURL ? (
                  <img className="mobile-avatar-img" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="mobile-avatar-fallback">
                    {(user.displayName || user.email || "U")[0]?.toUpperCase()}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Desktop Header Top Row */}
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

          {/* Desktop Navigation Tabs */}
          <nav className="desktop-nav-tabs" aria-label="Main Navigation">
            <button
              type="button"
              className={`desktop-nav-tab ${currentTab === "posts" ? "is-active" : ""}`}
              onClick={() => handleTabChange("posts")}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
              <span>Posts</span>
              {visibleItems.length > 0 && (
                <span className="desktop-tab-badge">{visibleItems.length}</span>
              )}
            </button>

            <button
              type="button"
              className={`desktop-nav-tab ${currentTab === "applied" ? "is-active" : ""}`}
              onClick={() => handleTabChange("applied")}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="m8.5 12.5 2.5 2.5 4.5-5" />
              </svg>
              <span>Applied</span>
              {appliedList.length > 0 && (
                <span className="desktop-tab-badge badge-applied-count">{appliedList.length}</span>
              )}
            </button>

            <button
              type="button"
              className={`desktop-nav-tab nav-tab-ai ${currentTab === "chat" ? "is-active" : ""}`}
              onClick={() => handleTabChange("chat")}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
              </svg>
              <span>AI Copilot</span>
              <span className="desktop-tab-badge badge-ai-spark">✨</span>
            </button>

            <button
              type="button"
              className={`desktop-nav-tab ${currentTab === "profile" ? "is-active" : ""}`}
              onClick={() => handleTabChange("profile")}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
              </svg>
              <span>Profile</span>
            </button>
          </nav>

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

        {/* Search Bar Form and Filters (hidden when viewing Applied or AI Chat tab) */}
        {!appliedTabActive && currentTab !== "chat" && (
          <>
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
                    className={`btn-quick-save-query ${savedQueries.some((sq) => sq.toLowerCase() === query.trim().toLowerCase())
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
          </>
        )}
      </header>

      {currentTab === "chat" ? (
        <AIChatView
          appliedList={appliedList}
          currentQuery={query}
          onSwitchTab={handleTabChange}
          onOpenProfile={() => {
            setProfileModalTab("profile");
            setShowProfile(true);
          }}
        />
      ) : appliedTabActive ? (
        <section className="applied-view">
          {/* Applied Top Controls Bar */}
          <div className="applied-view-header">
            <div className="applied-header-left">
              <h2 className="applied-view-title">
                <span className="applied-view-check">✓</span> Applied Jobs
              </h2>
              <span className="applied-view-count">
                {appliedList.length} {appliedList.length === 1 ? "job" : "jobs"} tracked
              </span>
            </div>

            <div className="applied-header-actions">
              {appliedList.length > 0 && (
                <>
                  <button
                    type="button"
                    className="applied-action-btn btn-export-csv"
                    onClick={handleExportAppliedCsv}
                    title="Export tracked jobs to CSV spreadsheet"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Export CSV</span>
                  </button>

                  <button
                    type="button"
                    className="applied-action-btn btn-clear-applied"
                    onClick={handleClearAllApplied}
                    title="Clear all tracked applied jobs"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span>Clear All</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Applied Filter & Search Toolbar */}
          {appliedList.length > 0 && (
            <div className="applied-toolbar">
              <div className="applied-search-wrap">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="applied-search-icon">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="applied-search-input"
                  placeholder="Filter applied jobs by keyword, title, author, notes..."
                  value={appliedSearch}
                  onChange={(e) => setAppliedSearch(e.target.value)}
                />
                {appliedSearch && (
                  <button
                    type="button"
                    className="applied-search-clear"
                    onClick={() => setAppliedSearch("")}
                    title="Clear filter text"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Platform & Lead Filter Pills */}
              <div className="applied-filter-pills">
                <button
                  type="button"
                  className={`applied-pill ${appliedPlatform === "all" ? "is-active" : ""}`}
                  onClick={() => setAppliedPlatform("all")}
                >
                  All Sources ({appliedList.length})
                </button>
                {["linkedin", "reddit", "x", "facebook"].map((plat) => {
                  const count = appliedList.filter((e) => e.source === plat).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={plat}
                      type="button"
                      className={`applied-pill ${appliedPlatform === plat ? "is-active" : ""}`}
                      onClick={() => setAppliedPlatform(plat)}
                    >
                      {plat === "linkedin" ? "LinkedIn" : plat === "reddit" ? "Reddit" : plat === "x" ? "X" : "Facebook"} ({count})
                    </button>
                  );
                })}

                <span className="applied-pill-sep" />

                <button
                  type="button"
                  className={`applied-pill ${appliedLeadFilter === "proposal" ? "is-active" : ""}`}
                  onClick={() => setAppliedLeadFilter((f) => (f === "proposal" ? "all" : "proposal"))}
                >
                  📄 With Proposal ({appliedList.filter((e) => Boolean(e.proposal)).length})
                </button>
                <button
                  type="button"
                  className={`applied-pill ${appliedLeadFilter === "email" ? "is-active" : ""}`}
                  onClick={() => setAppliedLeadFilter((f) => (f === "email" ? "all" : "email"))}
                >
                  ✉️ With Email ({appliedList.filter((e) => (e.item ? getItemContacts(e.item).emails.length > 0 : false)).length})
                </button>
                <button
                  type="button"
                  className={`applied-pill ${appliedLeadFilter === "phone" ? "is-active" : ""}`}
                  onClick={() => setAppliedLeadFilter((f) => (f === "phone" ? "all" : "phone"))}
                >
                  📞 With Phone ({appliedList.filter((e) => (e.item ? getItemContacts(e.item).phones.length > 0 : false)).length})
                </button>
              </div>
            </div>
          )}

          {/* Applied Content List */}
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
                Mark any post as applied from the Posts feed and it will appear here.
              </p>
              <button
                type="button"
                className="btn-switch-to-posts"
                onClick={() => handleTabChange("posts")}
              >
                Browse Job Posts Feed →
              </button>
            </div>
          ) : filteredAppliedList.length === 0 ? (
            <div className="empty-state-card">
              <h3 className="empty-title">No matching applied jobs</h3>
              <p className="empty-subtitle">Try adjusting your search query or filters.</p>
              <button
                type="button"
                className="btn-switch-to-posts"
                onClick={() => {
                  setAppliedSearch("");
                  setAppliedPlatform("all");
                  setAppliedLeadFilter("all");
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="applied-compact-list">
              {filteredAppliedList.map((entry) => (
                <AppliedJobCompactCard
                  key={entry.id}
                  entry={entry}
                  onOpenDetails={(job) => {
                    setSelectedAppliedJob(job);
                    if (noteDrafts[job.id] === undefined) {
                      setNoteDrafts((p) => ({ ...p, [job.id]: job.note || "" }));
                    }
                  }}
                  onUnmarkApplied={toggleAppliedJob}
                  onOpenWhatsApp={handleOpenWhatsAppModal}
                  onViewProposal={openViewProposal}
                  onWriteProposal={handleWriteProposal}
                />
              ))}
            </div>
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
                onOpenWhatsApp={handleOpenWhatsAppModal}
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
          const resumeTab = previousTabRef.current === "applied" ? "applied" : "posts";
          setCurrentTab(resumeTab);
          requestAnimationFrame(() => {
            const savedY = tabScrollPositions.current[resumeTab] || 0;
            window.scrollTo({ top: savedY, behavior: "instant" });
          });
        }}
        onProfileUpdated={(newQueries) => {
          setSavedQueries(newQueries);
          try {
            localStorage.setItem(STORAGE_KEYS.SAVED_QUERIES, JSON.stringify(newQueries));
          } catch { }
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

      {/* Mobile Tools & Settings Bottom Sheet */}
      {showMobileMenu && (
        <div className="mobile-sheet-overlay" onClick={() => setShowMobileMenu(false)}>
          <div className="mobile-sheet-content" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-drag-handle" />

            <div className="mobile-sheet-header">
              <div className="mobile-sheet-title-group">
                <span className="mobile-sheet-title">Tools & Settings</span>
                <span className="mobile-sheet-sub">MultiFeed Intelligence</span>
              </div>
              <button
                type="button"
                className="mobile-sheet-close-btn"
                onClick={() => setShowMobileMenu(false)}
                aria-label="Close settings"
              >
                ✕
              </button>
            </div>

            <div className="mobile-sheet-body">
              {/* User Account Info */}
              {user && (
                <div className="mobile-sheet-user-card">
                  <div className="mobile-sheet-avatar">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <span>{(user.displayName || user.email || "U")[0]?.toUpperCase()}</span>
                    )}
                  </div>
                  <div className="mobile-sheet-user-info">
                    <span className="mobile-sheet-user-name">{user.displayName || "Freelancer"}</span>
                    <span className="mobile-sheet-user-email">{user.email}</span>
                  </div>
                  <button
                    type="button"
                    className="mobile-sheet-signout-btn"
                    onClick={() => {
                      setShowMobileMenu(false);
                      signOutUser();
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              )}

              {/* Status Section */}
              <div className="mobile-sheet-section">
                <span className="mobile-sheet-section-title">SCRAPER STATUS & TOKENS</span>

                {/* Chrome Extension Status */}
                <div className="mobile-sheet-item">
                  <div className="mobile-sheet-item-icon">
                    <span className={`status-indicator-dot ${extensionConnected ? "dot-online" : "dot-offline"}`} />
                  </div>
                  <div className="mobile-sheet-item-info">
                    <span className="mobile-sheet-item-title">LinkedIn Extension</span>
                    <span className="mobile-sheet-item-sub">
                      {extensionConnected ? "Connected ($0.00 Free Mode)" : "Offline (Cloud Apify fallback)"}
                    </span>
                  </div>
                  <span className={`mobile-sheet-badge ${extensionConnected ? "badge-online" : "badge-offline"}`}>
                    {extensionConnected ? "ACTIVE" : "OFFLINE"}
                  </span>
                </div>

                {/* Apify Cloud Balance */}
                <div
                  className="mobile-sheet-item"
                  onClick={() => {
                    setShowMobileMenu(false);
                    setShowApifyKeys(true);
                  }}
                >
                  <div className="mobile-sheet-item-icon">⚡</div>
                  <div className="mobile-sheet-item-info">
                    <span className="mobile-sheet-item-title">Apify Cloud Balance</span>
                    <span className="mobile-sheet-item-sub">
                      ${totalRemainingUsd.toFixed(2)} remaining of ${totalMaxUsd.toFixed(2)}
                    </span>
                    <div className="mobile-sheet-progress-bg">
                      <div
                        className="mobile-sheet-progress-fill"
                        style={{
                          width: `${totalMaxUsd > 0
                              ? Math.min(100, (totalRemainingUsd / totalMaxUsd) * 100)
                              : 0
                            }%`,
                        }}
                      />
                    </div>
                  </div>
                  <button type="button" className="mobile-sheet-item-action">
                    Keys ⚙️
                  </button>
                </div>

                {/* Session Cookies */}
                <div
                  className="mobile-sheet-item"
                  onClick={() => {
                    setShowMobileMenu(false);
                    setShowCookies(true);
                  }}
                >
                  <div className="mobile-sheet-item-icon">🍪</div>
                  <div className="mobile-sheet-item-info">
                    <span className="mobile-sheet-item-title">Session Cookies</span>
                    <span className="mobile-sheet-item-sub">Manage LinkedIn / Reddit cookies</span>
                  </div>
                  <button type="button" className="mobile-sheet-item-action">
                    Manage →
                  </button>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="mobile-sheet-section">
                <span className="mobile-sheet-section-title">PREFERENCES & SYNC</span>

                <button
                  type="button"
                  className="mobile-sheet-action-row"
                  onClick={() => {
                    handleSyncStatus();
                  }}
                >
                  <span className="action-row-icon">🔄</span>
                  <span className="action-row-text">
                    {statusSyncing
                      ? "Syncing Connection…"
                      : "Sync Extension & Apify Balances"}
                  </span>
                  <RefreshIcon size={14} className={statusSyncing ? "spin-icon" : ""} />
                </button>

                <button
                  type="button"
                  className="mobile-sheet-action-row"
                  onClick={() => {
                    setShowMobileMenu(false);
                    setProfileModalTab("profile");
                    setShowProfile(true);
                  }}
                >
                  <span className="action-row-icon">👤</span>
                  <span className="action-row-text">Freelancer Profile & Saved Queries</span>
                  <span>→</span>
                </button>

                <button
                  type="button"
                  className="mobile-sheet-action-row"
                  onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
                >
                  <span className="action-row-icon">{theme === "light" ? "☀️" : "🌙"}</span>
                  <span className="action-row-text">Theme: {theme === "light" ? "Light Mode" : "Dark Mode"}</span>
                  <span className="mobile-sheet-badge">{theme === "light" ? "Light" : "Dark"}</span>
                </button>
              </div>
            </div>

            <div className="mobile-sheet-footer">
              <button
                type="button"
                className="mobile-sheet-done-btn"
                onClick={() => setShowMobileMenu(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
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

      {/* WhatsApp Modal */}
      {whatsAppModal?.open && (
        <WhatsAppModal
          open={whatsAppModal.open}
          initialPhone={whatsAppModal.phone}
          detectedPhones={whatsAppModal.detectedPhones}
          recipientName={whatsAppModal.recipientName}
          jobTitle={whatsAppModal.jobTitle}
          jobUrl={whatsAppModal.jobUrl}
          proposalText={whatsAppModal.proposalText}
          contextText={whatsAppModal.contextText}
          onClose={() => setWhatsAppModal(null)}
        />
      )}

      {/* Applied Job Detail Modal / Bottom Sheet */}
      {selectedAppliedJob && (
        <AppliedJobDetailModal
          open={Boolean(selectedAppliedJob)}
          entry={selectedAppliedJob}
          noteDraft={selectedAppliedJob ? (noteDrafts[selectedAppliedJob.id] ?? selectedAppliedJob.note ?? "") : ""}
          onNoteDraftChange={(val) => {
            if (selectedAppliedJob) {
              setNoteDrafts((p) => ({ ...p, [selectedAppliedJob.id]: val }));
            }
          }}
          onSaveNote={(id, note) => {
            updateAppliedJob(id, { note });
            setSelectedAppliedJob((prev) => (prev ? { ...prev, note } : null));
          }}
          onClose={() => setSelectedAppliedJob(null)}
          onUnmarkApplied={toggleAppliedJob}
          onOpenWhatsApp={handleOpenWhatsAppModal}
          onWriteProposal={handleWriteProposal}
        />
      )}

      {/* Mobile Bottom Navigation (small screens only) */}
      {isMobileViewport && (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          <button
            type="button"
            className={`mobile-nav-item ${currentTab === "posts" ? "is-active" : ""}`}
            onClick={() => handleTabChange("posts")}
            aria-current={currentTab === "posts" ? "page" : undefined}
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
            className={`mobile-nav-item ${currentTab === "applied" ? "is-active" : ""}`}
            onClick={() => handleTabChange("applied")}
            aria-current={currentTab === "applied" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="m8.5 12.5 2.5 2.5 4.5-5" />
            </svg>
            <span>Applied</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${currentTab === "chat" ? "is-active" : ""}`}
            onClick={() => handleTabChange("chat")}
            aria-current={currentTab === "chat" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
            </svg>
            <span>AI Chat</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${currentTab === "profile" ? "is-active" : ""}`}
            onClick={() => handleTabChange("profile")}
            aria-current={currentTab === "profile" ? "page" : undefined}
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