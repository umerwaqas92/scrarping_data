// MultiFeed LinkedIn Bridge - Background Service Worker

let ws = null;
let isConnected = false;
const SERVER_URLS = [
  "ws://localhost:3001/ws",
  "ws://127.0.0.1:3001/ws",
];
let urlIndex = 0;

// Track active tab scraping requests
const activeTabRequests = new Map();

// Connect to local Node.js server
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (ws) {
    try {
      ws.close();
    } catch {
      // Ignore
    }
    ws = null;
  }

  const currentUrl = SERVER_URLS[urlIndex];

  try {
    ws = new WebSocket(currentUrl);

    ws.onopen = () => {
      console.log(`[MultiFeed] ⚡ Auto-connected to local server on ${currentUrl}`);
      isConnected = true;
      urlIndex = 0; // Reset to primary URL on success
      ws.send(JSON.stringify({ type: "EXTENSION_READY", version: "1.0.2" }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[MultiFeed] Received command:", data.type, data.id, data.query);

        if (data.type === "PING") {
          ws.send(JSON.stringify({ id: data.id, type: "PONG" }));
        } else if (data.type === "SEARCH_LINKEDIN") {
          handleSearchRequest(data.id, data.query, data.count || 15);
        } else if (data.type === "SEARCH_FACEBOOK") {
          handleFacebookSearchRequest(data.id, data.query, data.count || 15);
        }
      } catch (err) {
        console.error("[MultiFeed] Error processing message:", err);
      }
    };

    ws.onclose = () => {
      isConnected = false;
      ws = null;
      urlIndex = (urlIndex + 1) % SERVER_URLS.length;
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {
      isConnected = false;
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
      urlIndex = (urlIndex + 1) % SERVER_URLS.length;
      setTimeout(connectWebSocket, 2000);
    };
  } catch (err) {
    isConnected = false;
    ws = null;
    urlIndex = (urlIndex + 1) % SERVER_URLS.length;
    setTimeout(connectWebSocket, 2000);
  }
}

// Start connection immediately
connectWebSocket();

// Periodic heartbeat in active session
setInterval(() => {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  } else {
    // Send lightweight ping to keep connection alive
    try {
      ws.send(JSON.stringify({ type: "PING", timestamp: Date.now() }));
    } catch {}
  }
}, 4000);

// Chrome Manifest V3 Alarm to keep service worker alive & auto-reconnect
chrome.alarms.create("wsHeartbeat", { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "wsHeartbeat") {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      console.log("[MultiFeed] Alarm triggered auto-reconnect check...");
      connectWebSocket();
    }
  }
});

// Auto-reconnect on browser startup & extension install/update
chrome.runtime.onStartup.addListener(() => {
  console.log("[MultiFeed] Browser started, establishing connection...");
  connectWebSocket();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[MultiFeed] Extension installed/updated, connecting...");
  connectWebSocket();
});

// Get LinkedIn CSRF token from active cookies
async function getLinkedInCsrfToken() {
  try {
    const cookie = await chrome.cookies.get({
      url: "https://www.linkedin.com",
      name: "JSESSIONID",
    });
    if (!cookie) return null;
    return cookie.value.replace(/^"|"$/g, "");
  } catch (err) {
    console.error("Failed to read JSESSIONID cookie:", err);
    return null;
  }
}

// Universal extractor for LinkedIn JSON responses
function extractPostsFromJson(json, query) {
  const posts = [];
  const items = json?.included || json?.elements || (Array.isArray(json) ? json : [json]);

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    // Check various commentary & text locations
    const text =
      item.commentary?.text?.text ||
      item.commentary?.text ||
      item.text?.text ||
      item.summary?.text ||
      item.title?.text ||
      item.header?.text?.text ||
      item.value?.commentary?.text?.text ||
      item.value?.text?.text;

    if (!text || typeof text !== "string" || text.trim().length < 5) continue;
    if (posts.some((p) => p.content === text.trim())) continue;

    const actor = item.actor || item.owner || item.value?.actor || item.value?.owner || {};
    const authorName =
      actor.name?.text ||
      actor.title?.text ||
      actor.name ||
      "LinkedIn Member";
    const authorHeadline =
      actor.description?.text ||
      actor.subDescription?.text ||
      actor.subtitle?.text ||
      "";
    const authorPicture =
      actor.image?.attributes?.[0]?.detailData?.nonEntityProfilePicture?.vectorImage?.rootUrl ||
      actor.image?.attributes?.[0]?.detailData?.companyLogo?.vectorImage?.rootUrl ||
      actor.picture?.rootUrl ||
      "";
    const urn =
      item.urn ||
      item.entityUrn ||
      item.updateMetadata?.urn ||
      item.value?.entityUrn ||
      item.value?.urn ||
      `urn:li:activity:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const linkedinUrl = urn.includes("urn:li:activity:")
      ? `https://www.linkedin.com/feed/update/${urn}`
      : actor.navigationUrl || `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;

    const socialDetail = item.socialDetail || item.value?.socialDetail || {};
    const likes =
      socialDetail.totalSocialActivityCounts?.numLikes ||
      socialDetail.numLikes ||
      0;
    const comments =
      socialDetail.totalSocialActivityCounts?.numComments ||
      socialDetail.numComments ||
      0;
    const shares =
      socialDetail.totalSocialActivityCounts?.numShares ||
      socialDetail.numShares ||
      0;

    posts.push({
      id: urn,
      content: text.trim(),
      linkedinUrl,
      authorName,
      authorUrl: actor.navigationUrl || "",
      authorHeadline,
      authorPicture,
      postedAt: new Date().toISOString(),
      likes,
      comments,
      shares,
      createdAt: new Date().toISOString(),
      source: "linkedin",
    });
  }
  return posts;
}

// METHOD 1: Direct Voyager JSON Search (Pure API, ~200ms, 0 Tabs)
async function searchViaVoyager(query, count = 15) {
  const csrfToken = await getLinkedInCsrfToken();
  const endpoints = [
    `https://www.linkedin.com/voyager/api/search/dash/clusters?decorationId=com.linkedin.voyager.dash.deco.search.SearchClusterCollection-185&origin=GLOBAL_SEARCH_HEADER&q=all&query=(keywords:${encodeURIComponent(
      query
    )},flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(CONTENT)),(key:sortBy,value:List(date_posted))))&count=${count}`,
    `https://www.linkedin.com/voyager/api/search/hits?decorationId=com.linkedin.voyager.deco.search.SearchFeedItem-17&count=${count}&filters=List(sortBy-%3Edate_posted)&keywords=${encodeURIComponent(
      query
    )}&origin=GLOBAL_SEARCH_HEADER&q=search&start=0`,
  ];

  for (const url of endpoints) {
    try {
      const headers = {
        accept: "application/vnd.linkedin.normalized+json+2.1, application/json",
        "x-restli-protocol-version": "2.0.0",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
      };
      if (csrfToken) headers["csrf-token"] = csrfToken;

      const res = await fetch(url, { headers, credentials: "include" });
      if (!res.ok) continue;
      const json = await res.json();
      const posts = extractPostsFromJson(json, query);
      if (posts.length > 0) return posts.slice(0, count);
    } catch {}
  }
  return [];
}

// METHOD 2: Direct Search Page HTML Fetch + Embedded Code Blocks (~350ms, 0 Tabs)
async function searchViaDirectFetch(query, count = 15) {
  const csrfToken = await getLinkedInCsrfToken();
  const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(
    query
  )}&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22`;

  const headers = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
  };
  if (csrfToken) headers["csrf-token"] = csrfToken;

  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error(`Fetch status ${res.status}`);

  const html = await res.text();
  const codeBlocks = html.match(/<code[^>]*>([\s\S]*?)<\/code>/gi) || [];
  const allPosts = [];

  for (const block of codeBlocks) {
    const raw = block.replace(/<\/?code[^>]*>/gi, "").trim();
    if (!raw.includes("{") || !raw.includes("}")) continue;
    if (
      !raw.includes("commentary") &&
      !raw.includes("urn:li") &&
      !raw.includes("Update") &&
      !raw.includes("actor") &&
      !raw.includes("text")
    ) {
      continue;
    }

    try {
      const decoded = raw
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'");

      const json = JSON.parse(decoded);
      const posts = extractPostsFromJson(json, query);
      for (const p of posts) {
        if (!allPosts.some((existing) => existing.content === p.content)) {
          allPosts.push(p);
        }
      }
    } catch {}
  }

  return allPosts.slice(0, count);
}

// Master handler: 100% Tabless Pure Lightning Scraping
async function handleSearchRequest(id, query, count) {
  let items = [];
  let errorMsg = null;

  console.log(`[MultiFeed Extension] ⚡ Lightning Tabless Search for: "${query}"...`);

  // Step 1: Direct Voyager API (Pure background JSON, ~200ms)
  try {
    items = await searchViaVoyager(query, count);
    if (items.length > 0) {
      console.log(`[MultiFeed] 🚀 Voyager API returned ${items.length} items in ~200ms (0 tabs opened)!`);
    }
  } catch (err1) {
    console.warn("[Voyager error]:", err1.message);
  }

  // Step 2: Direct HTML Page JSON Parser (~350ms, 0 tabs opened)
  if (!items || items.length === 0) {
    try {
      items = await searchViaDirectFetch(query, count);
      if (items.length > 0) {
        console.log(`[MultiFeed] 🚀 DirectFetch parsed ${items.length} items (0 tabs opened)!`);
      }
    } catch (err2) {
      console.warn("[DirectFetch error]:", err2.message);
      errorMsg = err2 instanceof Error ? err2.message : String(err2);
    }
  }

  // Send back result over WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        id,
        type: "LINKEDIN_RESULTS",
        query,
        count: items.length,
        items: items || [],
        error: errorMsg,
      })
    );
  }
}

// ----------------------------------------------------
// FACEBOOK SCRAPING ENGINE
// ----------------------------------------------------

function cleanFacebookUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete("__cft__[0]");
    u.searchParams.delete("__cft__");
    u.searchParams.delete("__tn__");
    u.searchParams.delete("rdid");
    u.searchParams.delete("refsrc");
    return u.toString();
  } catch {
    return rawUrl.split("?__cft__")[0].split("&__cft__")[0];
  }
}

function resolveFacebookPostUrl(id, rawUrl, authorUrl) {
  if (rawUrl) {
    const cleaned = cleanFacebookUrl(rawUrl);
    if (
      cleaned.includes("/posts/") ||
      cleaned.includes("/permalink") ||
      cleaned.includes("story_fbid=") ||
      cleaned.includes("story.php") ||
      cleaned.includes("/videos/") ||
      cleaned.includes("/reel/") ||
      cleaned.includes("/photo")
    ) {
      return cleaned;
    }
  }

  if (typeof id === "string") {
    try {
      let decoded = id;
      if (id.startsWith("Uzpf") || !id.includes(":")) {
        decoded = atob(id);
      }

      // Pattern: S:_I<authorId>:<storyFbid>... or S:_I<authorId>_<type>_<postId>
      const nums = decoded.match(/\d{9,25}/g);
      if (nums && nums.length >= 2) {
        const authorId = nums[0];
        const postId = nums[1];
        return `https://www.facebook.com/permalink.php?story_fbid=${postId}&id=${authorId}`;
      } else if (nums && nums.length === 1) {
        const postId = nums[0];
        if (authorUrl && !authorUrl.includes("/search/")) {
          const cleanAuthor = authorUrl.replace(/\/$/, "");
          return `${cleanAuthor}/posts/${postId}`;
        }
        return `https://www.facebook.com/permalink.php?story_fbid=${postId}`;
      }
    } catch {}
  }

  return rawUrl || authorUrl || "https://www.facebook.com";
}

function resolveFacebookTimestamp(obj) {
  const t =
    obj.creation_time ||
    obj.publish_time ||
    obj.updated_time ||
    obj.comet_sections?.context_layout?.story?.comet_sections?.metadata?.[0]?.story?.creation_time ||
    obj.story?.creation_time ||
    obj.post?.creation_time;

  if (typeof t === "number" && t > 1000000000) {
    return new Date(t * 1000).toISOString();
  }
  if (typeof t === "string" && !isNaN(Number(t)) && Number(t) > 1000000000) {
    return new Date(Number(t) * 1000).toISOString();
  }

  return new Date().toISOString();
}

async function searchFacebookViaDirectFetch(query, count = 15) {
  const searchUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}`;
  const res = await fetch(searchUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    },
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Facebook fetch returned status ${res.status}`);

  const html = await res.text();
  const posts = [];

  // Match JSON scripts in Facebook HTML
  const scriptRegex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw.includes("message") && !raw.includes("story") && !raw.includes("creation_time") && !raw.includes("comet_sections")) {
      continue;
    }

    try {
      const json = JSON.parse(raw);
      // Recursively search for story/message objects in Relay store
      function findStories(obj) {
        if (!obj || typeof obj !== "object") return;
        if (obj.message?.text && (obj.actors || obj.comet_sections || obj.feedback)) {
          const text = obj.message.text.trim();
          if (text.length > 5 && !posts.some((p) => p.content === text)) {
            const author = obj.actors?.[0] || {};
            const authorName = author.name || "Facebook User";
            const authorUrl = cleanFacebookUrl(author.url || "");
            const authorPicture = author.profile_picture?.uri || "";
            const rawStoryUrl = obj.comet_sections?.content_metadata?.story?.url || obj.url || obj.story?.url || obj.shareable?.url || "";
            const id = obj.id || obj.post_id || `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const storyUrl = resolveFacebookPostUrl(id, rawStoryUrl, authorUrl);
            const postedAt = resolveFacebookTimestamp(obj);

            posts.push({
              id,
              content: text,
              text,
              url: storyUrl,
              pageUrl: authorUrl,
              pageName: authorName,
              authorName,
              authorPicture,
              authorHeadline: "",
              postedAt,
              likes: obj.feedback?.reaction_count?.count || 0,
              comments: obj.feedback?.display_comments_count?.count || 0,
              shares: obj.feedback?.share_count?.count || 0,
              createdAt: postedAt,
              source: "facebook",
            });
          }
        }
        for (const k in obj) {
          if (typeof obj[k] === "object") findStories(obj[k]);
        }
      }
      findStories(json);
    } catch {}
  }

  return posts.slice(0, count);
}

function searchFacebookViaTab(query, count = 15, timeoutMs = 4000) {
  return new Promise(async (resolve) => {
    const searchUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}`;
    let tabId = null;
    let timer = null;

    try {
      const tab = await chrome.tabs.create({ url: searchUrl, active: false });
      tabId = tab.id;

      timer = setTimeout(() => {
        if (tabId) {
          activeTabRequests.delete(tabId);
          chrome.tabs.remove(tabId).catch(() => {});
        }
        resolve([]);
      }, timeoutMs);

      activeTabRequests.set(tabId, {
        resolve: (items) => {
          clearTimeout(timer);
          if (tabId) chrome.tabs.remove(tabId).catch(() => {});
          resolve(items.slice(0, count));
        },
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      resolve([]);
    }
  });
}

// Master handler for Facebook search
async function handleFacebookSearchRequest(id, query, count) {
  let items = [];
  let errorMsg = null;

  console.log(`[MultiFeed Extension] ⚡ Processing Facebook search for: "${query}"...`);

  // Step 1: Direct Fetch & Relay JSON parser (~300ms)
  try {
    items = await searchFacebookViaDirectFetch(query, count);
    if (items.length > 0) {
      console.log(`[MultiFeed FB] 🚀 DirectFetch parsed ${items.length} Facebook posts!`);
    }
  } catch (err1) {
    console.warn("[Facebook DirectFetch error]:", err1.message);
  }

  // Step 2: Tab Fallback with Content Script (~600ms)
  if (!items || items.length === 0) {
    try {
      console.log(`[MultiFeed FB] Opening fast tab for Facebook search...`);
      items = await searchFacebookViaTab(query, count, 4000);
      console.log(`[MultiFeed FB] 🚀 Content Script returned ${items.length} Facebook posts!`);
    } catch (err2) {
      console.warn("[Facebook Tab error]:", err2);
      errorMsg = err2 instanceof Error ? err2.message : String(err2);
    }
  }

  // Send back result over WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        id,
        type: "FACEBOOK_RESULTS",
        query,
        count: items.length,
        items: items || [],
        error: errorMsg,
      })
    );
  }
}

// Listen to content script messages & popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "LINKEDIN_DOM_RESULTS" || request.type === "FACEBOOK_DOM_RESULTS") {
    const tabId = sender.tab?.id;
    if (tabId && activeTabRequests.has(tabId)) {
      const handler = activeTabRequests.get(tabId);
      activeTabRequests.delete(tabId);
      handler.resolve(request.items || []);
    }
  } else if (request.type === "GET_STATUS") {
    sendResponse({ isConnected });
  } else if (request.type === "RECONNECT") {
    connectWebSocket();
    sendResponse({ isConnected });
  }
  return true;
});
