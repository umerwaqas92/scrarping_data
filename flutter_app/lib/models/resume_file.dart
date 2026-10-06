import 'dart:convert';

class ResumeFile {
  final String id;
  final String filename;
  final String contentBase64;
  final int size;
  final DateTime createdAt;

  const ResumeFile({
    required this.id,
    required this.filename,
    required this.contentBase64,
    required this.size,
    required this.createdAt,
  });

  String get formattedSize {
    if (size <= 0) return '0 KB';
    if (size < 1024) return '$size B';
    if (size < 1024 * 1024) return '${(size / 1024).toStringAsFixed(1)} KB';
    return '${(size / (1024 * 1024)).toStringAsFixed(2)} MB';
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'filename': filename,
      'contentBase64': contentBase64,
      'size': size,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory ResumeFile.fromJson(Map<String, dynamic> json) {
    return ResumeFile(
      id: json['id'] as String? ?? 'res_${DateTime.now().millisecondsSinceEpoch}',
      filename: json['filename'] as String? ?? 'resume.pdf',
      contentBase64: json['contentBase64'] as String? ?? json['content_base64'] as String? ?? '',
      size: (json['size'] as num?)?.toInt() ?? 0,
      createdAt: json['createdAt'] != null
          ? DateTime.tryParse(json['createdAt'] as String) ?? DateTime.now()
          : (json['created_at'] != null ? DateTime.tryParse(json['created_at'] as String) ?? DateTime.now() : DateTime.now()),
    );
  }

  static String encodeList(List<ResumeFile> list) {
    return jsonEncode(list.map((r) => r.toJson()).toList());
  }

  static List<ResumeFile> decodeList(String rawJson) {
    try {
      final decoded = jsonDecode(rawJson);
      if (decoded is List) {
        return decoded
            .whereType<Map<String, dynamic>>()
            .map((item) => ResumeFile.fromJson(item))
            .toList();
      }
    } catch (_) {}
    return [];
  }
}
