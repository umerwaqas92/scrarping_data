import 'package:flutter/material.dart';
import '../../providers/feed_provider.dart';
import '../../services/storage_service.dart';

class EditSuggestionsDialog extends StatefulWidget {
  final FeedProvider provider;

  const EditSuggestionsDialog({super.key, required this.provider});

  static Future<void> show(BuildContext context, FeedProvider provider) {
    return showDialog(
      context: context,
      builder: (ctx) => EditSuggestionsDialog(provider: provider),
    );
  }

  @override
  State<EditSuggestionsDialog> createState() => _EditSuggestionsDialogState();
}

class _EditSuggestionsDialogState extends State<EditSuggestionsDialog> {
  final TextEditingController _controller = TextEditingController();
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadCurrent();
  }

  Future<void> _loadCurrent() async {
    final raw = await widget.provider.getRawQuickSuggestions();
    if (mounted) {
      setState(() {
        _controller.text = raw;
        _isLoading = false;
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await widget.provider.saveQuickSuggestions(_controller.text);
    if (mounted) {
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Row(
            children: [
              Icon(Icons.check_circle, color: Colors.greenAccent, size: 18),
              SizedBox(width: 8),
              Text('Quick suggestions updated successfully!'),
            ],
          ),
          backgroundColor: Color(0xFF1E293B),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  void _resetDefaults() {
    setState(() {
      _controller.text = StorageService.defaultSuggestions.join('\n');
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: const Color(0xFF0F172A),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: Color(0xFF334155)),
      ),
      title: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: const Color(0xFF4F46E5).withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.bookmark_added_outlined, color: Color(0xFF818CF8), size: 20),
          ),
          const SizedBox(width: 10),
          const Text(
            'Quick Search Suggestions',
            style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
          ),
        ],
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: _isLoading
            ? const Center(
                heightFactor: 3,
                child: CircularProgressIndicator(color: Color(0xFF818CF8)),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Put all your search suggestions below (1 per line). They will appear as 1-tap quick buttons directly under the search bar.',
                    style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13, height: 1.4),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _controller,
                    maxLines: 9,
                    style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.5),
                    decoration: InputDecoration(
                      hintText: 'Flutter developer\nFlutter job\nFlutter remote\nReact Native developer\nAI Engineer',
                      hintStyle: const TextStyle(color: Color(0xFF475569)),
                      filled: true,
                      fillColor: const Color(0xFF1E293B),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: Color(0xFF334155)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: Color(0xFF6366F1), width: 1.5),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: _resetDefaults,
                      icon: const Icon(Icons.restore, size: 14, color: Color(0xFF94A3B8)),
                      label: const Text(
                        'Reset to defaults',
                        style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                      ),
                    ),
                  ),
                ],
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel', style: TextStyle(color: Color(0xFF94A3B8))),
        ),
        ElevatedButton.icon(
          onPressed: _save,
          icon: const Icon(Icons.check, size: 16, color: Colors.white),
          label: const Text('Save Suggestions', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF4F46E5),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          ),
        ),
      ],
    );
  }
}
