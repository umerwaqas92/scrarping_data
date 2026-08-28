import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/constants.dart';
import '../models/feed_item.dart';
import '../models/app_settings.dart';
import '../utils/lead_extractor.dart';

class XSearchResult {
  final List<FeedItem> tweets;
  final String? nextCursor;
  const XSearchResult({required this.tweets, this.nextCursor});
}

class XService {
  static const List<String> _features = [
    "rweb_video_screen_enabled",
    "rweb_cashtags_enabled",
    "profile_label_improvements_pcf_label_in_post_enabled",
    "responsive_web_profile_redirect_enabled",
    "rweb_tipjar_consumption_enabled",
    "verified_phone_label_enabled",
    "creator_subscriptions_tweet_preview_api_enabled",
    "responsive_web_graphql_timeline_navigation_enabled",
    "premium_content_api_read_enabled",
    "communities_web_enable_tweet_community_results_fetch",
    "c9s_tweet_anatomy_moderator_badge_enabled",
    "responsive_web_grok_analyze_button_fetch_trends_enabled",
    "responsive_web_grok_analyze_post_followups_enabled",
    "rweb_cashtags_composer_attachment_enabled",
    "responsive_web_jetfuel_frame",
    "responsive_web_grok_share_attachment_enabled",
    "responsive_web_grok_annotations_enabled",
    "articles_preview_enabled",
    "responsive_web_edit_tweet_api_enabled",
    "rweb_conversational_replies_downvote_enabled",
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled",
    "view_counts_everywhere_api_enabled",
    "longform_notetweets_consumption_enabled",
    "responsive_web_twitter_article_tweet_consumption_enabled",
    "content_disclosure_indicator_enabled",
    "content_disclosure_ai_generated_indicator_enabled",
    "responsive_web_grok_show_grok_translated_post",
    "responsive_web_grok_analysis_button_from_backend",
    "post_ctas_fetch_enabled",
    "freedom_of_speech_not_reach_fetch_enabled",
    "standardized_nudges_misinfo",
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled",
    "longform_notetweets_rich_text_read_enabled",
    "longform_notetweets_inline_media_enabled",
    "responsive_web_grok_image_annotation_enabled",
    "responsive_web_grok_imagine_annotation_enabled",
    "responsive_web_grok_community_note_auto_translation_is_enabled",
    "responsive_web_enhance_cards_enabled",
  ];

  static const List<String> _fieldToggles = [
    "withPayments",
    "withAuxiliaryUserLabels",
    "withArticleRichContentState",
    "withArticlePlainText",
    "withArticleSummaryText",
    "withArticleVoiceOver",
    "withGrokAnalyze",
    "withDisallowedReplyControls",
  ];

  Future<XSearchResult> search(String query, AppSettings settings, {int count = 30, String? cursor}) async {
    final cleanQuery = query.trim();
    if (cleanQuery.isEmpty) return const XSearchResult(tweets: []);

    final url = Uri.parse(
      'https://x.com/i/api/graphql/${AppConstants.xSearchTimelineQueryId}/SearchTimeline',
    );

    final headers = {
      'authorization': 'Bearer ${AppConstants.xBearerToken}',
      'x-csrf-token': settings.xCt0,
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      'content-type': 'application/json',
      'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'cookie':
          'auth_token=${settings.xAuthToken}; ct0=${settings.xCt0}; guest_id=${settings.xGuestToken}',
    };

    final body = jsonEncode({
      'variables': {
        'rawQuery': cleanQuery,
        'count': count,
        'querySource': 'recent_search_click',
        'product': 'Latest',
        'cursor': cursor,
      },
      'features': {for (var f in _features) f: true},
      'fieldToggles': {for (var f in _fieldToggles) f: true},
    });

    try {
      final response = await http.post(url, headers: headers, body: body).timeout(const Duration(seconds: 15));
      if (response.statusCode != 200) {
        throw Exception('X API error ${response.statusCode}: ${response.body}');
      }

      final json = jsonDecode(response.body) as Map<String, dynamic>;
      final timeline = json['data']?['search_by_raw_query']?['search_timeline']?['timeline'];
      if (timeline == null) return const XSearchResult(tweets: []);

      final tweets = _extractTweets(timeline);
      final nextCursor = _extractNextCursor(timeline);
      return XSearchResult(tweets: tweets, nextCursor: nextCursor);
    } catch (e) {
      return const XSearchResult(tweets: []);
    }
  }

  String? _extractNextCursor(dynamic timeline) {
    if (timeline == null) return null;
    String? nextCursor;
    void findCursor(dynamic node) {
      if (nextCursor != null || node == null) return;
      if (node is Map<String, dynamic>) {
        if (node['cursorType'] == 'Bottom' || node['cursorType'] == 'BottomScroll') {
          nextCursor = node['value'] as String?;
          return;
        }
        for (final val in node.values) {
          findCursor(val);
        }
      } else if (node is List) {
        for (final item in node) {
          findCursor(item);
        }
      }
    }
    findCursor(timeline);
    return nextCursor;
  }

  List<FeedItem> _extractTweets(dynamic timeline) {
    final Set<String> seenIds = {};
    final List<FeedItem> tweets = [];

    void walk(dynamic node) {
      if (node == null || node is! Map<String, dynamic>) return;

      if (node.containsKey('tweet_results') && node['tweet_results'] is Map<String, dynamic>) {
        final result = node['tweet_results']['result'] as Map<String, dynamic>?;
        if (result != null) {
          final restId = result['rest_id'] as String?;
          if (restId != null && !seenIds.contains(restId)) {
            seenIds.add(restId);
            final item = _mapTweet(result);
            if (item != null) tweets.add(item);
          }
        }
      }

      for (final val in node.values) {
        if (val is List) {
          for (final item in val) {
            walk(item);
          }
        } else if (val is Map) {
          walk(val);
        }
      }
    }

    walk(timeline);
    return tweets;
  }

  FeedItem? _mapTweet(Map<String, dynamic> result) {
    final id = result['rest_id'] as String?;
    if (id == null) return null;

    final userResult = result['core']?['user_results']?['result'] as Map<String, dynamic>?;
    final screenName = (userResult?['core']?['screen_name'] as String?) ?? '';
    final name = (userResult?['core']?['name'] as String?) ?? screenName;
    final profilePic = (userResult?['avatar']?['image_url'] as String?) ??
        (userResult?['legacy']?['profile_image_url_https'] as String?) ??
        '';

    final legacy = (result['legacy'] as Map<String, dynamic>?) ?? {};
    final text = (legacy['full_text'] as String?) ?? '';
    final createdAtStr = (legacy['created_at'] as String?) ?? '';
    final replyCount = (legacy['reply_count'] as int?) ?? 0;
    final retweetCount = (legacy['retweet_count'] as int?) ?? 0;
    final likeCount = (legacy['favorite_count'] as int?) ?? 0;

    final entities = (legacy['entities'] as Map<String, dynamic>?) ?? {};
    final mediaList = (entities['media'] as List<dynamic>?) ?? [];
    final List<String> mediaUrls = mediaList
        .map((m) => (m['media_url_https'] as String?) ?? (m['url'] as String?) ?? '')
        .where((u) => u.isNotEmpty)
        .toList();

    DateTime postedAt = DateTime.now();
    if (createdAtStr.isNotEmpty) {
      try {
        // Twitter format: "Wed Oct 10 20:19:24 +0000 2018"
        // Or standard parsing
        postedAt = DateTime.tryParse(createdAtStr) ?? DateTime.now();
      } catch (_) {}
    }

    final postUrl = screenName.isNotEmpty
        ? 'https://x.com/$screenName/status/$id'
        : 'https://x.com/i/web/status/$id';

    final combinedText = '$text $name @$screenName';
    final emails = LeadExtractor.extractEmails(combinedText);
    final phones = LeadExtractor.extractPhones(combinedText);

    return FeedItem(
      id: id,
      source: FeedSource.x,
      authorName: name.isNotEmpty ? name : '@$screenName',
      authorHeadline: screenName.isNotEmpty ? '@$screenName' : '',
      authorPicture: profilePic,
      authorUrl: screenName.isNotEmpty ? 'https://x.com/$screenName' : '',
      content: text,
      postUrl: postUrl,
      postedAt: postedAt,
      likes: likeCount,
      comments: replyCount,
      shares: retweetCount,
      extractedEmails: emails,
      extractedPhones: phones,
      mediaUrls: mediaUrls,
    );
  }
}
