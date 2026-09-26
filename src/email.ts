import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { getResumeRecord } from "./db.js";

const RESUME_FILENAME = process.env.RESUME_FILENAME || "Umer_Waqas_Software_Engineer_Resume.pdf";

/** Local filesystem fallback (dev only — Vercel's FS is ephemeral). */
export function getResolvedResumePath(customPath?: string): string | null {
  const candidates = [
    customPath,
    path.resolve(process.cwd(), "resume.pdf"),
    process.env.RESUME_PATH,
    "/Users/themacstore/Downloads/Umer_Waqas_Software_Engineer_Resume.pdf",
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function decodeBase64Pdf(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
    if (!cleaned) return null;
    const buf = Buffer.from(cleaned, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export interface ResumeAttachment {
  filename: string;
  contentType: string;
  content?: Buffer;
  path?: string;
}

export async function getResumeAttachment(customPath?: string): Promise<ResumeAttachment | null> {
  // 1. Database (works on Vercel — no filesystem/env limits)
  try {
    const rec = await getResumeRecord();
    if (rec?.content_base64) {
      const buf = Buffer.from(rec.content_base64.replace(/\s+/g, ""), "base64");
      if (buf.length > 0) {
        return { filename: rec.filename || RESUME_FILENAME, contentType: "application/pdf", content: buf };
      }
    }
  } catch {
    // DB unavailable — fall through
  }

  // 2. Base64 env var
  const envBuf = decodeBase64Pdf(process.env.RESUME_PDF_BASE64 || process.env.RESUME_BASE64);
  if (envBuf) {
    return { filename: RESUME_FILENAME, contentType: "application/pdf", content: envBuf };
  }

  // 3. Local file
  const p = getResolvedResumePath(customPath);
  if (p) {
    return { filename: RESUME_FILENAME, contentType: "application/pdf", path: p };
  }

  return null;
}

export async function getResumeInfo(customPath?: string) {
  let source: "database" | "env" | "file" | "none" = "none";
  let filename = RESUME_FILENAME;
  let size = 0;

  try {
    const rec = await getResumeRecord();
    if (rec?.content_base64) {
      source = "database";
      filename = rec.filename || RESUME_FILENAME;
      size = Buffer.from(rec.content_base64, "base64").length;
    }
  } catch {
    // ignore
  }

  if (source === "none") {
    const envBuf = decodeBase64Pdf(process.env.RESUME_PDF_BASE64 || process.env.RESUME_BASE64);
    if (envBuf) {
      source = "env";
      size = envBuf.length;
    } else {
      const p = getResolvedResumePath(customPath);
      if (p) {
        source = "file";
        try {
          size = fs.statSync(p).size;
        } catch {
          size = 0;
        }
      }
    }
  }

  return {
    exists: source !== "none",
    filename,
    source,
    size,
    path: getResolvedResumePath(customPath) || "",
  };
}

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465", 10);
const SMTP_USER = process.env.SMTP_USER || "um.waqas.khan@gmail.com";
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || "tmpv cugm btsx yrdq";
const SMTP_SECURE = process.env.SMTP_SECURE !== "false";

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASSWORD.replace(/\s+/g, ""),
  },
});

export interface SendEmailOptions {
  to: string;
  subject?: string;
  body: string;
  jobTitle?: string;
  summary?: string;
  attachResume?: boolean;
  resumePath?: string;
}

export async function sendProposalEmail(options: SendEmailOptions): Promise<{ ok: boolean; messageId: string }> {
  const { to, subject, body, jobTitle, summary, attachResume, resumePath } = options;

  if (!to || !to.includes("@")) {
    throw new Error("Invalid recipient email address");
  }

  let emailSubject = (subject || "").trim();
  let emailBody = (body || "").trim();

  // 1. Check if the generated proposal body starts with a "Subject: ..." header line
  const subjectRegex = /^\s*(?:\*{0,2}|#{1,6}\s*)?(?:Subject(?:\s+Line)?|RE)\s*:\s*([^\n\r]+)(?:\r?\n)*/i;
  const match = emailBody.match(subjectRegex);

  if (match) {
    const extractedSubject = match[1].replace(/^[\*\s"'_]+|[\*\s"'_]+$/g, "").trim();
    if (extractedSubject) {
      // Use the AI-generated subject if no custom subject was provided or if it's the generic fallback
      if (!emailSubject || emailSubject.startsWith("Application / Proposal:") || emailSubject === "Job Application / Proposal") {
        emailSubject = extractedSubject;
      }
      // Remove the "Subject: ..." line from the email body so it's not repeated inside the message
      emailBody = emailBody.replace(subjectRegex, "").trim();
    }
  }

  // 2. Fallback subject if still missing or empty
  if (!emailSubject) {
    if (jobTitle && !/^\d+[\s\w]*followers/i.test(jobTitle.trim())) {
      emailSubject = `Application / Proposal: ${jobTitle.trim()}`;
    } else {
      emailSubject = "Job Application / Proposal";
    }
  }

  // 3. The LinkedIn application note is intentionally NOT included in the
  //    email — it's a short note for LinkedIn's own application form. The
  //    email body is the proposal only. (`summary` is accepted for API
  //    compatibility but ignored here.)

  // 4. Handle attachments (resume PDF)
  const attachments: ResumeAttachment[] = [];
  if (attachResume !== false) {
    const att = await getResumeAttachment(resumePath);
    if (att) attachments.push(att);
  }

  const info = await transporter.sendMail({
    from: `"Umer Waqas" <${SMTP_USER}>`,
    to,
    subject: emailSubject,
    text: emailBody,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  return {
    ok: true,
    messageId: info.messageId,
  };
}

export interface BulkEmailResult {
  to: string;
  ok: boolean;
  messageId?: string;
  error?: string;
  jobId?: string;
}

export interface BulkEmailReport {
  total: number;
  sent: number;
  failed: number;
  results: BulkEmailResult[];
}

export async function sendBulkProposalEmails(
  items: (SendEmailOptions & { jobId?: string })[]
): Promise<BulkEmailReport> {
  const results: BulkEmailResult[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const item of items) {
    try {
      const res = await sendProposalEmail(item);
      results.push({
        to: item.to,
        ok: true,
        messageId: res.messageId,
        jobId: item.jobId,
      });
      sentCount++;
      // Brief pause between SMTP dispatches to avoid throttling
      await new Promise((resolve) => setTimeout(resolve, 350));
    } catch (err) {
      results.push({
        to: item.to,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        jobId: item.jobId,
      });
      failedCount++;
    }
  }

  return {
    total: items.length,
    sent: sentCount,
    failed: failedCount,
    results,
  };
}
