import React, { useState, useEffect } from "react";
import { WhatsAppIcon } from "./FeedCard";

export interface WhatsAppModalProps {
  open: boolean;
  initialPhone?: string;
  detectedPhones?: string[];
  recipientName?: string;
  jobTitle?: string;
  jobUrl?: string;
  proposalText?: string;
  contextText?: string;
  onClose: () => void;
}

const COUNTRY_CODES = [
  { code: "91", name: "India", flag: "🇮🇳", prefix: "+91" },
  { code: "92", name: "Pakistan", flag: "🇵🇰", prefix: "+92" },
  { code: "1", name: "USA / Canada", flag: "🇺🇸", prefix: "+1" },
  { code: "44", name: "United Kingdom", flag: "🇬🇧", prefix: "+44" },
  { code: "971", name: "UAE", flag: "🇦🇪", prefix: "+971" },
  { code: "966", name: "Saudi Arabia", flag: "🇸🇦", prefix: "+966" },
  { code: "49", name: "Germany", flag: "🇩🇪", prefix: "+49" },
  { code: "61", name: "Australia", flag: "🇦🇺", prefix: "+61" },
  { code: "880", name: "Bangladesh", flag: "🇧🇩", prefix: "+880" },
  { code: "234", name: "Nigeria", flag: "🇳🇬", prefix: "+234" },
  { code: "63", name: "Philippines", flag: "🇵🇭", prefix: "+63" },
  { code: "65", name: "Singapore", flag: "🇸🇬", prefix: "+65" },
  { code: "custom", name: "Other (Full International)", flag: "🌐", prefix: "" },
];

/** Parse an incoming phone string into country code and local number */
export function parsePhoneInput(
  rawPhone: string,
  contextText?: string
): { selectedCountryCode: string; localNumber: string } {
  if (!rawPhone) {
    // Default country based on context hints
    if (contextText && /\b(karachi|lahore|islamabad|rawalpindi|pakistan|pk)\b/i.test(contextText)) {
      return { selectedCountryCode: "92", localNumber: "" };
    }
    return { selectedCountryCode: "91", localNumber: "" };
  }

  let cleaned = rawPhone.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    for (const c of COUNTRY_CODES) {
      if (c.code !== "custom" && digits.startsWith(c.code)) {
        return {
          selectedCountryCode: c.code,
          localNumber: digits.slice(c.code.length),
        };
      }
    }
    return { selectedCountryCode: "custom", localNumber: digits };
  }

  // Pakistan 03... format (11 digits)
  if (cleaned.length === 11 && cleaned.startsWith("03")) {
    return { selectedCountryCode: "92", localNumber: cleaned.slice(1) };
  }

  // UK 07... format (11 digits)
  if (cleaned.length === 11 && cleaned.startsWith("07")) {
    return { selectedCountryCode: "44", localNumber: cleaned.slice(1) };
  }

  // If starts with 91 and 12 digits (India +91)
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    return { selectedCountryCode: "91", localNumber: cleaned.slice(2) };
  }

  // If starts with 92 and 12 digits (Pakistan +92)
  if (cleaned.length === 12 && cleaned.startsWith("92")) {
    return { selectedCountryCode: "92", localNumber: cleaned.slice(2) };
  }

  // 10 digits
  if (cleaned.length === 10) {
    if (contextText && /\b(karachi|lahore|islamabad|rawalpindi|pakistan|pk)\b/i.test(contextText)) {
      return { selectedCountryCode: "92", localNumber: cleaned };
    }
    // Default India for 10-digit numbers starting with 6-9
    if (/^[6-9]/.test(cleaned)) {
      return { selectedCountryCode: "91", localNumber: cleaned };
    }
    // USA/Canada for numbers starting with 2-5
    if (/^[2-5]/.test(cleaned)) {
      return { selectedCountryCode: "1", localNumber: cleaned };
    }
  }

  return { selectedCountryCode: "91", localNumber: cleaned };
}

export default function WhatsAppModal({
  open,
  initialPhone = "",
  detectedPhones = [],
  recipientName,
  jobTitle,
  jobUrl,
  proposalText,
  contextText,
  onClose,
}: WhatsAppModalProps) {
  const [countryCode, setCountryCode] = useState("91");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [message, setMessage] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (open) {
      const activePhone = initialPhone || (detectedPhones.length > 0 ? detectedPhones[0] : "");
      const { selectedCountryCode, localNumber } = parsePhoneInput(activePhone, contextText);
      setCountryCode(selectedCountryCode);
      setPhoneNumber(localNumber);

      // Default polite greeting
      const greeting = recipientName ? `Hi ${recipientName.split(" ")[0]},` : "Hi,";
      const subject = jobTitle ? ` I saw your post regarding "${jobTitle}".` : " I saw your post.";
      const defaultMsg = proposalText
        ? `${greeting}\n\n${proposalText}`
        : `${greeting}${subject} Are you still looking for someone to assist with this?\n\nI'd love to discuss how I can help!${jobUrl ? `\n\nReference: ${jobUrl}` : ""}`;

      setMessage(defaultMsg);
      setCopiedLink(false);
    }
  }, [open, initialPhone, detectedPhones, recipientName, jobTitle, jobUrl, proposalText, contextText]);

  if (!open) return null;

  // Build full clean phone number for wa.me
  const cleanLocal = phoneNumber.replace(/\D/g, "").replace(/^0+/, "");
  const fullDigits =
    countryCode === "custom" ? cleanLocal : cleanLocal ? `${countryCode}${cleanLocal}` : "";

  const whatsappUrl = fullDigits
    ? `https://wa.me/${fullDigits}${message ? `?text=${encodeURIComponent(message)}` : ""}`
    : "";

  const handleOpenWhatsApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullDigits) return;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    onClose();
  };

  const handleCopyLink = async () => {
    if (!whatsappUrl) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(whatsappUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = whatsappUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // ignore
    }
  };

  const handleSelectSuggestedPhone = (ph: string) => {
    const { selectedCountryCode, localNumber } = parsePhoneInput(ph, contextText);
    setCountryCode(selectedCountryCode);
    setPhoneNumber(localNumber);
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel whatsapp-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Open in WhatsApp"
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon whatsapp-header-icon">
              <WhatsAppIcon size={22} />
            </span>
            <div>
              <h2 className="modal-title">Open in WhatsApp</h2>
              <p className="modal-subtitle">
                {recipientName ? `Chat directly with ${recipientName}` : "Send message via WhatsApp"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleOpenWhatsApp} className="modal-body whatsapp-modal-body">
          {/* Detected Phone Number Suggestions (if multiple found) */}
          {detectedPhones.length > 0 && (
            <div className="whatsapp-suggestions-row">
              <span className="whatsapp-suggestions-label">Found in post:</span>
              <div className="whatsapp-suggestions-list">
                {detectedPhones.map((ph) => {
                  const isCurrent =
                    phoneNumber.replace(/\D/g, "") === ph.replace(/\D/g, "") ||
                    `${countryCode}${phoneNumber}`.replace(/\D/g, "") === ph.replace(/\D/g, "");
                  return (
                    <button
                      key={ph}
                      type="button"
                      className={`whatsapp-phone-chip ${isCurrent ? "is-selected" : ""}`}
                      onClick={() => handleSelectSuggestedPhone(ph)}
                    >
                      <span>📞 {ph}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Phone Number Input with Country Selector */}
          <div className="whatsapp-field-group">
            <label className="whatsapp-field-label">
              Phone Number / WhatsApp Contact <span className="req-star">*</span>
            </label>
            <div className="whatsapp-input-row">
              <div className="whatsapp-country-select-wrap">
                <select
                  className="whatsapp-country-select"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  aria-label="Select Country Code"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.prefix ? `${c.prefix} (${c.name})` : c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="whatsapp-number-input-wrap">
                <input
                  type="tel"
                  className="whatsapp-number-input"
                  placeholder="Enter phone number, e.g. 9926640483"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  autoFocus
                  required
                />
                {phoneNumber && (
                  <button
                    type="button"
                    className="whatsapp-clear-btn"
                    onClick={() => setPhoneNumber("")}
                    title="Clear phone number"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {fullDigits ? (
              <div className="whatsapp-preview-badge">
                <span className="preview-label">Formatted:</span>
                <span className="preview-number">+{fullDigits}</span>
              </div>
            ) : (
              <div className="whatsapp-hint-text">
                💡 Enter the contact number. Country code is automatically prefixed for WhatsApp.
              </div>
            )}
          </div>

          {/* Message Area */}
          <div className="whatsapp-field-group">
            <div className="whatsapp-label-with-action">
              <label className="whatsapp-field-label">Message Preview</label>
              {proposalText && (
                <button
                  type="button"
                  className="whatsapp-insert-proposal-btn"
                  onClick={() => setMessage(proposalText)}
                >
                  📄 Use AI Proposal
                </button>
              )}
            </div>
            <textarea
              className="whatsapp-message-textarea"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message to send on WhatsApp..."
            />
          </div>

          {/* Footer Actions */}
          <div className="whatsapp-modal-footer">
            <button
              type="button"
              className="btn-whatsapp-secondary"
              onClick={handleCopyLink}
              disabled={!fullDigits}
              title="Copy direct wa.me link"
            >
              {copiedLink ? "✓ Copied Link!" : "📋 Copy Link"}
            </button>

            <button
              type="submit"
              className="btn-whatsapp-primary"
              disabled={!fullDigits}
            >
              <WhatsAppIcon size={16} />
              <span>Open in WhatsApp</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
