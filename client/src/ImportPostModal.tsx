import { useEffect, useRef, useState, useCallback } from "react";
import { importLinkedinPostApi, LinkedinPost } from "./api";

interface ImportPostModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (post: LinkedinPost) => void;
}

function normalizePostOrJobUrl(raw: string): string {
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

function isValidUrlCandidate(text: string): boolean {
  if (!text) return false;
  const clean = text.trim().replace(/^["']|["']$/g, "").trim();
  if (!clean) return false;
  if (/^https?:\/\//i.test(clean)) return true;
  if (
    clean.includes(".") &&
    !clean.includes(" ") &&
    clean.length > 4 &&
    !clean.endsWith(".")
  ) {
    return true;
  }
  const lower = clean.toLowerCase();
  return (
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
      const cleanUrl = normalizePostOrJobUrl(targetUrl);
      if (!cleanUrl) {
        setError("Please enter a job posting URL or LinkedIn post link");
        return;
      }

      try {
        const parsed = new URL(cleanUrl);
        if (!parsed.hostname || !parsed.hostname.includes(".")) {
          throw new Error("Invalid domain name");
        }
      } catch {
        setError("Please provide a valid webpage URL (e.g. https://jobbery.in/... or linkedin.com/...)");
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
          throw new Error("Failed to parse job or post content");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import job/post webpage");
      } finally {
        setLoading(false);
      }
    },
    [onImported, onClose]
  );

  // Auto-read clipboard when modal opens AND immediately process if valid job / LinkedIn URL
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
        if (clean && isValidUrlCandidate(clean) && !autoTriggeredRef.current) {
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

  const jobberyExample = "https://jobbery.in/flutter-developer-senior-cseidc-kochi-2/";
  const linkedinExample = "https://www.linkedin.com/feed/update/urn:li:activity:7484940219461300224/";

  const handlePasteClick = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        const clean = (text || "").trim();
        if (clean) {
          setUrl(clean);
          setError(null);
          setAutoPasted(true);
          if (isValidUrlCandidate(clean)) {
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
    if (pasted && isValidUrlCandidate(pasted)) {
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
        aria-label="Add Job or Post by URL"
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">🔗</span>
            <div>
              <h2 className="modal-title">Add Job or Post by URL</h2>
              <p className="modal-subtitle">Direct curl fetch • $0.00 • LinkedIn, Jobbery, or any career website</p>
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
                <label htmlFor="job-post-url" className="import-field-label">
                  Job Post or Webpage URL
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
                🔗
              </span>
              <input
                id="job-post-url"
                type="url"
                className="import-url-input"
                placeholder="https://jobbery.in/... or linkedin.com/... or any job URL"
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
                onClick={() => processUrl(jobberyExample)}
                title="Click to test with Jobbery URL"
              >
                jobbery.in/flutter-developer...
              </button>
              <span>·</span>
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
                onClick={() => processUrl(linkedinExample)}
                title="Click to auto-fetch activity URN"
              >
                urn:li:activity:7484...
              </button>
            </div>
          </div>

          {/* Feature Highlights */}
          <div className="import-highlights-card">
            <div className="import-highlight-item">
              <span className="import-highlight-icon">🌐</span>
              <span><strong>Any Job Website:</strong> Works with Jobbery, LinkedIn, Indeed, company portals, or blogs.</span>
            </div>
            <div className="import-highlight-item">
              <span className="import-highlight-icon">⚡</span>
              <span><strong>Instant curl parsing:</strong> Grabs title, company, requirements, and contact details directly.</span>
            </div>
            <div className="import-highlight-item">
              <span className="import-highlight-icon">✍️</span>
              <span><strong>1-Click AI Proposal:</strong> Immediately drafts a tailored proposal for the role.</span>
            </div>
          </div>

          {/* Loading status */}
          {loading && (
            <div className="import-loading-state">
              <span className="proposal-spinner" />
              <span>Fetching and parsing job page via curl…</span>
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
                ✓ Imported: <strong>{successPost.authorHeadline || successPost.authorName || "Job Post"}</strong>
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
