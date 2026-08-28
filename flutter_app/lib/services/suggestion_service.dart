import 'dart:convert';
import 'package:http/http.dart' as http;

class SuggestionService {
  Future<List<String>> getSuggestions(String query) async {
    final cleanQuery = query.trim();
    if (cleanQuery.isEmpty) return const [];

    final url = Uri.parse(
      'https://suggestqueries.google.com/complete/search?client=firefox&q=${Uri.encodeComponent(cleanQuery)}',
    );

    try {
      final response = await http.get(
        url,
        headers: {
          'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0',
        },
      ).timeout(const Duration(seconds: 4));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data is List && data.length > 1 && data[1] is List) {
          return (data[1] as List).map((e) => e.toString()).toList();
        }
      }
      return const [];
    } catch (_) {
      return const [];
    }
  }
}
