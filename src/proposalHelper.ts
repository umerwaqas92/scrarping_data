const getEndpoint = () =>
  process.env.OPENROUTER_ENDPOINT ||
  process.env.DEEPSEEK_ENDPOINT ||
  "https://api.deepseek.com/chat/completions";

const getModel = () =>
  process.env.OPENROUTER_MODEL ||
  process.env.DEEPSEEK_MODEL ||
  "deepseek-flash";

const getApiKey = () =>
  process.env.OPENROUTER_API_KEY ||
  process.env.DEEPSEEK_API_KEY ||
  "";

// Retry / timeout configuration
const getRetries = () => Math.max(0, parseInt(process.env.PROPOSAL_MAX_RETRIES || "3", 10));
const getTimeoutMs = () => Math.max(5000, parseInt(process.env.PROPOSAL_TIMEOUT_MS || "60000", 10));
// Generous token budget: free & reasoning models spend output tokens on hidden
// "thinking", and a low limit leaves the actual email empty/truncated.
const getMaxTokens = () => Math.max(1000, parseInt(process.env.PROPOSAL_MAX_TOKENS || "6000", 10));

// HTTP statuses worth retrying (transient upstream / rate limit errors)
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UpstreamError extends Error {
  status?: number;
  retryAfter?: string | null;
  retryable?: boolean;
}

/**
 * Extract the assistant's text from an AI/OpenRouter/DeepSeek response, handling array
 * content parts and stripping hidden reasoning (<think>…</think>). Returns ""
 * when the model produced no usable answer.
 */
function extractMessageContent(result: any): string {
  const msg = result?.choices?.[0]?.message;
  let content = msg?.content;
  if (Array.isArray(content)) {
    content = content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("");
  }
  if (typeof content !== "string") content = "";
  // If content is empty but model put output in reasoning_content, use that as fallback
  if (!content.trim() && typeof msg?.reasoning_content === "string") {
    content = msg.reasoning_content;
  }
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function callOpenRouter(payload: unknown): Promise<any> {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = getEndpoint();
  const apiKey = getApiKey();

  try {
    const response = await (globalThis.fetch || fetch)(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:5174",
        "X-Title": "MultiFeed Lead Intelligence",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const err: UpstreamError = new Error(
        `AI API returned error (${response.status}): ${errText}`,
      );
      err.status = response.status;
      err.retryAfter = response.headers.get("retry-after");
      throw err;
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strips all markdown syntax (MDX, **, [text](url), ### headers, etc.)
 * returning 100% clean plain text suitable for email clients.
 */
export function cleanMarkdownToPlainText(text: string): string {
  let cleaned = text;

  // 1. Remove code blocks
  cleaned = cleaned.replace(/```[a-zA-Z]*\n?([\s\S]*?)\n?```/g, "$1");

  // 2. Convert markdown links: [text](url) and [email](mailto:email)
  cleaned = cleaned.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_match, label, url) => {
    const trimmedLabel = label.trim();
    if (
      trimmedLabel === url ||
      url === `mailto:${trimmedLabel}` ||
      trimmedLabel.toLowerCase().startsWith("link to") ||
      trimmedLabel.toLowerCase() === "link"
    ) {
      return trimmedLabel.includes("@") && url.startsWith("mailto:") ? trimmedLabel : url;
    }
    if (trimmedLabel.startsWith("http://") || trimmedLabel.startsWith("https://")) {
      return trimmedLabel;
    }
    return `${trimmedLabel} (${url})`;
  });

  // 3. Remove bold / strong formatting: **bold** or __bold__
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/__([^_]+)__/g, "$1");

  // 4. Remove standalone emphasis asterisks/underscores around words (e.g. *text*)
  cleaned = cleaned.replace(/(^|[^\*])\*([^\*\n]+)\*([^\*]|$)/g, "$1$2$3");
  cleaned = cleaned.replace(/(^|[^_])_([^_\n]+)_([^_]|$)/g, "$1$2$3");

  // 5. Remove markdown headers: # Header -> Header
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");

  // 6. Normalize bullet points: * bullet -> - bullet
  cleaned = cleaned.replace(/^[\*\+]\s+/gm, "- ");

  // 7. Remove model safety/moderation noise lines (e.g. "User Safety: safe")
  cleaned = cleaned.replace(/^\s*user safety\s*:.*$/gim, "");

  // 8. Ensure an empty blank newline after "How my experience maps/matches..." header
  cleaned = cleaned.replace(/(how (?:my )?experience (?:maps to the role|matches your requirements):?)\n(?!\n)/gi, "$1\n\n");

  // 9. Format mapping section bullets: ensure each item has an empty blank line between every item
  const mappingSectionRegex = /(how (?:my )?experience (?:maps to the role|matches your requirements):?\s*\n+)([\s\S]*?)(\n\s*(?:Practical Technical Evaluation|I'm Upwork|Upwork Top Rated|Portfolio:|GitHub:|LinkedIn:|I'd be happy|Best regards))/i;
  const mappingMatch = cleaned.match(mappingSectionRegex);
  if (mappingMatch) {
    const header = mappingMatch[1].trimEnd();
    const rawBody = mappingMatch[2];
    const footer = mappingMatch[3].trimStart();
    const items = rawBody.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const formatted = items.map((it) => {
      if (/^(?:🚀|⚡|🏆|✅)\s*/.test(it)) {
        return it;
      }
      const stripped = it.replace(/^(?:[-•*])\s*/, "").trim();
      return `✅ ${stripped}`;
    });
    const newSection = header + "\n\n" + formatted.join("\n\n") + "\n\n" + footer;
    cleaned = cleaned.replace(mappingMatch[0], newSection);
  }

  // 10. Ensure any consecutive bullet points have an empty blank line between them
  cleaned = cleaned.replace(/\n((?:[-•*]|✅|🚀|⚡|🏆)\s+[^\n]+)\n((?:[-•*]|✅|🚀|⚡|🏆)\s+)/g, "\n$1\n\n$2");
  cleaned = cleaned.replace(/\n((?:[-•*]|✅|🚀|⚡|🏆)\s+[^\n]+)\n((?:[-•*]|✅|🚀|⚡|🏆)\s+)/g, "\n$1\n\n$2");

  // 11. Clean up excessive spacing (3+ newlines to 2)
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // 12. Normalize any awkward "outside the US" or "outside of India" phrasing into clean remote availability
  cleaned = cleaned.replace(/\b(?:I'm\s+|I\s+am\s+)?(?:currently\s+based\s+|based\s+)?outside(?:\s+of)?\s+(?:the\s+)?(?:US|USA|India)\s*(?:and\s+)?(?:can\s+)?/gi, "I'm available to work remotely and can ");
  cleaned = cleaned.replace(/\bI'm\s+I'm\b/gi, "I'm");

  return cleaned.trim();
}

export interface ResumeOption {
  id: string;
  filename: string;
}

export interface ProposalResult {
  summary: string;
  proposal: string;
  recommendedResumeId?: string;
  recommendedResumeFilename?: string;
}

/**
 * LinkedIn scraped headlines often look like
 * "Software Engineer at Acme · 12,345 followers" or "Acme · 3K+ followers".
 * That social-count noise is not part of the job title/text and must never
 * reach the model, otherwise it leaks into the generated proposal.
 */
export function stripSocialCounts(input?: string): string {
  if (!input) return "";
  return input
    // "12,345 followers" / "3K+ followers" / "1.2M followers" / "500 connections"
    .replace(/\b\d[\d,.]*\s*[KkMm]?\+?\s*(?:followers?|connections?|subscribers?)\b/gi, " ")
    // LinkedIn connection-degree markers ("· 3rd+", "· 2nd")
    .replace(/(^|[·•|]\s*)\d(?:st|nd|rd|th)\+?(?=\s|$)/gi, "$1")
    // Collapse separators/whitespace left behind
    .replace(/\s*[·•|]\s*(?=[·•|])/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·•|,\-–]+/, "")
    .replace(/[\s·•|,\-–]+$/, "")
    .trim();
}
export function matchBestResumeForJob(
  resumes: ResumeOption[],
  jobTitle?: string,
  jobText?: string,
): ResumeOption | undefined {
  if (!resumes || resumes.length === 0) return undefined;
  if (resumes.length === 1) return resumes[0];

  const titleLower = (jobTitle || "").toLowerCase();
  const textLower = (jobText || "").toLowerCase();
  const combined = `${titleLower} ${textLower}`;

  let bestResume: ResumeOption | undefined;
  let bestScore = -1;

  for (const r of resumes) {
    const fn = r.filename.toLowerCase().replace(/\.[^/.]+$/, "");
    const tokens = fn.split(/[^a-z0-9+#]+/).filter((t) => t.length > 2 && t !== "resume" && t !== "cv" && t !== "pdf");

    let score = 0;
    for (const token of tokens) {
      const tokenRegex = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (tokenRegex.test(titleLower)) {
        score += 12;
      } else if (titleLower.includes(token)) {
        score += 6;
      }
      if (tokenRegex.test(textLower)) {
        score += 4;
      } else if (textLower.includes(token)) {
        score += 2;
      }
    }

    // Technology synonym matching:
    if (fn.includes("flutter") || fn.includes("dart")) {
      if (combined.includes("flutter") || combined.includes("dart")) score += 20;
      if (combined.includes("ios") || combined.includes("android") || combined.includes("mobile")) score += 6;
    }
    if (fn.includes("react native") || fn.includes("react_native") || fn.includes("expo")) {
      if (combined.includes("react native") || combined.includes("react-native") || combined.includes("expo")) score += 20;
    }
    if (fn.includes("react") || fn.includes("next") || fn.includes("frontend")) {
      if (combined.includes("next.js") || combined.includes("nextjs") || combined.includes("react") || combined.includes("frontend")) score += 12;
    }
    if (fn.includes("python") || fn.includes("django") || fn.includes("fastapi") || fn.includes("flask") || fn.includes("backend")) {
      if (combined.includes("python") || combined.includes("django") || combined.includes("fastapi") || combined.includes("flask") || combined.includes("backend")) score += 12;
    }
    if (fn.includes("node") || fn.includes("express") || fn.includes("nest") || fn.includes("typescript")) {
      if (combined.includes("node.js") || combined.includes("nodejs") || combined.includes("express") || combined.includes("nest") || combined.includes("typescript")) score += 12;
    }
    if (fn.includes("php") || fn.includes("laravel") || fn.includes("wordpress")) {
      if (combined.includes("php") || combined.includes("laravel") || combined.includes("wordpress")) score += 15;
    }
    if (fn.includes("ai") || fn.includes("ml") || fn.includes("data") || fn.includes("machine learning") || fn.includes("rag")) {
      if (combined.includes("ai") || combined.includes("llm") || combined.includes("machine learning") || combined.includes("rag") || combined.includes("deep learning")) score += 15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestResume = r;
    }
  }

  return bestScore > 0 ? bestResume : resumes[0];
}

export function cleanJobTitle(title?: string, jobText?: string): string {
  let cleaned = stripSocialCounts(title)
    .replace(/^(?:Position|Role|Job Title|Title|Profile|Hiring|Urgent Hiring|Looking for|Wanted)\s*[:–-]\s*/i, "")
    .replace(/#/g, "")
    .trim();

  // Filter out recruiter agency / company descriptors or recruiter profile headlines that get mistakenly parsed as job titles
  const isRecruiterOrAgency =
    /^(?:hiring|we are hiring|urgent hiring|job opportunity|opening|openings|career|careers|urgent requirement|immediate requirement|new job)$/i.test(cleaned) ||
    /\b(?:recruiter|technical recruiter|talent acquisition|sourcer|headhunter|hiring manager|account manager|hr\s*(?:manager|executive|lead|specialist|generalist)?|human resources|recruitment|staffing|consulting|headhunting)\b/i.test(cleaned) ||
    /\bat\s+[A-Za-z0-9\s.,&-]+(?:llc|inc|corp|ltd|technologies|solutions|group|services|consulting|staffing)?$/i.test(cleaned);

  if (isRecruiterOrAgency) {
    cleaned = "";
  }

  // Extract real role from posting description if title is empty, was an agency/recruiter descriptor, or if posting has an explicit Position/Role line
  if (jobText) {
    const profileMatch = jobText.match(
      /(?:Position|Role|Job Title|Title|Profile|Requirement|Hiring for|Looking for)\s*[:–-]\s*([^\n\r,•|📱🔥]+)/i
    );
    if (profileMatch) {
      const extracted = stripSocialCounts(profileMatch[1]).replace(/#/g, "").replace(/\s{2,}/g, " ").trim();
      if (!cleaned || isRecruiterOrAgency) {
        cleaned = extracted;
      }
    } else if (!cleaned) {
      const hiringMatch = jobText.match(/(?:HIRING|LOOKING FOR|WANTED)\s*[–—\-:]\s*([^\n\r,•|📱🔥]+)/i);
      if (hiringMatch) {
        cleaned = stripSocialCounts(hiringMatch[1]).replace(/#/g, "").replace(/\s{2,}/g, " ").trim();
      }
    }
  }

  return cleaned.trim();
}

export function isMobileJob(title?: string, text?: string): boolean {
  const combined = `${title || ""} ${text || ""}`.toLowerCase();
  return (
    combined.includes("mobile") ||
    combined.includes("android") ||
    combined.includes("ios") ||
    combined.includes("kotlin") ||
    combined.includes("swift") ||
    combined.includes("flutter") ||
    combined.includes("react native") ||
    combined.includes("react-native")
  );
}

export interface WorkArrangementInfo {
  isOnsiteOrHybrid: boolean;
  arrangementLabel: "onsite" | "hybrid" | "remote";
  location: string;
  targetTimezone: string;
  usTimezone: string; // backwards compatibility alias for targetTimezone
}

export function formatTimezoneOverlap(tz?: string): string {
  if (!tz || tz === "your team's" || tz === "team") {
    return "full timezone overlap with your team";
  }
  if (tz.toLowerCase().includes("pakistan") || tz.toLowerCase().includes("pkt")) {
    return "full Pakistan (PKT) timezone overlap";
  }
  return `full ${tz} timezone overlap`;
}

export function detectWorkArrangement(title?: string, text?: string, forceRemote?: boolean): WorkArrangementInfo {
  const combined = `${title || ""} ${text || ""}`;

  let location = "";
  let targetTimezone = "your team's";

  // 1. Check for explicit labeled location e.g. "Location : Saidpur Road, Rawalpindi" or "Location: Bangalore, India"
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

  return {
    isOnsiteOrHybrid,
    arrangementLabel,
    location,
    targetTimezone,
    usTimezone,
  };
}

export interface ExtractedDemoVideo {
  url: string;
  label?: string;
  fullInlineText: string;
}

export function extractDemoVideoLinks(profileContent: string): ExtractedDemoVideo[] {
  if (!profileContent) return [];
  const results: ExtractedDemoVideo[] = [];
  const lines = profileContent.split(/\r?\n/);
  // Matches youtu.be, youtube.com, loom.com
  const videoRegex = /https?:\/\/(?:www\.)?(?:youtu\.be\/[a-zA-Z0-9_-]+|youtube\.com\/(?:watch\?v=[a-zA-Z0-9_-]+|shorts\/[a-zA-Z0-9_-]+)|loom\.com\/share\/[a-zA-Z0-9_-]+)/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(videoRegex);
    if (!match) continue;
    const url = match[0];

    const parenMatch = trimmed.match(/\(([^)]+)\)/);
    const beforeUrl = trimmed.slice(0, trimmed.indexOf(url)).replace(/^[-*•\d.\s]+/, "").trim();

    let fullInlineText = url;
    if (parenMatch) {
      if (beforeUrl && !parenMatch[1].toLowerCase().includes(beforeUrl.toLowerCase())) {
        fullInlineText = `${url} (${beforeUrl.replace(/[:\-–]+$/, "").trim()} — ${parenMatch[1].trim()})`;
      } else {
        fullInlineText = `${url} (${parenMatch[1].trim()})`;
      }
    } else if (beforeUrl) {
      fullInlineText = `${url} (${beforeUrl.replace(/[:\-–]+$/, "").trim()})`;
    }

    if (!results.some((r) => r.url === url)) {
      results.push({
        url,
        label: parenMatch ? parenMatch[1].trim() : beforeUrl,
        fullInlineText,
      });
    }
  }

  return results;
}

export type JobDomain =
  | "flutter"
  | "react-native"
  | "ios"
  | "android"
  | "mobile"
  | "ai"
  | "frontend"
  | "backend"
  | "fullstack"
  | "general";

export function detectJobDomain(title?: string, text?: string): string {
  const combined = `${title || ""} ${text || ""}`.toLowerCase();
  if (combined.includes("flutter") || combined.includes("dart")) return "flutter";
  if (combined.includes("react native") || combined.includes("react-native") || combined.includes("expo")) return "react-native";
  if (combined.includes("swift") || combined.includes("swiftui") || combined.includes("uikit") || (combined.includes("ios") && !combined.includes("android"))) return "ios";
  if (combined.includes("kotlin") || combined.includes("jetpack compose") || (combined.includes("android") && !combined.includes("ios"))) return "android";
  if (combined.includes("mobile") || combined.includes("app developer")) return "mobile";
  if (combined.includes("ai") || combined.includes("llm") || combined.includes("rag") || combined.includes("agent") || combined.includes("machine learning") || combined.includes("generative ai")) return "ai";
  if (combined.includes("react") || combined.includes("next.js") || combined.includes("nextjs") || combined.includes("frontend") || combined.includes("vue") || combined.includes("angular") || combined.includes("tailwind")) return "frontend";
  if (combined.includes("node") || combined.includes("backend") || combined.includes("express") || combined.includes("nest") || combined.includes("fastapi") || combined.includes("django") || combined.includes("golang") || /\bgo\b/.test(combined)) return "backend";
  if (combined.includes("full stack") || combined.includes("fullstack") || combined.includes("full-stack")) return "fullstack";
  return "";
}

export interface DomainDetails {
  domain: string;
  domainLabel: string;
  coreTech: string;
  roleTitle: string;
  resumeUrl: string;
  resumeLabel: string;
  domainYears: string;
  experienceYearsHook: string;
  recentAppLabel: string;
  recentAppType: string;
  recentAppTech: string;
  recentAppUrl: string;
  demoVideoUrl: string;
  requiredSkillsPrompt: string;
  strictExclusionsPrompt: string;
  aiFirstBullets: string[];
  standardBullets: string[];
}

export function getDomainDetails(domain: string, cleanTitle?: string, cleanText?: string): DomainDetails {
  const normDomain = domain.toLowerCase();
  const textLower = (cleanText || "").toLowerCase();

  if (normDomain === "flutter") {
    return {
      domain: "flutter",
      domainLabel: "Flutter",
      coreTech: "Flutter & Dart",
      roleTitle: cleanTitle || "Flutter Developer",
      resumeUrl: "https://umerwaqas.lovable.app?resume=3",
      resumeLabel: "Flutter Resume",
      domainYears: "5+ years",
      experienceYearsHook:
        "I bring 11+ years of overall software development experience, including 5+ years specializing in Flutter & cross-platform mobile development (Dart, iOS, and Android).\n\nI've built 100+ Android and iOS applications, with 22+ published on Google Play and Apple App Store, including Zeely AI Marketing Platform, Flibbo AI, AI Influencer Generator, and DocReady Pro.",
      recentAppLabel: "Recent Flutter App — AI Influencer Generator",
      recentAppType: "iOS App: https://apps.apple.com/us/app/id6759487099",
      recentAppTech: "Built using Flutter & Dart, featuring clean architecture (Bloc/Riverpod), responsive UI across iOS and Android, and real-time generation pipelines.",
      recentAppUrl: "https://apps.apple.com/us/app/id6759487099",
      demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
      requiredSkillsPrompt: `ALL NEEDED FLUTTER SKILLS (MUST FEATURE THESE SPECIFIC SKILLS IN THE EMAIL):
1. Flutter & Dart: Modern Dart (sound null safety, async/await, streams, isolates for heavy background tasks), Flutter 3.x cross-platform framework.
2. State Management: Bloc / Cubit, Riverpod, Provider, GetX.
3. Clean Architecture: Feature-First Clean Architecture, MVVM, Repository Pattern, get_it dependency injection.
4. UI/UX & Animations: Pixel-perfect Figma design implementation, Custom Widgets, Slivers (CustomScrollView), CustomPainter, implicit/explicit animations, responsive multi-screen layouts, Material 3 & Cupertino.
5. Networking & APIs: Dio / HTTP client, RESTful APIs, GraphQL, JSON serialization (Freezed / json_serializable), interceptors, offline caching.
6. Local Storage: Hive, SQLite / Sqflite, Isar, SharedPreferences, flutter_secure_storage.
7. Firebase & Push Notifications: Firebase Authentication, Cloud Firestore, Cloud Functions, FCM (Firebase Cloud Messaging) Push Notifications, Crashlytics, Analytics, Remote Config.
8. Platform Channels & Native Bridge: MethodChannel & EventChannel bridging native Swift (iOS) and Kotlin (Android) code.
9. Mobile Hardware & System APIs: Camera, Geolocation / GPS, Bluetooth, Biometrics (local_auth), App Permissions.
10. Monetization & Payments: In-App Purchases (in_app_purchase), RevenueCat, Stripe payment gateway, subscription paywalls.
11. Testing & DevTools Profiling: Unit and Widget testing using flutter_test and Mockito; DevTools profiling to eliminate widget rebuilds, memory leaks, and jank (60/120 FPS).
12. App Store & Play Store Release: Google Play Console (AAB bundles, internal testing, production releases), Apple App Store Connect (TestFlight, provisioning profiles, certificates, App Store review compliance), CI/CD with Fastlane / GitHub Actions.
13. Production Portfolio: 22+ published apps on App Store & Google Play (Zeely AI, Flibbo AI, AI Influencer Generator, DocReady Pro).`,
      strictExclusionsPrompt: `STRICT EXCLUSIONS FOR FLUTTER JOBS (CRITICAL — ZERO TOLERANCE):
- NEVER mention AWS, GCP, or Azure unless the job posting explicitly mentions AWS Amplify or GCP backend.
- NEVER mention Docker, Kubernetes, or containerization. Mobile apps run on devices, not in Docker containers.
- NEVER mention Node.js, Go, Next.js, React, Django, or Python SaaS backends unless the job explicitly asks for full-stack Flutter + backend.
- NEVER mention "Claude testing" or weird AI buzzwords in technical bullets. Testing MUST be real unit/widget testing with flutter_test and Mockito!
- If mentioning AI tools, frame it ONLY as development velocity with Cursor / Claude Code to ship Flutter code ~60% faster.`,
      aiFirstBullets: [
        "✅ Flutter & Dart Core Architecture — 5+ years building and shipping high-performance cross-platform iOS and Android apps using Flutter 3.x and modern Dart (sound null safety, async streams, isolates for heavy computation), including AI Influencer Generator, Zeely AI Marketing Platform, and Flibbo AI.",
        "✅ State Management & Clean Architecture — Production mastery of Bloc/Cubit, Riverpod, and Provider using Feature-First Clean Architecture, MVVM, Repository pattern, and get_it dependency injection for modular, testable, and maintainable codebases.",
        "✅ Custom UI, Slivers & 60/120 FPS Animations — Pixel-perfect translation of Figma designs into responsive Material 3 and Cupertino widgets, CustomPainter, Slivers (CustomScrollView), and smooth implicit/explicit animations with 0 frame drops.",
        "✅ REST APIs, Dio & Offline-First Storage — Robust network architecture with Dio, JSON serialization (Freezed), interceptors, retry handling, and offline-first persistence using Hive, SQLite (sqflite), and Isar.",
        "✅ Firebase & Mobile Cloud Services — Complete integration of Firebase Authentication, Cloud Firestore, Cloud Functions, FCM (Firebase Cloud Messaging) push notifications, Crashlytics, and Remote Config.",
        "✅ Native Platform Channels & Hardware Integration — Built MethodChannel and EventChannel bridging to native Swift (iOS) and Kotlin (Android) for camera, background services, GPS/location, biometrics (local_auth), and In-App Purchases (RevenueCat & in_app_purchase).",
        "✅ Testing, DevTools Profiling & Store Publishing — Thorough Unit and Widget testing using flutter_test and Mockito; DevTools profiling to eliminate widget rebuilds and memory leaks; hands-on release management across Apple App Store (TestFlight) and Google Play Console.",
        "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects and 22+ published apps; using modern AI-assisted engineering workflows (Cursor & Claude Code) to accelerate feature implementation velocity by ~60% while strictly adhering to clean Flutter coding standards.",
      ],
      standardBullets: [
        "✅ Flutter & Dart Architecture — Shipped high-performance cross-platform mobile apps with Flutter 3.x, Dart null safety, Bloc/Riverpod state management, and Feature-First Clean Architecture.",
        "✅ Custom UI, Slivers & 60/120 FPS Animations — Implemented pixel-perfect Figma designs, custom Slivers, Cupertino/Material 3 components, and fluid animations optimized for smooth 60/120 FPS render performance.",
        "✅ REST APIs, Dio, Offline Sync & Firebase — Built robust network layers using Dio, Freezed, SQLite/Hive local storage, and Firebase services including FCM push notifications and Crashlytics.",
        "✅ Testing, DevTools Profiling & Store Publishing — Thorough unit and widget testing with flutter_test, DevTools memory/rebuild profiling, and hands-on release deployment to Apple App Store (TestFlight) and Google Play Console.",
      ],
    };
  }

  if (normDomain === "react-native") {
    return {
      domain: "react-native",
      domainLabel: "React Native",
      coreTech: "React Native & TypeScript",
      roleTitle: cleanTitle || "React Native Developer",
      resumeUrl: "https://umerwaqas.lovable.app?resume=3",
      resumeLabel: "Mobile Resume",
      domainYears: "5+ years",
      experienceYearsHook:
        "I bring 11+ years of overall software development experience, including 5+ years specializing in React Native and cross-platform mobile development (TypeScript, iOS, and Android).\n\nI've delivered production mobile applications with seamless App Store and Google Play deployments.",
      recentAppLabel: "Recent Mobile App — AI Influencer Generator",
      recentAppType: "iOS App: https://apps.apple.com/us/app/id6759487099",
      recentAppTech: "Built using React Native, TypeScript, and modern mobile architecture, featuring real-time workflows and cross-platform integrations.",
      recentAppUrl: "https://apps.apple.com/us/app/id6759487099",
      demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
      requiredSkillsPrompt: `ALL NEEDED REACT NATIVE SKILLS:
- React Native, modern TypeScript, Expo and Bare workflow across iOS & Android
- State management with Redux Toolkit and Zustand; navigation with React Navigation
- Custom UI, StyleSheet, Reanimated, gesture handling, and responsive multi-device design
- RESTful APIs, Axios, GraphQL, and offline storage with MMKV and AsyncStorage
- Firebase services (Auth, Firestore, FCM Push Notifications with Notifee)
- Native Modules & TurboModules for iOS (Swift) and Android (Kotlin)
- Testing with Jest and React Native Testing Library (RNTL); App Store & Google Play deployments`,
      strictExclusionsPrompt: `STRICT EXCLUSIONS FOR REACT NATIVE:
- NEVER mention Flutter, Dart, Go, Docker, AWS, or GCP unless explicitly required by the posting.
- NEVER mention "Claude testing". Focus on real Jest / RNTL testing.`,
      aiFirstBullets: [
        "✅ React Native & TypeScript Core — 5+ years building and shipping cross-platform mobile applications with React Native, TypeScript, and Expo / Bare workflow across iOS and Android.",
        "✅ State Management & Navigation — Production expertise in Redux Toolkit, Zustand, and React Navigation with clean decoupled feature architecture.",
        "✅ Fluid UI & Reanimated Animations — Pixel-perfect UI implementation with StyleSheet, React Native Reanimated, gesture handling, and responsive layouts.",
        "✅ Networking & Offline Caching — Robust API integration using Axios, REST, GraphQL, with offline caching using MMKV and AsyncStorage.",
        "✅ Push Notifications & Firebase — Complete mobile backend integration with Firebase Auth, Cloud Firestore, and FCM push notifications via Notifee.",
        "✅ Native Modules & Hardware APIs — Implemented Native Modules and TurboModules bridging to iOS (Swift) and Android (Kotlin) for camera, location, and biometrics.",
        "✅ Testing & Store Publishing — Unit and integration testing with Jest and React Native Testing Library; releases on Apple TestFlight and Google Play Console.",
        "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects; accelerating delivery velocity by ~60% using Cursor & Claude Code.",
      ],
      standardBullets: [
        "✅ React Native & TypeScript Architecture — Built production cross-platform apps using React Native, TypeScript, Expo, and Redux Toolkit/Zustand.",
        "✅ UI, Animations & Native Modules — Created smooth 60 FPS mobile interfaces with Reanimated, custom native bridges, and pixel-perfect design system implementations.",
        "✅ Networking, Storage & Notifications — Implemented Axios API layers, MMKV offline persistence, and Firebase FCM push notifications.",
        "✅ Testing & Store Publishing — Unit testing with Jest/RNTL and automated release deployments to TestFlight and Google Play Console.",
      ],
    };
  }

  if (normDomain === "ios") {
    return {
      domain: "ios",
      domainLabel: "iOS",
      coreTech: "Swift & SwiftUI",
      roleTitle: cleanTitle || "iOS Developer",
      resumeUrl: "https://umerwaqas.lovable.app?resume=3",
      resumeLabel: "iOS Resume",
      domainYears: "5+ years",
      experienceYearsHook:
        "I bring 11+ years of overall software development experience, including 5+ years specializing in native iOS development with Swift, SwiftUI, and UIKit.\n\nI've shipped native iOS applications to the Apple App Store, including OnePDF, DocReady Pro, and PlayCam.",
      recentAppLabel: "Recent iOS App — OnePDF Document Utility",
      recentAppType: "iOS App Store: https://apps.apple.com/us/app/docready-pro/id6503932757",
      recentAppTech: "Built using Swift & SwiftUI, featuring native document workflows, PDF conversion, and App Store release.",
      recentAppUrl: "https://apps.apple.com/us/app/docready-pro/id6503932757",
      demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
      requiredSkillsPrompt: `ALL NEEDED iOS SKILLS:
- Swift, SwiftUI, UIKit, Auto Layout, Combine, async/await
- CoreData, SwiftData, local caching, Keychain security
- URLSession, REST APIs, JSON parsing, background downloads
- XCTest unit & UI testing, TestFlight, App Store Connect provisioning and releases`,
      strictExclusionsPrompt: `STRICT EXCLUSIONS FOR iOS:
- NEVER mention Flutter, React Native, Node, Go, Docker, AWS, GCP unless explicitly in posting.
- NEVER say "Claude testing". Focus on XCTest and Apple developer tooling.`,
      aiFirstBullets: [
        "✅ Swift & SwiftUI Architecture — 5+ years building and shipping native iOS applications with modern Swift, SwiftUI, and UIKit.",
        "✅ Concurrency & Reactive State — Production mastery of async/await, actors, Combine, and structured concurrency for crash-free execution.",
        "✅ Local Persistence & CoreData — Architected reliable local storage using CoreData, SwiftData, and Keychain for secure sensitive data.",
        "✅ Networking & Background Services — Built URLSession networking layers, background tasks, push notifications (APNs), and offline sync.",
        "✅ Hardware & Apple Frameworks — Integrated AVFoundation, Camera, CoreLocation, FaceID biometrics, and StoreKit In-App Purchases.",
        "✅ Architecture & Design Patterns — MVVM, Clean Architecture, Protocol-Oriented Programming, and modular workspace structures.",
        "✅ Testing & App Store Connect — Unit and UI testing with XCTest; TestFlight builds, provisioning profiles, and App Store review compliance.",
        "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects; shipping native iOS releases ~60% faster with Cursor.",
      ],
      standardBullets: [
        "✅ Swift & SwiftUI Architecture — Built production native iOS apps using Swift, SwiftUI, and UIKit with MVVM architecture.",
        "✅ Concurrency & Networking — Implemented async/await pipelines, URLSession networking, and APNs push notifications.",
        "✅ Local Storage & StoreKit — Integrated CoreData/SwiftData persistence, Keychain security, and In-App Purchases.",
        "✅ Testing & Store Releases — XCTest unit testing and end-to-end TestFlight / App Store deployment.",
      ],
    };
  }

  if (normDomain === "android") {
    return {
      domain: "android",
      domainLabel: "Android",
      coreTech: "Kotlin & Compose",
      roleTitle: cleanTitle || "Android Developer",
      resumeUrl: "https://umerwaqas.lovable.app?resume=3",
      resumeLabel: "Android Resume",
      domainYears: "5+ years",
      experienceYearsHook:
        "I bring 11+ years of overall software development experience, including 5+ years specializing in native Android development with Kotlin and Jetpack Compose.\n\nI've delivered 10+ production Android apps on Google Play, including Microphone Amplifier, VisageID, and TrendSnap FX.",
      recentAppLabel: "Recent Android App — VisageID & TrendSnap FX",
      recentAppType: "Google Play: https://play.google.com/store/apps/details?id=com.app2mob.visageid",
      recentAppTech: "Built using Kotlin & Jetpack Compose, featuring real-time services, Room DB, and Google Play delivery.",
      recentAppUrl: "https://play.google.com/store/apps/details?id=com.app2mob.visageid",
      demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
      requiredSkillsPrompt: `ALL NEEDED ANDROID SKILLS:
- Kotlin, Jetpack Compose, XML layouts, Coroutines, Flow
- MVVM, Clean Architecture, Hilt/Dagger dependency injection
- Room DB, Retrofit, OkHttp, WorkManager, Foreground Services
- JUnit, Espresso testing, Google Play Console release management`,
      strictExclusionsPrompt: `STRICT EXCLUSIONS FOR ANDROID:
- NEVER mention Flutter, Swift, Node, Go, Docker, AWS, GCP unless in posting.
- NEVER say "Claude testing". Focus on JUnit and Espresso.`,
      aiFirstBullets: [
        "✅ Kotlin & Jetpack Compose Architecture — 5+ years building and shipping native Android applications with Kotlin, Compose, and Material 3.",
        "✅ Coroutines & Reactive Flow — Production mastery of Kotlin Coroutines, StateFlow, and SharedFlow for smooth non-blocking execution.",
        "✅ Architecture & Dependency Injection — MVVM and Clean Architecture with Hilt and Dagger for modular, scalable apps.",
        "✅ Room DB & Data Persistence — Local caching and offline persistence with Room SQLite, DataStore, and encrypted SharedPreferences.",
        "✅ Background Processing & Services — Built robust foreground services, WorkManager background workers, and real-time audio/data pipelines.",
        "✅ Networking & Third-Party APIs — Retrofit, OkHttp, JSON serialization, and FCM push notifications with high reliability.",
        "✅ Testing & Google Play Publishing — Unit and UI testing with JUnit and Espresso; AAB bundle packaging, signing, and Play Console release tracks.",
        "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects and 22+ published apps.",
      ],
      standardBullets: [
        "✅ Kotlin & Compose Architecture — Built native Android apps with Kotlin, Jetpack Compose, and Hilt dependency injection.",
        "✅ Coroutines, Room & Retrofit — Implemented reactive flows, Room SQLite persistence, and Retrofit network layers.",
        "✅ Background Services & Hardware — Shipped low-latency audio utilities and foreground services with WorkManager.",
        "✅ Testing & Play Console Releases — JUnit testing and automated release deployments on Google Play.",
      ],
    };
  }

  if (normDomain === "mobile") {
    return {
      domain: "mobile",
      domainLabel: "Mobile",
      coreTech: "Flutter & Mobile Architecture",
      roleTitle: cleanTitle || "Senior Mobile Developer",
      resumeUrl: "https://umerwaqas.lovable.app?resume=3",
      resumeLabel: "Mobile Resume",
      domainYears: "5+ years",
      experienceYearsHook:
        "I bring 11+ years of overall software development experience, including 5+ years specializing in mobile application development across Flutter, iOS, and Android.\n\nI've built 100+ mobile applications, with 22+ published on Google Play and Apple App Store, including Zeely AI, Flibbo AI, AI Influencer Generator, and DocReady Pro.",
      recentAppLabel: "Recent Mobile App — AI Influencer Generator",
      recentAppType: "iOS App: https://apps.apple.com/us/app/id6759487099",
      recentAppTech: "Built using Flutter, featuring cross-platform state management (Bloc/Riverpod), responsive UI, and App Store / Google Play delivery.",
      recentAppUrl: "https://apps.apple.com/us/app/id6759487099",
      demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
      requiredSkillsPrompt: `ALL NEEDED MOBILE SKILLS:
- Flutter/Dart, iOS (Swift), Android (Kotlin), cross-platform engineering
- State management, Clean Architecture, offline storage (SQLite, Hive)
- Push notifications, Firebase, REST APIs, In-App Purchases
- Unit/widget testing, TestFlight, and Google Play Console release management`,
      strictExclusionsPrompt: `STRICT EXCLUSIONS FOR MOBILE:
- NEVER mention Docker, Kubernetes, AWS, GCP, Node, or Go unless specifically in the posting.
- NEVER say "Claude testing". Focus on real mobile unit and widget testing.`,
      aiFirstBullets: [
        "✅ Cross-Platform Mobile Architecture — 5+ years building and shipping high-performance mobile apps across iOS and Android with Flutter and native components.",
        "✅ State Management & Clean Architecture — Production mastery of Bloc, Riverpod, and Provider with Feature-First Clean Architecture and MVVM.",
        "✅ Custom UI & 60/120 FPS Performance — Pixel-perfect Figma design implementation with custom widgets, smooth animations, and zero frame drops.",
        "✅ REST APIs & Offline-First Storage — Robust network layers with Dio/Retrofit, JSON serialization, and offline caching via SQLite and Hive.",
        "✅ Firebase & Push Notifications — Complete integration of Firebase Auth, Firestore, FCM push notifications, and Crashlytics.",
        "✅ Native Platform Integration — MethodChannels and platform bridges for camera, background services, location, and In-App Purchases.",
        "✅ Testing & Store Publishing — Unit and widget testing (flutter_test, Mockito); release management on Apple App Store (TestFlight) and Google Play Console.",
        "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects and 22+ published apps.",
      ],
      standardBullets: [
        "✅ Cross-Platform Architecture — Delivered 100+ mobile apps across Flutter, iOS, and Android with 22+ published on app stores.",
        "✅ State Management & Clean Architecture — Expert in Bloc, Riverpod, and MVVM patterns for scalable, maintainable mobile codebases.",
        "✅ APIs, Offline Storage & Firebase — Built robust network layers, SQLite/Hive caching, and FCM push notifications.",
        "✅ Testing & Store Releases — Hands-on unit/widget testing and full release cycles via TestFlight and Google Play Console.",
      ],
    };
  }

  if (normDomain === "frontend") {
    return {
      domain: "frontend",
      domainLabel: "Frontend",
      coreTech: "React & Next.js",
      roleTitle: cleanTitle || "Senior Frontend Developer",
      resumeUrl: "https://umerwaqas.lovable.app?resume=1",
      resumeLabel: "Frontend Resume",
      domainYears: "7+ years",
      experienceYearsHook:
        "I bring 11+ years of overall software development experience, including 7+ years specializing in modern frontend engineering with React, Next.js, and TypeScript.\n\nI've built and scaled responsive, accessible web platforms with 95+ Lighthouse performance scores, including NicheTrafficKit and DevRel Employee.",
      recentAppLabel: "Recent Web Platform — NicheTrafficKit",
      recentAppType: "Web App: https://nichetraffickit.com",
      recentAppTech: "Built using Next.js, React, TypeScript, and Tailwind CSS, featuring automated workflows and responsive multi-device design.",
      recentAppUrl: "https://nichetraffickit.com",
      demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
      requiredSkillsPrompt: `ALL NEEDED FRONTEND SKILLS:
- React 18/19, Next.js (App Router, Server Components, SSR/SSG), TypeScript
- State management with Zustand, Redux Toolkit, and TanStack Query
- Responsive UI with Tailwind CSS, Radix UI, Figma design systems
- RESTful APIs, GraphQL, Web Vitals performance (Lighthouse 95+), Vitest/Jest`,
      strictExclusionsPrompt: `STRICT EXCLUSIONS FOR FRONTEND:
- NEVER mention Flutter, Dart, Swift, Kotlin, Go, or Docker unless explicitly in the posting.
- NEVER say "Claude testing". Focus on Vitest / Jest / Playwright.`,
      aiFirstBullets: [
        "✅ React & Next.js Architecture — 7+ years building production web applications with Next.js (App Router, Server Components, SSR/SSG) and TypeScript.",
        "✅ State Management & Data Fetching — Production expertise in Zustand, Redux Toolkit, and TanStack Query with optimistic updates and caching.",
        "✅ Modern Design Systems & Tailwind CSS — Pixel-perfect translation of Figma designs into accessible, responsive interfaces using Tailwind CSS.",
        "✅ Web Performance & Core Web Vitals — Optimized LCP, INP, and CLS achieving 95+ Lighthouse scores through code splitting and asset optimization.",
        "✅ REST & GraphQL Integration — Type-safe API client architecture with Zod validation, error boundaries, and WebSocket realtime updates.",
        "✅ Auth & Full-Stack Capabilities — Implemented OAuth2, NextAuth, session management, and server action pipelines.",
        "✅ Testing & CI/CD — Unit and component testing with Vitest and React Testing Library; automated deployments via Vercel and GitHub Actions.",
        "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects; shipping production UI ~60% faster with Cursor.",
      ],
      standardBullets: [
        "✅ React & Next.js Architecture — Built scalable SaaS frontends with Next.js App Router, TypeScript, and Tailwind CSS.",
        "✅ State & Data Layer — Integrated Zustand, TanStack Query, and type-safe REST/GraphQL APIs with Zod validation.",
        "✅ Performance & SEO — Maintained 95+ Lighthouse scores with server components, lazy loading, and Core Web Vitals optimization.",
        "✅ Testing & Deployment — Vitest component testing and automated production CI/CD deployments via Vercel.",
      ],
    };
  }

  if (normDomain === "backend") {
    const isPythonJob = textLower.includes("python") || textLower.includes("fastapi") || textLower.includes("django");
    const isGoJob = textLower.includes("golang") || /\bgo\b/.test(textLower);
    const backendTech = isGoJob ? "Go & PostgreSQL" : isPythonJob ? "Python & FastAPI" : "Node.js & TypeScript";

    return {
      domain: "backend",
      domainLabel: "Backend",
      coreTech: backendTech,
      roleTitle: cleanTitle || "Senior Backend Engineer",
      resumeUrl: "https://umerwaqas.lovable.app?resume=1",
      resumeLabel: "Backend Resume",
      domainYears: "7+ years",
      experienceYearsHook:
        `I bring 11+ years of overall software development experience, including 7+ years building scalable backends, microservices, and distributed database systems with ${backendTech}.`,
      recentAppLabel: "Recent SaaS Backend — Ardent & DevRel Employee",
      recentAppType: "Live Platform: https://www.tryardent.com/",
      recentAppTech: `Built using ${backendTech}, PostgreSQL, Redis, and cloud infrastructure, featuring isolated database sandboxing and high-throughput APIs.`,
      recentAppUrl: "https://www.tryardent.com/",
      demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
      requiredSkillsPrompt: `ALL NEEDED BACKEND SKILLS:
- ${backendTech}, RESTful APIs, OpenAPI/Swagger, gRPC, WebSockets
- PostgreSQL, MongoDB, Redis caching, schema migrations, indexing & query tuning
- Authentication (JWT, OAuth2, RBAC), background queues, microservices
- Docker, CI/CD, unit & integration testing with Jest/PyTest`,
      strictExclusionsPrompt: `STRICT EXCLUSIONS FOR BACKEND:
- NEVER mention Flutter, Dart, Swift, Kotlin, or mobile UI unless specifically required.
- Focus strictly on backend architecture, databases, performance, and APIs.`,
      aiFirstBullets: [
        `✅ ${backendTech} Architecture — 7+ years developing scalable, resilient backend services and high-throughput REST/gRPC APIs.`,
        "✅ Database Design & Optimization — Advanced PostgreSQL and MongoDB architecture with connection pooling, indexing, and query tuning.",
        "✅ Caching & Background Processing — Scalable asynchronous worker pipelines using Redis, BullMQ, Celery, and message queues.",
        "✅ Realtime & Security — Implemented JWT/OAuth2 authentication, RBAC, input validation, rate limiting, and WebSockets.",
        "✅ Database Branching Infrastructure (Ardent) — Engineered copy-on-write Postgres sandbox execution completing in under 6 seconds.",
        "✅ Microservices & API Design — Clean hexagonal/clean architecture with OpenAPI specifications and automated integration tests.",
        "✅ Testing & DevOps — Thorough unit/integration testing with Jest/PyTest; containerized Docker deployments with automated CI/CD.",
        "🚀 Rapid Delivery & AI-Assisted Velocity — Top Rated on Upwork with 100% Job Success across 48+ projects.",
      ],
      standardBullets: [
        `✅ ${backendTech} Core — Shipped scalable backend services and high-throughput REST/gRPC APIs with clean architecture.`,
        "✅ Database Architecture — Advanced PostgreSQL/MongoDB schema design, indexing, and Redis caching layers.",
        "✅ Security & Auth — Production JWT/OAuth2 authentication, role-based access control, and rate-limiting middleware.",
        "✅ Testing & Cloud CI/CD — Comprehensive automated integration testing and production containerized deployments.",
      ],
    };
  }

  if (normDomain === "ai") {
    return {
      domain: "ai",
      domainLabel: "AI / LLM",
      coreTech: "Python & RAG",
      roleTitle: cleanTitle || "Senior AI / LLM Engineer",
      resumeUrl: "https://umerwaqas.lovable.app?resume=2",
      resumeLabel: "AI Engineer Resume",
      domainYears: "3+ years",
      experienceYearsHook:
        "I bring 11+ years of overall software development experience, including 3+ years specializing in production AI systems, LLM integrations, RAG pipelines, and autonomous agentic workflows.\n\nI've shipped production AI platforms including Ardent, Askly, and NicheTrafficKit.",
      recentAppLabel: "Recent AI Platform — Ardent & Askly",
      recentAppType: "Live: https://www.tryardent.com/",
      recentAppTech: "Built using Python, FastAPI, OpenAI/Claude APIs, and vector databases, featuring autonomous agents and database branching.",
      recentAppUrl: "https://www.tryardent.com/",
      demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
      requiredSkillsPrompt: `ALL NEEDED AI / LLM SKILLS:
- Python, FastAPI, OpenAI / Claude / DeepSeek APIs, structured function calling
- Hybrid RAG pipelines, chunking strategies, embeddings, Vector DBs (Pinecone, pgvector, Qdrant)
- Autonomous AI Agents, multi-agent orchestration, LangChain, LlamaIndex, MCP protocol
- Evaluation guardrails, latency & token cost optimization, prompt engineering`,
      strictExclusionsPrompt: `STRICT EXCLUSIONS FOR AI:
- NEVER mention Flutter or mobile UI unless the posting is explicitly for Mobile AI.
- Focus strictly on LLMs, RAG, agents, vector search, Python, and AI system design.`,
      aiFirstBullets: [
        "✅ Production LLM & API Integration — 3+ years building production AI systems with OpenAI, Claude, and DeepSeek APIs, utilizing structured outputs and tool calling.",
        "✅ Hybrid RAG & Vector Search — Engineered retrieval pipelines with chunking, embeddings, and vector databases (Pinecone, pgvector, Qdrant) for high-accuracy contextual recall.",
        "✅ Autonomous Coding Agents (Ardent) — Built database-branching sandbox infrastructure letting AI agents run schema migrations and tests on 1:1 Postgres copies in under 6 seconds.",
        "✅ Natural Language Data Agents (Askly) — Developed AI database agent using schema-aware retrieval to execute SQL queries, charts, and automated reports from user prompts.",
        "✅ Multi-Agent Orchestration — Built agent pipelines using LangChain, LlamaIndex, and MCP protocols with state machines and human-in-the-loop controls.",
        "✅ Prompt & Context Engineering — Designed defensible system prompts, few-shot examples, dynamic context pruning, and guardrails minimizing hallucinations.",
        "✅ Latency & Cost Optimization — Implemented semantic response caching, streaming completions, and model routing to cut token costs by ~40%.",
        "🚀 Rapid MVP Delivery — Top Rated on Upwork with 100% Job Success across 48+ projects; delivered selected production AI MVPs in under 5 days.",
      ],
      standardBullets: [
        "✅ LLM & RAG Systems — Built production RAG pipelines with semantic vector search (pgvector/Pinecone) and structured LLM tool calling.",
        "✅ Autonomous Agents (Ardent) — Engineered isolated database-branching sandboxes for coding agents with zero production blast radius.",
        "✅ AI Data Agents (Askly) — Created natural-language query engines connecting directly to relational databases with automated reporting.",
        "✅ Performance & Delivery — Implemented token-efficient caching and streaming responses; delivered AI MVPs in under 5 days.",
      ],
    };
  }

  // Fallback / Full-Stack
  return {
    domain: "fullstack",
    domainLabel: "Full Stack",
    coreTech: "React/Next.js & Python/Node",
    roleTitle: cleanTitle || "Senior Full Stack Developer",
    resumeUrl: "https://umerwaqas.lovable.app?resume=1",
    resumeLabel: "Full Stack Resume",
    domainYears: "7+ years",
    experienceYearsHook:
      "I bring 11+ years of overall software development experience, including 7+ years building scalable SaaS applications and web platforms, alongside production AI integrations and mobile applications.",
    recentAppLabel: "Recent Platform — NicheTrafficKit",
    recentAppType: "Web App: https://nichetraffickit.com",
    recentAppTech: "Built using Next.js, React, Node.js, and Python AI, featuring automated workflows and production full-stack architecture.",
    recentAppUrl: "https://nichetraffickit.com",
    demoVideoUrl: "https://youtu.be/6m19rKN7i3I",
    requiredSkillsPrompt: `ALL NEEDED FULL-STACK SKILLS:
- React, Next.js, TypeScript on the frontend
- Node.js, Express, Python, FastAPI, PostgreSQL on the backend
- RESTful APIs, authentication, state management, and cloud deployments`,
    strictExclusionsPrompt: "Ensure all skills directly match the job requirements without stuffing unrelated buzzwords.",
    aiFirstBullets: [
      "✅ Full-Stack Architecture — 7+ years building production SaaS platforms with modern React/Next.js frontends and Node.js/Python backends.",
      "✅ API & Database Design — Designed robust RESTful APIs, database schemas, and data pipelines using PostgreSQL, MongoDB, and Firebase.",
      "✅ Frontend Engineering — Built responsive, accessible user interfaces using TypeScript, Tailwind CSS, and state management libraries.",
      "✅ Realtime & Authentication — Implemented OAuth2, JWT authentication, session handling, and WebSockets for live user interactions.",
      "✅ AI & Workflow Automation — Integrated LLM APIs, vector search, and automated background jobs into production applications.",
      "✅ Cloud Deployment & CI/CD — Deployed scalable services with automated CI/CD pipelines, containerization, and monitoring.",
      "✅ Testing & Reliability — Thorough unit and integration testing across client and server layers with error monitoring.",
      "🚀 Rapid Delivery & AI-Assisted Velocity — Top Rated on Upwork with 100% Job Success across 48+ projects; shipping full-stack products ~60% faster with Cursor.",
    ],
    standardBullets: [
      "✅ Full-Stack Architecture — Shipped scalable SaaS applications with React/Next.js frontends and Node.js/Python backends.",
      "✅ API & Database Systems — Built type-safe REST APIs and optimized PostgreSQL/MongoDB schemas with Redis caching.",
      "✅ Authentication & Reliability — Implemented secure authentication flows, background queues, and automated test suites.",
      "✅ Delivery Velocity — Top Rated on Upwork with 100% Job Success across 48+ projects delivering robust production code.",
    ],
  };
}

export function sanitizeProposalSkills(
  proposal: string,
  domain: string = "",
  jobText: string = ""
): string {
  let cleaned = proposal;
  const domainLower = domain.toLowerCase();
  const textLower = (jobText || "").toLowerCase();
  const isFlutter = domainLower === "flutter" || domainLower.includes("flutter");
  const isMobile = isFlutter || domainLower.includes("mobile") || domainLower === "ios" || domainLower === "android" || domainLower === "react-native";
  const jobMentionsDocker = textLower.includes("docker");
  const jobMentionsAws = textLower.includes("aws");
  const jobMentionsGcp = textLower.includes("gcp") || textLower.includes("google cloud");
  const jobMentionsNode = textLower.includes("node") || textLower.includes("express");
  const jobMentionsGo = textLower.includes("golang") || /\bgo\b/.test(textLower);

  // 1. Eradicate "claude testing" everywhere (case-insensitive)
  cleaned = cleaned.replace(/\bclaude\s+testing\b/gi, isFlutter ? "unit & widget testing" : "automated testing");
  cleaned = cleaned.replace(/\bClaude\s+Code\s+testing\b/gi, isFlutter ? "flutter_test automated testing" : "automated testing");

  // 2. If it's a Flutter job and the job does not explicitly mention backend/cloud tools:
  if (isFlutter) {
    if (!jobMentionsNode && !jobMentionsGo) {
      cleaned = cleaned.replace(
        /^[ \t]*✅[ \t]*(?:Full\s*Stack|Backend|SaaS).*?(?:Next\.js|React|Node|Go|Python).*$/gim,
        "✅ State Management & Clean Architecture — Production mastery of Bloc/Cubit, Riverpod, and Provider using Feature-First Clean Architecture, MVVM, and get_it dependency injection."
      );
    }
    if (!jobMentionsDocker && !jobMentionsAws && !jobMentionsGcp) {
      cleaned = cleaned.replace(
        /^[ \t]*✅[ \t]*(?:Cloud|Reliability|DevOps|Testing|Delivery).*?(?:Docker|AWS|GCP|Kubernetes).*$/gim,
        "✅ Testing, Profiling & App Store Publishing — Unit & widget testing with flutter_test, DevTools memory/rebuild profiling, and deployments via Apple TestFlight and Google Play Console."
      );
    }
    if (!jobMentionsDocker) {
      cleaned = cleaned.replace(/\b(?:with\s+)?Docker,?\s*(?:and\s+)?/gi, "");
    }
    if (!jobMentionsAws && !jobMentionsGcp) {
      cleaned = cleaned.replace(/\bAWS\s*(?:\/|\s*and\s*)\s*GCP,?\s*/gi, "");
      cleaned = cleaned.replace(/\b(?:AWS|GCP),?\s*/gi, "");
    }
  }

  // 3. Clean up multiple spaces or awkward commas left over
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ").replace(/\s*,\s*,/g, ",").replace(/\s*\.\s*\./g, ".");

  return cleaned;
}

export function normalizeAiFirstProposal(
  proposal: string,
  domain: string = "",
  jobUrl?: string,
  arrangement?: WorkArrangementInfo
): string {
  let cleaned = proposal;

  const isFlutter = domain.toLowerCase().includes("flutter");
  const isMobile =
    isFlutter ||
    domain.toLowerCase().includes("mobile") ||
    domain.toLowerCase().includes("ios") ||
    domain.toLowerCase().includes("android") ||
    domain.toLowerCase().includes("react native");

  const appLabel = isFlutter
    ? "Recent Flutter App — AI Influencer Generator"
    : isMobile
    ? "Recent Mobile App — AI Influencer Generator"
    : "Recent AI Platform — NicheTrafficKit";
  const videoUrl = "https://youtu.be/6m19rKN7i3I";
  const appUrlLine = isMobile
    ? "iOS App: https://apps.apple.com/us/app/id6759487099"
    : "Web App: https://nichetraffickit.com";
  const techLine = isFlutter
    ? "Built using Flutter & Dart, featuring clean architecture (Bloc/Riverpod), cross-platform state management, and real-time generation pipelines."
    : isMobile
    ? "Built using Flutter & mobile architecture, featuring AI avatar generation, image/video creation, and cross-platform integrations."
    : "Built using Next.js, React, Node.js, and Python AI, featuring automated SEO workflows and multi-agent content pipelines.";

  const targetDemoBlock = `🎥 ${appLabel}\nVideo Demo: ${videoUrl}\n${appUrlLine}\n${techLine}`;

  // If the model produced a multi-demo video list (e.g. 🎥 https://... \n🎥 https://...)
  const multiDemoRegex = /(?:🎥\s*https?:\/\/[^\n]+\n*){2,}/i;
  if (multiDemoRegex.test(cleaned)) {
    cleaned = cleaned.replace(multiDemoRegex, `${targetDemoBlock}\n\n`);
  } else if (!/Video\s*Demo:\s*https?:\/\//i.test(cleaned)) {
    const openingPart = cleaned.split(/(?:Your\s+posting:|I\s+bring\s+\d+)/i)[0];
    if (openingPart && /🎥/i.test(openingPart)) {
      cleaned = cleaned.replace(/🎥[^\n]*(?:\n\s*https?:\/\/[^\n]*|\n\s*Video[^\n]*|\n\s*iOS[^\n]*|\n\s*Built[^\n]*)*/i, targetDemoBlock);
    }
  }

  cleaned = cleaned
    .replace(/(?:^|\n)\s*(?:My\s+most\s+recent\s+[^\n]+?\s+(?:work|wrok|apps?)\s*[:–-]?\s*)(I bring \d+[\d,.]*\+?\s*years)/i, "\n\n$1")
    .replace(/(?:^|\n)[ \t]*(?:\*{0,2})(?:App\s*demo\s*videos?|Demo\s*videos?)[ \t]*:?[ \t]*(?:\*{0,2})[ \t]*\n*/gi, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

export function normalizeInlineDemoVideos(
  proposal: string,
  domain: string = "",
  extractedDemos: ExtractedDemoVideo[] = [],
  isAiFirst: boolean = false
): string {
  let cleaned = proposal;

  if (isAiFirst) {
    // For AI 1st, use normalizeAiFirstProposal to preserve the dedicated 1 Video Demo + 1 App URL block.
    return normalizeAiFirstProposal(cleaned, domain);
  }

  // 1. Detect if proposal has a standalone "App demo videos:" or "Demo videos:" block
  const demoSectionRegex = /(?:^|\n)[ \t]*(?:\*{0,2})(?:App\s*demo\s*videos?|Demo\s*videos?|App\s*demos?|Demo\s*video\s*links?|YouTube\s*demos?)[ \t]*:?[ \t]*(?:\*{0,2})\s*\n+([\s\S]*?)(?=(?:\n\s*\n\s*(?:(?:My\s+most\s+recent\s+[^\n]+?\s+(?:work|wrok|apps?)\s*[:–-]?\s*)?I\s+bring|How\s+my\s+experience|✅|Your\s+posting|Practical\s+Technical\s+Evaluation|Portfolio:|Best\s+regards|\n))|$)/i;

  const match = cleaned.match(demoSectionRegex);
  let demoLinksToHoist: string[] = [];

  if (match) {
    const blockContent = match[1];
    const blockLines = blockContent
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^🎥\s*/, ""))
      .filter((l) => /https?:\/\//i.test(l));

    if (blockLines.length > 0) {
      demoLinksToHoist = blockLines;
    }

    // Strip the standalone demo section from the proposal
    cleaned = cleaned.replace(match[0], "\n\n").replace(/\n{3,}/g, "\n\n");
  }

  // Check if opening already contains video link (in the text before "Your posting:" or "How my experience maps")
  const openingChunk = (cleaned.split(/How\s+my\s+experience\s+maps/i)[0] || "").split(/Your\s+posting:/i)[0] || "";
  const openingHasVideoLink = /(?:youtu\.be|youtube\.com|loom\.com)/i.test(openingChunk);

  // If no block was in proposal, but extractedDemos exist from profile, and opening does NOT have any video link:
  if (demoLinksToHoist.length === 0 && !openingHasVideoLink && extractedDemos.length > 0) {
    const hasAnyInProposal = extractedDemos.some((d) => cleaned.includes(d.url));
    if (!hasAnyInProposal) {
      demoLinksToHoist = extractedDemos.map((d) => d.fullInlineText);
    }
  }

  // If we have demo links to hoist and opening does NOT already have them inline:
  if (demoLinksToHoist.length > 0 && !openingHasVideoLink) {
    const domainLabel = domain ? `${domain.toLowerCase()} ` : "";
    const inlineVideosText = demoLinksToHoist.join(" ");
    const inlinePhrase = `My most recent ${domainLabel}app development ${inlineVideosText}`;

    // Target the opening sentence / question
    const lookingMatch = cleaned.match(/(Are you still looking for [^?\n]+\?)/i);
    if (lookingMatch) {
      cleaned = cleaned.replace(
        lookingMatch[0],
        `${lookingMatch[0]}  ${inlinePhrase}`
      );
    } else {
      const cameAcrossMatch = cleaned.match(/(I came across your posting for [^.\n]+\.)/i);
      if (cameAcrossMatch) {
        cleaned = cleaned.replace(
          cameAcrossMatch[0],
          `${cameAcrossMatch[0]}  ${inlinePhrase}.`
        );
      }
    }
  }

  // 2. Eradicate any accidental stray "My most recent flutter wrok I bring" before "I bring"
  cleaned = cleaned.replace(/(?:^|\n)\s*(?:My\s+most\s+recent\s+[^\n]+?\s+(?:work|wrok|apps?)\s*[:–-]?\s*)(I bring \d+[\d,.]*\+?\s*years)/i, "\n\n$1");

  // 3. Eradicate any leftover standalone "App demo videos:" header or empty labels
  cleaned = cleaned
    .replace(/(?:^|\n)[ \t]*(?:\*{0,2})(?:App\s*demo\s*videos?|Demo\s*videos?)[ \t]*:?[ \t]*(?:\*{0,2})[ \t]*\n*/gi, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

export async function generateProposal(
  profileContent: string,
  jobText: string,
  jobTitle?: string,
  jobUrl?: string,
  resumes?: ResumeOption[],
  authorName?: string,
  isRemote: boolean = true,
  isAiFirst: boolean = false,
): Promise<ProposalResult> {
  // Scrub social-count noise and extract true job title (never agency descriptors).
  const cleanTitle = cleanJobTitle(jobTitle, jobText);
  const cleanText = stripSocialCounts(jobText);
  const cleanUrl = (jobUrl || "").trim();
  const cleanAuthor = stripSocialCounts(authorName || "").trim();
  const arrangement = detectWorkArrangement(cleanTitle, cleanText, isRemote);
  const detectedDomain = detectJobDomain(cleanTitle, cleanText);
  const detectedDemos = extractDemoVideoLinks(profileContent);
  const domainDetails = getDomainDetails(detectedDomain, cleanTitle, cleanText);

  const systemPrompt = isAiFirst
    ? `You are a world-class technical copywriter and senior developer crafting an AI-First, hyper-targeted job application proposal with a Practical Technical Evaluation offer for recruiters and hiring managers.

YOUR OBJECTIVE:
Generate a high-converting, AI-First engineering application email following the production-tested AI 1st structure. It showcases AI-assisted engineering velocity with Claude Code and Cursor AI, features EXACTLY 1 project demo video + 1 live app URL, maps candidate's shipped products to the role's requirements with 8 comprehensive bullet points, and offers a Practical Technical Evaluation task.

PRIMARY DATA SOURCE — READ THIS FIRST (HIGHEST PRIORITY):
- The ONLY source of ALL candidate facts is the "CANDIDATE PROFILE & WORK HISTORY" block provided in the user message. There is NO hardcoded candidate data anywhere in these instructions. You MUST extract and use the candidate's REAL name, email, WhatsApp/phone, portfolio/GitHub/LinkedIn/Upwork links, years of experience, tech stack, projects, metrics, and social proof FROM THAT PROFILE.
- NEVER output any candidate value (name, email, phone, links, years, metrics, projects, social proof, skills) that is not present in the profile. Do NOT invent, assume, or reuse values from these instructions.

CRITICAL ROLE TITLE & WORK ARRANGEMENT RULES:
1. NEVER USE AN AGENCY OR COMPANY DESCRIPTOR IN THE OPENING QUESTION:
   - The opening question MUST ALWAYS name the actual engineering / developer position being hired (e.g., "Are you still hiring for the ${cleanTitle || domainDetails.roleTitle} position?").
2. WORK ARRANGEMENT & TIMEZONE ACCURACY:
   - If candidate wants remote: emphasize full [Company Timezone] overlap (e.g. ${formatTimezoneOverlap(arrangement.targetTimezone)}).
   - If candidate wants onsite: emphasize candidate is available to join the team onsite and start immediately.

PROVEN AI-FIRST PROPOSAL STRUCTURE (MANDATORY ORDER FOR AI 1ST):

1. SUBJECT LINE:
   ${isRemote ? (
     arrangement.isOnsiteOrHybrid
       ? `Subject: [Job Title] | Remote Availability | ${domainDetails.coreTech}`
       : `Subject: [Job Title] Application | ${domainDetails.coreTech} (${domainDetails.domainYears})`
   ) : `Subject: [Job Title] Application | ${domainDetails.coreTech} (${domainDetails.domainYears})`}

2. PERSONALIZED GREETING:
   - Format: "Hi [Author/Recruiter Name or Company Name] and team,"
   - If author name is provided, use their name (e.g., "Hi [Author Name] and team,").
   - If no author name is provided, use: "Hi [Company Name] and team," or "Hi Hiring Team,".

3. OPENING (AI-FIRST OPENING QUESTION & 0 DAYS' NOTICE):
   ${isRemote ? (
     arrangement.isOnsiteOrHybrid
       ? `"I came across your posting for the [Exact Job Title] position${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel || "onsite"}, but I wanted to ask if you would consider a remote contract arrangement for the right candidate.
I'm available to start immediately with 0 days' notice, open to remote contract work with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."`
       : `"Are you still hiring for the [Exact Job Title] position?
I'm available to start immediately with 0 days' notice, open to remote contract work with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."`
   ) : `"Are you still hiring for the [Exact Job Title] position${arrangement.location ? ` in ${arrangement.location}` : ""}?
I'm available to start immediately with 0 days' notice to join the team onsite and have long-term availability."`}

4. RECENT APP (EXACTLY 1 DEMO VIDEO + 1 APP URL):
   For AI 1st, feature EXACTLY ONE recent project featuring 1 demo video URL + 1 live app URL. Do NOT output multiple or all 5 videos:
   🎥 ${domainDetails.recentAppLabel}
   Video Demo: ${domainDetails.demoVideoUrl}
   ${domainDetails.recentAppType}
   ${domainDetails.recentAppTech}

5. POSTING REFERENCE:
   Your job posting:
   [Exact Job URL]

6. RELEVANT EXPERIENCE HOOK (DOMAIN SPECIALIZATION & PRODUCTION METRICS):
   ${domainDetails.experienceYearsHook}

7. HOW MY EXPERIENCE MATCHES YOUR REQUIREMENTS:
   - Header line: "How my experience matches your requirements:"
   - Format: Put an empty blank line after the header, and an empty blank line between EVERY bullet point.
   - Include 8 comprehensive matching bullets focused on ${domainDetails.domainLabel} and verified technical capabilities:
${domainDetails.aiFirstBullets.map((b) => `     ${b}`).join("\n\n")}

8. PRACTICAL TECHNICAL EVALUATION (MANDATORY IN AI 1ST MODE):
   Include this section formatted EXACTLY like this:
   Practical Technical Evaluation
   I believe real project delivery is one of the best ways to demonstrate engineering ability.
   I'm confident in my ability to understand requirements, research unfamiliar problems, and turn ideas into working applications quickly.
   I'd welcome a short, clearly scoped practical task in ${domainDetails.domainLabel} development using my normal AI-assisted development workflow with Claude Code and Cursor AI, so your team can evaluate my implementation quality, problem-solving skills, research approach, and delivery speed before committing to a long-term engagement.
   (CRITICAL: NEVER describe this as 'Claude testing'. It is a practical task completed with Claude Code and Cursor.)

9. CREDIBILITY & SOCIAL PROOF LINKS:
   Portfolio: [Portfolio link from profile, e.g. https://umerwaqas.pages.dev]
   ${domainDetails.resumeLabel}: ${domainDetails.resumeUrl}
   GitHub: [GitHub link from profile]
   LinkedIn: [LinkedIn link from profile]
   Upwork: [Upwork link from profile]

10. CALL TO ACTION:
   I'd be happy to discuss your project requirements and demonstrate how quickly I can contribute to your team.

11. PROFESSIONAL SIGN-OFF:
   Best regards,
   [Candidate Name]
   AI-First Full Stack & ${domainDetails.domainLabel} Developer
   Email: [Candidate Email]
   WhatsApp: [Candidate Phone]

CRITICAL DOMAIN RULES & STRICT EXCLUSIONS:
${domainDetails.requiredSkillsPrompt}

${domainDetails.strictExclusionsPrompt}

OUTPUT FORMAT:
Output EXACTLY two sections (or three sections if resumes are provided):
1. SUMMARY (LinkedIn Easy Apply Note — 250 characters HARD MAXIMUM)
2. PROPOSAL (The full proposal email following the AI-First structure above)
${resumes && resumes.length > 0 ? `\n3. RECOMMENDED_RESUME: [chosen resume filename or ID]` : ""}

Format your response exactly like this:
SUMMARY: [your 250-char max summary here]

PROPOSAL: [your full proposal email here]
${resumes && resumes.length > 0 ? `\nRECOMMENDED_RESUME: [chosen resume filename or ID]` : ""}`
    : `You are a world-class technical copywriter and senior developer crafting highly customized, high-converting direct job application / proposal emails for recruiters and hiring managers.

YOUR OBJECTIVE:
Generate an irresistible, hyper-targeted, high-converting application email following a proven, production-grade structure that immediately hooks the reader, references their posting, and maps the role's requirements to candidate's real shipped products with direct links and concrete engineering proof.

PRIMARY DATA SOURCE — READ THIS FIRST (HIGHEST PRIORITY):
- The ONLY source of ALL candidate facts is the "CANDIDATE PROFILE & WORK HISTORY" block provided in the user message. There is NO hardcoded candidate data anywhere in these instructions. You MUST extract and use the candidate's REAL name, email, WhatsApp/phone, portfolio/GitHub/LinkedIn/Upwork links, years of experience, tech stack, projects, metrics, and social proof FROM THAT PROFILE.
- NEVER output any candidate value (name, email, phone, links, years, metrics, projects, social proof, skills) that is not present in the profile. Do NOT invent, assume, or reuse values from these instructions.
- If the profile lists projects, select the 3-4 that best match this specific job — taken FROM THE PROFILE.
- EXPERIENCE YEARS (PER-DOMAIN): Read the candidate's years of experience PER DOMAIN from the profile. Use ${domainDetails.domainYears} for ${domainDetails.domainLabel}. NEVER generalize one domain's years to unrelated stacks.

CRITICAL ROLE TITLE & WORK ARRANGEMENT RULES:
1. NEVER USE AN AGENCY OR COMPANY DESCRIPTOR IN THE OPENING QUESTION:
   - The opening question MUST ALWAYS name the actual engineering / developer position being hired (e.g., "Are you still looking for a ${cleanTitle || domainDetails.roleTitle}?").
2. FRAMEWORK SEPARATION: Never conflate separate technologies (e.g., NEVER say "React Native (via Flutter)" or treat React Native and Flutter as interchangeable). React Native is JS/TS; Flutter is Dart; native Android is Kotlin; native iOS is Swift.
3. WORK ARRANGEMENT & TIMEZONE ACCURACY RULES:
   - WORK MODE PREFERENCE: Candidate selected ${isRemote ? "REMOTE APPLICATION (isRemote = true)" : "ONSITE / IN-OFFICE APPLICATION (isRemote = false)"}.
   ${isRemote ? `
   - CANDIDATE WANTS REMOTE (isRemote = true):
     * DYNAMIC TIMEZONE OVERLAP (ALWAYS MATCH CLIENT'S ACTUAL REGION):
       - If the job/company is in Pakistan (e.g. Rawalpindi, Saidpur Road, Islamabad, Lahore, Karachi, Peshawar):
         Emphasize "full Pakistan (PKT) timezone overlap" or local availability. NEVER mention US, US Pacific, Eastern, or any foreign timezone! If the candidate profile indicates Pakistan, state local availability using the profile's REAL details (including its WhatsApp/phone).
       - If the job/company is in India: emphasize "full India (IST) timezone overlap".
       - If the job/company is in the US: emphasize "full US [Eastern / Pacific / Central] timezone overlap".
       - If the job/company is in the UK: emphasize "full UK (GMT) timezone overlap".
       - If the job/company is in Europe: emphasize "full Europe (CET) timezone overlap".
       - If the job is global or location unspecified: emphasize "full timezone overlap with your team".
       - NEVER hallucinate or mention "US Pacific" or "US timezone" unless the posting explicitly specifies California or US Pacific!

     * IF THE JOB POSTING IS ONSITE OR HYBRID (e.g., in ${arrangement.location || "their office"}):
       - Subject Line: Subject: [Job Title] | Remote Availability | ${domainDetails.coreTech}
       - Opening:
         "I came across your posting for the [Exact Job Title] role${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel || "onsite"}, but I wanted to ask if you would consider a remote arrangement for the right candidate.

         I'm available to work remotely on a long-term contract basis with ${formatTimezoneOverlap(arrangement.targetTimezone)}, and can start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role."

     * IF THE JOB POSTING IS ALREADY REMOTE:
       - Subject Line: Subject: [Job Title] Application | ${domainDetails.coreTech} (${domainDetails.domainYears})
       - Opening:
         "Are you still looking for a [Exact Job Title]? I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."
   ` : `
   - CANDIDATE WANTS ONSITE / IN-OFFICE (isRemote = false, remote checkbox was UNCHECKED):
     * The candidate is applying directly for the ONSITE / IN-OFFICE position in ${arrangement.location || "the specified location"}!
     * DO NOT write "Remote Availability" in the subject line!
     * DO NOT ask if they consider remote arrangements!
     * DO NOT mention working remotely or contract basis!
     * Subject Line: Subject: [Job Title] Application | ${domainDetails.coreTech} (${domainDetails.domainYears})
     * Opening:
       "Are you still looking for an [Exact Job Title]? I came across your posting for the [Exact Job Title] role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately."
       (Candidate is locally available and ready to work in-person/onsite).
   `}
4. SHORT, TIGHT & RECRUITER-FRIENDLY (KEEP EMAIL SHORT):
   - Keep the entire email concise, tight, and easily scannable (around 180-230 words).
   - REDUCE SKILL DETAILS: Do not list endless frameworks or verbose multi-clause explanations. Keep each point focused on core capability and business outcome.
   - WORK & DEMO LINKS PLACEMENT RULES:
     * NO URLs inside the "How my experience maps to the role:" bullet points (mention project names only).
     * INLINE DEMO VIDEOS IN THE OPENING: If the candidate profile contains YouTube demo video links matching the role's stack (e.g. Flutter, mobile, AI), include them INLINE in the opening paragraph immediately after the opening question.
     * NEVER create a standalone "App demo videos:" section, block, or bullet list! Keep all demo links strictly inline in the opening paragraph. If no demo video links exist in the profile, omit them from the opening.
     * General portfolio, GitHub, LinkedIn, and Upwork links belong strictly in the footer credibility section.
   - Limit to 3 to 4 bullet points MAXIMUM, strictly 1 concise sentence per bullet.
5. AVOID CLAIMING "FINE-TUNING":
   - Do NOT claim model fine-tuning unless the posting explicitly requires it and candidate has verified fine-tuning experience.
   - Focus on the candidate's REAL specializations and technologies exactly as stated in the CANDIDATE PROFILE.
6. CLOUD PLATFORMS & BACKEND TOOLS:
   - ONLY mention AWS, Azure, GCP, or Docker if the job description EXPLICITLY requires them.
   - For mobile / Flutter / iOS / Android roles: NEVER mention AWS, GCP, Docker, or Kubernetes unless explicitly requested in the posting!
7. DEFENSIBLE, CREDIBLE METRICS: Use ONLY metrics, numbers, and percentages that appear in the CANDIDATE PROFILE and that hold up in technical interviews.
8. NO PLACEHOLDERS OR MARKDOWN LINKS: Write 100% in clean plain text. Never use markdown bold asterisks (**bold**). Never use bracketed links [text](url) — always write URLs directly. Never output bracketed placeholders like [Company] or [Hiring Manager].

PROVEN HIGH-CONVERTING PROPOSAL STRUCTURE (MANDATORY ORDER):

1. SUBJECT LINE:
   ${isRemote ? (
     arrangement.isOnsiteOrHybrid
       ? `Subject: [Job Title] | Remote Availability | ${domainDetails.coreTech}`
       : `Subject: [Job Title] Application | ${domainDetails.coreTech} (${domainDetails.domainYears})`
   ) : `
   Subject: [Job Title] Application | ${domainDetails.coreTech} (${domainDetails.domainYears})`}

2. PERSONALIZED GREETING:
   - Format: "Hi [Author/Recruiter Name or Company Name] and team,"
   - If author name is provided, use their name (e.g., "Hi [Author Name] and team,").
   - If no author name is provided, use: "Hi [Company Name] and team," or "Hi Hiring Team,".

3. OPENING (WITH INLINE DEMO VIDEO LINKS IF PRESENT IN PROFILE):
   - If the CANDIDATE PROFILE contains YouTube or video demo links matching the role's stack, place them INLINE in the opening sentence right after the opening question:
     "My most recent ${domainDetails.domainLabel.toLowerCase()} app development [URL1] ([Project 1 Name] — [Platform/Tech]) [URL2] ([Project 2 Name] — [Platform/Tech])."
   - CRITICAL: NEVER create a separate "App demo videos:" section, block, or bullet list! Keep all demo links strictly inline in the opening paragraph.

4. POSTING REFERENCE:
   - If a posting URL is provided, include it on its own lines:
     Your posting:
     [Exact Job URL]
   - Immediately follow "Your posting:\n[Exact Job URL]" with Section 5 (RELEVANT EXPERIENCE HOOK). NEVER insert an "App demo videos:" section or video links here!

5. RELEVANT EXPERIENCE HOOK:
   - BEGIN this paragraph with:
     "I bring 11+ years of software engineering experience, including ${domainDetails.domainYears} specializing in ${domainDetails.coreTech}."
   - Keep to 1-2 tight sentences using the candidate's REAL years and stack.

6. PROJECT-TO-ROLE MAPPING ("How my experience maps to the role:"):
   - Header line: "How my experience maps to the role:"
   - Format: Put an empty blank line after the header, and an empty blank line between EVERY bullet point.
   - Feature 4 targeted, punchy bullets tailored to ${domainDetails.domainLabel} and the job requirements:
${domainDetails.standardBullets.map((b) => `     ${b}`).join("\n\n")}

7. CREDIBILITY & SOCIAL PROOF (ONLY PLACE FOR WORK LINKS):
   - State the candidate's REAL social proof, years of experience, and project count EXACTLY as given in the CANDIDATE PROFILE.
   - Direct proof links (Portfolio, GitHub, LinkedIn, Upwork).

8. TECHNICAL INTERVIEW CALL-TO-ACTION:
   - Tailor the CTA to the actual projects and stack named in the CANDIDATE PROFILE.

9. PROFESSIONAL SIGN-OFF:
   - Best regards,
     [Candidate Name]
     [Candidate Email]
     WhatsApp: [Candidate Phone]

DOMAIN SPECIFIC REQUIREMENTS & EXCLUSIONS:
${domainDetails.requiredSkillsPrompt}

${domainDetails.strictExclusionsPrompt}

${resumes && resumes.length > 0 ? `
10. RESUME RECOMMENDATION:
- When candidate resumes are provided, select the best matching resume for the job stack.
- Output the chosen resume filename or ID under RECOMMENDED_RESUME.` : ""}

OUTPUT FORMAT:
Output EXACTLY two sections (or three sections if resumes are provided):

1. SUMMARY (LinkedIn Easy Apply Note — 250 characters HARD MAXIMUM):
   - Opens with: "Are you still looking for a [Exact Job Title]? I'm available for it."
   - Followed by 1 short sentence on stack fit: "${domainDetails.domainYears} building production ${domainDetails.coreTech}."
   - Followed by the candidate's portfolio link EXACTLY as given in the CANDIDATE PROFILE.
   - Hard maximum 250 characters total including portfolio link.

2. PROPOSAL: The full proposal email exactly following the structure above.
${resumes && resumes.length > 0 ? `\n3. RECOMMENDED_RESUME: [chosen resume filename or ID]` : ""}

Format your response exactly like this:
SUMMARY: [your 250-char max summary here]

PROPOSAL: [your full proposal email here]
${resumes && resumes.length > 0 ? `\nRECOMMENDED_RESUME: [chosen resume filename or ID]` : ""}`;

  let resumesPromptSection = "";
  if (resumes && resumes.length > 0) {
    const listText = resumes.map((r, i) => `  ${i + 1}. Filename: "${r.filename}" (ID: ${r.id})`).join("\n");
    resumesPromptSection = `\n\nAVAILABLE CANDIDATE RESUMES:\n${listText}\n\nSelect the best matching resume file from the list above for this specific job posting, and specify it under RECOMMENDED_RESUME.`;
  }

  let demosInstruction = "";
  if (detectedDemos.length > 0) {
    if (isAiFirst) {
      demosInstruction = `\n- CANDIDATE RECENT APP (EXACTLY 1 DEMO VIDEO + 1 APP URL):
For AI 1st mode, feature EXACTLY 1 demo video URL + 1 live app URL. Do NOT list multiple or all 5 videos.
Use this format immediately under the opening question:
🎥 ${domainDetails.recentAppLabel}
Video Demo: ${domainDetails.demoVideoUrl}
${domainDetails.recentAppType}
${domainDetails.recentAppTech}`;
    } else {
      const demosInlineSample = detectedDemos.map((d) => d.fullInlineText).join(" ");
      demosInstruction = `\n- CANDIDATE DEMO VIDEOS (MUST BE INLINE IN THE OPENING PARAGRAPH):
The profile contains candidate demo video link(s):
${detectedDemos.map((d) => `  * ${d.fullInlineText}`).join("\n")}
If relevant to this role (${domainDetails.domainLabel || "application"}), place them INLINE directly in the opening paragraph:
"Are you still looking for a ${cleanTitle || domainDetails.roleTitle}? My most recent ${domainDetails.domainLabel ? `${domainDetails.domainLabel.toLowerCase()} ` : ""}app development ${demosInlineSample} I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."
CRITICAL: NEVER create a separate "App demo videos:" section! Keep demo links strictly inline in the opening paragraph.`;
    }
  }

  const userPrompt = `CANDIDATE PROFILE & WORK HISTORY (THE ONLY SOURCE — there is NO hardcoded candidate data. Use ONLY these real values for name, contact, links, experience per domain, projects, metrics, skills and social proof):
${profileContent}${resumesPromptSection}

JOB POSTING:
${cleanTitle ? `Title: ${cleanTitle}\n` : ""}${cleanAuthor ? `Author / Contact Name: ${cleanAuthor}\n` : ""}${cleanUrl ? `URL: ${cleanUrl}\n` : ""}
Work Arrangement Detected: ${arrangement.isOnsiteOrHybrid ? `${arrangement.arrangementLabel.toUpperCase()} in ${arrangement.location || "Office"} (Timezone: ${arrangement.targetTimezone})` : `REMOTE (Timezone: ${arrangement.targetTimezone})`}
Description / Requirements:
${cleanText}

Generate a personalized application email in 100% pure plain text following the system instructions.
${isAiFirst ? `
- TEMPLATE MODE: AI 1ST IS ACTIVE (CRITICAL REQUIREMENTS):
- In the opening, use: "Are you still hiring for the ${cleanTitle || domainDetails.roleTitle} position? I'm available to start immediately with 0 days' notice, open to remote contract work with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."
- Feature EXACTLY 1 DEMO VIDEO + 1 APP URL under "🎥 ${domainDetails.recentAppLabel}" (Video Demo: ${domainDetails.demoVideoUrl}, ${domainDetails.recentAppType}, ${domainDetails.recentAppTech}). DO NOT output multiple or all 5 videos.
- Include the posting URL under "Your job posting:\n${cleanUrl || "[Job URL]"}"
- Include the domain-specific experience hook:
${domainDetails.experienceYearsHook}
- Header: "How my experience matches your requirements:"
- Include 8 matching bullets tailored to ${domainDetails.domainLabel} (from system instructions), 🚀 Rapid Development & Problem Solving (MVPs in under 5 days), ⚡ AI-First Development (~60% delivery time reduction with daily Claude Code and Cursor AI), and 🏆 Proven Delivery Experience (Top Rated on Upwork with 100% Job Success across 48+ projects).
- Include the exact "Practical Technical Evaluation" section offering a short, clearly scoped practical task in ${domainDetails.domainLabel} development with Claude Code and Cursor AI. NEVER call it 'Claude testing'.
- In the links section, include Portfolio (https://umerwaqas.pages.dev), ${domainDetails.resumeLabel} (${domainDetails.resumeUrl}), GitHub, LinkedIn, and Upwork.
- CTA: "I'd be happy to discuss your project requirements and demonstrate how quickly I can contribute to your team."
- Sign-off: "Best regards,\n[Candidate Name]\nAI-First Full Stack & ${domainDetails.domainLabel} Developer\nEmail: [Candidate Email]\nWhatsApp: [Candidate Phone]"
- DOMAIN REQUIREMENTS:
${domainDetails.requiredSkillsPrompt}
${domainDetails.strictExclusionsPrompt}
` : `
- KEEP THE EMAIL SHORT (around 180-230 words) and easily scannable.
- BEGIN the relevant-experience paragraph with: "I bring 11+ years of software engineering experience, including ${domainDetails.domainYears} specializing in ${domainDetails.coreTech}."
- REDUCE SKILL DETAILS: Avoid long multi-clause explanations or excessive keyword stuffing.
- DO NOT INCLUDE WORK/PROJECT LINKS IN THE BULLET POINTS: Mention project names only. Keep all URLs strictly in the footer links.
- DOMAIN REQUIREMENTS:
${domainDetails.requiredSkillsPrompt}
${domainDetails.strictExclusionsPrompt}
`}
${demosInstruction}
${!isAiFirst ? (
  isRemote ? (
    arrangement.isOnsiteOrHybrid ? `
- CANDIDATE PREFERS REMOTE: The posting is ${arrangement.arrangementLabel} in ${arrangement.location || "the office"}.
- Subject: ${cleanTitle || domainDetails.roleTitle} | Remote Availability | ${domainDetails.coreTech}
- Greet the recruiter: "Hi ${cleanAuthor ? cleanAuthor + " and team," : "[Company/Recruiter] and team,"}"
- Opening: Acknowledge the posting in ${arrangement.location || "the office"} is listed as ${arrangement.arrangementLabel}, ask politely if they would consider remote for the right candidate.
- State candidate is available to work remotely on a long-term contract basis with ${formatTimezoneOverlap(arrangement.targetTimezone)} and immediate start.
- Add: "If the team is open to remote candidates, I'd be very interested in discussing the role."
- Then state: "My experience closely matches the position across ${domainDetails.coreTech}."
` : `
 - The posting is Remote.
- Subject: ${cleanTitle || domainDetails.roleTitle} Application | ${domainDetails.coreTech} (${domainDetails.domainYears})
- Opening: "Are you still looking for a ${cleanTitle || domainDetails.roleTitle}? ${detectedDemos.length > 0 ? `My most recent ${domainDetails.domainLabel ? `${domainDetails.domainLabel.toLowerCase()} ` : ""}app development ${detectedDemos.map((d) => d.fullInlineText).join(" ")} ` : ""}I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."
- Hook (1-2 sentences max): "I bring 11+ years of software engineering experience, including ${domainDetails.domainYears} specializing in ${domainDetails.coreTech}..."
`
  ) : `
- CANDIDATE WANTS ONSITE / IN-OFFICE APPLICATION (Remote checkbox was UNCHECKED):
- Candidate is applying directly for the ONSITE / IN-OFFICE position in ${arrangement.location || "the office"}!
- DO NOT write "Remote Availability" in the subject line!
- Subject: ${cleanTitle || domainDetails.roleTitle} Application | ${domainDetails.coreTech} (${domainDetails.domainYears})
- Greet the recruiter: "Hi ${cleanAuthor ? cleanAuthor + " and team," : "[Company/Recruiter] and team,"}"
- Opening: "Are you still looking for a ${cleanTitle || domainDetails.roleTitle}? ${detectedDemos.length > 0 ? `My most recent ${domainDetails.domainLabel ? `${domainDetails.domainLabel.toLowerCase()} ` : ""}app development ${detectedDemos.map((d) => d.fullInlineText).join(" ")} ` : ""}I came across your posting for the ${cleanTitle || domainDetails.roleTitle} role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately."
- DO NOT ask if they consider remote. DO NOT mention working remotely or contract basis. Candidate is available to work onsite in person!
- Hook: Highlight immediate onsite availability and matching production experience across ${domainDetails.coreTech}.
`
) : ""}
- AVOID claiming model fine-tuning unless explicitly required.
- If the job explicitly mentions AWS, Azure, or GCP, name that specific cloud platform. Otherwise DO NOT mention cloud or containerization for mobile roles.
- Include posting URL under "Your posting:\n${cleanUrl}"
- NEVER create an "App demo videos:" section below the posting URL.
- Proof & Links (footer only): Use the candidate's REAL social proof and links EXACTLY as given in the CANDIDATE PROFILE (Upwork rating/JSS/project count, Portfolio, GitHub, LinkedIn, Upwork).
- CTA: Walk through architecture/code in an interview.
- Sign-off: Use the candidate's REAL name, email, and WhatsApp FROM THE PROFILE.
- SUMMARY: <=250-char LinkedIn note opening with "Are you still looking for a ${cleanTitle || domainDetails.roleTitle}? I'm available for it.", then a stack-fit sentence: "${domainDetails.domainYears} building production ${domainDetails.coreTech}.", then the candidate's portfolio link EXACTLY as given in the CANDIDATE PROFILE.
- CRITICAL: There is NO hardcoded candidate data. Every candidate fact (name, email, WhatsApp, portfolio/GitHub/LinkedIn/Upwork links, years of experience per domain, selected projects, metrics, social proof, skills) MUST be taken EXACTLY from the CANDIDATE PROFILE above.
Pure plain text only. No markdown asterisks (**bold**), no markdown link brackets [text](url).${resumes && resumes.length > 0 ? ` Output RECOMMENDED_RESUME with best matching resume filename or ID.` : ""}`;

  const payload = {
    model: getModel(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: getMaxTokens(),
  };

  const maxAttempts = getRetries() + 1;
  let rawContent = "";
  let lastError: UpstreamError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callOpenRouter(payload);
      const content = extractMessageContent(result);
      if (!content) {
        const emptyErr: UpstreamError = new Error(
          "Model returned no usable content (reasoning-only or truncated output)",
        );
        emptyErr.retryable = true;
        throw emptyErr;
      }
      rawContent = content;
      break;
    } catch (err) {
      lastError = err as UpstreamError;
      const status = lastError.status;
      const retryable =
        lastError.retryable === true ||
        status === undefined || // network / abort errors
        RETRYABLE_STATUS.has(status) ||
        lastError.name === "AbortError";
      const isLastAttempt = attempt >= maxAttempts;

      if (!retryable || isLastAttempt) {
        throw lastError;
      }

      const retryAfterSec = parseFloat(lastError.retryAfter || "");
      const backoffMs = Number.isFinite(retryAfterSec)
        ? retryAfterSec * 1000
        : Math.min(8000, 700 * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 300);
      console.warn(
        `[proposal] attempt ${attempt}/${maxAttempts} failed` +
          `${status ? ` (HTTP ${status})` : ""}: ${lastError.message}. ` +
          `Retrying in ${Math.round(backoffMs + jitterMs)}ms…`,
      );
      await sleep(backoffMs + jitterMs);
    }
  }

  if (!rawContent) {
    throw new Error(lastError?.message || "No response content generated by OpenRouter API");
  }

  // Sanitize and ensure pure plain text email output
  const cleaned = cleanMarkdownToPlainText(rawContent);

  // Parse SUMMARY and PROPOSAL sections (match anywhere in case model prepended preamble)
  const summaryMatch = cleaned.match(/SUMMARY:\s*([\s\S]*?)(?=\n\s*\n\s*PROPOSAL:|$)/i);
  const proposalMatch = cleaned.match(/PROPOSAL:\s*([\s\S]*?)$/i);

  let summary = summaryMatch ? summaryMatch[1].trim() : "";
  let proposal = proposalMatch ? proposalMatch[1].trim() : cleaned;

  // Fallback: if no SUMMARY/PROPOSAL markers, use first 250 chars as summary
  if (!summaryMatch) {
    summary = cleaned.substring(0, 250).trim();
    if (summary.length === cleaned.length) {
      summary = cleaned;
    }
  }

  // Ensure summary (LinkedIn note) is max 250 chars WITHOUT chopping the
  // portfolio URL in half. Prefer keeping the URL intact and trimming prose.
  if (summary.length > 250) {
    const urlMatch = summary.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const url = urlMatch[0];
      // "Portfolio: " prefix + URL is the tail we must preserve.
      const label = "Portfolio: ";
      const tail = label + url;
      if (tail.length <= 250) {
        let head = summary.slice(0, summary.indexOf(url)).trim();
        // Drop a leading "Portfolio:" fragment if the model already wrote it.
        head = head.replace(/(?:portfolio\s*:?\s*)$/i, "").trim();
        const room = 250 - tail.length - 1;
        if (head.length > room) {
          head = head.slice(0, Math.max(0, room)).trim();
        }
        summary = head ? `${head} ${tail}` : tail;
      } else {
        summary = tail.slice(0, 250);
      }
    } else {
      summary = summary.substring(0, 247) + "...";
    }
  }

  // Parse RECOMMENDED_RESUME / RECOMMENDEDRESUME section across raw and cleaned outputs
  const resumeMatch =
    rawContent.match(/(?:RECOMMENDED[_\s-]*RESUME|SELECTED[_\s-]*RESUME|RESUME[_\s-]*RECOMMENDATION|RECOMMENDED_PDF|ATTACHED_RESUME)\s*[:=]\s*([^\n\r]+)/i) ||
    cleaned.match(/(?:RECOMMENDED[_\s-]*RESUME|SELECTED[_\s-]*RESUME|RESUME[_\s-]*RECOMMENDATION|RECOMMENDED_PDF|ATTACHED_RESUME)\s*[:=]\s*([^\n\r]+)/i) ||
    rawContent.match(/\b(?:RECOMMENDEDRESUME|SELECTEDRESUME)\s*[:=]\s*([^\n\r]+)/i) ||
    cleaned.match(/\b(?:RECOMMENDEDRESUME|SELECTEDRESUME)\s*[:=]\s*([^\n\r]+)/i);

  let recommendedResumeId: string | undefined;
  let recommendedResumeFilename: string | undefined;

  if (resumes && resumes.length > 0) {
    if (resumeMatch) {
      const picked = resumeMatch[1]
        .trim()
        .replace(/^[0-9]+[.\-:\s]+/, "")
        .replace(/^["'\[(]+|[)"'\]]+$/g, "")
        .trim();
      const pickedAlpha = picked.replace(/[^a-z0-9]/gi, "").toLowerCase();

      // 1. Match by exact ID or alphanumeric normalized ID
      const idMatch = resumes.find(
        (r) =>
          r.id.toLowerCase() === picked.toLowerCase() ||
          (pickedAlpha.length >= 4 && (pickedAlpha.includes(r.id.replace(/[^a-z0-9]/gi, "").toLowerCase()) ||
          r.id.replace(/[^a-z0-9]/gi, "").toLowerCase().includes(pickedAlpha)))
      );
      if (idMatch) {
        recommendedResumeId = idMatch.id;
        recommendedResumeFilename = idMatch.filename;
      }

      // 2. Match by exact or normalized filename
      if (!recommendedResumeId) {
        const fnMatch = resumes.find((r) => {
          const rAlpha = r.filename.replace(/[^a-z0-9]/gi, "").toLowerCase();
          const rNoExt = r.filename.toLowerCase().replace(/\.[^/.]+$/, "");
          const rNoExtAlpha = rNoExt.replace(/[^a-z0-9]/gi, "").toLowerCase();
          return (
            r.filename.toLowerCase() === picked.toLowerCase() ||
            rNoExt === picked.toLowerCase() ||
            (pickedAlpha.length >= 4 && (pickedAlpha.includes(rAlpha) || rAlpha.includes(pickedAlpha) || pickedAlpha.includes(rNoExtAlpha) || rNoExtAlpha.includes(pickedAlpha)))
          );
        });
        if (fnMatch) {
          recommendedResumeId = fnMatch.id;
          recommendedResumeFilename = fnMatch.filename;
        }
      }
    }

    // 3. Fallback: intelligent keyword relevance matching based on job title & requirements
    if (!recommendedResumeId) {
      const fallback = matchBestResumeForJob(resumes, cleanTitle, cleanText);
      if (fallback) {
        recommendedResumeId = fallback.id;
        recommendedResumeFilename = fallback.filename;
      }
    }
  }

  // Post-process inline demo videos & eradicate any standalone "App demo videos:" block
  proposal = normalizeInlineDemoVideos(proposal, detectedDomain, detectedDemos, isAiFirst);

  // Strip unwanted skills and eradicate 'claude testing' or off-domain tech bleed
  proposal = sanitizeProposalSkills(proposal, detectedDomain, cleanText);
  summary = sanitizeProposalSkills(summary, detectedDomain, cleanText);

  // Strip ALL variations of RECOMMENDED_RESUME lines completely so they never leak into the email
  proposal = proposal
    .replace(/(?:\r?\n|^)\s*(?:\*{0,2})(?:RECOMMENDED[_\s-]*RESUME|SELECTED[_\s-]*RESUME|RESUME[_\s-]*RECOMMENDED|RESUME[_\s-]*RECOMMENDATION|RECOMMENDED_PDF|ATTACHED_RESUME|RECOMMENDEDRESUME|SELECTEDRESUME)\s*[:=]?\s*[^\n\r]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  summary = summary
    .replace(/(?:\r?\n|^)\s*(?:\*{0,2})(?:RECOMMENDED[_\s-]*RESUME|SELECTED[_\s-]*RESUME|RESUME[_\s-]*RECOMMENDED|RESUME[_\s-]*RECOMMENDATION|RECOMMENDED_PDF|ATTACHED_RESUME|RECOMMENDEDRESUME|SELECTEDRESUME)\s*[:=]?\s*[^\n\r]*/gi, "")
    .trim();

  if (!proposal || proposal.trim().length < 50) {
    throw new Error("Model returned an empty or incomplete proposal");
  }

  return { summary, proposal, recommendedResumeId, recommendedResumeFilename };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIChatRequest {
  messages: ChatMessage[];
  profileContent?: string;
  appliedJobsSummary?: string;
  currentSearchQuery?: string;
  systemPromptOverride?: string;
}

export interface AIChatResponse {
  message: string;
}

/**
 * Multi-turn AI Chat Assistant powered by candidate's profile, tracked applications, and live job context.
 */
export async function chatWithAI(request: AIChatRequest): Promise<AIChatResponse> {
  const profile = request.profileContent?.trim() || "";
  const appliedJobs = request.appliedJobsSummary?.trim() || "";
  const currentQuery = request.currentSearchQuery?.trim() || "";

  const defaultSystemPrompt = `You are a world-class AI Career Copilot, Senior Engineering Consultant, and Freelance Strategist for the candidate.

CANDIDATE PROFILE & WORK HISTORY:
${profile || "(No candidate profile text loaded)"}

${appliedJobs ? `CANDIDATE'S CURRENT APPLIED JOBS & TRACKED APPLICATIONS:\n${appliedJobs}\n` : ""}
${currentQuery ? `ACTIVE SEARCH / TECH DOMAIN: "${currentQuery}"\n` : ""}

YOUR ROLE & CAPABILITIES:
1. HELP WITH ANY TASK: You can assist the candidate with:
   - Writing custom, persuasive pitches, LinkedIn DMs, or WhatsApp intro messages for specific job posts or recruiters.
   - Drafting personalized follow-up emails for applied jobs.
   - Analyzing their applied jobs list to recommend high-priority follow-ups or strategy adjustments.
   - Tailoring resume bullet points or tech stack explanations (e.g. Flutter, React Native, React, Next.js, Django, AWS, Node.js, AI/RAG).
   - Technical interview prep, system design outlines, coding guidance, and client negotiation tactics.
   - General career advice, portfolio feedback, and proposal strategy.
2. CONTEXT-AWARE & GROUNDED: Directly reference the candidate's actual projects, years of experience, stack, and portfolio links from their profile. Never invent fake links or wildly inaccurate claims.
3. CLEAR FORMATTING: Use clean markdown with headings, bold text, bullet points, and code blocks with language tags when showing code or pitch templates.
4. TONE: Confident, strategic, high-energy, concise, and ultra-practical. Give direct answers immediately without fluff.`;

  const systemMessage: ChatMessage = {
    role: "system",
    content: request.systemPromptOverride || defaultSystemPrompt,
  };

  const thread = [systemMessage, ...request.messages.filter((m) => m.role !== "system")];

  const payload = {
    model: getModel(),
    messages: thread,
    temperature: 0.7,
    max_tokens: getMaxTokens(),
  };

  const maxAttempts = getRetries() + 1;
  let rawContent = "";
  let lastError: UpstreamError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callOpenRouter(payload);
      const content = extractMessageContent(result);
      if (!content) {
        const emptyErr: UpstreamError = new Error(
          "Model returned no usable content (reasoning-only or truncated output)",
        );
        emptyErr.retryable = true;
        throw emptyErr;
      }
      rawContent = content;
      break;
    } catch (err) {
      lastError = err as UpstreamError;
      const status = lastError.status;
      const retryable =
        lastError.retryable === true ||
        status === undefined ||
        RETRYABLE_STATUS.has(status) ||
        lastError.name === "AbortError";
      const isLastAttempt = attempt >= maxAttempts;

      if (!retryable || isLastAttempt) {
        throw lastError;
      }

      const retryAfterSec = parseFloat(lastError.retryAfter || "");
      const backoffMs = Number.isFinite(retryAfterSec)
        ? retryAfterSec * 1000
        : Math.min(8000, 700 * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 300);
      console.warn(
        `[ai-chat] attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${Math.round(backoffMs + jitterMs)}ms…`,
      );
      await sleep(backoffMs + jitterMs);
    }
  }

  if (!rawContent) {
    throw new Error(lastError?.message || "No response generated by AI API");
  }

  return { message: rawContent.trim() };
}

export interface VoiceCopilotRequest {
  question: string;
  jobTitle?: string;
  company?: string;
  focusTopics?: string;
  selectedSkills?: string;
  profileContent?: string;
  conciseMode?: boolean;
  memory?: Array<{ question: string; answer: string }>;
}

export interface VoiceCopilotResponse {
  answer: string;
}

function cleanSpeechRepetitions(rawText: string): string {
  if (!rawText) return "";
  let text = rawText.trim().replace(/\s+/g, " ");

  // 1. Remove duplicate adjacent sentences / questions
  const sentences = text.split(/(?<=[.?!])\s+/);
  if (sentences.length > 1) {
    const deduped: string[] = [];
    for (const s of sentences) {
      const sTrim = s.trim();
      if (!sTrim) continue;
      const norm = sTrim.toLowerCase().replace(/[^a-z0-9]/g, "");
      const prevNorm =
        deduped.length > 0
          ? deduped[deduped.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "")
          : "";
      if (norm !== prevNorm) {
        deduped.push(sTrim);
      }
    }
    text = deduped.join(" ");
  }

  // 2. Token-level repetition removal (e.g. repeated n-grams or whole question repeated K times)
  let words = text.split(" ");
  if (words.length >= 2) {
    const n = words.length;

    for (let k = 2; k <= 5; k++) {
      if (n >= k && n % k === 0) {
        const segLen = n / k;
        const firstSeg = words.slice(0, segLen).join(" ").toLowerCase();
        let allMatch = true;
        for (let j = 1; j < k; j++) {
          const seg = words.slice(j * segLen, (j + 1) * segLen).join(" ").toLowerCase();
          if (seg !== firstSeg) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          words = words.slice(0, segLen);
          break;
        }
      }
    }

    // 3. Remove adjacent identical phrases
    for (let len = Math.min(Math.floor(words.length / 2), 10); len >= 1; len--) {
      for (let i = 0; i <= words.length - 2 * len; i++) {
        const p1 = words.slice(i, i + len).join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
        const p2 = words.slice(i + len, i + 2 * len).join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (p1 === p2 && (len >= 2 || (p1.length > 3 && p1 !== "that" && p1 !== "had"))) {
          words.splice(i + len, len);
          i--;
        }
      }
    }

    text = words.join(" ");
  }

  return text.trim();
}

/**
 * Silent Live Interview Teleprompter Assistant.
 * Generates simple, high-impact 2-4 line answers for the candidate to glance at and speak out loud.
 */
export async function generateVoiceCopilotAnswer(
  request: VoiceCopilotRequest,
): Promise<VoiceCopilotResponse> {
  const rawQ = request.question?.trim();
  if (!rawQ) {
    throw new Error("No question provided");
  }
  const question = cleanSpeechRepetitions(rawQ);

  const profile = request.profileContent?.trim() || "";
  const jobTitle = request.jobTitle?.trim() || "Software Engineer";
  const company = request.company?.trim() || "Target Client / Company";
  const selectedSkills =
    (request.selectedSkills || request.focusTopics || "").trim() ||
    "Full-Stack Software Engineering";

  const systemPrompt = `You are the candidate in a live technical job interview speaking directly to the interviewer.
You are generating high-impact teleprompter bullet points to glance at and speak aloud immediately.

CANDIDATE PROFILE (Use ONLY the experience and projects that match "${selectedSkills}"):
${profile || "(Senior Software Engineer)"}

TARGET ROLE: ${jobTitle} | COMPANY: ${company}
PRIORITIZED SKILL: "${selectedSkills}"

CRITICAL MANDATORY RULES:
1. STRICT SKILL ISOLATION & EXCLUSIVITY (ZERO TOLERANCE FOR OTHER TECHNOLOGIES):
   - You MUST answer the question strictly and exclusively within "${selectedSkills}".
   - The entire answer MUST ONLY be related to "${selectedSkills}".
   - NEVER mention, compare, or reference any other framework, library, or language outside of "${selectedSkills}".
     * If "${selectedSkills}" is Flutter: ONLY use Flutter/Dart (e.g. Riverpod, Bloc, Provider, Isolates). NEVER mention React, Redux, Next.js, or Python.
     * If "${selectedSkills}" is React / Next.js: ONLY use React/Next.js/TypeScript (e.g. Server Components, Zustand, Context, hooks). NEVER mention Flutter, Dart, Riverpod, or Python.
     * If "${selectedSkills}" is Python & AI: ONLY use Python/FastAPI/Celery/LangChain/LLMs. NEVER mention React, Flutter, or C#.
     * If "${selectedSkills}" is .NET / C#: ONLY use C#/ASP.NET Core/EF Core.
     * If "${selectedSkills}" is SQL & Databases: ONLY use PostgreSQL, indexing, transactions, and database branching.
   - Even if the interviewer asks a general or conceptual question (e.g. "How do you handle state?", "How do you optimize performance?", "How do you test?"), answer it 100% ONLY in the context of "${selectedSkills}".

2. SPEAK IN FIRST PERSON AS THE CANDIDATE:
   - Speak directly to the interviewer: "I use...", "In my production apps, I implement...".
   - Ground the answer in your actual profile projects and accomplishments matching "${selectedSkills}".
   - NEVER output meta thoughts, reflections, or reasoning like "The user wants...", "Candidate should...", or "Here is...".

3. INDEPENDENT LATEST QUESTION (NO HISTORY):
   - Answer this specific question fresh. Do not rely on, assume, or refer to any past interview turns.

4. TELEPROMPTER FORMAT:
   - EXACTLY 2 OR 3 BULLET POINTS: Maximum 3 bullets. Total words under 45.
   - NO HEADINGS OR LABELS: Start immediately with "• ".
   - BOLD 1 KEY TECHNICAL PHRASE PER BULLET: E.g., "• I use **Riverpod StateNotifier** to separate UI from business logic with immutable states."
   - NO FLUFF: Answer the core question directly in the first bullet point.`;

  const userPrompt = `Interview Question: "${question}"

Speak as the candidate. Answer in 2 or 3 short bullet points strictly and ONLY using ${selectedSkills}:`;

  const payload = {
    model: getModel(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 180,
  };

  const maxAttempts = getRetries() + 1;
  let rawContent = "";
  let lastError: UpstreamError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callOpenRouter(payload);
      const content = extractMessageContent(result);
      if (!content) {
        const emptyErr: UpstreamError = new Error(
          "Model returned no usable content for voice copilot",
        );
        emptyErr.retryable = true;
        throw emptyErr;
      }
      rawContent = content;
      break;
    } catch (err) {
      lastError = err as UpstreamError;
      const status = lastError.status;
      const retryable =
        lastError.retryable === true ||
        status === undefined ||
        RETRYABLE_STATUS.has(status) ||
        lastError.name === "AbortError";
      const isLastAttempt = attempt >= maxAttempts;

      if (!retryable || isLastAttempt) {
        throw lastError;
      }

      const retryAfterSec = parseFloat(lastError.retryAfter || "");
      const backoffMs = Number.isFinite(retryAfterSec)
        ? retryAfterSec * 1000
        : Math.min(6000, 500 * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 200);
      console.warn(
        `[voice-copilot] attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${Math.round(backoffMs + jitterMs)}ms…`,
      );
      await sleep(backoffMs + jitterMs);
    }
  }

  if (!rawContent) {
    throw new Error(lastError?.message || "No response generated by AI API");
  }

  // Strictly extract spoken bullet points only (strips out any model chit-chat, meta-commentary, or labels)
  const isMetaLine = (line: string) => {
    const clean = line.replace(/^[•\-*\d.]+\s*/, "").trim();
    return /^(?:the user|the candidate|here (?:is|are)|as an?|i should|i need to|let me|note:|in this answer)/i.test(
      clean,
    );
  };

  const rawLines = rawContent
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isMetaLine(l));

  const bulletLines = rawLines.filter(
    (l) => l.startsWith("•") || l.startsWith("-") || l.startsWith("*") || /^\d+\./.test(l),
  );

  let cleaned = "";
  if (bulletLines.length > 0) {
    cleaned = bulletLines
      .slice(0, 3)
      .map((l) => l.replace(/^[-*]\s*/, "• "))
      .join("\n");
  } else {
    cleaned = rawLines
      .slice(0, 2)
      .map((l) => (l.startsWith("•") ? l : `• ${l}`))
      .join("\n");
  }

  return { answer: cleaned.trim() };
}


