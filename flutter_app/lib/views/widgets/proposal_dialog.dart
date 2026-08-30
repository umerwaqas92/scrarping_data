import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/feed_item.dart';
import '../../services/proposal_service.dart';
import '../../services/email_service.dart';
import '../../providers/feed_provider.dart';

class ProposalDialog extends StatefulWidget {
  final FeedItem item;

  const ProposalDialog({super.key, required this.item});

  @override
  State<ProposalDialog> createState() => _ProposalDialogState();
}

class _ProposalDialogState extends State<ProposalDialog> {
  final ProposalService _proposalService = ProposalService();
  final EmailService _emailService = EmailService();

  final TextEditingController _recipientController = TextEditingController();
  final TextEditingController _subjectController = TextEditingController();
  final TextEditingController _summaryController = TextEditingController();
  final TextEditingController _bodyController = TextEditingController();

  bool _isGenerating = true;
  bool _isSending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.item.extractedEmails.isNotEmpty) {
      _recipientController.text = widget.item.extractedEmails.first;
    }
    _generate();
  }

  @override
  void dispose() {
    _recipientController.dispose();
    _subjectController.dispose();
    _summaryController.dispose();
    _bodyController.dispose();
    super.dispose();
  }

  Future<void> _generate() async {
    setState(() {
      _isGenerating = true;
      _error = null;
    });

    try {
      // Find settings from context
      final settings = (context.findAncestorStateOfType<State>()?.context.dependOnInheritedWidgetOfExactType()) != null
          ? FeedProvider().settings
          : FeedProvider().settings;

      final result = await _proposalService.generateProposal(
        profileContent: settings.userProfile,
        jobText: widget.item.content,
        jobTitle: widget.item.authorHeadline.isNotEmpty ? widget.item.authorHeadline : null,
        jobUrl: widget.item.postUrl,
        apiKey: settings.mimoApiKey,
      );

      final extracted = EmailService.extractSubjectAndBody(result.proposal, widget.item.authorHeadline);

      if (mounted) {
        setState(() {
          _subjectController.text = extracted.subject;
          _summaryController.text = result.summary;
          _bodyController.text = extracted.body;
          _isGenerating = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isGenerating = false;
        });
      }
    }
  }

  Future<void> _sendEmail() async {
    final to = _recipientController.text.trim();
    if (!to.contains('@')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a valid recipient email address'),
          backgroundColor: Colors.redAccent,
        ),
      );
      return;
    }

    setState(() => _isSending = true);

    try {
      final settings = FeedProvider().settings;
      await _emailService.sendEmail(
        to: to,
        subject: _subjectController.text.trim(),
        body: _bodyController.text.trim(),
        summary: _summaryController.text.trim(),
        settings: settings,
      );

      if (mounted) {
        setState(() => _isSending = false);
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.greenAccent),
                const SizedBox(width: 8),
                Expanded(child: Text('Email dispatched successfully to $to!')),
              ],
            ),
            backgroundColor: const Color(0xFF1E293B),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSending = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to send email: $e'),
            backgroundColor: Colors.redAccent,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  void _copyProposal() {
    final note = _summaryController.text.trim();
    final fullText = 'Subject: ${_subjectController.text}\n\n${note.isNotEmpty ? 'LinkedIn Note: $note\n\n' : ''}${_bodyController.text}';
    Clipboard.setData(ClipboardData(text: fullText));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Proposal + LinkedIn note copied!'),
        backgroundColor: Color(0xFF1E293B),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;

    return Dialog(
      backgroundColor: const Color(0xFF0F172A),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: Color(0xFF334155)),
      ),
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      child: Container(
        width: size.width > 680 ? 640 : size.width * 0.95,
        constraints: BoxConstraints(maxHeight: size.height * 0.85),
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Dialog Header ─────────────────────────────────────────────
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF4F46E5).withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.auto_awesome, color: Color(0xFF818CF8), size: 20),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'AI Proposal Generator',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        'Custom proposal tailored to job post & your profile',
                        style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: Color(0xFF94A3B8)),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),

            const SizedBox(height: 16),
            const Divider(color: Color(0xFF334155), height: 1),
            const SizedBox(height: 16),

            // ── Dialog Body ───────────────────────────────────────────────
            Expanded(
              child: _isGenerating
                  ? const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          CircularProgressIndicator(color: Color(0xFF818CF8)),
                          SizedBox(height: 16),
                          Text(
                            'Crafting personalized proposal with MiMo AI...',
                            style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                          ),
                        ],
                      ),
                    )
                  : _error != null
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.error_outline, color: Colors.redAccent, size: 40),
                              const SizedBox(height: 12),
                              Text(
                                'Generation failed:\n$_error',
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: Colors.redAccent, fontSize: 13),
                              ),
                              const SizedBox(height: 16),
                              ElevatedButton.icon(
                                onPressed: _generate,
                                icon: const Icon(Icons.refresh),
                                label: const Text('Try Again'),
                              ),
                            ],
                          ),
                        )
                      : SingleChildScrollView(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Recipient Field
                              const Text(
                                'Recipient Email',
                                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 6),
                              TextField(
                                controller: _recipientController,
                                style: const TextStyle(color: Colors.white, fontSize: 13),
                                decoration: InputDecoration(
                                  prefixIcon: const Icon(Icons.email_outlined, color: Color(0xFF818CF8), size: 18),
                                  hintText: 'e.g. client@example.com',
                                  hintStyle: const TextStyle(color: Color(0xFF64748B)),
                                  filled: true,
                                  fillColor: const Color(0xFF1E293B),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: const BorderSide(color: Color(0xFF334155)),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 14),

                              // Subject Field
                              const Text(
                                'Subject Line',
                                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 6),
                              TextField(
                                controller: _subjectController,
                                style: const TextStyle(color: Colors.white, fontSize: 13),
                                decoration: InputDecoration(
                                  prefixIcon: const Icon(Icons.subject, color: Color(0xFF818CF8), size: 18),
                                  filled: true,
                                  fillColor: const Color(0xFF1E293B),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: const BorderSide(color: Color(0xFF334155)),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 14),

                              // LinkedIn Note Field
                              Row(
                                children: [
                                  const Text(
                                    'LinkedIn Application Note (250 chars max)',
                                    style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
                                  ),
                                  const Spacer(),
                                  Text(
                                    '${_summaryController.text.length}/250',
                                    style: TextStyle(
                                      color: _summaryController.text.length > 250 ? Colors.redAccent : Color(0xFF64748B),
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              TextField(
                                controller: _summaryController,
                                maxLength: 250,
                                maxLines: 3,
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 13),
                                decoration: InputDecoration(
                                  hintText: 'Short note for LinkedIn job application...',
                                  hintStyle: const TextStyle(color: Color(0xFF64748B)),
                                  filled: true,
                                  fillColor: const Color(0xFF1E293B),
                                  contentPadding: const EdgeInsets.all(12),
                                  counterText: '',
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: const BorderSide(color: Color(0xFF334155)),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 14),

                              // Body Field
                              const Text(
                                'Proposal Message (Plain Text)',
                                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 6),
                              TextField(
                                controller: _bodyController,
                                maxLines: 12,
                                style: const TextStyle(
                                  color: Color(0xFFE2E8F0),
                                  fontSize: 13,
                                  height: 1.45,
                                  fontFamily: 'monospace',
                                ),
                                decoration: InputDecoration(
                                  filled: true,
                                  fillColor: const Color(0xFF1E293B),
                                  contentPadding: const EdgeInsets.all(12),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: const BorderSide(color: Color(0xFF334155)),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
            ),

            const SizedBox(height: 16),
            const Divider(color: Color(0xFF334155), height: 1),
            const SizedBox(height: 16),

            // ── Footer Action Buttons ──────────────────────────────────────
            Row(
              children: [
                // Regenerate button
                OutlinedButton.icon(
                  onPressed: _isGenerating || _isSending ? null : _generate,
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('Regenerate'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF94A3B8),
                    side: const BorderSide(color: Color(0xFF334155)),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(width: 8),

                // Copy button
                OutlinedButton.icon(
                  onPressed: _isGenerating || _isSending ? null : _copyProposal,
                  icon: const Icon(Icons.copy_rounded, size: 16),
                  label: const Text('Copy'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF94A3B8),
                    side: const BorderSide(color: Color(0xFF334155)),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const Spacer(),

                // Send Email button
                ElevatedButton.icon(
                  onPressed: _isGenerating || _isSending ? null : _sendEmail,
                  icon: _isSending
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.send_rounded, size: 16),
                  label: Text(_isSending ? 'Sending...' : 'Send Email'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF4F46E5),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
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
