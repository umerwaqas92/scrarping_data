import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'providers/feed_provider.dart';
import 'views/home_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final feedProvider = FeedProvider();
  await feedProvider.initialize();

  runApp(MultiFeedApp(provider: feedProvider));
}

class MultiFeedApp extends StatelessWidget {
  final FeedProvider provider;

  const MultiFeedApp({super.key, required this.provider});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MultiFeed Intelligence & Lead Scraper',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0B1120),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF4F46E5),
          secondary: Color(0xFF06B6D4),
          surface: Color(0xFF1E293B),
        ),
        textTheme: GoogleFonts.interTextTheme(
          ThemeData(brightness: Brightness.dark).textTheme,
        ),
        useMaterial3: true,
      ),
      home: HomeScreen(provider: provider),
    );
  }
}
