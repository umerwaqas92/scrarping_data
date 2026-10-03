import { useEffect, useRef, useState, useCallback } from "react";
import { importLinkedinPostApi, LinkedinPost } from "./api";
import { LinkedinIcon } from "./FeedCard";

interface ImportPostModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (post: LinkedinPost) => void;
}

function normalizeLinkedinUrl(raw: string): string {
  let clean = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (!clean) return "";
  if (/^urn:li:activity:\d+/i.test(clean)) {
    return "https://www.linkedin.com/feed/update/" + clean;
  }
  if (/^activity:\d+/i.test(clean)) {
    return "https://www.linkedin.com/feed/update/urn:li:" + clean;
  }
  if (/^\d{10,25}$/.test(clean)) {
    return "https://www.linkedin.com/feed/update/urn:li:activity:" + clean;
  }
  if (!/^https?:\/\//i.test(clean)) {
    clean = "https://" + clean;
  }
  return clean;
}

function isLinkedinUrlCandidate(text: string): boolean {
  if (!text) return false;
  const clean = text.trim().replace(/^["']|["']$/g, "").trim();
  if (!clean) return false;
  const lower = clean.toLowerCase();
  return (
    lower.includes("linkedin.com") ||
    lower.includes("lnkd.in") ||
    lower.startsWith("urn:li:") ||
    lower.startsWith("activity:") ||
    /^\d{15,22}$/.test(clean)
  );
}

export default function ImportPostModal({ open, onClose, onImported }: ImportPostModalProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successPost, setSuccessPost] = useState<LinkedinPost | null>(null);
  const [autoPasted, setAutoPasted] = useState(false);
  const autoTriggeredRef = useRef(false);

  const processUrl = useCallback(
    async (targetUrl: string) => {
      const cleanUrl = normalizeLinkedinUrl(targetUrl);
      if (!cleanUrl) {
        setError("Please enter a LinkedIn post URL or lnkd.in link");
        return;
      }

      const lower = cleanUrl.toLowerCase();
      if (!lower.includes("linkedin.com") && !lower.includes("lnkd.in")) {
        setError("Please provide a valid LinkedIn URL or lnkd.in shortlink");
        return;
      }

      setUrl(cleanUrl);
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
            setAutoPasted(false);
          }, 500);
        } else {
          throw new Error("Failed to parse LinkedIn post data");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import LinkedIn post");
      } finally {
        setLoading(false);
      }
    },
    [onImported, onClose]
  );

  // Auto-read clipboard when modal opens AND immediately process if valid LinkedIn post URL
  useEffect(() => {
    if (!open) {
      setAutoPasted(false);
      autoTriggeredRef.current = false;
      setUrl("");
      setError(null);
      setSuccessPost(null);
      return;
    }

    let isMounted = true;
    autoTriggeredRef.current = false;

    // Check clipboard upon modal opening
    navigator.clipboard?.readText?.()
      .then((text) => {
        if (!isMounted) return;
        const clean = (text || "").trim();
        if (clean && isLinkedinUrlCandidate(clean) && !autoTriggeredRef.current) {
          autoTriggeredRef.current = true;
          setUrl(clean);
          setAutoPasted(true);
          setError(null);
          // Automatically trigger fetch & proposal process
          processUrl(clean);
        }
      })
      .catch(() => {
        // Ignore permission denials
      });

    return () => {
      isMounted = false;
    };
  }, [open, processUrl]);

  if (!open) return null;

  const exampleUrl = "https://www.linkedin.com/feed/update/urn:li:activity:7484940219461300224/";

  const handlePasteClick = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        const clean = (text || "").trim();
        if (clean) {
          setUrl(clean);
          setError(null);
          setAutoPasted(true);
          if (isLinkedinUrlCandidate(clean)) {
            processUrl(clean);
          }
        }
      }
    } catch (e) {
      console.warn("Clipboard read error", e);
    }
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData?.getData("text")?.trim();
    if (pasted && isLinkedinUrlCandidate(pasted)) {
      setUrl(pasted);
      setAutoPasted(true);
      setError(null);
      setTimeout(() => {
        processUrl(pasted);
      }, 50);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    processUrl(url);
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
              <p className="modal-subtitle">Direct curl fetch • $0.00 • Auto-pasted &amp; instant AI proposal</p>
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
              <div className="import-label-left">
                <label htmlFor="linkedin-post-url" className="import-field-label">
                  LinkedIn Post URL
                </label>
                {autoPasted && (
                  <span
                    className="import-auto-pasted-pill"
                    title="URL automatically detected from your clipboard and processing"
                  >
                    {loading ? "⚡ Auto-pasted & fetching…" : "✓ Auto-pasted from clipboard"}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="import-paste-btn"
                onClick={handlePasteClick}
                title="Paste and process URL from clipboard"
              >
                📋 Paste &amp; Process
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
                onPaste={handleInputPaste}
                disabled={loading}
                autoFocus
              />
              {url && !loading && (
                <button
                  type="button"
                  className="import-clear-btn"
                  onClick={() => {
                    setUrl("");
                    setAutoPasted(false);
                  }}
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
                onClick={() => processUrl("https://lnkd.in/p/dJitQ4SN")}
                title="Click to auto-fetch lnkd.in shortlink"
              >
                lnkd.in/p/dJitQ4SN
              </button>
              <span>·</span>
              <button
                type="button"
                className="import-example-link-btn"
                onClick={() => processUrl(exampleUrl)}
                title="Click to auto-fetch activity URN"
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
            {loading ? "⚡ Fetching…" : successPost ? "✓ Opening Proposal…" : "📥 Fetch & Write Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
}
