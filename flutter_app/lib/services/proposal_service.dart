import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/constants.dart';

class ProposalService {
  /// Strips markdown syntax returning 100% clean plain text for email clients
  static String cleanMarkdownToPlainText(String text) {
    String cleaned = text;

    // 1. Remove code blocks
    cleaned = cleaned.replaceAllMapped(
      RegExp(r'```[a-zA-Z]*\n?([\s\S]*?)\n?```'),
      (m) => m.group(1) ?? '',
    );

    // 2. Convert markdown links: [text](url)
    cleaned = cleaned.replaceAllMapped(
      RegExp(r'\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)'),
      (m) {
        final label = (m.group(1) ?? '').trim();
        final url = m.group(2) ?? '';
        final lower = label.toLowerCase();
        if (label == url || lower.startsWith('link to') || lower == 'link') {
          return url;
        }
        return '$label: $url';
      },
    );

    // 3. Remove bold / strong formatting
    cleaned = cleaned.replaceAllMapped(RegExp(r'\*\*([^*]+)\*\*'), (m) => m.group(1) ?? '');
    cleaned = cleaned.replaceAllMapped(RegExp(r'__([^_]+)__'), (m) => m.group(1) ?? '');

    // 4. Remove emphasis asterisks / underscores
    cleaned = cleaned.replaceAllMapped(RegExp(r'(^|[^\*])\*([^\*\n]+)\*([^\*]|$)'), (m) => '${m[1]}${m[2]}${m[3]}');
    cleaned = cleaned.replaceAllMapped(RegExp(r'(^|[^_])_([^_\n]+)_([^_]|$)'), (m) => '${m[1]}${m[2]}${m[3]}');

    // 5. Remove markdown headers
    cleaned = cleaned.replaceAll(RegExp(r'^#{1,6}\s+', multiLine: true), '');

    // 6. Normalize bullet points
    cleaned = cleaned.replaceAll(RegExp(r'^[\*\+]\s+', multiLine: true), '- ');

    // 7. Clean up triple line spacing
    cleaned = cleaned.replaceAll(RegExp(r'\n{3,}'), '\n\n');

    return cleaned.trim();
  }

  Future<String> generateProposal({
    required String profileContent,
    required String jobText,
    String? jobTitle,
    String? jobUrl,
    String? apiKey,
  }) async {
    const systemPrompt = '''You are a world-class technical copywriter and senior developer crafting highly customized, high-converting direct job application / proposal emails for recruiters and hiring managers.

YOUR OBJECTIVE:
Generate an irresistible, hyper-targeted, high-converting application email that immediately stands out from generic AI templates by being specific to the company/job, providing concrete project proof with measurable metrics, and mapping directly to their tech stack with strict technical accuracy.

CRITICAL TECHNICAL ACCURACY RULES:
1. FRAMEWORK SEPARATION: Never conflate separate technologies (e.g., NEVER say "React Native (via Flutter)"). React Native is JS/TS; Flutter is Dart. If the job asks for React Native, pitch React Native. If it asks for Flutter, pitch Flutter.
2. BACKEND MATCHING: When a job specifies a backend framework (e.g., Django), pitch that framework directly (Django REST framework, ORM, PostgreSQL).
3. STRICT CLOUD VS AI CATEGORIZATION:
   - Cloud & DevOps: ONLY list genuine cloud infrastructure (AWS: EC2, RDS, S3, Lambda; Docker; GitHub Actions).
   - AI & Data: Keep RAG systems, vector databases (Pinecone, pgvector), LLM APIs (OpenAI, Claude) under AI Integration.
4. DEFENSIBLE METRICS: Use realistic metrics (e.g., "shipped production MVP in 3-4 weeks", "cut API response times by 40%", "scaled to 10k+ active users").

PROVEN HIGH-CONVERTING STRUCTURE:
1. SUBJECT LINE:
   Subject: [Job Title/Role] Application — [Core Tech 1], [Core Tech 2] & [Core Tech 3] ([Years of Exp, e.g. 6+ Years])
2. GREETING & TAILORED HOOK:
   "Hi [Company Name] Team," or "Hi [Hiring Manager]," referencing what they are building.
3. CONCRETE FEATURED PROJECT:
   One relevant, high-impact project from candidate's background with matching stack and measurable outcome.
4. TARGETED TECH BREAKDOWN (3-4 crisp bullets):
   - Backend: [Stack details]
   - Frontend / Mobile: [Stack details]
   - Cloud & DevOps: [AWS / Docker / CI/CD]
   - AI / LLM (if relevant): [Capabilities]
5. VERIFIABLE PROOF & SOCIAL PROOF LINKS:
   Candidate's Upwork Top Rated, Portfolio, GitHub, LinkedIn.
6. CRISP CALL TO ACTION & SIGN-OFF.

CRITICAL FORMATTING RULES:
- Write strictly in 100% PLAIN TEXT.
- NEVER use markdown asterisks (**bold** or *italic*).
- NEVER use bracketed placeholders like [project name] or [Company]. Always extract or synthesize real details.
- Keep around 200-280 words.''';

    final userPrompt = '''CANDIDATE PROFILE & WORK HISTORY:
$profileContent

JOB POSTING:
${jobTitle != null && jobTitle.isNotEmpty ? 'Title: $jobTitle\n' : ''}${jobUrl != null && jobUrl.isNotEmpty ? 'URL: $jobUrl\n' : ''}
Description / Requirements:
$jobText

Generate a deeply personalized, high-converting application email in 100% pure plain text following the system instructions. Synthesize a real project from the candidate's background that directly matches the job stack, with concrete metrics. Do not include any brackets or markdown asterisks.''';

    final key = apiKey != null && apiKey.isNotEmpty ? apiKey : AppConstants.mimoApiKey;

    final response = await http.post(
      Uri.parse(AppConstants.mimoEndpoint),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $key',
      },
      body: jsonEncode({
        'model': AppConstants.mimoModel,
        'messages': [
          {'role': 'system', 'content': systemPrompt},
          {'role': 'user', 'content': userPrompt},
        ],
        'temperature': 0.7,
        'max_tokens': 1500,
      }),
    ).timeout(const Duration(seconds: 25));

    if (response.statusCode != 200) {
      throw Exception('MiMo API error (${response.statusCode}): ${response.body}');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final rawContent = data['choices']?[0]?['message']?['content'] as String?;
    if (rawContent == null || rawContent.isEmpty) {
      throw Exception('No response generated by MiMo API');
    }

    return cleanMarkdownToPlainText(rawContent);
  }
}
