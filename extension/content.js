// MultiFeed Bridge - Content Script (LinkedIn + Facebook)
// Runs inside https://www.linkedin.com/search/* and https://www.facebook.com/search/*

(function () {
  const isLinkedIn = window.location.hostname.includes("linkedin.com");
  const isFacebook = window.location.hostname.includes("facebook.com");

  if (!isLinkedIn && !isFacebook) return;

  console.log(`[MultiFeed Content Script] ⚡ Observer started for ${isLinkedIn ? "LinkedIn" : "Facebook"}...`);

  let hasSent = false;

  function extractLinkedInPosts() {
    const posts = [];
    const cards = document.querySelectorAll(
      ".feed-shared-update-v2, div[data-urn*='urn:li:activity'], .search-results-container .artdeco-card, .search-results-container li, div[data-view-name*='search'], div[data-chameleon-result-urn]"
    );

    cards.forEach((card, idx) => {
      const urn = card.getAttribute("data-urn") || card.getAttribute("data-chameleon-result-urn") || `activity_${idx}_${Date.now()}`;
      const actorElem =
        card.querySelector(".update-components-actor__title span[aria-hidden='true']") ||
        card.querySelector(".update-components-actor__name span span") ||
        card.querySelector(".update-components-actor__name") ||
        card.querySelector(".feed-shared-actor__name") ||
        card.querySelector(".app-aware-link span[aria-hidden='true']");
      const authorName = actorElem?.textContent?.trim() || "LinkedIn Member";

      const subElem =
        card.querySelector(".update-components-actor__description span[aria-hidden='true']") ||
        card.querySelector(".update-components-actor__sub-description") ||
        card.querySelector(".feed-shared-actor__description") ||
        card.querySelector(".entity-result__primary-subtitle");
      const authorHeadline = subElem?.textContent?.trim() || "";

      const imgElem = card.querySelector(
        ".update-components-actor__avatar img, .feed-shared-actor__avatar img, img.presence-entity__image"
      );
      const authorPicture = imgElem?.src || "";

      const textElem =
        card.querySelector(".update-components-text") ||
        card.querySelector(".feed-shared-update-v2__description") ||
        card.querySelector(".feed-shared-inline-show-more-text") ||
        card.querySelector(".feed-shared-text-view") ||
        card.querySelector(".entity-result__summary");
      const content = textElem?.innerText?.trim() || "";

      const linkElem = card.querySelector("a[href*='/feed/update/'], a.app-aware-link[href*='linkedin.com/posts']");
      const linkedinUrl =
        linkElem?.href ||
        (urn.includes("urn:li:activity:")
          ? `https://www.linkedin.com/feed/update/${urn}`
          : window.location.href);

      if (content && content.length > 5 && !posts.some((p) => p.content === content)) {
        posts.push({
          id: urn,
          content,
          linkedinUrl,
          authorName,
          authorUrl: "",
          authorHeadline,
          authorPicture,
          postedAt: new Date().toISOString(),
          likes: 0,
          comments: 0,
          shares: 0,
          createdAt: new Date().toISOString(),
          source: "linkedin",
        });
      }
    });

    return posts;
  }

  function extractFacebookPosts() {
    const posts = [];
    const cards = document.querySelectorAll(
      "div[role='feed'] > div, div[role='article'], div[data-ad-preview='message']"
    );

    cards.forEach((card, idx) => {
      // Author
      const actorElem =
        card.querySelector("h2 a, h3 a, strong span, a[role='link'] strong, a.x1i10hfl strong");
      const authorName = actorElem?.textContent?.trim() || "Facebook User";
      const authorUrl = (actorElem?.closest("a") || card.querySelector("a[role='link']"))?.href || "";

      // Author image
      const imgElem = card.querySelector("image, img.x1rg5ohu, img[alt*='profile'], img.x1b0d499");
      const authorPicture = imgElem?.src || imgElem?.getAttribute("xlink:href") || "";

      // Post text
      const textElem =
        card.querySelector("div[dir='auto'][style*='text-align'], div[data-ad-comet-preview='message'], div[data-ad-preview='message'], div.xdj266r.x11i5rnm");
      const content = textElem?.innerText?.trim() || "";

      // Post link
      const linkElem = card.querySelector(
        "a[href*='/posts/'], a[href*='/permalink/'], a[href*='/groups/'], a[href*='facebook.com/story.php']"
      );
      const url = linkElem?.href || authorUrl || window.location.href;
      const id = `fb_${idx}_${Date.now()}`;

      if (content && content.length > 5 && !posts.some((p) => p.text === content || p.content === content)) {
        posts.push({
          id,
          content,
          text: content,
          url,
          pageUrl: authorUrl,
          pageName: authorName,
          authorName,
          authorPicture,
          authorHeadline: "",
          postedAt: new Date().toISOString(),
          likes: 0,
          comments: 0,
          shares: 0,
          createdAt: new Date().toISOString(),
          source: "facebook",
        });
      }
    });

    return posts;
  }

  function sendResults(posts) {
    if (hasSent || posts.length === 0) return;
    hasSent = true;
    const msgType = isLinkedIn ? "LINKEDIN_DOM_RESULTS" : "FACEBOOK_DOM_RESULTS";
    console.log(`[MultiFeed Content Script] 🚀 Sent ${posts.length} ${isLinkedIn ? "LinkedIn" : "Facebook"} posts!`);
    chrome.runtime.sendMessage({
      type: msgType,
      url: window.location.href,
      items: posts,
    });
  }

  const extractor = isLinkedIn ? extractLinkedInPosts : extractFacebookPosts;

  // 1. Immediate check
  const initial = extractor();
  if (initial.length >= 2) {
    sendResults(initial);
    return;
  }

  // 2. MutationObserver
  const observer = new MutationObserver(() => {
    const posts = extractor();
    if (posts.length >= 2) {
      observer.disconnect();
      sendResults(posts);
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // 3. Fallback timer
  let checks = 0;
  const timer = setInterval(() => {
    checks++;
    window.scrollBy(0, 300);
    const posts = extractor();
    if (posts.length > 0 || checks > 15) {
      clearInterval(timer);
      observer.disconnect();
      sendResults(posts);
    }
  }, 150);
})();
