import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/feed_item.dart';
import '../models/app_settings.dart';
import '../services/x_service.dart';
import '../services/reddit_service.dart';
import '../services/linkedin_service.dart';
import '../services/storage_service.dart';

enum LeadFilter { all, anyLead, withEmail, withPhone }

class FeedProvider extends ChangeNotifier {
  final XService _xService = XService();
  final RedditService _redditService = RedditService();
  final LinkedInService _linkedinService = LinkedInService();
  final StorageService _storageService = StorageService();

  AppSettings _settings = AppSettings.defaults();
  String _currentQuery = '';
  bool _isLoading = false;
  String? _errorMessage;
  DateTime? _lastUpdated;

  final Set<FeedSource> _enabledSources = {
    FeedSource.x,
    FeedSource.reddit,
    FeedSource.linkedin,
  };

  LeadFilter _leadFilter = LeadFilter.all;
  List<FeedItem> _items = [];
  Timer? _autoRefreshTimer;
  Duration? _autoRefreshInterval;

  // Getters
  AppSettings get settings => _settings;
  String get currentQuery => _currentQuery;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  DateTime? get lastUpdated => _lastUpdated;
  Set<FeedSource> get enabledSources => _enabledSources;
  LeadFilter get leadFilter => _leadFilter;
  Duration? get autoRefreshInterval => _autoRefreshInterval;

  List<FeedItem> get allItems => _items;

  List<FeedItem> get filteredItems {
    return _items.where((item) {
      // Source filter
      if (!_enabledSources.contains(item.source)) return false;

      // Lead filter
      switch (_leadFilter) {
        case LeadFilter.all:
          return true;
        case LeadFilter.anyLead:
          return item.hasLead;
        case LeadFilter.withEmail:
          return item.hasEmail;
        case LeadFilter.withPhone:
          return item.hasPhone;
      }
    }).toList();
  }

  int get totalEmailsCount {
    final Set<String> uniqueEmails = {};
    for (final item in _items) {
      if (_enabledSources.contains(item.source)) {
        uniqueEmails.addAll(item.extractedEmails);
      }
    }
    return uniqueEmails.length;
  }

  int get totalPhonesCount {
    final Set<String> uniquePhones = {};
    for (final item in _items) {
      if (_enabledSources.contains(item.source)) {
        uniquePhones.addAll(item.extractedPhones);
      }
    }
    return uniquePhones.length;
  }

  List<String> get allUniqueEmails {
    final Set<String> uniqueEmails = {};
    for (final item in filteredItems) {
      uniqueEmails.addAll(item.extractedEmails);
    }
    return uniqueEmails.toList();
  }

  List<String> get allUniquePhones {
    final Set<String> uniquePhones = {};
    for (final item in filteredItems) {
      uniquePhones.addAll(item.extractedPhones);
    }
    return uniquePhones.toList();
  }

  Future<void> initialize() async {
    _settings = await _storageService.loadSettings();
    _currentQuery = await _storageService.loadLastQuery();
    notifyListeners();
    if (_currentQuery.isNotEmpty) {
      search(_currentQuery);
    }
  }

  Future<void> updateSettings(AppSettings newSettings) async {
    _settings = newSettings;
    await _storageService.saveSettings(newSettings);
    notifyListeners();
  }

  void toggleSource(FeedSource source) {
    if (_enabledSources.contains(source)) {
      if (_enabledSources.length > 1) {
        _enabledSources.remove(source);
      }
    } else {
      _enabledSources.add(source);
    }
    notifyListeners();
  }

  void setLeadFilter(LeadFilter filter) {
    _leadFilter = filter;
    notifyListeners();
  }

  void setAutoRefresh(Duration? interval) {
    _autoRefreshInterval = interval;
    _autoRefreshTimer?.cancel();

    if (interval != null) {
      _autoRefreshTimer = Timer.periodic(interval, (_) {
        if (_currentQuery.isNotEmpty && !_isLoading) {
          search(_currentQuery, isBackgroundRefresh: true);
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

  Future<void> search(String query, {bool isBackgroundRefresh = false}) async {
    final clean = query.trim();
    if (clean.isEmpty) return;

    _currentQuery = clean;
    await _storageService.saveLastQuery(clean);

    if (!isBackgroundRefresh) {
      _isLoading = true;
      _errorMessage = null;
      notifyListeners();
    }

    final queries = _splitQueries(clean);
    final List<FeedItem> fetchedItems = [];
    final List<String> errors = [];

    // Concurrently fetch across all queries and enabled sources
    final List<Future<void>> tasks = [];

    for (final q in queries) {
      if (_enabledSources.contains(FeedSource.reddit)) {
        tasks.add(() async {
          try {
            final posts = await _redditService.search(q, _settings, count: 25);
            fetchedItems.addAll(posts);
          } catch (e) {
            errors.add('Reddit ($q): $e');
          }
        }());
      }

      if (_enabledSources.contains(FeedSource.x)) {
        tasks.add(() async {
          try {
            final tweets = await _xService.search(q, _settings, count: 20);
            fetchedItems.addAll(tweets);
          } catch (e) {
            errors.add('X ($q): $e');
          }
        }());
      }

      if (_enabledSources.contains(FeedSource.linkedin)) {
        tasks.add(() async {
          try {
            final posts = await _linkedinService.searchPosts(q, _settings, limit: 15);
            fetchedItems.addAll(posts);
          } catch (e) {
            errors.add('LinkedIn ($q): $e');
          }
        }());
      }
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

    // Sort by latest posted date
    deduped.sort((a, b) => b.postedAt.compareTo(a.postedAt));

    _items = deduped;
    _lastUpdated = DateTime.now();
    _isLoading = false;
    if (errors.isNotEmpty && deduped.isEmpty) {
      _errorMessage = errors.join('\n');
    } else {
      _errorMessage = null;
    }

    notifyListeners();
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    super.dispose();
  }
}
