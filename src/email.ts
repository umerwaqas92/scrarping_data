import nodemailer from "nodemailer";

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
}

export async function sendProposalEmail(options: SendEmailOptions): Promise<{ ok: boolean; messageId: string }> {
  const { to, subject, body, jobTitle, summary } = options;

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

  // 3. Prepend LinkedIn note to email body if provided
  if (summary && summary.trim()) {
    emailBody = `LinkedIn Application Note:\n${summary.trim()}\n\n${emailBody}`;
  }

  const info = await transporter.sendMail({
    from: `"Job Applicant" <${SMTP_USER}>`,
    to,
    subject: emailSubject,
    text: emailBody,
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
