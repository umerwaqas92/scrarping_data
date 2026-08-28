import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_multifeed/utils/lead_extractor.dart';
import 'package:flutter_multifeed/services/proposal_service.dart';
import 'package:flutter_multifeed/services/email_service.dart';

void main() {
  group('LeadExtractor Tests', () {
    test('extracts valid emails correctly', () {
      const text =
          'Looking for a senior Flutter engineer! Please send CV to jobs@company.tech or hr.recruitment@agency.co.uk. Do not send to image.png';
      final emails = LeadExtractor.extractEmails(text);

      expect(emails, contains('jobs@company.tech'));
      expect(emails, contains('hr.recruitment@agency.co.uk'));
      expect(emails, isNot(contains('image.png')));
    });

    test('extracts phone numbers correctly', () {
      const text = 'Reach out via WhatsApp at +1 (555) 234-5678 or direct line +923459347900 for immediate hiring.';
      final phones = LeadExtractor.extractPhones(text);

      expect(phones.isNotEmpty, true);
    });
  });

  group('ProposalService Tests', () {
    test('cleans markdown formatting into pure plain text', () {
      const rawText = '''
# Senior Flutter Developer Application

**Hi Hiring Team,**

I would love to apply for your **Flutter Engineer** position. Check my [Portfolio](https://example.com/portfolio) and code samples.

* Shipped 10+ production mobile apps
* Scaled to 10k users
''';

      final cleaned = ProposalService.cleanMarkdownToPlainText(rawText);

      expect(cleaned.contains('**'), false);
      expect(cleaned.contains('#'), false);
      expect(cleaned.contains('[Portfolio]('), false);
      expect(cleaned.contains('Portfolio: https://example.com/portfolio'), true);
      expect(cleaned.contains('- Shipped 10+ production mobile apps'), true);
    });
  });

  group('EmailService Tests', () {
    test('extracts subject line from proposal body', () {
      const proposal = '''Subject: Senior Flutter Developer Application — Flutter, Dart & Firebase (6+ Years)

Hi Team,

I am applying for the Flutter developer position.''';

      final result = EmailService.extractSubjectAndBody(proposal, 'Flutter Developer');

      expect(result.subject, 'Senior Flutter Developer Application — Flutter, Dart & Firebase (6+ Years)');
      expect(result.body.startsWith('Subject:'), false);
      expect(result.body.contains('Hi Team,'), true);
    });
  });
}
