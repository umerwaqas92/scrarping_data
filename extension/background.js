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

// STRATEGY 1: Direct Fetch & Embedded JSON (Fastest, ~500ms)
async function searchViaDirectFetch(query, count = 15) {
  const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(
    query
  )}&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22`;

  const res = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    },
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Fetch status ${res.status}`);

  const html = await res.text();
  const posts = [];

  const codeBlocks = html.match(/<code[^>]*>([\s\S]*?)<\/code>/gi) || [];
  for (const block of codeBlocks) {
    const rawContent = block.replace(/<\/?code[^>]*>/gi, "").trim();
    if (!rawContent.includes("commentary") && !rawContent.includes("urn:li:activity") && !rawContent.includes("Update")) {
      continue;
    }

    try {
      const decoded = rawContent
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'");

      const json = JSON.parse(decoded);
      const items = json?.included || json?.elements || (Array.isArray(json) ? json : [json]);

      for (const item of items) {
        const text = item.commentary?.text?.text || item.text?.text;
        if (!text || posts.some((p) => p.content === text)) continue;

        const actor = item.actor || {};
        const authorName = actor.name?.text || "LinkedIn Member";
        const authorHeadline = actor.description?.text || "";
        const authorPicture =
          actor.image?.attributes?.[0]?.detailData?.nonEntityProfilePicture?.vectorImage?.rootUrl ||
          actor.image?.attributes?.[0]?.detailData?.companyLogo?.vectorImage?.rootUrl ||
          "";
        const urn = item.urn || item.entityUrn || `urn:li:activity:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const linkedinUrl = urn.includes("urn:li:activity:")
          ? `https://www.linkedin.com/feed/update/${urn}`
          : actor.navigationUrl || `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;

        const socialDetail = item.socialDetail || {};
        const likes = socialDetail.totalSocialActivityCounts?.numLikes || 0;
        const comments = socialDetail.totalSocialActivityCounts?.numComments || 0;
        const shares = socialDetail.totalSocialActivityCounts?.numShares || 0;

        posts.push({
          id: urn,
          content: text,
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
    } catch {
      // Continue next block
    }
  }

  return posts.slice(0, count);
}

// STRATEGY 2: Tab Scraper with Content Script Callback
function searchViaTabWithContentScript(query, count = 15, timeoutMs = 6000) {
  return new Promise(async (resolve, reject) => {
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(
      query
    )}&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22`;

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
        resolve([]); // Resolve with empty array so server falls back gracefully
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

// Master handler
async function handleSearchRequest(id, query, count) {
  let items = [];
  let errorMsg = null;

  console.log(`[MultiFeed Extension] Processing search for: "${query}"...`);

  // Try Strategy 1: Direct Fetch
  try {
    items = await searchViaDirectFetch(query, count);
    console.log(`[Strategy 1: DirectFetch] Got ${items.length} items`);
  } catch (err1) {
    console.warn(`[Strategy 1 error]:`, err1.message);
  }

  // Try Strategy 2: Tab with Content Script
  if (!items || items.length === 0) {
    try {
      console.log(`[Strategy 2: Content Script Tab] for "${query}"...`);
      items = await searchViaTabWithContentScript(query, count, 5500);
      console.log(`[Strategy 2: Content Script] Got ${items.length} items`);
    } catch (err2) {
      console.warn(`[Strategy 2 error]:`, err2);
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

// Listen to content script messages & popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "LINKEDIN_DOM_RESULTS") {
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
