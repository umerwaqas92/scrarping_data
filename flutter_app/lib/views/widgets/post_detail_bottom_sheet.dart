import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../models/feed_item.dart';
import 'proposal_dialog.dart';

class PostDetailBottomSheet extends StatelessWidget {
  final FeedItem item;

  const PostDetailBottomSheet({super.key, required this.item});

  static Future<void> show(BuildContext context, FeedItem item) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => PostDetailBottomSheet(item: item),
    );
  }

  String _formatTimestamp(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);

    if (diff.inSeconds < 60) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return DateFormat('MMM d, y • h:mm a').format(dt);
  }

  Color _getSourceColor(FeedSource source) {
    switch (source) {
      case FeedSource.x:
        return const Color(0xFF1D9BF0);
      case FeedSource.reddit:
        return const Color(0xFFFF4500);
      case FeedSource.linkedin:
        return const Color(0xFF0A66C2);
    }
  }

  String _getSourceName(FeedSource source) {
    switch (source) {
      case FeedSource.x:
        return '𝕏 Twitter';
      case FeedSource.reddit:
        return '🔴 Reddit';
      case FeedSource.linkedin:
        return '💼 LinkedIn';
    }
  }

  void _copyToClipboard(BuildContext context, String text, String label) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.greenAccent, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text('Copied $label: $text')),
          ],
        ),
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
        backgroundColor: const Color(0xFF1E293B),
      ),
    );
  }

  Future<void> _openUrl(String url) async {
    final cleanUrl = url.trim();
    if (cleanUrl.isEmpty) return;
    try {
      final uri = Uri.parse(cleanUrl);
      final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched) {
        await launchUrl(uri, mode: LaunchMode.platformDefault);
      }
    } catch (_) {
      try {
        await launchUrl(Uri.parse(cleanUrl), mode: LaunchMode.inAppBrowserView);
      } catch (_) {}
    }
  }

  @override
  Widget build(BuildContext context) {
    final sourceColor = _getSourceColor(item.source);

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Color(0xFF0F172A),
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            boxShadow: [
              BoxShadow(
                color: Colors.black54,
                blurRadius: 20,
                offset: Offset(0, -4),
              ),
            ],
          ),
          child: Column(
            children: [
              // ── Drag Handle ──────────────────────────────────────────
              Container(
                margin: const EdgeInsets.only(top: 12, bottom: 8),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFF475569),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),

              // ── Header Bar ───────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: sourceColor.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: sourceColor.withValues(alpha: 0.4)),
                      ),
                      child: Text(
                        _getSourceName(item.source),
                        style: TextStyle(
                          color: sourceColor,
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      _formatTimestamp(item.postedAt),
                      style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      icon: const Icon(Icons.close, color: Color(0xFF94A3B8)),
                      onPressed: () => Navigator.of(context).pop(),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ),
              ),

              const Divider(color: Color(0xFF1E293B), height: 1),

              // ── Scrollable Body ──────────────────────────────────────
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.all(20),
                  children: [
                    // Author Profile Box
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        CircleAvatar(
                          radius: 26,
                          backgroundColor: sourceColor.withValues(alpha: 0.2),
                          backgroundImage: item.authorPicture.isNotEmpty
                              ? NetworkImage(item.authorPicture)
                              : null,
                          child: item.authorPicture.isEmpty
                              ? Text(
                                  item.authorName.isNotEmpty
                                      ? item.authorName[0].toUpperCase()
                                      : '?',
                                  style: TextStyle(
                                    color: sourceColor,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 20,
                                  ),
                                )
                              : null,
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.authorName,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 17,
                                ),
                              ),
                              if (item.authorHeadline.isNotEmpty) ...[
                                const SizedBox(height: 3),
                                Text(
                                  item.authorHeadline,
                                  style: const TextStyle(
                                    color: Color(0xFF94A3B8),
                                    fontSize: 13,
                                    height: 1.3,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 16),

                    // Leads Box (if any)
                    if (item.hasLead) ...[
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1E293B),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.4)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.flash_on, color: Color(0xFF10B981), size: 16),
                                SizedBox(width: 6),
                                Text(
                                  'Detected Contact Leads',
                                  style: TextStyle(
                                    color: Color(0xFF10B981),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                for (final email in item.extractedEmails)
                                  InkWell(
                                    onTap: () => _copyToClipboard(context, email, 'Email'),
                                    borderRadius: BorderRadius.circular(8),
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF0F172A),
                                        borderRadius: BorderRadius.circular(8),
                                        border: Border.all(color: const Color(0xFF2DD4BF).withValues(alpha: 0.5)),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const Icon(Icons.email_outlined, size: 14, color: Color(0xFF2DD4BF)),
                                          const SizedBox(width: 6),
                                          Text(
                                            email,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 13,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                          const SizedBox(width: 6),
                                          const Icon(Icons.copy, size: 12, color: Color(0xFF94A3B8)),
                                        ],
                                      ),
                                    ),
                                  ),
                                for (final phone in item.extractedPhones)
                                  InkWell(
                                    onTap: () => _copyToClipboard(context, phone, 'Phone'),
                                    borderRadius: BorderRadius.circular(8),
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF0F172A),
                                        borderRadius: BorderRadius.circular(8),
                                        border: Border.all(color: const Color(0xFFFBBF24).withValues(alpha: 0.5)),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const Icon(Icons.phone_outlined, size: 14, color: Color(0xFFFBBF24)),
                                          const SizedBox(width: 6),
                                          Text(
                                            phone,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 13,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                          const SizedBox(width: 6),
                                          const Icon(Icons.copy, size: 12, color: Color(0xFF94A3B8)),
                                        ],
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Full Post Content
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B).withValues(alpha: 0.6),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFF334155)),
                      ),
                      child: SelectableText(
                        item.content,
                        style: const TextStyle(
                          color: Color(0xFFF1F5F9),
                          fontSize: 15,
                          height: 1.6,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ),

                    const SizedBox(height: 20),

                    // Metrics Row (if any)
                    if (item.likes > 0 || item.comments > 0 || item.shares > 0) ...[
                      Row(
                        children: [
                          if (item.likes > 0) ...[
                            const Icon(Icons.thumb_up_alt_outlined, size: 15, color: Color(0xFF94A3B8)),
                            const SizedBox(width: 4),
                            Text('${item.likes}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                            const SizedBox(width: 16),
                          ],
                          if (item.comments > 0) ...[
                            const Icon(Icons.comment_outlined, size: 15, color: Color(0xFF94A3B8)),
                            const SizedBox(width: 4),
                            Text('${item.comments}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                            const SizedBox(width: 16),
                          ],
                          if (item.shares > 0) ...[
                            const Icon(Icons.share_outlined, size: 15, color: Color(0xFF94A3B8)),
                            const SizedBox(width: 4),
                            Text('${item.shares}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                          ],
                        ],
                      ),
                      const SizedBox(height: 20),
                    ],

                    // ── Primary Action Buttons ──────────────────────────────
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton.icon(
                        onPressed: () {
                          Navigator.of(context).pop();
                          showDialog(
                            context: context,
                            builder: (ctx) => ProposalDialog(item: item),
                          );
                        },
                        icon: const Icon(Icons.auto_awesome, size: 18, color: Colors.white),
                        label: const Text(
                          'Generate AI Proposal',
                          style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF6366F1),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          elevation: 0,
                        ),
                      ),
                    ),

                    const SizedBox(height: 10),

                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _openUrl(item.postUrl),
                            icon: Icon(Icons.open_in_new, size: 16, color: sourceColor),
                            label: Text(
                              'Open on ${_getSourceName(item.source).split(' ').last}',
                              style: TextStyle(color: sourceColor, fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                            style: OutlinedButton.styleFrom(
                              side: BorderSide(color: sourceColor.withValues(alpha: 0.5)),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        OutlinedButton.icon(
                          onPressed: () => _copyToClipboard(context, item.content, 'Post Content'),
                          icon: const Icon(Icons.copy, size: 16, color: Color(0xFF94A3B8)),
                          label: const Text(
                            'Copy Text',
                            style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                          ),
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Color(0xFF334155)),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 30),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
