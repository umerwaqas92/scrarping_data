import { useEffect, useRef, useState } from "react";
import {
  getProfile,
  saveProfile,
  getResumesList,
  saveResume,
  deleteResume,
  getResumeDownloadUrl,
  type ResumeItem,
} from "./api";
import PdfPreviewModal from "./PdfPreviewModal";

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

export type ProfileTab = "queries" | "bio" | "resumes" | "profile";

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  onProfileUpdated?: (queries: string[]) => void;
  initialTab?: ProfileTab;
}

function normalizeTab(tab?: ProfileTab): "queries" | "bio" | "resumes" {
  if (tab === "resumes") return "resumes";
  if (tab === "bio" || tab === "profile") return "bio";
  return "queries";
}

export default function ProfileModal({
  open,
  onClose,
  onProfileUpdated,
  initialTab = "queries",
}: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<"queries" | "bio" | "resumes">(
    normalizeTab(initialTab)
  );
  const [content, setContent] = useState("");
  const [wrapMode, setWrapMode] = useState(false); // false = No Wrap (Scroll X + Y), true = Soft Wrap
  const [fontSize, setFontSize] = useState<"xs" | "sm" | "md">("sm");
  const [copiedBio, setCopiedBio] = useState(false);
  const [queries, setQueries] = useState<string[]>([]);
  const [newQueryInput, setNewQueryInput] = useState("");
  const [showBulkInput, setShowBulkInput] = useState(false);
  const [bulkQueriesText, setBulkQueriesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resumes list (email attachments) & PDF preview
  const [resumesList, setResumesList] = useState<ResumeItem[]>([]);
  const [previewResumeId, setPreviewResumeId] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeSaved, setResumeSaved] = useState(false);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);

  // Sync initial tab when modal opens
  useEffect(() => {
    if (open) {
      setActiveTab(normalizeTab(initialTab));
    }
  }, [open, initialTab]);

  // Load profile and resumes when modal opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    setResumeError(null);
    setResumeSaved(false);
    getResumesList().then(setResumesList).catch(() => setResumesList([]));
    getProfile()
      .then((data) => {
        setContent(data.content || "");
        const loadedQueries =
          Array.isArray(data.queries) && data.queries.length > 0
            ? data.queries
            : DEFAULT_SEARCH_QUERIES;
        setQueries(loadedQueries);
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));

    setTimeout(() => {
      if (activeTab === "bio") {
        textareaRef.current?.focus();
      } else if (activeTab === "queries") {
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

  async function handleCopyBio() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedBio(true);
      setTimeout(() => setCopiedBio(false), 2000);
    } catch (e) {
      console.warn("Copy to clipboard failed", e);
    }
  }

  function handleClearBio() {
    if (content.length > 50) {
      if (!window.confirm("Are you sure you want to clear the profile text?")) {
        return;
      }
    }
    setContent("");
    textareaRef.current?.focus();
  }

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setResumeError(null);
    setResumeBusy(true);
    try {
      const fileList = Array.from(files);
      for (const file of fileList) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || "");
            resolve(result.includes(",") ? result.split(",")[1] : result);
          };
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
          reader.readAsDataURL(file);
        });
        await saveResume(file.name, base64);
      }
      const updatedList = await getResumesList();
      setResumesList(updatedList);
      setResumeSaved(true);
      setTimeout(() => setResumeSaved(false), 2500);
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setResumeBusy(false);
      if (resumeInputRef.current) resumeInputRef.current.value = "";
    }
  }

  async function handleResumeDelete(id: string) {
    setResumeError(null);
    setResumeBusy(true);
    try {
      await deleteResume(id);
      const updatedList = await getResumesList();
      setResumesList(updatedList);
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setResumeBusy(false);
    }
  }

  if (!open) return null;

  const charCount = content.length;
  const lineCount = content ? content.split("\n").length : 0;
  const PLACEHOLDER = `Paste all your profile details here in plain text. For example:

Name: John Doe
Title: Senior Full-Stack Developer
Skills: React, Node.js, TypeScript, PostgreSQL, AWS, Python
Experience: 7 years building SaaS products and APIs
Hourly Rate: $45/hr
Availability: 30 hrs/week

Bio:
I specialize in building fast, scalable web applications. I've delivered 50+ projects on Upwork with a 100% job success score. I'm passionate about clean code, clear communication, and delivering on time.

Portfolio / Links:
- https://github.com/johndoe
- https://johndoe.dev`;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel profile-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="My Profile"
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">👤</span>
            <div>
              <h2 className="modal-title">My Freelancer Profile</h2>
              <p className="modal-subtitle">
                Configure saved search queries, AI proposal context & PDF resumes
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal Navigation Tabs (3 Dedicated Tabs) */}
        <div className="profile-modal-tabs">
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === "queries" ? "is-active" : ""}`}
            onClick={() => setActiveTab("queries")}
          >
            <span className="tab-icon">🔍</span>
            <span>Saved Queries</span>
            <span className="tab-count-badge">{queries.length}</span>
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === "bio" ? "is-active" : ""}`}
            onClick={() => setActiveTab("bio")}
          >
            <span className="tab-icon">✍️</span>
            <span>Freelancer Bio & Text</span>
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === "resumes" ? "is-active" : ""}`}
            onClick={() => setActiveTab("resumes")}
          >
            <span className="tab-icon">📎</span>
            <span>Resume PDFs</span>
            <span className="tab-count-badge">{resumesList.length}</span>
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
                  <strong>Queries appear directly under the search bar</strong> as
                  1-tap buttons for rapid multi-platform job searches.
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
          ) : activeTab === "bio" ? (
            /* ── TAB 2: Freelancer Resume & Bio (Scrollable X+Y & No Wrap) ── */
            <div className="profile-bio-tab">
              {/* Bio Header / Toolbar */}
              <div className="profile-bio-toolbar">
                <div className="profile-bio-toolbar-info">
                  <span className="profile-bio-heading">Freelancer Details & AI Context</span>
                  <span className="profile-bio-counts">
                    {lineCount.toLocaleString()} {lineCount === 1 ? "line" : "lines"} ·{" "}
                    <strong className={charCount > 4000 ? "char-count-warn" : ""}>
                      {charCount.toLocaleString()}
                    </strong>{" "}
                    chars
                  </span>
                </div>

                <div className="profile-bio-toolbar-actions">
                  {/* Wrap Mode Toggle Button */}
                  <button
                    type="button"
                    className={`btn-profile-tool ${!wrapMode ? "is-active" : ""}`}
                    onClick={() => setWrapMode(!wrapMode)}
                    title={
                      !wrapMode
                        ? "No Wrap active (Lines scroll horizontally). Click to enable word wrap."
                        : "Word Wrap active. Click for No-Wrap mode."
                    }
                  >
                    <span>{!wrapMode ? "↔️ No-Wrap (Scroll X+Y)" : "↩ Line Wrap"}</span>
                  </button>

                  {/* Copy All Button */}
                  <button
                    type="button"
                    className="btn-profile-tool"
                    onClick={handleCopyBio}
                    disabled={!content}
                    title="Copy all text to clipboard"
                  >
                    <span>{copiedBio ? "✓ Copied!" : "📋 Copy"}</span>
                  </button>

                  {/* Clear Button */}
                  {content.length > 0 && (
                    <button
                      type="button"
                      className="btn-profile-tool btn-profile-tool-danger"
                      onClick={handleClearBio}
                      title="Clear text"
                    >
                      <span>🗑️ Clear</span>
                    </button>
                  )}
                </div>
              </div>

              <p className="profile-textarea-description">
                All your details in one place — name, skills, rates, bio, portfolio links,
                tables, and project summaries. Our AI uses this exact text to draft highly
                customized, winning proposals.
              </p>

              {/* Scrollable Textarea with No-Wrap support */}
              <div className="profile-textarea-wrapper">
                <textarea
                  id="profile-textarea"
                  ref={textareaRef}
                  className={`profile-textarea ${!wrapMode ? "profile-textarea-nowrap" : "profile-textarea-wrap"}`}
                  wrap={!wrapMode ? "off" : "soft"}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={PLACEHOLDER}
                  rows={19}
                  spellCheck={false}
                />
              </div>

              <div className="profile-textarea-footer-info">
                <span className="profile-textarea-hint">
                  {!wrapMode ? (
                    <>
                      <span className="hint-pill">↔️ Horizontal & Vertical Scroll</span>{" "}
                      No-wrap enabled: wide lines scroll smoothly horizontally without breaking
                      tables, markdown, or code.
                    </>
                  ) : (
                    <>
                      <span className="hint-pill">↩ Word Wrap</span> Text wraps automatically at
                      the box edge.
                    </>
                  )}
                </span>
              </div>
            </div>
          ) : (
            /* ── TAB 3: Dedicated Resume PDFs Manager ── */
            <div className="profile-resumes-tab">
              <div className="profile-resumes-tab-head">
                <div className="profile-resume-title-wrap">
                  <h3 className="profile-resumes-tab-title">
                    <span>📎</span> Resume PDFs ({resumesList.length})
                  </h3>
                  <p className="profile-resumes-tab-subtitle">
                    Upload multiple PDF resumes. Attach them directly to proposal emails and
                    preview them anytime in crystal-clear quality.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-add-resume-upload-primary"
                  onClick={() => resumeInputRef.current?.click()}
                  disabled={resumeBusy}
                >
                  <span>{resumeBusy ? "⏳ Uploading…" : "+ Upload PDF(s)"}</span>
                </button>
              </div>

              {resumeSaved && (
                <div className="profile-resume-saved">✓ Resume(s) uploaded and saved successfully!</div>
              )}
              {resumeError && (
                <div className="modal-error-banner">⚠️ {resumeError}</div>
              )}

              {/* Uploaded Resumes List */}
              {resumesList.length > 0 ? (
                <div className="profile-resumes-grid">
                  {resumesList.map((item) => (
                    <div
                      key={item.id}
                      className="profile-resume-item-card"
                      onClick={() => setPreviewResumeId(item.id)}
                      role="button"
                      tabIndex={0}
                      title={`Click to preview ${item.filename}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPreviewResumeId(item.id);
                        }
                      }}
                    >
                      <div className="profile-resume-item-icon">📄</div>
                      <div className="profile-resume-item-info">
                        <span className="profile-resume-item-name" title={item.filename}>
                          {item.filename}
                        </span>
                        <span className="profile-resume-item-meta">
                          {item.size ? `${Math.round(item.size / 1024)} KB` : "PDF"}
                          {item.created_at
                            ? ` · ${new Date(item.created_at).toLocaleDateString()}`
                            : ""}
                          <span className="profile-resume-click-hint">
                            {" "}
                            · 👁️ Click to preview
                          </span>
                        </span>
                      </div>

                      <div
                        className="profile-resume-item-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="profile-resume-item-btn btn-preview-resume"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewResumeId(item.id);
                          }}
                          title={`Preview ${item.filename}`}
                          aria-label={`Preview ${item.filename}`}
                        >
                          <span>👁️</span>
                          <span className="btn-preview-label">Preview</span>
                        </button>

                        <a
                          href={getResumeDownloadUrl(item.id)}
                          download={item.filename}
                          className="profile-resume-item-btn btn-download-resume"
                          onClick={(e) => e.stopPropagation()}
                          title={`Download ${item.filename}`}
                          aria-label={`Download ${item.filename}`}
                        >
                          <span>⬇️</span>
                        </a>

                        <button
                          type="button"
                          className="profile-resume-item-btn profile-resume-item-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResumeDelete(item.id);
                          }}
                          disabled={resumeBusy}
                          title={`Delete ${item.filename}`}
                          aria-label={`Delete ${item.filename}`}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="profile-resumes-empty-box">
                  <div className="empty-icon-bubble">📁</div>
                  <h4 className="empty-heading">No PDF Resumes Uploaded Yet</h4>
                  <p className="empty-description">
                    Upload your customized resumes (e.g. Full-Stack, Mobile Developer, AI
                    Engineer). You can select which PDF to attach when sending proposals to
                    clients.
                  </p>
                  <button
                    type="button"
                    className="btn-add-resume-upload-primary empty-upload-btn"
                    onClick={() => resumeInputRef.current?.click()}
                    disabled={resumeBusy}
                  >
                    <span>+ Upload PDF Resumes</span>
                  </button>
                </div>
              )}

              <input
                ref={resumeInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={handleResumeUpload}
                style={{ display: "none" }}
              />
            </div>
          )}

          {error && <div className="modal-error-banner">⚠️ {error}</div>}
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
              <>
                <span className="btn-spinner" /> Saving…
              </>
            ) : saved ? (
              <>✓ Saved!</>
            ) : (
              <>💾 Save Profile</>
            )}
          </button>
        </div>
      </div>

      {/* PDF Preview Modal */}
      <PdfPreviewModal
        open={Boolean(previewResumeId)}
        onClose={() => setPreviewResumeId(null)}
        resumeId={previewResumeId || undefined}
        resumesList={resumesList}
        onDelete={handleResumeDelete}
      />
    </div>
  );
}
