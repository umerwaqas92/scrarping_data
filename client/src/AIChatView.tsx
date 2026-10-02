import React, { useState, useEffect, useRef } from "react";
import { AIChatMessage, sendAIChatMessage, getProfile } from "./api";
import { AppliedJobRecord } from "./AppliedJobCard";
import { getItemContacts } from "./FeedCard";

interface AIChatViewProps {
  appliedList: AppliedJobRecord[];
  currentQuery?: string;
  onSwitchTab?: (tab: "posts" | "applied" | "chat" | "profile") => void;
  onOpenProfile?: () => void;
}

const CHAT_STORAGE_KEY = "multifeed_ai_chat_messages_v1";

const STARTER_PROMPTS = [
  {
    icon: "🚀",
    label: "Cold Outreach Pitch",
    prompt: "Write a high-converting, personalized cold email/pitch for a recruiter looking for a Senior Flutter & Full-Stack Engineer. Highlight my relevant project metrics and available start date.",
  },
  {
    icon: "📊",
    label: "Analyze Applied Jobs",
    prompt: "Analyze my recent applied jobs list. Which ones should I follow up on first, and what angle or message should I use for each?",
  },
  {
    icon: "💬",
    label: "WhatsApp / LinkedIn DM",
    prompt: "Draft a casual, high-impact direct message for LinkedIn or WhatsApp to reach out directly to the hiring manager for my most recent application.",
  },
  {
    icon: "🎯",
    label: "Technical Interview Prep",
    prompt: "What are 5 tough technical and architectural questions a hiring manager might ask me based on my stack (Flutter, React/Next.js, Python, AWS), and how should I answer them?",
  },
  {
    icon: "📝",
    label: "Improve Profile Pitch",
    prompt: "Review my profile and skills. How can I make my bio and elevator pitch more compelling to attract high-budget clients and recruiters?",
  },
];

export function AIChatView({
  appliedList,
  currentQuery,
  onSwitchTab,
  onOpenProfile,
}: AIChatViewProps) {
  const [profileText, setProfileText] = useState<string>("");
  const [profileLoading, setProfileLoading] = useState(false);

  const [includeProfile, setIncludeProfile] = useState(true);
  const [includeApplied, setIncludeApplied] = useState(true);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Initialize messages from localStorage or default greeting
  const [messages, setMessages] = useState<AIChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn("Failed to load chat messages from localStorage", e);
    }
    return [
      {
        id: "welcome-msg",
        role: "assistant",
        content: `👋 **Hi there! I am your AI Career & Application Copilot.**\n\nI have instant access to your **freelancer profile**, your **${appliedList.length} tracked applied jobs**, and current search queries.\n\nYou can ask me to:\n- ✍️ **Draft custom proposals, cold emails, or WhatsApp DMs** tailored to specific companies.\n- 📈 **Analyze your applied jobs** and write strategic follow-up messages.\n- 🎯 **Prepare for technical interviews** across your stack (Flutter, React/Next.js, Python, Cloud, etc.).\n- 💼 **Tailor your resume or portfolio pitches** for any role.\n\n*Choose a suggested prompt below or type any task to get started!*`,
        timestamp: new Date().toISOString(),
      },
    ];
  });

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load profile from database
  useEffect(() => {
    let isMounted = true;
    setProfileLoading(true);
    getProfile()
      .then((p) => {
        if (isMounted && p && p.content) {
          setProfileText(p.content);
        }
      })
      .catch((e) => {
        console.warn("Failed to fetch profile context for AI chat", e);
      })
      .finally(() => {
        if (isMounted) setProfileLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Save messages to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {
      console.warn("Failed to persist AI chat messages", e);
    }
  }, [messages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Build applied jobs summary for the AI prompt
  const buildAppliedJobsSummary = (): string => {
    if (!includeApplied || appliedList.length === 0) return "";
    const topApplied = appliedList.slice(0, 15);
    return topApplied
      .map((entry, idx) => {
        const item = entry.item;
        const contacts = item ? getItemContacts(item) : { emails: [], phones: [] };
        const lines = [
          `[#${idx + 1}] Title: ${entry.title || "Job Post"}`,
          entry.author ? `Company/Author: ${entry.author}` : "",
          entry.source ? `Platform: ${entry.source}` : "",
          entry.appliedAt ? `Applied Date: ${entry.appliedAt}` : "",
          entry.url ? `URL: ${entry.url}` : "",
          contacts.emails.length > 0 ? `Contacts Email: ${contacts.emails.join(", ")}` : "",
          contacts.phones.length > 0 ? `Contacts Phone: ${contacts.phones.join(", ")}` : "",
          entry.note ? `My Notes: ${entry.note}` : "",
          entry.proposal ? `Proposal Snippet: ${entry.proposal.slice(0, 200)}...` : "",
        ].filter(Boolean);
        return lines.join(" | ");
      })
      .join("\n");
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText ?? input).trim();
    if (!textToSend || loading) return;

    setError(null);
    const userMessage: AIChatMessage = {
      id: "msg-" + Date.now() + "-u",
      role: "user",
      content: textToSend,
      timestamp: new Date().toISOString(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    if (!customText) setInput("");

    setLoading(true);

    try {
      // Build request payload with injected context
      const response = await sendAIChatMessage({
        messages: updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        profileContent: includeProfile ? profileText : undefined,
        appliedJobsSummary: includeApplied ? buildAppliedJobsSummary() : undefined,
        currentSearchQuery: currentQuery || undefined,
      });

      const assistantMessage: AIChatMessage = {
        id: "msg-" + Date.now() + "-a",
        role: "assistant",
        content: response.message || "I received an empty response. Please try asking again.",
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error("Failed to send AI chat message", err);
      setError(err?.message || "Failed to communicate with AI API. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearHistory = () => {
    if (window.confirm("Are you sure you want to clear your AI chat history?")) {
      const resetMsg: AIChatMessage = {
        id: "welcome-msg",
        role: "assistant",
        content: `👋 Chat cleared! How can I assist you with your applications, pitch writing, or job search today?`,
        timestamp: new Date().toISOString(),
      };
      setMessages([resetMsg]);
      localStorage.removeItem(CHAT_STORAGE_KEY);
    }
  };

  const handleCopyMessage = async (content: string, index: number) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (e) {
      console.warn("Failed to copy message", e);
    }
  };

  const [hideHeader, setHideHeader] = useState<boolean>(() => {
    try {
      return localStorage.getItem("multifeed_ai_chat_hide_header") === "true";
    } catch {
      return false;
    }
  });

  const [hideStarterPrompts, setHideStarterPrompts] = useState<boolean>(() => {
    try {
      return localStorage.getItem("multifeed_ai_chat_hide_starters") === "true";
    } catch {
      return false;
    }
  });

  const toggleHideHeader = (val: boolean) => {
    setHideHeader(val);
    try {
      localStorage.setItem("multifeed_ai_chat_hide_header", String(val));
    } catch (e) {
      console.warn(e);
    }
  };

  const toggleHideStarters = (val: boolean) => {
    setHideStarterPrompts(val);
    try {
      localStorage.setItem("multifeed_ai_chat_hide_starters", String(val));
    } catch (e) {
      console.warn(e);
    }
  };

  return (
    <section className="ai-chat-view">
      {/* Sleek 1-Line Top Bar (with Hide toggle) */}
      {!hideHeader ? (
        <div className="ai-chat-compact-bar">
          <div className="ai-chat-compact-left">
            <div className="ai-chat-mini-brand">
              <span className="ai-mini-spark">✨</span>
              <span className="ai-mini-title">AI Copilot</span>
            </div>

            <button
              type="button"
              className={`ai-context-chip-mini ${includeProfile ? "is-active" : ""}`}
              onClick={() => setIncludeProfile((v) => !v)}
              title={includeProfile ? "Profile context included (click to disable)" : "Profile context excluded (click to enable)"}
            >
              <span>👤</span>
              <span>Profile {profileLoading ? "(...)" : profileText ? "✓" : "(empty)"}</span>
            </button>

            <button
              type="button"
              className={`ai-context-chip-mini ${includeApplied ? "is-active" : ""}`}
              onClick={() => setIncludeApplied((v) => !v)}
              title={includeApplied ? "Applied jobs context included (click to disable)" : "Applied jobs excluded (click to enable)"}
            >
              <span>💼</span>
              <span>Applied ({appliedList.length})</span>
            </button>

            {currentQuery && (
              <button
                type="button"
                className="ai-context-chip-mini is-query-mini"
                onClick={() => onSwitchTab?.("posts")}
                title="Click to view posts for this topic"
              >
                <span>🔍</span>
                <span>{currentQuery}</span>
              </button>
            )}

            {onOpenProfile && (
              <button
                type="button"
                className="ai-chat-mini-action-btn"
                onClick={onOpenProfile}
                title="Edit your Freelancer Profile data"
              >
                ⚙️ Edit Profile
              </button>
            )}
          </div>

          <div className="ai-chat-compact-right">
            <button
              type="button"
              className="ai-chat-mini-action-btn btn-clear-mini"
              onClick={handleClearHistory}
              title="Clear conversation history"
            >
              🗑 Clear
            </button>

            <button
              type="button"
              className="ai-chat-mini-action-btn btn-hide-top-bar"
              onClick={() => toggleHideHeader(true)}
              title="Hide top bar for full-screen chat"
            >
              ▲ Hide
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-chat-hidden-bar-toggle">
          <button
            type="button"
            className="btn-restore-top-bar"
            onClick={() => toggleHideHeader(false)}
            title="Show context and settings bar"
          >
            ✨ AI Settings ({includeProfile ? "Profile" : ""}{includeProfile && includeApplied ? ", " : ""}{includeApplied ? `${appliedList.length} Applied` : ""}) ▼
          </button>

          <button
            type="button"
            className="ai-chat-mini-action-btn btn-clear-mini"
            onClick={handleClearHistory}
            title="Clear conversation history"
          >
            🗑 Clear
          </button>
        </div>
      )}

      {/* Suggested Starter Prompt Chips */}
      {messages.length <= 2 && !hideStarterPrompts && (
        <div className="ai-starter-prompts-container">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="starter-prompts-label">⚡ Quick Suggested Tasks:</span>
            <button
              type="button"
              className="starter-prompts-dismiss"
              onClick={() => toggleHideStarters(true)}
              title="Hide suggestions"
              style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}
            >
              ✕ Hide
            </button>
          </div>
          <div className="ai-starter-prompts-list">
            {STARTER_PROMPTS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                className="ai-starter-prompt-btn"
                onClick={() => handleSendMessage(item.prompt)}
                disabled={loading}
              >
                <span className="starter-icon">{item.icon}</span>
                <span className="starter-text">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Messages Container */}
      <div className="ai-chat-messages-scroll">
        <div className="ai-chat-messages-inner">
          {messages.map((msg, index) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id || index}
                className={`ai-message-row ${isUser ? "is-user-row" : "is-assistant-row"}`}
              >
                <div className="ai-message-avatar" aria-hidden>
                  {isUser ? (
                    <span>👤</span>
                  ) : (
                    <div className="ai-avatar-spark">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="ai-message-bubble-wrap">
                  <div className="ai-message-header">
                    <span className="ai-message-author">
                      {isUser ? "You" : "AI Career Copilot"}
                    </span>
                    {msg.timestamp && (
                      <span className="ai-message-time">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>

                  <div className="ai-message-body">
                    {msg.content.split("\n\n").map((para, pIdx) => {
                      if (para.startsWith("```")) {
                        const code = para.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
                        return (
                          <pre key={pIdx} className="ai-code-block">
                            <code>{code}</code>
                          </pre>
                        );
                      }
                      return (
                        <p key={pIdx} className="ai-message-paragraph">
                          {para.split("\n").map((line, lIdx) => (
                            <React.Fragment key={lIdx}>
                              {renderFormattedText(line)}
                              {lIdx < para.split("\n").length - 1 && <br />}
                            </React.Fragment>
                          ))}
                        </p>
                      );
                    })}
                  </div>

                  {!isUser && (
                    <div className="ai-message-actions">
                      <button
                        type="button"
                        className="ai-copy-btn"
                        onClick={() => handleCopyMessage(msg.content, index)}
                        title="Copy response"
                      >
                        {copiedIndex === index ? "✓ Copied!" : "📋 Copy"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Typing Loading Indicator */}
          {loading && (
            <div className="ai-message-row is-assistant-row is-loading-row">
              <div className="ai-message-avatar" aria-hidden>
                <div className="ai-avatar-spark pulsing">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
                  </svg>
                </div>
              </div>
              <div className="ai-message-bubble-wrap">
                <div className="ai-typing-indicator">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-label">Analyzing profile & generating response...</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="ai-chat-error-banner">
              <span className="error-icon">⚠️</span>
              <span className="error-text">{error}</span>
              <button
                type="button"
                className="btn-retry-chat"
                onClick={() => handleSendMessage()}
              >
                Retry
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Message Input Box */}
      <div className="ai-chat-input-container">
        <form
          className="ai-chat-input-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
        >
          <textarea
            ref={textareaRef}
            className="ai-chat-textarea"
            placeholder="Ask anything... (e.g. 'Draft a follow-up email for my Flutter application', 'Help me prepare for system design questions')"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />

          <button
            type="submit"
            className="ai-chat-send-btn"
            disabled={!input.trim() || loading}
            title="Send message (Enter)"
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>

        <div className="ai-chat-input-hint">
          <span>Pro-tip: Press <kbd>Enter</kbd> to send, <kbd>Shift + Enter</kbd> for new line</span>
        </div>
      </div>
    </section>
  );
}

// Simple text formatter for bold, code, and list bullets
function renderFormattedText(line: string): React.ReactNode {
  // Bold formatting **text**
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
