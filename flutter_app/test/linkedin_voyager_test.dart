import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'dart:io';
import 'dart:convert';

void main() {
  test('Test LinkedIn Voyager API endpoints', () async {
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

    final headers = {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      'x-li-track': '{"clientVersion":"1.13.9189"}',
      'x-li-page-instance': 'urn:li:page:d_flagship3_search_srp_content;',
      'cookie': cookieHeader,
      if (csrfToken != null) 'csrf-token': csrfToken,
    };

    // Test Voyager cluster search
    final query = 'flutter developer';
    final voyagerUrl = Uri.parse(
      'https://www.linkedin.com/voyager/api/search/dash/clusters?decorationId=com.linkedin.voyager.dash.deco.search.SearchClusterCollection-195&origin=SWITCH_SEARCH_VERTICAL&q=all&query=(keywords:${Uri.encodeComponent(query)},flagshipSearchIntent:SEARCH_SRP)&start=0&count=10',
    );

    final res = await http.get(voyagerUrl, headers: headers);
    print('Voyager status: ${res.statusCode}');
    print('Voyager body length: ${res.body.length}');
    if (res.statusCode == 200) {
      print('Voyager response snippet: ${res.body.substring(0, res.body.length > 500 ? 500 : res.body.length)}');
    } else {
      print('Voyager error: ${res.body}');
    }
  });
}
