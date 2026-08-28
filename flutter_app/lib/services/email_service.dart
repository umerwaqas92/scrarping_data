import 'package:mailer/mailer.dart';
import 'package:mailer/smtp_server.dart';
import '../models/app_settings.dart';

class EmailService {
  /// Extracts the subject line from proposal body or returns fallback
  static ({String subject, String body}) extractSubjectAndBody(String proposalText, String? jobTitle) {
    String subject = '';
    String body = proposalText.trim();

    final subjectRegex = RegExp(
      r'^\s*(?:\*{0,2}|#{1,6}\s*)?(?:Subject(?:\s+Line)?|RE)\s*:\s*([^\n\r]+)(?:\r?\n)*',
      caseSensitive: false,
    );

    final match = subjectRegex.firstMatch(body);
    if (match != null) {
      subject = (match.group(1) ?? '')
          .replaceAll(RegExp(r'^[\*\s"\_]+|[\*\s"\_]+$'), '')
          .trim();
      body = body.replaceFirst(subjectRegex, '').trim();
    }

    if (subject.isEmpty) {
      if (jobTitle != null && jobTitle.isNotEmpty && !jobTitle.toLowerCase().contains('followers')) {
        subject = 'Application / Proposal: $jobTitle';
      } else {
        subject = 'Job Application / Proposal';
      }
    }

    return (subject: subject, body: body);
  }

  Future<void> sendEmail({
    required String to,
    required String subject,
    required String body,
    required AppSettings settings,
  }) async {
    final cleanTo = to.trim();
    if (!cleanTo.contains('@')) {
      throw Exception('Invalid recipient email address');
    }

    final cleanPass = settings.smtpPassword.replaceAll(RegExp(r'\s+'), '');
    final smtpServer = SmtpServer(
      settings.smtpHost,
      port: settings.smtpPort,
      ssl: settings.smtpPort == 465,
      username: settings.smtpUser,
      password: cleanPass,
    );

    final message = Message()
      ..from = Address(settings.smtpUser, 'Job Applicant')
      ..recipients.add(cleanTo)
      ..subject = subject
      ..text = body;

    await send(message, smtpServer);
  }
}
