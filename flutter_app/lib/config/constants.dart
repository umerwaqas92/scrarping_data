class AppConstants {
  // MiMo AI Endpoint & Defaults
  static const String mimoEndpoint = "https://opencode.ai/zen/go/v1/chat/completions";
  static const String mimoModel = "mimo-v2.5";
  static const String mimoApiKey = "sk-tiCmvyYVq8duMmWubkiUXqw2jgacat9FrGamiWhDd87sj92A7cKeaWlGuKqUNPRO";

  // X (Twitter) Defaults
  static const String xBearerToken =
      "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  static const String xSearchTimelineQueryId = "hyPfJYJ_XAtDYoslQc-Rgg";
  static const String defaultXAuthToken = "a61067a2fcf6b41245b5c45dcb26b4ff9a9447d3";
  static const String defaultXCt0 =
      "70c62a98daa9f5230e05ac7f946d7d0545a61d930e16a6a4c24dca3e37c195e94e701753fd00de9244b28753dbbfb12d9e58bf4c83736f12dbe9105936fe2b458530c527945ba429a49c3630a473d117";
  static const String defaultXGuestToken = "v1%3A178480885254790007";

  // Gmail SMTP Defaults
  static const String defaultSmtpUser = "um.waqas.khan@gmail.com";
  static const String defaultSmtpPassword = "tmpv cugm btsx yrdq";
  static const String defaultSmtpHost = "smtp.gmail.com";
  static const int defaultSmtpPort = 465;

  // Default User Profile
  static const String defaultProfileContent = '''
Umer Waqas — AI Full Stack Developer & Flutter Specialist
Upwork Top Rated Freelancer · 100% Job Success · 40+ Production Projects Shipped

Skills & Expertise:
- Mobile: Flutter / Dart (iOS & Android App Store deployments), React Native
- Frontend: React, Next.js, TypeScript, Tailwind CSS, HTML5/CSS3
- Backend & Cloud: Node.js, Express, Python, FastAPI, Django, Go, AWS (EC2, S3, Lambda), Docker, CI/CD
- AI & Automation: Claude Code, Cursor AI, OpenAI / Claude API, LangChain, RAG Systems, Vector Databases (Pinecone/pgvector)

Featured Projects:
1. AI Influencer Generator: Cross-platform Flutter iOS & Android apps and Next.js web platform for AI avatar & viral video generation.
2. WorkForge Freelance Marketplace: Complete marketplace with real-time job discovery, proposal bidding, and escrow checkout.
3. OnePDF: Everything PDF: iOS utility app for document scanning, conversions, merging, and cryptographic signing.
4. Askly AI Database Agent: Mac desktop app connecting to SQL databases for natural language queries (Go, React/Electron).

Contact & Links:
Email: um.waqas.khan@gmail.com
WhatsApp: +92 345 9347900
Portfolio: https://umerwaqas.pages.dev/
Upwork: https://www.upwork.com/freelancers/~010219e25749223694
GitHub: https://github.com/umerwaqas92
LinkedIn: https://www.linkedin.com/in/umerwaqas92
''';

  // Default LinkedIn Cookies
  static const String defaultLinkedInCookies = '''
JSESSIONID="ajax:7225065264348247410"; li_at=AQEFARABAAAAACA3wCEAAAGgSCl6KwAAAaBsRSMJTQAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDZG51VGpTQ2FVMzNtRHhBdDViWjBFeU9Ja2FyT1pneG1STDV6T2NyQUNBQ2Fzd2U5XnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjEyMTU4Mjc2OSwxNTM1OTAyNjQpXnVybjpsaTptZW1iZXI6NDU0MzA0MjMxU6SERYAi9GlDDxkIIDc0UHgYUv-DEQuegHAZROL3PSU3-HSqLFeK_nnZov5ORSPYbABksfrGXdM_oJUfYtjMOGlYglRY9T0wyKHpvE1LH5Ko425eSFiVzG5YsMR2hUpYm0twd0Gzzls14VoTuiUyoy2dhqbwj5xGMbTAHnm3PUfc0yQd1JGMGVWswHtccIEkh8_ptg; bcookie="v=2&774eb95a-9f7a-4f84-8131-b25703eb17ec"; bscookie="v=1&202606081816132c234bcd-310d-4e3f-8dd3-ebd35793fb39AQGo1KLe9W3PPFZygxG3e_g-_uJa0Um_"; li_sugr=94dc8154-4a1f-42ec-a91a-0c122aae377a
''';

  // Default Reddit Cookies
  static const String defaultRedditCookies = '''
csv=2; edgebucket=nIQWJKKYEQZgsfb1Kj; loid=0000000018afbt3x9o.2.1725707974131.Z0FBQUFBQnFVMUpleUdTR2NIUlQ0ZUNIS0d1UDhOdWdDVGJHc00wcnpLY3BZUnRJVVlhOE1lZWRiV3pNcm5DNVZmeFdQZVB0N0hkUmJfcUNRZElaeDRWZGhkVzRhX1dZbTRwaG1jZklnVjRQSElLdG5hQ1dFVWJmTnpVa3dzTW9CNUZuWEE5TG56Tmc; theme=1; reddit_session=eyJhbGciOiJSUzI1NiIsImtpZCI6IlNIQTI1NjpsVFdYNlFVUEloWktaRG1rR0pVd1gvdWNFK01BSjBYRE12RU1kNzVxTXQ4IiwidHlwIjoiSldUIn0.eyJzdWIiOiJ0Ml8xOGFmYnQzeDlvIiwiZXhwIjoxODAyMzM1MDI0LjY0ODI3MywiaWF0IjoxNzg2Njk2NjI0LjY0ODI3MywianRpIjoib25MUS0tU2w2RFg5RDVTb3cxQ0h1bUF3cWJyOUdBIiwiYXQiOjEsImNpZCI6ImNvb2tpZSIsImxjYSI6MTcyNTcwNzk3NDEzMSwic2NwIjoiZUp5S2pnVUVBQURfX3dFVkFMayIsImZsbyI6MiwiYW1yIjpbInB3ZCJdfQ.U6cpqI-l19KaOb1XsURCGnQtbZtcsEiXsuR-Eyemst32KhIeRU4Vam9psGzA6G4sAFMjM12eGOp82gs1j54flPcq2V_gTUypZjpZnWRct014jvdO4sSAgQg10YeS_2BnL-Q7dGBDytBCrtzZzvvCugaP-pzoqEguJpmHypWNJf6s64BzOn7HGVHTyiU43_x88B93OsddueA2MO1glOwKq6wR5JUxqGOF9dPFCyzuqaTextiqZFxLm9S8V9jQINY_G-7K9mwiIt44qzHrzs_krZMuGMotGWZHOFgyQ-Hd9kp0pPEtdGDgcnSdz5g6cn2ZGuBGRyIcHrLN3iiwceBRXQ; eu_cookie_opted=1; ads_cookie=1; token_v2=eyJhbGciOiJSUzI1NiIsImtpZCI6IlNIQTI1NjpzS3dsMnlsV0VtMjVmcXhwTU40cWY4MXE2OWFFdWFyMnpLMUdhVGxjdWNZIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyIiwiZXhwIjoxNzg3OTg4NzAwLjIyNjc0MSwiaWF0IjoxNzg3OTAyMzAwLjIyNjc0LCJqdGkiOiJPSERxQ2tOMTltQUFZblFTZ3VfcG1ra0tnNXNKM0EiLCJjaWQiOiIwUi1XQU1odW9vLU15USIsImxpZCI6InQyXzE4YWZidDN4OW8iLCJhaWQiOiJ0Ml8xOGFmYnQzeDlvIiwiYXQiOjEsImxjYSI6MTcyNTcwNzk3NDEzMSwic2NwIjoiZUp4a2tkR090REFJaGQtRmE1X2dmNVVfbTAxdGNZYXNMUWFvazNuN0RWb2NrNzA3Y0Q0cEhQOURLb3FGRENaWGdxbkFCRmdUclREQlJ1VDluTG0zZzJpTmU4dFlzWm5DQkZtd0ZEcmttTEdzaVFRbWVKSWF5eHNtb0lMTnlGeXV0R05OTFQwUUpxaGNNcmVGSHBjMm9ia2JpNTZkR0ZXNXJEeW9zVmZsMHRqR0ZMWW54amNicXcycHVDNm5Na25MUXZrc1h2VGpOOVczOXZtel9TYTBKOE9LcXVtQjNobEpDRzRzZnBpbTNkOVRrNTZ0Q3hhMTkzcVEydWQ2M0s1OTFpdzBPN2VmNl9sckl4bVhZMmgtSnZ0MzF5LWhBNDg4THpQcUFFYXM0VWNaZG1RZF9sVUhVTG1nSkdNSjR0TUk1TXJsMjM4SnRtdlR2OGJ0RXo5OE0tS21OX3pXRE5SekNlTFFwX0gxR3dBQV9fOFExZVRSIiwicmNpZCI6ImVfYTdSbVBMRGRUZUpXTWYyUFlLQld3LWl4TUJaS0F0XzdOa0RCcUFzQXMiLCJmbG8iOjJ9.GRmeAn3C8K9hC5jfRDgZW0umXRFjrsL5bCOEmCBBPuK1bi0F8OKHvkr9LKS6bVS5obZdk9si89j3cR44_y-srPzii4AO2F6fpfTuvzkOgppX2hqANEftC1XtQUi89BD9-UaUDU8KRtou3hXrvVb5MPtZOt9QaCS3AwjNeFTeYVL-jkBsTWwM8iNyVdvoZUS_X6rSsRJq7TvP5HpKRKe4GJFUuRqkYYSLaH48JmbXZb9qNMaCWg-HEwTIOnDKukDOo4dmefX53OdJPVksyv5ziZKRiMdCOuVANODEyursth5oa7kNhbzmjlvBKQWDEWay_WyQL9PxBMUPX6xyX4FWdg; seeker_session=true; pc=2e; csrf_token=ee966f8aa68049c1fb84a7312033d2f3; session_tracker=dqcfcjaodihrpgldjf.0.1787904620291.Z0FBQUFBQnFrVUpzeGk5aThyVFRZYXZ4U0pkYzQycWxOMVZuUXJ1aFpXS2R3dlVJQmZqVWN5Vm9ySUY5bFFJSHBrUU8xNjk4MW1GVHRNdTRWZWNPeW0zeGJzcXV0ZWZtMUV5bjFxdXJEZzVualdYbzNjTnhONndtaG1Zem44dV9jUk1wMTFKanFpQkg
''';
}
