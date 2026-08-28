import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/feed_item.dart';
import '../providers/feed_provider.dart';
import '../services/suggestion_service.dart';
import 'widgets/feed_card.dart';
import 'widgets/settings_dialog.dart';

class HomeScreen extends StatefulWidget {
  final FeedProvider provider;

  const HomeScreen({super.key, required this.provider});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  final ScrollController _scrollController = ScrollController();
  final SuggestionService _suggestionService = SuggestionService();

  List<String> _suggestions = [];
  bool _showSuggestions = false;

  @override
  void initState() {
    super.initState();
    _searchController.text = widget.provider.currentQuery;
    _searchController.addListener(_onSearchChanged);
    _searchFocusNode.addListener(() {
      if (!_searchFocusNode.hasFocus) {
        setState(() => _showSuggestions = false);
      }
    });

    _scrollController.addListener(() {
      if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 400) {
        if (!widget.provider.isLoading && !widget.provider.isLoadingMore && widget.provider.hasMore) {
          widget.provider.loadMore();
        }
      }
    });
  }

  @override
  void dispose() {
    _searchController.removeListener(_onSearchChanged);
    _searchController.dispose();
    _searchFocusNode.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onSearchChanged() async {
    final text = _searchController.text.trim();
    if (text.isEmpty) {
      if (mounted) setState(() => _suggestions = []);
      return;
    }

    final list = await _suggestionService.getSuggestions(text);
    if (mounted && _searchFocusNode.hasFocus) {
      setState(() {
        _suggestions = list;
        _showSuggestions = list.isNotEmpty;
      });
    }
  }

  void _performSearch([String? query, bool isForced = false]) {
    final target = query ?? _searchController.text;
    if (target.trim().isEmpty) return;

    _searchFocusNode.unfocus();
    setState(() => _showSuggestions = false);
    widget.provider.search(target, isForced: isForced);
  }

  void _copyAllEmails() {
    final emails = widget.provider.allUniqueEmails;
    if (emails.isEmpty) return;

    Clipboard.setData(ClipboardData(text: emails.join('\n')));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.greenAccent, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text('Copied ${emails.length} unique emails to clipboard!')),
          ],
        ),
        backgroundColor: const Color(0xFF1E293B),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _copyAllPhones() {
    final phones = widget.provider.allUniquePhones;
    if (phones.isEmpty) return;

    Clipboard.setData(ClipboardData(text: phones.join('\n')));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.greenAccent, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text('Copied ${phones.length} unique phone numbers to clipboard!')),
          ],
        ),
        backgroundColor: const Color(0xFF1E293B),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.provider,
      builder: (context, _) {
        final provider = widget.provider;
        final items = provider.displayedItems;

        return Scaffold(
          backgroundColor: const Color(0xFF0B1120),
          appBar: AppBar(
            backgroundColor: const Color(0xFF0F172A),
            elevation: 0,
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF4F46E5), Color(0xFF06B6D4)],
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.radar, color: Colors.white, size: 18),
                ),
                const SizedBox(width: 10),
                const Text(
                  'MultiFeed Intelligence',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 17,
                  ),
                ),
              ],
            ),
            actions: [
              // Auto-Refresh Selector
              PopupMenuButton<Duration?>(
                tooltip: 'Auto-Refresh Interval',
                onSelected: provider.setAutoRefresh,
                color: const Color(0xFF1E293B),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  margin: const EdgeInsets.only(right: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: provider.autoRefreshInterval != null
                          ? Colors.greenAccent.withValues(alpha: 0.5)
                          : const Color(0xFF334155),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.sync,
                        size: 14,
                        color: provider.autoRefreshInterval != null
                            ? Colors.greenAccent
                            : const Color(0xFF94A3B8),
                      ),
                      const SizedBox(width: 5),
                      Text(
                        provider.autoRefreshInterval == null
                            ? 'Auto: Off'
                            : 'Auto: ${provider.autoRefreshInterval!.inSeconds}s',
                        style: TextStyle(
                          color: provider.autoRefreshInterval != null
                              ? Colors.greenAccent
                              : const Color(0xFF94A3B8),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                itemBuilder: (context) => [
                  const PopupMenuItem(value: null, child: Text('Auto: Off', style: TextStyle(color: Colors.white))),
                  const PopupMenuItem(
                    value: Duration(seconds: 30),
                    child: Text('Every 30 seconds', style: TextStyle(color: Colors.white)),
                  ),
                  const PopupMenuItem(
                    value: Duration(minutes: 1),
                    child: Text('Every 1 minute', style: TextStyle(color: Colors.white)),
                  ),
                  const PopupMenuItem(
                    value: Duration(minutes: 2),
                    child: Text('Every 2 minutes', style: TextStyle(color: Colors.white)),
                  ),
                  const PopupMenuItem(
                    value: Duration(minutes: 5),
                    child: Text('Every 5 minutes', style: TextStyle(color: Colors.white)),
                  ),
                ],
              ),

              // Settings Button
              IconButton(
                icon: const Icon(Icons.settings_outlined, color: Color(0xFF94A3B8)),
                tooltip: 'Settings & Cookies',
                onPressed: () {
                  showDialog(
                    context: context,
                    builder: (ctx) => SettingsDialog(provider: provider),
                  );
                },
              ),
              const SizedBox(width: 8),
            ],
          ),
          body: Column(
            children: [
              // ── Search Bar Section ─────────────────────────────────────────
              Container(
                color: const Color(0xFF0F172A),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Stack(
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _searchController,
                                focusNode: _searchFocusNode,
                                onSubmitted: (_) => _performSearch(),
                                style: const TextStyle(color: Colors.white, fontSize: 14),
                                decoration: InputDecoration(
                                  hintText: 'Search keywords, e.g. Flutter developer...',
                                  hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                                  prefixIcon: const Icon(Icons.search, color: Color(0xFF818CF8), size: 20),
                                  suffixIcon: _searchController.text.isNotEmpty
                                      ? IconButton(
                                          icon: const Icon(Icons.clear, size: 16, color: Color(0xFF94A3B8)),
                                          onPressed: () {
                                            _searchController.clear();
                                            setState(() => _showSuggestions = false);
                                          },
                                        )
                                      : null,
                                  filled: true,
                                  fillColor: const Color(0xFF1E293B),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: const BorderSide(color: Color(0xFF334155)),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: const BorderSide(color: Color(0xFF334155)),
                                  ),
                                  focusedBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: const BorderSide(color: Color(0xFF6366F1), width: 1.5),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            ElevatedButton(
                              onPressed: provider.isLoading ? null : () => _performSearch(null, true),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF4F46E5),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                elevation: 0,
                              ),
                              child: provider.isLoading
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                    )
                                  : const Text('Search', style: TextStyle(fontWeight: FontWeight.bold)),
                            ),
                          ],
                        ),

                        // Suggestions Dropdown
                        if (_showSuggestions && _suggestions.isNotEmpty)
                          Positioned(
                            top: 50,
                            left: 0,
                            right: 90,
                            child: Container(
                              constraints: const BoxConstraints(maxHeight: 200),
                              decoration: BoxDecoration(
                                color: const Color(0xFF1E293B),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFF334155)),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.5),
                                    blurRadius: 12,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: ListView.separated(
                                shrinkWrap: true,
                                itemCount: _suggestions.length,
                                separatorBuilder: (_, index) => const Divider(color: Color(0xFF334155), height: 1),
                                itemBuilder: (context, i) {
                                  final item = _suggestions[i];
                                  return ListTile(
                                    dense: true,
                                    title: Text(item, style: const TextStyle(color: Colors.white, fontSize: 13)),
                                    trailing: const Icon(Icons.north_west, size: 14, color: Color(0xFF64748B)),
                                    onTap: () {
                                      _searchController.text = item;
                                      _performSearch(item, true);
                                    },
                                  );
                                },
                              ),
                            ),
                          ),
                      ],
                    ),

                    const SizedBox(height: 12),

                    // ── Platform Tabs (All, 𝕏 Twitter, 🔴 Reddit, 💼 LinkedIn) ────────
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          _buildTabItem(
                            label: '⚡ All',
                            count: provider.allCount,
                            source: null,
                            activeColor: const Color(0xFF6366F1),
                            provider: provider,
                          ),
                          const SizedBox(width: 8),
                          _buildTabItem(
                            label: '𝕏 Twitter',
                            count: provider.xCount,
                            source: FeedSource.x,
                            activeColor: const Color(0xFF1D9BF0),
                            provider: provider,
                          ),
                          const SizedBox(width: 8),
                          _buildTabItem(
                            label: '🔴 Reddit',
                            count: provider.redditCount,
                            source: FeedSource.reddit,
                            activeColor: const Color(0xFFFF4500),
                            provider: provider,
                          ),
                          const SizedBox(width: 8),
                          _buildTabItem(
                            label: '💼 LinkedIn',
                            count: provider.linkedinCount,
                            source: FeedSource.linkedin,
                            activeColor: const Color(0xFF0A66C2),
                            provider: provider,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              // ── Quick Leads Export Bar (if leads present) ───────────────────
              if (provider.totalEmailsCount > 0 || provider.totalPhonesCount > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: const BoxDecoration(
                    color: Color(0xFF0E1726),
                    border: Border(bottom: BorderSide(color: Color(0xFF1E293B))),
                  ),
                  child: Row(
                    children: [
                      const Text(
                        'Detected Leads in View:',
                        style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                      const Spacer(),
                      if (provider.totalEmailsCount > 0)
                        TextButton.icon(
                          onPressed: _copyAllEmails,
                          icon: const Icon(Icons.copy_all, size: 14, color: Color(0xFF2DD4BF)),
                          label: Text(
                            '${provider.totalEmailsCount} Emails',
                            style: const TextStyle(color: Color(0xFF2DD4BF), fontSize: 12, fontWeight: FontWeight.bold),
                          ),
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            backgroundColor: const Color(0xFF0F766E).withValues(alpha: 0.2),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                          ),
                        ),
                      const SizedBox(width: 6),
                      if (provider.totalPhonesCount > 0)
                        TextButton.icon(
                          onPressed: _copyAllPhones,
                          icon: const Icon(Icons.copy_all, size: 14, color: Color(0xFF60A5FA)),
                          label: Text(
                            '${provider.totalPhonesCount} Phones',
                            style: const TextStyle(color: Color(0xFF60A5FA), fontSize: 12, fontWeight: FontWeight.bold),
                          ),
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            backgroundColor: const Color(0xFF1E3A8A).withValues(alpha: 0.2),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                          ),
                        ),
                    ],
                  ),
                ),

              // ── Feed Items List with Infinite Scroll / Pagination ─────────
              Expanded(
                child: provider.isLoading && items.isEmpty
                    ? const Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            CircularProgressIndicator(color: Color(0xFF818CF8)),
                            SizedBox(height: 16),
                            Text(
                              'Scraping live feeds across X, Reddit & LinkedIn...',
                              style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                            ),
                          ],
                        ),
                      )
                    : provider.errorMessage != null && items.isEmpty
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.error_outline, color: Colors.amberAccent, size: 48),
                                  const SizedBox(height: 14),
                                  Text(
                                    provider.errorMessage!,
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(color: Colors.white, fontSize: 14),
                                  ),
                                  const SizedBox(height: 16),
                                  ElevatedButton.icon(
                                    onPressed: () => _performSearch(null, true),
                                    icon: const Icon(Icons.refresh),
                                    label: const Text('Retry Search'),
                                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF4F46E5)),
                                  ),
                                ],
                              ),
                            ),
                          )
                        : items.isEmpty
                            ? Center(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.search_off_rounded, color: Color(0xFF64748B), size: 48),
                                    const SizedBox(height: 12),
                                    const Text(
                                      'No posts found in this tab.',
                                      style: TextStyle(color: Color(0xFF94A3B8), fontSize: 15),
                                    ),
                                    const SizedBox(height: 6),
                                    const Text(
                                      'Try switching to another tab or search a different query.',
                                      style: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                                    ),
                                  ],
                                ),
                              )
                            : RefreshIndicator(
                                onRefresh: () => provider.search(provider.currentQuery, isForced: true),
                                color: const Color(0xFF6366F1),
                                child: ListView.builder(
                                  controller: _scrollController,
                                  itemCount: items.length + 1,
                                  padding: const EdgeInsets.only(top: 8, bottom: 24),
                                  itemBuilder: (context, i) {
                                    if (i < items.length) {
                                      return FeedCard(item: items[i]);
                                    }

                                    // ── Pagination Footer ───────────────────
                                    if (provider.isLoadingMore) {
                                      return Container(
                                        padding: const EdgeInsets.symmetric(vertical: 20),
                                        alignment: Alignment.center,
                                        child: const Row(
                                          mainAxisAlignment: MainAxisAlignment.center,
                                          children: [
                                            SizedBox(
                                              width: 18,
                                              height: 18,
                                              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF818CF8)),
                                            ),
                                            SizedBox(width: 12),
                                            Text(
                                              'Loading more posts...',
                                              style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                                            ),
                                          ],
                                        ),
                                      );
                                    }

                                    if (provider.hasMore && items.isNotEmpty) {
                                      return Padding(
                                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                        child: Center(
                                          child: OutlinedButton.icon(
                                            onPressed: provider.loadMore,
                                            icon: const Icon(Icons.expand_more, color: Color(0xFF818CF8), size: 18),
                                            label: const Text(
                                              'Load More Posts',
                                              style: TextStyle(color: Color(0xFF818CF8), fontWeight: FontWeight.bold),
                                            ),
                                            style: OutlinedButton.styleFrom(
                                              side: const BorderSide(color: Color(0xFF4F46E5)),
                                              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                            ),
                                          ),
                                        ),
                                      );
                                    }

                                    return Container(
                                      padding: const EdgeInsets.symmetric(vertical: 20),
                                      alignment: Alignment.center,
                                      child: Text(
                                        '✓ All ${items.length} posts loaded',
                                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                                      ),
                                    );
                                  },
                                ),
                              ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTabItem({
    required String label,
    required int count,
    required FeedSource? source,
    required Color activeColor,
    required FeedProvider provider,
  }) {
    final isSelected = provider.activeTab == source;

    return InkWell(
      onTap: () => provider.setActiveTab(source),
      borderRadius: BorderRadius.circular(10),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? activeColor.withValues(alpha: 0.2) : const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isSelected ? activeColor : const Color(0xFF334155),
            width: isSelected ? 1.5 : 1.0,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                color: isSelected ? Colors.white : const Color(0xFF94A3B8),
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
              ),
            ),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: isSelected ? activeColor : const Color(0xFF334155),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '$count',
                style: TextStyle(
                  color: isSelected ? Colors.white : const Color(0xFFCBD5E1),
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
