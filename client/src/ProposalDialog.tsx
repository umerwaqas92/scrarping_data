import { useEffect, useState } from "react";

interface ProposalDialogProps {
  open: boolean;
  proposal: string | null;
  loading: boolean;
  error: string | null;
  jobTitle?: string;
  onClose: () => void;
  onRetry?: () => void;
}

export default function ProposalDialog({
  open,
  proposal,
  loading,
  error,
  jobTitle,
  onClose,
  onRetry,
}: ProposalDialogProps) {
  const [copied, setCopied] = useState(false);

  // Reset copy state when proposal changes
  useEffect(() => { setCopied(false); }, [proposal]);

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
            <div className="proposal-content">
              <pre className="proposal-text">{proposal}</pre>
            </div>
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
