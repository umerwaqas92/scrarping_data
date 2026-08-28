import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_multifeed/models/app_settings.dart';
import 'package:flutter_multifeed/services/reddit_service.dart';
import 'package:flutter_multifeed/services/linkedin_service.dart';
import 'package:flutter_multifeed/services/x_service.dart';

void main() {
  test('Test Reddit and LinkedIn through live services', () async {
    final settings = AppSettings.defaults();

    final reddit = RedditService();
    final redditPosts = await reddit.search('flutter developer', settings, count: 5);
    print('Reddit posts found: ${redditPosts.length}');
    for (final p in redditPosts.take(3)) {
      print('Reddit [${p.authorName}]: ${p.content.split('\n').first}');
    }
    expect(redditPosts.isNotEmpty, true);

    final linkedin = LinkedInService();
    final linkedinPosts = await linkedin.searchPosts('flutter', settings, limit: 5);
    print('LinkedIn posts found: ${linkedinPosts.length}');
    for (final p in linkedinPosts.take(3)) {
      print('LinkedIn [${p.authorName}]: ${p.content.split('\n').first}');
    }
    expect(linkedinPosts.isNotEmpty, true);
  });
}
