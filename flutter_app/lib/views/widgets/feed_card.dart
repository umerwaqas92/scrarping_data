import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../models/feed_item.dart';
import 'proposal_dialog.dart';

class FeedCard extends StatefulWidget {
  final FeedItem item;

  const FeedCard({super.key, required this.item});

  @override
  State<FeedCard> createState() => _FeedCardState();
}

class _FeedCardState extends State<FeedCard> {
  bool _isExpanded = false;

  String _formatTimestamp(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);

    if (diff.inSeconds < 60) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return DateFormat('MMM d, y').format(dt);
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

  IconData _getSourceIcon(FeedSource source) {
    switch (source) {
      case FeedSource.x:
        return Icons.tag;
      case FeedSource.reddit:
        return Icons.reddit;
      case FeedSource.linkedin:
        return Icons.business_center;
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
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sourceColor = _getSourceColor(widget.item.source);
    final isLongText = widget.item.content.length > 280;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: widget.item.hasLead ? sourceColor.withValues(alpha: 0.4) : const Color(0xFF334155),
          width: widget.item.hasLead ? 1.5 : 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Header: Source Pill, Avatar, Author Info & Timestamp ──────────
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Avatar
                CircleAvatar(
                  radius: 20,
                  backgroundColor: sourceColor.withValues(alpha: 0.2),
                  backgroundImage: widget.item.authorPicture.isNotEmpty
                      ? NetworkImage(widget.item.authorPicture)
                      : null,
                  child: widget.item.authorPicture.isEmpty
                      ? Text(
                          widget.item.authorName.isNotEmpty
                              ? widget.item.authorName[0].toUpperCase()
                              : '?',
                          style: TextStyle(
                            color: sourceColor,
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        )
                      : null,
                ),
                const SizedBox(width: 12),

                // Name & Headline
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              widget.item.authorName,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: sourceColor.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(color: sourceColor.withValues(alpha: 0.3)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(_getSourceIcon(widget.item.source), size: 10, color: sourceColor),
                                const SizedBox(width: 3),
                                Text(
                                  widget.item.sourceLabel,
                                  style: TextStyle(
                                    color: sourceColor,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (widget.item.authorHeadline.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          widget.item.authorHeadline,
                          style: const TextStyle(
                            color: Color(0xFF94A3B8),
                            fontSize: 12,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),

                // Time
                Text(
                  _formatTimestamp(widget.item.postedAt),
                  style: const TextStyle(
                    color: Color(0xFF64748B),
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // ── Extracted Leads Badges (Emails & Phones) ─────────────────────
            if (widget.item.hasLead) ...[
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  ...widget.item.extractedEmails.map((email) => InkWell(
                        onTap: () => _copyToClipboard(context, email, 'Email'),
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: const Color(0xFF0F766E).withValues(alpha: 0.3),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFF14B8A6)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.email_outlined, size: 13, color: Color(0xFF2DD4BF)),
                              const SizedBox(width: 5),
                              Text(
                                email,
                                style: const TextStyle(
                                  color: Color(0xFF5EEAD4),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(width: 4),
                              const Icon(Icons.copy_rounded, size: 11, color: Color(0xFF2DD4BF)),
                            ],
                          ),
                        ),
                      )),
                  ...widget.item.extractedPhones.map((phone) => InkWell(
                        onTap: () => _copyToClipboard(context, phone, 'Phone'),
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E3A8A).withValues(alpha: 0.3),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFF3B82F6)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.phone_outlined, size: 13, color: Color(0xFF60A5FA)),
                              const SizedBox(width: 5),
                              Text(
                                phone,
                                style: const TextStyle(
                                  color: Color(0xFF93C5FD),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(width: 4),
                              const Icon(Icons.copy_rounded, size: 11, color: Color(0xFF60A5FA)),
                            ],
                          ),
                        ),
                      )),
                ],
              ),
              const SizedBox(height: 12),
            ],

            // ── Post Content Text ───────────────────────────────────────────
            SelectableText(
              isLongText && !_isExpanded
                  ? '${widget.item.content.substring(0, 280)}...'
                  : widget.item.content,
              style: const TextStyle(
                color: Color(0xFFE2E8F0),
                fontSize: 14,
                height: 1.45,
              ),
            ),

            if (isLongText) ...[
              const SizedBox(height: 4),
              GestureDetector(
                onTap: () => setState(() => _isExpanded = !_isExpanded),
                child: Text(
                  _isExpanded ? 'Show less' : 'Read more',
                  style: TextStyle(
                    color: sourceColor,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],

            const SizedBox(height: 14),

            // ── Footer: Engagement, External Link & Proposal Button ─────────
            Row(
              children: [
                // Likes
                if (widget.item.likes > 0) ...[
                  Icon(Icons.favorite_border, size: 14, color: const Color(0xFF94A3B8)),
                  const SizedBox(width: 4),
                  Text(
                    '${widget.item.likes}',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                  ),
                  const SizedBox(width: 14),
                ],

                // Comments
                if (widget.item.comments > 0) ...[
                  Icon(Icons.chat_bubble_outline, size: 14, color: const Color(0xFF94A3B8)),
                  const SizedBox(width: 4),
                  Text(
                    '${widget.item.comments}',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                  ),
                  const SizedBox(width: 14),
                ],

                // External Link Button
                IconButton(
                  icon: const Icon(Icons.open_in_new, size: 16, color: Color(0xFF94A3B8)),
                  tooltip: 'Open in browser',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () => _openUrl(widget.item.postUrl),
                ),

                const Spacer(),

                // Generate Proposal Button
                ElevatedButton.icon(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (ctx) => ProposalDialog(item: widget.item),
                    );
                  },
                  icon: const Icon(Icons.bolt, size: 15, color: Colors.amberAccent),
                  label: const Text(
                    'Proposal',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF4F46E5),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    elevation: 0,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
