import { useEffect, useRef, useState } from "react";
import { getProfile, saveProfile } from "./api";

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ProfileModal({ open, onClose }: ProfileModalProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load profile when modal opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    getProfile()
      .then((data) => setContent(data.content))
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveProfile(content);
      setSaved(true);
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
              <p className="modal-subtitle">This info is used by AI to write tailored job proposals</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {loading ? (
            <div className="modal-loading">
              <span className="btn-spinner" />
              <span>Loading profile…</span>
            </div>
          ) : (
            <>
              <label className="profile-textarea-label" htmlFor="profile-textarea">
                All your details in one place — name, skills, rates, bio, portfolio links, anything
              </label>
              <textarea
                id="profile-textarea"
                ref={textareaRef}
                className="profile-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={PLACEHOLDER}
                rows={18}
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
            </>
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
