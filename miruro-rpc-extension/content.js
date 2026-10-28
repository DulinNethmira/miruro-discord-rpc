/**
 * Miruro Discord Rich Presence — Content Script
 * Runs in the top-level Miruro page (*://*.miruro.tv/*, *://*.miruro.cx/*, *://*.miruro.online/*)
 * Tracks SPA navigation, scrapes metadata/covers, listens to video playback, and sends Discord activity.
 */

(function () {
  // Only execute in top-level window
  if (window !== window.top) return;

  const LOGO = "https://cdn.jsdelivr.net/gh/D4rkov/Miruro-RPC@main/assets/icon.png";
  const PLAY_ICON = "https://cdn.rcd.gg/PreMiD/resources/play.png";
  const PAUSE_ICON = "https://cdn.rcd.gg/PreMiD/resources/pause.png";
  const browsingTimestamp = Math.floor(Date.now() / 1000);

  const coverCache = {};
  const titleCache = {};
  const pendingFetches = new Set();
  let videoData = { currentTime: 0, duration: 0, paused: true };
  let boundMainVideo = null;
  let updateCounter = 0;

  /* ── Settings Reader ───────────────────────────────────── */
  async function getSettings() {
    try {
      const res = await chrome.storage.local.get([
        "miruro_enabled",
        "miruro_browsing",
        "miruro_timestamps",
        "miruro_cover",
        "miruro_buttons",
        "enabled",
        "browsing",
        "timestamps",
        "cover",
        "buttons",
        "discordUserId",
        "discordAppId"
      ]);
      return {
        enabled: res.miruro_enabled !== undefined ? res.miruro_enabled : (res.enabled !== false),
        browsing: res.miruro_browsing !== undefined ? res.miruro_browsing : (res.browsing !== false),
        timestamps: res.miruro_timestamps !== undefined ? res.miruro_timestamps : (res.timestamps !== false),
        cover: res.miruro_cover !== undefined ? res.miruro_cover : (res.cover !== false),
        buttons: res.miruro_buttons !== undefined ? res.miruro_buttons : (res.buttons !== false),
        discordUserId: res.discordUserId ? String(res.discordUserId).trim() : null,
        discordAppId: res.discordAppId ? String(res.discordAppId).trim() : null
      };
    } catch (_) {
      return {
        enabled: true,
        browsing: true,
        timestamps: true,
        cover: true,
        buttons: true,
        discordUserId: null,
        discordAppId: null
      };
    }
  }

  /* ── Extract AniList ID from URL ───────────────────────── */
  function getAniListId() {
    const { pathname, search, href } = document.location;

    // 1. Path match: /watch/156092/... or /info/156092/...
    const pathMatch = pathname.match(/\/(?:watch|info|anime)\/(\d+)/i);
    if (pathMatch) return pathMatch[1];

    // 2. Query param: ?id=156092, ?anilistId=156092
    const params = new URLSearchParams(search);
    const idParam = params.get("id") || params.get("anilistId") || params.get("mediaId");
    if (idParam && /^\d+$/.test(idParam)) return idParam;

    // 3. Fallback check on href
    const hrefMatch = href.match(/[?&](?:id|anilistId|mediaId)=(\d+)/i);
    if (hrefMatch) return hrefMatch[1];

    // 4. Standalone numeric segment
    const segmentMatch = pathname.match(/(?:^|\/)(\d{2,8})(?:\/|$)/);
    if (segmentMatch) return segmentMatch[1];

    return null;
  }

  /* ── Clean Anime Title ─────────────────────────────────── */
  function cleanTitle(str) {
    if (!str) return "";
    let clean = str.trim();

    // Strip site suffixes: " - Miruro", " · Miruro", " — Miruro", " | Miruro", " / Miruro", etc.
    clean = clean.replace(/\s*[-–—·|/]\s*Miruro(?:\.tv|\.cx|\.online)?.*$/i, "").trim();

    // Strip leading "Watch " or "Watching "
    clean = clean.replace(/^(?:Watch(?:ing)?)\s+/i, "").trim();

    // Strip trailing episode markers if present
    clean = clean.replace(/\s+(?:[-–—·|]\s*)?(?:Episode|Ep\.?)\s*\d+.*$/i, "").trim();

    return clean;
  }

  /* ── Extract Anime Title from Document ─────────────────── */
  function getAnimeTitleFromDocument() {
    const anilistId = getAniListId();

    // 1. Official AniList title from API
    if (anilistId && titleCache[anilistId]) {
      return titleCache[anilistId];
    }

    // 2. Cleaned document.title (Miruro updates document.title to "[Anime Title] - Miruro")
    const cleanedDocTitle = cleanTitle(document.title || "");
    if (
      cleanedDocTitle &&
      cleanedDocTitle.toLowerCase() !== "miruro" &&
      !cleanedDocTitle.toLowerCase().includes("free anime streaming") &&
      !cleanedDocTitle.toLowerCase().includes("stream sub & dub")
    ) {
      return cleanedDocTitle.length > 128 ? cleanedDocTitle.slice(0, 125) + "..." : cleanedDocTitle;
    }

    // 3. Primary heading (h1)
    const h1 = document.querySelector("h1");
    if (h1) {
      const clone = h1.cloneNode(true);
      clone.querySelectorAll("span, p, div, small, button, badge, a").forEach((el) => el.remove());
      const cleanedH1 = cleanTitle(clone.textContent || h1.textContent);
      if (
        cleanedH1 &&
        cleanedH1.toLowerCase() !== "miruro" &&
        !cleanedH1.toLowerCase().includes("free anime streaming") &&
        !cleanedH1.toLowerCase().includes("stream sub & dub")
      ) {
        return cleanedH1.length > 128 ? cleanedH1.slice(0, 125) + "..." : cleanedH1;
      }
    }

    // 4. Breadcrumb link on /watch linking to /info
    const infoLink = document.querySelector('a[href*="/info/"]');
    if (infoLink && infoLink.textContent) {
      const text = cleanTitle(infoLink.textContent);
      if (
        text &&
        text.toLowerCase() !== "miruro" &&
        !text.toLowerCase().includes("home")
      ) {
        return text.length > 128 ? text.slice(0, 125) + "..." : text;
      }
    }

    // 5. Fallback: Parse title from URL slug (e.g. /info/ID/title-slug or /watch/ID/title-slug)
    const pathParts = document.location.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && !/^\d+$/.test(lastPart) && !lastPart.startsWith("ep-") && !lastPart.startsWith("watch")) {
      const slugTitle = lastPart
        .replace(/-+/g, " ")
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
        .trim();
      if (slugTitle && slugTitle.length > 2 && slugTitle.toLowerCase() !== "miruro") {
        return slugTitle.length > 128 ? slugTitle.slice(0, 125) + "..." : slugTitle;
      }
    }

    return "Anime";
  }

  /* ── Extract Episode Number ────────────────────────────── */
  function getEpisodeNumber() {
    const { pathname, search } = document.location;
    const params = new URLSearchParams(search);
    const epParam = params.get("ep") || params.get("episode");
    if (epParam) return epParam;

    const pathParts = pathname.split("/").filter(Boolean);
    if (pathParts.length >= 3 && pathParts[0] === "watch") {
      const last = pathParts[pathParts.length - 1];
      const epMatch = last.match(/^(?:ep(?:isode)?-?)?(\d+)$/i);
      if (epMatch) return epMatch[1];
    }

    const activeCard = document.querySelector(
      '[class*="ring-primary"], [class*="bg-primary"], [aria-current="true"], [class*="active"]'
    );
    if (activeCard) {
      const text = activeCard.textContent || "";
      const domEpMatch = text.match(/(?:Episode|Ep\.?)\s*(\d+)/i);
      if (domEpMatch) return domEpMatch[1];
    }

    return null;
  }

  /* ── Extract Episode Title ─────────────────────────────── */
  function getEpisodeTitle() {
    const activeCard = document.querySelector(
      '[class*="ring-primary"], [class*="bg-primary"], [aria-current="true"], [class*="active"]'
    );
    if (activeCard) {
      const titleEl = activeCard.querySelector(
        '[class*="font-bold"], [class*="font-semibold"], [class*="line-clamp"], [class*="title"], h3, h4, span'
      );
      if (titleEl && titleEl.textContent) {
        const text = titleEl.textContent.trim();
        if (text && !/^(?:ep(?:isode)?\s*)?\d+$/i.test(text)) {
          return text;
        }
      }
    }
    return null;
  }

  /* ── URL Validator ─────────────────────────────────────── */
  function isAnimeCoverUrl(url) {
    if (!url || typeof url !== "string" || !url.startsWith("http")) return false;
    const lower = url.toLowerCase();

    // Reject logos, favicons, avatars, banners, screenshots, and episode thumbnails
    if (
      lower.includes("logo") ||
      lower.includes("favicon") ||
      lower.includes("icon") ||
      lower.includes("avatar") ||
      lower.includes("ssj.png") ||
      lower.includes("episode") ||
      lower.includes("episodes") ||
      lower.includes("thumb") ||
      lower.includes("screenshot") ||
      lower.includes("banner") ||
      lower.includes("backdrop")
    ) {
      return false;
    }

    return true;
  }

  /* ── Smart Cover-Art Scraping with AniList Fallback ────── */
  function getCoverArt() {
    const key = document.location.pathname;
    const anilistId = getAniListId();

    // 1. Memory cache check
    if (anilistId && coverCache[anilistId]) return coverCache[anilistId];
    if (coverCache[key]) return coverCache[key];

    // 2. Fetch official extraLarge cover directly from AniList GraphQL
    if (anilistId) {
      fetchAniListMedia(anilistId, key);
    }

    // 3. Scrape ONLY genuine anime poster images in the DOM
    const validCoverSelectors = [
      'img[src*="/anime/cover/"]',
      'img[src*="anilist.co/file/anilistcdn/media/anime/cover"]',
      'img[src*="myanimelist.net/images/anime/"]'
    ];

    for (const sel of validCoverSelectors) {
      const imgs = document.querySelectorAll(sel);
      for (const img of imgs) {
        let src = img.currentSrc || img.src || img.getAttribute("src");
        if (!src) continue;

        if (src.includes("url=")) {
          try {
            const u = new URL(src, window.location.origin);
            const rawUrl = u.searchParams.get("url");
            if (rawUrl && rawUrl.startsWith("http")) src = rawUrl;
          } catch (_) {}
        }

        if (isAnimeCoverUrl(src)) {
          if (anilistId) coverCache[anilistId] = src;
          coverCache[key] = src;
          return src;
        }
      }
    }

    // 4. On /info page, check the main poster element
    if (document.location.pathname.startsWith("/info")) {
      const posterImg = document.querySelector('[class*="poster"] img, [data-testid*="poster"] img');
      if (posterImg) {
        let src = posterImg.currentSrc || posterImg.src || posterImg.getAttribute("src");
        if (src && isAnimeCoverUrl(src)) {
          if (anilistId) coverCache[anilistId] = src;
          coverCache[key] = src;
          return src;
        }
      }
    }

    return LOGO;
  }

  /* ── Fetch official Cover & Title from AniList GraphQL ─── */
  async function fetchAniListMedia(id, cacheKey) {
    if (!id || pendingFetches.has(id)) return;
    pendingFetches.add(id);

    try {
      const resp = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          query: `
            query ($id: Int) {
              Media(id: $id) {
                title {
                  english
                  romaji
                  userPreferred
                }
                coverImage {
                  extraLarge
                  large
                }
              }
            }
          `,
          variables: { id: parseInt(id, 10) }
        })
      });

      const json = await resp.json();
      const media = json?.data?.Media;
      const cover = media?.coverImage?.extraLarge || media?.coverImage?.large;
      const title = media?.title?.english || media?.title?.romaji || media?.title?.userPreferred;

      let updated = false;
      if (cover) {
        coverCache[cacheKey] = cover;
        coverCache[id] = cover;
        updated = true;
      }
      if (title) {
        titleCache[id] = title;
        updated = true;
      }

      if (updated) {
        updatePresence();
      }
    } catch (_) {
      // Fail safely
    } finally {
      pendingFetches.delete(id);
    }
  }

  /* ── Timestamps Calculation ────────────────────────────── */
  function calculateTimestamps(currentTime, duration) {
    const now = Math.floor(Date.now() / 1000);
    return {
      start: now - Math.floor(currentTime),
      end: now + Math.floor(duration - currentTime)
    };
  }

  /* ═══════════════════════════════════════════════════════
   *  CORE: updatePresence()
   * ═══════════════════════════════════════════════════════ */
  async function updatePresence() {
    const currentUpdate = ++updateCounter;

    const { pathname, search, href } = document.location;
    const settings = await getSettings();

    if (!settings.enabled) {
      chrome.runtime.sendMessage({ type: "MIRURO_CLEAR_PRESENCE" }).catch(() => {});
      return;
    }

    if (currentUpdate !== updateCounter) return;

    // Discord RPC Activity Object
    const activity = {
      name: "Miruro",
      type: 3, // ActivityType.Watching
      status_display_type: 2,
      assets: {
        large_image: LOGO,
        large_text: "Miruro"
      },
      timestamps: {
        start: browsingTimestamp
      }
    };

    /* ── /watch — Active Anime Playback ─────────────────── */
    if (pathname.startsWith("/watch")) {
      const animeTitle = getAnimeTitleFromDocument();
      const episodeNum = getEpisodeNumber();
      const episodeTitle = getEpisodeTitle();
      const coverArt = getCoverArt();

      // Dynamic Activity Header Title ("Watching [Anime Title]")
      activity.name = animeTitle;
      activity.details = animeTitle;

      if (episodeNum) {
        activity.state = episodeTitle
          ? `Episode ${episodeNum} - ${episodeTitle}`
          : `Episode ${episodeNum}`;
      } else {
        activity.state = episodeTitle || "Watching Episode";
      }

      if (settings.cover && coverArt) {
        activity.assets.large_image = coverArt;
        activity.assets.large_text = animeTitle;
      }

      // Check direct page video or iframe bridge data
      const directVideo = document.querySelector("video");
      if (directVideo && directVideo !== boundMainVideo) {
        bindMainVideoListeners(directVideo);
      }

      const activeVideo =
        directVideo && !isNaN(directVideo.duration) && directVideo.duration > 0
          ? {
              currentTime: directVideo.currentTime,
              duration: directVideo.duration,
              paused: directVideo.paused
            }
          : videoData;

      // Play & Pause sub-icons and timestamps
      if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
        // Playing
        if (settings.timestamps) {
          activity.timestamps = calculateTimestamps(
            activeVideo.currentTime,
            activeVideo.duration
          );
        } else {
          delete activity.timestamps;
        }
        activity.assets.small_image = PLAY_ICON;
        activity.assets.small_text = "Playing";
      } else if (activeVideo && activeVideo.paused) {
        // Paused: immediately delete timestamps
        delete activity.timestamps;
        activity.assets.small_image = PAUSE_ICON;
        activity.assets.small_text = "Paused";
      }

      if (settings.buttons) {
        activity.buttons = [{ label: "Watch Episode", url: href }];
        if (settings.discordUserId && /^\d{17,21}$/.test(settings.discordUserId)) {
          activity.buttons.push({
            label: "Discord Profile",
            url: `https://discord.com/users/${settings.discordUserId}`
          });
        }
      }

    /* ── /info — Anime Details Page ─────────────────────── */
    } else if (pathname.startsWith("/info")) {
      activity.name = "Miruro";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "MIRURO_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }

      const animeTitle = getAnimeTitleFromDocument();
      const coverArt = getCoverArt();

      activity.details = animeTitle || "Viewing Anime";
      activity.state = "Viewing Anime Details";

      if (settings.cover && coverArt) {
        activity.assets.large_image = coverArt;
        activity.assets.large_text = animeTitle;
      }
      if (settings.buttons) {
        activity.buttons = [{ label: "View on Miruro", url: href }];
        if (settings.discordUserId && /^\d{17,21}$/.test(settings.discordUserId)) {
          activity.buttons.push({
            label: "Discord Profile",
            url: `https://discord.com/users/${settings.discordUserId}`
          });
        }
      }

    /* ── /search — Search Page ──────────────────────────── */
    } else if (pathname.startsWith("/search")) {
      activity.name = "Miruro";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "MIRURO_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }

      const query =
        new URLSearchParams(search).get("q") ||
        new URLSearchParams(search).get("query");
      activity.details = "Searching...";
      activity.state = query ? `"${query}"` : "Browsing search";

    /* ── General Browsing Pages ─────────────────────────── */
    } else {
      activity.name = "Miruro";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "MIRURO_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }

      activity.details = "Browsing Miruro...";

      if (pathname === "/" || pathname === "") {
        activity.state = "Home";
      } else if (pathname.startsWith("/trending")) {
        activity.state = "Trending";
      } else if (pathname.startsWith("/discover")) {
        activity.state = "Discover";
      } else if (pathname.startsWith("/schedule")) {
        activity.state = "Schedule";
      } else if (pathname.startsWith("/history")) {
        activity.state = "Watch History";
      } else if (pathname.startsWith("/bookmarks")) {
        activity.state = "Bookmarks";
      } else if (pathname.startsWith("/settings")) {
        activity.state = "Settings";
      } else {
        activity.state = "Exploring Catalog";
      }
    }

    // Send payload to background.js -> offscreen.js -> Discord RPC
    if (currentUpdate === updateCounter) {
      chrome.runtime.sendMessage({
        type: "MIRURO_SET_PRESENCE",
        data: activity
      }).catch(() => {});
    }
  }

  /* ── Direct <video> Event Listeners ────────────────────── */
  function onMainVideoEvent() {
    updatePresence();
  }

  function bindMainVideoListeners(video) {
    if (!video || boundMainVideo === video) return;

    if (boundMainVideo) {
      try {
        boundMainVideo.removeEventListener("play", onMainVideoEvent);
        boundMainVideo.removeEventListener("pause", onMainVideoEvent);
        boundMainVideo.removeEventListener("seeked", onMainVideoEvent);
        boundMainVideo.removeEventListener("loadedmetadata", onMainVideoEvent);
        boundMainVideo.removeEventListener("ratechange", onMainVideoEvent);
      } catch (_) {}
    }

    boundMainVideo = video;
    video.addEventListener("play", onMainVideoEvent);
    video.addEventListener("pause", onMainVideoEvent);
    video.addEventListener("seeked", onMainVideoEvent);
    video.addEventListener("loadedmetadata", onMainVideoEvent);
    video.addEventListener("ratechange", onMainVideoEvent);
  }

  function checkAndBindMainVideo() {
    const video = document.querySelector("video");
    if (video && video !== boundMainVideo) {
      bindMainVideoListeners(video);
    }
  }

  /* ── Listen for Video State from iFrames & Background ──── */
  window.addEventListener("message", (event) => {
    if (
      event.data &&
      (event.data.type === "MIRURO_VIDEO_STATE" || event.data.type === "VIDEO_STATE") &&
      event.data.data
    ) {
      const data = event.data.data;
      const stateChanged =
        data.paused !== videoData.paused ||
        Math.abs(data.currentTime - videoData.currentTime) > 2 ||
        (data.duration > 0 && videoData.duration === 0);
      videoData = data;
      if (stateChanged) {
        updatePresence();
      }
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (
      (message.type === "MIRURO_VIDEO_STATE" || message.type === "VIDEO_STATE") &&
      message.data
    ) {
      const data = message.data;
      const stateChanged =
        data.paused !== videoData.paused ||
        Math.abs(data.currentTime - videoData.currentTime) > 2 ||
        (data.duration > 0 && videoData.duration === 0);
      videoData = data;
      if (stateChanged) {
        updatePresence();
      }
    } else if (message.type === "FORCE_PRESENCE_SYNC") {
      updatePresence();
    }
  });

  /* ── SPA Navigation Tracking (<100ms Reaction) ─────────── */
  function onLocationChange() {
    lastHref = document.location.href;
    lastTitle = document.title;
    checkAndBindMainVideo();
    updatePresence();
  }

  const originalPushState = history.pushState;
  if (typeof originalPushState === "function") {
    history.pushState = function (...args) {
      const res = originalPushState.apply(this, args);
      window.dispatchEvent(new Event("miruro:routechange"));
      return res;
    };
  }

  const originalReplaceState = history.replaceState;
  if (typeof originalReplaceState === "function") {
    history.replaceState = function (...args) {
      const res = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event("miruro:routechange"));
      return res;
    };
  }

  window.addEventListener("popstate", onLocationChange);
  window.addEventListener("miruro:routechange", onLocationChange);

  // MutationObserver for DOM changes, title updates, route changes
  let lastHref = document.location.href;
  let lastTitle = document.title;

  const target = document.body || document.documentElement;
  if (target) {
    const domObserver = new MutationObserver(() => {
      checkAndBindMainVideo();
      const currentHref = document.location.href;
      const currentTitle = document.title;
      if (currentHref !== lastHref || currentTitle !== lastTitle) {
        lastHref = currentHref;
        lastTitle = currentTitle;
        updatePresence();
      }
    });

    domObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // Initial execution
  checkAndBindMainVideo();
  updatePresence();
})();
