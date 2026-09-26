import { useEffect, useState } from "react";
import {
  getApifyKeys,
  addApifyKeys,
  deleteApifyKey,
  getApifyBalances,
  type ApifyKeyInfo,
  type ApifyBalance,
  type ApifyKeyAddResult,
} from "./api";

interface ApifyKeysModalProps {
  open: boolean;
  onClose: () => void;
}

function splitKeys(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean)));
}

export default function ApifyKeysModal({ open, onClose }: ApifyKeysModalProps) {
  const [keys, setKeys] = useState<ApifyKeyInfo[]>([]);
  const [balances, setBalances] = useState<ApifyBalance[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ApifyKeyAddResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const balanceFor = (label: string) => balances.find((b) => b.key === label);
  const pendingCount = splitKeys(text).length;
  const envCount = keys.filter((k) => k.source === "env").length;
  const failedCount = result ? result.results.filter((r) => !r.saved).length : 0;

  async function load(prefill: boolean) {
    setLoading(true);
    try {
      const [{ keys: k, tokens }, b] = await Promise.all([getApifyKeys(true), getApifyBalances()]);
      setKeys(k);
      setBalances(b);
      if (prefill) setText(tokens.join("\n"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    load(true);
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
    if (saving) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const res = await addApifyKeys(splitKeys(text), { force, replace: true });
      setResult(res);
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save keys");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      await deleteApifyKey(id);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove key");
    } finally {
      setRemovingId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel cookie-modal-panel" role="dialog" aria-modal="true" aria-label="Apify Keys">
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">⚡</span>
            <div>
              <h2 className="modal-title">Apify Keys</h2>
              <p className="modal-subtitle">One key per line. Names auto-assigned. Stored in the DB — no redeploy.</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <label className="cookie-textarea-label" htmlFor="apify-keys-textarea">
            Apify API keys (one per line)
          </label>
          <textarea
            id="apify-keys-textarea"
            className="cookie-textarea"
            value={text}
            onChange={(e) => { setText(e.target.value); setResult(null); setError(null); }}
            placeholder={"apify_api_...\napify_api_..."}
            rows={7}
            spellCheck={false}
          />
          {!loading && envCount > 0 && (
            <p className="apify-env-note">
              {envCount} key{envCount > 1 ? "s" : ""} come from environment variables and stay active even if removed here.
            </p>
          )}

          <div className="apify-add-actions">
            <button
              type="button"
              className="modal-btn-save"
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              {saving ? <><span className="btn-spinner" /> Saving…</> : `💾 Save ${pendingCount} key${pendingCount === 1 ? "" : "s"}`}
            </button>
            {result && failedCount > 0 && (
              <button type="button" className="modal-btn-retry" onClick={() => handleSave(true)} disabled={saving}>
                Save anyway
              </button>
            )}
          </div>

          {error && <div className="modal-error-banner">⚠️ {error}</div>}

          {result && (
            <div className={`cookie-result ${result.added > 0 || result.removed > 0 || result.kept > 0 ? "cookie-result-ok" : "cookie-result-bad"}`}>
              <div className="cookie-result-title">Saved</div>
              <div className="cookie-result-meta">
                {result.added} added · {result.removed} removed · {result.kept} kept
              </div>
              {failedCount > 0 && (
                <div className="apify-result-list">
                  {result.results.filter((r) => !r.saved).map((r, i) => (
                    <div key={i} className="apify-result-item">
                      <span className="apify-result-bad">✕</span>
                      <span className="apify-key-masked">{r.masked}</span>
                      <span className="apify-result-note">{r.message || "invalid"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="apify-keys-section">
            <label className="cookie-textarea-label">Configured keys ({keys.length})</label>
            <div className="apify-keys-list">
              {keys.map((k) => {
                const bal = balanceFor(k.label);
                return (
                  <div key={k.id} className="apify-key-row">
                    <div className="apify-key-meta">
                      <span className="apify-key-label">{k.label}</span>
                      <span className="apify-key-masked">{k.masked}</span>
                      <span className={`apify-key-badge ${k.source === "database" ? "badge-db" : "badge-env"}`}>
                        {k.source === "database" ? "database" : "env"}
                      </span>
                    </div>
                    <div className="apify-key-right">
                      {bal && bal.status === "active" ? (
                        <span className="apify-key-bal">${bal.remainingUsd.toFixed(2)} left</span>
                      ) : bal ? (
                        <span className="apify-key-bal apify-key-bal-bad">error</span>
                      ) : null}
                      {k.removable && (
                        <button
                          type="button"
                          className="apify-key-del"
                          onClick={() => handleRemove(k.id)}
                          disabled={removingId === k.id}
                        >
                          {removingId === k.id ? "…" : "🗑"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!loading && keys.length === 0 && (
                <div className="cookie-status-text">No Apify keys configured.</div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
