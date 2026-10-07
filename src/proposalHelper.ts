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

  // 8. Clean up double spacing or leftover artifacts
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

  const systemPrompt = `You are a world-class technical copywriter and senior developer crafting highly customized, high-converting direct job application / proposal emails for recruiters and hiring managers.

YOUR OBJECTIVE:
Generate an irresistible, hyper-targeted, high-converting application email following a proven, production-grade structure that immediately hooks the reader, references their posting, and maps the role's requirements to candidate's real shipped products with direct links and concrete engineering proof.

CRITICAL ROLE TITLE & ACCURACY RULES:
1. NEVER USE AN AGENCY OR COMPANY DESCRIPTOR IN THE OPENING QUESTION:
   - NEVER write "Are you still looking for a Recruitment Company?" or "Are you still looking for a Staffing Agency?".
   - The opening question MUST ALWAYS name the actual engineering / developer position being hired (e.g., "Are you still looking for a Senior Mobile Developer?").
   - If the job title was labeled with an agency/recruiting firm descriptor or is generic, extract the actual candidate position from the posting.
2. FRAMEWORK SEPARATION: Never conflate separate technologies (e.g., NEVER say "React Native (via Flutter)" or treat React Native and Flutter as interchangeable). React Native is JS/TS; Flutter is Dart; native Android is Kotlin; native iOS is Swift.
3. DYNAMIC WORK ARRANGEMENT & COMMITTED HOURS:
   - If the posting mentions specific availability or hours (e.g. "Approximately 15 hours/week" or "15–20 hours/week"), incorporate that explicitly (e.g. "and I can work remotely with roughly 15 hours per week of committed availability and full IST/US/EU timezone overlap.").
   - If location is specified (e.g. New York onsite, 5 days/week), adapt to that.
4. DEFENSIBLE, CREDIBLE METRICS: Use realistic, professional metrics that hold up in technical interviews (e.g., "cut API response times by 40%", "reduced delivery time by roughly 60% with Claude Code & Cursor", "deterministic verification and reproducible test environments").
5. NO PLACEHOLDERS OR MARKDOWN LINKS: Write 100% in clean plain text. Never use markdown bold asterisks (**bold**). Never use bracketed links [text](url) — always write URLs directly. Never output bracketed placeholders like [Company] or [Hiring Manager].

PROVEN HIGH-CONVERTING PROPOSAL STRUCTURE (MANDATORY ORDER):

1. SUBJECT LINE:
   - Format: Subject: [Job Title] Application — [Core Tech 1], [Core Tech 2] & [Core Tech 3] (6+ Years)
   - Examples:
     Subject: Senior Mobile Developer Application — Kotlin, Swift & Flutter (6+ Years)
     Subject: Senior Full-Stack & AI Engineer Application — Python, Next.js & AI Systems (6+ Years)

2. PERSONALIZED GREETING:
   - Format: "Hi [Author/Recruiter Name or Company Name] and team,"
   - If author name is provided, use their name (e.g., "Hi PRASANTH and team," or "Hi Parth Global Consultants and team,").
   - If no author name is provided, use: "Hi [Company Name] and team," or "Hi Hiring Team,".

3. IMMEDIATE AVAILABILITY, ROLE TITLE & WORK ARRANGEMENT (MANDATORY FIRST QUESTION):
   - Format: "Are you still looking for a [Exact Job Title]? I'm available to start immediately on a [contract basis / full-time basis], and I can work [work arrangement]."
   - The position MUST be an engineering/candidate role (e.g. "Senior Mobile Developer"), NEVER an agency name or recruiter type.
   - Dynamically adapt the arrangement to the posting:
     * If posting mentions hours (e.g. 15 hours/week): "and I can work remotely with roughly 15 hours per week of committed availability and full IST/US/EU timezone overlap."
     * If onsite/hybrid in a city: "and can work onsite in [City, e.g. New York, 5 days/week]."
     * If general remote: "and can work remotely with full US/EU timezone overlap."

4. POSTING REFERENCE:
   - If a posting URL is provided, include it on its own lines:
     Your posting:
     [Exact Job URL]

5. RELEVANT EXPERIENCE HOOK:
   - Format:
     "I have 6+ years of experience building production software across [core matching stack, e.g. native Android (Kotlin), native iOS (Swift), Flutter cross-platform apps, and supporting backend services]. What stood out to me about this role is that [specific highlight of role, e.g., it is about creating challenging mobile engineering tasks with reproducible environments, deterministic verifiers, and reference solutions for AI systems] — which closely matches [how I build and validate my own mobile products and internal test harnesses / my recent work]."

6. PROJECT-TO-ROLE MAPPING ("Here's how my experience maps to the role:"):
   - Header line: "Here's how my experience maps to the role:"
   - Provide 4 to 5 crisp bullet points mapping the job's required skills to candidate's real production projects, including the project live link and architecture highlights.
   - For Mobile / iOS / Android / Flutter roles:
     * Kotlin and Android development — Microphone Amplifier and TrendSnap (Android, Kotlin): built real-time audio amplification and noise-reduction pipelines, low-latency mic monitoring with foreground services, lifecycle-aware components, and background/foreground state handling, plus performance profiling on memory-constrained devices. Details: https://umerwaqas.pages.dev?resume=3
     * Swift and iOS development — OnePDF (https://umerwaqas.pages.dev?resume=3): shipped a native iOS utility to the App Store covering PDF scanning, conversion, merge/split, compression and signing, including camera/OCR media pipelines, file-system lifecycle handling, secure local document processing, and App Store release management.
     * Flutter cross-platform architecture — AI Influencer Generator: built one Dart codebase delivered to both the iOS App Store and Google Play, with state management across async AI generation jobs, subscription and usage tracking, media generation/upload pipelines, and consistent behavior across platform differences.
     * Reproducible environments and deterministic verification — lead delivery across a 20+ person engineering team using Docker, CI/CD pipelines and automated test suites; I write reference implementations and regression tests that verify async, lifecycle and state-management behavior deterministically rather than relying on manual QA.
     * Mobile engineering quality at scale — at Askly (https://askly.sairahul.dev) and NicheTrafficKit (https://nichetraffickit.com) I reduced API response times by around 40% and delivery time by roughly 60% using AI-assisted workflows with Claude Code and Cursor, with strong hands-on debugging, refactoring and performance optimization on complex production applications.
   - For AI / Full-Stack / Backend / Web roles:
     * AI / LLM / Agents — Askly (https://askly.sairahul.dev/): Built an AI database agent with natural-language-to-SQL, schema-aware retrieval, vector search, LLM orchestration and tool-calling agents using OpenAI/Anthropic-style integrations.
     * RAG / Vector Databases — ChatBase Clone (https://umerwaqas.pages.dev): Built document/website knowledge retrieval using chunking, embeddings, vector search, configurable prompts and deployable AI chat experiences.
     * Full Stack / Backend APIs — WorkForge (https://umerwaqas.pages.dev): Built a full-stack marketplace with Laravel, Livewire, Tailwind, authentication, contracts, payments, wallet/ledger flows, messaging and administrative workflows.
     * Python / AI Products — AI Influencer Generator (https://umerwaqas.pages.dev): Built a production AI product using Python, Next.js, Flutter and AI APIs, including content generation workflows, subscriptions and usage tracking.
     * Cloud / DevOps / Production: Hands-on with Docker, CI/CD, AWS/GCP/Azure, production debugging, API integrations, testing and deployment. I also lead delivery across a 20+ person engineering team, using AI-assisted development with Claude Code and Cursor to reduce delivery time by approximately 60%.

7. CREDIBILITY & SOCIAL PROOF:
   - Include: "I'm Upwork Top Rated with 100% Job Success across 48+ projects."
   - Follow immediately with direct proof links:
     Portfolio: ${portfolioUrl}
     GitHub: https://github.com/umerwaqas92
     LinkedIn: https://www.linkedin.com/in/umerwaqas92
     Upwork: https://www.upwork.com/freelancers/~010219e25749223694

8. TECHNICAL INTERVIEW CALL-TO-ACTION:
   - "I'd be happy to walk through the [relevant architecture, e.g. mobile architecture, state management and async patterns, or relevant production Kotlin, Swift and Flutter code] in an interview."

9. PROFESSIONAL SIGN-OFF:
   - Best regards,
     Umer Waqas
     um.waqas.khan@gmail.com
     WhatsApp: +92 345 9347900

CRITICAL FORMATTING & CONTENT RULES:
- Write strictly in 100% PLAIN TEXT.
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
   - Followed by 1 short sentence on stack fit: "6+ yrs building production [core tech]."
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
Description / Requirements:
${cleanText}

Generate a personalized application email in 100% pure plain text following the system instructions.
1. Greeting: Use "Hi ${cleanAuthor ? cleanAuthor + " and team," : "[Company/Recruiter] and team,"}".
2. Opening: "Are you still looking for a ${cleanTitle || "Senior Developer"}? I'm available to start immediately on a [contract/full-time] basis and can work [remotely/onsite]..." — NEVER name an agency or company descriptor in this opening question.
3. Posting URL: ${cleanUrl ? `Include "Your posting:\n${cleanUrl}"` : "If posting URL is given, include it under 'Your posting:'"}.
4. Experience hook: 6+ years building production software matching their focus.
5. "Here's how my experience maps to the role:" with 4-5 tailored project bullets from Askly, ChatBase Clone, WorkForge, AI Influencer Generator, OnePDF, etc. with their direct URLs.
6. Proof & Links: Include Upwork Top Rated, Portfolio (${portfolioUrl}), GitHub, LinkedIn, Upwork.
7. CTA: Walk through architecture/code in an interview.
8. Sign-off: Umer Waqas, um.waqas.khan@gmail.com, WhatsApp: +92 345 9347900.
9. SUMMARY: <=250-char LinkedIn note opening with "Are you still looking for a ${cleanTitle || "Developer"}? I'm available for it.", stack match, and "Portfolio: ${portfolioUrl}".
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

