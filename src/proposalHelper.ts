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
  const mappingSectionRegex = /(how (?:my )?experience maps to the role:?\s*\n+)([\s\S]*?)(\n\s*(?:I'm Upwork|Upwork Top Rated|Portfolio:|GitHub:|LinkedIn:|I'd be happy|Best regards))/i;
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
  let cleaned = stripSocialCounts(title);

  // Filter out recruiter agency / company descriptors that get mistakenly parsed as job titles
  const isAgencyDescriptor =
    /\b(?:recruitment|staffing|consulting|headhunting|talent acquisition|hr|human resources)\s*(?:company|agency|firm|services|consultants?|group|solutions)?\b/i.test(cleaned) ||
    /^(?:hiring|we are hiring|urgent hiring|job opportunity|opening|openings|career|careers)$/i.test(cleaned);

  if (isAgencyDescriptor) {
    cleaned = "";
  }

  // Extract real role from posting description if title is empty or was an agency descriptor
  if (!cleaned && jobText) {
    const profileMatch = jobText.match(/(?:Profile|Role|Position|Job Title|Title)\s*[:–-]\s*([^\n\r,•|📱🔥]+)/i);
    if (profileMatch) {
      cleaned = stripSocialCounts(profileMatch[1]);
    } else {
      const hiringMatch = jobText.match(/(?:HIRING|LOOKING FOR|WANTED)\s*[–—\-:]\s*([^\n\r,•|📱🔥]+)/i);
      if (hiringMatch) {
        cleaned = stripSocialCounts(hiringMatch[1]);
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
  usTimezone: string;
}

export function detectWorkArrangement(title?: string, text?: string): WorkArrangementInfo {
  const combined = `${title || ""} ${text || ""}`;

  let location = "";
  let usTimezone = "US Central";

  // US Central cities & states
  if (/\b(?:dallas|austin|houston|san antonio|fort worth|plano|irving|texas|tx)\b/i.test(combined)) {
    if (/\bdallas\b/i.test(combined)) location = "Dallas, TX";
    else if (/\baustin\b/i.test(combined)) location = "Austin, TX";
    else if (/\bhouston\b/i.test(combined)) location = "Houston, TX";
    else location = "Texas";
    usTimezone = "US Central";
  } else if (/\b(?:chicago|illinois|il|minneapolis|minnesota|mn|st\.?\s*louis|missouri|mo|kansas\s*city|tennessee|nashville|memphis|wisconsin|wi)\b/i.test(combined)) {
    location = /\bchicago\b/i.test(combined) ? "Chicago, IL" : "US Central";
    usTimezone = "US Central";
  }
  // US Eastern cities & states
  else if (/\b(?:new york|nyc|manhattan|brooklyn|ny|boston|massachusetts|ma|atlanta|georgia|ga|miami|orlando|tampa|florida|fl|washington\s*d\.?c\.?|philadelphia|pa|charlotte|raleigh|north carolina|nc|new jersey|nj|virginia|va)\b/i.test(combined)) {
    if (/\b(?:new york|nyc|manhattan|brooklyn)\b/i.test(combined)) location = "New York, NY";
    else if (/\bboston\b/i.test(combined)) location = "Boston, MA";
    else if (/\batlanta\b/i.test(combined)) location = "Atlanta, GA";
    else if (/\bmiami\b/i.test(combined)) location = "Miami, FL";
    else location = "US Eastern";
    usTimezone = "US Eastern";
  }
  // US Pacific cities & states
  else if (/\b(?:san francisco|sf|bay area|san jose|silicon valley|los angeles|la|san diego|california|ca|seattle|bellevue|washington|wa|portland|oregon|or)\b/i.test(combined)) {
    if (/\b(?:san francisco|sf|bay area|silicon valley)\b/i.test(combined)) location = "San Francisco, CA";
    else if (/\bseattle\b/i.test(combined)) location = "Seattle, WA";
    else if (/\b(?:los angeles|la)\b/i.test(combined)) location = "Los Angeles, CA";
    else location = "California";
    usTimezone = "US Pacific";
  }
  // US Mountain
  else if (/\b(?:denver|boulder|colorado|co|phoenix|scottsdale|arizona|az|salt lake|utah|ut)\b/i.test(combined)) {
    location = /\b(?:denver|boulder)\b/i.test(combined) ? "Denver, CO" : /\bphoenix\b/i.test(combined) ? "Phoenix, AZ" : "US Mountain";
    usTimezone = "US Mountain";
  }
  // UK / Europe
  else if (/\b(?:london|uk|united kingdom|england)\b/i.test(combined)) {
    location = "London, UK";
    usTimezone = "UK / GMT";
  } else if (/\b(?:germany|berlin|munich|amsterdam|netherlands|paris|france)\b/i.test(combined)) {
    location = "Europe";
    usTimezone = "CET / EU";
  }

  // Generic extraction if labeled e.g. "Location: Dallas, TX" or "Location: New York"
  if (!location) {
    const locMatch = combined.match(/(?:Location|Work Location|Place|City)\s*[:–-]\s*([A-Za-z\s,.-]+?)(?:\s*(?:•|\n|\r|\||Job|Type|Salary|\$))/i);
    if (locMatch && locMatch[1].trim().length < 40) {
      const candidateLoc = locMatch[1].trim();
      if (!/\bremote\b/i.test(candidateLoc)) {
        location = candidateLoc;
        usTimezone = "US Central";
      }
    }
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

  return {
    isOnsiteOrHybrid,
    arrangementLabel,
    location,
    usTimezone,
  };
}

export async function generateProposal(
  profileContent: string,
  jobText: string,
  jobTitle?: string,
  jobUrl?: string,
  resumes?: ResumeOption[],
  authorName?: string,
): Promise<ProposalResult> {
  // Scrub social-count noise and extract true job title (never agency descriptors).
  const cleanTitle = cleanJobTitle(jobTitle, jobText);
  const cleanText = stripSocialCounts(jobText);
  const cleanUrl = (jobUrl || "").trim();
  const cleanAuthor = stripSocialCounts(authorName || "").trim();
  const isMobileRole = isMobileJob(cleanTitle, cleanText);
  const portfolioUrl = isMobileRole
    ? "https://umerwaqas.pages.dev?resume=3"
    : "https://umerwaqas.pages.dev?resume=2";
  const arrangement = detectWorkArrangement(cleanTitle, cleanText);

  const systemPrompt = `You are a world-class technical copywriter and senior developer crafting highly customized, high-converting direct job application / proposal emails for recruiters and hiring managers.

YOUR OBJECTIVE:
Generate an irresistible, hyper-targeted, high-converting application email following a proven, production-grade structure that immediately hooks the reader, references their posting, and maps the role's requirements to candidate's real shipped products with direct links and concrete engineering proof.

CRITICAL ROLE TITLE & WORK ARRANGEMENT RULES:
1. NEVER USE AN AGENCY OR COMPANY DESCRIPTOR IN THE OPENING QUESTION:
   - NEVER write "Are you still looking for a Recruitment Company?" or "Are you still looking for a Staffing Agency?".
   - The opening question MUST ALWAYS name the actual engineering / developer position being hired (e.g., "Are you still looking for a Senior Mobile Developer?").
   - If the job title was labeled with an agency/recruiting firm descriptor or is generic, extract the actual candidate position from the posting.
2. FRAMEWORK SEPARATION: Never conflate separate technologies (e.g., NEVER say "React Native (via Flutter)" or treat React Native and Flutter as interchangeable). React Native is JS/TS; Flutter is Dart; native Android is Kotlin; native iOS is Swift.
3. STRICT WORK ARRANGEMENT RULE (NEVER CLAIM TO BE ONSITE):
   - The candidate is based outside the US and works REMOTELY on contract.
   - NEVER say the candidate can work onsite in any US or foreign city (e.g., NEVER write "I can work onsite in Dallas, TX" or "onsite 5 days/week" or claim to relocate). Saying that creates confusion and makes rec    - IF THE JOB POSTING IS ONSITE OR HYBRID (e.g., Dallas, TX onsite, New York onsite, hybrid in office):
      * Put the remote inquiry near the very top (within the first 3-4 lines).
      * Acknowledge that the position is listed as onsite/hybrid in [Location].
      * Politely ask if they would consider a remote arrangement for the right candidate.
      * Emphasize candidate is currently based outside the US, can provide full ${arrangement.usTimezone} timezone overlap, work on a long-term contract basis, and start immediately.
      * Soften the request so it does not sound like a rigid demand: "If the team is open to remote candidates, I'd be very interested in discussing the role."
      * Subject Line: Subject: [Job Title] | Remote Availability | [Core Tech 1] & [Core Tech 2]
        Keep the subject line clean and recruiter-friendly; do NOT overload it with years or excess technologies.
    - IF THE JOB POSTING IS REMOTE:
      * Subject Line: Subject: [Job Title] Application | [Core Tech 1] & [Core Tech 2] (7+ Years)
      * Opening: "Are you still looking for a [Exact Job Title]? I'm available to start immediately on a contract basis and can work remotely with full ${arrangement.usTimezone} timezone overlap and long-term availability." (incorporate committed hours like 15 hours/week if mentioned).
4. SHORT, TIGHT & RECRUITER-FRIENDLY (KEEP EMAIL SHORT):
   - Keep the entire email concise, tight, and easily scannable (around 180-230 words).
   - REDUCE SKILL DETAILS: Do not list endless frameworks or verbose multi-clause explanations. Keep each point focused on core capability and business outcome.
   - REMOVE WORK/PROJECT LINKS FROM THE EMAIL BODY:
     * NEVER put project/work URLs in the bullet points (NO https:// links in the bullets).
     * Just reference the project name (e.g., Ardent, Askly, Diffsight, NicheTrafficKit).
     * All portfolio and proof links belong STRICTLY in the footer links section (Portfolio, GitHub, LinkedIn, Upwork).
     * This keeps the email short, clean, and avoids triggering spam filters.
   - Limit to 3 to 4 bullet points MAXIMUM, strictly 1 concise sentence per bullet.
5. AVOID CLAIMING "FINE-TUNING":
   - Do NOT claim model fine-tuning unless the posting explicitly requires it and candidate has verified fine-tuning experience.
   - Focus on prompt/context engineering, multi-agent orchestration, hybrid RAG, embeddings, MCP-style tool calling, and production API integrations.
6. CLOUD PLATFORMS:
   - If the job specifically mentions AWS, Azure, or GCP, name that exact cloud platform (e.g., AWS, Azure, or GCP with Docker, CI/CD, and production deployment) rather than using vague "cloud-native" terms.
7. DEFENSIBLE, CREDIBLE METRICS: Use realistic, professional metrics that hold up in technical interviews (e.g., "cut API response times by 40%", "reduced delivery time by roughly 60% with Claude Code & Cursor", "deterministic verification and reproducible test environments").
8. NO PLACEHOLDERS OR MARKDOWN LINKS: Write 100% in clean plain text. Never use markdown bold asterisks (**bold**). Never use bracketed links [text](url) — always write URLs directly. Never output bracketed placeholders like [Company] or [Hiring Manager].

PROVEN HIGH-CONVERTING PROPOSAL STRUCTURE (MANDATORY ORDER):

1. SUBJECT LINE:
   - For Onsite/Hybrid postings:
     Subject: [Job Title] | Remote Availability | [Core Tech 1] & [Core Tech 2]
     Example: Subject: AI Engineer – Generative AI & Agentic AI | Remote Availability | Python & RAG
   - For Remote postings:
     Subject: [Job Title] Application | [Core Tech 1] & [Core Tech 2] (7+ Years)
     Example: Subject: Senior Mobile Developer Application | Kotlin & Swift (7+ Years)

2. PERSONALIZED GREETING:
   - Format: "Hi [Author/Recruiter Name or Company Name] and team,"
   - If author name is provided, use their name (e.g., "Hi Eshwar Venkatesh (Venkat) and team," or "Hi Ajay and team,").
   - If no author name is provided, use: "Hi [Company Name] and team," or "Hi Hiring Team,".

3. OPENING (CHOOSE BASED ON ONSITE VS REMOTE):

   CASE A - FOR ONSITE / HYBRID POSTINGS:
   "I came across your posting for the [Exact Job Title] role in [Location]. I noticed the position is listed as [onsite / hybrid], but I wanted to ask if you would consider a remote arrangement for the right candidate.

   I'm currently based outside the US and can provide full ${arrangement.usTimezone} timezone overlap, work on a long-term contract basis, and start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role.

   My experience closely matches the position across [core matching stack from posting]."

   CASE B - FOR REMOTE POSTINGS:
   "Are you still looking for a [Exact Job Title]? I'm available to start immediately on a contract basis and can work remotely with full ${arrangement.usTimezone} timezone overlap and long-term availability."
   (If specific committed hours are mentioned in the posting, include: "with roughly 15 hours per week of committed availability and full US timezone overlap.")

4. POSTING REFERENCE:
   - If a posting URL is provided, include it on its own lines:
     Your posting:
     [Exact Job URL]

5. RELEVANT EXPERIENCE HOOK (FOR REMOTE ROLES ONLY, ONSITE ROLES CAN TRANSITION DIRECTLY TO BULLETS):
   - Keep to 1-2 tight sentences: "I have 7+ years of experience building production software across [core matching stack]. What stood out to me about this role is [1 concise sentence on why it fits]."

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
   - Include: "I'm Upwork Top Rated with 100% Job Success across 48+ projects."
   - Follow immediately with direct proof links:
     Portfolio: ${portfolioUrl}
     GitHub: https://github.com/umerwaqas92
     LinkedIn: https://www.linkedin.com/in/umerwaqas92
     Upwork: https://www.upwork.com/freelancers/~010219e25749223694

8. TECHNICAL INTERVIEW CALL-TO-ACTION:
   - For AI / Agentic roles: "I'd be happy to walk through my agentic architecture, RAG pipelines, tool-calling patterns, and database branching infrastructure in an interview."
   - For Mobile roles: "I'd be happy to walk through my mobile architecture, state management patterns, and production Kotlin, Swift, or Flutter code in an interview."

9. PROFESSIONAL SIGN-OFF:
   - Best regards,
     Umer Waqas
     um.waqas.khan@gmail.com
     WhatsApp: +92 345 9347900

CRITICAL FORMATTING & CONTENT RULES:
- Write strictly in 100% PLAIN TEXT.
- Keep the email SHORT and punchy (180-230 words).
- DO NOT put work/project URLs in the bullet points. Only name the project and keep all URLs in the footer portfolio/social proof links section.
- NEVER use markdown bold asterisks (do NOT write **bold** or *italic*).
- NEVER use markdown link syntax (do NOT write [Text](url)). Write raw URLs directly.
- The portfolio link (${portfolioUrl}) MUST always be included in the social proof links section.
- NEVER output bracketed placeholders. Extract or synthesize real values.

${resumes && resumes.length > 0 ? `
10. RESUME RECOMMENDATION:
- When candidate resumes are provided, select the best matching resume for the job stack.
- Output the chosen resume filename or ID under RECOMMENDED_RESUME.` : ""}

OUTPUT FORMAT:
Output EXACTLY two sections (or three sections if resumes are provided):

1. SUMMARY (LinkedIn Easy Apply Note — 250 characters HARD MAXIMUM):
   - Opens with: "Are you still looking for a [Exact Job Title]? I'm available for it."
   - Followed by 1 short sentence on stack fit: "7+ yrs building production [core tech]."
   - Followed by: "Portfolio: ${portfolioUrl}"
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

  const userPrompt = `CANDIDATE PROFILE & WORK HISTORY:
${profileContent}${resumesPromptSection}

JOB POSTING:
${cleanTitle ? `Title: ${cleanTitle}\n` : ""}${cleanAuthor ? `Author / Contact Name: ${cleanAuthor}\n` : ""}${cleanUrl ? `URL: ${cleanUrl}\n` : ""}
Work Arrangement Detected: ${arrangement.isOnsiteOrHybrid ? `${arrangement.arrangementLabel.toUpperCase()} in ${arrangement.location || "Office"} (Timezone: ${arrangement.usTimezone})` : "REMOTE"}
Description / Requirements:
${cleanText}

Generate a personalized application email in 100% pure plain text following the system instructions.
- KEEP THE EMAIL SHORT (around 180-230 words) and easily scannable.
- REDUCE SKILL DETAILS: Avoid long multi-clause explanations or excessive keyword stuffing.
- DO NOT INCLUDE WORK/PROJECT LINKS IN THE BULLET POINTS: Mention project names only. Keep all URLs strictly in the footer links.
${arrangement.isOnsiteOrHybrid ? `
- The posting is ${arrangement.arrangementLabel} in ${arrangement.location || "the office"}.
- DO NOT say the candidate can work onsite in ${arrangement.location || "the office"}. Candidate is based outside the US and works REMOTELY on contract.
- Subject: ${cleanTitle || "Senior Developer"} | Remote Availability | [Core Tech 1] & [Core Tech 2]
  (Keep subject clean and recruiter-friendly. Do NOT append years of experience to onsite/hybrid subject lines).
- Greet the recruiter: "Hi ${cleanAuthor ? cleanAuthor + " and team," : "[Company/Recruiter] and team,"}"
- Opening (first 3-4 lines): Acknowledge the posting in ${arrangement.location || "the office"} is listed as ${arrangement.arrangementLabel}, ask politely if they would consider remote for the right candidate.
- State candidate is currently based outside the US, provides full ${arrangement.usTimezone} timezone overlap, long-term contract availability, and immediate start.
- Add: "If the team is open to remote candidates, I'd be very interested in discussing the role."
- Then state: "My experience closely matches the position across [core matching skills]."
` : `
- The posting is Remote.
- Subject: ${cleanTitle || "Senior Developer"} Application | [Core Tech 1] & [Core Tech 2] (7+ Years)
- Opening: "Are you still looking for a ${cleanTitle || "Senior Developer"}? I'm available to start immediately on a contract basis and can work remotely with full ${arrangement.usTimezone} timezone overlap and long-term availability."
- Hook (1-2 sentences max): "I have 7+ years of experience building production software across [core matching stack]..."
`}
- AVOID claiming model fine-tuning. Focus on prompt/context engineering, multi-agent orchestration, hybrid RAG, embeddings, MCP-style tool calling, and API integrations.
- If the job explicitly mentions AWS, Azure, or GCP, name that specific cloud platform.
- Include posting URL under "Your posting:\n${cleanUrl}"
- "How my experience maps to the role:" followed by an empty blank line, then strictly 3-4 SHORT, PUNCHY project bullets starting with "✅ " with an empty blank line between EVERY bullet (NO URLs in bullets).
- Proof & Links (footer only): Include Upwork Top Rated (100% JSS, 48+ projects), Portfolio (${portfolioUrl}), GitHub, LinkedIn, Upwork.
- CTA: Walk through architecture/code in an interview.
- Sign-off: Umer Waqas, um.waqas.khan@gmail.com, WhatsApp: +92 345 9347900.
- SUMMARY: <=250-char LinkedIn note opening with "Are you still looking for a ${cleanTitle || "Developer"}? I'm available for it.", "7+ yrs building production [core tech].", and "Portfolio: ${portfolioUrl}".
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

