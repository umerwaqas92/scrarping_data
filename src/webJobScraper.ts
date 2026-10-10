import { execFile } from "child_process";
import { promisify } from "util";
import { URL } from "url";
import { LinkedinPost } from "./linkedinClient.js";

const execFileAsync = promisify(execFile);

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function decodeHtmlEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return "";
      }
    });
}

function htmlToFormattedText(html: string): string {
  if (!html) return "";

  let text = html;

  // Remove scripts, styles, noscript, svg, iframes, and forms
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "");
  text = text.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  text = text.replace(/<form[\s\S]*?<\/form>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // Headings to Markdown style
  text = text.replace(/<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi, "\n\n## $1\n\n");
  text = text.replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, "\n\n### $1\n\n");

  // List items to bullets
  text = text.replace(/<li[^>]*>/gi, "\n• ");
  text = text.replace(/<\/li>/gi, "");

  // Line breaks & paragraphs
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/td>/gi, "  ");

  // Strip all other HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode entities
  text = decodeHtmlEntities(text);

  // Clean excessive whitespace and blank lines
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

export async function fetchWebJobPost(targetUrl: string): Promise<LinkedinPost> {
  let urlStr = targetUrl.trim();
  if (!/^https?:\/\//i.test(urlStr)) {
    urlStr = "https://" + urlStr;
  }

  const parsedUrl = new URL(urlStr);
  const hostname = parsedUrl.hostname.replace(/^www\./i, "");

  let html = "";

  // 1. Primary: curl execution
  try {
    const curlArgs = [
      "-s",
      "-L",
      "--max-time",
      "15",
      "-A",
      USER_AGENT,
      "-H",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "-H",
      "Accept-Language: en-US,en;q=0.9",
      urlStr,
    ];

    const { stdout } = await execFileAsync("curl", curlArgs, { timeout: 15000 });
    if (stdout && stdout.length > 200) {
      html = stdout;
    }
  } catch (err) {
    console.warn(`[WebJobScraper] curl failed for ${urlStr}:`, err instanceof Error ? err.message : String(err));
  }

  // 2. Secondary: Node fetch
  if (!html || html.length < 200) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(urlStr, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        html = await res.text();
      }
    } catch (err) {
      console.warn(`[WebJobScraper] fetch failed for ${urlStr}:`, err instanceof Error ? err.message : String(err));
    }
  }

  if (!html || html.length < 100) {
    throw new Error(`Unable to fetch webpage content from ${urlStr}. Make sure the URL is accessible.`);
  }

  // ── Parse Extracted HTML ──────────────────────────────────────────────────
  let jobTitle = "";
  let companyName = "";
  let location = "";
  let jobContent = "";
  let authorPicture = "";
  let postedAt = "";

  // 1. Check for schema.org JobPosting in JSON-LD
  const ldMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed)
        ? parsed
        : parsed?.["@graph"] && Array.isArray(parsed["@graph"])
        ? parsed["@graph"]
        : [parsed];

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const type = String(item["@type"] || "").toLowerCase();
        if (type.includes("jobposting") || item.hiringOrganization || item.jobLocation) {
          if (item.title && typeof item.title === "string") {
            jobTitle = item.title;
          }
          if (item.hiringOrganization) {
            companyName =
              typeof item.hiringOrganization === "string"
                ? item.hiringOrganization
                : item.hiringOrganization.name || companyName;
          }
          if (item.jobLocation) {
            const loc = item.jobLocation;
            if (typeof loc === "string") {
              location = loc;
            } else if (loc.address) {
              const addr = loc.address;
              location =
                typeof addr === "string"
                  ? addr
                  : [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ");
            }
          }
          if (item.datePosted && typeof item.datePosted === "string") {
            postedAt = item.datePosted;
          }
          if (item.description && typeof item.description === "string") {
            jobContent = htmlToFormattedText(item.description);
          }
          break;
        }
      }
      if (jobTitle && jobContent) break;
    } catch {}
  }

  // 2. OpenGraph & Meta Tags Fallbacks
  const ogTitleMatch =
    html.match(/<meta property="og:title" content="([^"]+)"/i) ||
    html.match(/<meta name="twitter:title" content="([^"]+)"/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  if (!jobTitle && ogTitleMatch) {
    jobTitle = decodeHtmlEntities(ogTitleMatch[1])
      .replace(/\s*\|\s*[^|]+$/g, "")
      .replace(/\s*–\s*[^–]+$/g, (match, offset, str) => {
        // Keep if it looks like city/location or role, strip if it's the site name
        return match.toLowerCase().includes(hostname.split(".")[0]) ? "" : match;
      })
      .trim();
  }

  // First <h1> as alternative title
  if (!jobTitle) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      jobTitle = decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, "")).trim();
    }
  }

  const ogDescMatch =
    html.match(/<meta (?:property="og:description"|name="description"|name="twitter:description") content="([^"]+)"/i);
  const metaDescription = ogDescMatch ? decodeHtmlEntities(ogDescMatch[1]).trim() : "";

  const ogImageMatch =
    html.match(/<meta property="og:image" content="([^"]+)"/i) ||
    html.match(/<meta name="twitter:image" content="([^"]+)"/i);
  if (ogImageMatch) {
    authorPicture = ogImageMatch[1].trim();
  } else {
    authorPicture = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
  }

  // 3. Extract Main Article / Job Content from HTML DOM if not found in JSON-LD
  if (!jobContent || jobContent.length < 150) {
    const containerPatterns = [
      /<div[^>]*class="[^"]*(?:entry-content|job-description|jobDescription|job_description|job-details|post-content|posting-requirements|content-area)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<article[^>]*>([\s\S]*?)<\/article>/i,
      /<div[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i,
      /<section[^>]*class="[^"]*(?:job-details|description|posting)[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
      /<main[^>]*>([\s\S]*?)<\/main>/i,
    ];

    for (const pat of containerPatterns) {
      const match = html.match(pat);
      if (match && match[1] && match[1].length > 200) {
        const parsedText = htmlToFormattedText(match[1]);
        if (parsedText.length > jobContent.length) {
          jobContent = parsedText;
        }
      }
    }
  }

  // Fallback to full body if container not found
  if (!jobContent || jobContent.length < 100) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      jobContent = htmlToFormattedText(bodyMatch[1]);
    }
  }

  // If still empty, use meta description
  if (!jobContent || jobContent.length < 50) {
    jobContent = metaDescription || `Job opening at ${hostname}`;
  }

  // 4. Extract Company Name if missing
  if (!companyName) {
    const companyMatch =
      jobContent.match(/(?:Company|Employer|Organization|Hiring Company)\s*[:–-]\s*([^\n\r•|]+)/i) ||
      metaDescription.match(/(?:Company|Employer|Organization|Hiring Company)\s*[:–-]\s*([^\n\r•|]+)/i);
    if (companyMatch) {
      companyName = companyMatch[1].trim();
    }
  }

  if (!companyName) {
    const siteNameMatch =
      html.match(/<meta property="og:site_name" content="([^"]+)"/i) ||
      html.match(/<meta name="application-name" content="([^"]+)"/i);
    if (siteNameMatch) {
      companyName = decodeHtmlEntities(siteNameMatch[1]).trim();
    }
  }

  if (!companyName) {
    // Capitalize domain name as fallback e.g. jobbery.in -> Jobbery
    const brand = hostname.split(".")[0];
    companyName = brand.charAt(0).toUpperCase() + brand.slice(1);
  }

  // 5. Extract Location if missing
  if (!location) {
    const locMatch =
      jobContent.match(/(?:Location|Place|City|Office)\s*[:–-]\s*([^\n\r•|]+)/i) ||
      metaDescription.match(/(?:Location|Place|City|Office)\s*[:–-]\s*([^\n\r•|]+)/i);
    if (locMatch) {
      location = locMatch[1].trim();
    }
  }

  // Clean Job Title
  if (!jobTitle) {
    jobTitle = `Software Role at ${companyName}`;
  }

  // Format content banner for proposal generation
  const headerPrefix = [
    `🏢 Company: ${companyName}`,
    location ? `📍 Location: ${location}` : "",
    `🔗 Job URL: ${urlStr}`,
  ]
    .filter(Boolean)
    .join("\n");

  const fullContent = `${headerPrefix}\n\n${jobContent}`.trim();

  const id = `web_${Buffer.from(urlStr).toString("base64").replace(/[+/=]/g, "").slice(0, 24)}`;
  const finalPostedAt = postedAt || new Date().toISOString();

  return {
    id,
    content: fullContent,
    linkedinUrl: urlStr,
    authorName: companyName,
    authorUrl: urlStr,
    authorHeadline: jobTitle,
    authorPicture,
    postedAt: finalPostedAt,
    likes: 0,
    comments: 0,
    shares: 0,
    createdAt: finalPostedAt,
    source: "linkedin", // Seamless compatibility with feed & AI proposal generation
  };
}
