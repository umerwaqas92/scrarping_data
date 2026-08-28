import 'package:flutter/material.dart';
import '../../providers/feed_provider.dart';

class SettingsDialog extends StatefulWidget {
  final FeedProvider provider;

  const SettingsDialog({super.key, required this.provider});

  @override
  State<SettingsDialog> createState() => _SettingsDialogState();
}

class _SettingsDialogState extends State<SettingsDialog> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  late TextEditingController _profileController;
  late TextEditingController _xAuthTokenController;
  late TextEditingController _xCt0Controller;
  late TextEditingController _xGuestTokenController;
  late TextEditingController _linkedInCookiesController;
  late TextEditingController _redditCookiesController;
  late TextEditingController _smtpUserController;
  late TextEditingController _smtpPasswordController;
  late TextEditingController _smtpHostController;
  late TextEditingController _smtpPortController;
  late TextEditingController _mimoApiKeyController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
    final s = widget.provider.settings;

    _profileController = TextEditingController(text: s.userProfile);
    _xAuthTokenController = TextEditingController(text: s.xAuthToken);
    _xCt0Controller = TextEditingController(text: s.xCt0);
    _xGuestTokenController = TextEditingController(text: s.xGuestToken);
    _linkedInCookiesController = TextEditingController(text: s.linkedInCookies);
    _redditCookiesController = TextEditingController(text: s.redditCookies);
    _smtpUserController = TextEditingController(text: s.smtpUser);
    _smtpPasswordController = TextEditingController(text: s.smtpPassword);
    _smtpHostController = TextEditingController(text: s.smtpHost);
    _smtpPortController = TextEditingController(text: s.smtpPort.toString());
    _mimoApiKeyController = TextEditingController(text: s.mimoApiKey);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _profileController.dispose();
    _xAuthTokenController.dispose();
    _xCt0Controller.dispose();
    _xGuestTokenController.dispose();
    _linkedInCookiesController.dispose();
    _redditCookiesController.dispose();
    _smtpUserController.dispose();
    _smtpPasswordController.dispose();
    _smtpHostController.dispose();
    _smtpPortController.dispose();
    _mimoApiKeyController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final updated = widget.provider.settings.copyWith(
      userProfile: _profileController.text.trim(),
      xAuthToken: _xAuthTokenController.text.trim(),
      xCt0: _xCt0Controller.text.trim(),
      xGuestToken: _xGuestTokenController.text.trim(),
      linkedInCookies: _linkedInCookiesController.text.trim(),
      redditCookies: _redditCookiesController.text.trim(),
      smtpUser: _smtpUserController.text.trim(),
      smtpPassword: _smtpPasswordController.text.trim(),
      smtpHost: _smtpHostController.text.trim(),
      smtpPort: int.tryParse(_smtpPortController.text.trim()) ?? 465,
      mimoApiKey: _mimoApiKeyController.text.trim(),
    );

    await widget.provider.updateSettings(updated);

    if (mounted) {
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Settings saved successfully!'),
          backgroundColor: Color(0xFF1E293B),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    String? hint,
    int maxLines = 1,
    bool isPassword = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          maxLines: maxLines,
          obscureText: isPassword,
          style: const TextStyle(color: Colors.white, fontSize: 13, fontFamily: 'monospace'),
          decoration: InputDecoration(
            hintText: hint,
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
        const SizedBox(height: 12),
      ],
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
        width: size.width > 720 ? 680 : size.width * 0.95,
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
                    color: const Color(0xFF0EA5E9).withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.tune, color: Color(0xFF38BDF8), size: 20),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Settings & Credentials',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        'Manage direct scraping cookies, candidate profile, and SMTP',
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

            const SizedBox(height: 12),

            // ── Tab Bar ───────────────────────────────────────────────────
            TabBar(
              controller: _tabController,
              isScrollable: true,
              labelColor: const Color(0xFF38BDF8),
              unselectedLabelColor: const Color(0xFF64748B),
              indicatorColor: const Color(0xFF38BDF8),
              tabs: const [
                Tab(text: '👤 Profile & Resume'),
                Tab(text: '💼 LinkedIn Cookies'),
                Tab(text: '🔴 Reddit Cookies'),
                Tab(text: '𝕏 Twitter Tokens'),
                Tab(text: '✉️ Gmail SMTP & AI'),
              ],
            ),

            const SizedBox(height: 14),

            // ── Tab Views ─────────────────────────────────────────────────
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Tab 1: Profile
                  SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Candidate Resume / Portfolio Background',
                          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 6),
                        TextField(
                          controller: _profileController,
                          maxLines: 15,
                          style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.4),
                          decoration: InputDecoration(
                            hintText: 'Paste your full resume, stack, featured projects, metrics, and links here...',
                            hintStyle: const TextStyle(color: Color(0xFF64748B)),
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

                  // Tab 2: LinkedIn Cookies
                  SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'LinkedIn Session Cookies',
                          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Paste your Netscape cookie export or cookie key-value string (must include JSESSIONID and li_at).',
                          style: TextStyle(color: Color(0xFF64748B), fontSize: 11),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _linkedInCookiesController,
                          maxLines: 14,
                          style: const TextStyle(color: Colors.white, fontSize: 12, fontFamily: 'monospace'),
                          decoration: InputDecoration(
                            hintText: 'JSESSIONID="ajax:..."; li_at=AQEF...',
                            hintStyle: const TextStyle(color: Color(0xFF64748B)),
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

                  // Tab 3: Reddit Cookies
                  SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Reddit Session Cookies',
                          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Paste your Reddit cookies (Netscape format or cookie key-value pairs).',
                          style: TextStyle(color: Color(0xFF64748B), fontSize: 11),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _redditCookiesController,
                          maxLines: 14,
                          style: const TextStyle(color: Colors.white, fontSize: 12, fontFamily: 'monospace'),
                          decoration: InputDecoration(
                            hintText: 'reddit_session=...; token_v2=...',
                            hintStyle: const TextStyle(color: Color(0xFF64748B)),
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

                  // Tab 3: X (Twitter) Tokens
                  SingleChildScrollView(
                    child: Column(
                      children: [
                        _buildTextField(
                          controller: _xAuthTokenController,
                          label: 'X_AUTH_TOKEN (auth_token cookie)',
                          hint: 'e.g. a61067a2fc...',
                        ),
                        _buildTextField(
                          controller: _xCt0Controller,
                          label: 'X_CT0 (ct0 CSRF cookie / header)',
                          hint: 'e.g. 70c62a98daa...',
                          maxLines: 2,
                        ),
                        _buildTextField(
                          controller: _xGuestTokenController,
                          label: 'X_GUEST_TOKEN (optional)',
                          hint: 'e.g. v1%3A1784...',
                        ),
                      ],
                    ),
                  ),

                  // Tab 4: SMTP & AI
                  SingleChildScrollView(
                    child: Column(
                      children: [
                        _buildTextField(
                          controller: _smtpUserController,
                          label: 'Gmail Address (Sender)',
                          hint: 'e.g. yourname@gmail.com',
                        ),
                        _buildTextField(
                          controller: _smtpPasswordController,
                          label: 'Google App Password (16 chars)',
                          hint: 'xxxx xxxx xxxx xxxx',
                          isPassword: true,
                        ),
                        Row(
                          children: [
                            Expanded(
                              flex: 2,
                              child: _buildTextField(
                                controller: _smtpHostController,
                                label: 'SMTP Host',
                                hint: 'smtp.gmail.com',
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              flex: 1,
                              child: _buildTextField(
                                controller: _smtpPortController,
                                label: 'Port',
                                hint: '465',
                              ),
                            ),
                          ],
                        ),
                        _buildTextField(
                          controller: _mimoApiKeyController,
                          label: 'MiMo AI API Key',
                          hint: 'sk-tiCmvy...',
                          isPassword: true,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 14),
            const Divider(color: Color(0xFF334155), height: 1),
            const SizedBox(height: 14),

            // ── Footer ────────────────────────────────────────────────────
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel', style: TextStyle(color: Color(0xFF94A3B8))),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  onPressed: _save,
                  icon: const Icon(Icons.check_rounded, size: 16),
                  label: const Text('Save Settings'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0284C7),
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
