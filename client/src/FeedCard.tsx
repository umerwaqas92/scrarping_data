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

function formatCount(n?: number): string {
  if (n === undefined || n === null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(s?: string): string {
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

  // Reject numeric ranges like 100-200, 2024-2025
  if (/^\d{2,4}\s*[-/]\s*\d{2,4}$/.test(trimmed)) return false;

  // Reject repetitive digits e.g. 00000000, 11111111
  if (/^(\d)\1+$/.test(digits)) return false;

  // If not starting with '+', require punctuation formatting or minimum 10 digits
  if (!trimmed.startsWith("+") && !/[() -.]/.test(trimmed) && digits.length < 10) return false;

  return true;
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
  // Match international or standard phone number sequences
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

export function ContactBadge({ type, value }: { type: "email" | "phone"; value: string }) {
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

export function ContactsSection({ contacts }: { contacts: ExtractedContacts }) {
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
          <ContactBadge key={phone} type="phone" value={phone} />
        ))}
      </div>
    </div>
  );
}

function Badge({ type, time }: { type: "x" | "reddit" | "linkedin" | "facebook"; time?: string }) {
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

function OpenLink({ url }: { url: string }) {
  return (
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

export default function FeedCard({ item }: { item: FeedItem }) {
  const contacts = getItemContacts(item);

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
      <article className="feed-card feed-card-linkedin">
        {/* Card Header */}
        <div className="card-header">
          <div className="author-row">
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

          <div className="header-meta">
            <Badge type="linkedin" time={time} />
            <CopyButton text={copyContent} title="Copy post content" />
            <OpenLink url={p.linkedinUrl} />
          </div>
        </div>

        {/* Card Body */}
        {isPost && (
          <p className="card-body-text">
            {(p as LinkedinPost).content}
          </p>
        )}

        {!isPost && (p as LinkedinProfile).currentPosition && (
          <div className="profile-highlight">
            <span className="profile-highlight-icon">💼</span>
            <span>Currently at {(p as LinkedinProfile).currentPosition}</span>
          </div>
        )}

        {/* Contacts & Leads */}
        <ContactsSection contacts={contacts} />

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
      <article className="feed-card feed-card-facebook">
        {/* Card Header */}
        <div className="card-header">
          <div className="author-row">
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

          <div className="header-meta">
            <Badge type="facebook" time={time} />
            <CopyButton text={content || postUrl} title="Copy Facebook post" />
            <OpenLink url={postUrl} />
          </div>
        </div>

        {/* Card Body */}
        {content && (
          <p className="card-body-text">
            {content}
          </p>
        )}

        {/* Contacts & Leads */}
        <ContactsSection contacts={contacts} />

        {/* Card Metrics */}
        <div className="card-metrics">
          <span className="metric-item" title="Likes">
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
      </article>
    );
  }

  /* ================== X / TWITTER CARD ================== */
  if (isTweet(item)) {
    const tweet = item as XTweet;
    const time = timeAgo(tweet.createdAt);

    return (
      <article className="feed-card feed-card-x">
        {/* Card Header */}
        <div className="card-header">
          <div className="author-row">
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

          <div className="header-meta">
            <Badge type="x" time={time} />
            <CopyButton text={tweet.text} title="Copy tweet text" />
            <OpenLink url={tweet.url} />
          </div>
        </div>

        {/* Card Body */}
        <p className="card-body-text">{tweet.text}</p>

        {/* Contacts & Leads */}
        <ContactsSection contacts={contacts} />

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
    <article className="feed-card feed-card-reddit">
      {/* Card Header */}
      <div className="card-header">
        <div className="author-row">
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

        <div className="header-meta">
          <Badge type="reddit" time={time} />
          <CopyButton text={redditCopyText} title="Copy Reddit post" />
          <OpenLink url={post.url} />
        </div>
      </div>

      {/* Post Title */}
      <h3 className="reddit-post-title">
        <a href={post.url} target="_blank" rel="noreferrer">
          {post.title}
        </a>
      </h3>

      {/* Post Body */}
      {post.selftext && (
        <p className="card-body-text reddit-selftext">
          {post.selftext.length > 500 ? post.selftext.slice(0, 500) + "…" : post.selftext}
        </p>
      )}

      {/* Contacts & Leads */}
      <ContactsSection contacts={contacts} />

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
    </article>
  );
}