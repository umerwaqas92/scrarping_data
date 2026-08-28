import '../config/constants.dart';

class AppSettings {
  final String xAuthToken;
  final String xCt0;
  final String xGuestToken;
  final String linkedInCookies;
  final String redditCookies;
  final String smtpUser;
  final String smtpPassword;
  final String smtpHost;
  final int smtpPort;
  final String userProfile;
  final String mimoApiKey;

  const AppSettings({
    required this.xAuthToken,
    required this.xCt0,
    required this.xGuestToken,
    required this.linkedInCookies,
    required this.redditCookies,
    required this.smtpUser,
    required this.smtpPassword,
    required this.smtpHost,
    required this.smtpPort,
    required this.userProfile,
    required this.mimoApiKey,
  });

  factory AppSettings.defaults() {
    return const AppSettings(
      xAuthToken: AppConstants.defaultXAuthToken,
      xCt0: AppConstants.defaultXCt0,
      xGuestToken: AppConstants.defaultXGuestToken,
      linkedInCookies: AppConstants.defaultLinkedInCookies,
      redditCookies: AppConstants.defaultRedditCookies,
      smtpUser: AppConstants.defaultSmtpUser,
      smtpPassword: AppConstants.defaultSmtpPassword,
      smtpHost: AppConstants.defaultSmtpHost,
      smtpPort: AppConstants.defaultSmtpPort,
      userProfile: AppConstants.defaultProfileContent,
      mimoApiKey: AppConstants.mimoApiKey,
    );
  }

  AppSettings copyWith({
    String? xAuthToken,
    String? xCt0,
    String? xGuestToken,
    String? linkedInCookies,
    String? redditCookies,
    String? smtpUser,
    String? smtpPassword,
    String? smtpHost,
    int? smtpPort,
    String? userProfile,
    String? mimoApiKey,
  }) {
    return AppSettings(
      xAuthToken: xAuthToken ?? this.xAuthToken,
      xCt0: xCt0 ?? this.xCt0,
      xGuestToken: xGuestToken ?? this.xGuestToken,
      linkedInCookies: linkedInCookies ?? this.linkedInCookies,
      redditCookies: redditCookies ?? this.redditCookies,
      smtpUser: smtpUser ?? this.smtpUser,
      smtpPassword: smtpPassword ?? this.smtpPassword,
      smtpHost: smtpHost ?? this.smtpHost,
      smtpPort: smtpPort ?? this.smtpPort,
      userProfile: userProfile ?? this.userProfile,
      mimoApiKey: mimoApiKey ?? this.mimoApiKey,
    );
  }
}
