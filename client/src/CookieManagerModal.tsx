import { useEffect, useState } from "react";
import {
  getCookieStatuses,
  savePlatformCookies,
  deletePlatformCookies,
  type CookiePlatform,
  type CookieStatus,
  type CookieSaveResult,
} from "./api";

interface CookieManagerModalProps {
  open: boolean;
  onClose: () => void;
}

const PLATFORM_LABELS: Record<CookiePlatform, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  facebook: "Facebook",
};

const PLATFORM_ICONS: Record<CookiePlatform, string> = {
  linkedin: "in",
  reddit: "r/",
  facebook: "f",
};

const PLACEHOLDER = `# Netscape HTTP Cookie File
# Paste the exported cookie file, e.g.:

.www.linkedin.com	TRUE	/	TRUE	1821733509	li_at	AQEDARsU...
.www.linkedin.com	TRUE	/	TRUE	1821733509	JSESSIONID	"ajax:123..."`;

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function CookieManagerModal({ open, onClose }: CookieManagerModalProps) {
  const [platform, setPlatform] = useState<CookiePlatform>("linkedin");
  const [content, setContent] = useState("");
  const [statuses, setStatuses] = useState<CookieStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<CookieSaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusFor = (p: CookiePlatform) => statuses.find((s) => s.platform === p);

  async function loadStatuses() {
    setLoading(true);
    try {
      setStatuses(await getCookieStatuses());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cookie status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setContent("");
    loadStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function handleSave(force = false) {
    if (!content.trim() || saving) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const res = await savePlatformCookies(platform, content, force);
      setResult(res);
      if (res.saved) {
        setContent("");
        await loadStatuses();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save cookies");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deletePlatformCookies(platform);
      setResult(null);
      await loadStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete cookies");
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  const active = statusFor(platform);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel cookie-modal-panel" role="dialog" aria-modal="true" aria-label="Cookie Manager">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">🍪</span>
            <div>
              <h2 className="modal-title">Cookie Manager</h2>
              <p className="modal-subtitle">Paste, clean and verify session cookies — saved to the database, no redeploy needed.</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* Platform selector */}
          <div className="cookie-platform-tabs">
            {(Object.keys(PLATFORM_LABELS) as CookiePlatform[]).map((p) => {
              const st = statusFor(p);
              return (
                <button
                  key={p}
                  type="button"
                  className={`cookie-platform-tab ${platform === p ? "is-active" : ""}`}
                  onClick={() => { setPlatform(p); setResult(null); setError(null); }}
                >
                  <span className="cookie-platform-icon">{PLATFORM_ICONS[p]}</span>
                  <span className="cookie-platform-name">{PLATFORM_LABELS[p]}</span>
                  <span className={`cookie-dot ${st?.hasSession ? "dot-ok" : st?.configured ? "dot-warn" : "dot-bad"}`} />
                </button>
              );
            })}
          </div>

          {/* Current status */}
          <div className="cookie-status-row">
            {loading ? (
              <span className="cookie-status-text">Loading status…</span>
            ) : active?.configured ? (
              <span className="cookie-status-text">
                Source: <strong>{active.source}</strong>
                {active.updated_at ? <> · updated {formatWhen(active.updated_at)}</> : null}
                {" · "}{active.cookieCount} cookies
                {" · "}
                {active.hasSession
                  ? <span className="cookie-session-ok">session cookie found</span>
                  : <span className="cookie-session-bad">no session cookie</span>}
              </span>
            ) : (
              <span className="cookie-status-text cookie-status-empty">
                No cookies configured for {PLATFORM_LABELS[platform]}.
              </span>
            )}
          </div>

          {/* Paste box */}
          <label className="cookie-textarea-label" htmlFor="cookie-textarea">
            Paste the {PLATFORM_LABELS[platform]} cookies (Netscape cookie file format)
          </label>
          <textarea
            id="cookie-textarea"
            className="cookie-textarea"
            value={content}
            onChange={(e) => { setContent(e.target.value); setResult(null); setError(null); }}
            placeholder={PLACEHOLDER}
            rows={10}
            spellCheck={false}
          />

          {/* Result / error */}
          {error && <div className="modal-error-banner">⚠️ {error}</div>}

          {result && (
            <div className={`cookie-result ${result.saved ? "cookie-result-ok" : result.verification.ok ? "cookie-result-warn" : "cookie-result-bad"}`}>
              <div className="cookie-result-title">
                {result.saved ? "✓ Saved" : result.verification.ok ? "⚠ Not saved" : "✕ Verification failed"}
              </div>
              <div className="cookie-result-msg">
                {result.verification.message}
                {result.verification.account ? <> — <strong>{result.verification.account}</strong></> : null}
              </div>
              {result.saved && (
                <div className="cookie-result-meta">
                  Cleaned & stored {result.count} cookie{result.count === 1 ? "" : "s"} ({result.format}).
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button type="button" className="modal-btn-cancel" onClick={onClose}>Close</button>
          {active?.source === "database" && (
            <button type="button" className="modal-btn-retry cookie-btn-delete" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "🗑 Delete saved"}
            </button>
          )}
          {result && !result.saved && content.trim() && (
            <button type="button" className="modal-btn-retry" onClick={() => handleSave(true)} disabled={saving}>
              {saving ? "Saving…" : "💾 Save anyway"}
            </button>
          )}
          <button
            type="button"
            className="modal-btn-save"
            onClick={() => handleSave(false)}
            disabled={saving || !content.trim()}
          >
            {saving ? <><span className="btn-spinner" /> Cleaning & verifying…</> : "🔒 Clean, Verify & Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
