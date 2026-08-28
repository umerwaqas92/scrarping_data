enum FeedSource { x, reddit, linkedin }

class FeedItem {
  final String id;
  final FeedSource source;
  final String authorName;
  final String authorHeadline;
  final String authorPicture;
  final String authorUrl;
  final String content;
  final String postUrl;
  final DateTime postedAt;
  final int likes;
  final int comments;
  final int shares;
  final List<String> extractedEmails;
  final List<String> extractedPhones;
  final List<String> mediaUrls;

  const FeedItem({
    required this.id,
    required this.source,
    required this.authorName,
    this.authorHeadline = '',
    this.authorPicture = '',
    this.authorUrl = '',
    required this.content,
    required this.postUrl,
    required this.postedAt,
    this.likes = 0,
    this.comments = 0,
    this.shares = 0,
    this.extractedEmails = const [],
    this.extractedPhones = const [],
    this.mediaUrls = const [],
  });

  bool get hasEmail => extractedEmails.isNotEmpty;
  bool get hasPhone => extractedPhones.isNotEmpty;
  bool get hasLead => hasEmail || hasPhone;

  String get sourceLabel {
    switch (source) {
      case FeedSource.x:
        return 'X';
      case FeedSource.reddit:
        return 'Reddit';
      case FeedSource.linkedin:
        return 'LinkedIn';
    }
  }

  FeedItem copyWith({
    String? id,
    FeedSource? source,
    String? authorName,
    String? authorHeadline,
    String? authorPicture,
    String? authorUrl,
    String? content,
    String? postUrl,
    DateTime? postedAt,
    int? likes,
    int? comments,
    int? shares,
    List<String>? extractedEmails,
    List<String>? extractedPhones,
    List<String>? mediaUrls,
  }) {
    return FeedItem(
      id: id ?? this.id,
      source: source ?? this.source,
      authorName: authorName ?? this.authorName,
      authorHeadline: authorHeadline ?? this.authorHeadline,
      authorPicture: authorPicture ?? this.authorPicture,
      authorUrl: authorUrl ?? this.authorUrl,
      content: content ?? this.content,
      postUrl: postUrl ?? this.postUrl,
      postedAt: postedAt ?? this.postedAt,
      likes: likes ?? this.likes,
      comments: comments ?? this.comments,
      shares: shares ?? this.shares,
      extractedEmails: extractedEmails ?? this.extractedEmails,
      extractedPhones: extractedPhones ?? this.extractedPhones,
      mediaUrls: mediaUrls ?? this.mediaUrls,
    );
  }
}
