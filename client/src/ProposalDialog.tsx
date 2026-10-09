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
import PdfPreviewModal from "./PdfPreviewModal";

export function sanitizeProposalText(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/(?:\r?\n|^)\s*(?:\*{0,2})(?:RECOMMENDED[_\s-]*RESUME|SELECTED[_\s-]*RESUME|RESUME[_\s-]*RECOMMENDED|RESUME[_\s-]*RECOMMENDATION|RECOMMENDED_PDF|ATTACHED_RESUME|RECOMMENDEDRESUME|SELECTEDRESUME)\s*[:=]?\s*[^\n\r]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanJobTitleClient(title?: string, jobText?: string): string {
  let cleaned = (title || "")
    .replace(/\b\d[\d,.]*\s*[KkMm]?\+?\s*(?:followers?|connections?|subscribers?)\b/gi, " ")
    .replace(/(^|[·•|]\s*)\d(?:st|nd|rd|th)\+?(?=\s|$)/gi, "$1")
    .replace(/\s*[·•|]\s*(?=[·•|])/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·•|,\-–]+/, "")
    .replace(/[\s·•|,\-–]+$/, "")
    .replace(/^(?:Position|Role|Job Title|Title|Profile|Hiring|Urgent Hiring|Looking for|Wanted)\s*[:–-]\s*/i, "")
    .replace(/#/g, "")
    .trim();

  const isRecruiter =
    /^(?:hiring|we are hiring|urgent hiring|job opportunity|opening|openings|career|careers|urgent requirement)$/i.test(cleaned) ||
    /\b(?:recruiter|technical recruiter|talent acquisition|sourcer|headhunter|hiring manager|account manager|hr\s*(?:manager|executive|lead)?|human resources|recruitment|staffing|consulting)\b/i.test(cleaned) ||
    /\bat\s+[A-Za-z0-9\s.,&-]+(?:llc|inc|corp|ltd|technologies|solutions|group|services)?$/i.test(cleaned);

  if (isRecruiter) {
    cleaned = "";
  }

  if (jobText) {
    const match = jobText.match(
      /(?:Position|Role|Job Title|Title|Profile|Requirement|Hiring for|Looking for)\s*[:–-]\s*([^\n\r,•|📱🔥]+)/i
    );
    if (match) {
      const extracted = match[1].replace(/#/g, "").replace(/\s{2,}/g, " ").trim();
      if (!cleaned || isRecruiter) {
        cleaned = extracted;
      }
    }
  }

  return cleaned;
}

export function formatTimezoneOverlapClient(tz?: string): string {
  if (!tz || tz === "your team's" || tz === "team") {
    return "full timezone overlap with your team";
  }
  if (tz.toLowerCase().includes("pakistan") || tz.toLowerCase().includes("pkt")) {
    return "full Pakistan (PKT) timezone overlap";
  }
  return `full ${tz} timezone overlap`;
}

export function detectWorkArrangementClient(title?: string, text?: string, forceRemote?: boolean) {
  const combined = `${title || ""} ${text || ""}`;
  let location = "";
  let targetTimezone = "your team's";

  // 1. Check for explicit labeled location e.g. "Location : Bangalore" or "Location : Dallas, TX"
  const explicitLocMatch = combined.match(/(?:Location|Work Location|Place|City|Office)\s*[:–-]\s*([^\n\r•|📱🔥]+)/i);
  if (explicitLocMatch) {
    const rawLoc = explicitLocMatch[1]
      .replace(/#/g, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s*(?:•|\n|\r|\||Job|Type|Salary|\$|Experience|Exp|Skills|Hard skills|Soft skills|Role|Overview|About|Description|Key Responsibilities|Responsibilities).*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (rawLoc && rawLoc.length < 60 && !/^(?:remote|work from home|wfh|anywhere)$/i.test(rawLoc)) {
      location = rawLoc;
    }
  }

  // 2. Region / Country / City detection
  const hasPakistan =
    /\b(?:pakistan|pakistani|rawalpindi|pindi|islamabad|isb|lahore|karachi|peshawar|faisalabad|multan|sialkot|gujranwala|quetta|saidpur|saidpur\s*road|pkt)\b/i.test(location || combined);

  const hasIndia =
    /\b(?:india|indian|bangalore|bengaluru|hyderabad|pune|noida|gurgaon|gurugram|delhi|new delhi|mumbai|chennai|kolkata|ahmedabad|karnataka|telangana|maharashtra|tamil nadu|haryana|ist)\b/i.test(location || combined);

  const hasUK =
    /\b(?:london|uk|united kingdom|england|britain|great britain|scotland|wales|gmt|bst)\b/i.test(location || combined);

  const hasEurope =
    /\b(?:germany|berlin|munich|frankfurt|amsterdam|netherlands|paris|france|dublin|ireland|madrid|spain|italy|europe|european|sweden|stockholm|poland|warsaw|cet|cest)\b/i.test(location || combined);

  const hasAustralia =
    /\b(?:australia|sydney|melbourne|brisbane|perth|new zealand|au|aest)\b/i.test(location || combined);

  const hasGulf =
    /\b(?:dubai|abu dhabi|uae|saudi|riyadh|qatar|doha|gst)\b/i.test(location || combined);

  const hasEastern =
    /\b(?:new york|nyc|manhattan|brooklyn|boston|massachusetts|north\s*reading|atlanta|georgia|miami|orlando|tampa|florida|washington\s*d\.?c\.?|philadelphia|charlotte|raleigh|north carolina|new jersey|virginia|eastern|est|edt)\b/i.test(location || combined) ||
    /(?:,\s*(?:NY|MA|GA|FL|DC|PA|NC|NJ|VA)\b)/i.test(location || combined);

  const hasPacific =
    /\b(?:san francisco|sf|bay area|san jose|silicon valley|sunnyvale|los angeles|san diego|california|seattle|bellevue|washington|portland|oregon|pacific|pst|pdt)\b/i.test(location || combined) ||
    /(?:,\s*(?:CA|WA|OR)\b)/i.test(location || combined);

  const hasCentral =
    /\b(?:dallas|austin|houston|san antonio|fort worth|plano|irving|texas|chicago|illinois|minneapolis|minnesota|st\.?\s*louis|missouri|kansas\s*city|tennessee|nashville|memphis|wisconsin|central|cst|cdt)\b/i.test(location || combined) ||
    /(?:,\s*(?:TX|IL|MN|MO|TN|WI)\b)/i.test(location || combined);

  const hasMountain =
    /\b(?:denver|boulder|colorado|phoenix|scottsdale|arizona|salt lake|utah|mountain|mst|mdt)\b/i.test(location || combined) ||
    /(?:,\s*(?:CO|AZ|UT)\b)/i.test(location || combined);

  const hasGenericUS =
    /\b(?:united states|usa|u\.s\.a?|w2|c2c|1099)\b/i.test(combined);

  if (hasPakistan) {
    if (!location) {
      if (/\b(?:rawalpindi|pindi|saidpur)\b/i.test(combined)) location = "Rawalpindi, Pakistan";
      else if (/\b(?:islamabad|isb)\b/i.test(combined)) location = "Islamabad, Pakistan";
      else if (/\blahore\b/i.test(combined)) location = "Lahore, Pakistan";
      else if (/\bkarachi\b/i.test(combined)) location = "Karachi, Pakistan";
      else if (/\bpeshawar\b/i.test(combined)) location = "Peshawar, Pakistan";
      else location = "Pakistan";
    }
    targetTimezone = "Pakistan (PKT)";
  } else if (hasIndia) {
    if (!location) {
      if (/\b(?:bangalore|bengaluru)\b/i.test(combined)) location = "Bangalore, India";
      else if (/\bhyderabad\b/i.test(combined)) location = "Hyderabad, India";
      else if (/\bpune\b/i.test(combined)) location = "Pune, India";
      else if (/\b(?:noida|gurgaon|gurugram|delhi)\b/i.test(combined)) location = "Delhi NCR, India";
      else if (/\bmumbai\b/i.test(combined)) location = "Mumbai, India";
      else if (/\bchennai\b/i.test(combined)) location = "Chennai, India";
      else location = "India";
    }
    targetTimezone = "India (IST)";
  } else if (hasUK) {
    if (!location) location = "London, UK";
    targetTimezone = "UK (GMT)";
  } else if (hasEurope) {
    if (!location) location = "Europe";
    targetTimezone = "Europe (CET)";
  } else if (hasAustralia) {
    if (!location) location = "Australia";
    targetTimezone = "Australia (AEST)";
  } else if (hasGulf) {
    if (!location) location = "Dubai, UAE";
    targetTimezone = "Gulf (GST)";
  } else if (hasEastern && hasPacific) {
    if (!location) location = "US Eastern / Pacific";
    targetTimezone = "US Eastern / Pacific";
  } else if (hasEastern) {
    if (!location) {
      if (/\b(?:new york|nyc|manhattan|brooklyn)\b/i.test(combined)) location = "New York, NY";
      else if (/\bboston\b/i.test(combined)) location = "Boston, MA";
      else if (/\batlanta\b/i.test(combined)) location = "Atlanta, GA";
      else if (/\bmiami\b/i.test(combined)) location = "Miami, FL";
      else location = "US Eastern";
    }
    targetTimezone = "US Eastern";
  } else if (hasPacific) {
    if (!location) {
      if (/\b(?:san francisco|sf|bay area|silicon valley)\b/i.test(combined)) location = "San Francisco, CA";
      else if (/\bsunnyvale\b/i.test(combined)) location = "Sunnyvale, CA";
      else if (/\bseattle\b/i.test(combined)) location = "Seattle, WA";
      else if (/\b(?:los angeles|la)\b/i.test(combined)) location = "Los Angeles, CA";
      else location = "California";
    }
    targetTimezone = "US Pacific";
  } else if (hasCentral) {
    if (!location) {
      if (/\bdallas\b/i.test(combined)) location = "Dallas, TX";
      else if (/\baustin\b/i.test(combined)) location = "Austin, TX";
      else if (/\bhouston\b/i.test(combined)) location = "Houston, TX";
      else if (/\bchicago\b/i.test(combined)) location = "Chicago, IL";
      else location = "Texas";
    }
    targetTimezone = "US Central";
  } else if (hasMountain) {
    if (!location) {
      if (/\b(?:denver|boulder)\b/i.test(combined)) location = "Denver, CO";
      else if (/\bphoenix\b/i.test(combined)) location = "Phoenix, AZ";
      else location = "US Mountain";
    }
    targetTimezone = "US Mountain";
  } else if (hasGenericUS) {
    if (!location) location = "United States";
    targetTimezone = "US Eastern / Pacific";
  } else {
    targetTimezone = "your team's";
  }

  const usTimezone = targetTimezone;

  const hasOnsiteKeyword = /\b(?:onsite|on-site|in-office|in office|in-person|in person|relocate|relocation)\b/i.test(combined);
  const hasHybridKeyword = /\bhybrid\b/i.test(combined);
  const hasRemoteKeyword = /\b(?:remote|work from home|wfh|telecommute|distributed)\b/i.test(combined);

  let arrangementLabel: "onsite" | "hybrid" | "remote" = "remote";
  let isOnsiteOrHybrid = false;

  if (forceRemote !== undefined) {
    if (forceRemote) {
      arrangementLabel = "remote";
      isOnsiteOrHybrid = false;
    } else {
      arrangementLabel = "onsite";
      isOnsiteOrHybrid = true;
    }
  } else {
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
  }

  return { isOnsiteOrHybrid, arrangementLabel, location, targetTimezone, usTimezone };
}

export function buildDefaultProposalTemplate(
  jobTitle?: string,
  authorName?: string,
  jobUrl?: string,
  jobText?: string,
  isRemote: boolean = true,
): string {
  const greeting = authorName ? `Hi ${authorName} and team,` : "Hi Hiring Team,";
  const cleanedTitle = cleanJobTitleClient(jobTitle, jobText);
  const titleLower = (cleanedTitle || jobTitle || "").toLowerCase();
  const isMobile =
    titleLower.includes("mobile") ||
    titleLower.includes("android") ||
    titleLower.includes("ios") ||
    titleLower.includes("kotlin") ||
    titleLower.includes("swift") ||
    titleLower.includes("flutter") ||
    titleLower.includes("react native");

  const title = cleanedTitle || jobTitle || (isMobile ? "Senior Mobile Developer" : "Senior AI/ML Engineer");
  const postingSection = jobUrl ? `\nYour posting:\n${jobUrl}\n` : "";
  const arrangement = detectWorkArrangementClient(cleanedTitle || jobTitle, jobText, isRemote);

  if (isMobile) {
    const techStack = "Kotlin & Swift";
    const subjectLine = !isRemote
      ? `Subject: ${title} Application | ${techStack} (7+ Years)`
      : arrangement.isOnsiteOrHybrid
      ? `Subject: ${title} | Remote Availability | ${techStack}`
      : `Subject: ${title} Application | ${techStack} (7+ Years)`;

    const openingBlock = !isRemote
      ? `Are you still looking for a ${title}? I came across your posting for the ${title} role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately.

My experience closely matches the position across native Android (Kotlin), native iOS (Swift), Flutter cross-platform architecture, and supporting backend services.`
      : arrangement.isOnsiteOrHybrid
      ? `I came across your posting for the ${title} role${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel}, but I wanted to ask if you would consider a remote arrangement for the right candidate.

I'm available to work remotely on a long-term contract basis with ${formatTimezoneOverlapClient(arrangement.targetTimezone)}, and can start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role.

My experience closely matches the position across native Android (Kotlin), native iOS (Swift), Flutter cross-platform architecture, and supporting backend services.`
      : `Are you still looking for a ${title}? I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlapClient(arrangement.targetTimezone)} and long-term availability.
${postingSection}
I have 7+ years of experience building production software across native Android (Kotlin), native iOS (Swift), Flutter cross-platform apps, and supporting backend services. What stood out to me about this role is that it focuses on challenging mobile engineering tasks with reproducible environments, deterministic verifiers, and reference solutions — which closely matches my work.`;

    return `${subjectLine}

${greeting}

${openingBlock}
${isRemote && arrangement.isOnsiteOrHybrid ? postingSection : ""}
How my experience maps to the role:

✅ Android & Kotlin: Built real-time audio amplification pipelines, foreground services, lifecycle-aware architecture, and background state handling.

✅ iOS & Swift (OnePDF): Shipped native iOS document utility covering scanning, PDF conversion, merge/split, OCR pipelines, and App Store release.

✅ Flutter cross-platform (AI Influencer Generator): Built a unified Dart codebase shipped to iOS and Google Play, handling async AI generation workflows and subscription tracking.

✅ Reliability & delivery: Hands-on with Docker, automated test suites, CI/CD, and reduced delivery time by ~60% using Claude Code and Cursor.

I'm Upwork Top Rated with 100% Job Success across 48+ projects.

Portfolio: https://umerwaqas.pages.dev?resume=3
GitHub: https://github.com/umerwaqas92
LinkedIn: https://www.linkedin.com/in/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

I'd be happy to walk through my mobile architecture, state management patterns, and production Kotlin, Swift, or Flutter code in an interview.

Best regards,
Umer Waqas
um.waqas.khan@gmail.com
WhatsApp: +92 345 9347900`;
  }

  // AI / Full-Stack / Backend
  const techStack = "Python & RAG";
  const subjectLine = !isRemote
    ? `Subject: ${title} Application | ${techStack} (7+ Years)`
    : arrangement.isOnsiteOrHybrid
    ? `Subject: ${title} | Remote Availability | ${techStack}`
    : `Subject: ${title} Application | ${techStack} (7+ Years)`;

  const openingBlock = !isRemote
    ? `Are you still looking for a ${title}? I came across your posting for the ${title} role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately.

My experience closely matches the position across Python, FastAPI/Flask, Agentic AI, multi-agent orchestration, hybrid RAG, embeddings, prompt/context engineering, MCP-style tool calling, and production cloud deployment with CI/CD and automated testing.`
    : arrangement.isOnsiteOrHybrid
    ? `I came across your posting for the ${title} role${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel}, but I wanted to ask if you would consider a remote arrangement for the right candidate.

I'm available to work remotely on a long-term contract basis with ${formatTimezoneOverlapClient(arrangement.targetTimezone)}, and can start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role.

My experience closely matches the position across Python, FastAPI/Flask, Agentic AI, multi-agent orchestration, hybrid RAG, embeddings, prompt/context engineering, MCP-style tool calling, and production cloud deployment with CI/CD and automated testing.`
    : `Are you still looking for a ${title}? I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlapClient(arrangement.targetTimezone)} and long-term availability.
${postingSection}
I have 7+ years of experience building production software across Python, full-stack systems, APIs, and AI/agentic platforms. What stood out to me about this role is that it focuses on building real production software around AI — which closely matches my recent work.`;

  return `${subjectLine}

${greeting}

${openingBlock}
${isRemote && arrangement.isOnsiteOrHybrid ? postingSection : ""}
How my experience maps to the role:

✅ Agentic AI & multi-agent orchestration — Ardent: Built database-branching sandbox infrastructure that lets autonomous coding agents run migrations, data operations, and tests against isolated production copies in under 6 seconds.

✅ Hybrid RAG, embeddings & vector search — Askly: Built a natural-language database agent that uses schema-aware retrieval and tool calling to return metrics, charts, and scheduled reports from business data.

✅ Context engineering & RAG — NicheTrafficKit & Diffsight: Built AI features using chunking, embeddings, vector search, configurable prompts, and latency/cost optimization.

✅ Cloud, CI/CD & delivery: Hands-on with Docker, automated testing, CI/CD, and cloud deployment; improved API response times by ~40% and reduced delivery time by ~60% using Claude Code and Cursor.

I'm Upwork Top Rated with 100% Job Success across 48+ projects.

Portfolio: https://umerwaqas.pages.dev?resume=2
GitHub: https://github.com/umerwaqas92
LinkedIn: https://www.linkedin.com/in/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

I'd be happy to walk through my agentic architecture, RAG pipelines, tool-calling patterns, and database branching infrastructure in an interview.

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
  onRetry?: (isRemote?: boolean) => void;
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
  const [isRemote, setIsRemote] = useState(true);
  const [recipientEmail, setRecipientEmail] = useState(defaultEmail || "");
  const [subject, setSubject] = useState("");
  const [summaryText, setSummaryText] = useState(sanitizeProposalText(summary));
  const [proposalBody, setProposalBody] = useState(sanitizeProposalText(proposal));
  const [sendingEmail, setSendingEmail] = useState(false);
  const [attachResume, setAttachResume] = useState(true);
  const [resumesList, setResumesList] = useState<ResumeItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>("");
  const [previewResumeModalOpen, setPreviewResumeModalOpen] = useState(false);
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
      setIsRemote(true);
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
      const arr = detectWorkArrangementClient(jobTitle, jobText, isRemote);
      const isMob = (jobTitle || "").toLowerCase().includes("mobile") || (jobTitle || "").toLowerCase().includes("android") || (jobTitle || "").toLowerCase().includes("ios") || (jobTitle || "").toLowerCase().includes("flutter");
      const coreTech = isMob ? "Kotlin & Swift" : "Python & RAG";
      setSubject(!isRemote ? `${jobTitle} Application | ${coreTech} (7+ Years)` : arr.isOnsiteOrHybrid ? `${jobTitle} | Remote Availability | ${coreTech}` : `${jobTitle} Application | ${coreTech} (7+ Years)`);
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
                <button type="button" className="modal-error-retry-btn" onClick={() => onRetry(isRemote)}>
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
                    <label
                      className={`proposal-remote-toggle-label ${!isRemote ? "is-onsite" : ""}`}
                      title={isRemote ? "Currently set to Remote Application. Click to switch to Onsite Application." : "Currently set to Onsite Application. Click to switch to Remote Application."}
                    >
                      <input
                        type="checkbox"
                        checked={isRemote}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setIsRemote(val);
                          onRetry?.(val);
                        }}
                        className="proposal-remote-checkbox"
                      />
                      <span className="proposal-remote-icon">{isRemote ? "🌐" : "🏢"}</span>
                      <span className="proposal-remote-text">{isRemote ? "Remote Application" : "Onsite Application"}</span>
                    </label>
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
                    <button
                      type="button"
                      className="btn-preview-attachment"
                      onClick={() => setPreviewResumeModalOpen(true)}
                      title="Preview attached PDF resume"
                    >
                      <span>👁️ Preview</span>
                    </button>
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
              <button type="button" className="modal-btn-retry" onClick={() => onRetry(isRemote)}>
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

      {/* PDF Preview Modal */}
      <PdfPreviewModal
        open={previewResumeModalOpen}
        onClose={() => setPreviewResumeModalOpen(false)}
        resumeId={selectedResumeId || undefined}
        resumesList={resumesList}
        selectedResumeId={selectedResumeId}
        onSelect={(id) => setSelectedResumeId(id)}
      />
    </div>
  );
}

