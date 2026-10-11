import { useState, useEffect, useRef, useCallback } from "react";
import { askVoiceCopilot, getProfile } from "./api";

interface VoiceCopilotViewProps {
  onOpenProfile?: () => void;
  onSwitchTab?: (tab: "posts" | "applied" | "chat" | "copilot" | "profile") => void;
}

export interface ChatHistoryItem {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

const HISTORY_STORAGE_KEY = "multifeed_voice_copilot_history_v2";
const SETUP_STORAGE_KEY = "multifeed_voice_copilot_setup_v2";

const QUICK_TOPIC_PRESETS = [
  ".NET / C#",
  "HTTP & REST APIs",
  "React & Next.js",
  "Flutter & Mobile",
  "Python & AI",
  "System Design",
  "SQL & Databases",
  "Microservices",
  "AWS & Cloud",
];

/**
 * Safely parse markdown bold (**text**) into <strong>text</strong> tags
 * so raw asterisks are never displayed to the user.
 */
function renderFormattedLine(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function VoiceCopilotView({ onOpenProfile }: VoiceCopilotViewProps) {
  // ── Setup State ────────────────────────────────────────────────────────────
  const [isLiveSession, setIsLiveSession] = useState(false);
  const [jobTitle, setJobTitle] = useState(() => {
    try {
      const s = localStorage.getItem(SETUP_STORAGE_KEY);
      if (s) return JSON.parse(s).jobTitle || "";
    } catch {}
    return "Full-Stack Software Engineer";
  });
  const [company, setCompany] = useState(() => {
    try {
      const s = localStorage.getItem(SETUP_STORAGE_KEY);
      if (s) return JSON.parse(s).company || "";
    } catch {}
    return "Enterprise Client";
  });
  const [focusTopics, setFocusTopics] = useState(() => {
    try {
      const s = localStorage.getItem(SETUP_STORAGE_KEY);
      if (s) return JSON.parse(s).focusTopics || "";
    } catch {}
    return ".NET Core, REST APIs, System Design, SQL";
  });
  const [useProfile, setUseProfile] = useState(true);

  // Profile data from database
  const [profileText, setProfileText] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  // ── Live Session State ─────────────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechError, setSpeechError] = useState<string | null>(null);

  // Current live speech buffer (cleared per question!)
  const [interimTranscript, setInterimTranscript] = useState("");
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [activeAnswer, setActiveAnswer] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Teleprompter presentation settings
  const [fontSize, setFontSize] = useState<"normal" | "large" | "huge">("large");
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const [showHistoryBox, setShowHistoryBox] = useState(true);

  // Session duration timer
  const [sessionSeconds, setSessionSeconds] = useState(0);

  // ── Chat History (Previous Questions + Answers) ────────────────────────────
  const [history, setHistory] = useState<ChatHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // References
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<any>(null);
  const isListeningIntentRef = useRef<boolean>(false);
  const speechBufferRef = useRef<string>("");
  const historyScrollRef = useRef<HTMLDivElement | null>(null);

  // Persist setup
  useEffect(() => {
    try {
      localStorage.setItem(
        SETUP_STORAGE_KEY,
        JSON.stringify({ jobTitle, company, focusTopics }),
      );
    } catch {}
  }, [jobTitle, company, focusTopics]);

  // Persist history
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {}
  }, [history]);

  // Auto-scroll chat history to bottom when new item added
  useEffect(() => {
    if (historyScrollRef.current) {
      historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight;
    }
  }, [history]);

  // Fetch candidate profile from database
  useEffect(() => {
    let mounted = true;
    setProfileLoading(true);
    getProfile()
      .then((p) => {
        if (mounted && p?.content) {
          setProfileText(p.content.trim());
        }
      })
      .catch((err) => console.warn("Failed to load candidate profile:", err))
      .finally(() => {
        if (mounted) setProfileLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Session timer
  useEffect(() => {
    if (!isLiveSession) {
      setSessionSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setSessionSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isLiveSession]);

  // Format timer MM:SS
  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // ── Core Function: Ask Copilot with History Sent to API ─────────────────────
  const handleAskCopilot = useCallback(
    async (newQuestion: string) => {
      const q = newQuestion.trim();
      if (!q || isGenerating) return;

      setIsGenerating(true);
      setGenerateError(null);
      setCopiedAnswer(false);
      setActiveQuestion(q);

      try {
        // Pass history of asked questions + answers to the API
        const historyPayload = history.map((h) => ({
          question: h.question,
          answer: h.answer,
        }));

        const res = await askVoiceCopilot({
          question: q,
          jobTitle,
          company,
          focusTopics,
          profileContent: useProfile ? profileText : "",
          conciseMode: true,
          history: historyPayload,
        });

        const ans = res.answer || "• No response received.";
        setActiveAnswer(ans);

        // Add to Chat History
        const newItem: ChatHistoryItem = {
          id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          question: q,
          answer: ans,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setHistory((prev) => [...prev.slice(-15), newItem]); // Keep last 15 in history
      } catch (err: any) {
        console.error("Voice copilot ask error:", err);
        setGenerateError(err?.message || "Failed to generate answer. Please try again.");
      } finally {
        setIsGenerating(false);
      }
    },
    [jobTitle, company, focusTopics, useProfile, profileText, history, isGenerating],
  );

  // ── Speech Recognition Setup (Starts Clean for Each Question) ───────────────
  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      setSpeechError("Speech recognition is not supported in this browser.");
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onresult = (event: any) => {
        let finalChunk = "";
        let interimChunk = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalChunk += event.results[i][0].transcript;
          } else {
            interimChunk += event.results[i][0].transcript;
          }
        }

        if (interimChunk) {
          setInterimTranscript(interimChunk);
        }

        if (finalChunk) {
          // Accumulate speech for THIS specific question turn
          speechBufferRef.current = speechBufferRef.current
            ? `${speechBufferRef.current} ${finalChunk.trim()}`
            : finalChunk.trim();

          setInterimTranscript("");

          // Reset silence timer: when speaker stops talking for 1.2s, auto-ask & RESET buffer!
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            const detectedQuestion = speechBufferRef.current.trim();
            // CLEAR THE BUFFER IMMEDIATELY so next question starts completely fresh!
            speechBufferRef.current = "";
            setInterimTranscript("");

            if (detectedQuestion.length >= 4) {
              handleAskCopilot(detectedQuestion);
            }
          }, 1200);
        }
      };

      recognition.onerror = (event: any) => {
        // Ignore aborted / no-speech harmless events
        if (event.error === "aborted" || event.error === "no-speech") {
          return;
        }
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setSpeechError("Microphone access denied. Please allow mic in browser settings.");
          setIsListening(false);
          isListeningIntentRef.current = false;
        } else {
          setSpeechError(`Mic status: ${event.error}`);
        }
      };

      recognition.onend = () => {
        if (isListeningIntentRef.current) {
          try {
            recognition.start();
          } catch {
            setIsListening(false);
          }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
      isListeningIntentRef.current = true;
      recognition.start();
    } catch (e: any) {
      console.error("Failed to start speech recognition:", e);
      setSpeechError(e?.message || "Could not start microphone listener.");
      setIsListening(false);
    }
  }, [handleAskCopilot]);

  const stopListening = useCallback(() => {
    isListeningIntentRef.current = false;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    speechBufferRef.current = "";
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isListeningIntentRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      speechBufferRef.current = "";
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  // Start live session
  const handleStartSession = () => {
    setIsLiveSession(true);
    startListening();
  };

  // End live session
  const handleEndSession = () => {
    stopListening();
    setIsLiveSession(false);
  };

  // Toggle quick topic chip
  const toggleTopicChip = (chip: string) => {
    const list = focusTopics
      .split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);
    if (list.includes(chip)) {
      setFocusTopics(list.filter((t: string) => t !== chip).join(", "));
    } else {
      setFocusTopics([...list, chip].join(", "));
    }
  };

  // Copy answer to clipboard
  const handleCopyAnswer = () => {
    if (!activeAnswer) return;
    navigator.clipboard.writeText(activeAnswer);
    setCopiedAnswer(true);
    setTimeout(() => setCopiedAnswer(false), 1800);
  };

  // Export full history log
  const handleExportHistory = () => {
    if (history.length === 0) return;
    const lines = history.map(
      (h, i) => `### Q${i + 1}: ${h.question}\n*${h.timestamp}*\n\n${h.answer}\n\n---\n`,
    );
    const blob = new Blob(
      [
        `# Interview Session Log - ${jobTitle} (${company})\nDate: ${new Date().toLocaleDateString()}\n\n` +
          lines.join("\n"),
      ],
      { type: "text/markdown" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-history-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="voice-copilot-container">
      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* VIEW 1: SETUP SCREEN                                                  */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {!isLiveSession ? (
        <div className="voice-setup-card">
          <div className="voice-setup-hero">
            <div className="voice-hero-badge">
              <span className="live-pulse-dot" />
              <span>SILENT LIVE COPILOT</span>
            </div>
            <h1 className="voice-hero-title">🎙️ AI Interview Teleprompter</h1>
            <p className="voice-hero-desc">
              Listens continuously through your microphone and displays <strong>ultra-simple, 2–3 line answers</strong> directly on screen.
              100% silent — your call makes zero sound!
            </p>
          </div>

          <div className="voice-setup-form">
            <div className="voice-form-row">
              <div className="voice-form-group">
                <label className="voice-form-label">Target Role / Job Title</label>
                <input
                  type="text"
                  className="voice-input"
                  placeholder="e.g. Senior Full-Stack .NET Engineer"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>

              <div className="voice-form-group">
                <label className="voice-form-label">Target Company / Client</label>
                <input
                  type="text"
                  className="voice-input"
                  placeholder="e.g. Enterprise FinTech"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
            </div>

            <div className="voice-form-group">
              <label className="voice-form-label">Focus Tech Stack & Topics</label>
              <input
                type="text"
                className="voice-input"
                placeholder="e.g. .NET Core, C#, REST APIs, SQL Server"
                value={focusTopics}
                onChange={(e) => setFocusTopics(e.target.value)}
              />
              <div className="voice-quick-chips">
                <span className="chips-label">Quick Add:</span>
                {QUICK_TOPIC_PRESETS.map((chip) => {
                  const active = focusTopics.toLowerCase().includes(chip.toLowerCase());
                  return (
                    <button
                      key={chip}
                      type="button"
                      className={`topic-chip ${active ? "chip-active" : ""}`}
                      onClick={() => toggleTopicChip(chip)}
                    >
                      {active ? "✓ " : "+ "}
                      {chip}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Profile integration info box */}
            <div className="voice-profile-box">
              <div className="voice-profile-info">
                <div className="voice-profile-icon">👤</div>
                <div className="voice-profile-details">
                  <div className="voice-profile-heading">
                    <span>Candidate Profile & Resume</span>
                    {profileText ? (
                      <span className="profile-status-tag ready">✓ Loaded ({profileText.length} chars)</span>
                    ) : profileLoading ? (
                      <span className="profile-status-tag loading">Loading...</span>
                    ) : (
                      <span className="profile-status-tag empty">No Profile Saved</span>
                    )}
                  </div>
                  <p className="voice-profile-sub">
                    Answers are tailored to your actual skills and projects.
                  </p>
                </div>
              </div>
              <div className="voice-profile-actions">
                <label className="voice-toggle-label">
                  <input
                    type="checkbox"
                    checked={useProfile}
                    onChange={(e) => setUseProfile(e.target.checked)}
                  />
                  <span>Inject Profile</span>
                </label>
                {onOpenProfile && (
                  <button
                    type="button"
                    className="voice-btn-edit-profile"
                    onClick={onOpenProfile}
                  >
                    Edit Profile
                  </button>
                )}
              </div>
            </div>

            {/* Action button */}
            <div className="voice-setup-actions">
              <button
                type="button"
                className="btn-start-copilot"
                onClick={handleStartSession}
              >
                <span className="btn-icon">🎙️</span>
                <span>START LIVE COPILOT</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ──────────────────────────────────────────────────────────────────── */
        /* VIEW 2: STREAMLINED TELEPROMPTER WITH CHAT-STYLE HISTORY             */
        /* ──────────────────────────────────────────────────────────────────── */
        <div className="voice-live-container">
          {/* Top Compact Bar */}
          <div className="voice-live-compact-bar">
            {/* Direct Tap-to-Toggle Mic Pill */}
            <button
              type="button"
              className={`mic-toggle-pill ${isListening ? "is-live" : "is-paused"}`}
              onClick={isListening ? stopListening : startListening}
              title={isListening ? "Tap to Pause Mic" : "Tap to Listen"}
            >
              <span className="mic-dot" />
              <span className="mic-pill-icon">{isListening ? "🎙️" : "🔇"}</span>
              <span className="mic-pill-label">
                {isListening ? "Listening" : "Paused"}
              </span>
            </button>

            {/* Timer & Role */}
            <div className="compact-session-meta">
              <span className="compact-timer">⏱️ {formatTimer(sessionSeconds)}</span>
              <span className="compact-role-pill" title={jobTitle}>{jobTitle}</span>
            </div>

            {/* Utility buttons */}
            <div className="compact-tools">
              <button
                type="button"
                className="tool-btn font-cycle"
                onClick={() =>
                  setFontSize((f) => (f === "normal" ? "large" : f === "large" ? "huge" : "normal"))
                }
                title={`Font Size: ${fontSize.toUpperCase()}`}
              >
                {fontSize === "normal" ? "A" : fontSize === "large" ? "A+" : "A++"}
              </button>

              <button
                type="button"
                className={`tool-btn history-toggle-btn ${showHistoryBox ? "is-active" : ""}`}
                onClick={() => setShowHistoryBox(!showHistoryBox)}
                title="Toggle Chat History Box"
              >
                💬 <span className="history-count-badge">{history.length}</span>
              </button>

              <button
                type="button"
                className="tool-btn close-btn"
                onClick={handleEndSession}
                title="End Session"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Speech error banner (permission error only) */}
          {(!speechSupported || speechError) && (
            <div className="voice-banner-alert">
              <span>⚠️ {speechError || "Microphone not supported in this browser."}</span>
              <button
                type="button"
                className="banner-close"
                onClick={() => setSpeechError(null)}
              >
                ✕
              </button>
            </div>
          )}

          {/* Live Hearing Indicator (only appears while speaking) */}
          {interimTranscript && (
            <div className="live-hearing-banner">
              <span className="hearing-pulse-wave">〰️</span>
              <span className="hearing-label">Hearing:</span>
              <span className="hearing-text">"{interimTranscript}"</span>
            </div>
          )}

          {/* ──────────────────────────────────────────────────────────────── */}
          {/* HERO ACTIVE TELEPROMPTER CARD (LATEST ANSWER)                    */}
          {/* ──────────────────────────────────────────────────────────────── */}
          <div className="voice-teleprompter-card">
            <div className="teleprompter-header-clean">
              <div className="teleprompter-badge-group">
                <span className="teleprompter-badge-dot" />
                <span className="teleprompter-badge-text">TELEPROMPTER</span>
                <span className="silent-tag">100% SILENT</span>
              </div>

              {activeAnswer && (
                <div className="teleprompter-quick-actions">
                  <button
                    type="button"
                    className="clean-action-btn"
                    onClick={handleCopyAnswer}
                  >
                    {copiedAnswer ? "✓ Copied" : "📋 Copy"}
                  </button>
                  {activeQuestion && (
                    <button
                      type="button"
                      className="clean-action-btn"
                      disabled={isGenerating}
                      onClick={() => handleAskCopilot(activeQuestion)}
                    >
                      🔄 Retry
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Current Question Badge */}
            {activeQuestion && (
              <div className="active-question-pill">
                <span className="active-q-icon">❓</span>
                <span className="active-q-text">"{activeQuestion}"</span>
              </div>
            )}

            {/* Teleprompter Body */}
            <div className={`teleprompter-body font-${fontSize}`}>
              {isGenerating ? (
                <div className="teleprompter-generating">
                  <div className="teleprompter-pulse-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="generating-text">DeepSeek AI crafting concise 2–3 line answer...</p>
                </div>
              ) : generateError ? (
                <div className="teleprompter-error">
                  <p>⚠️ {generateError}</p>
                  {activeQuestion && (
                    <button
                      type="button"
                      className="btn-retry"
                      onClick={() => handleAskCopilot(activeQuestion)}
                    >
                      Try Again
                    </button>
                  )}
                </div>
              ) : activeAnswer ? (
                <div className="teleprompter-bullet-list">
                  {activeAnswer.split("\n").map((line, idx) => {
                    const trimmed = line.trim();
                    if (!trimmed) return null;
                    const cleanText = trimmed.replace(/^[•\-*]\s*/, "");
                    return (
                      <div key={idx} className="teleprompter-bullet-item">
                        <span className="bullet-indicator">•</span>
                        <p className="bullet-text">
                          {renderFormattedLine(cleanText)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="teleprompter-empty-clean">
                  <div className="clean-mic-graphic">🎙️</div>
                  <h3>Ready & Listening via Microphone</h3>
                  <p>
                    {isListening
                      ? "Speak or let the interviewer speak. Your answer will appear here in clean, spoken lines."
                      : "Microphone is paused. Tap 'Paused' at the top to resume listening."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ──────────────────────────────────────────────────────────────── */}
          {/* CHAT-STYLE HISTORY BOX (SMALL SCROLLABLE CONTAINER)              */}
          {/* ──────────────────────────────────────────────────────────────── */}
          {showHistoryBox && (
            <div className="voice-chat-history-box">
              <div className="chat-history-header">
                <div className="chat-history-title">
                  <span>💬 Q&A History</span>
                  <span className="history-pill-tag">{history.length}</span>
                </div>
                {history.length > 0 && (
                  <div className="chat-history-actions">
                    <button
                      type="button"
                      className="history-action-btn"
                      onClick={handleExportHistory}
                      title="Export all as Markdown"
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="history-action-btn danger"
                      onClick={() => setHistory([])}
                      title="Clear History"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* Scrollable Chat Feed */}
              <div className="chat-history-scroll" ref={historyScrollRef}>
                {history.length === 0 ? (
                  <div className="chat-history-empty">
                    <span>Asked questions and past answers will log here in chat format.</span>
                  </div>
                ) : (
                  history.map((item, index) => (
                    <div key={item.id} className="chat-thread-card">
                      {/* Question bubble */}
                      <div className="chat-bubble user-bubble">
                        <span className="bubble-role">🧑 Q{index + 1}:</span>
                        <span className="bubble-text">{item.question}</span>
                        <span className="bubble-time">{item.timestamp}</span>
                      </div>

                      {/* Answer bubble */}
                      <div className="chat-bubble ai-bubble">
                        <div className="ai-bubble-header">
                          <span className="bubble-role-ai">💡 Answer:</span>
                          <button
                            type="button"
                            className="bubble-copy-btn"
                            onClick={() => {
                              navigator.clipboard.writeText(item.answer);
                            }}
                            title="Copy this answer"
                          >
                            Copy
                          </button>
                        </div>
                        <div className="ai-bubble-bullets">
                          {item.answer.split("\n").map((line, lIdx) => {
                            const trimmed = line.trim();
                            if (!trimmed) return null;
                            const cleanText = trimmed.replace(/^[•\-*]\s*/, "");
                            return (
                              <div key={lIdx} className="ai-bullet-row">
                                <span className="ai-dot">•</span>
                                <span className="ai-text">
                                  {renderFormattedLine(cleanText)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
