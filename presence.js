/* ─────────────────────────────────────────────────────────
 *  Miruro — PreMiD Presence  v1.2.1
 *
 *  Engineered for 100% Live, Real-Time Rich Presence:
 *    1. Guaranteed CDN Logo (bypasses Cloudflare block)
 *    2. Official Anime Cover Art (AniList API & filtered DOM)
 *    3. PreMiD Official Play/Pause Sub-Icons (cdn.rcd.gg)
 *    4. Clean Activity Header & Metadata (No synopsis clutter)
 *    5. Instant event-driven synchronization
 * ───────────────────────────────────────────────────────── */

const presence = new Presence({
  clientId: "1563994278965813358",
});

/* ── Constants & Global Asset URLs ─────────────────────── */
// Global CDN-backed Miruro logo (identical SHA-256 to miruro.tv icon, no Cloudflare blocks)
const LOGO = "https://cdn.jsdelivr.net/gh/D4rkov/Miruro-RPC@main/assets/icon.png";

// Official PreMiD play and pause icons (direct PNG URLs from cdn.rcd.gg)
const PLAY_ICON =
  typeof Assets !== "undefined" && Assets && typeof Assets.Play === "string" && Assets.Play.startsWith("http")
    ? Assets.Play
    : "https://cdn.rcd.gg/PreMiD/resources/play.png";

const PAUSE_ICON =
  typeof Assets !== "undefined" && Assets && typeof Assets.Pause === "string" && Assets.Pause.startsWith("http")
    ? Assets.Pause
    : "https://cdn.rcd.gg/PreMiD/resources/pause.png";

const browsingTimestamp = Math.floor(Date.now() / 1000);

/* ── Caching & State Management ────────────────────────── */
const coverCache = {};            // { [pathnameOrId]: imageUrl }
const titleCache = {};            // { [anilistId]: animeTitle }
const pendingFetches = new Set(); // deduplicate in-flight AniList GraphQL queries
let videoData = { currentTime: 0, duration: 0, paused: true };
let boundMainVideo = null;        // Direct main-page <video> element
let updateCounter = 0;            // Prevent race conditions on rapid updates

/* ── Helper: Read user settings safely ─────────────────── */
async function getSettingSafe(id, defaultVal = true) {
  try {
    const val = await presence.getSetting(id);
    return val !== undefined ? val : defaultVal;
  } catch (_) {
    return defaultVal;
  }
}

/* ── Helper: Calculate Discord Timestamps ──────────────── */
function calculateTimestamps(currentTime, duration) {
  const now = Math.floor(Date.now() / 1000);
  return [now - Math.floor(currentTime), now + Math.floor(duration - currentTime)];
}

/* ── Helper: Extract AniList ID from URL ───────────────── */
function getAniListId() {
  const { pathname, search, href } = document.location;

  // 1. Path match: /watch/156092/... or /info/156092/... or /anime/156092/...
  const pathMatch = pathname.match(/\/(?:watch|info|anime)\/(\d+)/i);
  if (pathMatch) return pathMatch[1];

  // 2. Query param: ?id=156092, ?anilistId=156092, ?mediaId=156092
  const params = new URLSearchParams(search);
  const idParam = params.get("id") || params.get("anilistId") || params.get("mediaId");
  if (idParam && /^\d+$/.test(idParam)) return idParam;

  // 3. Fallback regex on href
  const hrefMatch = href.match(/[?&](?:id|anilistId|mediaId)=(\d+)/i);
  if (hrefMatch) return hrefMatch[1];

  // 4. Standalone numeric segment in path
  const segmentMatch = pathname.match(/(?:^|\/)(\d{2,8})(?:\/|$)/);
  if (segmentMatch) return segmentMatch[1];

  return null;
}

/* ── Helper: Clean Anime Title Regex ───────────────────── */
function cleanTitle(str) {
  if (!str) return "";
  let clean = str.trim();

  // Strip site suffixes: " - Miruro", " · Miruro", " — Miruro", " | Miruro", " / Miruro", etc.
  clean = clean.replace(/\s*[-–—·|/]\s*Miruro(?:\.tv|\.cx|\.online)?.*$/i, "").trim();

  // Strip leading "Watch " or "Watching "
  clean = clean.replace(/^(?:Watch(?:ing)?)\s+/i, "").trim();

  // Strip trailing episode markers if present in the title
  clean = clean.replace(/\s+(?:[-–—·|]\s*)?(?:Episode|Ep\.?)\s*\d+.*$/i, "").trim();

  return clean;
}

/* ── Helper: Extract Clean Anime Title ─────────────────── */
function getAnimeTitleFromDocument() {
  const anilistId = getAniListId();

  // 1. Official AniList title from API (100% clean, e.g. "ONE PIECE")
  if (anilistId && titleCache[anilistId]) {
    return titleCache[anilistId];
  }

  // 2. Cleaned document.title (React updates document.title to "ONE PIECE · Miruro" or "Watch ONE PIECE Episode 1 - Miruro")
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

  // 5. Fallback: Parse title from URL slug
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

/* ── Helper: Extract Episode Number ───────────────────── */
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

/* ── Helper: Extract Episode Title ────────────────────── */
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

/* ── URL Validator: Filter out thumbnails, screenshots, banners ── */
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

/* ── Bug 1: Smart Cover-Art Scraping with AniList Fallback ── */
function getCoverArt() {
  const key = document.location.pathname;
  const anilistId = getAniListId();

  // 1. Memory cache check (by AniList ID or URL path)
  if (anilistId && coverCache[anilistId]) return coverCache[anilistId];
  if (coverCache[key]) return coverCache[key];

  // 2. Fetch official extraLarge cover directly from AniList GraphQL
  if (anilistId) {
    fetchAniListMedia(anilistId, key);
  }

  // 3. Scrape ONLY genuine anime poster images in the DOM
  //    (Never use [class*="cover"] because Tailwind uses `object-cover` on episode thumbnails!)
  const validCoverSelectors = [
    'img[src*="/anime/cover/"]',
    'img[src*="anilist.co/file/anilistcdn/media/anime/cover"]',
    'img[src*="myanimelist.net/images/anime/"]',
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
  if (pendingFetches.has(id)) return;
  pendingFetches.add(id);

  try {
    const resp = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
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
        variables: { id: parseInt(id, 10) },
      }),
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
    /* Safe fallback remains active */
  } finally {
    pendingFetches.delete(id);
  }
}

/* ═══════════════════════════════════════════════════════
 *  CORE: updatePresence()
 * ═══════════════════════════════════════════════════════ */
async function updatePresence() {
  const currentUpdate = ++updateCounter;

  const { pathname, search, href } = document.location;

  const showBrowsing = await getSettingSafe("browsing", true);
  const showTimestamps = await getSettingSafe("timestamps", true);
  const showButtons = await getSettingSafe("buttons", true);
  const showCover = await getSettingSafe("cover", true);

  // Avoid race conditions if a newer update took over
  if (currentUpdate !== updateCounter) return;

  const presenceData = {
    name: "Miruro",
    type: 3, // ActivityType.Watching
    largeImageKey: LOGO,
    largeImageText: "Miruro",
    startTimestamp: browsingTimestamp,
  };

  /* ── /watch — Active Anime Playback ───────────────────── */
  if (pathname.startsWith("/watch")) {
    const animeTitle = getAnimeTitleFromDocument();
    const episodeNum = getEpisodeNumber();
    const episodeTitle = getEpisodeTitle();
    const coverArt = getCoverArt();

    // Dynamic Activity Header Title ("Watching [Anime Title]")
    presenceData.name = animeTitle;
    presenceData.statusDisplayType = 2;
    presenceData.stateDisplayType = 2;

    presenceData.details = animeTitle;
    if (episodeNum) {
      presenceData.state = episodeTitle
        ? `Episode ${episodeNum} - ${episodeTitle}`
        : `Episode ${episodeNum}`;
    } else {
      presenceData.state = episodeTitle || "Watching Episode";
    }

    // Official Anime Poster Art
    if (showCover && coverArt) {
      presenceData.largeImageKey = coverArt;
      presenceData.largeImageText = animeTitle;
    }

    // Identify active video source: direct page video or iframe bridge
    const directVideo = document.querySelector("video");
    if (directVideo && directVideo !== boundMainVideo) {
      bindMainVideoListeners(directVideo);
    }

    const activeVideo =
      directVideo && !isNaN(directVideo.duration) && directVideo.duration > 0
        ? {
            currentTime: directVideo.currentTime,
            duration: directVideo.duration,
            paused: directVideo.paused,
          }
        : videoData;

    // Play & Pause sub-icons and timestamp management
    if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
      // Playing: display timestamps and Play icon
      if (showTimestamps) {
        const [start, end] = calculateTimestamps(
          activeVideo.currentTime,
          activeVideo.duration
        );
        presenceData.startTimestamp = start;
        presenceData.endTimestamp = end;
      }
      presenceData.smallImageKey = PLAY_ICON;
      presenceData.smallImageText = "Playing";
    } else if (activeVideo && activeVideo.paused) {
      // Paused: immediately delete timestamps and show Pause icon
      delete presenceData.startTimestamp;
      delete presenceData.endTimestamp;
      presenceData.smallImageKey = PAUSE_ICON;
      presenceData.smallImageText = "Paused";
    }

    const discordUserId = presence.getSetting("discordUserId");
    if (showButtons) {
      presenceData.buttons = [{ label: "Watch Episode", url: href }];
      if (discordUserId && /^\d{17,21}$/.test(String(discordUserId).trim())) {
        presenceData.buttons.push({
          label: "Discord Profile",
          url: `https://discord.com/users/${String(discordUserId).trim()}`
        });
      }
    }

  /* ── /info — Anime Details Page ───────────────────────── */
  } else if (pathname.startsWith("/info")) {
    presenceData.name = "Miruro";
    if (!showBrowsing) {
      presence.clearActivity();
      return;
    }

    const animeTitle = getAnimeTitleFromDocument();
    const coverArt = getCoverArt();

    // Clean, crisp anime info display (No messy synopsis or badges)
    presenceData.details = animeTitle || "Viewing Anime";
    presenceData.state = "Viewing Anime Details";

    if (showCover && coverArt) {
      presenceData.largeImageKey = coverArt;
      presenceData.largeImageText = animeTitle;
    }
    const discordUserId = presence.getSetting("discordUserId");
    if (showButtons) {
      presenceData.buttons = [{ label: "View on Miruro", url: href }];
      if (discordUserId && /^\d{17,21}$/.test(String(discordUserId).trim())) {
        presenceData.buttons.push({
          label: "Discord Profile",
          url: `https://discord.com/users/${String(discordUserId).trim()}`
        });
      }
    }

  /* ── /search — Search Page ────────────────────────────── */
  } else if (pathname.startsWith("/search")) {
    presenceData.name = "Miruro";
    if (!showBrowsing) {
      presence.clearActivity();
      return;
    }

    const query =
      new URLSearchParams(search).get("q") ||
      new URLSearchParams(search).get("query");
    presenceData.details = "Searching...";
    presenceData.state = query ? `"${query}"` : "Browsing search";

  /* ── General Browsing Pages ───────────────────────────── */
  } else {
    presenceData.name = "Miruro";
    if (!showBrowsing) {
      presence.clearActivity();
      return;
    }

    presenceData.details = "Browsing Miruro...";

    if (pathname === "/" || pathname === "") {
      presenceData.state = "Home";
    } else if (pathname.startsWith("/trending")) {
      presenceData.state = "Trending";
    } else if (pathname.startsWith("/discover")) {
      presenceData.state = "Discover";
    } else if (pathname.startsWith("/schedule")) {
      presenceData.state = "Schedule";
    } else if (pathname.startsWith("/history")) {
      presenceData.state = "Watch History";
    } else if (pathname.startsWith("/bookmarks")) {
      presenceData.state = "Bookmarks";
    } else if (pathname.startsWith("/settings")) {
      presenceData.state = "Settings";
    } else {
      presenceData.state = "Exploring Catalog";
    }
  }

  // Push activity to Discord
  if (currentUpdate === updateCounter) {
    if (presenceData.details) {
      presence.setActivity(presenceData);
    } else {
      presence.clearActivity();
    }
  }
}

/* ── Main Page Direct <video> Event Listeners ──────────── */
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

/* ═══════════════════════════════════════════════════════
 *  EVENT HOOKS — 100% Live Instant Real-Time Updates
 * ═══════════════════════════════════════════════════════ */

// 1. PreMiD standard polling hook
presence.on("UpdateData", () => {
  checkAndBindMainVideo();
  updatePresence();
});

// 2. Immediate iFrame data receiver
presence.on("iFrameData", (data) => {
  if (data && typeof data.currentTime === "number") {
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

// 3. SPA Route Navigation Hooks (pushState / replaceState / popstate)
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

// 4. MutationObserver: Catch SPA DOM changes, title changes, dynamic player injection
let lastHref = document.location.href;
let lastTitle = document.title;

const observerTarget = document.body || document.documentElement;
if (observerTarget) {
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

  domObserver.observe(observerTarget, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// Initial binding and execution
checkAndBindMainVideo();
updatePresence();
