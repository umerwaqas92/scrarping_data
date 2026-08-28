import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'dart:io';

void main() {
  test('Verify LinkedIn /all/ endpoint post extraction', () async {
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

    final url = Uri.parse('https://www.linkedin.com/search/results/all/?keywords=flutter');
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
    final html = res.body;

    final postSlugMatches = RegExp(r'postSlugUrl\\?":\s*\\?"(https:[^\\"]+)\\"?').allMatches(html).toList();
    print('Found ${postSlugMatches.length} postSlugUrl matches');
    for (final m in postSlugMatches.take(5)) {
      print('Post URL: ${m.group(1)?.replaceAll(r'\', '')}');
    }

    final postMatches = RegExp(r'https:\/\/[a-z0-9\.]*linkedin\.com\/posts\/([a-zA-Z0-9_\-%]+)').allMatches(html).toList();
    print('Found ${postMatches.length} linkedin.com/posts/ matches');
  });
}
