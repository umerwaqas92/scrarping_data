import { useEffect, useState } from "react";
import { sendProposalEmail } from "./api";

interface ProposalDialogProps {
  open: boolean;
  proposal: string | null;
  loading: boolean;
  error: string | null;
  jobTitle?: string;
  defaultEmail?: string;
  onClose: () => void;
  onRetry?: () => void;
}

export default function ProposalDialog({
  open,
  proposal,
  loading,
  error,
  jobTitle,
  defaultEmail,
  onClose,
  onRetry,
}: ProposalDialogProps) {
  const [copied, setCopied] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(defaultEmail || "");
  const [subject, setSubject] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok?: boolean; error?: string; messageId?: string } | null>(null);

  // Sync recipient email when dialog opens or defaultEmail changes
  useEffect(() => {
    setRecipientEmail(defaultEmail || "");
    setSubject(jobTitle ? `Application / Proposal: ${jobTitle}` : "Job Application / Proposal");
    setEmailStatus(null);
    setCopied(false);
  }, [open, defaultEmail, jobTitle, proposal]);

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
    } catch {}
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
      );
      setEmailStatus({ ok: true, messageId: res.messageId });
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
              {/* Proposal Text */}
              <div className="proposal-content">
                <pre className="proposal-text">{proposal}</pre>
              </div>

              {/* Email Sending Card */}
              <div className="proposal-email-section" style={{
                marginTop: "16px",
                padding: "14px",
                borderRadius: "10px",
                background: "var(--color-bg-subtle, #1e293b)",
                border: "1px solid var(--color-border, #334155)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, fontSize: "0.9rem" }}>
                    <span>✉️</span>
                    <span>Send Proposal directly via Email</span>
                  </div>
                  {defaultEmail && (
                    <span style={{ fontSize: "0.75rem", color: "#38bdf8", background: "rgba(56, 189, 248, 0.1)", padding: "2px 8px", borderRadius: "12px" }}>
                      Auto-detected email
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <input
                    type="email"
                    placeholder="Recipient email (e.g. client@company.com)"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    style={{
                      flex: "1 1 200px",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      background: "rgba(0,0,0,0.25)",
                      border: "1px solid var(--color-border, #475569)",
                      color: "#f8fafc",
                      fontSize: "0.85rem",
                    }}
                  />
                  <button
                    type="button"
                    disabled={sendingEmail || !recipientEmail.trim() || !recipientEmail.includes("@")}
                    onClick={handleSendEmail}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      background: emailStatus?.ok ? "#10b981" : "#6366f1",
                      color: "#fff",
                      border: "none",
                      cursor: (sendingEmail || !recipientEmail.trim()) ? "not-allowed" : "pointer",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      opacity: (sendingEmail || !recipientEmail.trim()) ? 0.7 : 1,
                      transition: "all 0.2s ease",
                    }}
                  >
                    {sendingEmail ? "Sending..." : emailStatus?.ok ? "✓ Sent!" : "📤 Send Email"}
                  </button>
                </div>

                {emailStatus?.ok && (
                  <div style={{ fontSize: "0.8rem", color: "#10b981", marginTop: "2px" }}>
                    ✓ Proposal email sent successfully to <strong>{recipientEmail}</strong>!
                  </div>
                )}
                {emailStatus?.error && (
                  <div style={{ fontSize: "0.8rem", color: "#ef4444", marginTop: "2px" }}>
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

