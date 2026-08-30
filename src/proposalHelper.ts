const MIMO_ENDPOINT = "https://opencode.ai/zen/go/v1/chat/completions";
const MIMO_MODEL = "mimo-v2.5";
const MIMO_API_KEY = "sk-tiCmvyYVq8duMmWubkiUXqw2jgacat9FrGamiWhDd87sj92A7cKeaWlGuKqUNPRO";

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

  // 7. Clean up double spacing or leftover artifacts
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

2. GREETING & TAILORED HOOK:
   - Personalized Greeting: "Hi [Company Name] Team," or "Hi [Hiring Manager's Name if in post]," or "Hi Recruiting Team,".
   - Specific Hook: Directly state the role applying for at the specific company, reference what the company is building or the specific problem they are solving from the post, and highlight relevant years of experience (e.g. 6+ years) in their exact stack. Zero generic filler.

3. CONCRETE FEATURED PROJECT (PROOF OVER PROMISES):
   - Replace generic claims ("I'm a direct match", "aligns perfectly") with ONE concrete, high-impact relevant project from the candidate's background/portfolio that ties the required stack together.
   - Structure: "A recent example: [Real Project from Candidate Profile], where I built [app/platform description] using [matching stack, e.g. Django/PostgreSQL backend + React Native/Next.js frontend] deployed on [AWS/GCP/Cloud] with [CI/CD / architecture highlight], [concrete outcome/metric, e.g., 'scaling to 10k+ users' / 'reducing API latency by 40%' / 'shipping production MVP in 3-4 weeks']."

4. TARGETED TECH & ARCHITECTURE BREAKDOWN:
   - 3 to 4 crisp bullet points mapping directly to what this specific job post asked for:
     - Backend: [Key backend tech matching job, e.g., Django REST APIs, PostgreSQL schema design & query optimization, security & scalability]
     - Frontend: [Key frontend tech matching job, e.g., React Native / Next.js, responsive UI & clean state architecture]
     - Cloud & DevOps: [AWS (EC2, RDS, S3, Lambda), Docker, CI/CD pipelines for reliable automated deployments]
     - AI / LLM Integration (if relevant to post or candidate): [Specific capability, e.g., RAG systems, vector embeddings, LLM API integration, prompt orchestration, data pipelines]

5. VERIFIABLE PROOF & SOCIAL PROOF LINKS:
   - Direct raw links from candidate profile (Upwork Top Rated / 100% Job Success, Portfolio, GitHub, LinkedIn).

6. CRISP, LOW-FRICTION CALL TO ACTION:
   - Clear availability (full-time, remote, quick ramp-up).
   - Conversational, proactive close: "Happy to walk through any of the above architecture or code in more detail — let me know a good time to talk this week."

7. SIGN-OFF:
   - Professional closing with candidate's full name, email, and phone/WhatsApp number.

CRITICAL FORMATTING & CONTENT RULES:
- Write strictly in 100% PLAIN TEXT.
- NEVER use markdown bold asterisks (do NOT write **bold** or *italic*).
- NEVER use markdown link syntax (do NOT write [Text](url)). Write plain URLs directly (e.g., Portfolio: https://...).
- NEVER output bracketed placeholders like [project name], [Company], [X%], [Hiring Manager]. Always extract the actual company/details or synthesize real projects and realistic metrics from the candidate profile!
- Keep tone confident, direct, concise, and professional (around 200-280 words).

OUTPUT FORMAT:
You must output EXACTLY two sections separated by a double newline:

1. SUMMARY: A concise 250-character maximum elevator pitch summarizing why you're the perfect fit for this role. Include your key strength, relevant experience years, and one standout metric. This will be used as a quick preview.

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

Generate a deeply personalized, high-converting application email in 100% pure plain text following the system instructions. Synthesize a real project from the candidate's background that directly matches the job stack, with concrete metrics. Do not include any brackets, placeholders, or markdown asterisks.`;

  const response = await (globalThis.fetch || fetch)(MIMO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MIMO_API_KEY}`,
    },
    body: JSON.stringify({
      model: MIMO_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MiMo API returned error (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as any;
  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("No response content generated by MiMo API");
  }

  // Sanitize and ensure pure plain text email output
  const cleaned = cleanMarkdownToPlainText(rawContent);

  // Parse SUMMARY and PROPOSAL sections
  const summaryMatch = cleaned.match(/^SUMMARY:\s*([\s\S]*?)(?=\n\s*\n\s*PROPOSAL:)/i);
  const proposalMatch = cleaned.match(/PROPOSAL:\s*([\s\S]*?)$/i);

  let summary = summaryMatch ? summaryMatch[1].trim() : "";
  let proposal = proposalMatch ? proposalMatch[1].trim() : cleaned;

  // Fallback: if no SUMMARY/PROPOSAL markers, use first 250 chars as summary
  if (!summaryMatch) {
    summary = cleaned.substring(0, 250).trim();
    if (summary.length === cleaned.length) {
      // Entire text is short enough, use it as both
      summary = cleaned;
    }
  }

  // Ensure summary is max 250 chars
  if (summary.length > 250) {
    summary = summary.substring(0, 247) + "...";
  }

  return { summary, proposal };
}
