import { useEffect, useState } from "react";
import {
  sendProposalEmail,
  verifySingleEmailApi,
  EmailVerificationResult,
  getResumesList,
  matchResumeForJob,
  type ResumeItem,
} from "./api";
import { LinkedinIcon, WhatsAppIcon, normalizeWhatsAppNumber } from "./FeedCard";

export function sanitizeProposalText(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/(?:\r?\n|^)\s*(?:\*{0,2})(?:RECOMMENDED[_\s-]*RESUME|SELECTED[_\s-]*RESUME|RESUME[_\s-]*RECOMMENDED|RESUME[_\s-]*RECOMMENDATION|RECOMMENDED_PDF|ATTACHED_RESUME|RECOMMENDEDRESUME|SELECTEDRESUME)\s*[:=]?\s*[^\n\r]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectWorkArrangementClient(title?: string, text?: string) {
  const combined = `${title || ""} ${text || ""}`;
  let location = "";
  let usTimezone = "US Central";

  if (/\b(?:dallas|austin|houston|san antonio|fort worth|plano|irving|texas|tx)\b/i.test(combined)) {
    if (/\bdallas\b/i.test(combined)) location = "Dallas, TX";
    else if (/\baustin\b/i.test(combined)) location = "Austin, TX";
    else if (/\bhouston\b/i.test(combined)) location = "Houston, TX";
    else location = "Texas";
    usTimezone = "US Central";
  } else if (/\b(?:chicago|illinois|il|minneapolis|minnesota|mn|st\.?\s*louis|missouri|mo|kansas\s*city|tennessee|nashville|memphis)\b/i.test(combined)) {
    location = /\bchicago\b/i.test(combined) ? "Chicago, IL" : "US Central";
    usTimezone = "US Central";
  } else if (/\b(?:new york|nyc|manhattan|brooklyn|ny|boston|massachusetts|ma|atlanta|georgia|ga|miami|florida|fl|washington\s*d\.?c\.?|philadelphia|pa|charlotte|nc|new jersey|nj)\b/i.test(combined)) {
    if (/\b(?:new york|nyc|manhattan|brooklyn)\b/i.test(combined)) location = "New York, NY";
    else if (/\bboston\b/i.test(combined)) location = "Boston, MA";
    else if (/\batlanta\b/i.test(combined)) location = "Atlanta, GA";
    else location = "US Eastern";
    usTimezone = "US Eastern";
  } else if (/\b(?:san francisco|sf|bay area|san jose|silicon valley|los angeles|la|san diego|california|ca|seattle|washington|wa)\b/i.test(combined)) {
    if (/\b(?:san francisco|sf|bay area|silicon valley)\b/i.test(combined)) location = "San Francisco, CA";
    else if (/\bseattle\b/i.test(combined)) location = "Seattle, WA";
    else location = "California";
    usTimezone = "US Pacific";
  } else if (/\b(?:denver|boulder|colorado|co|phoenix|arizona|az)\b/i.test(combined)) {
    location = /\b(?:denver|boulder)\b/i.test(combined) ? "Denver, CO" : "US Mountain";
    usTimezone = "US Mountain";
  }

  const hasOnsiteKeyword = /\b(?:onsite|on-site|in-office|in office|in-person|in person|relocate|relocation)\b/i.test(combined);
  const hasHybridKeyword = /\bhybrid\b/i.test(combined);
  const hasRemoteKeyword = /\b(?:remote|work from home|wfh|telecommute|distributed)\b/i.test(combined);

  let arrangementLabel: "onsite" | "hybrid" | "remote" = "remote";
  let isOnsiteOrHybrid = false;

  if (hasOnsiteKeyword) {
    arrangementLabel = "onsite";
    isOnsiteOrHybrid = true;
  } else if (hasHybridKeyword) {
    arrangementLabel = "hybrid";
    isOnsiteOrHybrid = true;
  } else if (location && !hasRemoteKeyword) {
    arrangementLabel = "onsite";
    isOnsiteOrHybrid = true;
  }

  return { isOnsiteOrHybrid, arrangementLabel, location, usTimezone };
}

export function buildDefaultProposalTemplate(
  jobTitle?: string,
  authorName?: string,
  jobUrl?: string,
  jobText?: string,
): string {
  const greeting = authorName ? `Hi ${authorName} and team,` : "Hi Hiring Team,";
  const titleLower = (jobTitle || "").toLowerCase();
  const isMobile =
    titleLower.includes("mobile") ||
    titleLower.includes("android") ||
    titleLower.includes("ios") ||
    titleLower.includes("kotlin") ||
    titleLower.includes("swift") ||
    titleLower.includes("flutter") ||
    titleLower.includes("react native");

  const title = jobTitle || (isMobile ? "Senior Mobile Developer" : "Senior AI/ML Engineer");
  const postingSection = jobUrl ? `\nYour posting:\n${jobUrl}\n` : "";
  const arrangement = detectWorkArrangementClient(jobTitle, jobText);

  if (isMobile) {
    const techStack = "Kotlin, Swift & Flutter";
    const subjectLine = arrangement.isOnsiteOrHybrid
      ? `Subject: ${title} — Remote Availability | ${techStack} (6+ Years)`
      : `Subject: ${title} Application — ${techStack} (6+ Years)`;

    const openingBlock = arrangement.isOnsiteOrHybrid
      ? `I came across your posting for the ${title} role${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel}, but I wanted to ask if you would consider a remote arrangement for the right candidate.

I'm currently based outside the US and can provide full ${arrangement.usTimezone} timezone overlap, work on a long-term contract basis, and start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role.

My experience closely matches the role across native Android (Kotlin), native iOS (Swift), Flutter cross-platform architecture, and supporting backend services.`
      : `Are you still looking for a ${title}? I'm available to start immediately on a contract basis, and I can work remotely with roughly 15 hours per week of committed availability and full ${arrangement.usTimezone} timezone overlap.
${postingSection}
I have 6+ years of experience building production software across native Android (Kotlin), native iOS (Swift), Flutter cross-platform apps, and supporting backend services. What stood out to me about this role is that it focuses on challenging mobile engineering tasks with reproducible environments, deterministic verifiers, and reference solutions — which closely matches my work.`;

    return `${subjectLine}

${greeting}

${openingBlock}
${arrangement.isOnsiteOrHybrid ? postingSection : ""}
Here's how my experience maps to the role:
- Kotlin and Android development — Microphone Amplifier (https://play.google.com/store/apps/details?id=com.app.quickaidev.microphoneamplifier) and TrendSnap (https://play.google.com/store/apps/details?id=com.app.trendsnapapp) (Android, Kotlin): built real-time audio amplification and noise-reduction pipelines, low-latency mic monitoring with foreground services, lifecycle-aware components, background/foreground state handling, and performance optimization. Details: https://umerwaqas.pages.dev?resume=3
- Swift and iOS development — OnePDF (https://umerwaqas.pages.dev?resume=3): shipped a native iOS utility to the App Store covering PDF scanning, conversion, merge/split, compression and signing, including camera/OCR media pipelines, file-system lifecycle handling, secure local document processing, and App Store release management.
- Flutter cross-platform architecture — AI Influencer Generator: built one Dart codebase delivered to both the iOS App Store and Google Play, with state management across async AI generation jobs, subscription and usage tracking, media generation/upload pipelines, and consistent behavior across platform differences.
- Reproducible environments and deterministic verification — lead delivery across a 20+ person engineering team using Docker, CI/CD pipelines and automated test suites; I write reference implementations and regression tests that verify async, lifecycle and state-management behavior deterministically rather than relying on manual QA.
- Mobile engineering quality at scale — at Askly (https://askly.sairahul.dev) and NicheTrafficKit (https://nichetraffickit.com) I reduced API response times by around 40% and delivery time by roughly 60% using AI-assisted workflows with Claude Code and Cursor, with strong hands-on debugging, refactoring and performance optimization on complex production applications.

I'm Upwork Top Rated with 100% Job Success across 48+ projects.

Portfolio: https://umerwaqas.pages.dev?resume=3
GitHub: https://github.com/umerwaqas92
LinkedIn: https://www.linkedin.com/in/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

I'd be happy to walk through the mobile architecture, state management and async patterns, or relevant production Kotlin, Swift and Flutter code in an interview.

Best regards,
Umer Waqas
um.waqas.khan@gmail.com
WhatsApp: +92 345 9347900`;
  }

  // AI / Full-Stack / Backend
  const techStack = "Python, RAG/AI Agents & Cloud";
  const subjectLine = arrangement.isOnsiteOrHybrid
    ? `Subject: ${title} — Remote Availability | ${techStack} (6+ Years)`
    : `Subject: ${title} Application — ${techStack} (6+ Years)`;

  const openingBlock = arrangement.isOnsiteOrHybrid
    ? `I came across your posting for the ${title} role${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel}, but I wanted to ask if you would consider a remote arrangement for the right candidate.

I'm currently based outside the US and can provide full ${arrangement.usTimezone} timezone overlap, work on a long-term contract basis, and start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role.

My experience closely matches the role across Python, AI Agents, Agentic Workflows, RAG, tool calling, ETL/data pipelines, and cloud platforms.`
    : `Are you still looking for a ${title}? I'm available to start immediately on a contract basis and can work remotely with full ${arrangement.usTimezone} timezone overlap and long-term availability.
${postingSection}
I have 6+ years of experience building production software across Python, full-stack systems, APIs, and AI/agentic platforms. What stood out to me about this role is that it focuses on building real production software around AI — which closely matches my recent work.`;

  return `${subjectLine}

${greeting}

${openingBlock}
${arrangement.isOnsiteOrHybrid ? postingSection : ""}
Here's how my experience maps to the role:
- AI Agents & Database Branching — Ardent (https://www.tryardent.com/): Built database branching and sandbox execution for coding agents, allowing autonomous AI agents to test migrations, clean data, and execute SQL on isolated 1:1 Postgres clones in under 6 seconds with copy-on-write storage and zero blast radius to production.
- AI / LLM / Agents — Askly (https://askly.sairahul.dev/): Built an AI database agent with natural-language-to-SQL, schema-aware retrieval, vector search, LLM orchestration and tool-calling agents using OpenAI/Anthropic-style integrations.
- RAG / Vector Databases — ChatBase Clone (https://umerwaqas.pages.dev): Built document/website knowledge retrieval using chunking, embeddings, vector search, configurable prompts and deployable AI chat experiences.
- Full Stack / Backend APIs — WorkForge (https://umerwaqas.pages.dev): Built a full-stack marketplace with Laravel, Livewire, Tailwind, authentication, contracts, payments, wallet/ledger flows, messaging and administrative workflows.
- Python / AI Products — AI Influencer Generator (https://umerwaqas.pages.dev): Built a production AI product using Python, Next.js, Flutter and AI APIs, including content generation workflows, subscriptions and usage tracking.
- Cloud / DevOps / Production: Hands-on with Docker, CI/CD, AWS/GCP/Azure, production debugging, API integrations, testing and deployment. I also lead delivery across a 20+ person engineering team, using AI-assisted development with Claude Code and Cursor to reduce delivery time by approximately 60%.

I'm Upwork Top Rated with 100% Job Success across 48+ projects.

Portfolio: https://umerwaqas.pages.dev?resume=2
GitHub: https://github.com/umerwaqas92
LinkedIn: https://www.linkedin.com/in/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

I'd be happy to walk through the AI/agentic architecture, database branching patterns, or relevant production code in an interview.

Best regards,
Umer Waqas
um.waqas.khan@gmail.com
WhatsApp: +92 345 9347900`;
}

interface ProposalDialogProps {
  open: boolean;
  proposal: string | null;
  summary?: string | null;
  recommendedResumeId?: string;
  loading: boolean;
  error: string | null;
  retryStatus?: string | null;
  jobTitle?: string;
  defaultEmail?: string;
  jobUrl?: string;
  authorUrl?: string;
  authorName?: string;
  recipientPhone?: string;
  jobId?: string;
  jobText?: string;
  isApplied?: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onToggleApplied?: (id: string, title?: string, extras?: any) => void;
  onProposalChange?: (proposal: string, summary?: string) => void;
}

export default function ProposalDialog({
  open,
  proposal,
  summary,
  recommendedResumeId,
  loading,
  error,
  retryStatus,
  jobTitle,
  defaultEmail,
  jobUrl,
  authorUrl,
  authorName,
  recipientPhone,
  jobId,
  jobText,
  isApplied,
  onClose,
  onRetry,
  onToggleApplied,
  onProposalChange,
}: ProposalDialogProps) {
  const [copied, setCopied] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(defaultEmail || "");
  const [subject, setSubject] = useState("");
  const [summaryText, setSummaryText] = useState(sanitizeProposalText(summary));
  const [proposalBody, setProposalBody] = useState(sanitizeProposalText(proposal));
  const [sendingEmail, setSendingEmail] = useState(false);
  const [attachResume, setAttachResume] = useState(true);
  const [resumesList, setResumesList] = useState<ResumeItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>("");
  const [emailStatus, setEmailStatus] = useState<{ ok?: boolean; error?: string; messageId?: string } | null>(null);
  const [verificationResult, setVerificationResult] = useState<EmailVerificationResult | null>(null);
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  // Sync state and automatically trigger verification when dialog opens or props change
  useEffect(() => {
    if (!open) {
      setSendingEmail(false);
      setEmailStatus(null);
      setVerificationResult(null);
      setVerifyingEmail(false);
      setCopied(false);
      return;
    }

    const cleanProp = sanitizeProposalText(proposal);
    const cleanSumm = sanitizeProposalText(summary);

    getResumesList()
      .then((list) => {
        setResumesList(list);
        if (list.length > 0) {
          if (recommendedResumeId && list.some((r) => r.id === recommendedResumeId)) {
            setSelectedResumeId(recommendedResumeId);
          } else {
            const best = matchResumeForJob(list, jobTitle, cleanProp || cleanSumm || "");
            if (best) {
              setSelectedResumeId(best.id);
            } else if (!selectedResumeId || !list.some((r) => r.id === selectedResumeId)) {
              setSelectedResumeId(list[0].id);
            }
          }
        }
      })
      .catch(() => setResumesList([]));

    const emailToSet = (defaultEmail || "").trim();
    setRecipientEmail(emailToSet);
    const subjMatch = cleanProp.match(/^Subject:\s*(.+)$/im);
    if (subjMatch) {
      setSubject(subjMatch[1].trim());
    } else if (jobTitle) {
      const arr = detectWorkArrangementClient(jobTitle, jobText);
      const isMob = (jobTitle || "").toLowerCase().includes("mobile") || (jobTitle || "").toLowerCase().includes("android") || (jobTitle || "").toLowerCase().includes("ios") || (jobTitle || "").toLowerCase().includes("flutter");
      const coreTech = isMob ? "Kotlin, Swift & Flutter" : "Python, RAG/AI Agents & Cloud";
      setSubject(arr.isOnsiteOrHybrid ? `${jobTitle} — Remote Availability | ${coreTech} (6+ Years)` : `${jobTitle} Application — ${coreTech} (6+ Years)`);
    } else {
      setSubject("Job Application / Proposal");
    }
    setSummaryText(cleanSumm);
    setProposalBody(cleanProp);
    setEmailStatus(null);
    setCopied(false);

    // Trigger immediate verification if valid email string is present on 1st run
    if (emailToSet && emailToSet.includes("@") && emailToSet.includes(".")) {
      let active = true;
      setVerifyingEmail(true);
      setVerificationResult(null);
      verifySingleEmailApi(emailToSet)
        .then((res) => {
          if (active) {
            setVerificationResult(res);
          }
        })
        .catch(() => {
          if (active) {
            setVerificationResult({
              email: emailToSet,
              isValid: false,
              isDeliverable: false,
              status: "unknown",
              reason: "Could not verify deliverability",
            });
          }
        })
        .finally(() => {
          if (active) setVerifyingEmail(false);
        });

      return () => {
        active = false;
      };
    } else {
      setVerificationResult(null);
      setVerifyingEmail(false);
    }
  }, [open, defaultEmail, jobTitle, proposal, summary]);

  // Auto-select recommended resume when it changes
  useEffect(() => {
    if (recommendedResumeId && resumesList.some((r) => r.id === recommendedResumeId)) {
      setSelectedResumeId(recommendedResumeId);
    }
  }, [recommendedResumeId, resumesList]);

  // Debounced verification when user edits the email input
  const handleEmailInputChange = (val: string) => {
    setRecipientEmail(val);
    setEmailStatus(null);
    const trimmed = val.trim();
    if (!trimmed || !trimmed.includes("@") || !trimmed.includes(".")) {
      setVerificationResult(null);
      setVerifyingEmail(false);
      return;
    }

    setVerifyingEmail(true);
    setVerificationResult(null);
  };

  useEffect(() => {
    if (!open) return;
    const trimmed = recipientEmail.trim();
    if (!trimmed || !trimmed.includes("@") || !trimmed.includes(".")) {
      return;
    }

    // Don't re-run if already verified for this exact email
    if (verificationResult && verificationResult.email === trimmed) {
      return;
    }

    let isMounted = true;
    setVerifyingEmail(true);

    const timer = setTimeout(async () => {
      try {
        const res = await verifySingleEmailApi(trimmed);
        if (isMounted) {
          setVerificationResult(res);
        }
      } catch {
        if (isMounted) {
          setVerificationResult({
            email: trimmed,
            isValid: false,
            isDeliverable: false,
            status: "unknown",
            reason: "Could not verify deliverability",
          });
        }
      } finally {
        if (isMounted) {
          setVerifyingEmail(false);
        }
      }
    }, 400);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [open, recipientEmail]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function handleCopy() {
    const textToCopy = proposalBody || proposal || "";
    if (!textToCopy) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const ta = document.createElement("textarea");
        ta.value = textToCopy;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { }
  }

  async function handleVerifyEmail() {
    const emailToTest = recipientEmail.trim();
    if (!emailToTest || !emailToTest.includes("@")) return;
    setVerifyingEmail(true);
    try {
      const res = await verifySingleEmailApi(emailToTest);
      setVerificationResult(res);
    } catch {
      setVerificationResult({
        email: emailToTest,
        isValid: false,
        isDeliverable: false,
        status: "unknown",
        reason: "Verification service temporarily unavailable",
      });
    } finally {
      setVerifyingEmail(false);
    }
  }


  const isEmailValid = Boolean(
    verificationResult &&
    (verificationResult.status === "valid" || verificationResult.isValid || verificationResult.isDeliverable)
  );

  const canSendEmail = Boolean(
    !sendingEmail &&
    !verifyingEmail &&
    recipientEmail.trim() &&
    recipientEmail.includes("@") &&
    isEmailValid
  );

  async function handleSendEmail() {
    const textToSend = proposalBody || proposal || "";
    if (!textToSend || !recipientEmail.trim() || !isEmailValid) return;
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      const res = await sendProposalEmail(
        recipientEmail.trim(),
        textToSend,
        jobTitle,
        subject.trim() || undefined,
        summaryText.trim() || undefined,
        attachResume,
        undefined,
        attachResume ? selectedResumeId : undefined,
      );
      setEmailStatus({ ok: true, messageId: res.messageId });
      // Auto-mark as applied if not already marked
      if (jobId && onToggleApplied && !isApplied) {
        onToggleApplied(jobId, jobTitle, { proposal: textToSend });
      }
    } catch (err) {
      setEmailStatus({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to send email",
      });
    } finally {
      setSendingEmail(false);
    }
  }

  const normalizedPhone = recipientPhone ? normalizeWhatsAppNumber(recipientPhone, jobTitle) : "";
  const currentProposalText = proposalBody || proposal || "";
  const whatsappMessage = [
    currentProposalText,
    jobTitle ? `Regarding: ${jobTitle}` : "",
    jobUrl ? `Post: ${jobUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const whatsappUrl = normalizedPhone
    ? `https://wa.me/${normalizedPhone}${whatsappMessage ? `?text=${encodeURIComponent(whatsappMessage)}` : ""}`
    : `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel proposal-modal-panel" role="dialog" aria-modal="true" aria-label="Job Proposal">
        {/* Header */}
        <div className="modal-header proposal-modal-header">
          <div className="proposal-header-top">
            <div className="modal-title-group">
              <span className="modal-icon">✍️</span>
              <div className="modal-title-text-wrap">
                <h2 className="modal-title">AI Job Proposal</h2>
                {jobTitle && (
                  <p className="modal-subtitle proposal-header-job-title" title={jobTitle}>
                    For: <strong>{jobTitle}</strong>
                  </p>
                )}
              </div>
            </div>
            <div className="proposal-header-controls">
              <a
                className="proposal-whatsapp-btn"
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer noopener"
                title={normalizedPhone ? `Send proposal on WhatsApp (+${normalizedPhone})` : "Share proposal on WhatsApp"}
                aria-label="Send proposal on WhatsApp"
              >
                <WhatsAppIcon size={16} />
              </a>
              <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
            </div>
          </div>

          {(authorUrl || jobUrl) && (
            <div className="proposal-header-links-row">
              {authorUrl && (
                <a
                  className="proposal-profile-btn"
                  href={authorUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={authorName ? `View ${authorName}'s profile in a new tab` : "Open author profile in a new tab"}
                >
                  <span>👤 Profile ↗</span>
                </a>
              )}
              {jobUrl && (
                <a
                  className="proposal-open-post-btn"
                  href={jobUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Open the original post in a new tab"
                >
                  <LinkedinIcon size={14} />
                  <span>Open Post ↗</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="modal-body">
          {loading && (
            <div className="proposal-loading">
              <div className="proposal-spinner-wrap">
                <span className="proposal-spinner" />
              </div>
              <p className="proposal-loading-text">AI is writing your proposal…</p>
              <p className="proposal-loading-sub">
                {retryStatus ? `⚠️ ${retryStatus}` : "Powered by OpenRouter · Usually takes 3–10s"}
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="modal-error-banner">
              <div>⚠️ {error}</div>
              <p className="error-hint">Make sure your profile is saved and try again.</p>
              {onRetry && (
                <button type="button" className="modal-error-retry-btn" onClick={onRetry}>
                  🔄 Try Again
                </button>
              )}
            </div>
          )}

          {!loading && proposal && (
            <>
              {/* LinkedIn Note Field */}
              <div className="proposal-summary-section">
                <label className="proposal-summary-label">
                  <span>💼</span>
                  <span>LinkedIn Application Note (250 chars max)</span>
                  <span className="proposal-summary-count">{summaryText.length}/250</span>
                </label>
                <textarea
                  value={summaryText}
                  onChange={(e) => {
                    if (e.target.value.length <= 250) {
                      setSummaryText(e.target.value);
                    }
                  }}
                  className="proposal-summary-input"
                  placeholder="Are you still looking for the [Job Title]? I'm available for it. Portfolio: https://..."
                  maxLength={250}
                  rows={3}
                />
              </div>

              {/* Proposal Text (Editable) */}
              <div className="proposal-body-section">
                <div className="proposal-body-header">
                  <label className="proposal-body-label">
                    <span>📄</span>
                    <span>Full Proposal (Editable)</span>
                  </label>
                  <div className="proposal-body-header-actions">
                    <span className="proposal-editable-badge">
                      ✏️ Click & edit anytime — auto-saved
                    </span>
                  </div>
                </div>
                <textarea
                  className="proposal-textarea-editable"
                  value={proposalBody}
                  onChange={(e) => {
                    const val = e.target.value;
                    setProposalBody(val);
                    onProposalChange?.(val, summaryText);
                  }}
                  placeholder="Your proposal text..."
                  rows={12}
                />
              </div>

              {/* Email Sending Card */}
              <div className="proposal-email-section">
                <div className="proposal-email-header">
                  <div className="proposal-email-title">
                    <span>✉️</span>
                    <span>Send Proposal via Email</span>
                  </div>
                  {defaultEmail && (
                    <span className="proposal-email-badge">
                      Auto-detected email
                    </span>
                  )}
                </div>

                <div className="proposal-email-row">
                  <div className="proposal-email-input-wrapper">
                    <input
                      type="email"
                      placeholder="Recipient email (e.g. client@company.com)"
                      value={recipientEmail}
                      onChange={(e) => handleEmailInputChange(e.target.value)}
                      className={`proposal-email-input ${
                        verificationResult
                          ? verificationResult.status === "valid"
                            ? "is-valid"
                            : verificationResult.status === "invalid"
                            ? "is-invalid"
                            : "is-risky"
                          : ""
                      }`}
                    />
                    {verifyingEmail && (
                      <span className="proposal-auto-verify-pill is-checking">
                        <span className="pill-spinner" />
                        Verifying…
                      </span>
                    )}
                    {!verifyingEmail && verificationResult && (
                      <span
                        className={`proposal-auto-verify-pill is-${verificationResult.status}`}
                        title={verificationResult.reason ? `${verificationResult.reason} (Click to re-verify)` : "Click to re-verify"}
                        onClick={handleVerifyEmail}
                      >
                        {verificationResult.status === "valid"
                          ? "🟢 Deliverable"
                          : verificationResult.status === "invalid"
                          ? "🔴 Invalid MX"
                          : "🟡 Risky"}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canSendEmail}
                    onClick={handleSendEmail}
                    className={`proposal-email-send-btn ${emailStatus?.ok ? "is-sent" : ""}`}
                    title={
                      sendingEmail
                        ? "Sending proposal email…"
                        : verifyingEmail
                        ? "Verifying email deliverability…"
                        : !recipientEmail.trim()
                        ? "Please enter a recipient email address"
                        : !isEmailValid
                        ? "Email must be verified as deliverable before sending"
                        : "Send proposal email"
                    }
                  >
                    {sendingEmail ? (
                      "Sending..."
                    ) : verifyingEmail ? (
                      "Verifying…"
                    ) : emailStatus?.ok ? (
                      "✓ Sent & Applied!"
                    ) : (
                      "📤 Send Email"
                    )}
                  </button>
                </div>

                {/* Email Verification Feedback Banner (Automatic) */}
                {verifyingEmail && !verificationResult && (
                  <div className="proposal-verification-badge-bar status-checking">
                    <span className="verification-badge-icon">⏳</span>
                    <span className="verification-badge-text">
                      Auto-verifying deliverability and DNS MX records…
                    </span>
                  </div>
                )}
                {verificationResult && (
                  <div
                    className={`proposal-verification-badge-bar status-${verificationResult.status}`}
                  >
                    <span className="verification-badge-icon">
                      {verificationResult.status === "valid"
                        ? "🟢"
                        : verificationResult.status === "invalid"
                        ? "🔴"
                        : "🟡"}
                    </span>
                    <span className="verification-badge-text">
                      <strong>
                        {verificationResult.status === "valid"
                          ? "Deliverable & Valid MX Domain"
                          : verificationResult.status === "invalid"
                          ? "Undeliverable / Invalid Domain"
                          : "Risky / Disposable Email"}
                      </strong>
                      {verificationResult.reason ? ` — ${verificationResult.reason}` : ""}
                    </span>
                  </div>
                )}


                {/* Attachment Option */}
                <div className="proposal-attachment-row">
                  <label className="proposal-attachment-toggle-label">
                    <input
                      type="checkbox"
                      checked={attachResume}
                      onChange={(e) => setAttachResume(e.target.checked)}
                      className="proposal-attachment-checkbox"
                    />
                    <span className="attachment-icon">📎</span>
                    <span className="attachment-text">
                      Attach Resume PDF:
                    </span>
                  </label>

                  {attachResume && resumesList.length > 1 && (
                    <select
                      className="proposal-resume-select"
                      value={selectedResumeId}
                      onChange={(e) => setSelectedResumeId(e.target.value)}
                    >
                      {resumesList.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id === recommendedResumeId ? `✨ ${r.filename} (AI Picked · ${Math.round(r.size / 1024)} KB)` : `${r.filename} (${Math.round(r.size / 1024)} KB)`}
                        </option>
                      ))}
                    </select>
                  )}

                  {attachResume && resumesList.length === 1 && (
                    <span className="attachment-resume-filename">
                      <strong>{resumesList[0].filename}</strong>
                      {recommendedResumeId === resumesList[0].id && (
                        <span className="ai-picked-pill"> ✨ AI Picked</span>
                      )}
                    </span>
                  )}

                  {attachResume && resumesList.length === 0 && (
                    <span className="attachment-resume-filename">
                      <strong>Default Resume PDF</strong>
                    </span>
                  )}

                  {attachResume && (
                    <span className="attachment-active-badge">✓ PDF Included</span>
                  )}
                </div>

                {emailStatus?.ok && (
                  <div className="proposal-email-success">
                    ✓ Proposal email sent successfully to <strong>{recipientEmail}</strong> (marked as applied)!
                  </div>
                )}
                {emailStatus?.error && (
                  <div className="proposal-email-error">
                    ⚠️ Failed to send: {emailStatus.error}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (proposal || error) && (
          <div className="modal-footer">
            <button type="button" className="modal-btn-cancel" onClick={onClose}>
              Close
            </button>
            {jobId && onToggleApplied && (
              <button
                type="button"
                className={`modal-btn-retry ${isApplied ? "btn-is-applied" : ""}`}
                onClick={() => onToggleApplied(jobId, jobTitle, { proposal: proposalBody || proposal || "" })}
              >
                {isApplied ? "✓ Marked as Applied" : "Mark as Applied"}
              </button>
            )}
            {onRetry && proposal && (
              <button type="button" className="modal-btn-retry" onClick={onRetry}>
                🔄 Regenerate
              </button>
            )}
            {proposal && (
              <button
                type="button"
                className={`modal-btn-save ${copied ? "btn-saved" : "btn-copy-proposal"}`}
                onClick={handleCopy}
              >
                {copied ? "✓ Copied!" : "📋 Copy Proposal"}
              </button>
            )}
          </div>
        )}

        {!loading && !proposal && !error && (
          <div className="modal-footer">
            <button type="button" className="modal-btn-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

