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

  // 8. Ensure an empty blank newline after "How my experience maps to the role:" header
  cleaned = cleaned.replace(/(how (?:my )?experience maps to the role:?)\n(?!\n)/gi, "$1\n\n");

  // 9. Format mapping section bullets: ensure each item starts with "✅ " and has an empty blank line between every item
  const mappingSectionRegex = /(how (?:my )?experience maps to the role:?\s*\n+)([\s\S]*?)(\n\s*(?:Practical Technical Evaluation:|I'm Upwork|Upwork Top Rated|Portfolio:|GitHub:|LinkedIn:|I'd be happy|Best regards))/i;
  const mappingMatch = cleaned.match(mappingSectionRegex);
  if (mappingMatch) {
    const header = mappingMatch[1].trimEnd();
    const rawBody = mappingMatch[2];
    const footer = mappingMatch[3].trimStart();
    const items = rawBody.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const formatted = items.map((it) => {
      const stripped = it.replace(/^(?:[-•*]|✅)\s*/, "").trim();
      return `✅ ${stripped}`;
    });
    const newSection = header + "\n\n" + formatted.join("\n\n") + "\n\n" + footer;
    cleaned = cleaned.replace(mappingMatch[0], newSection);
  }

  // 10. Ensure any consecutive bullet points have an empty blank line between them
  cleaned = cleaned.replace(/\n((?:[-•*]|✅)\s+[^\n]+)\n((?:[-•*]|✅)\s+)/g, "\n$1\n\n$2");
  cleaned = cleaned.replace(/\n((?:[-•*]|✅)\s+[^\n]+)\n((?:[-•*]|✅)\s+)/g, "\n$1\n\n$2");

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

export function detectJobDomain(title?: string, text?: string): string {
  const combined = `${title || ""} ${text || ""}`.toLowerCase();
  if (combined.includes("flutter")) return "flutter";
  if (combined.includes("react native") || combined.includes("react-native")) return "React Native";
  if (combined.includes("ios") || combined.includes("swift")) return "iOS";
  if (combined.includes("android") || combined.includes("kotlin")) return "Android";
  if (combined.includes("mobile")) return "mobile";
  if (combined.includes("ai") || combined.includes("llm") || combined.includes("rag") || combined.includes("agent") || combined.includes("machine learning")) return "AI";
  if (combined.includes("python")) return "Python";
  if (combined.includes("react") || combined.includes("next.js") || combined.includes("nextjs") || combined.includes("frontend")) return "frontend";
  if (combined.includes("node") || combined.includes("backend") || combined.includes("express") || combined.includes("nest")) return "backend";
  return "";
}

export function normalizeInlineDemoVideos(
  proposal: string,
  domain: string = "",
  extractedDemos: ExtractedDemoVideo[] = [],
  isAiFirst: boolean = false
): string {
  let cleaned = proposal;

  // 1. Detect if proposal has a standalone "App demo videos:" or "Demo videos:" block
  const demoSectionRegex = /(?:^|\n)[ \t]*(?:\*{0,2})(?:App\s*demo\s*videos?|Demo\s*videos?|Video\s*demos?|App\s*demos?|Demo\s*video\s*links?|YouTube\s*demos?)[ \t]*:?[ \t]*(?:\*{0,2})\s*\n+([\s\S]*?)(?=(?:\n\s*\n\s*(?:(?:My\s+most\s+recent\s+[^\n]+?\s+(?:work|wrok|apps?)\s*[:–-]?\s*)?I\s+bring|How\s+my\s+experience|✅|Your\s+posting|Practical\s+Technical\s+Evaluation|Portfolio:|Best\s+regards|\n))|$)/i;

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
    let inlinePhrase = "";
    if (isAiFirst) {
      const formattedLines = demoLinksToHoist.map((l) => `🎥 ${l}`).join("\n");
      inlinePhrase = `My most recent ${domain ? `${domain} ` : ""}app development work:\n${formattedLines}`;
    } else {
      const inlineVideosText = demoLinksToHoist.join(" ");
      inlinePhrase = `My most recent ${domainLabel}app development ${inlineVideosText}`;
    }

    // Target the opening sentence / question
    const lookingMatch = cleaned.match(/(Are you still looking for [^?\n]+\?)/i);
    if (lookingMatch) {
      if (isAiFirst) {
        cleaned = cleaned.replace(
          lookingMatch[0],
          `${lookingMatch[0]} ${inlinePhrase}\n`
        );
      } else {
        cleaned = cleaned.replace(
          lookingMatch[0],
          `${lookingMatch[0]}  ${inlinePhrase}`
        );
      }
    } else {
      const cameAcrossMatch = cleaned.match(/(I came across your posting for [^.\n]+\.)/i);
      if (cameAcrossMatch) {
        if (isAiFirst) {
          cleaned = cleaned.replace(
            cameAcrossMatch[0],
            `${cameAcrossMatch[0]}\n${inlinePhrase}\n`
          );
        } else {
          cleaned = cleaned.replace(
            cameAcrossMatch[0],
            `${cameAcrossMatch[0]}  ${inlinePhrase}.`
          );
        }
      }
    }
  }

  // 2. Eradicate any accidental stray "My most recent flutter wrok I bring" before "I bring"
  cleaned = cleaned.replace(/(?:^|\n)\s*(?:My\s+most\s+recent\s+[^\n]+?\s+(?:work|wrok|apps?)\s*[:–-]?\s*)(I bring \d+[\d,.]*\+?\s*years)/i, "\n\n$1");

  // 3. Eradicate any leftover standalone "App demo videos:" header or empty labels
  cleaned = cleaned
    .replace(/(?:^|\n)[ \t]*(?:\*{0,2})(?:App\s*demo\s*videos?|Demo\s*videos?|Video\s*demos?)[ \t]*:?[ \t]*(?:\*{0,2})[ \t]*\n*/gi, "\n\n")
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

  const systemPrompt = isAiFirst
    ? `You are a world-class technical copywriter and senior developer crafting an AI-First, hyper-targeted job application proposal with a Practical Technical Evaluation offer for recruiters and hiring managers.

YOUR OBJECTIVE:
Generate a high-converting, AI-First engineering application email following the production-tested AI 1st structure. It showcases AI-assisted engineering velocity with Claude Code and Cursor AI, features project demo videos with 🎥 emojis, maps candidate's shipped products to the role's requirements, and offers a Practical Technical Evaluation task.

PRIMARY DATA SOURCE — READ THIS FIRST (HIGHEST PRIORITY):
- The ONLY source of ALL candidate facts is the "CANDIDATE PROFILE & WORK HISTORY" block provided in the user message. There is NO hardcoded candidate data anywhere in these instructions. You MUST extract and use the candidate's REAL name, email, WhatsApp/phone, portfolio/GitHub/LinkedIn/Upwork links, years of experience, tech stack, projects, metrics, and social proof FROM THAT PROFILE.
- NEVER output any candidate value (name, email, phone, links, years, metrics, projects, social proof, skills) that is not present in the profile. Do NOT invent, assume, or reuse values from these instructions.

CRITICAL ROLE TITLE & WORK ARRANGEMENT RULES:
1. NEVER USE AN AGENCY OR COMPANY DESCRIPTOR IN THE OPENING QUESTION:
   - The opening question MUST ALWAYS name the actual engineering / developer position being hired (e.g., "Are you still looking for a Flutter Developer?").
2. WORK ARRANGEMENT & TIMEZONE ACCURACY:
   - If candidate wants remote: emphasize full [Company Timezone] overlap (e.g. ${formatTimezoneOverlap(arrangement.targetTimezone)}).
   - If candidate wants onsite: emphasize candidate is available to join the team onsite and start immediately.

PROVEN AI-FIRST PROPOSAL STRUCTURE (MANDATORY ORDER):

1. SUBJECT LINE:
   ${isRemote ? (
     arrangement.isOnsiteOrHybrid
       ? `Subject: [Job Title] | Remote Availability | [Core Tech 1] & [Core Tech 2]`
       : `Subject: [Job Title] Application | [Core Tech 1] & [Core Tech 2] ([years for THIS job's domain from profile])`
   ) : `Subject: [Job Title] Application | [Core Tech 1] & [Core Tech 2] ([years for THIS job's domain from profile])`}

2. PERSONALIZED GREETING:
   - Format: "Hi [Author/Recruiter Name or Company Name] and team,"
   - If author name is provided, use their name (e.g., "Hi [Author Name] and team,").
   - If no author name is provided, use: "Hi [Company Name] and team," or "Hi Hiring Team,".

3. OPENING (AI-FIRST WITH 🎥 DEMO VIDEO LINKS):
   ${isRemote ? (
     arrangement.isOnsiteOrHybrid
       ? `"I came across your posting for the [Exact Job Title] role${arrangement.location ? ` in ${arrangement.location}` : ""}. My most recent [Stack] app development work:
[If profile has demo links, each with 🎥 emoji on its own line:
🎥 [Demo Link 1] ([Project 1 Name] — [Platform/Tech])
🎥 [Demo Link 2] ([Project 2 Name] — [Platform/Tech])]
I noticed the position is listed as ${arrangement.arrangementLabel || "onsite"}, but I wanted to ask if you would consider a remote arrangement for the right candidate. I'm available to work remotely on a long-term contract basis with ${formatTimezoneOverlap(arrangement.targetTimezone)}, and can start immediately."`
       : `"Are you still looking for a [Exact Job Title]? My most recent [Stack] app development work:
[If profile has demo links, each with 🎥 emoji on its own line:
🎥 [Demo Link 1] ([Project 1 Name] — [Platform/Tech])
🎥 [Demo Link 2] ([Project 2 Name] — [Platform/Tech])]
I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."`
   ) : `"Are you still looking for an [Exact Job Title]? My most recent [Stack] app development work:
[If profile has demo links, each with 🎥 emoji on its own line:
🎥 [Demo Link 1] ([Project 1 Name] — [Platform/Tech])
🎥 [Demo Link 2] ([Project 2 Name] — [Platform/Tech])]
I came across your posting for the [Exact Job Title] role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately."`}
   - If the candidate profile has no demo video links, omit the "My most recent..." and 🎥 lines, keeping the rest of the opening.

4. POSTING REFERENCE:
   Your posting:
   [Exact Job URL]

5. RELEVANT EXPERIENCE HOOK (MULTI-DOMAIN YEARS & AI-FIRST POSITIONING):
   - First paragraph:
     "I bring [TOTAL years from PROFILE]+ years of software engineering experience, including [ROLE DOMAIN years from PROFILE]+ years specializing in [domain specialization for THIS role, taken from PROFILE], [FULL-STACK SaaS years from PROFILE]+ years building full-stack SaaS applications, and [AI/automation years from PROFILE]+ years working with AI, RAG, and automation."
   - Second paragraph:
     "I've built 100+ Android and iOS apps, with 22+ published across both stores. I specialize in AI-first development using Claude Code and Cursor AI to deliver production-ready applications efficiently."

6. HOW MY EXPERIENCE MAPS TO THE ROLE:
   - Header line: "How my experience maps to the role:"
   - Format: Put an empty blank line after the header, and an empty blank line between EVERY bullet point.
   - Every bullet item MUST begin with the checkmark emoji "✅ ":
     ✅ [Core Role Tech / Framework, e.g. Flutter & Dart cross-platform development] — Built and delivered production iOS and Android applications, including [Projects from profile, e.g. Zeely AI Marketing Platform, Flibbo AI Video/Image/Music, and AI Influencer Generator].

     ✅ [APIs, Firebase & Integrations] — [Project details, e.g. AI Influencer Generator: complete Flutter, web, iOS, and Android product with authentication, subscriptions, payment integrations, and AI generation pipelines].

     ✅ Full Stack & Backend Development — 7+ years working with Next.js, React, Node.js, Python/FastAPI, Go, PostgreSQL, and Firebase to build scalable SaaS platforms and mobile backends.

     ✅ AI/LLM Integration & Automation — Developed AI-powered applications, RAG systems, autonomous agents, image/video generation workflows, and intelligent automation solutions.

     ✅ AI-First Development & AI-Assisted Coding — I use Claude Code and Cursor AI daily for coding, debugging, refactoring, architecture, API integrations, and rapid product development. My AI-assisted workflows have helped reduce delivery time by approximately 60%.

     ✅ Android & iOS Publishing — Built 100+ mobile applications, with 22+ published, including DocReady Pro, VisageID, PhotoFix AI, and AI Influencer Generator.

     ✅ Top Rated Upwork Freelancer — 100% Job Success across 48+ projects, delivering mobile apps, SaaS platforms, AI solutions, and business automation.

7. PRACTICAL TECHNICAL EVALUATION (MANDATORY IN AI 1ST MODE):
   Include this section formatted EXACTLY like this:
   Practical Technical Evaluation:
   I specialize in AI-assisted software development and believe real project delivery is the best way to demonstrate my capabilities.
   I'm happy to complete a short, clearly scoped practical task using my normal AI coding workflow with Claude Code and Cursor AI. This allows your team to evaluate my implementation quality, problem-solving ability, and delivery speed before making a long-term commitment.

8. CREDIBILITY & SOCIAL PROOF LINKS:
   Portfolio: [Portfolio link from profile, e.g. https://umerwaqas.pages.dev]
   [Stack-specific Resume, e.g. Flutter Resume: https://umerwaqas.lovable.app?resume=3 or https://umerwaqas.pages.dev?resume=3]
   GitHub: [GitHub link from profile]
   LinkedIn: [LinkedIn link from profile]
   Upwork: [Upwork link from profile]

9. TECHNICAL INTERVIEW CALL-TO-ACTION:
   "Happy to walk through the [role stack] architecture, state management, and release pipeline behind any of these apps in an interview."

10. PROFESSIONAL SIGN-OFF:
   Best regards,
   [Candidate Name]
   [Candidate Email]
   WhatsApp: [Candidate Phone]

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
- EXPERIENCE YEARS (PER-DOMAIN): Read the candidate's years of experience PER DOMAIN from the profile. If the profile gives different figures for different domains (e.g. AI/RAG, full-stack SaaS, Flutter/mobile), use ONLY the figure that matches THIS job's domain(s). NEVER generalize one domain's years to unrelated stacks. If the profile's summary states a blanket number that conflicts with its per-domain lines, prefer the per-domain numbers.

CRITICAL ROLE TITLE & WORK ARRANGEMENT RULES:
1. NEVER USE AN AGENCY OR COMPANY DESCRIPTOR IN THE OPENING QUESTION:
   - NEVER write "Are you still looking for a Recruitment Company?" or "Are you still looking for a Staffing Agency?".
   - The opening question MUST ALWAYS name the actual engineering / developer position being hired (e.g., "Are you still looking for a Senior Mobile Developer?").
   - If the job title was labeled with an agency/recruiting firm descriptor or is generic, extract the actual candidate position from the posting.
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
       - Subject Line: Subject: [Job Title] | Remote Availability | [Core Tech 1] & [Core Tech 2]
       - Opening:
         "I came across your posting for the [Exact Job Title] role${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel || "onsite"}, but I wanted to ask if you would consider a remote arrangement for the right candidate.

         I'm available to work remotely on a long-term contract basis with ${formatTimezoneOverlap(arrangement.targetTimezone)}, and can start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role."

     * IF THE JOB POSTING IS ALREADY REMOTE:
       - Subject Line: Subject: [Job Title] Application | [Core Tech 1] & [Core Tech 2] ([years for THIS job's domain from the profile])
       - Opening:
         "Are you still looking for a [Exact Job Title]? I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."
   ` : `
   - CANDIDATE WANTS ONSITE / IN-OFFICE (isRemote = false, remote checkbox was UNCHECKED):
     * The candidate is applying directly for the ONSITE / IN-OFFICE position in ${arrangement.location || "the specified location"}!
     * DO NOT write "Remote Availability" in the subject line!
     * DO NOT ask if they consider remote arrangements!
     * DO NOT mention working remotely or contract basis!
     * Subject Line: Subject: [Job Title] Application | [Core Tech 1] & [Core Tech 2] ([years for THIS job's domain from the profile])
     * Opening:
       "Are you still looking for an [Exact Job Title]? I came across your posting for the [Exact Job Title] role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately."
       (Candidate is locally available and ready to work in-person/onsite).
   `}
4. SHORT, TIGHT & RECRUITER-FRIENDLY (KEEP EMAIL SHORT):
   - Keep the entire email concise, tight, and easily scannable (around 180-230 words).
   - REDUCE SKILL DETAILS: Do not list endless frameworks or verbose multi-clause explanations. Keep each point focused on core capability and business outcome.
   - WORK & DEMO LINKS PLACEMENT RULES:
     * NO URLs inside the "How my experience maps to the role:" bullet points (mention project names only).
     * INLINE DEMO VIDEOS IN THE OPENING: If the candidate profile contains YouTube demo video links (or app video demos) matching the role's stack (e.g. Flutter, mobile, AI), include them INLINE in the opening paragraph immediately after the opening question (e.g., "Are you still looking for a [Role]? My most recent [stack] app development [YouTube URL 1] ([Project 1] — [Details]) [YouTube URL 2] ([Project 2] — [Details]). I'm available to start immediately...").
     * NEVER create a standalone "App demo videos:" section, block, or bullet list! Keep all demo links strictly inline in the opening paragraph. If no demo video links exist in the profile, omit them from the opening.
     * General portfolio, GitHub, LinkedIn, and Upwork links belong strictly in the footer credibility section.
   - Limit to 3 to 4 bullet points MAXIMUM, strictly 1 concise sentence per bullet.
5. AVOID CLAIMING "FINE-TUNING":
   - Do NOT claim model fine-tuning unless the posting explicitly requires it and candidate has verified fine-tuning experience.
   - Focus on the candidate's REAL specializations and technologies exactly as stated in the CANDIDATE PROFILE.
6. CLOUD PLATFORMS:
   - If the job specifically mentions AWS, Azure, or GCP, name that exact cloud platform (e.g., AWS, Azure, or GCP with Docker, CI/CD, and production deployment) rather than using vague "cloud-native" terms.
7. DEFENSIBLE, CREDIBLE METRICS: Use ONLY metrics, numbers, and percentages that appear in the CANDIDATE PROFILE and that hold up in technical interviews. If the profile states no metric for a point, describe the outcome qualitatively instead of inventing a number.
8. NO PLACEHOLDERS OR MARKDOWN LINKS: Write 100% in clean plain text. Never use markdown bold asterisks (**bold**). Never use bracketed links [text](url) — always write URLs directly. Never output bracketed placeholders like [Company] or [Hiring Manager].

PROVEN HIGH-CONVERTING PROPOSAL STRUCTURE (MANDATORY ORDER):

1. SUBJECT LINE:
   ${isRemote ? (
     arrangement.isOnsiteOrHybrid
       ? `Subject: [Job Title] | Remote Availability | [Core Tech 1] & [Core Tech 2]
          Example: Subject: AI Engineer – Generative AI | Remote Availability | Python & RAG`
       : `Subject: [Job Title] Application | [Core Tech 1] & [Core Tech 2] ([years for THIS job's domain from the profile])`
   ) : `
   Subject: [Job Title] Application | [Core Tech 1] & [Core Tech 2] ([years for THIS job's domain from the profile])`}

2. PERSONALIZED GREETING:
   - Format: "Hi [Author/Recruiter Name or Company Name] and team,"
   - If author name is provided, use their name (e.g., "Hi [Author Name] and team,").
   - If no author name is provided, use: "Hi [Company Name] and team," or "Hi Hiring Team,".

3. OPENING (WITH INLINE DEMO VIDEO LINKS IF PRESENT IN PROFILE):
   - If the CANDIDATE PROFILE contains YouTube or video demo links (e.g. youtu.be, youtube.com) matching the role's stack (e.g. Flutter/mobile apps or AI), place them INLINE in the opening sentence right after the opening question:
     "My most recent [stack/domain] app development [URL1] ([Project 1 Name] — [Platform/Tech]) [URL2] ([Project 2 Name] — [Platform/Tech])."
   - EXAMPLES:
   ${isRemote ? (
     arrangement.isOnsiteOrHybrid
       ? `* Remote candidate applying for onsite/hybrid posting:
          "I came across your posting for the [Exact Job Title] role${arrangement.location ? ` in ${arrangement.location}` : ""}. [If profile has matching demo links: My most recent [stack] app development [YouTube URL 1] ([Project 1]) [YouTube URL 2] ([Project 2]).] I noticed the position is listed as ${arrangement.arrangementLabel || "onsite"}, but I wanted to ask if you would consider a remote arrangement for the right candidate.

          I'm available to work remotely on a long-term contract basis with ${formatTimezoneOverlap(arrangement.targetTimezone)}, and can start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role.

          My experience closely matches the position across [core matching stack from posting]."`
       : `* Remote role with inline demo links:
          "Are you still looking for a [Exact Job Title]? My most recent [core tech] app development [YouTube Link 1] ([Project 1] — [Details]) [YouTube Link 2] ([Project 2] — [Details]). I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."
          * Remote role without demo links in profile:
          "Are you still looking for a [Exact Job Title]? I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."`
   ) : `* Direct Onsite role (candidate wants onsite):
       "Are you still looking for an [Exact Job Title]? [If profile has matching demo links: My most recent [stack] app development [YouTube URL 1] ([Project 1]) [YouTube URL 2] ([Project 2]).] I came across your posting for the [Exact Job Title] role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately.

       My experience closely matches the position across [core matching stack from posting]."`}
   - CRITICAL: NEVER create a separate "App demo videos:" section, block, or bullet list! Keep all demo links strictly inline in the opening paragraph.

4. POSTING REFERENCE:
   - If a posting URL is provided, include it on its own lines:
     Your posting:
     [Exact Job URL]
   - Immediately follow "Your posting:\n[Exact Job URL]" with Section 5 (RELEVANT EXPERIENCE HOOK). NEVER insert an "App demo videos:" section or video links here!

5. RELEVANT EXPERIENCE HOOK:
   - BEGIN this paragraph with a professional positioning sentence in EXACTLY this shape:
     "I bring [TOTAL years of software engineering from the PROFILE]+ years of software engineering experience, including [SPECIALIZATION years from the PROFILE]+ years specializing in [core specializations for THIS role, taken from the PROFILE]."
     Shape example only — DO NOT hardcode these numbers or words: "I bring X+ years of software engineering experience, including Y+ years specializing in production AI systems, LLMs, RAG, autonomous agents, and scalable SaaS architecture."
   - Then keep to 1-2 tight sentences using the candidate's REAL years and stack FROM THE PROFILE.
   - Derive BOTH the total-years and specialization-years figures PER DOMAIN from the CANDIDATE PROFILE. Never invent, assume, or hardcode a number.

6. PROJECT-TO-ROLE MAPPING ("How my experience maps to the role:"):
   - Header line: "How my experience maps to the role:"
   - Format: Put an empty blank line after the header, and an empty blank line between EVERY bullet point.
   - Every bullet item MUST begin with the checkmark emoji "✅ " (NO URLs inside the bullets):

     How my experience maps to the role:

     ✅ [Skill / Focus 1] — [Project]: [1 concise sentence with measurable impact].

     ✅ [Skill / Focus 2] — [Project]: [1 concise sentence with measurable impact].

     ✅ [Skill / Focus 3] — [Project]: [1 concise sentence with measurable impact].

     ✅ [Skill / Focus 4]: [1 concise sentence on testing, cloud, and delivery].

7. CREDIBILITY & SOCIAL PROOF (ONLY PLACE FOR WORK LINKS):
   - State the candidate's REAL social proof, years of experience, and project count EXACTLY as given in the CANDIDATE PROFILE (e.g., the profile's Upwork rating, Job Success score, and project count).
   - Follow immediately with the candidate's direct proof links (Portfolio, GitHub, LinkedIn, Upwork) EXACTLY as given in the CANDIDATE PROFILE. Do NOT invent or substitute any URL.

8. TECHNICAL INTERVIEW CALL-TO-ACTION:
   - Tailor the CTA to the actual projects and stack named in the CANDIDATE PROFILE.
   - FORMAT EXAMPLES ONLY (adapt to the profile): for AI / Agentic roles reference the candidate's real agentic/RAG/tool-calling work; for Mobile roles reference their real mobile architecture, state management, and stack.

9. PROFESSIONAL SIGN-OFF:
   - Use the candidate's REAL name, email, and phone/WhatsApp FROM THE PROFILE. FORMAT EXAMPLE ONLY (substitute the profile's actual values):
     Best regards,
     [Candidate Name]
     [Candidate Email]
     WhatsApp: [Candidate Phone]

CRITICAL FORMATTING & CONTENT RULES:
- Write strictly in 100% PLAIN TEXT.
- Keep the email SHORT and punchy (180-230 words).
- DEMO VIDEO LINKS MUST BE INLINE IN OPENING: Any YouTube or video demo links from the profile MUST be placed inline in the opening paragraph (e.g. "Are you still looking for a [Role]? My most recent [stack] app development [Link 1] ([Project 1] — [Details]) [Link 2] ([Project 2] — [Details]). I'm available..."). NEVER create a standalone "App demo videos:" section anywhere in the proposal!
- DO NOT put work/project URLs in the bullet points. Only name the project and keep all URLs in the footer portfolio/social proof links section.
- NEVER use markdown bold asterisks (do NOT write **bold** or *italic*).
- NEVER use markdown link syntax (do NOT write [Text](url)). Write raw URLs directly.
- The candidate's portfolio link (from the CANDIDATE PROFILE) MUST always be included in the social proof links section.
- NEVER output bracketed placeholders. Extract or synthesize real values.

${resumes && resumes.length > 0 ? `
10. RESUME RECOMMENDATION:
- When candidate resumes are provided, select the best matching resume for the job stack.
- Output the chosen resume filename or ID under RECOMMENDED_RESUME.` : ""}

OUTPUT FORMAT:
Output EXACTLY two sections (or three sections if resumes are provided):

1. SUMMARY (LinkedIn Easy Apply Note — 250 characters HARD MAXIMUM):
   - Opens with: "Are you still looking for a [Exact Job Title]? I'm available for it."
   - Followed by 1 short sentence on stack fit using the candidate's REAL experience and core tech FROM THE PROFILE: "[profile years] building production [core tech]."
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
      const formattedLines = detectedDemos.map((d) => `🎥 ${d.fullInlineText}`).join("\n");
      demosInstruction = `\n- CANDIDATE DEMO VIDEOS (AI 1ST FORMAT WITH 🎥 EMOJI):
The profile contains candidate demo video link(s):
${detectedDemos.map((d) => `  * ${d.fullInlineText}`).join("\n")}
Include them under "My most recent ${detectedDomain ? `${detectedDomain} ` : ""}app development work:" with 🎥 emoji per video on its own line:
My most recent ${detectedDomain ? `${detectedDomain} ` : ""}app development work:
${formattedLines}`;
    } else {
      const demosInlineSample = detectedDemos.map((d) => d.fullInlineText).join(" ");
      demosInstruction = `\n- CANDIDATE DEMO VIDEOS (MUST BE INLINE IN THE OPENING PARAGRAPH):
The profile contains candidate demo video link(s):
${detectedDemos.map((d) => `  * ${d.fullInlineText}`).join("\n")}
If relevant to this role (${detectedDomain || "application"}), place them INLINE directly in the opening paragraph:
"Are you still looking for a ${cleanTitle || "Developer"}? My most recent ${detectedDomain ? `${detectedDomain} ` : ""}app development ${demosInlineSample} I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."
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
- TEMPLATE MODE: AI-FIRST TECHNICAL EVALUATION TEMPLATE IS ACTIVE.
- Include the multi-domain experience hook (total years, specialization years, full-stack SaaS years, and AI/automation years).
- Include the AI-First positioning paragraph with Claude Code and Cursor AI.
- Include the 7 matching bullets (including the AI-First Development & AI-Assisted Coding bullet highlighting daily use of Claude Code and Cursor AI and ~60% delivery time reduction).
- Include the "Practical Technical Evaluation:" section offering a short, clearly scoped practical task with Claude Code and Cursor AI.
- In the links section, include the stack-specific resume link (e.g. Flutter Resume: https://umerwaqas.lovable.app?resume=3 or https://umerwaqas.pages.dev?resume=3) alongside Portfolio, GitHub, LinkedIn, and Upwork.
` : `
- KEEP THE EMAIL SHORT (around 180-230 words) and easily scannable.
- BEGIN the relevant-experience paragraph with: "I bring [total years of software engineering from the profile]+ years of software engineering experience, including [specialization years from the profile]+ years specializing in [core specializations from the profile]." Both figures and the specializations MUST come from the CANDIDATE PROFILE — never hardcode them.
- REDUCE SKILL DETAILS: Avoid long multi-clause explanations or excessive keyword stuffing.
- DO NOT INCLUDE WORK/PROJECT LINKS IN THE BULLET POINTS: Mention project names only. Keep all URLs strictly in the footer links.
`}
${demosInstruction}
${isRemote ? (
  arrangement.isOnsiteOrHybrid ? `
- CANDIDATE PREFERS REMOTE: The posting is ${arrangement.arrangementLabel} in ${arrangement.location || "the office"}.
- Subject: ${cleanTitle || "Senior Developer"} | Remote Availability | [Core Tech 1] & [Core Tech 2]
- Greet the recruiter: "Hi ${cleanAuthor ? cleanAuthor + " and team," : "[Company/Recruiter] and team,"}"
- Opening: Acknowledge the posting in ${arrangement.location || "the office"} is listed as ${arrangement.arrangementLabel}, ask politely if they would consider remote for the right candidate.
- State candidate is available to work remotely on a long-term contract basis with ${formatTimezoneOverlap(arrangement.targetTimezone)} and immediate start.
- Add: "If the team is open to remote candidates, I'd be very interested in discussing the role."
- Then state: "My experience closely matches the position across [core matching skills]."
` : `
 - The posting is Remote.
- Subject: ${cleanTitle || "Senior Developer"} Application | [Core Tech 1] & [Core Tech 2] ([profile years for this domain])
- Opening: "Are you still looking for a ${cleanTitle || "Senior Developer"}? ${!isAiFirst && detectedDemos.length > 0 ? `My most recent ${detectedDomain ? `${detectedDomain} ` : ""}app development ${detectedDemos.map((d) => d.fullInlineText).join(" ")} ` : ""}I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlap(arrangement.targetTimezone)} and long-term availability."
- Hook (1-2 sentences max): use the profile's REAL years and matching stack, e.g. "I have [profile years] of experience building production software across [core matching stack]..."
`
) : `
- CANDIDATE WANTS ONSITE / IN-OFFICE APPLICATION (Remote checkbox was UNCHECKED):
- Candidate is applying directly for the ONSITE / IN-OFFICE position in ${arrangement.location || "the office"}!
- DO NOT write "Remote Availability" in the subject line!
- Subject: ${cleanTitle || "Senior Developer"} Application | [Core Tech 1] & [Core Tech 2] ([profile years for this domain])
- Greet the recruiter: "Hi ${cleanAuthor ? cleanAuthor + " and team," : "[Company/Recruiter] and team,"}"
- Opening: "Are you still looking for a ${cleanTitle || "Senior Developer"}? ${!isAiFirst && detectedDemos.length > 0 ? `My most recent ${detectedDomain ? `${detectedDomain} ` : ""}app development ${detectedDemos.map((d) => d.fullInlineText).join(" ")} ` : ""}I came across your posting for the ${cleanTitle || "Senior Developer"} role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately."
- DO NOT ask if they consider remote. DO NOT mention working remotely or contract basis. Candidate is available to work onsite in person!
- Hook: Highlight immediate onsite availability and matching production experience across [core matching skills].
`}
- AVOID claiming model fine-tuning. Focus on the candidate's REAL specializations and technologies exactly as stated in the CANDIDATE PROFILE.
- If the job explicitly mentions AWS, Azure, or GCP, name that specific cloud platform.
- Include posting URL under "Your posting:\n${cleanUrl}"
- NEVER create an "App demo videos:" section below the posting URL.
- Proof & Links (footer only): Use the candidate's REAL social proof and links EXACTLY as given in the CANDIDATE PROFILE (Upwork rating/JSS/project count, Portfolio, GitHub, LinkedIn, Upwork). Do NOT substitute any other values.
- CTA: Walk through architecture/code in an interview (reference the profile's real projects and stack).
- Sign-off: Use the candidate's REAL name, email, and WhatsApp FROM THE PROFILE (FORMAT EXAMPLE ONLY: [Candidate Name], [Candidate Email], WhatsApp: [Candidate Phone]).
- SUMMARY: <=250-char LinkedIn note opening with "Are you still looking for a ${cleanTitle || "Developer"}? I'm available for it.", then a stack-fit sentence using the profile's REAL years and core tech, then the candidate's portfolio link EXACTLY as given in the CANDIDATE PROFILE.
- CRITICAL: There is NO hardcoded candidate data. Every candidate fact (name, email, WhatsApp, portfolio/GitHub/LinkedIn/Upwork links, years of experience per domain, selected projects, metrics, social proof, skills) MUST be taken EXACTLY from the CANDIDATE PROFILE above. If a fact is not in the profile, omit it — never invent or substitute one.
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


