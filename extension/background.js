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
