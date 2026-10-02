import { useState } from "react";
import {
  FeedItem,
  getItemMeta,
  getItemContacts,
  getItemJobHighlights,
  renderHighlightedText,
  Badge,
  WhatsAppIcon,
  LinkedinIcon,
  RedditIcon,
  XIcon,
  FacebookIcon,
  normalizeWhatsAppNumber,
  ContactBadge,
  JobHighlightsStrip,
  timeAgo,
} from "./FeedCard";

export interface AppliedJobRecord {
  id: string;
  title?: string;
  url?: string;
  source?: string;
  author?: string;
  content?: string;
  proposal?: string;
  note?: string;
  appliedAt: string;
  updatedAt?: string;
  item?: FeedItem;
}

interface AppliedJobCompactCardProps {
  entry: AppliedJobRecord;
  onOpenDetails: (entry: AppliedJobRecord) => void;
  onUnmarkApplied: (id: string, title?: string) => void;
  onOpenWhatsApp?: (item: FeedItem, phone?: string) => void;
  onViewProposal?: (proposal: string, title?: string) => void;
  onWriteProposal?: (
    jobText: string,
    jobTitle?: string,
    jobUrl?: string,
    recipientEmail?: string,
    jobId?: string,
    recipientPhone?: string
  ) => void;
}

export function AppliedJobCompactCard({
  entry,
  onOpenDetails,
  onUnmarkApplied,
  onOpenWhatsApp,
  onViewProposal,
}: AppliedJobCompactCardProps) {
  const item = entry.item;
  const meta = item ? getItemMeta(item) : undefined;
  const contacts = item ? getItemContacts(item) : { emails: [], phones: [] };
  const highlights = item ? getItemJobHighlights(item) : [];

  const authorName = entry.author || meta?.author || "Author";
  const jobTitle = entry.title || meta?.title || "Applied Job Post";
  const postUrl = entry.url || meta?.url || "";
  const postContent = meta?.content || "";
  const platform = (entry.source || meta?.source || "linkedin") as "x" | "reddit" | "linkedin" | "facebook";

  // Time representation
  const appliedDateStr = entry.appliedAt
    ? timeAgo(entry.appliedAt) || new Date(entry.appliedAt).toLocaleDateString()
    : "Recently";

  // First phone for quick WhatsApp chat
  const primaryPhone = contacts.phones[0];
  const normalizedPhone = primaryPhone ? normalizeWhatsAppNumber(primaryPhone, postContent || jobTitle) : "";

  return (
    <div
      className="applied-compact-card"
      onClick={() => onOpenDetails(entry)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetails(entry);
        }
      }}
      aria-label={`View applied job details for ${jobTitle}`}
    >
      {/* Card Header Row */}
      <div className="compact-card-header">
        <div className="compact-author-group">
          <div className={`compact-avatar compact-avatar-${platform}`} aria-hidden>
            {authorName[0]?.toUpperCase() ?? "A"}
          </div>
          <div className="compact-author-meta">
            <span className="compact-author-name">{authorName}</span>
            <span className="compact-applied-time">✓ Applied {appliedDateStr}</span>
          </div>
        </div>

        <div className="compact-header-actions" onClick={(e) => e.stopPropagation()}>
          <Badge type={platform} />
          <button
            type="button"
            className="compact-unapply-btn"
            onClick={() => onUnmarkApplied(entry.id, jobTitle)}
            title="Remove from applied list"
            aria-label="Remove from applied"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Title & Preview Body */}
      <div className="compact-card-body">
        <h4 className="compact-job-title" title={jobTitle}>
          {jobTitle}
        </h4>
        {postContent && (
          <p className="compact-snippet-text">
            {postContent.replace(/\s+/g, " ").trim().slice(0, 160)}...
          </p>
        )}
      </div>

      {/* Badges / Highlights Strip */}
      <div className="compact-badges-strip">
        {highlights.slice(0, 2).map((h) => (
          <span key={h.type} className={`compact-mini-badge badge-${h.type}`}>
            <span>{h.icon}</span>
            <span>{h.label}</span>
          </span>
        ))}

        {contacts.emails.length > 0 && (
          <span className="compact-mini-badge badge-email-lead" title={`${contacts.emails.length} email lead found`}>
            <span>✉️</span>
            <span>{contacts.emails[0]}</span>
          </span>
        )}

        {contacts.phones.length > 0 && (
          <span className="compact-mini-badge badge-phone-lead" title={`${contacts.phones.length} phone lead found`}>
            <span>📞</span>
            <span>{contacts.phones[0]}</span>
          </span>
        )}

        {entry.proposal && (
          <span className="compact-mini-badge badge-has-proposal" title="AI Proposal generated & attached">
            <span>📄</span>
            <span>Proposal</span>
          </span>
        )}

        {entry.note && (
          <span className="compact-mini-badge badge-has-note" title="Personal note saved">
            <span>📝</span>
            <span>Note</span>
          </span>
        )}
      </div>

      {/* Quick Actions Footer */}
      <div className="compact-card-footer" onClick={(e) => e.stopPropagation()}>
        <div className="compact-footer-left">
          {primaryPhone && onOpenWhatsApp && item && (
            <button
              type="button"
              className="compact-action-btn btn-whatsapp-pill"
              onClick={() => onOpenWhatsApp(item, primaryPhone)}
              title={`Chat on WhatsApp (+${normalizedPhone || primaryPhone})`}
            >
              <WhatsAppIcon size={12} />
              <span>WhatsApp</span>
            </button>
          )}

          {entry.proposal && onViewProposal && (
            <button
              type="button"
              className="compact-action-btn btn-proposal-pill"
              onClick={() => onViewProposal(entry.proposal || "", jobTitle)}
              title="View saved AI proposal"
            >
              <span>📄 Proposal</span>
            </button>
          )}

          {postUrl && (
            <a
              href={postUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="compact-action-btn btn-link-pill"
              title="Open original post in new tab"
            >
              <span>Post ↗</span>
            </a>
          )}
        </div>

        <button
          type="button"
          className="compact-open-details-btn"
          onClick={() => onOpenDetails(entry)}
        >
          <span>View Details</span>
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

interface AppliedJobDetailModalProps {
  open: boolean;
  entry: AppliedJobRecord | null;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
  onSaveNote: (id: string, note: string) => void;
  onClose: () => void;
  onUnmarkApplied: (id: string, title?: string) => void;
  onOpenWhatsApp?: (item: FeedItem, phone?: string) => void;
  onWriteProposal?: (
    jobText: string,
    jobTitle?: string,
    jobUrl?: string,
    recipientEmail?: string,
    jobId?: string,
    recipientPhone?: string
  ) => void;
}

export function AppliedJobDetailModal({
  open,
  entry,
  noteDraft,
  onNoteDraftChange,
  onSaveNote,
  onClose,
  onUnmarkApplied,
  onOpenWhatsApp,
  onWriteProposal,
}: AppliedJobDetailModalProps) {
  const [copiedProposal, setCopiedProposal] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  if (!open || !entry) return null;

  const item = entry.item;
  const meta = item ? getItemMeta(item) : undefined;
  const contacts = item ? getItemContacts(item) : { emails: [], phones: [] };
  const highlights = item ? getItemJobHighlights(item) : [];

  const authorName = entry.author || meta?.author || "Author";
  const jobTitle = entry.title || meta?.title || "Applied Job Post";
  const postUrl = entry.url || meta?.url || "";
  const postContent = meta?.content || entry.content || "";
  const platform = (entry.source || meta?.source || "linkedin") as "x" | "reddit" | "linkedin" | "facebook";

  const appliedDateStr = entry.appliedAt
    ? new Date(entry.appliedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Recently";

  const isNoteDirty = noteDraft !== (entry.note ?? "");

  const handleSaveNoteClick = () => {
    onSaveNote(entry.id, noteDraft);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  };

  const handleCopyProposal = async () => {
    if (!entry.proposal) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(entry.proposal);
      } else {
        const ta = document.createElement("textarea");
        ta.value = entry.proposal;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedProposal(true);
      setTimeout(() => setCopiedProposal(false), 2000);
    } catch {}
  };

  return (
    <div
      className="modal-overlay applied-detail-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel applied-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${jobTitle}`}
      >
        {/* Mobile Drag Handle */}
        <div className="mobile-sheet-drag-handle" />

        {/* Modal Header */}
        <div className="modal-header applied-detail-header">
          <div className="applied-detail-header-left">
            <div className={`compact-avatar compact-avatar-${platform}`} aria-hidden>
              {authorName[0]?.toUpperCase() ?? "A"}
            </div>
            <div>
              <div className="applied-header-top-row">
                <span className="applied-author-name">{authorName}</span>
                <Badge type={platform} />
              </div>
              <p className="applied-header-sub">
                Applied on {appliedDateStr}
              </p>
            </div>
          </div>

          <div className="applied-detail-header-right">
            {postUrl && (
              <a
                href={postUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="applied-post-ext-btn"
                title="Open post in new tab"
              >
                {platform === "linkedin" && <LinkedinIcon size={13} />}
                {platform === "reddit" && <RedditIcon size={13} />}
                {platform === "x" && <XIcon size={13} />}
                {platform === "facebook" && <FacebookIcon size={13} />}
                <span>Open Post ↗</span>
              </a>
            )}
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Close details"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body applied-detail-body">
          {/* Job Title */}
          <div className="applied-detail-title-card">
            <h2 className="applied-full-title">{jobTitle}</h2>
            {highlights.length > 0 && <JobHighlightsStrip highlights={highlights} />}
          </div>

          {/* Contact Leads Strip */}
          {(contacts.emails.length > 0 || contacts.phones.length > 0) && (
            <div className="applied-detail-section contacts-detail-section">
              <div className="detail-section-heading">
                <span className="lead-dot" />
                <span className="section-title-text">Contact Leads</span>
                <span className="contacts-counts">
                  {contacts.emails.length > 0 && `${contacts.emails.length} email${contacts.emails.length > 1 ? "s" : ""}`}
                  {contacts.emails.length > 0 && contacts.phones.length > 0 && " · "}
                  {contacts.phones.length > 0 && `${contacts.phones.length} phone${contacts.phones.length > 1 ? "s" : ""}`}
                </span>
              </div>
              <div className="contacts-chips-list">
                {contacts.emails.map((em) => (
                  <ContactBadge key={em} type="email" value={em} />
                ))}
                {contacts.phones.map((ph) => (
                  <ContactBadge
                    key={ph}
                    type="phone"
                    value={ph}
                    contextTitle={jobTitle}
                    contextText={postContent}
                    onOpenWhatsAppModal={item && onOpenWhatsApp ? () => onOpenWhatsApp(item, ph) : undefined}
                  />
                ))}
              </div>
            </div>
          )}

          {/* AI Proposal Section */}
          <div className="applied-detail-section proposal-detail-section">
            <div className="detail-section-heading">
              <span>✍️</span>
              <span className="section-title-text">
                {entry.proposal ? "Saved AI Proposal" : "AI Proposal"}
              </span>
            </div>

            {entry.proposal ? (
              <div className="applied-proposal-box">
                <pre className="applied-proposal-text-full">{entry.proposal}</pre>
                <div className="applied-proposal-actions">
                  <button
                    type="button"
                    className="btn-applied-proposal-action"
                    onClick={handleCopyProposal}
                  >
                    {copiedProposal ? "✓ Copied!" : "📋 Copy Proposal"}
                  </button>

                  {contacts.phones[0] && item && onOpenWhatsApp && (
                    <button
                      type="button"
                      className="btn-applied-proposal-whatsapp"
                      onClick={() => onOpenWhatsApp(item, contacts.phones[0])}
                    >
                      <WhatsAppIcon size={13} />
                      <span>Send on WhatsApp</span>
                    </button>
                  )}

                  {onWriteProposal && (
                    <button
                      type="button"
                      className="btn-applied-proposal-regen"
                      onClick={() =>
                        onWriteProposal(
                          postContent,
                          jobTitle,
                          postUrl,
                          contacts.emails[0],
                          entry.id,
                          contacts.phones[0]
                        )
                      }
                    >
                      🔄 Regenerate / Send Email
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="applied-no-proposal">
                <p className="no-proposal-hint">
                  No proposal generated yet for this job application.
                </p>
                {onWriteProposal && (
                  <button
                    type="button"
                    className="btn-applied-generate-now"
                    onClick={() =>
                      onWriteProposal(
                        postContent,
                        jobTitle,
                        postUrl,
                        contacts.emails[0],
                        entry.id,
                        contacts.phones[0]
                      )
                    }
                  >
                    ✨ Write Proposal with AI
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Notes & Tracking Section */}
          <div className="applied-detail-section notes-detail-section">
            <div className="detail-section-heading">
              <span>📝</span>
              <span className="section-title-text">Personal Notes & Follow-up</span>
            </div>
            <div className="applied-notes-editor">
              <textarea
                className="applied-notes-textarea"
                value={noteDraft}
                onChange={(e) => onNoteDraftChange(e.target.value)}
                placeholder="Add notes e.g. recruiter name, expected salary discussed, follow-up date..."
                rows={3}
              />
              <div className="applied-notes-footer">
                <span className="applied-notes-hint">
                  Saved notes are stored in your application history.
                </span>
                <button
                  type="button"
                  className={`btn-save-applied-note ${noteSaved ? "is-saved" : ""}`}
                  disabled={!isNoteDirty && !noteSaved}
                  onClick={handleSaveNoteClick}
                >
                  {noteSaved ? "✓ Note Saved!" : "Save Note"}
                </button>
              </div>
            </div>
          </div>

          {/* Original Post Content */}
          {postContent && (
            <div className="applied-detail-section original-post-section">
              <div className="detail-section-heading">
                <span>📄</span>
                <span className="section-title-text">Original Post Content</span>
              </div>
              <div className="applied-post-content-wrap">
                <div className="applied-post-full-text">
                  {renderHighlightedText(postContent)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer applied-detail-footer">
          <button
            type="button"
            className="btn-unmark-applied"
            onClick={() => {
              onUnmarkApplied(entry.id, jobTitle);
              onClose();
            }}
          >
            ✕ Remove from Applied
          </button>

          <div className="detail-footer-right">
            {contacts.phones[0] && item && onOpenWhatsApp && (
              <button
                type="button"
                className="btn-footer-whatsapp"
                onClick={() => onOpenWhatsApp(item, contacts.phones[0])}
              >
                <WhatsAppIcon size={14} />
                <span>WhatsApp</span>
              </button>
            )}

            <button type="button" className="btn-footer-done" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
