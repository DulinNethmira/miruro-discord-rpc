/**
 * Cinejoy Discord Rich Presence — Content Script
 * Runs in the top-level Cinejoy page (*://*.cinejoy.pk/*)
 * Tracks SvelteKit SPA navigation, queries TMDB for metadata/posters, tracks video playback, and sends Discord activity.
 */

(function () {
  // Only execute in top-level window
  if (window !== window.top) return;

  const TMDB_API_KEY = "ef311eb0b9b07b9c73e9fb0a732cc150";
  const DEFAULT_LOGO = "https://cdn.jsdelivr.net/gh/DulinNethmira/miruro-discord-rpc@main/assets/cinejoy-icon.png";
  const FALLBACK_LOGO = "https://cinejoy.pk/pwa-192.png";
  const PLAY_ICON = "https://cdn.rcd.gg/PreMiD/resources/play.png";
  const PAUSE_ICON = "https://cdn.rcd.gg/PreMiD/resources/pause.png";
  const browsingTimestamp = Math.floor(Date.now() / 1000);

  const posterCache = {};
  const metaCache = {};
  const seasonCache = {};
  const pendingFetches = new Set();
  let videoData = { currentTime: 0, duration: 0, paused: true };
  let boundMainVideo = null;
  let updateCounter = 0;

  /* ── Settings Reader ───────────────────────────────────── */
  async function getSettings() {
    try {
      const res = await chrome.storage.local.get([
        "cinejoy_enabled",
        "cinejoy_browsing",
        "cinejoy_timestamps",
        "cinejoy_cover",
        "cinejoy_buttons",
        "enabled",
        "browsing",
        "timestamps",
        "cover",
        "buttons",
        "discordUserId",
        "discordAppId"
      ]);

      return {
        enabled: res.cinejoy_enabled !== undefined ? res.cinejoy_enabled : (res.enabled !== false),
        browsing: res.cinejoy_browsing !== undefined ? res.cinejoy_browsing : (res.browsing !== false),
        timestamps: res.cinejoy_timestamps !== undefined ? res.cinejoy_timestamps : (res.timestamps !== false),
        cover: res.cinejoy_cover !== undefined ? res.cinejoy_cover : (res.cover !== false),
        buttons: res.cinejoy_buttons !== undefined ? res.cinejoy_buttons : (res.buttons !== false),
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

  /* ── Extract TMDB Media Info from Cinejoy URL ──────────── */
  function getMediaInfo() {
    const { pathname } = document.location;

    // 1. Watch Movie: /watch/movie/[id]
    const watchMovieMatch = pathname.match(/\/watch\/movie\/(\d+)/i);
    if (watchMovieMatch) {
      return {
        type: "movie",
        id: watchMovieMatch[1],
        isWatch: true
      };
    }

    // 2. Watch TV: /watch/tv/[id]/[season]/[episode]
    const watchTvMatch = pathname.match(/\/watch\/tv\/(\d+)\/(\d+)\/(\d+)/i);
    if (watchTvMatch) {
      return {
        type: "tv",
        id: watchTvMatch[1],
        season: parseInt(watchTvMatch[2], 10),
        episode: parseInt(watchTvMatch[3], 10),
        isWatch: true
      };
    }

    // 3. Movie Detail Page: /movie/[slug] (e.g. /movie/157336-interstellar or /movie/157336)
    const movieSlugMatch = pathname.match(/\/movie\/([^/?#]+)/i);
    if (movieSlugMatch) {
      const slug = movieSlugMatch[1];
      const idMatch = slug.match(/^(\d+)(?:-|$)/) || slug.match(/(\d{3,8})/);
      return {
        type: "movie",
        id: idMatch ? idMatch[1] : null,
        slug: slug,
        isWatch: false
      };
    }

    // 4. Series Detail Page: /series/[slug] (e.g. /series/1396-breaking-bad or /series/1396)
    const seriesSlugMatch = pathname.match(/\/series\/([^/?#]+)/i);
    if (seriesSlugMatch) {
      const slug = seriesSlugMatch[1];
      const idMatch = slug.match(/^(\d+)(?:-|$)/) || slug.match(/(\d{3,8})/);
      return {
        type: "tv",
        id: idMatch ? idMatch[1] : null,
        slug: slug,
        isWatch: false
      };
    }

    return null;
  }

  /* ── Clean Cinejoy Title ───────────────────────────────── */
  function cleanTitle(str) {
    if (!str) return "";
    let clean = str.trim();

    // Strip site suffixes: " - Cinejoy", " | Cinejoy", " · Cinejoy", etc.
    clean = clean.replace(/\s*[-–—·|/]\s*Cinejoy.*$/i, "").trim();

    // Strip leading "Watch ", "Watching ", or "Now Watching: "
    clean = clean.replace(/^(?:Now\s+Watching:?|Watch(?:ing)?)\s+/i, "").trim();

    // Strip year in parenthesis: "(2024)"
    clean = clean.replace(/\s*\(\d{4}\)$/, "").trim();

    return clean;
  }

  /* ── Extract Title from Document or Cache ──────────────── */
  function getTitle(mediaInfo) {
    // 1. From TMDB cache if available
    if (mediaInfo && mediaInfo.id && metaCache[mediaInfo.id]) {
      return metaCache[mediaInfo.id].title;
    }

    // 2. Primary heading (h1) in DOM
    const h1 = document.querySelector("h1");
    if (h1) {
      const clone = h1.cloneNode(true);
      clone.querySelectorAll("span, p, div, small, button, badge, a, svg").forEach((el) => el.remove());
      const cleanedH1 = cleanTitle(clone.textContent || h1.textContent);
      if (
        cleanedH1 &&
        cleanedH1.toLowerCase() !== "cinejoy" &&
        !cleanedH1.toLowerCase().includes("stream thousands")
      ) {
        return cleanedH1.length > 128 ? cleanedH1.slice(0, 125) + "..." : cleanedH1;
      }
    }

    // 3. Cleaned document.title
    const cleanedDocTitle = cleanTitle(document.title || "");
    if (
      cleanedDocTitle &&
      cleanedDocTitle.toLowerCase() !== "cinejoy" &&
      !cleanedDocTitle.toLowerCase().includes("stream thousands")
    ) {
      return cleanedDocTitle.length > 128 ? cleanedDocTitle.slice(0, 125) + "..." : cleanedDocTitle;
    }

    // 4. Meta og:title
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    if (ogTitle) {
      const cleanedOg = cleanTitle(ogTitle);
      if (cleanedOg && cleanedOg.toLowerCase() !== "cinejoy") {
        return cleanedOg.length > 128 ? cleanedOg.slice(0, 125) + "..." : cleanedOg;
      }
    }

    // 5. From slug (e.g. 157336-interstellar -> "Interstellar")
    if (mediaInfo && mediaInfo.slug) {
      const namePart = mediaInfo.slug.replace(/^\d+-?/, "").replace(/-+/g, " ");
      if (namePart) {
        return namePart
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
          .trim();
      }
    }

    return mediaInfo?.type === "movie" ? "Movie" : (mediaInfo?.type === "tv" ? "TV Show" : "Cinejoy");
  }

  /* ── Extract Poster Image ──────────────────────────────── */
  function getPoster(mediaInfo) {
    if (!mediaInfo) return DEFAULT_LOGO;

    // 1. Memory cache
    if (mediaInfo.id && posterCache[mediaInfo.id]) {
      return posterCache[mediaInfo.id];
    }

    // 2. Fetch TMDB details in background
    if (mediaInfo.id) {
      fetchTmdbDetails(mediaInfo);
    }

    // 3. Meta og:image
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (ogImage && ogImage.startsWith("http") && !ogImage.includes("favicon") && !ogImage.includes("pwa-")) {
      if (mediaInfo.id) posterCache[mediaInfo.id] = ogImage;
      return ogImage;
    }

    // 4. TMDB img tags in DOM
    const tmdbImg = document.querySelector('img[src*="image.tmdb.org/t/p/"]');
    if (tmdbImg) {
      const src = tmdbImg.currentSrc || tmdbImg.src;
      if (src && src.startsWith("http")) {
        if (mediaInfo.id) posterCache[mediaInfo.id] = src;
        return src;
      }
    }

    return DEFAULT_LOGO;
  }

  /* ── Fetch TMDB Metadata ───────────────────────────────── */
  async function fetchTmdbDetails(mediaInfo) {
    if (!mediaInfo || !mediaInfo.id || pendingFetches.has(mediaInfo.id)) return;
    pendingFetches.add(mediaInfo.id);

    try {
      const endpoint =
        mediaInfo.type === "movie"
          ? `https://api.themoviedb.org/3/movie/${mediaInfo.id}?language=en-US&api_key=${TMDB_API_KEY}`
          : `https://api.themoviedb.org/3/tv/${mediaInfo.id}?language=en-US&api_key=${TMDB_API_KEY}`;

      const res = await fetch(endpoint);
      const data = await res.json();

      let updated = false;

      if (data) {
        const title = data.title || data.name || data.original_title || data.original_name;
        const posterPath = data.poster_path || data.backdrop_path;
        const year = (data.release_date || data.first_air_date || "").slice(0, 4);

        if (posterPath) {
          const posterUrl = `https://image.tmdb.org/t/p/w500${posterPath}`;
          posterCache[mediaInfo.id] = posterUrl;
          updated = true;
        }

        metaCache[mediaInfo.id] = {
          title: title || getTitle(mediaInfo),
          year: year || null,
          runtime: data.runtime || null,
          overview: data.overview || null
        };
        updated = true;
      }

      // If TV show and in watch mode, also fetch the active season's episodes
      if (mediaInfo.type === "tv" && mediaInfo.season) {
        const seasonNum = mediaInfo.season;
        const seasonRes = await fetch(
          `https://api.themoviedb.org/3/tv/${mediaInfo.id}/season/${seasonNum}?language=en-US&api_key=${TMDB_API_KEY}`
        );
        const seasonData = await seasonRes.json();
        if (seasonData && seasonData.episodes) {
          seasonCache[`${mediaInfo.id}_s${seasonNum}`] = seasonData.episodes;
          updated = true;
        }
      }

      if (updated) {
        updatePresence();
      }
    } catch (_) {
      // Fail safely
    } finally {
      pendingFetches.delete(mediaInfo.id);
    }
  }

  /* ── Extract Episode Name for TV ───────────────────────── */
  function getEpisodeTitle(mediaId, seasonNum, episodeNum) {
    if (!mediaId || !seasonNum || !episodeNum) return null;
    const seasonKey = `${mediaId}_s${seasonNum}`;
    if (seasonCache[seasonKey]) {
      const epData = seasonCache[seasonKey].find((e) => e.episode_number === episodeNum);
      if (epData && epData.name) {
        return epData.name;
      }
    }
    return null;
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
    const { pathname, href } = document.location;
    const settings = await getSettings();

    if (!settings.enabled) {
      chrome.runtime.sendMessage({ type: "CINEJOY_CLEAR_PRESENCE" }).catch(() => {});
      return;
    }

    if (currentUpdate !== updateCounter) return;

    const mediaInfo = getMediaInfo();

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

    // Discord RPC Activity Object
    const activity = {
      name: "Cinejoy",
      type: 3, // ActivityType.Watching
      status_display_type: 2,
      assets: {
        large_image: DEFAULT_LOGO,
        large_text: "Cinejoy"
      },
      timestamps: {
        start: browsingTimestamp
      }
    };

    /* ── Movie Page (Watch or Info) ──────────────────────── */
    if (mediaInfo && mediaInfo.type === "movie") {
      const title = getTitle(mediaInfo);
      const poster = getPoster(mediaInfo);
      const cached = mediaInfo.id ? metaCache[mediaInfo.id] : null;
      const year = cached?.year || null;

      activity.name = title;
      activity.details = title;

      if (mediaInfo.isWatch) {
        if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
          activity.state = year ? `${year} • Watching Movie` : "Watching Movie";
          activity.assets.small_image = PLAY_ICON;
          activity.assets.small_text = "Playing";
        } else if (activeVideo && activeVideo.paused && activeVideo.duration > 0) {
          activity.state = year ? `${year} • Paused` : "Paused";
          activity.assets.small_image = PAUSE_ICON;
          activity.assets.small_text = "Paused";
        } else {
          activity.state = year ? `${year} • Watching Movie` : "Watching Movie";
          activity.assets.small_image = PLAY_ICON;
          activity.assets.small_text = "Playing";
        }
      } else {
        if (!settings.browsing) {
          chrome.runtime.sendMessage({ type: "CINEJOY_CLEAR_PRESENCE" }).catch(() => {});
          return;
        }
        activity.state = year ? `${year} • Movie Details` : "Viewing Movie Details";
      }

      if (settings.cover && poster) {
        activity.assets.large_image = poster;
        activity.assets.large_text = title;
      }

      // Video playback timestamps
      if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
        if (settings.timestamps) {
          activity.timestamps = calculateTimestamps(activeVideo.currentTime, activeVideo.duration);
        } else {
          delete activity.timestamps;
        }
      } else if (activeVideo && activeVideo.paused) {
        delete activity.timestamps;
      }

      if (settings.buttons) {
        activity.buttons = [{ label: "Watch on Cinejoy", url: href }];
        if (settings.discordUserId && /^\d{17,21}$/.test(settings.discordUserId)) {
          activity.buttons.push({
            label: "Discord Profile",
            url: `https://discord.com/users/${settings.discordUserId}`
          });
        }
      }

    /* ── TV Show Page (Watch or Info) ────────────────────── */
    } else if (mediaInfo && mediaInfo.type === "tv") {
      const title = getTitle(mediaInfo);
      const poster = getPoster(mediaInfo);

      activity.name = title;
      activity.details = title;

      if (mediaInfo.isWatch) {
        const season = mediaInfo.season || 1;
        const episode = mediaInfo.episode || 1;
        const epTitle = getEpisodeTitle(mediaInfo.id, season, episode);

        activity.state = epTitle
          ? `S${season} E${episode} - ${epTitle}`
          : `Season ${season} Episode ${episode}`;

        if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
          activity.assets.small_image = PLAY_ICON;
          activity.assets.small_text = "Playing";
        } else if (activeVideo && activeVideo.paused && activeVideo.duration > 0) {
          activity.assets.small_image = PAUSE_ICON;
          activity.assets.small_text = "Paused";
        } else {
          activity.assets.small_image = PLAY_ICON;
          activity.assets.small_text = "Playing";
        }
      } else {
        if (!settings.browsing) {
          chrome.runtime.sendMessage({ type: "CINEJOY_CLEAR_PRESENCE" }).catch(() => {});
          return;
        }
        activity.state = "Viewing TV Series Details";
      }

      if (settings.cover && poster) {
        activity.assets.large_image = poster;
        activity.assets.large_text = title;
      }

      // Video playback timestamps
      if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
        if (settings.timestamps) {
          activity.timestamps = calculateTimestamps(activeVideo.currentTime, activeVideo.duration);
        } else {
          delete activity.timestamps;
        }
      } else if (activeVideo && activeVideo.paused) {
        delete activity.timestamps;
      }

      if (settings.buttons) {
        activity.buttons = [{ label: "Watch on Cinejoy", url: href }];
        if (settings.discordUserId && /^\d{17,21}$/.test(settings.discordUserId)) {
          activity.buttons.push({
            label: "Discord Profile",
            url: `https://discord.com/users/${settings.discordUserId}`
          });
        }
      }

    /* ── Search Page ────────────────────────────────────── */
    } else if (pathname.startsWith("/search")) {
      activity.name = "Cinejoy";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "CINEJOY_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }

      const searchMatch = pathname.match(/\/search\/([^/?#]+)/i);
      const query = searchMatch ? decodeURIComponent(searchMatch[1].replace(/\+/g, " ")) : null;
      activity.details = "Searching Movies & Shows";
      activity.state = query ? `"${query}"` : "Browsing Search";

    /* ── Catalog / Categories / Home ─────────────────────── */
    } else {
      activity.name = "Cinejoy";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "CINEJOY_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }

      activity.details = "Browsing Cinejoy";

      if (pathname === "/" || pathname === "" || pathname === "/home") {
        activity.state = "Home";
      } else if (pathname.startsWith("/movies")) {
        activity.state = "Browsing Movies";
      } else if (pathname.startsWith("/series")) {
        activity.state = "Browsing TV Series";
      } else if (pathname.startsWith("/continue-watching")) {
        activity.state = "Continue Watching";
      } else if (pathname.startsWith("/lists") || pathname.startsWith("/list")) {
        activity.state = "Custom Lists";
      } else if (pathname.startsWith("/settings")) {
        activity.state = "Settings";
      } else {
        activity.state = "Exploring Catalog";
      }
    }

    // Send payload to background.js -> offscreen.js -> Discord IPC Bridge
    if (currentUpdate === updateCounter) {
      chrome.runtime.sendMessage({
        type: "CINEJOY_SET_PRESENCE",
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
      (event.data.type === "VIDEO_STATE" || event.data.type === "MIRURO_VIDEO_STATE") &&
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
      (message.type === "VIDEO_STATE" || message.type === "MIRURO_VIDEO_STATE") &&
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
    videoData = { currentTime: 0, duration: 0, paused: true };
    checkAndBindMainVideo();
    updatePresence();
  }

  const originalPushState = history.pushState;
  if (typeof originalPushState === "function") {
    history.pushState = function (...args) {
      const res = originalPushState.apply(this, args);
      window.dispatchEvent(new Event("cinejoy:routechange"));
      return res;
    };
  }

  const originalReplaceState = history.replaceState;
  if (typeof originalReplaceState === "function") {
    history.replaceState = function (...args) {
      const res = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event("cinejoy:routechange"));
      return res;
    };
  }

  window.addEventListener("popstate", onLocationChange);
  window.addEventListener("cinejoy:routechange", onLocationChange);

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
