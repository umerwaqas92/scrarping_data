// MultiFeed LinkedIn Bridge - Content Script
// Runs automatically inside https://www.linkedin.com/search/results/* tabs

(async function () {
  // Only run on search results pages
  if (!window.location.href.includes("/search/results/")) return;

  console.log("[MultiFeed Content Script] Monitoring search results on LinkedIn...");

  function extractPosts() {
    const posts = [];
    const cards = document.querySelectorAll(
      ".feed-shared-update-v2, div[data-urn*='urn:li:activity'], .search-results-container .artdeco-card, .search-results-container li, div[data-view-name*='search']"
    );

    cards.forEach((card, idx) => {
      const urn = card.getAttribute("data-urn") || `activity_${idx}_${Date.now()}`;
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

      if (content && content.length > 5) {
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

  // Poll for posts up to 4 seconds
  const startTime = Date.now();
  const interval = setInterval(() => {
    const posts = extractPosts();
    if (posts.length > 0 || Date.now() - startTime > 4000) {
      clearInterval(interval);
      console.log(`[MultiFeed Content Script] Extracted ${posts.length} posts. Sending to extension...`);
      chrome.runtime.sendMessage({
        type: "LINKEDIN_DOM_RESULTS",
        url: window.location.href,
        items: posts,
      });
    }
  }, 300);
})();
