import { useState } from "react";
import { importLinkedinPostApi, LinkedinPost } from "./api";
import { LinkedinIcon } from "./FeedCard";

interface ImportPostModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (post: LinkedinPost) => void;
}

export default function ImportPostModal({ open, onClose, onImported }: ImportPostModalProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successPost, setSuccessPost] = useState<LinkedinPost | null>(null);

  if (!open) return null;

  const exampleUrl = "https://www.linkedin.com/feed/update/urn:li:activity:7484940219461300224/";

  const handlePaste = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setUrl(text.trim());
          setError(null);
        }
      }
    } catch {}
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    let cleanUrl = url.trim();
    if (!cleanUrl) {
      setError("Please enter a LinkedIn post URL or lnkd.in link");
      return;
    }

    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = "https://" + cleanUrl;
    }

    const lower = cleanUrl.toLowerCase();
    if (!lower.includes("linkedin.com") && !lower.includes("lnkd.in")) {
      setError("Please provide a valid LinkedIn URL or lnkd.in shortlink");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessPost(null);

    try {
      const res = await importLinkedinPostApi(cleanUrl);
      if (res.ok && res.post) {
        setSuccessPost(res.post);
        setTimeout(() => {
          onImported(res.post);
          onClose();
          setUrl("");
          setSuccessPost(null);
        }, 500);
      } else {
        throw new Error("Failed to parse LinkedIn post data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import LinkedIn post");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="modal-panel import-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Add LinkedIn Post by URL"
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">🔗</span>
            <div>
              <h2 className="modal-title">Add LinkedIn Post by URL</h2>
              <p className="modal-subtitle">Direct curl fetch • $0.00 • No Apify credits needed</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="modal-body import-modal-body">
          <div className="import-field-group">
            <div className="import-label-row">
              <label htmlFor="linkedin-post-url" className="import-field-label">
                LinkedIn Post URL
              </label>
              <button
                type="button"
                className="import-paste-btn"
                onClick={handlePaste}
                title="Paste URL from clipboard"
              >
                📋 Paste
              </button>
            </div>

            <div className="import-input-wrapper">
              <span className="import-input-icon">
                <LinkedinIcon size={14} />
              </span>
              <input
                id="linkedin-post-url"
                type="url"
                className="import-url-input"
                placeholder="https://www.linkedin.com/feed/update/urn:li:activity:..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError(null);
                }}
                disabled={loading}
                autoFocus
              />
              {url && !loading && (
                <button
                  type="button"
                  className="import-clear-btn"
                  onClick={() => setUrl("")}
                  title="Clear input"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Quick Example Buttons */}
            <div className="import-example-hint">
              <span>Examples:</span>
              <button
                type="button"
                className="import-example-link-btn"
                onClick={() => {
                  setUrl("https://lnkd.in/p/dJitQ4SN");
                  if (error) setError(null);
                }}
                title="Click to fill lnkd.in shortlink"
              >
                lnkd.in/p/dJitQ4SN
              </button>
              <span>·</span>
              <button
                type="button"
                className="import-example-link-btn"
                onClick={() => {
                  setUrl(exampleUrl);
                  if (error) setError(null);
                }}
                title="Click to fill activity URN"
              >
                urn:li:activity:7484940219461300224
              </button>
            </div>
          </div>

          {/* Feature Highlights */}
          <div className="import-highlights-card">
            <div className="import-highlight-item">
              <span className="import-highlight-icon">⚡</span>
              <span><strong>Instant curl parsing:</strong> Grabs the full job description and details directly.</span>
            </div>
            <div className="import-highlight-item">
              <span className="import-highlight-icon">👤</span>
              <span><strong>Author profile:</strong> Resolves author name, headline, avatar, and profile link.</span>
            </div>
            <div className="import-highlight-item">
              <span className="import-highlight-icon">✍️</span>
              <span><strong>Ready to Apply:</strong> Generates AI proposals and sends direct emails in 1 click.</span>
            </div>
          </div>

          {/* Loading status */}
          {loading && (
            <div className="import-loading-state">
              <span className="proposal-spinner" />
              <span>Fetching and parsing LinkedIn post via curl…</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="modal-error-banner">
              <div>⚠️ {error}</div>
            </div>
          )}

          {/* Success Banner */}
          {successPost && (
            <div className="import-success-banner">
              <div className="import-success-title">
                ✓ Post Imported: <strong>{successPost.authorName || "LinkedIn Post"}</strong>
              </div>
              <div className="import-success-headline">
                Opening AI proposal writer…
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="modal-footer">
          <button
            type="button"
            className="modal-btn-cancel"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="modal-btn-save import-submit-btn"
            onClick={() => handleSubmit()}
            disabled={loading || !url.trim()}
          >
            {loading ? "Fetching…" : successPost ? "✓ Opening Proposal…" : "📥 Fetch & Write Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
}
