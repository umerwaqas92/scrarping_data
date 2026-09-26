import { readFileSync } from "node:fs";
import path from "node:path";
import { getCookie, getAllCookies } from "./db.js";

export type CookiePlatform = "linkedin" | "reddit" | "facebook";

export const COOKIE_PLATFORMS: CookiePlatform[] = ["linkedin", "reddit", "facebook"];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ENV_MAP: Record<CookiePlatform, string | undefined> = {
  linkedin: process.env.LINKEDIN_COOKIES,
  reddit: process.env.REDDIT_COOKIES,
  facebook: process.env.FACEBOOK_COOKIES,
};

const FILE_MAP: Record<CookiePlatform, string> = {
  linkedin: "linkedin_cookies.txt",
  reddit: "reddit_cookies.txt",
  facebook: "facebook_cookies.txt",
};

export interface ParsedCookie {
  domain: string;
  includeSubdomains: boolean;
  path: string;
  secure: boolean;
  expiry: string;
  name: string;
  value: string;
}

export interface ParsedCookieText {
  format: "netscape" | "header" | "empty";
  cookies: ParsedCookie[];
  header: string;
}

function isLikelyNetscape(lines: string[]): boolean {
  return lines.some((line) => {
    const parts = line.split("\t");
    return parts.length >= 7 && /\./.test(parts[0]);
  });
}

/**
 * Parse either a Netscape cookie file (`domain\tTRUE\t/\tTRUE\texpiry\tname\tvalue`)
 * or a raw `Cookie:` / `name=value; ...` header into a canonical structure.
 */
export function parseCookieText(raw: string): ParsedCookieText {
  const text = (raw || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l && !l.trimStart().startsWith("#"));

  if (lines.length === 0) {
    return { format: "empty", cookies: [], header: "" };
  }

  if (isLikelyNetscape(lines)) {
    const cookies: ParsedCookie[] = [];
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 7) continue;
      const [domain, includeSub, cpath, secure, expiry, name, ...valueParts] = parts;
      const value = valueParts.join("\t");
      if (!domain.trim() || !name.trim()) continue;
      cookies.push({
        domain: domain.trim(),
        includeSubdomains: includeSub.trim().toUpperCase() === "TRUE",
        path: cpath.trim() || "/",
        secure: secure.trim().toUpperCase() === "TRUE",
        expiry: expiry.trim() || "0",
        name: name.trim(),
        value,
      });
    }
    return { format: "netscape", cookies, header: toHeader(cookies) };
  }

  // Fallback: treat the whole blob as a raw cookie header.
  const cleanedHeader = text.replace(/^\s*Cookie\s*:\s*/i, "").replace(/\s+/g, " ").trim();
  const cookies: ParsedCookie[] = cleanedHeader
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=");
      const name = idx === -1 ? pair : pair.slice(0, idx);
      const value = idx === -1 ? "" : pair.slice(idx + 1);
      return {
        domain: "",
        includeSubdomains: false,
        path: "/",
        secure: true,
        expiry: "0",
        name: name.trim(),
        value: value.trim(),
      };
    })
    .filter((c) => c.name);

  return { format: "header", cookies, header: toHeader(cookies) };
}

function toHeader(cookies: ParsedCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export interface CleanedCookie {
  cleaned: string;
  count: number;
  format: "netscape" | "header" | "empty";
  header: string;
  cookies: ParsedCookie[];
}

/** Normalize arbitrary pasted cookie data into a canonical, storable form. */
export function cleanCookieText(raw: string): CleanedCookie {
  const parsed = parseCookieText(raw);
  if (parsed.format === "empty" || parsed.cookies.length === 0) {
    return { cleaned: "", count: 0, format: "empty", header: "", cookies: [] };
  }

  if (parsed.format === "netscape") {
    const cleanedLines = parsed.cookies.map((c) =>
      [
        c.domain,
        c.includeSubdomains ? "TRUE" : "FALSE",
        c.path,
        c.secure ? "TRUE" : "FALSE",
        c.expiry,
        c.name,
        c.value,
      ].join("\t"),
    );
    return {
      cleaned: cleanedLines.join("\n") + "\n",
      count: parsed.cookies.length,
      format: "netscape",
      header: parsed.header,
      cookies: parsed.cookies,
    };
  }

  return {
    cleaned: parsed.header,
    count: parsed.cookies.length,
    format: "header",
    header: parsed.header,
    cookies: parsed.cookies,
  };
}

export interface CookieVerification {
  ok: boolean;
  status?: number;
  message: string;
  account?: string;
}

function hasCookie(cookies: ParsedCookie[], name: string): boolean {
  return cookies.some((c) => c.name === name && c.value.trim().length > 0);
}

/** Verify a cookie blob against the live platform (does not persist). */
export async function verifyCookies(platform: CookiePlatform, text: string): Promise<CookieVerification> {
  const parsed = parseCookieText(text);
  const { header, cookies } = parsed;
  if (!header) {
    return { ok: false, message: "No cookies found to verify." };
  }

  try {
    if (platform === "linkedin") {
      if (!hasCookie(cookies, "li_at")) {
        return { ok: false, message: "Missing 'li_at' cookie — make sure you copied a logged-in LinkedIn session." };
      }
      const jsession = cookies.find((c) => c.name === "JSESSIONID");
      const csrf = jsession ? jsession.value.replace(/^"|"$/g, "") : "";
      const res = await fetch("https://www.linkedin.com/voyager/api/me", {
        headers: {
          cookie: header,
          accept: "application/json",
          "user-agent": UA,
          ...(csrf ? { "csrf-token": csrf } : {}),
        },
      });
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as any;
        const name =
          json?.miniProfile
            ? `${json.miniProfile.firstName ?? ""} ${json.miniProfile.lastName ?? ""}`.trim()
            : json?.plainId
              ? String(json.plainId)
              : undefined;
        return { ok: true, status: res.status, message: "LinkedIn session is valid.", account: name || undefined };
      }
      if (res.status === 999) {
        return { ok: false, status: res.status, message: "LinkedIn blocked the verification request (HTTP 999). Cookies may still work for search." };
      }
      return { ok: false, status: res.status, message: `LinkedIn returned HTTP ${res.status} — session looks invalid.` };
    }

    if (platform === "reddit") {
      if (!hasCookie(cookies, "reddit_session")) {
        return { ok: false, message: "Missing 'reddit_session' cookie — copy cookies from a logged-in reddit.com session." };
      }
      const res = await fetch("https://www.reddit.com/api/me.json", {
        headers: { cookie: header, accept: "application/json", "user-agent": UA },
      });
      if (!res.ok) {
        return { ok: false, status: res.status, message: `Reddit returned HTTP ${res.status} — session looks invalid.` };
      }
      const json = (await res.json().catch(() => null)) as any;
      const username = json?.data?.name;
      if (username) {
        return { ok: true, status: res.status, message: `Reddit session is valid.`, account: `u/${username}` };
      }
      return { ok: false, status: res.status, message: "Reddit did not recognize the session (not logged in)." };
    }

    if (platform === "facebook") {
      if (!hasCookie(cookies, "c_user") || !hasCookie(cookies, "xs")) {
        return { ok: false, message: "Missing 'c_user'/'xs' cookies — copy cookies from a logged-in facebook.com session." };
      }
      const res = await fetch("https://www.facebook.com/me", {
        headers: { cookie: header, "user-agent": UA, accept: "text/html" },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, status: res.status, message: "Facebook redirected to login — session is invalid." };
      }
      if (res.ok) {
        const html = await res.text().catch(() => "");
        if (/login_form|Log in to Facebook|\/login\?/i.test(html) && !/c_user/.test(html)) {
          return { ok: false, status: res.status, message: "Facebook returned a login page — session is invalid." };
        }
        return { ok: true, status: res.status, message: "Facebook session cookies look valid.", account: `uid: ${cookies.find((c) => c.name === "c_user")?.value}` };
      }
      return { ok: false, status: res.status, message: `Facebook returned HTTP ${res.status}.` };
    }

    return { ok: false, message: `Verification not supported for "${platform}".` };
  } catch (err) {
    return { ok: false, message: `Verification failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Resolution: DB → env → local file ────────────────────────────────────────

export async function getCookieText(platform: CookiePlatform): Promise<string> {
  try {
    const row = await getCookie(platform);
    if (row?.content?.trim()) return row.content;
  } catch {
    // DB unavailable — fall through to env/file
  }

  const env = ENV_MAP[platform];
  if (env?.trim()) return env;

  try {
    return readFileSync(path.resolve(process.cwd(), FILE_MAP[platform]), "utf8");
  } catch {
    return "";
  }
}

export async function getCookieHeader(platform: CookiePlatform): Promise<string> {
  const text = await getCookieText(platform);
  return text ? parseCookieText(text).header : "";
}

export interface CookieStatus {
  platform: CookiePlatform;
  configured: boolean;
  source: "database" | "env" | "file" | "none";
  updated_at: string | null;
  cookieCount: number;
  hasSession: boolean;
}

const SESSION_COOKIE: Record<CookiePlatform, string> = {
  linkedin: "li_at",
  reddit: "reddit_session",
  facebook: "c_user",
};

export async function getCookieStatuses(): Promise<CookieStatus[]> {
  let rows: Array<{ platform: string; content: string; updated_at: string }> = [];
  try {
    rows = await getAllCookies();
  } catch {
    rows = [];
  }
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));

  return Promise.all(
    COOKIE_PLATFORMS.map(async (platform): Promise<CookieStatus> => {
      const row = byPlatform.get(platform);
      let source: CookieStatus["source"] = "none";
      let content = "";
      let updated_at: string | null = null;

      if (row?.content?.trim()) {
        source = "database";
        content = row.content;
        updated_at = row.updated_at || null;
      } else if (ENV_MAP[platform]?.trim()) {
        source = "env";
        content = ENV_MAP[platform]!;
      } else {
        try {
          const fileText = readFileSync(path.resolve(process.cwd(), FILE_MAP[platform]), "utf8");
          if (fileText.trim()) {
            source = "file";
            content = fileText;
          }
        } catch {
          // no local file
        }
      }

      const parsed = content ? parseCookieText(content) : { cookies: [] as ParsedCookie[] };
      return {
        platform,
        configured: Boolean(content.trim()),
        source,
        updated_at,
        cookieCount: parsed.cookies.length,
        hasSession: parsed.cookies.some((c) => c.name === SESSION_COOKIE[platform] && c.value.trim().length > 0),
      };
    }),
  );
}
