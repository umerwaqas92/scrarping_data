import { useEffect, useState } from "react";
import { sendProposalEmail } from "./api";

interface ProposalDialogProps {
  open: boolean;
  proposal: string | null;
  summary?: string | null;
  loading: boolean;
  error: string | null;
  jobTitle?: string;
  defaultEmail?: string;
  jobId?: string;
  isApplied?: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onToggleApplied?: (id: string) => void;
}

export default function ProposalDialog({
  open,
  proposal,
  summary,
  loading,
  error,
  jobTitle,
  defaultEmail,
  jobId,
  isApplied,
  onClose,
  onRetry,
  onToggleApplied,
}: ProposalDialogProps) {
  const [copied, setCopied] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(defaultEmail || "");
  const [subject, setSubject] = useState("");
  const [summaryText, setSummaryText] = useState(summary || "");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok?: boolean; error?: string; messageId?: string } | null>(null);

  // Sync recipient email when dialog opens or defaultEmail changes
  useEffect(() => {
    setRecipientEmail(defaultEmail || "");
    setSubject(jobTitle ? `Application / Proposal: ${jobTitle}` : "Job Application / Proposal");
    setSummaryText(summary || "");
    setEmailStatus(null);
    setCopied(false);
  }, [open, defaultEmail, jobTitle, proposal, summary]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function handleCopy() {
    if (!proposal) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(proposal);
      } else {
        const ta = document.createElement("textarea");
        ta.value = proposal;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { }
  }

  async function handleSendEmail() {
    if (!proposal || !recipientEmail.trim()) return;
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      const res = await sendProposalEmail(
        recipientEmail.trim(),
        proposal,
        jobTitle,
        subject.trim() || undefined,
        summaryText.trim() || undefined,
      );
      setEmailStatus({ ok: true, messageId: res.messageId });
      // Auto-mark as applied if not already marked
      if (jobId && onToggleApplied && !isApplied) {
        onToggleApplied(jobId);
      }
    } catch (err) {
      setEmailStatus({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to send email",
      });
    } finally {
      setSendingEmail(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel proposal-modal-panel" role="dialog" aria-modal="true" aria-label="Job Proposal">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">✍️</span>
            <div>
              <h2 className="modal-title">AI Job Proposal</h2>
              {jobTitle && <p className="modal-subtitle">For: <strong>{jobTitle}</strong></p>}
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {loading && (
            <div className="proposal-loading">
              <div className="proposal-spinner-wrap">
                <span className="proposal-spinner" />
              </div>
              <p className="proposal-loading-text">MiMo is writing your proposal…</p>
              <p className="proposal-loading-sub">Using MiMo-V2.5 Free · Usually takes 5–15s</p>
            </div>
          )}

          {!loading && error && (
            <div className="modal-error-banner">
              <div>⚠️ {error}</div>
              <p className="error-hint">Make sure your profile is saved and try again.</p>
              {onRetry && (
                <button type="button" className="modal-error-retry-btn" onClick={onRetry}>
                  🔄 Try Again
                </button>
              )}
            </div>
          )}

          {!loading && proposal && (
            <>
              {/* LinkedIn Note Field */}
              <div className="proposal-summary-section">
                <label className="proposal-summary-label">
                  <span>💼</span>
                  <span>LinkedIn Application Note (250 chars max)</span>
                  <span className="proposal-summary-count">{summaryText.length}/250</span>
                </label>
                <textarea
                  value={summaryText}
                  onChange={(e) => {
                    if (e.target.value.length <= 250) {
                      setSummaryText(e.target.value);
                    }
                  }}
                  className="proposal-summary-input"
                  placeholder="Short note for LinkedIn job application..."
                  maxLength={250}
                  rows={3}
                />
              </div>

              {/* Proposal Text */}
              <div className="proposal-content">
                <pre className="proposal-text">{proposal}</pre>
              </div>

              {/* Email Sending Card */}
              <div className="proposal-email-section">
                <div className="proposal-email-header">
                  <div className="proposal-email-title">
                    <span>✉️</span>
                    <span>Send Proposal + LinkedIn Note via Email</span>
                  </div>
                  {defaultEmail && (
                    <span className="proposal-email-badge">
                      Auto-detected email
                    </span>
                  )}
                </div>

                <div className="proposal-email-row">
                  <input
                    type="email"
                    placeholder="Recipient email (e.g. client@company.com)"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    className="proposal-email-input"
                  />
                  <button
                    type="button"
                    disabled={sendingEmail || !recipientEmail.trim() || !recipientEmail.includes("@")}
                    onClick={handleSendEmail}
                    className={`proposal-email-send-btn ${emailStatus?.ok ? "is-sent" : ""}`}
                  >
                    {sendingEmail ? "Sending..." : emailStatus?.ok ? "✓ Sent & Applied!" : "📤 Send Email"}
                  </button>
                </div>

                {emailStatus?.ok && (
                  <div className="proposal-email-success">
                    ✓ Proposal email sent successfully to <strong>{recipientEmail}</strong> (marked as applied)!
                  </div>
                )}
                {emailStatus?.error && (
                  <div className="proposal-email-error">
                    ⚠️ Failed to send: {emailStatus.error}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (proposal || error) && (
          <div className="modal-footer">
            <button type="button" className="modal-btn-cancel" onClick={onClose}>
              Close
            </button>
            {jobId && onToggleApplied && (
              <button
                type="button"
                className={`modal-btn-retry ${isApplied ? "btn-is-applied" : ""}`}
                onClick={() => onToggleApplied(jobId)}
              >
                {isApplied ? "✓ Marked as Applied" : "Mark as Applied"}
              </button>
            )}
            {onRetry && proposal && (
              <button type="button" className="modal-btn-retry" onClick={onRetry}>
                🔄 Regenerate
              </button>
            )}
            {proposal && (
              <button
                type="button"
                className={`modal-btn-save ${copied ? "btn-saved" : "btn-copy-proposal"}`}
                onClick={handleCopy}
              >
                {copied ? "✓ Copied!" : "📋 Copy Proposal"}
              </button>
            )}
          </div>
        )}

        {!loading && !proposal && !error && (
          <div className="modal-footer">
            <button type="button" className="modal-btn-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

