import { useEffect, useState } from "react";
import {
  getApifyKeys,
  addApifyKey,
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

export default function ApifyKeysModal({ open, onClose }: ApifyKeysModalProps) {
  const [keys, setKeys] = useState<ApifyKeyInfo[]>([]);
  const [balances, setBalances] = useState<ApifyBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<ApifyKeyAddResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const balanceFor = (label: string) => balances.find((b) => b.key === label);

  async function reload() {
    setLoading(true);
    try {
      const [k, b] = await Promise.all([getApifyKeys(), getApifyBalances()]);
      setKeys(k);
      setBalances(b);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setLabel("");
    setToken("");
    reload();
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

  async function handleAdd(force = false) {
    if (!token.trim() || adding) return;
    setAdding(true);
    setError(null);
    setResult(null);
    try {
      const res = await addApifyKey(label.trim(), token.trim(), force);
      setResult(res);
      if (res.saved) {
        setLabel("");
        setToken("");
        await reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add key");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteApifyKey(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete key");
    } finally {
      setDeletingId(null);
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
              <p className="modal-subtitle">Add or remove Apify API keys at runtime — stored in the database, no redeploy needed.</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {loading && <div className="cookie-status-text">Loading…</div>}

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
                        onClick={() => handleDelete(k.id)}
                        disabled={deletingId === k.id}
                      >
                        {deletingId === k.id ? "…" : "🗑 Remove"}
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

          <div className="apify-add-form">
            <label className="cookie-textarea-label">Add a new Apify key</label>
            <div className="apify-add-row">
              <input
                type="text"
                className="proposal-email-input"
                placeholder="Label (optional, e.g. work-account)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                type="text"
                className="proposal-email-input"
                placeholder="apify_api_..."
                value={token}
                onChange={(e) => { setToken(e.target.value); setResult(null); setError(null); }}
                spellCheck={false}
              />
            </div>
            <div className="apify-add-actions">
              <button
                type="button"
                className="modal-btn-save"
                onClick={() => handleAdd(false)}
                disabled={adding || !token.trim()}
              >
                {adding ? <><span className="btn-spinner" /> Validating…</> : "➕ Validate & Add"}
              </button>
              {result && !result.saved && token.trim() && (
                <button type="button" className="modal-btn-retry" onClick={() => handleAdd(true)} disabled={adding}>
                  Save anyway
                </button>
              )}
            </div>
          </div>

          {error && <div className="modal-error-banner">⚠️ {error}</div>}
          {result && (
            <div className={`cookie-result ${result.saved ? "cookie-result-ok" : "cookie-result-bad"}`}>
              <div className="cookie-result-title">{result.saved ? "✓ Key added" : "✕ Not added"}</div>
              <div className="cookie-result-msg">
                {result.saved
                  ? `Stored ${result.masked}${result.verification?.username ? ` — ${result.verification.username}` : ""}`
                  : result.verification?.message || result.message || result.error || "Validation failed"}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
