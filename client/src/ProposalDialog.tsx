import { useEffect, useRef, useState } from "react";
import {
  sendProposalEmail,
  verifySingleEmailApi,
  EmailVerificationResult,
  getResumesList,
  matchResumeForJob,
  type ResumeItem,
} from "./api";
import { LinkedinIcon, WhatsAppIcon, normalizeWhatsAppNumber, extractContacts } from "./FeedCard";
import PdfPreviewModal from "./PdfPreviewModal";

export function detectJobDomainClient(title?: string, text?: string): string {
  const combined = `${title || ""} ${text || ""}`.toLowerCase();
  if (combined.includes("flutter") || combined.includes("dart")) return "flutter";
  if (combined.includes("react native") || combined.includes("react-native") || combined.includes("expo")) return "react-native";
  if (combined.includes("swift") || combined.includes("swiftui") || combined.includes("uikit") || (combined.includes("ios") && !combined.includes("android"))) return "ios";
  if (combined.includes("kotlin") || combined.includes("jetpack compose") || (combined.includes("android") && !combined.includes("ios"))) return "android";
  if (combined.includes("mobile") || combined.includes("app developer")) return "mobile";
  if (combined.includes("ai") || combined.includes("llm") || combined.includes("rag") || combined.includes("agent") || combined.includes("machine learning") || combined.includes("generative ai")) return "ai";
  if (combined.includes("react") || combined.includes("next.js") || combined.includes("nextjs") || combined.includes("frontend") || combined.includes("vue") || combined.includes("angular") || combined.includes("tailwind")) return "frontend";
  if (combined.includes("node") || combined.includes("backend") || combined.includes("express") || combined.includes("nest") || combined.includes("fastapi") || combined.includes("django") || combined.includes("golang") || /\bgo\b/.test(combined)) return "backend";
  if (combined.includes("full stack") || combined.includes("fullstack") || combined.includes("full-stack")) return "fullstack";
  return "";
}

export function sanitizeProposalText(text?: string | null): string {
  if (!text) return "";
  let cleaned = text
    .replace(/(?:\r?\n|^)\s*(?:\*{0,2})(?:RECOMMENDED[_\s-]*RESUME|SELECTED[_\s-]*RESUME|RESUME[_\s-]*RECOMMENDED|RESUME[_\s-]*RECOMMENDATION|RECOMMENDED_PDF|ATTACHED_RESUME|RECOMMENDEDRESUME|SELECTEDRESUME)\s*[:=]?\s*[^\n\r]*/gi, "")
    .replace(/\bclaude\s+testing\b/gi, "unit & widget testing")
    .replace(/\bClaude\s+Code\s+testing\b/gi, "automated testing");

  // If this proposal is in the AI 1st format with "Video Demo:" or "🎥 Recent", preserve it directly
  if (/Video\s*Demo:\s*https?:\/\//i.test(cleaned) || /🎥\s*Recent/i.test(cleaned)) {
    return cleaned
      .replace(/(?:^|\n)\s*(?:My\s+most\s+recent\s+[^\n]+?\s+(?:work|wrok|apps?)\s*[:–-]?\s*)(I bring \d+[\d,.]*\+?\s*years)/i, "\n\n$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Hoist standalone demo videos section inline to opening paragraph if present
  const demoSectionRegex = /(?:^|\n)[ \t]*(?:\*{0,2})(?:App\s*demo\s*videos?|Demo\s*videos?|App\s*demos?|Demo\s*video\s*links?|YouTube\s*demos?)[ \t]*:?[ \t]*(?:\*{0,2})\s*\n+([\s\S]*?)(?=(?:\n\s*\n\s*(?:(?:My\s+most\s+recent\s+[^\n]+?\s+(?:work|wrok|apps?)\s*[:–-]?\s*)?I\s+bring|How\s+my\s+experience|✅|Your\s+posting|Portfolio:|Best\s+regards|\n))|$)/i;
  const match = cleaned.match(demoSectionRegex);
  if (match) {
    const blockContent = match[1];
    const blockLines = blockContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /https?:\/\//i.test(l));

    cleaned = cleaned.replace(match[0], "\n\n");

    const openingChunk = (cleaned.split(/How\s+my\s+experience\s+maps/i)[0] || "").split(/Your\s+posting:/i)[0] || "";
    const openingHasVideo = /(?:youtu\.be|youtube\.com|loom\.com)/i.test(openingChunk);

    if (blockLines.length > 0 && !openingHasVideo) {
      const inlineVideosText = blockLines.join(" ");
      const lookingMatch = cleaned.match(/(Are you still looking for [^?\n]+\?)/i);
      if (lookingMatch) {
        cleaned = cleaned.replace(
          lookingMatch[0],
          `${lookingMatch[0]}  My most recent app development ${inlineVideosText}`
        );
      }
    }
  }

  cleaned = cleaned
    .replace(/(?:^|\n)\s*(?:My\s+most\s+recent\s+[^\n]+?\s+(?:work|wrok|apps?)\s*[:–-]?\s*)(I bring \d+[\d,.]*\+?\s*years)/i, "\n\n$1")
    .replace(/(?:^|\n)[ \t]*(?:\*{0,2})(?:App\s*demo\s*videos?|Demo\s*videos?)[ \t]*:?[ \t]*(?:\*{0,2})[ \t]*\n*/gi, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

export function cleanJobTitleClient(title?: string, jobText?: string): string {
  let cleaned = (title || "")
    .replace(/\b\d[\d,.]*\s*[KkMm]?\+?\s*(?:followers?|connections?|subscribers?)\b/gi, " ")
    .replace(/(^|[·•|]\s*)\d(?:st|nd|rd|th)\+?(?=\s|$)/gi, "$1")
    .replace(/\s*[·•|]\s*(?=[·•|])/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·•|,\-–]+/, "")
    .replace(/[\s·•|,\-–]+$/, "")
    .replace(/^(?:Position|Role|Job Title|Title|Profile|Hiring|Urgent Hiring|Looking for|Wanted)\s*[:–-]\s*/i, "")
    .replace(/#/g, "")
    .trim();

  const isRecruiter =
    /^(?:hiring|we are hiring|urgent hiring|job opportunity|opening|openings|career|careers|urgent requirement)$/i.test(cleaned) ||
    /\b(?:recruiter|technical recruiter|talent acquisition|sourcer|headhunter|hiring manager|account manager|hr\s*(?:manager|executive|lead)?|human resources|recruitment|staffing|consulting)\b/i.test(cleaned) ||
    /\bat\s+[A-Za-z0-9\s.,&-]+(?:llc|inc|corp|ltd|technologies|solutions|group|services)?$/i.test(cleaned);

  if (isRecruiter) {
    cleaned = "";
  }

  if (jobText) {
    const match = jobText.match(
      /(?:Position|Role|Job Title|Title|Profile|Requirement|Hiring for|Looking for)\s*[:–-]\s*([^\n\r,•|📱🔥]+)/i
    );
    if (match) {
      const extracted = match[1].replace(/#/g, "").replace(/\s{2,}/g, " ").trim();
      if (!cleaned || isRecruiter) {
        cleaned = extracted;
      }
    }
  }

  return cleaned;
}

export function formatTimezoneOverlapClient(tz?: string): string {
  if (!tz || tz === "your team's" || tz === "team") {
    return "full timezone overlap with your team";
  }
  if (tz.toLowerCase().includes("pakistan") || tz.toLowerCase().includes("pkt")) {
    return "full Pakistan (PKT) timezone overlap";
  }
  return `full ${tz} timezone overlap`;
}

export function detectWorkArrangementClient(title?: string, text?: string, forceRemote?: boolean) {
  const combined = `${title || ""} ${text || ""}`;
  let location = "";
  let targetTimezone = "your team's";

  // 1. Check for explicit labeled location e.g. "Location : Bangalore" or "Location : Dallas, TX"
  const explicitLocMatch = combined.match(/(?:Location|Work Location|Place|City|Office)\s*[:–-]\s*([^\n\r•|📱🔥]+)/i);
  if (explicitLocMatch) {
    const rawLoc = explicitLocMatch[1]
      .replace(/#/g, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s*(?:•|\n|\r|\||Job|Type|Salary|\$|Experience|Exp|Skills|Hard skills|Soft skills|Role|Overview|About|Description|Key Responsibilities|Responsibilities).*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (rawLoc && rawLoc.length < 60 && !/^(?:remote|work from home|wfh|anywhere)$/i.test(rawLoc)) {
      location = rawLoc;
    }
  }

  // 2. Region / Country / City detection
  const hasPakistan =
    /\b(?:pakistan|pakistani|rawalpindi|pindi|islamabad|isb|lahore|karachi|peshawar|faisalabad|multan|sialkot|gujranwala|quetta|saidpur|saidpur\s*road|pkt)\b/i.test(location || combined);

  const hasIndia =
    /\b(?:india|indian|bangalore|bengaluru|hyderabad|pune|noida|gurgaon|gurugram|delhi|new delhi|mumbai|chennai|kolkata|ahmedabad|karnataka|telangana|maharashtra|tamil nadu|haryana|ist)\b/i.test(location || combined);

  const hasUK =
    /\b(?:london|uk|united kingdom|england|britain|great britain|scotland|wales|gmt|bst)\b/i.test(location || combined);

  const hasEurope =
    /\b(?:germany|berlin|munich|frankfurt|amsterdam|netherlands|paris|france|dublin|ireland|madrid|spain|italy|europe|european|sweden|stockholm|poland|warsaw|cet|cest)\b/i.test(location || combined);

  const hasAustralia =
    /\b(?:australia|sydney|melbourne|brisbane|perth|new zealand|au|aest)\b/i.test(location || combined);

  const hasGulf =
    /\b(?:dubai|abu dhabi|uae|saudi|riyadh|qatar|doha|gst)\b/i.test(location || combined);

  const hasEastern =
    /\b(?:new york|nyc|manhattan|brooklyn|boston|massachusetts|north\s*reading|atlanta|georgia|miami|orlando|tampa|florida|washington\s*d\.?c\.?|philadelphia|charlotte|raleigh|north carolina|new jersey|virginia|eastern|est|edt)\b/i.test(location || combined) ||
    /(?:,\s*(?:NY|MA|GA|FL|DC|PA|NC|NJ|VA)\b)/i.test(location || combined);

  const hasPacific =
    /\b(?:san francisco|sf|bay area|san jose|silicon valley|sunnyvale|los angeles|san diego|california|seattle|bellevue|washington|portland|oregon|pacific|pst|pdt)\b/i.test(location || combined) ||
    /(?:,\s*(?:CA|WA|OR)\b)/i.test(location || combined);

  const hasCentral =
    /\b(?:dallas|austin|houston|san antonio|fort worth|plano|irving|texas|chicago|illinois|minneapolis|minnesota|st\.?\s*louis|missouri|kansas\s*city|tennessee|nashville|memphis|wisconsin|central|cst|cdt)\b/i.test(location || combined) ||
    /(?:,\s*(?:TX|IL|MN|MO|TN|WI)\b)/i.test(location || combined);

  const hasMountain =
    /\b(?:denver|boulder|colorado|phoenix|scottsdale|arizona|salt lake|utah|mountain|mst|mdt)\b/i.test(location || combined) ||
    /(?:,\s*(?:CO|AZ|UT)\b)/i.test(location || combined);

  const hasGenericUS =
    /\b(?:united states|usa|u\.s\.a?|w2|c2c|1099)\b/i.test(combined);

  if (hasPakistan) {
    if (!location) {
      if (/\b(?:rawalpindi|pindi|saidpur)\b/i.test(combined)) location = "Rawalpindi, Pakistan";
      else if (/\b(?:islamabad|isb)\b/i.test(combined)) location = "Islamabad, Pakistan";
      else if (/\blahore\b/i.test(combined)) location = "Lahore, Pakistan";
      else if (/\bkarachi\b/i.test(combined)) location = "Karachi, Pakistan";
      else if (/\bpeshawar\b/i.test(combined)) location = "Peshawar, Pakistan";
      else location = "Pakistan";
    }
    targetTimezone = "Pakistan (PKT)";
  } else if (hasIndia) {
    if (!location) {
      if (/\b(?:bangalore|bengaluru)\b/i.test(combined)) location = "Bangalore, India";
      else if (/\bhyderabad\b/i.test(combined)) location = "Hyderabad, India";
      else if (/\bpune\b/i.test(combined)) location = "Pune, India";
      else if (/\b(?:noida|gurgaon|gurugram|delhi)\b/i.test(combined)) location = "Delhi NCR, India";
      else if (/\bmumbai\b/i.test(combined)) location = "Mumbai, India";
      else if (/\bchennai\b/i.test(combined)) location = "Chennai, India";
      else location = "India";
    }
    targetTimezone = "India (IST)";
  } else if (hasUK) {
    if (!location) location = "London, UK";
    targetTimezone = "UK (GMT)";
  } else if (hasEurope) {
    if (!location) location = "Europe";
    targetTimezone = "Europe (CET)";
  } else if (hasAustralia) {
    if (!location) location = "Australia";
    targetTimezone = "Australia (AEST)";
  } else if (hasGulf) {
    if (!location) location = "Dubai, UAE";
    targetTimezone = "Gulf (GST)";
  } else if (hasEastern && hasPacific) {
    if (!location) location = "US Eastern / Pacific";
    targetTimezone = "US Eastern / Pacific";
  } else if (hasEastern) {
    if (!location) {
      if (/\b(?:new york|nyc|manhattan|brooklyn)\b/i.test(combined)) location = "New York, NY";
      else if (/\bboston\b/i.test(combined)) location = "Boston, MA";
      else if (/\batlanta\b/i.test(combined)) location = "Atlanta, GA";
      else if (/\bmiami\b/i.test(combined)) location = "Miami, FL";
      else location = "US Eastern";
    }
    targetTimezone = "US Eastern";
  } else if (hasPacific) {
    if (!location) {
      if (/\b(?:san francisco|sf|bay area|silicon valley)\b/i.test(combined)) location = "San Francisco, CA";
      else if (/\bsunnyvale\b/i.test(combined)) location = "Sunnyvale, CA";
      else if (/\bseattle\b/i.test(combined)) location = "Seattle, WA";
      else if (/\b(?:los angeles|la)\b/i.test(combined)) location = "Los Angeles, CA";
      else location = "California";
    }
    targetTimezone = "US Pacific";
  } else if (hasCentral) {
    if (!location) {
      if (/\bdallas\b/i.test(combined)) location = "Dallas, TX";
      else if (/\baustin\b/i.test(combined)) location = "Austin, TX";
      else if (/\bhouston\b/i.test(combined)) location = "Houston, TX";
      else if (/\bchicago\b/i.test(combined)) location = "Chicago, IL";
      else location = "Texas";
    }
    targetTimezone = "US Central";
  } else if (hasMountain) {
    if (!location) {
      if (/\b(?:denver|boulder)\b/i.test(combined)) location = "Denver, CO";
      else if (/\bphoenix\b/i.test(combined)) location = "Phoenix, AZ";
      else location = "US Mountain";
    }
    targetTimezone = "US Mountain";
  } else if (hasGenericUS) {
    if (!location) location = "United States";
    targetTimezone = "US Eastern / Pacific";
  } else {
    targetTimezone = "your team's";
  }

  const usTimezone = targetTimezone;

  const hasOnsiteKeyword = /\b(?:onsite|on-site|in-office|in office|in-person|in person|relocate|relocation)\b/i.test(combined);
  const hasHybridKeyword = /\bhybrid\b/i.test(combined);
  const hasRemoteKeyword = /\b(?:remote|work from home|wfh|telecommute|distributed)\b/i.test(combined);

  let arrangementLabel: "onsite" | "hybrid" | "remote" = "remote";
  let isOnsiteOrHybrid = false;

  if (forceRemote !== undefined) {
    if (forceRemote) {
      arrangementLabel = "remote";
      isOnsiteOrHybrid = false;
    } else {
      arrangementLabel = "onsite";
      isOnsiteOrHybrid = true;
    }
  } else {
    if (hasOnsiteKeyword) {
      arrangementLabel = "onsite";
      isOnsiteOrHybrid = true;
    } else if (hasHybridKeyword) {
      arrangementLabel = "hybrid";
      isOnsiteOrHybrid = true;
    } else if (location && !hasRemoteKeyword) {
      arrangementLabel = "onsite";
      isOnsiteOrHybrid = true;
    }
  }

  return { isOnsiteOrHybrid, arrangementLabel, location, targetTimezone, usTimezone };
}

export function buildDefaultProposalTemplate(
  jobTitle?: string,
  authorName?: string,
  jobUrl?: string,
  jobText?: string,
  isRemote: boolean = true,
  isAiFirst: boolean = false,
): string {
  const greeting = authorName ? `Hi ${authorName} and team,` : "Hi Hiring Team,";
  const cleanedTitle = cleanJobTitleClient(jobTitle, jobText);
  const domain = detectJobDomainClient(cleanedTitle || jobTitle, jobText);
  const arrangement = detectWorkArrangementClient(cleanedTitle || jobTitle, jobText, isRemote);
  const postingSection = jobUrl ? `\nYour posting:\n${jobUrl}\n` : "";

  // Set domain-specific parameters
  let title = cleanedTitle || jobTitle || "Senior Developer";
  let coreTech = "Flutter & Dart";
  let domainYears = "5+ years";
  let roleStack = "Flutter & Dart";
  let resumeLabel = "Flutter Resume";
  let resumeUrl = "https://umerwaqas.lovable.app?resume=3";
  let recentAppLabel = "Recent Flutter App — AI Influencer Generator";
  let recentAppType = "iOS App: https://apps.apple.com/us/app/id6759487099";
  let recentAppTech = "Built using Flutter & Dart, featuring clean architecture (Bloc/Riverpod), responsive UI across iOS and Android, and real-time generation pipelines.";
  let demoVideoUrl = "https://youtu.be/6m19rKN7i3I";
  let expHook = "I bring 11+ years of overall software development experience, including 5+ years specializing in Flutter & cross-platform mobile development (Dart, iOS, and Android).\n\nI've built 100+ Android and iOS applications, with 22+ published on Google Play and Apple App Store, including Zeely AI Marketing Platform, Flibbo AI, AI Influencer Generator, and DocReady Pro.";
  let signoffRole = "AI-First Full Stack & Flutter Developer";

  let aiFirstBullets: string[] = [];
  let standardBullets: string[] = [];

  if (domain === "flutter") {
    title = cleanedTitle || jobTitle || "Flutter Developer";
    coreTech = "Flutter & Dart";
    domainYears = "5+ years";
    roleStack = "Flutter & Dart";
    resumeLabel = "Flutter Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=3";
    recentAppLabel = "Recent Flutter App — AI Influencer Generator";
    recentAppType = "iOS App: https://apps.apple.com/us/app/id6759487099";
    recentAppTech = "Built using Flutter & Dart, featuring clean architecture (Bloc/Riverpod), responsive UI across iOS and Android, and real-time generation pipelines.";
    expHook = "I bring 11+ years of overall software development experience, including 5+ years specializing in Flutter & cross-platform mobile development (Dart, iOS, and Android).\n\nI've built 100+ Android and iOS applications, with 22+ published on Google Play and Apple App Store, including Zeely AI Marketing Platform, Flibbo AI, AI Influencer Generator, and DocReady Pro.";
    signoffRole = "AI-First Full Stack & Flutter Developer";

    aiFirstBullets = [
      "✅ Flutter & Dart Core Architecture — 5+ years building and shipping high-performance cross-platform iOS and Android apps using Flutter 3.x and modern Dart (sound null safety, async streams, isolates for heavy computation), including AI Influencer Generator, Zeely AI Marketing Platform, and Flibbo AI.",
      "✅ State Management & Clean Architecture — Production mastery of Bloc/Cubit, Riverpod, and Provider using Feature-First Clean Architecture, MVVM, Repository pattern, and get_it dependency injection for modular, testable, and maintainable codebases.",
      "✅ Custom UI, Slivers & 60/120 FPS Animations — Pixel-perfect translation of Figma designs into responsive Material 3 and Cupertino widgets, CustomPainter, Slivers (CustomScrollView), and smooth implicit/explicit animations with 0 frame drops.",
      "✅ REST APIs, Dio & Offline-First Storage — Robust network architecture with Dio, JSON serialization (Freezed), interceptors, retry handling, and offline-first persistence using Hive, SQLite (sqflite), and Isar.",
      "✅ Firebase & Mobile Cloud Services — Complete integration of Firebase Authentication, Cloud Firestore, Cloud Functions, FCM (Firebase Cloud Messaging) push notifications, Crashlytics, and Remote Config.",
      "✅ Native Platform Channels & Hardware Integration — Built MethodChannel and EventChannel bridging to native Swift (iOS) and Kotlin (Android) for camera, background services, GPS/location, biometrics (local_auth), and In-App Purchases (RevenueCat & in_app_purchase).",
      "✅ Testing, DevTools Profiling & Store Publishing — Thorough Unit and Widget testing using flutter_test and Mockito; DevTools profiling to eliminate widget rebuilds and memory leaks; hands-on release management across Apple App Store (TestFlight) and Google Play Console.",
      "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects and 22+ published apps; using modern AI-assisted engineering workflows (Cursor & Claude Code) to accelerate feature implementation velocity by ~60% while strictly adhering to clean Flutter coding standards.",
    ];

    standardBullets = [
      "✅ Flutter & Dart Architecture — Shipped high-performance cross-platform mobile apps with Flutter 3.x, Dart null safety, Bloc/Riverpod state management, and Feature-First Clean Architecture.",
      "✅ Custom UI, Slivers & 60/120 FPS Animations — Implemented pixel-perfect Figma designs, custom Slivers, Cupertino/Material 3 components, and fluid animations optimized for smooth 60/120 FPS render performance.",
      "✅ REST APIs, Dio, Offline Sync & Firebase — Built robust network layers using Dio, Freezed, SQLite/Hive local storage, and Firebase services including FCM push notifications and Crashlytics.",
      "✅ Testing, DevTools Profiling & Store Publishing — Thorough unit and widget testing with flutter_test, DevTools memory/rebuild profiling, and hands-on release deployment to Apple App Store (TestFlight) and Google Play Console.",
    ];
  } else if (domain === "react-native") {
    title = cleanedTitle || jobTitle || "React Native Developer";
    coreTech = "React Native & TypeScript";
    domainYears = "5+ years";
    roleStack = "React Native & TypeScript";
    resumeLabel = "Mobile Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=3";
    recentAppLabel = "Recent Mobile App — AI Influencer Generator";
    recentAppType = "iOS App: https://apps.apple.com/us/app/id6759487099";
    recentAppTech = "Built using React Native, TypeScript, and modern mobile architecture, featuring real-time workflows and cross-platform integrations.";
    expHook = "I bring 11+ years of overall software development experience, including 5+ years specializing in React Native and cross-platform mobile development (TypeScript, iOS, and Android).\n\nI've delivered production mobile applications with seamless App Store and Google Play deployments.";
    signoffRole = "AI-First Full Stack & React Native Developer";

    aiFirstBullets = [
      "✅ React Native & TypeScript Core — 5+ years building and shipping cross-platform mobile applications with React Native, TypeScript, and Expo / Bare workflow across iOS and Android.",
      "✅ State Management & Navigation — Production expertise in Redux Toolkit, Zustand, and React Navigation with clean decoupled feature architecture.",
      "✅ Fluid UI & Reanimated Animations — Pixel-perfect UI implementation with StyleSheet, React Native Reanimated, gesture handling, and responsive layouts.",
      "✅ Networking & Offline Caching — Robust API integration using Axios, REST, GraphQL, with offline caching using MMKV and AsyncStorage.",
      "✅ Push Notifications & Firebase — Complete mobile backend integration with Firebase Auth, Cloud Firestore, and FCM push notifications via Notifee.",
      "✅ Native Modules & Hardware APIs — Implemented Native Modules and TurboModules bridging to iOS (Swift) and Android (Kotlin) for camera, location, and biometrics.",
      "✅ Testing & Store Publishing — Unit and integration testing with Jest and React Native Testing Library; releases on Apple TestFlight and Google Play Console.",
      "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects; accelerating delivery velocity by ~60% using Cursor & Claude Code.",
    ];

    standardBullets = [
      "✅ React Native & TypeScript Architecture — Built production cross-platform apps using React Native, TypeScript, Expo, and Redux Toolkit/Zustand.",
      "✅ UI, Animations & Native Modules — Created smooth 60 FPS mobile interfaces with Reanimated, custom native bridges, and pixel-perfect design system implementations.",
      "✅ Networking, Storage & Notifications — Implemented Axios API layers, MMKV offline persistence, and Firebase FCM push notifications.",
      "✅ Testing & Store Publishing — Unit testing with Jest/RNTL and automated release deployments to TestFlight and Google Play Console.",
    ];
  } else if (domain === "ios") {
    title = cleanedTitle || jobTitle || "iOS Developer";
    coreTech = "Swift & SwiftUI";
    domainYears = "5+ years";
    roleStack = "Swift & SwiftUI";
    resumeLabel = "iOS Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=3";
    recentAppLabel = "Recent iOS App — OnePDF Document Utility";
    recentAppType = "iOS App Store: https://apps.apple.com/us/app/docready-pro/id6503932757";
    recentAppTech = "Built using Swift & SwiftUI, featuring native document workflows, PDF conversion, and App Store release.";
    expHook = "I bring 11+ years of overall software development experience, including 5+ years specializing in native iOS development with Swift, SwiftUI, and UIKit.\n\nI've shipped native iOS applications to the Apple App Store, including OnePDF, DocReady Pro, and PlayCam.";
    signoffRole = "AI-First Full Stack & iOS Developer";

    aiFirstBullets = [
      "✅ Swift & SwiftUI Architecture — 5+ years building and shipping native iOS applications with modern Swift, SwiftUI, and UIKit.",
      "✅ Concurrency & Reactive State — Production mastery of async/await, actors, Combine, and structured concurrency for crash-free execution.",
      "✅ Local Persistence & CoreData — Architected reliable local storage using CoreData, SwiftData, and Keychain for secure sensitive data.",
      "✅ Networking & Background Services — Built URLSession networking layers, background tasks, push notifications (APNs), and offline sync.",
      "✅ Hardware & Apple Frameworks — Integrated AVFoundation, Camera, CoreLocation, FaceID biometrics, and StoreKit In-App Purchases.",
      "✅ Architecture & Design Patterns — MVVM, Clean Architecture, Protocol-Oriented Programming, and modular workspace structures.",
      "✅ Testing & App Store Connect — Unit and UI testing with XCTest; TestFlight builds, provisioning profiles, and App Store review compliance.",
      "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects; shipping native iOS releases ~60% faster with Cursor.",
    ];

    standardBullets = [
      "✅ Swift & SwiftUI Architecture — Built production native iOS apps using Swift, SwiftUI, and UIKit with MVVM architecture.",
      "✅ Concurrency & Networking — Implemented async/await pipelines, URLSession networking, and APNs push notifications.",
      "✅ Local Storage & StoreKit — Integrated CoreData/SwiftData persistence, Keychain security, and In-App Purchases.",
      "✅ Testing & Store Releases — XCTest unit testing and end-to-end TestFlight / App Store deployment.",
    ];
  } else if (domain === "android") {
    title = cleanedTitle || jobTitle || "Android Developer";
    coreTech = "Kotlin & Compose";
    domainYears = "5+ years";
    roleStack = "Kotlin & Jetpack Compose";
    resumeLabel = "Android Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=3";
    recentAppLabel = "Recent Android App — VisageID & TrendSnap FX";
    recentAppType = "Google Play: https://play.google.com/store/apps/details?id=com.app2mob.visageid";
    recentAppTech = "Built using Kotlin & Jetpack Compose, featuring real-time services, Room DB, and Google Play delivery.";
    expHook = "I bring 11+ years of overall software development experience, including 5+ years specializing in native Android development with Kotlin and Jetpack Compose.\n\nI've delivered 10+ production Android apps on Google Play, including Microphone Amplifier, VisageID, and TrendSnap FX.";
    signoffRole = "AI-First Full Stack & Android Developer";

    aiFirstBullets = [
      "✅ Kotlin & Jetpack Compose Architecture — 5+ years building and shipping native Android applications with Kotlin, Compose, and Material 3.",
      "✅ Coroutines & Reactive Flow — Production mastery of Kotlin Coroutines, StateFlow, and SharedFlow for smooth non-blocking execution.",
      "✅ Architecture & Dependency Injection — MVVM and Clean Architecture with Hilt and Dagger for modular, scalable apps.",
      "✅ Room DB & Data Persistence — Local caching and offline persistence with Room SQLite, DataStore, and encrypted SharedPreferences.",
      "✅ Background Processing & Services — Built robust foreground services, WorkManager background workers, and real-time audio/data pipelines.",
      "✅ Networking & Third-Party APIs — Retrofit, OkHttp, JSON serialization, and FCM push notifications with high reliability.",
      "✅ Testing & Google Play Publishing — Unit and UI testing with JUnit and Espresso; AAB bundle packaging, signing, and Play Console release tracks.",
      "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects and 22+ published apps.",
    ];

    standardBullets = [
      "✅ Kotlin & Compose Architecture — Built native Android apps with Kotlin, Jetpack Compose, and Hilt dependency injection.",
      "✅ Coroutines, Room & Retrofit — Implemented reactive flows, Room SQLite persistence, and Retrofit network layers.",
      "✅ Background Services & Hardware — Shipped low-latency audio utilities and foreground services with WorkManager.",
      "✅ Testing & Play Console Releases — JUnit testing and automated release deployments on Google Play.",
    ];
  } else if (domain === "mobile") {
    title = cleanedTitle || jobTitle || "Senior Mobile Developer";
    coreTech = "Flutter & Mobile Architecture";
    domainYears = "5+ years";
    roleStack = "Flutter & Mobile Architecture";
    resumeLabel = "Mobile Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=3";
    recentAppLabel = "Recent Mobile App — AI Influencer Generator";
    recentAppType = "iOS App: https://apps.apple.com/us/app/id6759487099";
    recentAppTech = "Built using Flutter, featuring cross-platform state management (Bloc/Riverpod), responsive UI, and App Store / Google Play delivery.";
    expHook = "I bring 11+ years of overall software development experience, including 5+ years specializing in mobile application development across Flutter, iOS, and Android.\n\nI've built 100+ mobile applications, with 22+ published on Google Play and Apple App Store, including Zeely AI, Flibbo AI, AI Influencer Generator, and DocReady Pro.";
    signoffRole = "AI-First Full Stack & Mobile Developer";

    aiFirstBullets = [
      "✅ Cross-Platform Mobile Architecture — 5+ years building and shipping high-performance mobile apps across iOS and Android with Flutter and native components.",
      "✅ State Management & Clean Architecture — Production mastery of Bloc, Riverpod, and Provider with Feature-First Clean Architecture and MVVM.",
      "✅ Custom UI & 60/120 FPS Performance — Pixel-perfect Figma design implementation with custom widgets, smooth animations, and zero frame drops.",
      "✅ REST APIs & Offline-First Storage — Robust network layers with Dio/Retrofit, JSON serialization, and offline caching via SQLite and Hive.",
      "✅ Firebase & Push Notifications — Complete integration of Firebase Auth, Firestore, FCM push notifications, and Crashlytics.",
      "✅ Native Platform Integration — MethodChannels and platform bridges for camera, background services, location, and In-App Purchases.",
      "✅ Testing & Store Publishing — Unit and widget testing (flutter_test, Mockito); release management on Apple App Store (TestFlight) and Google Play Console.",
      "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects and 22+ published apps.",
    ];

    standardBullets = [
      "✅ Cross-Platform Architecture — Delivered 100+ mobile apps across Flutter, iOS, and Android with 22+ published on app stores.",
      "✅ State Management & Clean Architecture — Expert in Bloc, Riverpod, and MVVM patterns for scalable, maintainable mobile codebases.",
      "✅ APIs, Offline Storage & Firebase — Built robust network layers, SQLite/Hive caching, and FCM push notifications.",
      "✅ Testing & Store Releases — Hands-on unit/widget testing and full release cycles via TestFlight and Google Play Console.",
    ];
  } else if (domain === "frontend") {
    title = cleanedTitle || jobTitle || "Senior Frontend Developer";
    coreTech = "React & Next.js";
    domainYears = "7+ years";
    roleStack = "React & Next.js";
    resumeLabel = "Frontend Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=1";
    recentAppLabel = "Recent Web Platform — NicheTrafficKit";
    recentAppType = "Web App: https://nichetraffickit.com";
    recentAppTech = "Built using Next.js, React, TypeScript, and Tailwind CSS, featuring automated workflows and responsive multi-device design.";
    expHook = "I bring 11+ years of overall software development experience, including 7+ years specializing in modern frontend engineering with React, Next.js, and TypeScript.\n\nI've built and scaled responsive, accessible web platforms with 95+ Lighthouse performance scores, including NicheTrafficKit and DevRel Employee.";
    signoffRole = "AI-First Full Stack & Frontend Developer";

    aiFirstBullets = [
      "✅ React & Next.js Architecture — 7+ years building production web applications with Next.js (App Router, Server Components, SSR/SSG) and TypeScript.",
      "✅ State Management & Data Fetching — Production expertise in Zustand, Redux Toolkit, and TanStack Query with optimistic updates and caching.",
      "✅ Modern Design Systems & Tailwind CSS — Pixel-perfect translation of Figma designs into accessible, responsive interfaces using Tailwind CSS.",
      "✅ Web Performance & Core Web Vitals — Optimized LCP, INP, and CLS achieving 95+ Lighthouse scores through code splitting and asset optimization.",
      "✅ REST & GraphQL Integration — Type-safe API client architecture with Zod validation, error boundaries, and WebSocket realtime updates.",
      "✅ Auth & Full-Stack Capabilities — Implemented OAuth2, NextAuth, session management, and server action pipelines.",
      "✅ Testing & CI/CD — Unit and component testing with Vitest and React Testing Library; automated deployments via Vercel and GitHub Actions.",
      "🚀 Rapid Delivery & AI-Assisted Engineering — Top Rated on Upwork with 100% Job Success across 48+ projects; shipping production UI ~60% faster with Cursor.",
    ];

    standardBullets = [
      "✅ React & Next.js Architecture — Built scalable SaaS frontends with Next.js App Router, TypeScript, and Tailwind CSS.",
      "✅ State & Data Layer — Integrated Zustand, TanStack Query, and type-safe REST/GraphQL APIs with Zod validation.",
      "✅ Performance & SEO — Maintained 95+ Lighthouse scores with server components, lazy loading, and Core Web Vitals optimization.",
      "✅ Testing & Deployment — Vitest component testing and automated production CI/CD deployments via Vercel.",
    ];
  } else if (domain === "backend") {
    const textLower = (jobText || "").toLowerCase();
    const isPython = textLower.includes("python") || textLower.includes("fastapi") || textLower.includes("django");
    const isGo = textLower.includes("golang") || /\bgo\b/.test(textLower);
    const backendTech = isGo ? "Go & PostgreSQL" : isPython ? "Python & FastAPI" : "Node.js & TypeScript";

    title = cleanedTitle || jobTitle || "Senior Backend Engineer";
    coreTech = backendTech;
    domainYears = "7+ years";
    roleStack = backendTech;
    resumeLabel = "Backend Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=1";
    recentAppLabel = "Recent SaaS Backend — Ardent & DevRel Employee";
    recentAppType = "Live Platform: https://www.tryardent.com/";
    recentAppTech = `Built using ${backendTech}, PostgreSQL, Redis, and cloud infrastructure, featuring isolated database sandboxing and high-throughput APIs.`;
    expHook = `I bring 11+ years of overall software development experience, including 7+ years building scalable backends, microservices, and distributed database systems with ${backendTech}.`;
    signoffRole = `AI-First Full Stack & Backend Engineer`;

    aiFirstBullets = [
      `✅ ${backendTech} Architecture — 7+ years developing scalable, resilient backend services and high-throughput REST/gRPC APIs.`,
      "✅ Database Design & Optimization — Advanced PostgreSQL and MongoDB architecture with connection pooling, indexing, and query tuning.",
      "✅ Caching & Background Processing — Scalable asynchronous worker pipelines using Redis, BullMQ, Celery, and message queues.",
      "✅ Realtime & Security — Implemented JWT/OAuth2 authentication, RBAC, input validation, rate limiting, and WebSockets.",
      "✅ Database Branching Infrastructure (Ardent) — Engineered copy-on-write Postgres sandbox execution completing in under 6 seconds.",
      "✅ Microservices & API Design — Clean hexagonal/clean architecture with OpenAPI specifications and automated integration tests.",
      "✅ Testing & DevOps — Thorough unit/integration testing with Jest/PyTest; containerized Docker deployments with automated CI/CD.",
      "🚀 Rapid Delivery & AI-Assisted Velocity — Top Rated on Upwork with 100% Job Success across 48+ projects.",
    ];

    standardBullets = [
      `✅ ${backendTech} Core — Shipped scalable backend services and high-throughput REST/gRPC APIs with clean architecture.`,
      "✅ Database Architecture — Advanced PostgreSQL/MongoDB schema design, indexing, and Redis caching layers.",
      "✅ Security & Auth — Production JWT/OAuth2 authentication, role-based access control, and rate-limiting middleware.",
      "✅ Testing & Cloud CI/CD — Comprehensive automated integration testing and production containerized deployments.",
    ];
  } else if (domain === "ai") {
    title = cleanedTitle || jobTitle || "Senior AI / LLM Engineer";
    coreTech = "Python & RAG";
    domainYears = "3+ years";
    roleStack = "Python & RAG";
    resumeLabel = "AI Engineer Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=2";
    recentAppLabel = "Recent AI Platform — Ardent & Askly";
    recentAppType = "Live: https://www.tryardent.com/";
    recentAppTech = "Built using Python, FastAPI, OpenAI/Claude APIs, and vector databases, featuring autonomous agents and database branching.";
    expHook = "I bring 11+ years of overall software development experience, including 3+ years specializing in production AI systems, LLM integrations, RAG pipelines, and autonomous agentic workflows.\n\nI've shipped production AI platforms including Ardent, Askly, and NicheTrafficKit.";
    signoffRole = "AI-First Full Stack & AI Engineer";

    aiFirstBullets = [
      "✅ Production LLM & API Integration — 3+ years building production AI systems with OpenAI, Claude, and DeepSeek APIs, utilizing structured outputs and tool calling.",
      "✅ Hybrid RAG & Vector Search — Engineered retrieval pipelines with chunking, embeddings, and vector databases (Pinecone, pgvector, Qdrant) for high-accuracy contextual recall.",
      "✅ Autonomous Coding Agents (Ardent) — Built database-branching sandbox infrastructure letting AI agents run schema migrations and tests on 1:1 Postgres copies in under 6 seconds.",
      "✅ Natural Language Data Agents (Askly) — Developed AI database agent using schema-aware retrieval to execute SQL queries, charts, and automated reports from user prompts.",
      "✅ Multi-Agent Orchestration — Built agent pipelines using LangChain, LlamaIndex, and MCP protocols with state machines and human-in-the-loop controls.",
      "✅ Prompt & Context Engineering — Designed defensible system prompts, few-shot examples, dynamic context pruning, and guardrails minimizing hallucinations.",
      "✅ Latency & Cost Optimization — Implemented semantic response caching, streaming completions, and model routing to cut token costs by ~40%.",
      "🚀 Rapid MVP Delivery — Top Rated on Upwork with 100% Job Success across 48+ projects; delivered selected production AI MVPs in under 5 days.",
    ];

    standardBullets = [
      "✅ LLM & RAG Systems — Built production RAG pipelines with semantic vector search (pgvector/Pinecone) and structured LLM tool calling.",
      "✅ Autonomous Agents (Ardent) — Engineered isolated database-branching sandboxes for coding agents with zero production blast radius.",
      "✅ AI Data Agents (Askly) — Created natural-language query engines connecting directly to relational databases with automated reporting.",
      "✅ Performance & Delivery — Implemented token-efficient caching and streaming responses; delivered AI MVPs in under 5 days.",
    ];
  } else {
    // Default / Full-Stack
    title = cleanedTitle || jobTitle || "Senior Full Stack Developer";
    coreTech = "React/Next.js & Python/Node";
    domainYears = "7+ years";
    roleStack = "React/Next.js & Python/Node";
    resumeLabel = "Full Stack Resume";
    resumeUrl = "https://umerwaqas.lovable.app?resume=1";
    recentAppLabel = "Recent Platform — NicheTrafficKit";
    recentAppType = "Web App: https://nichetraffickit.com";
    recentAppTech = "Built using Next.js, React, Node.js, and Python AI, featuring automated workflows and production full-stack architecture.";
    expHook = "I bring 11+ years of overall software development experience, including 7+ years building scalable SaaS applications and web platforms, alongside production AI integrations and mobile applications.";
    signoffRole = "AI-First Full Stack Developer";

    aiFirstBullets = [
      "✅ Full-Stack Architecture — 7+ years building production SaaS platforms with modern React/Next.js frontends and Node.js/Python backends.",
      "✅ API & Database Design — Designed robust RESTful APIs, database schemas, and data pipelines using PostgreSQL, MongoDB, and Firebase.",
      "✅ Frontend Engineering — Built responsive, accessible user interfaces using TypeScript, Tailwind CSS, and state management libraries.",
      "✅ Realtime & Authentication — Implemented OAuth2, JWT authentication, session handling, and WebSockets for live user interactions.",
      "✅ AI & Workflow Automation — Integrated LLM APIs, vector search, and automated background jobs into production applications.",
      "✅ Cloud Deployment & CI/CD — Deployed scalable services with automated CI/CD pipelines, containerization, and monitoring.",
      "✅ Testing & Reliability — Thorough unit and integration testing across client and server layers with error monitoring.",
      "🚀 Rapid Delivery & AI-Assisted Velocity — Top Rated on Upwork with 100% Job Success across 48+ projects; shipping full-stack products ~60% faster with Cursor.",
    ];

    standardBullets = [
      "✅ Full-Stack Architecture — Shipped scalable SaaS applications with React/Next.js frontends and Node.js/Python backends.",
      "✅ API & Database Systems — Built type-safe REST APIs and optimized PostgreSQL/MongoDB schemas with Redis caching.",
      "✅ Authentication & Reliability — Implemented secure authentication flows, background queues, and automated test suites.",
      "✅ Delivery Velocity — Top Rated on Upwork with 100% Job Success across 48+ projects delivering robust production code.",
    ];
  }

  // Construct proposal based on mode
  if (isAiFirst) {
    const subjectLine = !isRemote
      ? `Subject: ${title} Application | ${roleStack} (${domainYears})`
      : arrangement.isOnsiteOrHybrid
      ? `Subject: ${title} | Remote Availability | ${roleStack}`
      : `Subject: ${title} Application | ${roleStack} (${domainYears})`;

    const openingBlock = !isRemote
      ? `Are you still hiring for the ${title} position?\nI'm available to start immediately with 0 days' notice to join the team onsite${arrangement.location ? ` in ${arrangement.location}` : ""} and have long-term availability.`
      : arrangement.isOnsiteOrHybrid
      ? `I came across your posting for the ${title} position${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel}, but I wanted to ask if you would consider a remote contract arrangement for the right candidate.\nI'm available to start immediately with 0 days' notice, open to remote contract work with ${formatTimezoneOverlapClient(arrangement.targetTimezone)} and long-term availability.`
      : `Are you still hiring for the ${title} position?\nI'm available to start immediately with 0 days' notice, open to remote contract work with ${formatTimezoneOverlapClient(arrangement.targetTimezone)} and long-term availability.`;

    const demoBlock = `🎥 ${recentAppLabel}\nVideo Demo: ${demoVideoUrl}\n${recentAppType}\n${recentAppTech}`;
    const postingBlock = postingSection ? `${postingSection}\n` : (jobUrl ? `\nYour job posting:\n${jobUrl}\n\n` : "\n");

    return `${subjectLine}

${greeting}

${openingBlock}

${demoBlock}
${postingBlock}${expHook}

How my experience matches your requirements:

${aiFirstBullets.join("\n\n")}

Practical Technical Evaluation
I believe real project delivery is one of the best ways to demonstrate engineering ability.
I'm confident in my ability to understand requirements, research unfamiliar problems, and turn ideas into working applications quickly.
I'd welcome a short, clearly scoped practical task in ${domain === "flutter" ? "Flutter" : coreTech} development using my normal AI-assisted development workflow with Claude Code and Cursor AI, so your team can evaluate my implementation quality, problem-solving skills, research approach, and delivery speed before committing to a long-term engagement.

Portfolio: https://umerwaqas.pages.dev
${resumeLabel}: ${resumeUrl}
GitHub: https://github.com/umerwaqas92
LinkedIn: https://www.linkedin.com/in/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

I'd be happy to discuss your project requirements and demonstrate how quickly I can contribute to your team.

Best regards,
Umer Waqas
${signoffRole}
Email: um.waqas.khan@gmail.com
WhatsApp: +92 345 9347900`;
  }

  // Standard Mode
  const subjectLine = !isRemote
    ? `Subject: ${title} Application | ${coreTech} (${domainYears})`
    : arrangement.isOnsiteOrHybrid
    ? `Subject: ${title} | Remote Availability | ${coreTech}`
    : `Subject: ${title} Application | ${coreTech} (${domainYears})`;

  const openingBlock = !isRemote
    ? `Are you still looking for a ${title}? I came across your posting for the ${title} role${arrangement.location ? ` in ${arrangement.location}` : ""} and I'm available to join the team onsite and start immediately.

My experience closely matches the position across ${coreTech} development.`
    : arrangement.isOnsiteOrHybrid
    ? `I came across your posting for the ${title} role${arrangement.location ? ` in ${arrangement.location}` : ""}. I noticed the position is listed as ${arrangement.arrangementLabel}, but I wanted to ask if you would consider a remote arrangement for the right candidate.

I'm available to work remotely on a long-term contract basis with ${formatTimezoneOverlapClient(arrangement.targetTimezone)}, and can start immediately. If the team is open to remote candidates, I'd be very interested in discussing the role.

My experience closely matches the position across ${coreTech} development.`
    : `Are you still looking for a ${title}? I'm available to start immediately on a contract basis and can work remotely with ${formatTimezoneOverlapClient(arrangement.targetTimezone)} and long-term availability.
${postingSection}
I bring 11+ years of software engineering experience, including ${domainYears} specializing in ${coreTech}. What stood out to me about this role is that it focuses on building high-performance, maintainable software — which closely matches my work.`;

  return `${subjectLine}

${greeting}

${openingBlock}
${isRemote && arrangement.isOnsiteOrHybrid ? postingSection : ""}
How my experience maps to the role:

${standardBullets.join("\n\n")}

I'm Upwork Top Rated with 100% Job Success across 48+ projects.

Portfolio: https://umerwaqas.pages.dev
${resumeLabel}: ${resumeUrl}
GitHub: https://github.com/umerwaqas92
LinkedIn: https://www.linkedin.com/in/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

I'd be happy to walk through my architecture, code, and production delivery in an interview.

Best regards,
Umer Waqas
um.waqas.khan@gmail.com
WhatsApp: +92 345 9347900`;
}

interface ProposalDialogProps {
  open: boolean;
  proposal: string | null;
  summary?: string | null;
  recommendedResumeId?: string;
  loading: boolean;
  error: string | null;
  retryStatus?: string | null;
  jobTitle?: string;
  defaultEmail?: string;
  jobUrl?: string;
  authorUrl?: string;
  authorName?: string;
  recipientPhone?: string;
  jobId?: string;
  jobText?: string;
  isApplied?: boolean;
  isRemote?: boolean;
  isAiFirst?: boolean;
  onClose: () => void;
  onRetry?: (isRemote?: boolean, isAiFirst?: boolean) => void;
  onToggleApplied?: (id: string, title?: string, extras?: any) => void;
  onProposalChange?: (proposal: string, summary?: string) => void;
}

export default function ProposalDialog({
  open,
  proposal,
  summary,
  recommendedResumeId,
  loading,
  error,
  retryStatus,
  jobTitle,
  defaultEmail,
  jobUrl,
  authorUrl,
  authorName,
  recipientPhone,
  jobId,
  jobText,
  isApplied,
  isRemote: isRemoteProp,
  isAiFirst: isAiFirstProp,
  onClose,
  onRetry,
  onToggleApplied,
  onProposalChange,
}: ProposalDialogProps) {
  const [copied, setCopied] = useState(false);
  const [isRemote, setIsRemote] = useState(isRemoteProp !== undefined ? isRemoteProp : true);
  const [isAiFirst, setIsAiFirst] = useState(isAiFirstProp !== undefined ? isAiFirstProp : false);
  const [recipientEmail, setRecipientEmail] = useState(defaultEmail || "");
  const [subject, setSubject] = useState("");
  const [summaryText, setSummaryText] = useState(sanitizeProposalText(summary));
  const [proposalBody, setProposalBody] = useState(sanitizeProposalText(proposal));
  const [sendingEmail, setSendingEmail] = useState(false);
  const [attachResume, setAttachResume] = useState(true);
  const [resumesList, setResumesList] = useState<ResumeItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>("");
  const [previewResumeModalOpen, setPreviewResumeModalOpen] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok?: boolean; error?: string; messageId?: string } | null>(null);
  const [verificationResult, setVerificationResult] = useState<EmailVerificationResult | null>(null);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [copiedWhatsapp, setCopiedWhatsapp] = useState(false);
  const [customPhone, setCustomPhone] = useState("");
  const [preferredMode, setPreferredMode] = useState<"web" | "app">(() => {
    return (localStorage.getItem("preferred_whatsapp_mode") as "web" | "app") || "web";
  });
  const [showWhatsappMenu, setShowWhatsappMenu] = useState(false);
  const whatsappMenuRef = useRef<HTMLDivElement>(null);

  const prevOpenRef = useRef(false);
  const prevJobIdRef = useRef<string | undefined>(undefined);
  const prevLoadingRef = useRef(loading);
  const lastSyncedProposalRef = useRef<string | null | undefined>(proposal);
  const lastSyncedSummaryRef = useRef<string | null | undefined>(summary);
  const debounceTimerRef = useRef<any>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (whatsappMenuRef.current && !whatsappMenuRef.current.contains(e.target as Node)) {
        setShowWhatsappMenu(false);
      }
    }
    if (showWhatsappMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showWhatsappMenu]);

  // Cleanly flush pending proposal/summary changes to parent
  const notifyProposalChange = (pVal: string, sVal: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      onProposalChange?.(pVal, sVal);
    }, 400);
  };

  const handleProposalTextChange = (val: string) => {
    setProposalBody(val);
    lastSyncedProposalRef.current = val;
    notifyProposalChange(val, summaryText);
  };

  const handleSummaryTextChange = (val: string) => {
    if (val.length <= 250) {
      setSummaryText(val);
      lastSyncedSummaryRef.current = val;
      notifyProposalChange(proposalBody, val);
    }
  };

  const handleClose = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    onProposalChange?.(proposalBody, summaryText);
    onClose();
  };

  async function handlePasteProposal() {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          handleProposalTextChange(text);
          return;
        }
      }
    } catch (e) {
      console.warn("Clipboard read failed", e);
    }
    const input = window.prompt("Paste your proposal text here:");
    if (input !== null) {
      handleProposalTextChange(input);
    }
  }

  function handleClearProposal() {
    handleProposalTextChange("");
  }

  function handleCleanFormatProposal() {
    if (!proposalBody) return;
    const formatted = sanitizeProposalText(proposalBody);
    handleProposalTextChange(formatted);
  }

  async function handlePasteSummary() {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          handleSummaryTextChange(text.slice(0, 250));
          return;
        }
      }
    } catch (e) {}
    const input = window.prompt("Paste LinkedIn note text (max 250 characters):");
    if (input !== null) {
      handleSummaryTextChange(input.slice(0, 250));
    }
  }

  function handleClearSummary() {
    handleSummaryTextChange("");
  }

  // Sync state and automatically trigger verification when dialog opens or genuine external props change
  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      setSendingEmail(false);
      setEmailStatus(null);
      setVerificationResult(null);
      setVerifyingEmail(false);
      setCopied(false);
      setCopiedWhatsapp(false);
      setCustomPhone("");
      setShowWhatsappMenu(false);
      setIsRemote(true);
      setIsAiFirst(false);
      return;
    }

    const isJustOpened = !prevOpenRef.current && open;
    prevOpenRef.current = true;

    const isDifferentJob = jobId !== prevJobIdRef.current;
    prevJobIdRef.current = jobId;

    const finishedLoading = prevLoadingRef.current && !loading;
    prevLoadingRef.current = loading;

    const externalProposalChanged = proposal !== lastSyncedProposalRef.current;
    const externalSummaryChanged = summary !== lastSyncedSummaryRef.current;

    if (isRemoteProp !== undefined) setIsRemote(isRemoteProp);
    if (isAiFirstProp !== undefined) setIsAiFirst(isAiFirstProp);

    // Only re-initialize proposalBody and summaryText if:
    // 1) The modal was just opened
    // 2) A different job was loaded
    // 3) Generation finished (loading went true -> false)
    // 4) proposal/summary prop changed externally from outside (not from user editing here)
    const shouldReinitProposal = isJustOpened || isDifferentJob || finishedLoading || externalProposalChanged;
    const shouldReinitSummary = isJustOpened || isDifferentJob || finishedLoading || externalSummaryChanged;

    if (shouldReinitProposal) {
      const cleanProp = sanitizeProposalText(proposal);
      setProposalBody(cleanProp);
      lastSyncedProposalRef.current = proposal;

      const subjMatch = cleanProp.match(/^Subject:\s*(.+)$/im);
      if (subjMatch) {
        setSubject(subjMatch[1].trim());
      } else if (jobTitle) {
        const arr = detectWorkArrangementClient(jobTitle, jobText, isRemote);
        const domain = detectJobDomainClient(jobTitle, jobText);
        let coreTech = "Flutter & Dart";
        let years = "5+ Years";
        if (domain === "flutter") {
          coreTech = "Flutter & Dart";
          years = "5+ Years";
        } else if (domain === "react-native") {
          coreTech = "React Native & TypeScript";
          years = "5+ Years";
        } else if (domain === "ios") {
          coreTech = "Swift & SwiftUI";
          years = "5+ Years";
        } else if (domain === "android") {
          coreTech = "Kotlin & Compose";
          years = "5+ Years";
        } else if (domain === "mobile") {
          coreTech = "Flutter & Mobile Architecture";
          years = "5+ Years";
        } else if (domain === "frontend") {
          coreTech = "React & Next.js";
          years = "7+ Years";
        } else if (domain === "backend") {
          const tLow = (jobText || "").toLowerCase();
          coreTech = tLow.includes("go") ? "Go & PostgreSQL" : tLow.includes("python") ? "Python & FastAPI" : "Node.js & TypeScript";
          years = "7+ Years";
        } else if (domain === "ai") {
          coreTech = "Python & RAG";
          years = "3+ Years";
        } else {
          coreTech = "React/Next.js & Python/Node";
          years = "7+ Years";
        }
        setSubject(!isRemote ? `${jobTitle} Application | ${coreTech} (${years})` : arr.isOnsiteOrHybrid ? `${jobTitle} | Remote Availability | ${coreTech}` : `${jobTitle} Application | ${coreTech} (${years})`);
      } else {
        setSubject("Job Application / Proposal");
      }
    }

    if (shouldReinitSummary) {
      const cleanSumm = sanitizeProposalText(summary);
      setSummaryText(cleanSumm);
      lastSyncedSummaryRef.current = summary;
    }

    // Only reset email, status, and re-fetch resumes on modal open, job change, or generation finish
    if (isJustOpened || isDifferentJob || finishedLoading) {
      const emailToSet = (defaultEmail || "").trim();
      setRecipientEmail(emailToSet);
      setEmailStatus(null);
      setCopied(false);

      getResumesList()
        .then((list) => {
          setResumesList(list);
          if (list.length > 0) {
            if (recommendedResumeId && list.some((r) => r.id === recommendedResumeId)) {
              setSelectedResumeId(recommendedResumeId);
            } else {
              const best = matchResumeForJob(list, jobTitle, proposal || summary || "");
              if (best) {
                setSelectedResumeId(best.id);
              } else if (!selectedResumeId || !list.some((r) => r.id === selectedResumeId)) {
                setSelectedResumeId(list[0].id);
              }
            }
          }
        })
        .catch(() => setResumesList([]));

      // Trigger immediate verification if valid email string is present on 1st run
      if (emailToSet && emailToSet.includes("@") && emailToSet.includes(".")) {
        let active = true;
        setVerifyingEmail(true);
        setVerificationResult(null);
        verifySingleEmailApi(emailToSet)
          .then((res) => {
            if (active) {
              setVerificationResult(res);
            }
          })
          .catch(() => {
            if (active) {
              setVerificationResult({
                email: emailToSet,
                isValid: false,
                isDeliverable: false,
                status: "unknown",
                reason: "Could not verify deliverability",
              });
            }
          })
          .finally(() => {
            if (active) setVerifyingEmail(false);
          });

        return () => {
          active = false;
        };
      } else {
        setVerificationResult(null);
        setVerifyingEmail(false);
      }
    }
  }, [open, defaultEmail, jobTitle, proposal, summary, isRemoteProp, isAiFirstProp, loading, jobId, recommendedResumeId]);

  // Auto-select recommended resume when it changes
  useEffect(() => {
    if (recommendedResumeId && resumesList.some((r) => r.id === recommendedResumeId)) {
      setSelectedResumeId(recommendedResumeId);
    }
  }, [recommendedResumeId, resumesList]);

  // Debounced verification when user edits the email input
  const handleEmailInputChange = (val: string) => {
    setRecipientEmail(val);
    setEmailStatus(null);
    const trimmed = val.trim();
    if (!trimmed || !trimmed.includes("@") || !trimmed.includes(".")) {
      setVerificationResult(null);
      setVerifyingEmail(false);
      return;
    }

    setVerifyingEmail(true);
    setVerificationResult(null);
  };

  useEffect(() => {
    if (!open) return;
    const trimmed = recipientEmail.trim();
    if (!trimmed || !trimmed.includes("@") || !trimmed.includes(".")) {
      return;
    }

    // Don't re-run if already verified for this exact email
    if (verificationResult && verificationResult.email === trimmed) {
      return;
    }

    let isMounted = true;
    setVerifyingEmail(true);

    const timer = setTimeout(async () => {
      try {
        const res = await verifySingleEmailApi(trimmed);
        if (isMounted) {
          setVerificationResult(res);
        }
      } catch {
        if (isMounted) {
          setVerificationResult({
            email: trimmed,
            isValid: false,
            isDeliverable: false,
            status: "unknown",
            reason: "Could not verify deliverability",
          });
        }
      } finally {
        if (isMounted) {
          setVerifyingEmail(false);
        }
      }
    }, 400);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [open, recipientEmail]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  async function handleCopy() {
    const textToCopy = proposalBody.trim();
    if (!textToCopy) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const ta = document.createElement("textarea");
        ta.value = textToCopy;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { }
  }

  async function handleVerifyEmail() {
    const emailToTest = recipientEmail.trim();
    if (!emailToTest || !emailToTest.includes("@")) return;
    setVerifyingEmail(true);
    try {
      const res = await verifySingleEmailApi(emailToTest);
      setVerificationResult(res);
    } catch {
      setVerificationResult({
        email: emailToTest,
        isValid: false,
        isDeliverable: false,
        status: "unknown",
        reason: "Verification service temporarily unavailable",
      });
    } finally {
      setVerifyingEmail(false);
    }
  }


  const isEmailValid = Boolean(
    verificationResult &&
    (verificationResult.status === "valid" || verificationResult.isValid || verificationResult.isDeliverable)
  );

  const canSendEmail = Boolean(
    !sendingEmail &&
    !verifyingEmail &&
    recipientEmail.trim() &&
    recipientEmail.includes("@") &&
    isEmailValid &&
    proposalBody.trim().length > 0
  );

  async function handleSendEmail() {
    const textToSend = proposalBody.trim();
    if (!textToSend || !recipientEmail.trim() || !isEmailValid) return;
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      const res = await sendProposalEmail(
        recipientEmail.trim(),
        textToSend,
        jobTitle,
        subject.trim() || undefined,
        summaryText.trim() || undefined,
        attachResume,
        undefined,
        attachResume ? selectedResumeId : undefined,
      );
      setEmailStatus({ ok: true, messageId: res.messageId });
      // Auto-mark as applied if not already marked
      if (jobId && onToggleApplied && !isApplied) {
        onToggleApplied(jobId, jobTitle, { proposal: textToSend });
      }
    } catch (err) {
      setEmailStatus({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to send email",
      });
    } finally {
      setSendingEmail(false);
    }
  }

  // Resolve effective phone number: custom entered > prop > extracted from job text / title
  const extractedPhone = !recipientPhone && jobText ? (extractContacts(jobText).phones[0] || "") : "";
  const titlePhone = !recipientPhone && !extractedPhone && jobTitle ? (extractContacts(jobTitle).phones[0] || "") : "";
  const effectiveRawPhone = (customPhone || recipientPhone || extractedPhone || titlePhone || "").trim();
  const normalizedPhone = effectiveRawPhone ? normalizeWhatsAppNumber(effectiveRawPhone, `${jobTitle || ""} ${jobText || ""}`) : "";

  const currentProposalText = proposalBody.trim();
  const whatsappMessage = [
    currentProposalText,
    jobTitle ? `Regarding: ${jobTitle}` : "",
    jobUrl ? `Post: ${jobUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  function handleOpenWhatsApp(targetMode?: "web" | "app") {
    const mode = targetMode || preferredMode;
    let targetPhone = normalizedPhone;

    if (!targetPhone) {
      const input = window.prompt(
        "No WhatsApp number detected for this post. Enter or paste recipient's phone number to open in Simple WhatsApp:",
        ""
      );
      if (!input || !input.trim()) {
        return;
      }
      const norm = normalizeWhatsAppNumber(input.trim(), `${jobTitle || ""} ${jobText || ""}`);
      targetPhone = norm || input.trim().replace(/[^\d+]/g, "");
      if (targetPhone) {
        setCustomPhone(targetPhone);
      }
    }

    if (!targetPhone) {
      return;
    }

    setShowWhatsappMenu(false);

    if (targetMode) {
      setPreferredMode(targetMode);
      localStorage.setItem("preferred_whatsapp_mode", targetMode);
    }

    const cleanDigits = targetPhone.replace(/\D/g, "");
    const encodedMsg = encodeURIComponent(whatsappMessage);

    let finalUrl = "";
    if (mode === "web") {
      // Simple WhatsApp Web in browser tab - avoids launching WhatsApp Business desktop app
      finalUrl = `https://web.whatsapp.com/send?phone=${cleanDigits}${encodedMsg ? `&text=${encodedMsg}` : ""}`;
    } else {
      // WhatsApp App (wa.me)
      finalUrl = `https://wa.me/${cleanDigits}${encodedMsg ? `?text=${encodedMsg}` : ""}`;
    }

    window.open(finalUrl, "_blank", "noopener,noreferrer");
  }

  async function handleCopyWhatsAppNumber() {
    let targetPhone = normalizedPhone;
    if (!targetPhone) {
      const input = window.prompt("No WhatsApp number detected for this post. Enter or paste a number to copy:", "");
      if (input && input.trim()) {
        const norm = normalizeWhatsAppNumber(input.trim(), `${jobTitle || ""} ${jobText || ""}`);
        targetPhone = norm || input.trim().replace(/[^\d+]/g, "");
        if (targetPhone) {
          setCustomPhone(targetPhone);
        }
      }
    }

    if (!targetPhone) return;

    const formattedToCopy = targetPhone.startsWith("+") ? targetPhone : `+${targetPhone}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(formattedToCopy);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      const ta = document.createElement("textarea");
      ta.value = formattedToCopy;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }

    setCopiedWhatsapp(true);
    setTimeout(() => setCopiedWhatsapp(false), 2200);
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal-panel proposal-modal-panel" role="dialog" aria-modal="true" aria-label="Job Proposal">
        {/* Header */}
        <div className="modal-header proposal-modal-header">
          <div className="proposal-header-top">
            <div className="modal-title-group">
              <span className="modal-icon">✍️</span>
              <div className="modal-title-text-wrap">
                <h2 className="modal-title">AI Job Proposal</h2>
                {jobTitle && (
                  <p className="modal-subtitle proposal-header-job-title" title={jobTitle}>
                    For: <strong>{jobTitle}</strong>
                  </p>
                )}
              </div>
            </div>
            <div className="proposal-header-controls">
              <button
                type="button"
                className={`proposal-copy-whatsapp-btn ${copiedWhatsapp ? "is-copied" : ""}`}
                onClick={handleCopyWhatsAppNumber}
                title={
                  copiedWhatsapp
                    ? `Copied WhatsApp number (+${normalizedPhone})!`
                    : normalizedPhone
                    ? `Copy WhatsApp number (+${normalizedPhone})`
                    : "Copy WhatsApp number (Enter or paste number)"
                }
                aria-label={normalizedPhone ? `Copy WhatsApp number +${normalizedPhone}` : "Copy WhatsApp number"}
              >
                {copiedWhatsapp ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="13" height="13" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                )}
              </button>

              <div className="proposal-whatsapp-group" ref={whatsappMenuRef}>
                <button
                  type="button"
                  className="proposal-whatsapp-btn"
                  onClick={() => handleOpenWhatsApp()}
                  title={
                    normalizedPhone
                      ? `Open in Simple WhatsApp ${preferredMode === "web" ? "Web" : "App"} (+${normalizedPhone})`
                      : "Open in Simple WhatsApp (Enter recipient number)"
                  }
                  aria-label="Open in WhatsApp"
                >
                  <WhatsAppIcon size={16} />
                </button>
                <button
                  type="button"
                  className={`proposal-whatsapp-menu-trigger ${showWhatsappMenu ? "is-open" : ""}`}
                  onClick={() => setShowWhatsappMenu((prev) => !prev)}
                  title="Choose WhatsApp: Simple Web or App"
                  aria-label="WhatsApp options"
                >
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {showWhatsappMenu && (
                  <div className="proposal-whatsapp-menu-dropdown" role="menu">
                    <div className="proposal-whatsapp-menu-header">
                      <span>WhatsApp Version</span>
                      <span className="proposal-whatsapp-contact-hint">
                        {normalizedPhone ? `+${normalizedPhone}` : "No number detected"}
                      </span>
                    </div>

                    <button
                      type="button"
                      className={`proposal-whatsapp-menu-item ${preferredMode === "web" ? "is-active" : ""}`}
                      onClick={() => handleOpenWhatsApp("web")}
                    >
                      <span className="menu-item-icon">🌐</span>
                      <div className="menu-item-text">
                        <div className="menu-item-title">Simple WhatsApp (Web)</div>
                        <div className="menu-item-sub">Opens in browser · avoids Business app</div>
                      </div>
                      {preferredMode === "web" && <span className="proposal-whatsapp-menu-badge">Default</span>}
                    </button>

                    <button
                      type="button"
                      className={`proposal-whatsapp-menu-item ${preferredMode === "app" ? "is-active" : ""}`}
                      onClick={() => handleOpenWhatsApp("app")}
                    >
                      <span className="menu-item-icon">📱</span>
                      <div className="menu-item-text">
                        <div className="menu-item-title">WhatsApp App (wa.me)</div>
                        <div className="menu-item-sub">Opens desktop or mobile app</div>
                      </div>
                      {preferredMode === "app" && <span className="proposal-whatsapp-menu-badge">Default</span>}
                    </button>

                    <div className="proposal-whatsapp-menu-divider" />

                    <button
                      type="button"
                      className="proposal-whatsapp-menu-item"
                      onClick={() => {
                        setShowWhatsappMenu(false);
                        const input = window.prompt("Enter or edit recipient's WhatsApp number:", normalizedPhone ? `+${normalizedPhone}` : "");
                        if (input && input.trim()) {
                          const norm = normalizeWhatsAppNumber(input.trim(), `${jobTitle || ""} ${jobText || ""}`);
                          if (norm) setCustomPhone(norm);
                        }
                      }}
                    >
                      <span className="menu-item-icon">✏️</span>
                      <div className="menu-item-text">
                        <div className="menu-item-title">
                          {normalizedPhone ? "Edit Recipient Number" : "Enter Recipient Number"}
                        </div>
                      </div>
                    </button>

                    {normalizedPhone && (
                      <button
                        type="button"
                        className="proposal-whatsapp-menu-item"
                        onClick={() => {
                          setShowWhatsappMenu(false);
                          handleCopyWhatsAppNumber();
                        }}
                      >
                        <span className="menu-item-icon">📋</span>
                        <div className="menu-item-text">
                          <div className="menu-item-title">Copy Number (+{normalizedPhone})</div>
                        </div>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">✕</button>
              {copiedWhatsapp && (
                <div className="proposal-copy-feedback-badge" role="status">
                  ✓ Copied {normalizedPhone ? `+${normalizedPhone}` : "number"}
                </div>
              )}
            </div>
          </div>

          {(authorUrl || jobUrl || normalizedPhone) && (
            <div className="proposal-header-links-row">
              {authorUrl && (
                <a
                  className="proposal-profile-btn"
                  href={authorUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={authorName ? `View ${authorName}'s profile in a new tab` : "Open author profile in a new tab"}
                >
                  <span>👤 Profile ↗</span>
                </a>
              )}
              {jobUrl && (
                <a
                  className="proposal-open-post-btn"
                  href={jobUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Open the original post in a new tab"
                >
                  <LinkedinIcon size={14} />
                  <span>Open Post ↗</span>
                </a>
              )}
              {normalizedPhone && (
                <button
                  type="button"
                  className={`proposal-phone-chip-btn ${copiedWhatsapp ? "is-copied" : ""}`}
                  onClick={handleCopyWhatsAppNumber}
                  title={`Click to copy WhatsApp number: +${normalizedPhone}`}
                >
                  <WhatsAppIcon size={13} />
                  <span>+{normalizedPhone}</span>
                  <span className="proposal-phone-chip-copy">
                    {copiedWhatsapp ? "✓ Copied" : "📋 Copy"}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="modal-body">
          {loading && (
            <div className="proposal-loading">
              <div className="proposal-spinner-wrap">
                <span className="proposal-spinner" />
              </div>
              <p className="proposal-loading-text">AI is writing your proposal…</p>
              <p className="proposal-loading-sub">
                {retryStatus ? `⚠️ ${retryStatus}` : "Powered by OpenRouter · Usually takes 3–10s"}
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="modal-error-banner">
              <div>⚠️ {error}</div>
              <p className="error-hint">Make sure your profile is saved and try again.</p>
              {onRetry && (
                <button type="button" className="modal-error-retry-btn" onClick={() => onRetry(isRemote, isAiFirst)}>
                  🔄 Try Again
                </button>
              )}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* LinkedIn Note Field */}
              <div className="proposal-summary-section">
                <div className="proposal-summary-header">
                  <label className="proposal-summary-label">
                    <span>💼</span>
                    <span>LinkedIn Application Note (250 chars max)</span>
                    <span className="proposal-summary-count">{summaryText.length}/250</span>
                  </label>
                  <div className="proposal-summary-header-actions">
                    <button
                      type="button"
                      className="proposal-mini-tool-btn"
                      onClick={handlePasteSummary}
                      title="Paste from clipboard into LinkedIn note"
                    >
                      📋 Paste
                    </button>
                    {summaryText && (
                      <button
                        type="button"
                        className="proposal-mini-tool-btn is-danger"
                        onClick={handleClearSummary}
                        title="Clear LinkedIn note text"
                      >
                        🗑️ Clear
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={summaryText}
                  onChange={(e) => handleSummaryTextChange(e.target.value)}
                  className="proposal-summary-input"
                  placeholder="Are you still looking for the [Job Title]? I'm available for it. Portfolio: https://..."
                  maxLength={250}
                  rows={3}
                />
              </div>

              {/* Proposal Text (Editable) */}
              <div className="proposal-body-section">
                <div className="proposal-body-header">
                  <label className="proposal-body-label">
                    <span>📄</span>
                    <span>Full Proposal (Editable)</span>
                    <span className="proposal-char-count">{proposalBody.length} chars</span>
                  </label>
                  <div className="proposal-body-header-actions">
                    <button
                      type="button"
                      className="proposal-mini-tool-btn"
                      onClick={handlePasteProposal}
                      title="Paste proposal text from clipboard"
                    >
                      📋 Paste
                    </button>
                    {proposalBody && (
                      <button
                        type="button"
                        className="proposal-mini-tool-btn"
                        onClick={handleCleanFormatProposal}
                        title="Clean and tidy up proposal formatting (removes redundant tags/lines)"
                      >
                        ✨ Clean Format
                      </button>
                    )}
                    {proposalBody && (
                      <button
                        type="button"
                        className="proposal-mini-tool-btn is-danger"
                        onClick={handleClearProposal}
                        title="Clear proposal text"
                      >
                        🗑️ Clear
                      </button>
                    )}
                    <label
                      className={`proposal-aifirst-toggle-label ${isAiFirst ? "is-aifirst" : ""}`}
                      title={isAiFirst ? "AI Assistant / AI 1st enabled: generates AI-assisted engineering velocity proposal with Practical Technical Evaluation. Click to switch off." : "Click to enable AI Assistant / AI 1st template with Practical Technical Evaluation."}
                    >
                      <input
                        type="checkbox"
                        checked={isAiFirst}
                        disabled={loading}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setIsAiFirst(val);
                          onRetry?.(isRemote, val);
                        }}
                        className="proposal-aifirst-checkbox"
                      />
                      <span className="proposal-aifirst-icon">⚡</span>
                      <span className="proposal-aifirst-text">AI 1st</span>
                    </label>

                    <label
                      className={`proposal-remote-toggle-label ${!isRemote ? "is-onsite" : ""}`}
                      title={isRemote ? "Currently set to Remote Application. Click to switch to Onsite Application." : "Currently set to Onsite Application. Click to switch to Remote Application."}
                    >
                      <input
                        type="checkbox"
                        checked={isRemote}
                        disabled={loading}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setIsRemote(val);
                          onRetry?.(val, isAiFirst);
                        }}
                        className="proposal-remote-checkbox"
                      />
                      <span className="proposal-remote-icon">{isRemote ? "🌐" : "🏢"}</span>
                      <span className="proposal-remote-text">{isRemote ? "Remote Application" : "Onsite Application"}</span>
                    </label>
                  </div>
                </div>
                <textarea
                  className="proposal-textarea-editable"
                  value={proposalBody}
                  onChange={(e) => handleProposalTextChange(e.target.value)}
                  placeholder="Paste or write your proposal text here..."
                  rows={12}
                />
              </div>

              {/* Email Sending Card */}
              <div className="proposal-email-section">
                <div className="proposal-email-header">
                  <div className="proposal-email-title">
                    <span>✉️</span>
                    <span>Send Proposal via Email</span>
                  </div>
                  {defaultEmail && (
                    <span className="proposal-email-badge">
                      Auto-detected email
                    </span>
                  )}
                </div>

                <div className="proposal-email-row">
                  <div className="proposal-email-input-wrapper">
                    <input
                      type="email"
                      placeholder="Recipient email (e.g. client@company.com)"
                      value={recipientEmail}
                      onChange={(e) => handleEmailInputChange(e.target.value)}
                      className={`proposal-email-input ${
                        verificationResult
                          ? verificationResult.status === "valid"
                            ? "is-valid"
                            : verificationResult.status === "invalid"
                            ? "is-invalid"
                            : "is-risky"
                          : ""
                      }`}
                    />
                    {verifyingEmail && (
                      <span className="proposal-auto-verify-pill is-checking">
                        <span className="pill-spinner" />
                        Verifying…
                      </span>
                    )}
                    {!verifyingEmail && verificationResult && (
                      <span
                        className={`proposal-auto-verify-pill is-${verificationResult.status}`}
                        title={verificationResult.reason ? `${verificationResult.reason} (Click to re-verify)` : "Click to re-verify"}
                        onClick={handleVerifyEmail}
                      >
                        {verificationResult.status === "valid"
                          ? "🟢 Deliverable"
                          : verificationResult.status === "invalid"
                          ? "🔴 Invalid MX"
                          : "🟡 Risky"}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canSendEmail}
                    onClick={handleSendEmail}
                    className={`proposal-email-send-btn ${emailStatus?.ok ? "is-sent" : ""}`}
                    title={
                      sendingEmail
                        ? "Sending proposal email…"
                        : verifyingEmail
                        ? "Verifying email deliverability…"
                        : !recipientEmail.trim()
                        ? "Please enter a recipient email address"
                        : !isEmailValid
                        ? "Email must be verified as deliverable before sending"
                        : "Send proposal email"
                    }
                  >
                    {sendingEmail ? (
                      "Sending..."
                    ) : verifyingEmail ? (
                      "Verifying…"
                    ) : emailStatus?.ok ? (
                      "✓ Sent & Applied!"
                    ) : (
                      "📤 Send Email"
                    )}
                  </button>
                </div>

                {/* Email Verification Feedback Banner (Automatic) */}
                {verifyingEmail && !verificationResult && (
                  <div className="proposal-verification-badge-bar status-checking">
                    <span className="verification-badge-icon">⏳</span>
                    <span className="verification-badge-text">
                      Auto-verifying deliverability and DNS MX records…
                    </span>
                  </div>
                )}
                {verificationResult && (
                  <div
                    className={`proposal-verification-badge-bar status-${verificationResult.status}`}
                  >
                    <span className="verification-badge-icon">
                      {verificationResult.status === "valid"
                        ? "🟢"
                        : verificationResult.status === "invalid"
                        ? "🔴"
                        : "🟡"}
                    </span>
                    <span className="verification-badge-text">
                      <strong>
                        {verificationResult.status === "valid"
                          ? "Deliverable & Valid MX Domain"
                          : verificationResult.status === "invalid"
                          ? "Undeliverable / Invalid Domain"
                          : "Risky / Disposable Email"}
                      </strong>
                      {verificationResult.reason ? ` — ${verificationResult.reason}` : ""}
                    </span>
                  </div>
                )}


                {/* Attachment Option */}
                <div className="proposal-attachment-row">
                  <label className="proposal-attachment-toggle-label">
                    <input
                      type="checkbox"
                      checked={attachResume}
                      onChange={(e) => setAttachResume(e.target.checked)}
                      className="proposal-attachment-checkbox"
                    />
                    <span className="attachment-icon">📎</span>
                    <span className="attachment-text">
                      Attach Resume:
                    </span>
                  </label>

                  {attachResume && (
                    <div className="proposal-attachment-controls">
                      {resumesList.length > 1 && (
                        <select
                          className="proposal-resume-select"
                          value={selectedResumeId}
                          onChange={(e) => setSelectedResumeId(e.target.value)}
                        >
                          {resumesList.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.id === recommendedResumeId ? `✨ ${r.filename} (AI Picked · ${Math.round(r.size / 1024)} KB)` : `${r.filename} (${Math.round(r.size / 1024)} KB)`}
                            </option>
                          ))}
                        </select>
                      )}

                      {resumesList.length === 1 && (
                        <span className="attachment-resume-filename" title={resumesList[0].filename}>
                          <strong>{resumesList[0].filename}</strong>
                          {recommendedResumeId === resumesList[0].id && (
                            <span className="ai-picked-pill"> ✨ AI Picked</span>
                          )}
                        </span>
                      )}

                      {resumesList.length === 0 && (
                        <span className="attachment-resume-filename">
                          <strong>Default Resume PDF</strong>
                        </span>
                      )}

                      <button
                        type="button"
                        className="btn-preview-attachment"
                        onClick={() => setPreviewResumeModalOpen(true)}
                        title="Preview attached PDF resume"
                      >
                        <span>👁️ Preview</span>
                      </button>

                      <span className="attachment-active-badge">✓ Included</span>
                    </div>
                  )}
                </div>

                {emailStatus?.ok && (
                  <div className="proposal-email-success">
                    ✓ Proposal email sent successfully to <strong>{recipientEmail}</strong> (marked as applied)!
                  </div>
                )}
                {emailStatus?.error && (
                  <div className="proposal-email-error">
                    ⚠️ Failed to send: {emailStatus.error}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <div className="modal-footer">
            <button type="button" className="modal-btn-cancel" onClick={handleClose}>
              Close
            </button>
            {jobId && onToggleApplied && (
              <button
                type="button"
                className={`modal-btn-retry ${isApplied ? "btn-is-applied" : ""}`}
                onClick={() => onToggleApplied(jobId, jobTitle, { proposal: proposalBody })}
              >
                {isApplied ? "✓ Marked as Applied" : "Mark as Applied"}
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                className="modal-btn-retry"
                onClick={() => onRetry(isRemote, isAiFirst)}
                title="Regenerate proposal with AI"
              >
                🔄 Regenerate
              </button>
            )}
            <button
              type="button"
              className={`modal-btn-save ${copied ? "btn-saved" : "btn-copy-proposal"}`}
              onClick={handleCopy}
              disabled={!proposalBody.trim()}
              title={proposalBody.trim() ? "Copy proposal to clipboard" : "No proposal text to copy"}
            >
              {copied ? "✓ Copied!" : "📋 Copy Proposal"}
            </button>
          </div>
        )}

        {!loading && error && (
          <div className="modal-footer">
            <button type="button" className="modal-btn-cancel" onClick={handleClose}>
              Close
            </button>
            {onRetry && (
              <button
                type="button"
                className="modal-btn-retry"
                onClick={() => onRetry(isRemote, isAiFirst)}
              >
                🔄 Try Again
              </button>
            )}
          </div>
        )}
      </div>

      {/* PDF Preview Modal */}
      <PdfPreviewModal
        open={previewResumeModalOpen}
        onClose={() => setPreviewResumeModalOpen(false)}
        resumeId={selectedResumeId || undefined}
        resumesList={resumesList}
        selectedResumeId={selectedResumeId}
        onSelect={(id) => setSelectedResumeId(id)}
      />
    </div>
  );
}

