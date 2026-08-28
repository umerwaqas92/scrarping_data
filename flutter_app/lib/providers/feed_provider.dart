import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/feed_item.dart';
import '../models/app_settings.dart';
import '../services/x_service.dart';
import '../services/reddit_service.dart';
import '../services/linkedin_service.dart';
import '../services/storage_service.dart';

class FeedProvider extends ChangeNotifier {
  final XService _xService = XService();
  final RedditService _redditService = RedditService();
  final LinkedInService _linkedinService = LinkedInService();
  final StorageService _storageService = StorageService();

  AppSettings _settings = AppSettings.defaults();
  String _currentQuery = '';
  String _lastSearchedQuery = '';
  bool _isLoading = false;
  bool _isLoadingMore = false;
  bool _hasMore = true;
  String? _errorMessage;
  DateTime? _lastUpdated;

  FeedSource? _activeTab = FeedSource.linkedin; // Default to LinkedIn

  List<FeedItem> _items = [];
  Timer? _autoRefreshTimer;
  Duration? _autoRefreshInterval;

  // Pagination cursors
  String? _xCursor;
  String? _redditAfter;
  int _linkedinPage = 1;

  // Getters
  AppSettings get settings => _settings;
  String get currentQuery => _currentQuery;
  bool get isLoading => _isLoading;
  bool get isLoadingMore => _isLoadingMore;
  bool get hasMore => _hasMore;
  String? get errorMessage => _errorMessage;
  DateTime? get lastUpdated => _lastUpdated;
  FeedSource? get activeTab => _activeTab;
  Duration? get autoRefreshInterval => _autoRefreshInterval;

  List<FeedItem> get allItems => _items;

  List<FeedItem> get displayedItems {
    if (_activeTab == null) {
      return _items;
    }
    return _items.where((i) => i.source == _activeTab).toList();
  }

  List<String> _quickSuggestions = StorageService.defaultSuggestions;
  List<String> get quickSuggestions => _quickSuggestions;

  int get allCount => _items.length;
  int get xCount => _items.where((i) => i.source == FeedSource.x).length;
  int get redditCount => _items.where((i) => i.source == FeedSource.reddit).length;
  int get linkedinCount => _items.where((i) => i.source == FeedSource.linkedin).length;

  int countForSource(FeedSource source) {
    return _items.where((i) => i.source == source).length;
  }

  int get totalEmailsCount {
    final Set<String> uniqueEmails = {};
    for (final item in _items) {
      uniqueEmails.addAll(item.extractedEmails);
    }
    return uniqueEmails.length;
  }

  int get totalPhonesCount {
    final Set<String> uniquePhones = {};
    for (final item in _items) {
      uniquePhones.addAll(item.extractedPhones);
    }
    return uniquePhones.length;
  }

  List<String> get allUniqueEmails {
    final Set<String> uniqueEmails = {};
    for (final item in displayedItems) {
      uniqueEmails.addAll(item.extractedEmails);
    }
    return uniqueEmails.toList();
  }

  List<String> get allUniquePhones {
    final Set<String> uniquePhones = {};
    for (final item in displayedItems) {
      uniquePhones.addAll(item.extractedPhones);
    }
    return uniquePhones.toList();
  }

  Future<void> initialize() async {
    _settings = await _storageService.loadSettings();
    _currentQuery = await _storageService.loadLastQuery();
    _quickSuggestions = await _storageService.loadQuickSuggestions();
    notifyListeners();
    if (_currentQuery.isNotEmpty) {
      search(_currentQuery, isForced: true);
    }
  }

  Future<String> getRawQuickSuggestions() => _storageService.loadRawQuickSuggestions();

  Future<void> saveQuickSuggestions(String rawText) async {
    await _storageService.saveQuickSuggestions(rawText);
    _quickSuggestions = await _storageService.loadQuickSuggestions();
    notifyListeners();
  }

  Future<void> updateSettings(AppSettings newSettings) async {
    _settings = newSettings;
    await _storageService.saveSettings(newSettings);
    notifyListeners();
  }

  void setActiveTab(FeedSource? tab) {
    _activeTab = tab;
    notifyListeners();
  }

  void setAutoRefresh(Duration? interval) {
    _autoRefreshInterval = interval;
    _autoRefreshTimer?.cancel();

    if (interval != null) {
      _autoRefreshTimer = Timer.periodic(interval, (_) {
        if (_currentQuery.isNotEmpty && !_isLoading && !_isLoadingMore) {
          search(_currentQuery, isForced: true, isBackgroundRefresh: true);
        }
      });
    }
    notifyListeners();
  }

  List<String> _splitQueries(String input) {
    return input
        .split(',')
        .map((q) => q.trim())
        .where((q) => q.isNotEmpty)
        .toSet()
        .toList();
  }

  Future<void> search(String query, {bool isForced = false, bool isBackgroundRefresh = false}) async {
    final clean = query.trim();
    if (clean.isEmpty) return;

    // Prevent searching the exact same query repeatedly unless forced
    if (!isForced && !isBackgroundRefresh && clean.toLowerCase() == _lastSearchedQuery.toLowerCase() && _items.isNotEmpty) {
      return;
    }

    _currentQuery = clean;
    _lastSearchedQuery = clean;
    await _storageService.saveLastQuery(clean);

    if (!isBackgroundRefresh) {
      _isLoading = true;
      _errorMessage = null;
      notifyListeners();
    }

    // Reset pagination state
    _xCursor = null;
    _redditAfter = null;
    _linkedinPage = 1;
    _hasMore = true;

    final queries = _splitQueries(clean);
    final List<FeedItem> fetchedItems = [];
    final List<String> errors = [];

    // Parallel fetch across all queries and sources
    final List<Future<void>> tasks = [];

    for (final q in queries) {
      // 1. Reddit
      tasks.add(() async {
        try {
          final res = await _redditService.search(q, _settings, count: 40);
          fetchedItems.addAll(res.posts);
          if (res.nextAfter != null) _redditAfter = res.nextAfter;
        } catch (e) {
          errors.add('Reddit ($q): $e');
        }
      }());

      // 2. X (Twitter)
      tasks.add(() async {
        try {
          final res = await _xService.search(q, _settings, count: 35);
          fetchedItems.addAll(res.tweets);
          if (res.nextCursor != null) _xCursor = res.nextCursor;
        } catch (e) {
          errors.add('X ($q): $e');
        }
      }());

      // 3. LinkedIn
      tasks.add(() async {
        try {
          final posts = await _linkedinService.searchPosts(q, _settings, limit: 20);
          fetchedItems.addAll(posts);
        } catch (e) {
          errors.add('LinkedIn ($q): $e');
        }
      }());
    }

    await Future.wait(tasks);

    // Deduplicate by ID and postUrl
    final Set<String> seenIds = {};
    final Set<String> seenUrls = {};
    final List<FeedItem> deduped = [];

    for (final item in fetchedItems) {
      if (!seenIds.contains(item.id) && !seenUrls.contains(item.postUrl)) {
        seenIds.add(item.id);
        seenUrls.add(item.postUrl);
        deduped.add(item);
      }
    }

    deduped.sort((a, b) => b.postedAt.compareTo(a.postedAt));

    _items = deduped;
    _lastUpdated = DateTime.now();
    _isLoading = false;
    _hasMore = deduped.isNotEmpty;

    if (errors.isNotEmpty && deduped.isEmpty) {
      _errorMessage = errors.join('\n');
    } else {
      _errorMessage = null;
    }

    notifyListeners();
  }

  Future<void> loadMore() async {
    if (_isLoadingMore || _isLoading || !_hasMore || _currentQuery.isEmpty) return;

    _isLoadingMore = true;
    notifyListeners();

    final clean = _currentQuery;
    final queries = _splitQueries(clean);
    final List<FeedItem> newItems = [];
    _linkedinPage++;

    final List<Future<void>> tasks = [];

    for (final q in queries) {
      // 1. Reddit pagination
      if (_redditAfter != null) {
        tasks.add(() async {
          try {
            final res = await _redditService.search(q, _settings, count: 25, after: _redditAfter);
            newItems.addAll(res.posts);
            _redditAfter = res.nextAfter;
          } catch (_) {}
        }());
      }

      // 2. X pagination
      if (_xCursor != null) {
        tasks.add(() async {
          try {
            final res = await _xService.search(q, _settings, count: 25, cursor: _xCursor);
            newItems.addAll(res.tweets);
            _xCursor = res.nextCursor;
          } catch (_) {}
        }());
      }

      // 3. LinkedIn pagination
      tasks.add(() async {
        try {
          final posts = await _linkedinService.searchPosts('$q page $_linkedinPage', _settings, limit: 15);
          newItems.addAll(posts);
        } catch (_) {}
      }());
    }

    await Future.wait(tasks);

    final Set<String> existingIds = _items.map((i) => i.id).toSet();
    final Set<String> existingUrls = _items.map((i) => i.postUrl).toSet();
    final List<FeedItem> added = [];

    for (final item in newItems) {
      if (!existingIds.contains(item.id) && !existingUrls.contains(item.postUrl)) {
        existingIds.add(item.id);
        existingUrls.add(item.postUrl);
        added.add(item);
      }
    }

    if (added.isNotEmpty) {
      _items.addAll(added);
      _items.sort((a, b) => b.postedAt.compareTo(a.postedAt));
    } else {
      _hasMore = false;
    }

    _isLoadingMore = false;
    notifyListeners();
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    super.dispose();
  }
}
