#!/usr/bin/env python3
"""
CodeCanyon Sellers Cold Outreach & Email Dispatcher
Uses umerwaqasfluttydev@gmail.com SMTP with attached Umer_Waqas_General_CV.pdf
"""

import os
import sys
import time
import smtplib
import argparse
from email.message import EmailMessage
from email.utils import formataddr

# SMTP Configuration
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
SMTP_USER = "umerwaqasfluttydev@gmail.com"
SMTP_PASS = "pkwljaaazykfzgkk"
SENDER_NAME = "Umer Waqas"

# Default Resume Attachment
RESUME_PATH = "/Users/themacstore/Downloads/codecanyon2026/rsume_etc/Umer_Waqas_General_CV.pdf"
RESUME_FILENAME = "Umer_Waqas_General_CV.pdf"

# Verified Active CodeCanyon Sellers
TARGET_SELLERS = [
    {
        "id": "titansys",
        "name": "Titansys Team",
        "email": "envato.titansystems@gmail.com",
        "item": "Vyral – AI Short-Form Video Generator",
        "subject": "Flutter Mobile App for Vyral / Partnership Opportunity",
        "body": """Hi Titansys Team,

I saw your recent launch of Vyral on CodeCanyon — congrats on the release! The automated AI video and rendering engine you built is very impressive.

I'm a Mobile & Full-Stack Engineer (Top Rated on Upwork with 100% Job Success across 48+ projects) leading Fluttydev. I recently engineered a cross-platform AI Influencer & Content Generator using Flutter, Next.js, and generative AI APIs.

Many creators buying short-form video scripts look for a native iOS & Android app so their end-users can prompt, preview, and export reels directly from their phone camera roll.

I'd love to propose:
1. Building a ready-to-use Flutter companion app connected to your Vyral backend API (which you could co-list as an extended bundle or add-on on CodeCanyon).
2. Handling custom mobile setups and feature requests for your buyers who reach out asking for mobile apps.

Portfolio: https://umerwaqas.lovable.app/?resume=3
GitHub: https://github.com/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

I have attached my CV for your review. Would you be open to a quick chat to discuss?

Best regards,
Umer Waqas
Full-Stack & Flutter Engineer | Fluttydev
+92 345 9347900 | um.waqas.khan@gmail.com"""
    },
    {
        "id": "codeyon",
        "name": "Codeyon Team",
        "email": "info@codeyon.com",
        "item": "Influencify – AI Influencer SaaS Platform",
        "subject": "Flutter Mobile App for Influencify / Partnership",
        "body": """Hi Codeyon Team,

I've been following your updates on Influencify on CodeCanyon — love the focus on viral reels and AI influencer workflows.

This is right in line with my work: I recently designed and shipped an AI Influencer Generator using Flutter, Next.js, and AI generation APIs, including full subscriptions and App Store / Google Play delivery.

Since Influencify is a web platform, offering a native Flutter mobile app would allow your buyers' users to generate, manage, and schedule their AI influencer reels directly on mobile devices.

I'd love to explore:
1. Developing a turnkey Flutter companion client for Influencify.
2. Taking on custom feature development or mobile setups for your buyers.

Portfolio: https://umerwaqas.lovable.app/?resume=3
GitHub: https://github.com/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

Attached is my general CV highlighting relevant production mobile and AI deliveries. Happy to connect!

Best regards,
Umer Waqas
Mobile & AI Full-Stack Engineer | Fluttydev
+92 345 9347900 | um.waqas.khan@gmail.com"""
    },
    {
        "id": "mediacity",
        "name": "Sudhir & Media City Team",
        "email": "sudhirchechani@gmail.com",
        "item": "WaDesk SaaS – WhatsApp CRM & AI Chatbots",
        "subject": "Native Flutter Mobile App for WaDesk / Customization Partner",
        "body": """Hi Sudhir and Media City team,

I've been following your updates on WaDesk SaaS on CodeCanyon — the WhatsApp CRM automation and chatbot builder is very well executed.

I run Fluttydev and work as a Top Rated Mobile & Full-Stack Engineer on Upwork (100% Job Success across 48+ projects). Our core specialization is Flutter (iOS & Android) with Laravel and Node.js backends.

For a customer CRM like WaDesk, business owners and support agents frequently need a native mobile app so their agents can receive push notifications, chat in real-time with WhatsApp leads, and monitor bots on the go.

Would you be open to discussing:
1. Creating an official Flutter companion app for WaDesk that you can offer to buyers as an extended add-on?
2. Partnering on client customization requests from buyers needing dedicated mobile apps or custom API extensions?

Portfolio: https://umerwaqas.lovable.app/?resume=3
GitHub: https://github.com/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

Attached is my CV for your reference. Looking forward to your thoughts.

Best regards,
Umer Waqas
Mobile & Full-Stack Engineer | Fluttydev
+92 345 9347900 | um.waqas.khan@gmail.com"""
    },
    {
        "id": "codericks",
        "name": "Codericks / OriginLab Team",
        "email": "codericks.envato@gmail.com",
        "item": "Aoxio – Multi-Business Booking & Appointment SaaS",
        "subject": "Flutter Mobile Client for Aoxio / Partnership",
        "body": """Hi Codericks Team,

Congratulations on the ongoing updates and strong sales for Aoxio SaaS on CodeCanyon.

Because appointment scheduling and local service bookings are primarily mobile-driven, having a native Flutter mobile client for service providers and clients would significantly increase your buyers' conversion and retention.

I'm a Top Rated Mobile & Full-Stack Engineer on Upwork (100% Job Success, 48+ projects) specializing in Flutter, Dart, and Laravel APIs.

We can build a production-ready Flutter app for Aoxio covering customer booking, provider appointment management, and push notifications — either as a co-listed add-on or by partnering to handle custom mobile requests from your buyers.

Portfolio: https://umerwaqas.lovable.app/?resume=3
GitHub: https://github.com/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

Attached is my CV. Let me know if you would be open to a quick chat.

Best regards,
Umer Waqas
Mobile & Full-Stack Engineer | Fluttydev
+92 345 9347900 | um.waqas.khan@gmail.com"""
    },
    {
        "id": "wrapcoders",
        "name": "WRAPCODERS Team",
        "email": "wrapcoders@gmail.com",
        "item": "Rellee – Short Video Sharing Platform",
        "subject": "Flutter Mobile App for Rellee / Collaboration",
        "body": """Hi WRAPCODERS Team,

I saw your release of Rellee on CodeCanyon. Short-form video platforms thrive most on mobile devices with camera recording, swipe feeds, and push notifications.

I'm a Top Rated Mobile & Full-Stack Engineer on Upwork with 48+ delivered projects (100% Job Success). I specialize in Flutter, Dart, and video/media pipelines.

I'd love to propose building a high-performance Flutter mobile app for Rellee to give your buyers a complete TikTok/Reels-style experience across iOS and Android, or partnering to handle mobile client customizations.

Portfolio: https://umerwaqas.lovable.app/?resume=3
GitHub: https://github.com/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

My CV is attached. Would love to hear your thoughts!

Best regards,
Umer Waqas
Mobile & Full-Stack Engineer | Fluttydev
+92 345 9347900 | um.waqas.khan@gmail.com"""
    },
    {
        "id": "wrteam",
        "name": "WRTeam",
        "email": "support@wrteam.in",
        "item": "eClassify & Flutter Ecosystem",
        "subject": "Overflow Flutter Customization Partner for WRTeam Buyers",
        "body": """Hi WRTeam,

Congratulations on the strong momentum and recent updates across eClassify and your Flutter product suite. The code quality in your Flutter solutions is great.

With thousands of active buyers, I imagine your core team frequently receives custom feature requests, third-party payment gateway additions, and app store deployment requests that take time away from your main product roadmap.

I'm a Top Rated Flutter Engineer on Upwork (100% Job Success across 48+ projects) leading a 20+ person engineering team at Fluttydev.

We would love to act as a vetted customization and integration partner for your buyers who need custom development, backend tweaks, or dedicated App Store & Google Play deployments.

Portfolio: https://umerwaqas.lovable.app/?resume=3
GitHub: https://github.com/umerwaqas92
Upwork: https://www.upwork.com/freelancers/~010219e25749223694

I've attached my CV for your review. Happy to connect if you have overflow client work to hand off!

Best regards,
Umer Waqas
Senior Flutter Engineer | Fluttydev
+92 345 9347900 | um.waqas.khan@gmail.com"""
    }
]

def send_email(to_email, to_name, subject, body, attachment_path=RESUME_PATH):
    msg = EmailMessage()
    msg["From"] = formataddr((SENDER_NAME, SMTP_USER))
    msg["To"] = formataddr((to_name, to_email))
    msg["Subject"] = subject
    msg.set_content(body)

    # Attach resume PDF
    if attachment_path and os.path.exists(attachment_path):
        with open(attachment_path, "rb") as f:
            pdf_data = f.read()
        msg.add_attachment(
            pdf_data,
            maintype="application",
            subtype="pdf",
            filename=RESUME_FILENAME
        )
    else:
        print(f"⚠️ Warning: Resume not found at {attachment_path}, sending without attachment.")

    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)

    return True

def main():
    parser = argparse.ArgumentParser(description="Send outreach emails to CodeCanyon sellers")
    parser.add_argument("--test", action="store_true", help="Send a test/warmup email to um.waqas.khan@gmail.com")
    parser.add_argument("--preview", action="store_true", help="Preview all emails without sending")
    parser.add_argument("--send", type=str, help="Send email to a specific seller by ID (e.g., titansys, mediacity, codeyon)")
    parser.add_argument("--send-all", action="store_true", help="Send emails to all targeted sellers with a safe delay")

    args = parser.parse_args()

    if not any([args.test, args.preview, args.send, args.send_all]):
        parser.print_help()
        sys.exit(0)

    print(f"📧 Sender: {SMTP_USER}")
    print(f"📎 Attachment: {RESUME_PATH} (exists: {os.path.exists(RESUME_PATH)})")
    print("-" * 60)

    if args.preview:
        print("🔍 PREVIEW MODE - Listing target emails:\n")
        for s in TARGET_SELLERS:
            print(f"[{s['id']}] To: {s['name']} <{s['email']}>")
            print(f"Subject: {s['subject']}")
            print(f"Item: {s['item']}")
            print("-" * 40)
        return

    if args.test:
        test_email = "um.waqas.khan@gmail.com"
        print(f"🚀 Sending TEST / WARMUP email to {test_email}...")
        sample = TARGET_SELLERS[0]
        subject = f"[TEST] {sample['subject']}"
        body = sample["body"]
        send_email(test_email, "Umer Waqas (Test)", subject, body)
        print(f"✅ Test email successfully sent to {test_email} with {RESUME_FILENAME} attached!")
        return

    if args.send:
        seller_id = args.send.strip().lower()
        matched = [s for s in TARGET_SELLERS if s["id"] == seller_id]
        if not matched:
            print(f"❌ Seller ID '{seller_id}' not found. Available IDs: {[s['id'] for s in TARGET_SELLERS]}")
            sys.exit(1)
        s = matched[0]
        print(f"🚀 Sending email to {s['name']} <{s['email']}>...")
        send_email(s["email"], s["name"], s["subject"], s["body"])
        print(f"✅ Successfully sent to {s['email']}!")
        return

    if args.send_all:
        print(f"🚀 Sending outreach to all {len(TARGET_SELLERS)} sellers with 15s delay...")
        for i, s in enumerate(TARGET_SELLERS):
            print(f"[{i+1}/{len(TARGET_SELLERS)}] Sending to {s['name']} <{s['email']}> ({s['item']})...")
            try:
                send_email(s["email"], s["name"], s["subject"], s["body"])
                print(f"   ✅ Sent to {s['email']}")
            except Exception as e:
                print(f"   ❌ Error sending to {s['email']}: {e}")

            if i < len(TARGET_SELLERS) - 1:
                print("   ⏳ Waiting 15s before next email...")
                time.sleep(15)

        print("\n🎉 All outreach emails processed!")

if __name__ == "__main__":
    main()
