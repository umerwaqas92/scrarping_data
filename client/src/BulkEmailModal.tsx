import { useState, useEffect } from "react";
import {
  generateProposal,
  sendBulkProposals,
  BulkEmailItem,
  BulkEmailReport,
  XTweet,
  RedditPost,
  LinkedinProfile,
  LinkedinPost,
  FacebookPost,
} from "./api";
import { getItemContacts, FeedItem, isTweet, isLinkedin, isFacebook, isReddit } from "./FeedCard";

interface BulkRecipient {
  email: string;
  jobId?: string;
  jobTitle?: string;
  jobText?: string;
  status: "idle" | "sending" | "sent" | "failed";
  error?: string;
}

interface BulkEmailModalProps {
  open: boolean;
  selectedItems: FeedItem[];
  onClose: () => void;
  onApplied?: (jobIds: string[]) => void;
}

export default function BulkEmailModal({
  open,
  selectedItems,
  onClose,
  onApplied,
}: BulkEmailModalProps) {
  const [recipients, setRecipients] = useState<BulkRecipient[]>([]);
  const [newEmailInput, setNewEmailInput] = useState("");
  const [subject, setSubject] = useState("Application / Freelance Proposal");
  const [proposalBody, setProposalBody] = useState("");
  const [summaryNote, setSummaryNote] = useState("");
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [report, setReport] = useState<BulkEmailReport | null>(null);

  // Initialize recipients when opened or selected items change
  useEffect(() => {
    if (!open) return;

    const list: BulkRecipient[] = [];
    const seenEmails = new Set<string>();

    for (const item of selectedItems) {
      const contacts = getItemContacts(item);
      let jobTitle = "Freelance Project / Job Post";
      let jobText = "";

      if (isTweet(item)) {
        const t = item as XTweet;
        jobTitle = `Tweet by @${t.user?.screenName || "user"}`;
        jobText = t.text || "";
      } else if (isLinkedin(item)) {
        const isPost = (item as LinkedinPost).content !== undefined;
        if (isPost) {
          const lp = item as LinkedinPost;
          jobTitle = lp.authorHeadline || lp.authorName || "LinkedIn Post";
          jobText = lp.content || "";
        } else {
          const lprof = item as LinkedinProfile;
          jobTitle = lprof.headline || `${lprof.firstName} ${lprof.lastName}`;
          jobText = `${lprof.headline || ""} ${lprof.currentPosition || ""} ${lprof.location || ""}`;
        }
      } else if (isFacebook(item)) {
        const fb = item as FacebookPost;
        jobTitle = fb.pageName || fb.authorName || "Facebook Post";
        jobText = fb.content || fb.text || "";
      } else if (isReddit(item)) {
        const rp = item as RedditPost;
        jobTitle = rp.title || "Reddit Post";
        jobText = `${rp.title}\n\n${rp.selftext || ""}`;
      }

      for (const email of contacts.emails) {
        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail && !seenEmails.has(cleanEmail)) {
          seenEmails.add(cleanEmail);
          list.push({
            email: cleanEmail,
            jobId: item.id,
            jobTitle,
            jobText,
            status: "idle",
          });
        }
      }
    }

    setRecipients(list);
    setSubject("Job Application / Freelance Proposal");
    setSummaryNote("");
    setReport(null);
    setCopied(false);
    setAiError(null);

    // If no proposal body is set yet, provide a starter professional template
    if (!proposalBody) {
      setProposalBody(
        `Hi,\n\nI came across your job post and would love to help you with this project.\n\nI am an experienced developer and freelancer specialized in full-stack web and mobile application development, automated systems, and high-performance solutions.\n\nKey strengths I can bring to your team:\n• Fast, clean, and reliable delivery\n• Strong communication and proactive project updates\n• End-to-end expertise from architecture to production deployment\n\nI would be glad to discuss the project details and provide references or relevant work samples.\n\nBest regards,\nYour Name\nYour Portfolio / Contact`
      );
    }
  }, [open, selectedItems]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, sending, onClose]);

  // Remove recipient chip
  const handleRemoveRecipient = (emailToRemove: string) => {
    setRecipients((prev) => prev.filter((r) => r.email !== emailToRemove));
  };

  // Add custom manual recipient email
  const handleAddCustomEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newEmailInput.trim().toLowerCase();
    if (!clean || !clean.includes("@")) return;
    if (recipients.some((r) => r.email === clean)) {
      setNewEmailInput("");
      return;
    }
    setRecipients((prev) => [
      ...prev,
      {
        email: clean,
        jobTitle: "Custom Recipient",
        status: "idle",
      },
    ]);
    setNewEmailInput("");
  };

  // AI Proposal Generation
  const handleGenerateAIProposal = async () => {
    setGeneratingAI(true);
    setAiError(null);

    try {
      // Gather context from selected jobs
      const sampleTexts = recipients
        .filter((r) => r.jobText)
        .slice(0, 3)
        .map((r) => `Job context (${r.jobTitle}):\n${r.jobText}`)
        .join("\n\n---\n\n");

      const promptContext = sampleTexts || "Full-stack software engineering and freelance development positions";

      const res = await generateProposal(
        promptContext,
        "Freelance Position / Developer Role"
      );

      if (res.proposal) {
        // Strip Subject: header if returned
        const cleanBody = res.proposal.replace(/^\s*(?:Subject(?:\s+Line)?|RE)\s*:\s*[^\n\r]+(?:\r?\n)*/i, "").trim();
        setProposalBody(cleanBody);
        if (res.summary) {
          setSummaryNote(res.summary);
        }
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Failed to generate AI proposal");
    } finally {
      setGeneratingAI(false);
    }
  };

  // Copy proposal text
  const handleCopyProposal = async () => {
    if (!proposalBody) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(proposalBody);
      } else {
        const ta = document.createElement("textarea");
        ta.value = proposalBody;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // Send Bulk Emails
  const handleSendBulkEmails = async () => {
    if (recipients.length === 0 || !proposalBody.trim() || sending) return;

    setSending(true);
    setReport(null);

    // Mark all as sending in UI
    setRecipients((prev) => prev.map((r) => ({ ...r, status: "sending", error: undefined })));

    try {
      const items: BulkEmailItem[] = recipients.map((r) => ({
        to: r.email,
        subject: subject.trim() || undefined,
        proposal: proposalBody.trim(),
        jobTitle: r.jobTitle,
        summary: summaryNote.trim() || undefined,
        jobId: r.jobId,
      }));

      const res = await sendBulkProposals(items);
      setReport(res);

      // Update per-recipient status from report
      const resultMap = new Map(res.results.map((item) => [item.to.toLowerCase(), item]));
      const appliedJobIds: string[] = [];

      setRecipients((prev) =>
        prev.map((r) => {
          const match = resultMap.get(r.email.toLowerCase());
          if (match) {
            if (match.ok && r.jobId) {
              appliedJobIds.push(r.jobId);
            }
            return {
              ...r,
              status: match.ok ? "sent" : "failed",
              error: match.error,
            };
          }
          return r;
        })
      );

      // Auto-mark successfully emailed jobs as applied
      if (appliedJobIds.length > 0 && onApplied) {
        onApplied(appliedJobIds);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Bulk email request failed";
      setRecipients((prev) =>
        prev.map((r) => (r.status === "sending" ? { ...r, status: "failed", error: errMsg } : r))
      );
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const validRecipientsCount = recipients.length;
  const sentCount = recipients.filter((r) => r.status === "sent").length;
  const failedCount = recipients.filter((r) => r.status === "failed").length;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div className="modal-panel bulk-email-modal-panel" role="dialog" aria-modal="true" aria-label="Bulk Email Proposals">
        
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">📤</span>
            <div>
              <h2 className="modal-title">Bulk Proposal & Email Sender</h2>
              <p className="modal-subtitle">
                Compose once, send personalized emails to <strong>{validRecipientsCount}</strong> selected lead{validRecipientsCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body bulk-email-modal-body">
          
          {/* Recipients Section */}
          <div className="bulk-section-card">
            <div className="bulk-section-header">
              <label className="bulk-section-label">
                <span>👥</span>
                <span>Recipients ({validRecipientsCount})</span>
              </label>
              {validRecipientsCount === 0 && (
                <span className="bulk-empty-warning">⚠️ No email addresses selected</span>
              )}
            </div>

            {/* Recipient Chips */}
            <div className="bulk-recipients-chips-grid">
              {recipients.map((r) => (
                <div
                  key={r.email}
                  className={`bulk-recipient-chip status-${r.status}`}
                  title={`${r.email} (${r.jobTitle || "Lead"})`}
                >
                  <span className="recipient-chip-icon">
                    {r.status === "idle" && "✉️"}
                    {r.status === "sending" && "⏳"}
                    {r.status === "sent" && "✓"}
                    {r.status === "failed" && "⚠️"}
                  </span>
                  <span className="recipient-chip-email">{r.email}</span>
                  {!sending && (
                    <button
                      type="button"
                      className="recipient-chip-remove"
                      onClick={() => handleRemoveRecipient(r.email)}
                      title="Remove recipient"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add Manual Recipient Input */}
            <form onSubmit={handleAddCustomEmail} className="bulk-add-recipient-form">
              <input
                type="email"
                placeholder="Add another recipient email (e.g. hr@company.com)..."
                value={newEmailInput}
                onChange={(e) => setNewEmailInput(e.target.value)}
                disabled={sending}
                className="bulk-add-email-input"
              />
              <button
                type="submit"
                disabled={sending || !newEmailInput.trim() || !newEmailInput.includes("@")}
                className="bulk-add-email-btn"
              >
                + Add
              </button>
            </form>
          </div>

          {/* AI Generator & Subject Bar */}
          <div className="bulk-section-card">
            <div className="bulk-template-bar">
              <div className="bulk-template-left">
                <span className="bulk-sub-label">Email Subject:</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={sending}
                  placeholder="Subject line..."
                  className="bulk-subject-input"
                />
              </div>
              <button
                type="button"
                onClick={handleGenerateAIProposal}
                disabled={generatingAI || sending}
                className="btn-ai-generate-bulk"
                title="Use MiMo AI and your Freelancer Profile to write an optimal proposal"
              >
                <span>{generatingAI ? "⚡ Writing Proposal…" : "✨ AI Generate Pitch"}</span>
              </button>
            </div>

            {aiError && (
              <div className="bulk-error-banner">
                ⚠️ {aiError}
              </div>
            )}
          </div>

          {/* Proposal Body Editor */}
          <div className="bulk-section-card">
            <div className="bulk-section-header">
              <label className="bulk-section-label">
                <span>📝</span>
                <span>Proposal & Pitch Message</span>
                <span className="bulk-char-count">{proposalBody.length} characters</span>
              </label>
            </div>
            <textarea
              value={proposalBody}
              onChange={(e) => setProposalBody(e.target.value)}
              disabled={sending}
              placeholder="Write your email proposal here..."
              className="bulk-proposal-textarea"
              rows={9}
            />
          </div>

          {/* Optional LinkedIn Note */}
          <div className="bulk-section-card">
            <div className="bulk-section-header">
              <label className="bulk-section-label">
                <span>💼</span>
                <span>Optional Header Note (e.g. Portfolio links or note)</span>
                <span className="bulk-char-count">{summaryNote.length}/250</span>
              </label>
            </div>
            <input
              type="text"
              value={summaryNote}
              onChange={(e) => {
                if (e.target.value.length <= 250) setSummaryNote(e.target.value);
              }}
              disabled={sending}
              placeholder="Short note prepended to email (e.g. Portfolio: https://...)"
              className="bulk-summary-input"
              maxLength={250}
            />
          </div>

          {/* Live Sending / Results Progress */}
          {(sending || report) && (
            <div className="bulk-status-card">
              <div className="bulk-status-header">
                <span className="status-indicator-dot" />
                <span className="status-header-title">
                  {sending
                    ? `Dispatching Emails (${sentCount + failedCount}/${validRecipientsCount})…`
                    : `Batch Complete: ${report?.sent || 0} Sent, ${report?.failed || 0} Failed`}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="bulk-progress-bar-track">
                <div
                  className="bulk-progress-bar-fill"
                  style={{
                    width: `${validRecipientsCount > 0 ? ((sentCount + failedCount) / validRecipientsCount) * 100 : 0}%`,
                  }}
                />
              </div>

              {/* Delivery Details */}
              {report && (
                <div className="bulk-report-summary">
                  {report.sent > 0 && (
                    <div className="report-success-line">
                      ✓ Successfully delivered to <strong>{report.sent}</strong> recipient{report.sent > 1 ? "s" : ""} (auto-marked as applied in feed).
                    </div>
                  )}
                  {report.failed > 0 && (
                    <div className="report-failed-line">
                      ⚠️ <strong>{report.failed}</strong> delivery failed. Check recipient address or SMTP configuration.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="modal-footer bulk-email-footer">
          <button
            type="button"
            className="modal-btn-cancel"
            onClick={onClose}
            disabled={sending}
          >
            {report ? "Done" : "Cancel"}
          </button>

          <button
            type="button"
            className={`modal-btn-save btn-copy-proposal ${copied ? "btn-saved" : ""}`}
            onClick={handleCopyProposal}
            disabled={!proposalBody.trim()}
          >
            {copied ? "✓ Copied Message!" : "📋 Copy Proposal"}
          </button>

          <button
            type="button"
            className={`modal-btn-save btn-send-bulk-action ${sending ? "is-sending" : ""}`}
            onClick={handleSendBulkEmails}
            disabled={sending || validRecipientsCount === 0 || !proposalBody.trim()}
          >
            {sending ? (
              <span>📤 Sending Batch ({validRecipientsCount})…</span>
            ) : (
              <span>🚀 Send to All {validRecipientsCount} Recipients</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
