import { useState, useEffect, useRef, useCallback } from "react";
import { askVoiceCopilot, getProfile } from "./api";

interface VoiceCopilotViewProps {
  onOpenProfile?: () => void;
  onSwitchTab?: (tab: "posts" | "applied" | "chat" | "copilot" | "profile") => void;
}

interface MemoryItem {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

const MEMORY_STORAGE_KEY = "multifeed_voice_copilot_memory_v1";
const SETUP_STORAGE_KEY = "multifeed_voice_copilot_setup_v1";

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

  // Current question & answer
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [activeAnswer, setActiveAnswer] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Teleprompter presentation settings
  const [fontSize, setFontSize] = useState<"normal" | "large" | "huge">("large");
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const [showMemoryDrawer, setShowMemoryDrawer] = useState(false);

  // Session duration timer
  const [sessionSeconds, setSessionSeconds] = useState(0);

  // ── Simple Memory ──────────────────────────────────────────────────────────
  const [memory, setMemory] = useState<MemoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(MEMORY_STORAGE_KEY);
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

  // Persist setup
  useEffect(() => {
    try {
      localStorage.setItem(
        SETUP_STORAGE_KEY,
        JSON.stringify({ jobTitle, company, focusTopics }),
      );
    } catch {}
  }, [jobTitle, company, focusTopics]);

  // Persist memory
  useEffect(() => {
    try {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memory));
    } catch {}
  }, [memory]);

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

  // ── Core Function: Ask Copilot (DeepSeek AI) ────────────────────────────────
  const handleAskCopilot = useCallback(
    async (questionToAsk: string) => {
      const q = questionToAsk.trim();
      if (!q || isGenerating) return;

      setIsGenerating(true);
      setGenerateError(null);
      setCopiedAnswer(false);

      try {
        const memPayload = memory.map((m) => ({
          question: m.question,
          answer: m.answer,
        }));

        const res = await askVoiceCopilot({
          question: q,
          jobTitle,
          company,
          focusTopics,
          profileContent: useProfile ? profileText : "",
          conciseMode: true,
          memory: memPayload,
        });

        const ans = res.answer || "• No response received.";
        setActiveAnswer(ans);

        // Record into Simple Memory
        const newItem: MemoryItem = {
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          question: q,
          answer: ans,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMemory((prev) => [newItem, ...prev.slice(0, 19)]); // Keep last 20
      } catch (err: any) {
        console.error("Voice copilot ask error:", err);
        setGenerateError(err?.message || "Failed to generate answer. Please try again.");
      } finally {
        setIsGenerating(false);
      }
    },
    [jobTitle, company, focusTopics, useProfile, profileText, memory, isGenerating],
  );

  // ── Speech Recognition Setup ───────────────────────────────────────────────
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
          setInterimTranscript("");
          setCurrentQuestion((prev) => {
            const updated = prev ? `${prev} ${finalChunk.trim()}` : finalChunk.trim();
            // Silence timer: when speaker pauses for 1.2 seconds, auto-submit!
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              if (updated.trim().length >= 5) {
                handleAskCopilot(updated);
              }
            }, 1200);
            return updated;
          });
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

  // Export memory session
  const handleExportSession = () => {
    if (memory.length === 0) return;
    const lines = memory.map(
      (m, i) => `### Q${memory.length - i}: ${m.question}\n*${m.timestamp}*\n\n${m.answer}\n\n---\n`,
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
    a.download = `interview-copilot-${Date.now()}.md`;
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
        /* VIEW 2: CLEAN, STREAMLINED LIVE SILENT TELEPROMPTER SCREEN           */
        /* ──────────────────────────────────────────────────────────────────── */
        <div className="voice-live-container">
          {/* Sleek 1-Row Compact Mobile-Friendly Header */}
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

            {/* Utilities: Font Size, Memory, Close */}
            <div className="compact-tools">
              <button
                type="button"
                className="tool-btn font-cycle"
                onClick={() =>
                  setFontSize((f) => (f === "normal" ? "large" : f === "large" ? "huge" : "normal"))
                }
                title={`Font Size: ${fontSize.toUpperCase()} (Tap to change)`}
              >
                {fontSize === "normal" ? "A" : fontSize === "large" ? "A+" : "A++"}
              </button>

              <button
                type="button"
                className={`tool-btn memory-btn ${showMemoryDrawer ? "is-active" : ""}`}
                onClick={() => setShowMemoryDrawer(!showMemoryDrawer)}
                title="View Session Memory"
              >
                🧠 <span className="memory-badge-count">{memory.length}</span>
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

          {/* Speech error banner (only if permission error or serious issue) */}
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

          {/* Clean Spoken Question Banner (NO TEXTAREA) */}
          <div className="voice-question-banner">
            <div className="q-banner-left">
              <span className="q-soundwave-icon">{isListening ? "〰️" : "💬"}</span>
              <div className="q-text-container">
                {interimTranscript ? (
                  <span className="q-hearing">Hearing: "{interimTranscript}"</span>
                ) : currentQuestion ? (
                  <span className="q-final">"{currentQuestion}"</span>
                ) : isListening ? (
                  <span className="q-waiting">Listening for interviewer questions...</span>
                ) : (
                  <span className="q-waiting paused">Microphone is paused. Tap "Paused" above to listen.</span>
                )}
              </div>
            </div>
            {currentQuestion && (
              <button
                type="button"
                className="q-reask-pill"
                disabled={isGenerating}
                onClick={() => handleAskCopilot(currentQuestion)}
                title="Re-query AI for this question"
              >
                {isGenerating ? "⏳" : "🔄 Refresh"}
              </button>
            )}
          </div>

          {/* Main Teleprompter Workspace */}
          <div className="voice-workspace-grid">
            <div className="voice-teleprompter-card">
              {/* Teleprompter Top Actions */}
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
                    <button
                      type="button"
                      className="clean-action-btn"
                      disabled={isGenerating}
                      onClick={() => handleAskCopilot(currentQuestion)}
                    >
                      🔄 Retry
                    </button>
                  </div>
                )}
              </div>

              {/* Teleprompter Body: Ultra-Short 2–3 Lines Only */}
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
                    <button
                      type="button"
                      className="btn-retry"
                      onClick={() => handleAskCopilot(currentQuestion)}
                    >
                      Try Again
                    </button>
                  </div>
                ) : activeAnswer ? (
                  <div className="teleprompter-bullet-list">
                    {activeAnswer.split("\n").map((line, idx) => {
                      const trimmed = line.trim();
                      if (!trimmed) return null;
                      return (
                        <div key={idx} className="teleprompter-bullet-item">
                          <span className="bullet-indicator">•</span>
                          <p className="bullet-text">
                            {trimmed.replace(/^[•\-*]\s*/, "")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="teleprompter-empty-clean">
                    <div className="clean-mic-graphic">🎙️</div>
                    <h3>Listening via Microphone</h3>
                    <p>
                      Speak or let the interviewer speak. As soon as a question is asked, your 2–3 line cheat-sheet answer will appear right here instantly.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Simple Memory Sidebar Drawer */}
            {showMemoryDrawer && (
              <aside className="voice-memory-sidebar">
                <div className="memory-sidebar-header">
                  <div className="memory-title-group">
                    <span>🧠 Simple Memory</span>
                    <span className="memory-count-pill">{memory.length}</span>
                  </div>
                  <div className="memory-header-actions">
                    {memory.length > 0 && (
                      <>
                        <button
                          type="button"
                          className="memory-action-link"
                          onClick={handleExportSession}
                          title="Export all Q&As as Markdown"
                        >
                          Export
                        </button>
                        <button
                          type="button"
                          className="memory-action-link clear"
                          onClick={() => setMemory([])}
                          title="Clear session history"
                        >
                          Clear
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="memory-close-btn"
                      onClick={() => setShowMemoryDrawer(false)}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="memory-items-list">
                  {memory.length === 0 ? (
                    <div className="memory-empty-state">
                      <p>No questions asked yet in this session.</p>
                    </div>
                  ) : (
                    memory.map((item, index) => (
                      <div key={item.id} className="memory-item-card">
                        <div className="memory-item-top">
                          <span className="memory-q-number">Q{memory.length - index}</span>
                          <span className="memory-q-time">{item.timestamp}</span>
                        </div>
                        <div className="memory-item-question">"{item.question}"</div>
                        <div className="memory-item-answer">
                          {item.answer.slice(0, 140)}
                          {item.answer.length > 140 ? "..." : ""}
                        </div>
                        <div className="memory-item-footer">
                          <button
                            type="button"
                            className="memory-reask-btn"
                            onClick={() => {
                              setCurrentQuestion(item.question);
                              handleAskCopilot(item.question);
                            }}
                          >
                            Re-Ask
                          </button>
                          <button
                            type="button"
                            className="memory-copy-btn"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                `Q: ${item.question}\nA: ${item.answer}`,
                              );
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </aside>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
