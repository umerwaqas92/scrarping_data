import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/constants.dart';

class ProposalResult {
  final String summary;
  final String proposal;

  ProposalResult({required this.summary, required this.proposal});
}

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

    // 7. Clean up unwanted phrasing like "claude testing"
    cleaned = cleaned.replaceAll(RegExp(r'\bclaude\s+testing\b', caseSensitive: false), 'automated testing');
    cleaned = cleaned.replaceAll(RegExp(r'\bClaude\s+Code\s+testing\b', caseSensitive: false), 'automated testing');

    // 8. Clean up triple line spacing
    cleaned = cleaned.replaceAll(RegExp(r'\n{3,}'), '\n\n');

    return cleaned.trim();
  }

  Future<ProposalResult> generateProposal({
    required String profileContent,
    required String jobText,
    String? jobTitle,
    String? jobUrl,
    String? apiKey,
  }) async {
    final combined = '${jobTitle ?? ''} $jobText'.toLowerCase();
    final isFlutter = combined.contains('flutter') || combined.contains('dart');
    final isReactNative = combined.contains('react native') || combined.contains('react-native') || combined.contains('expo');
    final isIos = combined.contains('swift') || combined.contains('swiftui') || combined.contains('uikit') || (combined.contains('ios') && !combined.contains('android'));
    final isAndroid = combined.contains('kotlin') || combined.contains('jetpack compose') || (combined.contains('android') && !combined.contains('ios'));
    final isBackend = combined.contains('backend') || combined.contains('node') || combined.contains('express') || combined.contains('fastapi') || combined.contains('golang') || RegExp(r'\bgo\b').hasMatch(combined);
    final isAi = combined.contains('ai') || combined.contains('llm') || combined.contains('rag') || combined.contains('agent');

    String domainTechBreakdown;
    String domainExclusions;

    if (isFlutter) {
      domainTechBreakdown = '''
4. TARGETED TECH BREAKDOWN FOR FLUTTER (4 comprehensive, targeted bullets):
   - Flutter & Dart Architecture: Flutter 3.x, modern Dart sound null safety, async streams, isolates for heavy computation.
   - State Management & MVVM: Production Bloc/Cubit, Riverpod, Feature-First Clean Architecture, MVVM, and get_it dependency injection.
   - Custom UI & Animations: Pixel-perfect Figma design implementation, Slivers, CustomPainter, 60/120 FPS fluid render performance.
   - Storage, APIs & Stores: Dio, Freezed, SQLite/Hive offline storage, FCM push notifications, MethodChannel native bridges, Apple TestFlight & Google Play Console release management.''';

      domainExclusions = '''
CRITICAL STRICT EXCLUSIONS FOR FLUTTER (ZERO TOLERANCE):
- NEVER mention AWS, GCP, Azure, Docker, Kubernetes, or containerization. Mobile apps run on devices, not containers!
- NEVER mention Node.js, Go, Next.js, React, or Python SaaS backends unless explicitly requested in the posting.
- NEVER mention "Claude testing" or fake AI testing terms. Real testing is flutter_test unit and widget testing!''';
    } else if (isReactNative) {
      domainTechBreakdown = '''
4. TARGETED TECH BREAKDOWN FOR REACT NATIVE (4 crisp bullets):
   - React Native & TypeScript: Expo and Bare workflow across iOS & Android.
   - State Management & Navigation: Redux Toolkit, Zustand, React Navigation.
   - Fluid UI & Animations: StyleSheet, Reanimated, gesture handling.
   - Networking & Native Modules: Axios, MMKV offline caching, Notifee FCM push notifications, Native Modules (Swift/Kotlin).''';
      domainExclusions = '''
CRITICAL STRICT EXCLUSIONS FOR REACT NATIVE:
- NEVER mention Flutter, Dart, Go, Docker, or AWS unless requested. Never say "Claude testing".''';
    } else if (isIos) {
      domainTechBreakdown = '''
4. TARGETED TECH BREAKDOWN FOR iOS (4 crisp bullets):
   - Swift & SwiftUI Architecture: SwiftUI, UIKit, Auto Layout, Combine, async/await.
   - Local Storage & CoreData: CoreData, SwiftData, Keychain security.
   - Networking & Push: URLSession, REST APIs, APNs push notifications.
   - Testing & Store Releases: XCTest unit testing, TestFlight, and App Store Connect releases.''';
      domainExclusions = '''
CRITICAL STRICT EXCLUSIONS FOR iOS:
- NEVER mention Flutter, React Native, Node, Go, Docker, AWS, GCP unless requested.''';
    } else if (isAndroid) {
      domainTechBreakdown = '''
4. TARGETED TECH BREAKDOWN FOR ANDROID (4 crisp bullets):
   - Kotlin & Jetpack Compose: Modern Kotlin, Compose, Material 3, Coroutines, StateFlow.
   - Architecture & DI: MVVM, Clean Architecture, Hilt/Dagger dependency injection.
   - Data & Networking: Room DB, DataStore, Retrofit, OkHttp, FCM push notifications.
   - Background & Releases: WorkManager foreground services, JUnit/Espresso testing, Google Play Console.''';
      domainExclusions = '''
CRITICAL STRICT EXCLUSIONS FOR ANDROID:
- NEVER mention Flutter, Swift, Node, Go, Docker, AWS, GCP unless requested.''';
    } else if (isBackend) {
      domainTechBreakdown = '''
4. TARGETED TECH BREAKDOWN FOR BACKEND (4 crisp bullets):
   - Backend APIs: High-throughput REST & gRPC APIs with clean architecture.
   - Database Systems: PostgreSQL, MongoDB, indexing, query optimization, Redis caching.
   - Security & Queues: JWT/OAuth2 authentication, RBAC, background worker queues.
   - Testing & Cloud: Automated integration testing, Docker containerization, CI/CD pipelines.''';
      domainExclusions = '''
CRITICAL STRICT EXCLUSIONS FOR BACKEND:
- NEVER mention Flutter, Dart, Swift, or mobile UI unless requested.''';
    } else if (isAi) {
      domainTechBreakdown = '''
4. TARGETED TECH BREAKDOWN FOR AI / LLM (4 crisp bullets):
   - LLM APIs & Integration: OpenAI, Claude, DeepSeek with structured tool calling.
   - Hybrid RAG & Vector DBs: Pinecone, pgvector, chunking and high-accuracy retrieval.
   - Autonomous Agents: Agent sandboxes (Ardent copy-on-write Postgres sandboxes in <6s), multi-agent pipelines.
   - Performance & Optimization: Semantic caching, token streaming, cost reduction by ~40%.''';
      domainExclusions = '''
CRITICAL STRICT EXCLUSIONS FOR AI:
- NEVER mention Flutter or mobile UI unless specifically for Mobile AI.''';
    } else {
      domainTechBreakdown = '''
4. TARGETED TECH BREAKDOWN (4 crisp bullets):
   - Frontend Architecture: React, Next.js, TypeScript, Tailwind CSS.
   - Backend & APIs: Node.js, Python, PostgreSQL, REST APIs.
   - Authentication & Storage: OAuth2, Redis, database schema design.
   - Delivery & Testing: Automated unit testing, CI/CD, production deployments.''';
      domainExclusions = '''
Ensure all skills directly match the job requirements without stuffing unrelated buzzwords.''';
    }

    final systemPrompt = '''You are a world-class technical copywriter and senior developer crafting highly customized, high-converting direct job application / proposal emails for recruiters and hiring managers.

YOUR OBJECTIVE:
Generate an irresistible, hyper-targeted, high-converting application email that immediately stands out from generic AI templates by being specific to the company/job, providing concrete project proof with measurable metrics, and mapping directly to their tech stack with strict technical accuracy.

CRITICAL TECHNICAL ACCURACY RULES:
1. FRAMEWORK SEPARATION: Never conflate separate technologies (e.g., NEVER say "React Native (via Flutter)"). React Native is JS/TS; Flutter is Dart. If the job asks for React Native, pitch React Native. If it asks for Flutter, pitch Flutter.
2. BACKEND MATCHING: When a job specifies a backend framework (e.g., Django), pitch that framework directly (Django REST framework, ORM, PostgreSQL).
3. STRICT DOMAIN RELEVANCE:
   - For mobile / Flutter / iOS / Android roles: NEVER mention AWS, GCP, Azure, Docker, Kubernetes, or server backend stacks unless the job description specifically asks for them!
   - NEVER use the phrase "Claude testing" or make up artificial testing buzzwords. Use real automated testing terms (flutter_test, unit & widget testing, Jest, XCTest, JUnit).
4. DEFENSIBLE METRICS: Use realistic metrics (e.g., "shipped production MVP in 3-4 weeks", "cut API response times by 40%", "22+ published apps").

PROVEN HIGH-CONVERTING STRUCTURE:
1. SUBJECT LINE:
   Subject: [Job Title/Role] Application — [Core Tech 1] & [Core Tech 2] ([Years of Exp, e.g. ${isFlutter ? '5+ Years' : '7+ Years'}])
2. GREETING & TAILORED HOOK:
   "Hi [Company Name] Team," or "Hi [Hiring Manager]," referencing what they are building.
3. CONCRETE FEATURED PROJECT:
   One relevant, high-impact project from candidate's background with matching stack and measurable outcome (e.g. ${isFlutter ? 'AI Influencer Generator or Zeely AI Marketing Platform' : 'matching project from profile'}).
$domainTechBreakdown
5. VERIFIABLE PROOF & SOCIAL PROOF LINKS:
   Candidate's Upwork Top Rated, Portfolio, ${isFlutter ? 'Flutter Resume (https://umerwaqas.lovable.app?resume=3), ' : ''}GitHub, LinkedIn.
6. CRISP CALL TO ACTION & SIGN-OFF.

$domainExclusions

CRITICAL FORMATTING RULES:
- Write strictly in 100% PLAIN TEXT.
- NEVER use markdown asterisks (**bold** or *italic*).
- NEVER use bracketed placeholders like [project name] or [Company]. Always extract or synthesize real details.
- Keep around 200-280 words.

OUTPUT FORMAT:
You must output EXACTLY two sections separated by a double newline:

1. SUMMARY: A concise 250-character maximum elevator pitch summarizing why you're the perfect fit for this role. Include your key strength, relevant experience years, and one standout metric. This will be used as a quick preview.

2. PROPOSAL: The full proposal email as described above.

Format your response exactly like this:
SUMMARY: [your 250-char max summary here]

PROPOSAL: [your full proposal email here]''';

    final userPrompt = '''CANDIDATE PROFILE & WORK HISTORY:
$profileContent

JOB POSTING:
${jobTitle != null && jobTitle.isNotEmpty ? 'Title: $jobTitle\n' : ''}${jobUrl != null && jobUrl.isNotEmpty ? 'URL: $jobUrl\n' : ''}
Description / Requirements:
$jobText

Target Domain: ${isFlutter ? 'FLUTTER & MOBILE' : isReactNative ? 'REACT NATIVE' : isIos ? 'iOS' : isAndroid ? 'ANDROID' : isBackend ? 'BACKEND' : isAi ? 'AI / LLM' : 'GENERAL'}

$domainExclusions

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

    final cleaned = cleanMarkdownToPlainText(rawContent);

    // Parse SUMMARY and PROPOSAL sections
    final summaryMatch = RegExp(r'^SUMMARY:\s*([\s\S]*?)(?=\n\s*\n\s*PROPOSAL:)', caseSensitive: false).firstMatch(cleaned);
    final proposalMatch = RegExp(r'PROPOSAL:\s*([\s\S]*?)$', caseSensitive: false).firstMatch(cleaned);

    String summary = summaryMatch?.group(1)?.trim() ?? '';
    String proposal = proposalMatch?.group(1)?.trim() ?? cleaned;

    // Post-sanitize unwanted skills and errant phrases for Flutter
    if (isFlutter) {
      if (!jobText.toLowerCase().contains('docker')) {
        proposal = proposal.replaceAll(RegExp(r'\b(?:with\s+)?Docker,?\s*(?:and\s+)?', caseSensitive: false), '');
      }
      if (!jobText.toLowerCase().contains('aws') && !jobText.toLowerCase().contains('gcp')) {
        proposal = proposal.replaceAll(RegExp(r'\bAWS\s*(?:\/|\s*and\s*)\s*GCP,?\s*', caseSensitive: false), '');
        proposal = proposal.replaceAll(RegExp(r'\b(?:AWS|GCP),?\s*', caseSensitive: false), '');
      }
    }

    // Fallback: if no SUMMARY/PROPOSAL markers, use first 250 chars as summary
    if (summaryMatch == null) {
      summary = cleaned.length > 250 ? cleaned.substring(0, 250).trim() : cleaned;
    }

    // Ensure summary is max 250 chars
    if (summary.length > 250) {
      summary = '${summary.substring(0, 247)}...';
    }

    return ProposalResult(summary: summary, proposal: proposal);
  }
}
