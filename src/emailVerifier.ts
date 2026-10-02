import dns from "dns";
import { ApifyClient, EmailVerificationResult } from "./apifyClient.js";

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "10minutemail.com",
  "tempmail.com",
  "guerrillamail.com",
  "throwawaymail.com",
  "yopmail.com",
  "sharklasers.com",
  "getairmail.com",
  "dispostable.com",
  "trashmail.com",
  "temp-mail.org",
  "fakeinbox.com",
]);

/** Syntax check */
export function isValidEmailSyntax(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email.trim());
}

/** Check if domain has active MX records via DNS */
export async function checkDomainMx(domain: string): Promise<{ hasMx: boolean; mxRecords: string[] }> {
  try {
    const records = await dns.promises.resolveMx(domain);
    if (Array.isArray(records) && records.length > 0) {
      records.sort((a, b) => a.priority - b.priority);
      return {
        hasMx: true,
        mxRecords: records.map((r) => r.exchange),
      };
    }
    return { hasMx: false, mxRecords: [] };
  } catch {
    return { hasMx: false, mxRecords: [] };
  }
}

/** Perform fast DNS + syntax check for emails */
export async function verifyEmailsFast(emails: string[]): Promise<EmailVerificationResult[]> {
  const uniqueEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

  return Promise.all(
    uniqueEmails.map(async (email) => {
      if (!isValidEmailSyntax(email)) {
        return {
          email,
          isValid: false,
          isDeliverable: false,
          status: "invalid",
          reason: "Invalid email syntax format",
        };
      }

      const domain = email.split("@")[1];
      const isDisposable = DISPOSABLE_DOMAINS.has(domain);

      const mx = await checkDomainMx(domain);
      if (!mx.hasMx) {
        return {
          email,
          isValid: false,
          isDeliverable: false,
          isDisposable,
          status: "invalid",
          mxRecords: false,
          reason: `Domain @${domain} has no valid mail exchange (MX) DNS records`,
        };
      }

      return {
        email,
        isValid: !isDisposable,
        isDeliverable: !isDisposable,
        isDisposable,
        status: isDisposable ? "risky" : "valid",
        mxRecords: true,
        reason: isDisposable
          ? "Temporary / disposable mailbox"
          : `Valid MX records found for @${domain}`,
      };
    })
  );
}

/**
 * Verify emails via Apify Email Verifier actor (fatihtahta/email-verifier-free-to-use)
 * with graceful fallback to local DNS MX resolution.
 */
export async function verifyEmailsComprehensive(
  emails: string[],
  apifyClient?: ApifyClient | null
): Promise<EmailVerificationResult[]> {
  const uniqueEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (uniqueEmails.length === 0) return [];

  // Try Apify first if client is available
  if (apifyClient) {
    try {
      const results = await apifyClient.verifyEmails(uniqueEmails);
      if (results.length > 0) {
        return results;
      }
    } catch (err) {
      console.warn("[email-verifier] Apify verification failed, falling back to DNS check:", err);
    }
  }

  // Fallback to DNS MX & syntax check
  return verifyEmailsFast(uniqueEmails);
}
