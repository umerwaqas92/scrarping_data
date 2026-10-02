import { useState } from "react";
import { XTweet, RedditPost, LinkedinProfile, LinkedinPost, FacebookPost } from "./api";

export type FeedItem = XTweet | RedditPost | LinkedinProfile | LinkedinPost | FacebookPost;

export function isTweet(item: FeedItem): item is XTweet {
  return (item as XTweet).text !== undefined && (item as FacebookPost).source !== "facebook";
}

export function isLinkedin(item: FeedItem): item is LinkedinProfile | LinkedinPost {
  return (item as LinkedinProfile | LinkedinPost).source === "linkedin";
}

export function isFacebook(item: FeedItem): item is FacebookPost {
  return (item as FacebookPost).source === "facebook";
}

export function isReddit(item: FeedItem): item is RedditPost {
  return (item as RedditPost).source === "reddit" || (item as RedditPost).subreddit !== undefined;
}

export interface ItemMeta {
  source: "x" | "reddit" | "linkedin" | "facebook";
  title: string;
  url: string;
  author: string;
  authorAvatar?: string;
  content: string;
}

/** Robustly extract profile avatar from any feed item or raw snapshot. */
export function getItemAvatar(item?: FeedItem | any): string | undefined {
  if (!item) return undefined;
  if (typeof item === "object") {
    if (item.authorPicture) return item.authorPicture;
    if (item.profilePicture) return item.profilePicture;
    if (item.author_avatar) return item.author_avatar;
    if (item.authorAvatar) return item.authorAvatar;
    if (item.user) {
      const u = item.user;
      if (u.profileImageUrl) return u.profileImageUrl;
      if (u.profileImageUrlHttps) return u.profileImageUrlHttps;
      if (u.profile_image_url_https) return u.profile_image_url_https;
      if (u.profile_image_url) return u.profile_image_url;
      if (u.avatar) return typeof u.avatar === "string" ? u.avatar : u.avatar?.url;
    }
    if (item.thumbnail && typeof item.thumbnail === "string" && item.thumbnail.startsWith("http") && !["default", "self", "nsfw"].includes(item.thumbnail)) {
      return item.thumbnail;
    }
  }
  return undefined;
}

/**
 * LinkedIn headlines often include social-count noise (e.g. "· 12,345
 * followers"). Strip it so it never becomes a job title / reaches the AI.
 */
export function stripSocialCounts(input?: string): string {
  if (!input) return "";
  return input
    .replace(/\b\d[\d,.]*\s*[KkMm]?\+?\s*(?:followers?|connections?|subscribers?)\b/gi, " ")
    .replace(/(^|[·•|]\s*)\d(?:st|nd|rd|th)\+?(?=\s|$)/gi, "$1")
    .replace(/\s*[·•|]\s*(?=[·•|])/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·•|,\-–]+/, "")
    .replace(/[\s·•|,\-–]+$/, "")
    .trim();
}

/** Normalize any feed item into the flat fields we persist for applied jobs. */
export function getItemMeta(item: FeedItem): ItemMeta {
  if (isTweet(item)) {
    const text = item.text || "";
    const user = (item as any).user;
    const avatar =
      user?.profileImageUrl ||
      user?.profileImageUrlHttps ||
      user?.profile_image_url_https ||
      user?.profile_image_url ||
      "";
    return {
      source: "x",
      title: text.slice(0, 140),
      url: item.url || "",
      author: user?.name || user?.screenName || "",
      authorAvatar: avatar,
      content: text,
    };
  }
  if (isLinkedin(item)) {
    if ((item as LinkedinPost).content !== undefined) {
      const p = item as LinkedinPost;
      return {
        source: "linkedin",
        title: stripSocialCounts(p.content || "").slice(0, 140),
        url: p.linkedinUrl || "",
        author: p.authorName || "",
        authorAvatar: p.authorPicture || "",
        content: p.content || "",
      };
    }
    const p = item as LinkedinProfile;
    const name = `${p.firstName || ""} ${p.lastName || ""}`.trim();
    return {
      source: "linkedin",
      title: stripSocialCounts(p.headline) || name,
      url: p.linkedinUrl || "",
      author: name,
      authorAvatar: p.profilePicture || "",
      content: stripSocialCounts(`${p.headline || ""}\n${p.currentPosition || ""}`),
    };
  }
  if (isFacebook(item)) {
    const text = item.content || item.text || "";
    return {
      source: "facebook",
      title: text.slice(0, 140),
      url: item.url || item.pageUrl || "",
      author: item.authorName || item.pageName || "",
      authorAvatar: item.authorPicture || "",
      content: text,
    };
  }
  const r = item as RedditPost;
  const redditThumb =
    r.thumbnail &&
    typeof r.thumbnail === "string" &&
    r.thumbnail.startsWith("http") &&
    !["default", "self", "nsfw"].includes(r.thumbnail)
      ? r.thumbnail
      : "";
  return {
    source: "reddit",
    title: r.title || "",
    url: r.url || (r.permalink ? `https://www.reddit.com${r.permalink}` : ""),
    author: r.author || "",
    authorAvatar: redditThumb,
    content: `${r.title || ""}\n\n${r.selftext || ""}`.trim(),
  };
}

function formatCount(n?: number): string {
  if (n === undefined || n === null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function timeAgo(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

/* SVG Platform Icons */
export function XIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function RedditIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.702zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.197-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

export function LinkedinIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.64 1.64 0 1 0 0 3.28 1.64 1.64 0 0 0 0-3.28z" />
    </svg>
  );
}

export function FacebookIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#1877F2" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export function RefreshIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

export function TrashIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export interface ExtractedContacts {
  emails: string[];
  phones: string[];
}

export function isValidPhoneNumber(str: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  const digits = trimmed.replace(/\D/g, "");
  // Standard phone numbers contain between 7 and 15 digits
  if (digits.length < 7 || digits.length > 15) return false;

  // Reject date formats: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(trimmed)) return false;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(trimmed)) return false;

  // Reject numeric ranges like 100-200, 2024-2025, $50-$100
  if (/^\d{2,4}\s*[-/]\s*\d{2,4}$/.test(trimmed)) return false;

  // Reject repetitive digits e.g. 00000000, 11111111
  if (/^(\d)\1+$/.test(digits)) return false;

  // Reject pure 4-digit years (e.g. 2024, 2025, 2026)
  if (/^(19|20)\d{2}$/.test(digits)) return false;

  // If not starting with '+', require punctuation formatting or minimum 10 digits
  if (!trimmed.startsWith("+") && !/[() -.]/.test(trimmed) && digits.length < 10) return false;

  return true;
}

/** Smart normalizer that ensures phone numbers have correct international country codes for WhatsApp */
export function normalizeWhatsAppNumber(rawPhone: string, contextText?: string): string {
  if (!rawPhone) return "";
  let digits = rawPhone.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    return digits.replace(/\+/g, "");
  }

  digits = digits.replace(/\D/g, "");

  if (digits.startsWith("00")) {
    return digits.slice(2);
  }

  // Pakistan local format 11 digits (e.g. 03001234567 -> 923001234567)
  if (digits.length === 11 && digits.startsWith("03")) {
    return "92" + digits.slice(1);
  }

  // UK local format 11 digits (e.g. 07123456789 -> 447123456789)
  if (digits.length === 11 && digits.startsWith("07")) {
    return "44" + digits.slice(1);
  }

  // India local mobile 10 digits starting with 6, 7, 8, 9 (e.g. 9926640483 -> 919926640483)
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    if (contextText && /\b(karachi|lahore|islamabad|rawalpindi|pakistan|pk)\b/i.test(contextText) && /^3/.test(digits)) {
      return "92" + digits;
    }
    return "91" + digits;
  }

  // Pakistan 10 digits starting with 3 (e.g. 3001234567)
  if (digits.length === 10 && digits.startsWith("3")) {
    if (contextText && /\b(karachi|lahore|islamabad|rawalpindi|pakistan|pk)\b/i.test(contextText)) {
      return "92" + digits;
    }
  }

  // US/Canada 10 digits starting with 2-5
  if (digits.length === 10 && /^[2-5]/.test(digits)) {
    return "1" + digits;
  }

  // If already 11-15 digits
  if (digits.length >= 11 && digits.length <= 15) {
    if (digits.startsWith("0")) {
      digits = digits.replace(/^0+/, "");
    }
    return digits;
  }

  return digits;
}

export function extractContacts(text?: string): ExtractedContacts {
  if (!text || typeof text !== "string") return { emails: [], phones: [] };

  const emailsSet = new Set<string>();
  const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emailMatches) {
    for (let email of emailMatches) {
      email = email.replace(/[.,;!?)]+$/, "").trim().toLowerCase();
      if (email && email.includes("@")) {
        emailsSet.add(email);
      }
    }
  }

  const phonesSet = new Set<string>();

  // 1. WhatsApp direct links (e.g. wa.me/919926640483 or wa.me/9926640483)
  const waLinks = text.match(/(?:wa\.me|whatsapp\.com\/send\?phone=)\/?\+?(\d{7,15})/gi);
  if (waLinks) {
    for (const match of waLinks) {
      const numMatch = match.match(/\d{7,15}/);
      if (numMatch && isValidPhoneNumber(numMatch[0])) {
        phonesSet.add(numMatch[0]);
      }
    }
  }

  // 2. Keyword-prefixed numbers: WhatsApp/Call/Ph/Mobile/HR: 9926640483
  const labeledMatches = text.match(/(?:whatsapp|wa|call|phone|ph|mobile|mob|contact|hr|tel|cell)[\s:.-]*([+0-9() -]{7,22})/gi);
  if (labeledMatches) {
    for (const match of labeledMatches) {
      const rawNum = match.replace(/^(?:whatsapp|wa|call|phone|ph|mobile|mob|contact|hr|tel|cell)[\s:.-]*/i, "").trim();
      const cleanNum = rawNum.replace(/^[^\d+]+|[^\d)]+$/g, "").trim();
      if (isValidPhoneNumber(cleanNum)) {
        phonesSet.add(cleanNum);
      }
    }
  }

  // 3. Match international or standard phone number sequences (+91..., (021)..., 9926640483)
  const phoneMatches = text.match(/(?:\+?\d{1,4}[\s.-]*)?(?:\(?\d{2,4}\)?[\s.-]*)?\d{3,4}[\s.-]*\d{3,4}(?:[\s.-]*\d{1,4})?/g);
  if (phoneMatches) {
    for (let phone of phoneMatches) {
      phone = phone.replace(/^[^\d+]+|[^\d)]+$/g, "").trim();
      if (isValidPhoneNumber(phone)) {
        phonesSet.add(phone);
      }
    }
  }

  return {
    emails: Array.from(emailsSet),
    phones: Array.from(phonesSet),
  };
}

export function getItemContacts(item: FeedItem): ExtractedContacts {
  let combinedText = "";
  if (isTweet(item)) {
    combinedText = `${item.text || ""} ${item.user?.name || ""} ${item.user?.screenName || ""}`;
  } else if (isLinkedin(item)) {
    const isPost = (item as LinkedinPost).content !== undefined;
    if (isPost) {
      combinedText = `${(item as LinkedinPost).content || ""} ${(item as LinkedinPost).authorHeadline || ""}`;
    } else {
      const p = item as LinkedinProfile;
      combinedText = `${p.headline || ""} ${p.currentPosition || ""} ${p.location || ""}`;
    }
  } else if (isFacebook(item)) {
    combinedText = `${item.content || item.text || ""} ${item.authorHeadline || ""} ${item.location || ""}`;
  } else if (isReddit(item)) {
    combinedText = `${item.title || ""} ${item.selftext || ""}`;
  }
  return extractContacts(combinedText);
}

export function WhatsAppIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}

export function ContactBadge({
  type,
  value,
  contextTitle,
  contextText,
  onOpenWhatsAppModal,
}: {
  type: "email" | "phone";
  value: string;
  contextTitle?: string;
  contextText?: string;
  onOpenWhatsAppModal?: (phone: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const actionUrl = type === "email" ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g, "")}`;
  
  // Format normalized WhatsApp direct chat URL with country code prefix
  const normalizedDigits = normalizeWhatsAppNumber(value, contextText);
  const whatsappUrl =
    type === "phone" && normalizedDigits.length >= 7
      ? `https://wa.me/${normalizedDigits}${contextTitle ? `?text=${encodeURIComponent(`Hi, I saw your post regarding "${contextTitle}". Are you still looking for assistance?`)}` : ""}`
      : "";

  return (
    <div className={`contact-badge contact-badge-${type} ${copied ? "is-copied" : ""}`}>
      <span className="contact-icon" aria-hidden>
        {type === "email" ? (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        )}
      </span>

      <a
        href={actionUrl}
        className="contact-value-link"
        onClick={(e) => e.stopPropagation()}
        title={type === "email" ? `Click to send email to ${value}` : `Click to call ${value}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {value}
      </a>

      {/* Direct WhatsApp Chat Action Button */}
      {type === "phone" && (
        <div className="contact-whatsapp-group">
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              className="contact-whatsapp-btn"
              onClick={(e) => e.stopPropagation()}
              title={`Chat on WhatsApp (+${normalizedDigits})`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Chat on WhatsApp with ${value}`}
            >
              <WhatsAppIcon size={12} />
              <span>WhatsApp</span>
            </a>
          )}
          {onOpenWhatsAppModal && (
            <button
              type="button"
              className="contact-whatsapp-edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenWhatsAppModal(value);
              }}
              title="Edit number, country code, or message before opening WhatsApp"
              aria-label="Edit WhatsApp number"
            >
              ✏️
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className="contact-copy-btn"
        onClick={handleCopy}
        title={copied ? "Copied!" : `Copy ${type === "email" ? "Email" : "Phone"}`}
        aria-label={`Copy ${value}`}
      >
        {copied ? (
          <span className="contact-copied-text">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#22c55e" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Copied!</span>
          </span>
        ) : (
          <span className="contact-copy-text">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="13" height="13" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span>Copy</span>
          </span>
        )}
      </button>
    </div>
  );
}

export interface JobHighlight {
  type: "remote" | "onsite" | "hybrid" | "contract" | "rate" | "experience";
  label: string;
  icon: string;
}

export function extractJobHighlights(text?: string): JobHighlight[] {
  if (!text || typeof text !== "string") return [];
  const highlights: JobHighlight[] = [];
  const seenTypes = new Set<string>();

  // 1. Work Mode: Remote / WFH
  if (/\b(remote|remotely|work from home|wfh|100% remote)\b/i.test(text)) {
    highlights.push({ type: "remote", label: "Remote", icon: "🌐" });
    seenTypes.add("remote");
  }

  // 2. Work Mode: Onsite / In-Office
  if (/\b(onsite|on-site|in-office|in office|on premise)\b/i.test(text)) {
    highlights.push({ type: "onsite", label: "Onsite", icon: "🏢" });
    seenTypes.add("onsite");
  }

  // 3. Work Mode: Hybrid
  if (/\b(hybrid|flexible location|\d+\s*days?\s*onsite)\b/i.test(text)) {
    highlights.push({ type: "hybrid", label: "Hybrid", icon: "🔄" });
    seenTypes.add("hybrid");
  }

  // 4. Contract / Job Type: C2C, W2, Contract, Full-time, Freelance, Part-time
  if (/\b(c2c|corp[- ]to[- ]corp|corp2corp)\b/i.test(text)) {
    highlights.push({ type: "contract", label: "C2C", icon: "💼" });
  } else if (/\b(w2)\b/i.test(text)) {
    highlights.push({ type: "contract", label: "W2", icon: "💼" });
  } else if (/\b(contract|freelance|part[- ]time|full[- ]time)\b/i.test(text)) {
    const match = text.match(/\b(contract|freelance|part[- ]time|full[- ]time)\b/i);
    if (match) {
      const formatted = match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
      highlights.push({ type: "contract", label: formatted, icon: "💼" });
    }
  }

  // 5. Rate / Compensation detection (e.g. $65/hr, $120k, $50k-$70k)
  const rateMatch = text.match(/(?:rate\s*[:=]?\s*)?(\$\s*\d+(?:[.,]\d+)?\s*(?:k|K|\/hr|\/hour|\/h|\/month|\/day|\/yr|\/year|\s*-\s*\$\s*\d+(?:[.,]\d+)?\s*(?:k|K|\/hr|\/hour|\/yr|\/year)?))/i);
  if (rateMatch && rateMatch[1]) {
    const cleanRate = rateMatch[1].replace(/\s+/g, " ").trim();
    if (cleanRate.length <= 25) {
      highlights.push({ type: "rate", label: cleanRate, icon: "💵" });
    }
  }

  // 6. Experience requirement (e.g. 5+ years, 7-10 years)
  const expMatch = text.match(/(\d+\+?\s*(?:-\s*\d+)?\s*(?:years?|yrs?)(?:\s+exp(?:erience)?)?)/i);
  if (expMatch && expMatch[1] && !expMatch[1].includes("19") && !expMatch[1].includes("20")) {
    const cleanExp = expMatch[1].replace(/\s+/g, " ").trim();
    if (cleanExp.length <= 18) {
      highlights.push({ type: "experience", label: cleanExp, icon: "⏱️" });
    }
  }

  return highlights;
}

export function getItemJobHighlights(item: FeedItem): JobHighlight[] {
  let combinedText = "";
  if (isTweet(item)) {
    combinedText = `${item.text || ""}`;
  } else if (isLinkedin(item)) {
    const isPost = (item as LinkedinPost).content !== undefined;
    if (isPost) {
      combinedText = `${(item as LinkedinPost).content || ""} ${(item as LinkedinPost).authorHeadline || ""}`;
    } else {
      const p = item as LinkedinProfile;
      combinedText = `${p.headline || ""} ${p.currentPosition || ""} ${p.location || ""}`;
    }
  } else if (isFacebook(item)) {
    combinedText = `${item.content || item.text || ""} ${item.authorHeadline || ""}`;
  } else if (isReddit(item)) {
    combinedText = `${item.title || ""} ${item.selftext || ""}`;
  }
  return extractJobHighlights(combinedText);
}

export function renderHighlightedText(text: string): React.ReactNode {
  if (!text) return null;

  const KEYWORD_REGEX = /(\b(?:remote|remotely|work from home|wfh|100% remote|onsite|on-site|in-office|in office|on premise|hybrid|c2c|corp[- ]to[- ]corp|w2|contract|freelance|full[- ]time|part[- ]time)\b|\$\s*\d+(?:[.,]\d+)?\s*(?:k|K|\/hr|\/hour|\/h|\/month|\/day|\/yr|\/year|\s*-\s*\$\s*\d+(?:[.,]\d+)?\s*(?:k|K|\/hr|\/hour|\/yr|\/year)?)|\b\d+\+?\s*(?:-\s*\d+)?\s*(?:years?|yrs?)(?:\s+exp(?:erience)?)?\b)/gi;

  const parts = text.split(KEYWORD_REGEX);
  if (parts.length <= 1) return text;

  return parts.map((part, idx) => {
    if (!part) return null;
    const lower = part.toLowerCase().trim();

    if (/^(remote|remotely|wfh|work from home|100% remote)$/i.test(lower)) {
      return (
        <mark key={idx} className="kw-tag kw-remote" title="Work Mode: Remote">
          🌐 {part}
        </mark>
      );
    }
    if (/^(onsite|on-site|in-office|in office|on premise)$/i.test(lower)) {
      return (
        <mark key={idx} className="kw-tag kw-onsite" title="Work Mode: Onsite">
          🏢 {part}
        </mark>
      );
    }
    if (/^hybrid$/i.test(lower)) {
      return (
        <mark key={idx} className="kw-tag kw-hybrid" title="Work Mode: Hybrid">
          🔄 {part}
        </mark>
      );
    }
    if (/^(c2c|corp[- ]to[- ]corp|w2|contract|freelance|full[- ]time|part[- ]time)$/i.test(lower)) {
      return (
        <mark key={idx} className="kw-tag kw-contract" title="Contract Type">
          💼 {part}
        </mark>
      );
    }
    if (/^\$/.test(lower)) {
      return (
        <mark key={idx} className="kw-tag kw-rate" title="Compensation / Rate">
          💵 {part}
        </mark>
      );
    }
    if (/years?|yrs?/i.test(lower)) {
      return (
        <mark key={idx} className="kw-tag kw-exp" title="Experience Requirement">
          ⏱️ {part}
        </mark>
      );
    }

    return part;
  });
}

export function JobHighlightsStrip({ highlights }: { highlights: JobHighlight[] }) {
  if (!highlights || highlights.length === 0) return null;

  return (
    <div className="card-highlights-strip">
      {highlights.map((h, idx) => (
        <span key={idx} className={`highlight-pill highlight-${h.type}`}>
          <span className="highlight-icon">{h.icon}</span>
          <span className="highlight-label">{h.label}</span>
        </span>
      ))}
    </div>
  );
}

export function CollapsibleCardText({ text, maxChars = 320 }: { text: string; maxChars?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;

  const isLong = text.length > maxChars || text.split("\n").length > 6;

  if (!isLong) {
    return <p className="card-body-text">{renderHighlightedText(text)}</p>;
  }

  const displayText = expanded ? text : text.slice(0, maxChars) + "…";

  return (
    <div className="card-body-collapsible">
      <p className={`card-body-text ${expanded ? "is-expanded" : "is-collapsed"}`}>
        {renderHighlightedText(displayText)}
      </p>
      <button
        type="button"
        className="read-more-toggle-btn"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        <span>{expanded ? "Show less ▴" : "Read more ▾"}</span>
      </button>
    </div>
  );
}

export function ContactsSection({
  contacts,
  contextTitle,
  contextText,
  onOpenWhatsAppModal,
}: {
  contacts: ExtractedContacts;
  contextTitle?: string;
  contextText?: string;
  onOpenWhatsAppModal?: (phone: string) => void;
}) {
  if (contacts.emails.length === 0 && contacts.phones.length === 0) {
    return null;
  }

  return (
    <div className="card-contacts-bar">
      <div className="contacts-heading">
        <span className="contacts-lead-badge">
          <span className="lead-dot" /> Contact Leads
        </span>
        <span className="contacts-counts">
          {contacts.emails.length > 0 && `${contacts.emails.length} email${contacts.emails.length > 1 ? "s" : ""}`}
          {contacts.emails.length > 0 && contacts.phones.length > 0 && " · "}
          {contacts.phones.length > 0 && `${contacts.phones.length} phone${contacts.phones.length > 1 ? "s" : ""}`}
        </span>
      </div>
      <div className="contacts-chips-list">
        {contacts.emails.map((email) => (
          <ContactBadge key={email} type="email" value={email} />
        ))}
        {contacts.phones.map((phone) => (
          <ContactBadge
            key={phone}
            type="phone"
            value={phone}
            contextTitle={contextTitle}
            contextText={contextText}
            onOpenWhatsAppModal={onOpenWhatsAppModal}
          />
        ))}
      </div>
    </div>
  );
}

export function Badge({ type, time }: { type: "x" | "reddit" | "linkedin" | "facebook"; time?: string }) {
  return (
    <div className={`platform-badge badge-${type}`}>
      <span className="badge-icon">
        {type === "x" && <XIcon size={11} />}
        {type === "reddit" && <RedditIcon size={12} />}
        {type === "linkedin" && <LinkedinIcon size={12} />}
        {type === "facebook" && <FacebookIcon size={12} />}
      </span>
      <span className="badge-label">
        {type === "x" ? "X" : type === "reddit" ? "Reddit" : type === "linkedin" ? "LinkedIn" : "Facebook"}
      </span>
      {time && <span className="badge-time">· {time}</span>}
    </div>
  );
}

function CopyButton({ text, title = "Copy text" }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      className={`copy-post-btn ${copied ? "copied" : ""}`}
      onClick={handleCopy}
      title={copied ? "Copied to clipboard!" : title}
      aria-label={copied ? "Copied" : "Copy text"}
    >
      {copied ? (
        <>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="copy-tooltip">Copied!</span>
        </>
      ) : (
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect width="13" height="13" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
    </button>
  );
}

function WriteProposalButton({
  onClick,
  title = "Write job proposal using AI",
}: {
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="write-proposal-post-btn"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      title={title}
      aria-label="Write AI proposal"
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}

function ViewProposalButton({
  onClick,
  title = "View the saved proposal for this applied job",
}: {
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="view-proposal-btn"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      title={title}
      aria-label="View saved proposal"
    >
      <span>📄</span>
      <span className="view-proposal-label">Proposal</span>
    </button>
  );
}

function ApplyWithAIButton({
  onClick,
  isApplied,
}: {
  onClick: () => void;
  isApplied?: boolean;
}) {
  return (
    <button
      type="button"
      className={`apply-with-ai-btn ${isApplied ? "is-applied" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      title="Write a tailored job proposal with AI"
      aria-label="Apply with AI"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="m5.6 5.6 2.1 2.1" />
        <path d="m16.3 16.3 2.1 2.1" />
        <path d="m18.4 5.6-2.1 2.1" />
        <path d="m7.7 16.3-2.1 2.1" />
      </svg>
      <span>{isApplied ? "Applied · Regenerate with AI" : "Apply with AI"}</span>
    </button>
  );
}

function OpenLink({ url }: { url: string }) {  return (
    <a
      className="open-link-btn"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title="Open external post"
      aria-label="Open post in new tab"
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </a>
  );
}

function DismissButton({ onDismiss, title = "Dismiss card" }: { onDismiss: () => void; title?: string }) {
  return (
    <button
      type="button"
      className="dismiss-post-btn"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onDismiss();
      }}
      title={title}
      aria-label="Dismiss card"
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}

function MarkAppliedButton({
  isApplied,
  onToggle,
}: {
  isApplied?: boolean;
  onToggle?: () => void;
}) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      className={`mark-applied-btn ${isApplied ? "is-applied" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      title={isApplied ? "Marked as Applied! Click to unmark" : "Mark as Applied (saved to local storage)"}
      aria-label={isApplied ? "Marked as Applied" : "Mark as Applied"}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span className="mark-applied-label">{isApplied ? "Applied" : "Apply"}</span>
    </button>
  );
}

function WhatsAppCardButton({
  onClick,
  hasPhone,
}: {
  onClick: () => void;
  hasPhone?: boolean;
}) {
  return (
    <button
      type="button"
      className={`card-whatsapp-quick-btn ${hasPhone ? "has-phone" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      title={hasPhone ? "Open / chat on WhatsApp" : "Open in WhatsApp (enter or edit phone number)"}
      aria-label="Open in WhatsApp"
    >
      <WhatsAppIcon size={14} />
    </button>
  );
}

function CardCheckbox({
  isSelected,
  onToggle,
  title = "Select post for bulk actions",
}: {
  isSelected?: boolean;
  onToggle?: () => void;
  title?: string;
}) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      className={`card-select-checkbox ${isSelected ? "is-selected" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      title={isSelected ? "Deselect this post" : title}
      aria-label="Select post for bulk actions"
      aria-checked={isSelected}
      role="checkbox"
    >
      <span className="checkbox-box">
        {isSelected && (
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
    </button>
  );
}

function CardBottomActions({
  item,
  isApplied,
  savedProposal,
  copyContent,
  contextTitle,
  url,
  contacts,
  onToggleApplied,
  onViewProposal,
  onWriteProposal,
  onOpenWhatsApp,
  onDismiss,
}: {
  item: FeedItem;
  isApplied?: boolean;
  savedProposal?: string;
  copyContent: string;
  contextTitle: string;
  url: string;
  contacts: { emails: string[]; phones: string[] };
  onToggleApplied?: (id: string) => void;
  onViewProposal?: (proposal: string, title?: string) => void;
  onWriteProposal?: (
    jobText: string,
    jobTitle?: string,
    jobUrl?: string,
    recipientEmail?: string,
    jobId?: string,
    recipientPhone?: string
  ) => void;
  onOpenWhatsApp?: (item: FeedItem, phone?: string) => void;
  onDismiss?: (id: string) => void;
}) {
  return (
    <div className="card-bottom-actions-wrap">
      {onWriteProposal && (
        <ApplyWithAIButton
          isApplied={isApplied}
          onClick={() =>
            onWriteProposal(
              copyContent,
              contextTitle,
              url,
              contacts.emails[0],
              item.id,
              contacts.phones[0]
            )
          }
        />
      )}
      <div className="card-actions card-bottom-actions-toolbar">
        <MarkAppliedButton
          isApplied={isApplied}
          onToggle={onToggleApplied ? () => onToggleApplied(item.id) : undefined}
        />
        {isApplied && savedProposal && onViewProposal && (
          <ViewProposalButton onClick={() => onViewProposal(savedProposal, contextTitle)} />
        )}
        {onWriteProposal && (
          <WriteProposalButton
            onClick={() =>
              onWriteProposal(
                copyContent,
                contextTitle,
                url,
                contacts.emails[0],
                item.id,
                contacts.phones[0]
              )
            }
          />
        )}
        {onOpenWhatsApp && (
          <WhatsAppCardButton
            onClick={() => onOpenWhatsApp(item, contacts.phones[0])}
            hasPhone={contacts.phones.length > 0}
          />
        )}
        <CopyButton text={copyContent} title="Copy post content" />
        {url && <OpenLink url={url} />}
        {onDismiss && (
          <DismissButton onDismiss={() => onDismiss(item.id)} title="Dismiss card" />
        )}
      </div>
    </div>
  );
}

export default function FeedCard({
  item,
  isApplied,
  isSelected,
  onToggleApplied,
  onToggleSelect,
  onDismiss,
  onWriteProposal,
  savedProposal,
  onViewProposal,
  onOpenWhatsApp,
}: {
  item: FeedItem;
  isApplied?: boolean;
  isSelected?: boolean;
  onToggleApplied?: (id: string) => void;
  onToggleSelect?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onWriteProposal?: (jobText: string, jobTitle?: string, jobUrl?: string, recipientEmail?: string, jobId?: string, recipientPhone?: string) => void;
  savedProposal?: string;
  onViewProposal?: (proposal: string, title?: string) => void;
  onOpenWhatsApp?: (item: FeedItem, phone?: string) => void;
}) {

  const contacts = getItemContacts(item);
  const highlights = getItemJobHighlights(item);

  /* ================== LINKEDIN CARD ================== */
  if (isLinkedin(item)) {
    const p = item as LinkedinProfile | LinkedinPost;
    const isPost = (p as LinkedinPost).content !== undefined;
    const authorName = isPost
      ? (p as LinkedinPost).authorName
      : `${(p as LinkedinProfile).firstName} ${(p as LinkedinProfile).lastName}`;
    const authorHeadline = isPost
      ? (p as LinkedinPost).authorHeadline
      : (p as LinkedinProfile).headline;
    const avatar = isPost ? (p as LinkedinPost).authorPicture : (p as LinkedinProfile).profilePicture;
    const time = isPost ? timeAgo((p as LinkedinPost).postedAt) : timeAgo(p.createdAt);
    const copyContent = isPost ? (p as LinkedinPost).content : `${authorName} - ${authorHeadline || ""}`;

    return (
      <article className={`feed-card feed-card-linkedin ${isApplied ? "is-applied-card" : ""} ${isSelected ? "is-selected-card" : ""}`}>
        {/* Top Bar: Badge & Actions */}
        <div className="card-top-bar">
          <div className="card-badges-group">
            <CardCheckbox
              isSelected={isSelected}
              onToggle={onToggleSelect ? () => onToggleSelect(item.id) : undefined}
            />
            <Badge type="linkedin" time={time} />
            {isApplied && (
              <span className="applied-tag-badge" title="You marked this job as applied">
                ✓ Applied
              </span>
            )}
          </div>
          <div className="card-actions">
            <MarkAppliedButton
              isApplied={isApplied}
              onToggle={onToggleApplied ? () => onToggleApplied(item.id) : undefined}
            />
            {isApplied && savedProposal && onViewProposal && (
              <ViewProposalButton onClick={() => onViewProposal(savedProposal)} />
            )}
            {onWriteProposal && (
              <WriteProposalButton
                onClick={() => onWriteProposal(copyContent, authorHeadline || "LinkedIn Job Post", p.linkedinUrl, contacts.emails[0], item.id, contacts.phones[0])}
              />
            )}
            {onOpenWhatsApp && (
              <WhatsAppCardButton
                onClick={() => onOpenWhatsApp(item, contacts.phones[0])}
                hasPhone={contacts.phones.length > 0}
              />
            )}
            <CopyButton text={copyContent} title="Copy post content" />
            <OpenLink url={p.linkedinUrl} />
            {onDismiss && <DismissButton onDismiss={() => onDismiss(item.id)} />}
          </div>
        </div>

        {/* Author Row */}
        <div className="card-author-row">
          {avatar ? (
            <img className="card-avatar avatar-img" src={avatar} alt="" loading="lazy" />
          ) : (
            <div className="card-avatar avatar-linkedin" aria-hidden>
              {authorName?.[0]?.toUpperCase() ?? "L"}
            </div>
          )}
          <div className="author-meta">
            <div className="author-name">
              <a href={p.linkedinUrl} target="_blank" rel="noreferrer">
                {authorName}
              </a>
            </div>
            {authorHeadline && (
              <div className="author-sub author-headline" title={authorHeadline}>
                {authorHeadline}
              </div>
            )}
          </div>
        </div>

        {/* Job Highlights Strip (Remote, Onsite, Hybrid, C2C, Rate, etc.) */}
        <JobHighlightsStrip highlights={highlights} />

        {/* Card Body */}
        {isPost && (
          <p className="card-body-text">
            {renderHighlightedText((p as LinkedinPost).content)}
          </p>
        )}

        {!isPost && (p as LinkedinProfile).currentPosition && (
          <div className="profile-highlight">
            <span className="profile-highlight-icon">💼</span>
            <span>Currently at {(p as LinkedinProfile).currentPosition}</span>
          </div>
        )}

        {/* Contacts & Leads */}
        <ContactsSection
          contacts={contacts}
          contextTitle={authorHeadline || authorName}
          contextText={copyContent}
          onOpenWhatsAppModal={onOpenWhatsApp ? (ph) => onOpenWhatsApp(item, ph) : undefined}
        />

        {/* Card Metrics */}
        <div className="card-metrics">
          {isPost ? (
            <>
              <span className="metric-item" title="Reactions">
                <span className="metric-icon">👍</span>
                <span>{formatCount((p as LinkedinPost).likes)}</span>
              </span>
              <span className="metric-item" title="Comments">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                </svg>
                <span>{formatCount((p as LinkedinPost).comments)}</span>
              </span>
              <span className="metric-item" title="Shares / Reposts">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m17 2 4 4-4 4" />
                  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                  <path d="m7 22-4-4 4-4" />
                  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                </svg>
                <span>{formatCount((p as LinkedinPost).shares)}</span>
              </span>
            </>
          ) : (
            (p as LinkedinProfile).location && (
              <span className="metric-item location-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>{(p as LinkedinProfile).location}</span>
              </span>
            )
          )}
        </div>
        <CardBottomActions
          item={item}
          isApplied={isApplied}
          savedProposal={savedProposal}
          copyContent={copyContent}
          contextTitle={authorHeadline || authorName || "LinkedIn Job Post"}
          url={p.linkedinUrl}
          contacts={contacts}
          onToggleApplied={onToggleApplied}
          onViewProposal={onViewProposal}
          onWriteProposal={onWriteProposal}
          onOpenWhatsApp={onOpenWhatsApp}
          onDismiss={onDismiss}
        />
      </article>
    );
  }

  /* ================== FACEBOOK CARD ================== */
  if (isFacebook(item)) {
    const fb = item as FacebookPost;
    const authorName = fb.authorName || fb.pageName || "Facebook User";
    const avatar = fb.authorPicture;
    const time = fb.postedAt ? timeAgo(fb.postedAt) : timeAgo(fb.createdAt);
    const content = fb.content || fb.text || "";
    const postUrl = fb.url || fb.pageUrl || "https://www.facebook.com";

    return (
      <article className={`feed-card feed-card-facebook ${isApplied ? "is-applied-card" : ""} ${isSelected ? "is-selected-card" : ""}`}>
        {/* Top Bar: Badge & Actions */}
        <div className="card-top-bar">
          <div className="card-badges-group">
            <CardCheckbox
              isSelected={isSelected}
              onToggle={onToggleSelect ? () => onToggleSelect(item.id) : undefined}
            />
            <Badge type="facebook" time={time} />
            {isApplied && (
              <span className="applied-tag-badge" title="You marked this job as applied">
                ✓ Applied
              </span>
            )}
          </div>
          <div className="card-actions">
            <MarkAppliedButton
              isApplied={isApplied}
              onToggle={onToggleApplied ? () => onToggleApplied(item.id) : undefined}
            />
            {isApplied && savedProposal && onViewProposal && (
              <ViewProposalButton onClick={() => onViewProposal(savedProposal)} />
            )}
            {onWriteProposal && (
              <WriteProposalButton
                onClick={() => onWriteProposal(content, authorName + " - Facebook Post", postUrl, contacts.emails[0], item.id, contacts.phones[0])}
              />
            )}
            {onOpenWhatsApp && (
              <WhatsAppCardButton
                onClick={() => onOpenWhatsApp(item, contacts.phones[0])}
                hasPhone={contacts.phones.length > 0}
              />
            )}
            <CopyButton text={content || postUrl} title="Copy Facebook post" />
            <OpenLink url={postUrl} />
            {onDismiss && <DismissButton onDismiss={() => onDismiss(item.id)} />}
          </div>
        </div>

        {/* Author Row */}
        <div className="card-author-row">
          {avatar ? (
            <img className="card-avatar avatar-img" src={avatar} alt="" loading="lazy" />
          ) : (
            <div className="card-avatar avatar-facebook" style={{ background: "#1877F2", color: "#fff", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }} aria-hidden>
              {authorName?.[0]?.toUpperCase() ?? "F"}
            </div>
          )}
          <div className="author-meta">
            <div className="author-name">
              <a href={postUrl} target="_blank" rel="noreferrer">
                {authorName}
              </a>
            </div>
            {fb.location && (
              <div className="author-sub author-headline">
                {fb.location}
              </div>
            )}
          </div>
        </div>

        {/* Job Highlights Strip */}
        <JobHighlightsStrip highlights={highlights} />

        {/* Card Body */}
        {content && (
          <p className="card-body-text">
            {renderHighlightedText(content)}
          </p>
        )}

        {/* Contacts & Leads */}
        <ContactsSection
          contacts={contacts}
          contextTitle={authorName + " - Facebook Post"}
          contextText={content}
          onOpenWhatsAppModal={onOpenWhatsApp ? (ph) => onOpenWhatsApp(item, ph) : undefined}
        />

        {/* Card Metrics */}
        <div className="card-metrics">
          <span className="metric-item" title="Reactions">
            <span className="metric-icon">👍</span>
            <span>{formatCount(fb.likes)}</span>
          </span>
          <span className="metric-item" title="Comments">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
            <span>{formatCount(fb.comments)}</span>
          </span>
          <span className="metric-item" title="Shares">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m17 2 4 4-4 4" />
              <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
              <path d="m7 22-4-4 4-4" />
              <path d="M21 13v1a4 4 0 0 1-4 4H3" />
            </svg>
            <span>{formatCount(fb.shares)}</span>
          </span>
        </div>
        <CardBottomActions
          item={item}
          isApplied={isApplied}
          savedProposal={savedProposal}
          copyContent={content}
          contextTitle={authorName + " - Facebook Post"}
          url={postUrl}
          contacts={contacts}
          onToggleApplied={onToggleApplied}
          onViewProposal={onViewProposal}
          onWriteProposal={onWriteProposal}
          onOpenWhatsApp={onOpenWhatsApp}
          onDismiss={onDismiss}
        />
      </article>
    );
  }

  /* ================== X / TWITTER CARD ================== */
  if (isTweet(item)) {
    const tweet = item as XTweet;
    const time = timeAgo(tweet.createdAt);

    return (
      <article className={`feed-card feed-card-x ${isApplied ? "is-applied-card" : ""} ${isSelected ? "is-selected-card" : ""}`}>
        {/* Top Bar: Badge & Actions */}
        <div className="card-top-bar">
          <div className="card-badges-group">
            <CardCheckbox
              isSelected={isSelected}
              onToggle={onToggleSelect ? () => onToggleSelect(item.id) : undefined}
            />
            <Badge type="x" time={time} />
            {isApplied && (
              <span className="applied-tag-badge" title="You marked this job as applied">
                ✓ Applied
              </span>
            )}
          </div>
          <div className="card-actions">
            <MarkAppliedButton
              isApplied={isApplied}
              onToggle={onToggleApplied ? () => onToggleApplied(item.id) : undefined}
            />
            {isApplied && savedProposal && onViewProposal && (
              <ViewProposalButton onClick={() => onViewProposal(savedProposal)} />
            )}
            {onWriteProposal && (
              <WriteProposalButton
                onClick={() => onWriteProposal(tweet.text, "Tweet by @" + (tweet.user?.screenName || "unknown"), tweet.url, contacts.emails[0], item.id, contacts.phones[0])}
              />
            )}
            {onOpenWhatsApp && (
              <WhatsAppCardButton
                onClick={() => onOpenWhatsApp(item, contacts.phones[0])}
                hasPhone={contacts.phones.length > 0}
              />
            )}
            <CopyButton text={tweet.text} title="Copy tweet text" />
            <OpenLink url={tweet.url} />
            {onDismiss && <DismissButton onDismiss={() => onDismiss(item.id)} />}
          </div>
        </div>

        {/* Author Row */}
        <div className="card-author-row">
          <div className="card-avatar avatar-x" aria-hidden>
            {tweet.user?.screenName?.[0]?.toUpperCase() ?? "X"}
          </div>
          <div className="author-meta">
            <div className="author-name">
              <a href={tweet.url} target="_blank" rel="noreferrer">
                {tweet.user?.name ?? "Unknown"}
              </a>
            </div>
            <div className="author-sub">
              @{tweet.user?.screenName ?? "unknown"}
            </div>
          </div>
        </div>

        {/* Job Highlights Strip */}
        <JobHighlightsStrip highlights={highlights} />

        {/* Card Body */}
        <p className="card-body-text">
          {renderHighlightedText(tweet.text)}
        </p>

        {/* Contacts & Leads */}
        <ContactsSection
          contacts={contacts}
          contextTitle={"Tweet by @" + (tweet.user?.screenName || "unknown")}
          contextText={tweet.text}
          onOpenWhatsAppModal={onOpenWhatsApp ? (ph) => onOpenWhatsApp(item, ph) : undefined}
        />

        {/* Media Grid */}
        {tweet.media && tweet.media.length > 0 && (
          <div className={`media-grid media-count-${Math.min(tweet.media.length, 4)}`}>
            {tweet.media.slice(0, 4).map((url, idx) => (
              <a
                key={url}
                href={tweet.url}
                target="_blank"
                rel="noreferrer"
                className="media-item"
              >
                <img
                  src={url.replace("_normal", "")}
                  alt={`Tweet media ${idx + 1}`}
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        )}

        {/* Metrics */}
        <div className="card-metrics">
          <span className="metric-item" title="Replies">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
            <span>{formatCount(tweet.replyCount)}</span>
          </span>
          <span className="metric-item" title="Retweets">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m17 2 4 4-4 4" />
              <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
              <path d="m7 22-4-4 4-4" />
              <path d="M21 13v1a4 4 0 0 1-4 4H3" />
            </svg>
            <span>{formatCount(tweet.retweetCount)}</span>
          </span>
          <span className="metric-item" title="Likes">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
            </svg>
            <span>{formatCount(tweet.likeCount)}</span>
          </span>
          {tweet.viewCount !== undefined && tweet.viewCount > 0 && (
            <span className="metric-item" title="Views">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>{formatCount(tweet.viewCount)}</span>
            </span>
          )}
        </div>
        <CardBottomActions
          item={item}
          isApplied={isApplied}
          savedProposal={savedProposal}
          copyContent={tweet.text}
          contextTitle={"Tweet by @" + (tweet.user?.screenName || "unknown")}
          url={tweet.url}
          contacts={contacts}
          onToggleApplied={onToggleApplied}
          onViewProposal={onViewProposal}
          onWriteProposal={onWriteProposal}
          onOpenWhatsApp={onOpenWhatsApp}
          onDismiss={onDismiss}
        />
      </article>
    );
  }

  /* ================== REDDIT CARD ================== */
  const post = item as RedditPost;
  const time = timeAgo(post.createdAt);
  const hasValidThumbnail =
    post.thumbnail &&
    post.thumbnail.startsWith("http") &&
    !["default", "self", "nsfw", "image"].includes(post.thumbnail);
  const redditCopyText = `${post.title}${post.selftext ? `\n\n${post.selftext}` : ""}`.trim();

  return (
    <article className={`feed-card feed-card-reddit ${isApplied ? "is-applied-card" : ""} ${isSelected ? "is-selected-card" : ""}`}>
      {/* Top Bar: Badge & Actions */}
      <div className="card-top-bar">
        <div className="card-badges-group">
          <CardCheckbox
            isSelected={isSelected}
            onToggle={onToggleSelect ? () => onToggleSelect(item.id) : undefined}
          />
          <Badge type="reddit" time={time} />
          {isApplied && (
            <span className="applied-tag-badge" title="You marked this job as applied">
              ✓ Applied
            </span>
          )}
        </div>
        <div className="card-actions">
          <MarkAppliedButton
            isApplied={isApplied}
            onToggle={onToggleApplied ? () => onToggleApplied(item.id) : undefined}
          />
          {isApplied && savedProposal && onViewProposal && (
            <ViewProposalButton onClick={() => onViewProposal(savedProposal)} />
          )}
          {onWriteProposal && (
            <WriteProposalButton
              onClick={() => onWriteProposal(redditCopyText, post.title, post.url, contacts.emails[0], item.id, contacts.phones[0])}
            />
          )}
          {onOpenWhatsApp && (
            <WhatsAppCardButton
              onClick={() => onOpenWhatsApp(item, contacts.phones[0])}
              hasPhone={contacts.phones.length > 0}
            />
          )}
          <CopyButton text={redditCopyText} title="Copy Reddit post" />
          <OpenLink url={post.url} />
          {onDismiss && <DismissButton onDismiss={() => onDismiss(item.id)} />}
        </div>
      </div>

      {/* Author Row */}
      <div className="card-author-row">
        <div className="card-avatar avatar-reddit" aria-hidden>
          r/
        </div>
        <div className="author-meta">
          <div className="author-name">
            <a href={post.url} target="_blank" rel="noreferrer" className="subreddit-link">
              r/{post.subreddit}
            </a>
          </div>
          <div className="author-sub">
            u/{post.author}
          </div>
        </div>
      </div>

      {/* Post Title */}
      <h3 className="reddit-post-title">
        <a href={post.url} target="_blank" rel="noreferrer">
          {renderHighlightedText(post.title)}
        </a>
      </h3>

      {/* Job Highlights Strip */}
      <JobHighlightsStrip highlights={highlights} />

      {/* Post Body */}
      {post.selftext && (
        <p className="card-body-text reddit-selftext">
          {renderHighlightedText(post.selftext)}
        </p>
      )}

      {/* Contacts & Leads */}
      <ContactsSection
        contacts={contacts}
        contextTitle={post.title}
        contextText={redditCopyText}
        onOpenWhatsAppModal={onOpenWhatsApp ? (ph) => onOpenWhatsApp(item, ph) : undefined}
      />

      {/* Thumbnail / Image */}
      {hasValidThumbnail && (
        <div className="reddit-media">
          <a href={post.url} target="_blank" rel="noreferrer">
            <img src={post.thumbnail} alt="" loading="lazy" />
          </a>
        </div>
      )}

      {/* Metrics */}
      <div className="card-metrics">
        <span className="metric-item upvote-item" title="Upvotes">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m18 15-6-6-6 6" />
          </svg>
          <span>{formatCount(post.score)}</span>
        </span>
        <span className="metric-item" title="Comments">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
          <span>{formatCount(post.numComments)}</span>
        </span>
      </div>
      <CardBottomActions
        item={item}
        isApplied={isApplied}
        savedProposal={savedProposal}
        copyContent={redditCopyText}
        contextTitle={post.title}
        url={post.url}
        contacts={contacts}
        onToggleApplied={onToggleApplied}
        onViewProposal={onViewProposal}
        onWriteProposal={onWriteProposal}
        onOpenWhatsApp={onOpenWhatsApp}
        onDismiss={onDismiss}
      />
    </article>
  );
}