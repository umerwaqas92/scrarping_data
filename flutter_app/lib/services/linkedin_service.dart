import 'dart:async';
import 'package:http/http.dart' as http;
import '../models/feed_item.dart';
import '../models/app_settings.dart';
import '../utils/lead_extractor.dart';

class LinkedInService {
  static const String _userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // In-memory cache for queries
  final Map<String, List<FeedItem>> _cache = {};

  ({String cookieHeader, String? csrfToken}) _parseCookies(String rawCookies) {
    if (rawCookies.trim().isEmpty) {
      return (cookieHeader: '', csrfToken: null);
    }

    final List<String> cookiePairs = [];
    String? csrfToken;

    // Check if it's standard Netscape tab-separated format or semicolon-separated
    final lines = rawCookies.split('\n');
    for (final line in lines) {
      final trimmed = line.trim();
      if (trimmed.isEmpty || trimmed.startsWith('#')) continue;

      final parts = trimmed.split('\t');
      if (parts.length >= 7) {
        final name = parts[5].trim();
        final rawVal = parts[6].trim();
        if (name.isNotEmpty && rawVal.isNotEmpty) {
          cookiePairs.add('$name=$rawVal');
          if (name == 'JSESSIONID') {
            csrfToken = rawVal.replaceAll('"', '');
          }
        }
      }
    }

    // If no tab-separated pairs found, parse as semicolon-separated
    if (cookiePairs.isEmpty) {
      final pairs = rawCookies.split(';');
      for (final pair in pairs) {
        final trimmed = pair.trim();
        if (trimmed.isEmpty) continue;
        final eqIdx = trimmed.indexOf('=');
        if (eqIdx != -1) {
          final name = trimmed.substring(0, eqIdx).trim();
          final val = trimmed.substring(eqIdx + 1).trim();
          cookiePairs.add('$name=$val');
          if (name == 'JSESSIONID') {
            csrfToken = val.replaceAll('"', '');
          }
        }
      }
    }

    return (
      cookieHeader: cookiePairs.join('; '),
      csrfToken: csrfToken,
    );
  }

  Future<List<FeedItem>> searchPosts(String query, AppSettings settings, {int limit = 20}) async {
    final cleanQuery = query.trim();
    if (cleanQuery.isEmpty) return const [];

    final parsed = _parseCookies(settings.linkedInCookies);
    if (parsed.cookieHeader.isEmpty) return const [];

    final cacheKey = '${cleanQuery.toLowerCase()}:$limit';
    if (_cache.containsKey(cacheKey)) {
      return _cache[cacheKey]!;
    }

    final subQueries = [
      cleanQuery,
      '$cleanQuery developer',
      '$cleanQuery engineer',
      '$cleanQuery hiring',
      '$cleanQuery job',
      '$cleanQuery mobile',
      '$cleanQuery app',
      '$cleanQuery remote',
      '$cleanQuery project',
      '$cleanQuery tech',
    ];

    final results = await Future.wait(
      subQueries.map((sq) => _fetchSingleQuery(sq, parsed.cookieHeader, parsed.csrfToken)),
    );

    final Set<String> seenUrls = {};
    final List<FeedItem> allItems = [];

    for (final list in results) {
      for (final item in list) {
        if (!seenUrls.contains(item.postUrl)) {
          seenUrls.add(item.postUrl);
          allItems.add(item);
        }
      }
    }

    // Sort by latest posted date
    allItems.sort((a, b) => b.postedAt.compareTo(a.postedAt));

    final targetItems = allItems.take(limit).toList();

    // Fast parallel enrich with short timeout (max 4s) so feed never blocks
    final enriched = await Future.wait(
      targetItems.map((p) => _enrichPost(p, parsed.cookieHeader, parsed.csrfToken)),
    );

    _cache[cacheKey] = enriched;
    return enriched;
  }

  Future<List<FeedItem>> _fetchSingleQuery(
    String query,
    String cookieHeader,
    String? csrfToken,
  ) async {
    final url = Uri.parse(
      'https://www.linkedin.com/search/results/content/?keywords=${Uri.encodeComponent(query)}&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D',
    );

    final Map<String, String> headers = {
      'user-agent': _userAgent,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cookie': cookieHeader,
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'csrf-token': ?csrfToken,
    };

    try {
      final response = await http.get(url, headers: headers).timeout(const Duration(seconds: 12));
      if (response.statusCode != 200) return const [];

      final html = response.body;
      final List<FeedItem> posts = [];
      final Set<String> seenPostUrls = {};

      final postSlugMatches = RegExp(r'postSlugUrl\\?":\s*\\?"(https:[^\\"]+)\\"?').allMatches(html);
      final genericPostMatches = RegExp(r'https:\/\/[a-z0-9\.]*linkedin\.com\/posts\/([a-zA-Z0-9_\-%]+)').allMatches(html);

      final allMatches = [...postSlugMatches, ...genericPostMatches];

      for (final m in allMatches) {
        String rawUrl = (m.group(1) ?? m.group(0) ?? '').replaceAll(r'\', '');
        if (rawUrl.contains('/posts/')) {
          rawUrl = 'https://www.linkedin.com/posts/${rawUrl.split('/posts/').last}';
        } else {
          continue;
        }
        if (rawUrl.isEmpty || seenPostUrls.contains(rawUrl)) continue;
        seenPostUrls.add(rawUrl);

        final idx = m.start;
        final start = (idx - 6000).clamp(0, html.length);
        final end = (idx + 6000).clamp(0, html.length);
        final chunk = html.substring(start, end);

        final urnMatch = RegExp(r'urn:li:(?:activity|ugcPost):(\d+)').firstMatch(chunk);
        final idDigitsMatch = RegExp(r'(\d{15,22})').firstMatch(rawUrl);
        final id = urnMatch != null
            ? urnMatch.group(0)!
            : (idDigitsMatch != null
                ? 'urn:li:activity:${idDigitsMatch.group(1)}'
                : 'urn:li:activity:${DateTime.now().millisecondsSinceEpoch}');

        final actorMatch = RegExp(r'actorName\\?":\s*\\?"([^\\"]+)\\"?').firstMatch(chunk);
        String authorName = actorMatch?.group(1) ?? '';
        if (authorName.isEmpty) {
          final nameMatch = RegExp(
                  r'&quot;name&quot;:\{&quot;textDirection&quot;:&quot;[A-Z_]+&quot;,&quot;text&quot;:&quot;([^&"]+)&quot;')
              .firstMatch(chunk);
          if (nameMatch != null) {
            authorName = nameMatch.group(1)!;
          } else {
            // Extract from URL slug e.g. /posts/authorname_...
            final slugAuthor = rawUrl.split('/posts/').last.split('_').first;
            authorName = slugAuthor.isNotEmpty && slugAuthor.length > 2
                ? slugAuthor
                : 'LinkedIn Professional';
          }
        }

        String authorHeadline = '';
        final headlineMatch = RegExp(
                r'&quot;description&quot;:\{&quot;textDirection&quot;:&quot;[A-Z_]+&quot;,&quot;text&quot;:&quot;([^&"]+)&quot;')
            .firstMatch(chunk);
        if (headlineMatch != null) {
          authorHeadline = headlineMatch
                  .group(1)
                  ?.replaceAll('&amp;', '&')
                  .replaceAll('&lt;', '<')
                  .replaceAll('&gt;', '>') ??
              '';
        }

        DateTime postedAt = DateTime.now();
        final urnDigitsMatch = RegExp(r'\d{15,22}').firstMatch(id);
        if (urnDigitsMatch != null) {
          try {
            final idBigInt = BigInt.parse(urnDigitsMatch.group(0)!);
            final timestampMs = (idBigInt >> 22).toInt();
            if (timestampMs > 1500000000000 && timestampMs < 2500000000000) {
              postedAt = DateTime.fromMillisecondsSinceEpoch(timestampMs);
            }
          } catch (_) {}
        }

        final slugTitle = rawUrl.contains('/posts/')
            ? rawUrl
                .split('/posts/')[1]
                .split('-share-')[0]
                .split('-ugcPost-')[0]
                .replaceAll(RegExp(r'^[a-z0-9-]+_', caseSensitive: false), '')
                .replaceAll('-', ' ')
            : '';

        // Use slug title as short content (full content comes from enrichPost)
        String content = slugTitle.isNotEmpty
            ? slugTitle[0].toUpperCase() + slugTitle.substring(1)
            : '$query on LinkedIn';

        final emails = LeadExtractor.extractEmails('$content $authorName $authorHeadline');
        final phones = LeadExtractor.extractPhones('$content $authorName $authorHeadline');

        posts.add(FeedItem(
          id: id,
          source: FeedSource.linkedin,
          authorName: authorName,
          authorHeadline: authorHeadline.isNotEmpty ? authorHeadline : 'LinkedIn Professional',
          authorPicture: '',
          authorUrl:
              'https://www.linkedin.com/search/results/all/?keywords=${Uri.encodeComponent(authorName)}',
          content: content,
          postUrl: rawUrl,
          postedAt: postedAt,
          extractedEmails: emails,
          extractedPhones: phones,
        ));
      }

      return posts;
    } catch (_) {
      return const [];
    }
  }

  String _decodeUnicodeAndHtml(String raw) {
    // Match Node API behavior: remove unicode escapes and decode HTML entities
    return raw
        .replaceAll('&#92;n', '\n')
        .replaceAll(r'\n', '\n')
        .replaceAll('&#39;', "'")
        .replaceAll('&quot;', '"')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll(RegExp(r'&#92;u[0-9a-fA-F]{4}'), '')  // Remove HTML-encoded unicode
        .replaceAll(RegExp(r'\\u[0-9a-fA-F]{4}'), '')     // Remove literal unicode escapes
        .trim();
  }

  Future<FeedItem> _enrichPost(FeedItem item, String cookieHeader, String? csrfToken) async {
    try {
      final response = await http.get(
        Uri.parse(item.postUrl),
        headers: <String, String>{
          'user-agent': _userAgent,
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'cookie': cookieHeader,
          'csrf-token': ?csrfToken,
        },
      ).timeout(const Duration(seconds: 5));

      if (response.statusCode != 200) return item;
      final html = response.body;

      // 1. Author Name
      String authorName = item.authorName;
      final miniProfileMatch = RegExp(
              r'&quot;firstName&quot;:&quot;([^&"]+)&quot;[\s\S]{0,200}?&quot;lastName&quot;:&quot;([^&"]+)&quot;')
          .firstMatch(html);
      if (miniProfileMatch != null) {
        authorName = _decodeUnicodeAndHtml('${miniProfileMatch.group(1)} ${miniProfileMatch.group(2)}');
      } else {
        final nameMatch = RegExp(
                r'&quot;name&quot;:\{&quot;textDirection&quot;:&quot;[^&"]*&quot;,&quot;text&quot;:&quot;([^&"]+)&quot;')
            .firstMatch(html);
        if (nameMatch != null) {
          authorName = _decodeUnicodeAndHtml(nameMatch.group(1)!);
        }
      }

      // 2. Author Headline
      String authorHeadline = item.authorHeadline;
      final userLocaleMatches = RegExp(
              r'&quot;description&quot;:\{&quot;textDirection&quot;:&quot;USER_LOCALE&quot;,&quot;text&quot;:&quot;((?:(?!&quot;)[\s\S])+?)&quot;')
          .allMatches(html);
      for (final m in userLocaleMatches) {
        final val = (m.group(1) ?? '').trim();
        if (val.length > 5 && val.length < 300 && !val.contains('com.linkedin')) {
          authorHeadline = _decodeUnicodeAndHtml(val);
          break;
        }
      }
      if (authorHeadline.isEmpty || authorHeadline == 'LinkedIn Professional') {
        final headlineMatches = RegExp(r'&quot;headline&quot;:&quot;((?:(?!&quot;)[\s\S])+?)&quot;').allMatches(html);
        for (final m in headlineMatches) {
          final val = (m.group(1) ?? '').trim();
          if (val.length > 3 && val.length < 300 && !val.contains('com.linkedin') && !val.contains('/')) {
            authorHeadline = _decodeUnicodeAndHtml(val);
            break;
          }
        }
      }

      // 3. Post Content (extract complete post commentary block)
      String content = item.content;
      final textMatches = RegExp(
              r'&quot;textDirection&quot;:&quot;[^&"]*&quot;,&quot;text&quot;:&quot;([\s\S]*?)&quot;')
          .allMatches(html)
          .map((m) => m.group(1) ?? '')
          .where((t) => t != authorHeadline && !t.startsWith('http') && !t.contains('&quot;') && t.length > 20)
          .toList();

      textMatches.sort((a, b) => b.length.compareTo(a.length));
      if (textMatches.isNotEmpty) {
        content = _decodeUnicodeAndHtml(textMatches.first);
      }

      // 4. Author Picture (target post author avatar / company logo)
      String authorPicture = item.authorPicture;
      final picMatch = RegExp(
              r'&quot;(?:nonEntityProfilePicture|nonEntityCompanyLogo|companyLogo)&quot;:\{&quot;[^t][\s\S]*?&quot;rootUrl&quot;:&quot;(https:\/\/media\.licdn\.com\/dms\/image\/v2\/[^&"]+)&quot;')
          .firstMatch(html);
      if (picMatch != null) {
        final rootUrl = picMatch.group(1) ?? '';
        final segMatch = RegExp(r'&quot;fileIdentifyingUrlPathSegment&quot;:&quot;((?:(?!&quot;)[\s\S])+?)&quot;')
            .firstMatch(picMatch.group(0) ?? '');
        if (segMatch != null) {
          authorPicture = rootUrl + (segMatch.group(1)?.replaceAll('&amp;', '&').replaceAll('&#61;', '=') ?? '');
        } else {
          authorPicture = rootUrl;
        }
      }

      final combined = '$content $authorName $authorHeadline';
      final emails = LeadExtractor.extractEmails(combined);
      final phones = LeadExtractor.extractPhones(combined);

      return item.copyWith(
        authorName: authorName.isNotEmpty ? authorName : item.authorName,
        authorHeadline: authorHeadline.isNotEmpty ? authorHeadline : item.authorHeadline,
        authorPicture: authorPicture,
        content: content.isNotEmpty ? content : item.content,
        extractedEmails: emails,
        extractedPhones: phones,
      );
    } catch (_) {
      return item;
    }
  }
}
