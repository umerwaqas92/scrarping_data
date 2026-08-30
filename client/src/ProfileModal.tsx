import { useEffect, useRef, useState } from "react";
import { getProfile, saveProfile } from "./api";

export const DEFAULT_SEARCH_QUERIES = [
  "React Native",
  "Flutter",
  "AI Agents",
  "Claude Code",
  "Next.js",
  "Python",
  "Full Stack Remote",
  "@gmail.com",
  "phone WhatsApp",
  "hiring contact",
];

const PRESET_SUGGESTIONS = [
  "React Developer",
  "Flutter Developer",
  "Node.js Backend",
  "Full Stack Engineer",
  "AI Engineer",
  "Mobile App Developer",
  "Python FastAPI",
  "DevOps Engineer",
  "UI/UX Designer",
  "Web3 Developer",
  "Contract C2C",
  "Urgent Hiring",
];

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  onProfileUpdated?: (queries: string[]) => void;
  initialTab?: "queries" | "profile";
}

export default function ProfileModal({
  open,
  onClose,
  onProfileUpdated,
  initialTab = "queries",
}: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<"queries" | "profile">(initialTab);
  const [content, setContent] = useState("");
  const [queries, setQueries] = useState<string[]>([]);
  const [newQueryInput, setNewQueryInput] = useState("");
  const [showBulkInput, setShowBulkInput] = useState(false);
  const [bulkQueriesText, setBulkQueriesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);

  // Sync initial tab when modal opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  // Load profile when modal opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    getProfile()
      .then((data) => {
        setContent(data.content || "");
        const loadedQueries = Array.isArray(data.queries) && data.queries.length > 0
          ? data.queries
          : DEFAULT_SEARCH_QUERIES;
        setQueries(loadedQueries);
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));

    setTimeout(() => {
      if (activeTab === "profile") {
        textareaRef.current?.focus();
      } else {
        queryInputRef.current?.focus();
      }
    }, 80);
  }, [open, activeTab]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function handleAddQuery(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = newQueryInput.trim();
    if (!trimmed) return;

    // Split if user pasted comma or newline separated
    const incoming = trimmed
      .split(/[,\n]+/)
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    setQueries((prev) => {
      const lower = new Set(prev.map((q) => q.toLowerCase()));
      const added = incoming.filter((q) => !lower.has(q.toLowerCase()));
      return [...prev, ...added];
    });

    setNewQueryInput("");
    queryInputRef.current?.focus();
  }

  function handleRemoveQuery(indexToRemove: number) {
    setQueries((prev) => prev.filter((_, i) => i !== indexToRemove));
  }

  function handleAddPreset(preset: string) {
    if (queries.some((q) => q.toLowerCase() === preset.toLowerCase())) return;
    setQueries((prev) => [...prev, preset]);
  }

  function handleResetDefaults() {
    setQueries([...DEFAULT_SEARCH_QUERIES]);
  }

  function handleClearAllQueries() {
    setQueries([]);
  }

  function handleApplyBulkQueries() {
    const lines = bulkQueriesText
      .split(/[\n,]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return;

    setQueries((prev) => {
      const lower = new Set(prev.map((q) => q.toLowerCase()));
      const filtered = lines.filter((q) => !lower.has(q.toLowerCase()));
      return [...prev, ...filtered];
    });

    setBulkQueriesText("");
    setShowBulkInput(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveProfile(content, queries);
      setSaved(true);
      if (onProfileUpdated) {
        onProfileUpdated(queries);
      }
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const charCount = content.length;
  const PLACEHOLDER = `Paste all your profile details here in plain text. For example:

Name: John Doe
Title: Senior Full-Stack Developer
Skills: React, Node.js, TypeScript, PostgreSQL, AWS
Experience: 7 years building SaaS products and APIs
Hourly Rate: $45/hr
Availability: 30 hrs/week

Bio:
I specialize in building fast, scalable web applications. I've delivered 50+ projects on Upwork with a 100% job success score. I'm passionate about clean code, clear communication, and delivering on time.

Portfolio:
- https://github.com/johndoe
- https://johndoe.dev`;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel profile-modal-panel" role="dialog" aria-modal="true" aria-label="My Profile">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">👤</span>
            <div>
              <h2 className="modal-title">My Freelancer Profile</h2>
              <p className="modal-subtitle">Configure your saved search queries & AI proposal profile</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="profile-modal-tabs">
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === "queries" ? "is-active" : ""}`}
            onClick={() => setActiveTab("queries")}
          >
            <span className="tab-icon">🔍</span>
            <span>Saved Search Queries</span>
            <span className="tab-count-badge">{queries.length}</span>
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === "profile" ? "is-active" : ""}`}
            onClick={() => setActiveTab("profile")}
          >
            <span className="tab-icon">📄</span>
            <span>Freelancer Bio & AI Resume</span>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body profile-modal-body">
          {loading ? (
            <div className="modal-loading">
              <span className="btn-spinner" />
              <span>Loading profile…</span>
            </div>
          ) : activeTab === "queries" ? (
            /* ── TAB 1: Saved Search Queries ── */
            <div className="saved-queries-manager">
              <div className="queries-info-box">
                <div className="info-icon">💡</div>
                <div className="info-text">
                  <strong>Queries appear directly under the search bar</strong> as 1-tap buttons for rapid multi-platform job searches.
                </div>
              </div>

              {/* Add Single / Multi Query Bar */}
              <form onSubmit={handleAddQuery} className="add-query-form">
                <div className="add-query-input-wrap">
                  <span className="input-search-symbol">🔍</span>
                  <input
                    ref={queryInputRef}
                    type="text"
                    className="add-query-input"
                    value={newQueryInput}
                    onChange={(e) => setNewQueryInput(e.target.value)}
                    placeholder="Enter search query or keyword (e.g. Flutter developer, Next.js, AI Agents)..."
                    aria-label="Add new search query"
                  />
                </div>
                <button
                  type="submit"
                  className="btn-add-query"
                  disabled={!newQueryInput.trim()}
                >
                  <span>+ Add Query</span>
                </button>
              </form>

              {/* Current Saved Queries Tag List */}
              <div className="saved-queries-section">
                <div className="section-header-row">
                  <span className="section-title">
                    Active Saved Queries ({queries.length})
                  </span>
                  <div className="section-actions">
                    <button
                      type="button"
                      className="btn-link-action"
                      onClick={() => setShowBulkInput(!showBulkInput)}
                    >
                      {showBulkInput ? "Hide Bulk Paste" : "📋 Bulk Paste / Import"}
                    </button>
                    {queries.length > 0 && (
                      <button
                        type="button"
                        className="btn-link-action text-danger"
                        onClick={handleClearAllQueries}
                        title="Clear all saved queries"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {/* Bulk Paste Area (Collapsible) */}
                {showBulkInput && (
                  <div className="bulk-queries-box">
                    <textarea
                      className="bulk-queries-textarea"
                      value={bulkQueriesText}
                      onChange={(e) => setBulkQueriesText(e.target.value)}
                      placeholder="Paste queries separated by commas or new lines, e.g.:&#10;React Native developer&#10;Full Stack engineer&#10;Golang remote&#10;AI Chatbot"
                      rows={4}
                    />
                    <div className="bulk-actions-row">
                      <button
                        type="button"
                        className="btn-apply-bulk"
                        onClick={handleApplyBulkQueries}
                        disabled={!bulkQueriesText.trim()}
                      >
                        + Add Pasted Queries
                      </button>
                      <button
                        type="button"
                        className="btn-cancel-bulk"
                        onClick={() => setShowBulkInput(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Query Chips Grid */}
                {queries.length === 0 ? (
                  <div className="queries-empty-state">
                    <span className="empty-icon">📂</span>
                    <p className="empty-title">No saved queries yet</p>
                    <p className="empty-desc">
                      Add custom queries above or pick from suggested popular presets below.
                    </p>
                    <button
                      type="button"
                      className="btn-preset-reset"
                      onClick={handleResetDefaults}
                    >
                      Load Default Queries
                    </button>
                  </div>
                ) : (
                  <div className="query-tags-container">
                    {queries.map((q, idx) => (
                      <div key={`${q}-${idx}`} className="query-tag-pill">
                        <span className="tag-text">{q}</span>
                        <button
                          type="button"
                          className="tag-remove-btn"
                          onClick={() => handleRemoveQuery(idx)}
                          title={`Remove "${q}"`}
                          aria-label={`Remove query ${q}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Preset Suggestions Row */}
              <div className="preset-suggestions-section">
                <div className="section-header-row">
                  <span className="section-title">Popular Suggestions (Click to add):</span>
                  <button
                    type="button"
                    className="btn-link-action"
                    onClick={handleResetDefaults}
                  >
                    Reset to Defaults
                  </button>
                </div>
                <div className="preset-tags-list">
                  {PRESET_SUGGESTIONS.map((preset) => {
                    const alreadyAdded = queries.some(
                      (q) => q.toLowerCase() === preset.toLowerCase()
                    );
                    return (
                      <button
                        key={preset}
                        type="button"
                        className={`preset-pill ${alreadyAdded ? "preset-pill-added" : ""}`}
                        onClick={() => handleAddPreset(preset)}
                        disabled={alreadyAdded}
                        title={alreadyAdded ? "Already in saved queries" : `Add "${preset}"`}
                      >
                        <span>{alreadyAdded ? "✓" : "+"}</span>
                        <span>{preset}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* ── TAB 2: Freelancer Resume & Bio ── */
            <div className="profile-bio-tab">
              <label className="profile-textarea-label" htmlFor="profile-textarea">
                All your details in one place — name, skills, rates, bio, portfolio links, anything.
                Our AI uses this context to draft highly personalized proposals.
              </label>
              <textarea
                id="profile-textarea"
                ref={textareaRef}
                className="profile-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={PLACEHOLDER}
                rows={16}
                spellCheck={false}
              />
              <div className="profile-textarea-meta">
                <span className={`char-count ${charCount > 4000 ? "char-count-warn" : ""}`}>
                  {charCount.toLocaleString()} characters
                </span>
                {charCount === 0 && (
                  <span className="char-hint">Start by pasting your details above ↑</span>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="modal-error-banner">⚠️ {error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button type="button" className="modal-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`modal-btn-save ${saved ? "btn-saved" : ""}`}
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? (
              <><span className="btn-spinner" /> Saving…</>
            ) : saved ? (
              <>✓ Saved!</>
            ) : (
              <>💾 Save Profile</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
