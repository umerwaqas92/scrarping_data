import 'package:shared_preferences/shared_preferences.dart';
import '../models/app_settings.dart';

class StorageService {
  static const String _keyXAuthToken = 'x_auth_token';
  static const String _keyXCt0 = 'x_ct0';
  static const String _keyXGuestToken = 'x_guest_token';
  static const String _keyLinkedInCookies = 'linkedin_cookies';
  static const String _keyRedditCookies = 'reddit_cookies';
  static const String _keySmtpUser = 'smtp_user';
  static const String _keySmtpPassword = 'smtp_password';
  static const String _keySmtpHost = 'smtp_host';
  static const String _keySmtpPort = 'smtp_port';
  static const String _keyUserProfile = 'user_profile';
  static const String _keyMimoApiKey = 'mimo_api_key';
  static const String _keyLastQuery = 'last_search_query';

  Future<AppSettings> loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final defaults = AppSettings.defaults();

    return AppSettings(
      xAuthToken: prefs.getString(_keyXAuthToken) ?? defaults.xAuthToken,
      xCt0: prefs.getString(_keyXCt0) ?? defaults.xCt0,
      xGuestToken: prefs.getString(_keyXGuestToken) ?? defaults.xGuestToken,
      linkedInCookies: prefs.getString(_keyLinkedInCookies) ?? defaults.linkedInCookies,
      redditCookies: prefs.getString(_keyRedditCookies) ?? defaults.redditCookies,
      smtpUser: prefs.getString(_keySmtpUser) ?? defaults.smtpUser,
      smtpPassword: prefs.getString(_keySmtpPassword) ?? defaults.smtpPassword,
      smtpHost: prefs.getString(_keySmtpHost) ?? defaults.smtpHost,
      smtpPort: prefs.getInt(_keySmtpPort) ?? defaults.smtpPort,
      userProfile: prefs.getString(_keyUserProfile) ?? defaults.userProfile,
      mimoApiKey: prefs.getString(_keyMimoApiKey) ?? defaults.mimoApiKey,
    );
  }

  Future<void> saveSettings(AppSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyXAuthToken, settings.xAuthToken);
    await prefs.setString(_keyXCt0, settings.xCt0);
    await prefs.setString(_keyXGuestToken, settings.xGuestToken);
    await prefs.setString(_keyLinkedInCookies, settings.linkedInCookies);
    await prefs.setString(_keyRedditCookies, settings.redditCookies);
    await prefs.setString(_keySmtpUser, settings.smtpUser);
    await prefs.setString(_keySmtpPassword, settings.smtpPassword);
    await prefs.setString(_keySmtpHost, settings.smtpHost);
    await prefs.setInt(_keySmtpPort, settings.smtpPort);
    await prefs.setString(_keyUserProfile, settings.userProfile);
    await prefs.setString(_keyMimoApiKey, settings.mimoApiKey);
  }

  Future<String> loadLastQuery() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyLastQuery) ?? 'Flutter developer, looking for developer';
  }

  Future<void> saveLastQuery(String query) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyLastQuery, query);
  }
}
