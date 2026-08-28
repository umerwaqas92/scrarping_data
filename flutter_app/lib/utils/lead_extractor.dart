class LeadExtractor {
  // Regex to extract valid emails
  static final RegExp _emailRegExp = RegExp(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
    caseSensitive: false,
  );

  // Regex to detect phone numbers
  static final RegExp _phoneRegExp = RegExp(
    r'(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{2,5}\)?[-.\s]?)?\d{3,5}[-.\s]?\d{4,6}',
  );

  // Filter out false positives for emails
  static const Set<String> _invalidEmailExtensions = {
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'webp',
    'mp4',
    'mov',
    'avi',
    'js',
    'ts',
    'css',
    'json',
    'html',
  };

  /// Extracts clean, deduplicated emails from text
  static List<String> extractEmails(String text) {
    if (text.isEmpty) return const [];
    final matches = _emailRegExp.allMatches(text);
    final Set<String> emails = {};

    for (final match in matches) {
      final email = match.group(0)?.trim();
      if (email != null && email.isNotEmpty) {
        final lower = email.toLowerCase();
        final ext = lower.split('.').last;
        if (!_invalidEmailExtensions.contains(ext) && !lower.endsWith('.example.com')) {
          emails.add(email);
        }
      }
    }

    return emails.toList();
  }

  /// Extracts potential phone numbers from text
  static List<String> extractPhones(String text) {
    if (text.isEmpty) return const [];
    final matches = _phoneRegExp.allMatches(text);
    final Set<String> phones = {};

    for (final match in matches) {
      final raw = match.group(0)?.trim();
      if (raw == null) continue;

      // Clean non-digits except leading +
      final digitsOnly = raw.replaceAll(RegExp(r'[^\d]'), '');

      // Phone numbers usually have 7 to 15 digits
      if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
        // Exclude common false positives like years (e.g. 20242026) or sequential digits
        if (!digitsOnly.startsWith('0000') && !digitsOnly.startsWith('1111')) {
          phones.add(raw);
        }
      }
    }

    return phones.toList();
  }
}
