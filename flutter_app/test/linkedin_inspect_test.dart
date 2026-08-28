import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'dart:io';

void main() {
  test('Test LinkedIn URLs without date_posted filter', () async {
    final cookieContent = File('../linkedin_cookies.txt').readAsStringSync();
    final cookiePairs = <String>[];
    String? csrfToken;
    for (final line in cookieContent.split('\n')) {
      if (line.isEmpty || line.startsWith('#')) continue;
      final parts = line.split('\t');
      if (parts.length >= 7) {
        cookiePairs.add('${parts[5]}=${parts[6]}');
        if (parts[5] == 'JSESSIONID') {
          csrfToken = parts[6].replaceAll('"', '');
        }
      }
    }
    final cookieHeader = cookiePairs.join('; ');

    final urls = [
      'https://www.linkedin.com/search/results/content/?keywords=flutter&origin=SWITCH_SEARCH_VERTICAL',
      'https://www.linkedin.com/search/results/content/?keywords=flutter%20developer',
      'https://www.linkedin.com/search/results/all/?keywords=flutter',
    ];

    for (final urlStr in urls) {
      final url = Uri.parse(urlStr);
      final headers = {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cookie': cookieHeader,
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        if (csrfToken != null) 'csrf-token': csrfToken,
      };

      final res = await http.get(url, headers: headers);
      print('URL: $urlStr');
      print('Status: ${res.statusCode}, Body length: ${res.body.length}');
      final isNoResults = res.body.contains('No results found');
      print('Is "No results found": $isNoResults');
      final hasPostSlug = res.body.contains('postSlugUrl');
      print('Contains postSlugUrl: $hasPostSlug');
      final hasUrn = res.body.contains('urn:li:activity:');
      print('Contains urn:li:activity: $hasUrn');
    }
  });
}
