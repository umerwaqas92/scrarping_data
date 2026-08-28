import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/feed_item.dart';
import '../utils/lead_extractor.dart';

import '../models/app_settings.dart';

class RedditService {
  static const String _userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  String _parseCookies(String rawCookies) {
    if (rawCookies.trim().isEmpty) return '';
    final List<String> cookiePairs = [];

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
        }
      }
    }

    if (cookiePairs.isEmpty) {
      final pairs = rawCookies.split(';');
      for (final pair in pairs) {
        final trimmed = pair.trim();
        if (trimmed.isNotEmpty && trimmed.contains('=')) {
          cookiePairs.add(trimmed);
        }
      }
    }

    return cookiePairs.join('; ');
  }

  Future<List<FeedItem>> search(String query, AppSettings settings, {int count = 25, String? after}) async {
    final cleanQuery = query.trim();
    if (cleanQuery.isEmpty) return const [];

    final cookieHeader = _parseCookies(settings.redditCookies);

    final url = Uri.parse(
      'https://www.reddit.com/search.json?q=${Uri.encodeComponent(cleanQuery)}&limit=$count&sort=new${after != null ? '&after=$after' : ''}',
    );

    try {
      final headers = <String, String>{
        'User-Agent': _userAgent,
        'Accept': 'application/json',
        if (cookieHeader.isNotEmpty) 'Cookie': cookieHeader,
      };

      final response = await http.get(url, headers: headers).timeout(const Duration(seconds: 12));

      if (response.statusCode != 200) {
        throw Exception('Reddit returned HTTP ${response.statusCode}');
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final children = (data['data']?['children'] as List<dynamic>?) ?? [];

      final List<FeedItem> items = [];

      for (final child in children) {
        final post = child['data'] as Map<String, dynamic>?;
        if (post == null) continue;

        final title = (post['title'] as String?) ?? '';
        final selftext = (post['selftext'] as String?) ?? '';
        final author = (post['author'] as String?) ?? 'reddit_user';
        final subreddit = (post['subreddit'] as String?) ?? '';
        final permalink = (post['permalink'] as String?) ?? '';
        final urlStr = (post['url'] as String?) ?? 'https://reddit.com$permalink';
        final createdUtc = (post['created_utc'] as num?)?.toDouble() ?? 0;
        final numComments = (post['num_comments'] as int?) ?? 0;
        final score = (post['score'] as int?) ?? 0;
        final thumbnail = (post['thumbnail'] as String?) ?? '';

        final fullContent = title.isNotEmpty && selftext.isNotEmpty
            ? '$title\n\n$selftext'
            : (title.isNotEmpty ? title : selftext);

        final combinedTextForLeads = '$fullContent $author';
        final emails = LeadExtractor.extractEmails(combinedTextForLeads);
        final phones = LeadExtractor.extractPhones(combinedTextForLeads);

        final postedAt = createdUtc > 0
            ? DateTime.fromMillisecondsSinceEpoch((createdUtc * 1000).toInt(), isUtc: true).toLocal()
            : DateTime.now();

        items.add(FeedItem(
          id: (post['id'] as String?) ?? 'reddit_${DateTime.now().millisecondsSinceEpoch}',
          source: FeedSource.reddit,
          authorName: 'u/$author',
          authorHeadline: subreddit.isNotEmpty ? 'r/$subreddit' : 'Reddit Community',
          authorPicture: thumbnail.startsWith('http') ? thumbnail : '',
          authorUrl: 'https://reddit.com/user/$author',
          content: fullContent,
          postUrl: permalink.isNotEmpty ? 'https://reddit.com$permalink' : urlStr,
          postedAt: postedAt,
          likes: score,
          comments: numComments,
          extractedEmails: emails,
          extractedPhones: phones,
        ));
      }

      return items;
    } catch (e) {
      // Return empty list or bubble up error
      return [];
    }
  }
}
