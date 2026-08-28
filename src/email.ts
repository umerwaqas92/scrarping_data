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
}

export async function sendProposalEmail(options: SendEmailOptions): Promise<{ ok: boolean; messageId: string }> {
  const { to, subject, body, jobTitle } = options;

  if (!to || !to.includes("@")) {
    throw new Error("Invalid recipient email address");
  }

  const emailSubject = subject || (jobTitle ? `Application / Proposal: ${jobTitle}` : "Job Application / Proposal");

  const info = await transporter.sendMail({
    from: `"Job Applicant" <${SMTP_USER}>`,
    to,
    subject: emailSubject,
    text: body,
  });

  return {
    ok: true,
    messageId: info.messageId,
  };
}
