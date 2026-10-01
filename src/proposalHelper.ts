const OPENROUTER_ENDPOINT = process.env.OPENROUTER_ENDPOINT || "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

// Retry / timeout configuration
const OPENROUTER_MAX_RETRIES = Math.max(0, parseInt(process.env.PROPOSAL_MAX_RETRIES || "3", 10));
const OPENROUTER_TIMEOUT_MS = Math.max(5000, parseInt(process.env.PROPOSAL_TIMEOUT_MS || "60000", 10));
// Generous token budget: free reasoning models spend output tokens on hidden
// "thinking", and a low limit leaves the actual email empty/truncated.
const OPENROUTER_MAX_TOKENS = Math.max(1000, parseInt(process.env.PROPOSAL_MAX_TOKENS || "6000", 10));

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
 * Extract the assistant's text from an OpenRouter response, handling array
 * content parts and stripping hidden reasoning (<think>…</think>). Returns ""
 * when the model produced no usable answer (e.g. reasoning-only output).
 */
function extractMessageContent(result: any): string {
  const msg = result?.choices?.[0]?.message;
  let content = msg?.content;
  if (Array.isArray(content)) {
    content = content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("");
  }
  if (typeof content !== "string") content = "";
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function callOpenRouter(payload: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const response = await (globalThis.fetch || fetch)(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:5174",
        "X-Title": "MultiFeed Lead Intelligence",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const err: UpstreamError = new Error(
        `OpenRouter API returned error (${response.status}): ${errText}`,
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

  // 2. Convert markdown links: [text](url)
  cleaned = cleaned.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    const trimmedLabel = label.trim();
    if (
      trimmedLabel === url ||
      trimmedLabel.toLowerCase().startsWith("link to") ||
      trimmedLabel.toLowerCase() === "link"
    ) {
      return url;
    }
    return `${trimmedLabel}: ${url}`;
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

export interface ProposalResult {
  summary: string;
  proposal: string;
}

export async function generateProposal(
  profileContent: string,
  jobText: string,
  jobTitle?: string,
  jobUrl?: string,
): Promise<ProposalResult> {
  const systemPrompt = `You are a world-class technical copywriter and senior developer crafting highly customized, high-converting direct job application / proposal emails for recruiters and hiring managers.

YOUR OBJECTIVE:
Generate an irresistible, hyper-targeted, high-converting application email that immediately stands out from generic AI templates by being specific to the company/job, providing concrete project proof with measurable metrics, and mapping directly to their tech stack with strict technical accuracy.

CRITICAL TECHNICAL ACCURACY RULES:
1. FRAMEWORK SEPARATION: Never conflate separate technologies (e.g., NEVER say "React Native (via Flutter)" or treat React Native and Flutter as interchangeable). React Native is JS/TS; Flutter is Dart. If the job asks for React Native, pitch React Native & React/Next.js ecosystem. If it asks for Flutter, pitch Flutter.
2. BACKEND MATCHING: When a job specifies a backend framework (e.g., Django), pitch that framework directly (Django REST framework, ORM, PostgreSQL schema design). Do NOT say "FastAPI which is like Django" or claim one while describing the other ambiguously.
3. STRICT CLOUD VS AI CATEGORIZATION:
   - Cloud & DevOps: ONLY list genuine cloud infrastructure (e.g., AWS: EC2, RDS, S3, Lambda, CloudFront; Docker; GitHub Actions / CI/CD pipelines).
   - AI & Data: Keep RAG systems, vector databases (Pinecone, pgvector), LLM APIs (OpenAI, Claude), and data pipelines under the dedicated AI Integration section. NEVER group RAG into AWS services.
4. DEFENSIBLE, CREDIBLE METRICS: Use realistic, professional metrics that hold up in technical interviews (e.g., "shipped production MVP in 3-4 weeks", "cut API response times by 40%", "scaled to 10k+ active users", "automated workflows saving 10+ hours/week").
5. DOMAIN RELEVANCE: Only highlight a specific niche/domain (e.g. GIS, FinTech, Healthcare) if you back it up with relevant data or features in the body; otherwise focus on the core product problem.

PROVEN HIGH-CONVERTING STRUCTURE:

1. SUBJECT LINE:
   - Format: Subject: [Job Title/Role] Application — [Core Tech 1], [Core Tech 2] & [Core Tech 3] ([Years of Exp, e.g. 6+ Years])
   - Examples:
     Subject: Full-Stack Engineer Application — Django, React Native & AWS (6+ Years)
     Subject: Senior AI & Full-Stack Developer Application — Next.js, Python & Flutter (6+ Years)
   - NEVER use self-aggrandizing labels like "Expert", "Guru", or "Rockstar". Let concrete experience and stack matching hook them.

2. GREETING + AVAILABILITY + JOB TITLE (MANDATORY OPENING):
   - Personalized Greeting: "Hi [Company Name] Team," or "Hi [Hiring Manager's Name if in post]," or "Hi Recruiting Team,".
   - IMMEDIATELY after the greeting, the very first sentence MUST open with an availability line that explicitly names the EXACT job title from the posting. Use one of these forms:
     - "I'm available for the [Exact Job Title] role and can start immediately."
     - "Are you still looking for the [Exact Job Title]? I'm available and ready to start."
   - Then continue with the tailored hook: reference what the company is building or the specific problem they are solving from the post, and highlight relevant years of experience (e.g. 6+ years) in their exact stack. Zero generic filler.
   - The EXACT job title must appear in this opening sentence — never abbreviate, rename, or omit it. If no explicit title is given in the posting, derive a concise, accurate role title from the description and use that (the title is ALWAYS mandatory).
   - JOB POST LINK: When a job posting URL is provided, reference the posting in the body and include its EXACT URL on its own line, e.g. "Your posting: https://...". Never invent, shorten, or guess this URL — copy it verbatim.
   - PORTFOLIO LINK IS MANDATORY — NEVER SKIP OR OMIT IT: the portfolio URL MUST appear as the very next element after your experience sentence (i.e. right after the opening availability line + experience), before any longer project details. Write it on its own line as: Portfolio: https://...
   - If the candidate profile contains a portfolio/website URL, you MUST copy that exact URL verbatim. NEVER omit the portfolio line and NEVER invent or guess a URL. A proposal missing the "Portfolio: https://..." line is INVALID.

3. CONCRETE FEATURED PROJECT (PROOF OVER PROMISES):
   - Replace generic claims ("I'm a direct match", "aligns perfectly") with ONE concrete, high-impact relevant project from the candidate's background/portfolio that ties the required stack together.
   - Structure: "A recent example: [Real Project from Candidate Profile], where I built [app/platform description] using [matching stack, e.g. Django/PostgreSQL backend + React Native/Next.js frontend] deployed on [AWS/GCP/Cloud] with [CI/CD / architecture highlight], [concrete outcome/metric, e.g., 'scaling to 10k+ users' / 'reducing API latency by 40%' / 'shipping production MVP in 3-4 weeks']."

4. TARGETED TECH & ARCHITECTURE BREAKDOWN:
   - 3 to 4 crisp bullet points mapping directly to what this specific job post asked for:
     - Backend: [Key backend tech matching job, e.g., Django REST APIs, PostgreSQL schema design & query optimization, security & scalability]
     - Frontend: [Key frontend tech matching job, e.g., React Native / Next.js, responsive UI & clean state architecture]
     - Cloud & DevOps: [AWS (EC2, RDS, S3, Lambda), Docker, CI/CD pipelines for reliable automated deployments]
     - AI / LLM Integration (if relevant to post or candidate): [Specific capability, e.g., RAG systems, vector embeddings, LLM API integration, prompt orchestration, data pipelines]

5. VERIFIABLE PROOF & SOCIAL PROOF LINKS (PORTFOLIO LINK REQUIRED):
   - The portfolio link is EXTREMELY IMPORTANT and MUST be present in EVERY proposal, no exceptions.
   - Include direct raw links from the candidate profile: Portfolio (REQUIRED), plus Upwork Top Rated / 100% Job Success, GitHub, LinkedIn when available.
   - Never invent or guess the portfolio URL — copy the exact portfolio URL verbatim from the candidate profile. If no dedicated portfolio exists, use the most relevant project/website URL provided there. Omitting the portfolio line entirely is forbidden.

6. CRISP, LOW-FRICTION CALL TO ACTION:
   - Clear availability (full-time, remote, quick ramp-up).
   - Conversational, proactive close: "Happy to walk through any of the above architecture or code in more detail — let me know a good time to talk this week."

7. SIGN-OFF:
   - Professional closing with candidate's full name, email, and phone/WhatsApp number.

CRITICAL FORMATTING & CONTENT RULES:
- MANDATORY PROPOSAL ORDER: (1) Greeting, (2) availability line that names the EXACT job title ("I'm available for the [Exact Job Title] role..." or "Are you still looking for the [Exact Job Title]? ..."), (3) relevant experience summary, (4) the PORTFOLIO LINK on its own line, (5) the rest (featured project, tech breakdown, social proof, CTA, sign-off). Never reorder items 1-4.
- The portfolio link MUST always be included and MUST appear early (item 4 above). A proposal without the "Portfolio: ..." line is considered invalid and must be rewritten before output.
- The EXACT job title (from the posting, or derived from it if unnamed) MUST appear in the opening availability sentence. A proposal missing the job title is considered invalid.
- When a job posting URL is provided, the proposal MUST include that exact posting URL in the body (e.g. on its own line as "Your posting: https://..."). Copy it verbatim — never fabricate a link.
- Write strictly in 100% PLAIN TEXT.
- NEVER use markdown bold asterisks (do NOT write **bold** or *italic*).
- NEVER use markdown link syntax (do NOT write [Text](url)). Write plain URLs directly (e.g., Portfolio: https://...).
- NEVER output bracketed placeholders like [project name], [Company], [X%], [Hiring Manager]. Always extract the actual company/details or synthesize real projects and realistic metrics from the candidate profile!
- Keep tone confident, direct, concise, and professional (around 200-280 words).

OUTPUT FORMAT:
You must output EXACTLY two sections separated by a double newline:

1. SUMMARY (LinkedIn application note — 250 characters HARD MAXIMUM):
   - This is the short note pasted into LinkedIn's "Easy Apply" message box. It MUST be self-contained and follow this EXACT order:
     (a) Open with an availability question that names the EXACT job title, e.g. "Are you still looking for the [Exact Job Title]? I'm available for it."
     (b) One short line on WHY you're a strong fit — your key strength / stack match in the company's exact tech (e.g. "6+ yrs building Flutter & Next.js products").
     (c) The portfolio link on its own segment, copied verbatim: "Portfolio: https://..."
   - Keep it tight, punchy, and human — a single short paragraph, no greeting, no sign-off, no bullet points.
   - It MUST fit within 250 characters INCLUDING the portfolio URL. If it exceeds 250 chars, shorten the "why you're a fit" clause — NEVER drop the portfolio link or the job title.
   - The exact job title (or one derived from the posting) and the portfolio URL are BOTH mandatory in this note.

2. PROPOSAL: The full proposal email as described above.

Format your response exactly like this:
SUMMARY: [your 250-char max summary here]

PROPOSAL: [your full proposal email here]`;

  const userPrompt = `CANDIDATE PROFILE & WORK HISTORY:
${profileContent}

JOB POSTING:
${jobTitle ? `Title: ${jobTitle}\n` : ""}${jobUrl ? `URL: ${jobUrl}\n` : ""}
Description / Requirements:
${jobText}

Generate a deeply personalized, high-converting application email in 100% pure plain text following the system instructions. Synthesize a real project from the candidate's background that directly matches the job stack, with concrete metrics. The opening availability sentence MUST name the EXACT job title${jobTitle ? ` ("${jobTitle}")` : " derived from the posting"}. The proposal MUST include a "Portfolio: https://..." line copied verbatim from the candidate profile — never omit it. ${jobUrl ? `Include the exact job posting URL (${jobUrl}) in the email body on its own line as "Your posting: ${jobUrl}". ` : ""}The SUMMARY must be a tight <=250-char LinkedIn note that opens with "Are you still looking for the [Exact Job Title]? I'm available for it.", then why you're a fit, then "Portfolio: https://..." — never omit the title or the portfolio link. Do not include any brackets, placeholders, or markdown asterisks.`;

  const payload = {
    model: OPENROUTER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: OPENROUTER_MAX_TOKENS,
  };

  const maxAttempts = OPENROUTER_MAX_RETRIES + 1;
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

  if (!proposal || proposal.trim().length < 50) {
    throw new Error("Model returned an empty or incomplete proposal");
  }

  return { summary, proposal };
}
