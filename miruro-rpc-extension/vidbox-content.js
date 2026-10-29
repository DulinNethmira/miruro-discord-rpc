/**
 * VidBox Discord Rich Presence — Content Script
 * Runs in the top-level VidBox page (*://*.vidbox.wtf/*, *://*.vidbox.to/*, *://*.vidbox.cc/*, etc.)
 * Tracks SPA navigation, scrapes TMDB metadata/posters, listens to video playback, and sends Discord activity.
 */

(function () {
  // Only execute in top-level window
  if (window !== window.top) return;

  const TMDB_API_KEY = "ef311eb0b9b07b9c73e9fb0a732cc150";
  const DEFAULT_LOGO = "https://cdn.jsdelivr.net/gh/DulinNethmira/miruro-discord-rpc@main/assets/vidbox-icon.png";
  const FALLBACK_LOGO = "https://vidbox.wtf/icon-192x192.png";
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
        "vidbox_enabled",
        "vidbox_browsing",
        "vidbox_timestamps",
        "vidbox_cover",
        "vidbox_buttons",
        "enabled",
        "browsing",
        "timestamps",
        "cover",
        "buttons",
        "discordUserId",
        "discordAppId"
      ]);

      return {
        enabled: res.vidbox_enabled !== undefined ? res.vidbox_enabled : (res.enabled !== false),
        browsing: res.vidbox_browsing !== undefined ? res.vidbox_browsing : (res.browsing !== false),
        timestamps: res.vidbox_timestamps !== undefined ? res.vidbox_timestamps : (res.timestamps !== false),
        cover: res.vidbox_cover !== undefined ? res.vidbox_cover : (res.cover !== false),
        buttons: res.vidbox_buttons !== undefined ? res.vidbox_buttons : (res.buttons !== false),
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

  /* ── Extract Cookie ────────────────────────────────────── */
  function getCookie(name) {
    try {
      const match = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_) {
      return null;
    }
  }

  /* ── Extract TMDB Media ID & Type ──────────────────────── */
  function getMediaInfo() {
    const { pathname } = document.location;

    // 1. Direct info path: /movie/1400940 or /tv/96677 or /drama/123
    const directMatch = pathname.match(/\/(movie|tv|drama)\/(\d+)/i);
    if (directMatch) {
      const info = {
        type: directMatch[1].toLowerCase() === "drama" ? "tv" : directMatch[1].toLowerCase(),
        id: directMatch[2],
        isWatchPage: false
      };
      try {
        sessionStorage.setItem("vidbox:current_media", JSON.stringify(info));
      } catch (_) {}
      return info;
    }

    // 2. Watch pages: /watch/movie, /watch/tv, /watch/anime, /watch/drama
    if (pathname.startsWith("/watch/")) {
      const watchType = pathname.includes("movie") ? "movie" : "tv";

      // 2a. Check vidbox-watch-return-to cookie (e.g. "/movie/1400940" or "/tv/96677?season=1&episode=2")
      const returnTo = getCookie("vidbox-watch-return-to");
      if (returnTo) {
        const returnMatch = returnTo.match(/\/(movie|tv|drama)\/(\d+)/i);
        if (returnMatch) {
          const type = returnMatch[1].toLowerCase() === "drama" ? "tv" : returnMatch[1].toLowerCase();
          const id = returnMatch[2];
          const queryPart = returnTo.split("?")[1];
          const params = new URLSearchParams(queryPart || "");
          const season = params.get("season") ? parseInt(params.get("season"), 10) : undefined;
          const episode = params.get("episode") ? parseInt(params.get("episode"), 10) : undefined;
          const info = { type, id, isWatchPage: true, season, episode };
          try {
            sessionStorage.setItem("vidbox:current_media", JSON.stringify(info));
          } catch (_) {}
          return info;
        }
      }

      // 2b. Check sessionStorage (cached when previously on info page in this tab)
      try {
        const savedRaw = sessionStorage.getItem("vidbox:current_media");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          if (saved && saved.id) {
            return {
              type: saved.type || watchType,
              id: String(saved.id),
              isWatchPage: true,
              season: saved.season,
              episode: saved.episode
            };
          }
        }
      } catch (_) {}

      // 2c. Check DOM download / info links (e.g. https://moviesdl.cc/p/info.html?id=1400940&type=movie)
      const dlLink = document.querySelector('a[href*="id="][href*="type="], a[href*="moviesdl.cc"]');
      if (dlLink && dlLink.href) {
        try {
          const u = new URL(dlLink.href);
          const id = u.searchParams.get("id");
          const type = u.searchParams.get("type");
          if (id) {
            const info = {
              type: type === "movie" ? "movie" : "tv",
              id: String(id),
              isWatchPage: true
            };
            try {
              sessionStorage.setItem("vidbox:current_media", JSON.stringify(info));
            } catch (_) {}
            return info;
          }
        } catch (_) {}
      }

      // 2d. Check DOM links pointing to /movie/:id or /tv/:id
      const backLink = document.querySelector('a[href*="/movie/"], a[href*="/tv/"]');
      if (backLink && backLink.href) {
        const linkMatch = backLink.href.match(/\/(movie|tv)\/(\d+)/i);
        if (linkMatch) {
          const info = {
            type: linkMatch[1].toLowerCase(),
            id: linkMatch[2],
            isWatchPage: true
          };
          try {
            sessionStorage.setItem("vidbox:current_media", JSON.stringify(info));
          } catch (_) {}
          return info;
        }
      }

      // 2e. Check localStorage "media-storage" or "vidbox-continue-watching"
      try {
        const mediaStorageRaw = localStorage.getItem("media-storage");
        if (mediaStorageRaw) {
          const parsed = JSON.parse(mediaStorageRaw);
          const history = parsed?.state?.history;
          if (Array.isArray(history) && history.length > 0) {
            const item = history.find((h) => h && (!watchType || h.mediaType === watchType)) || history[0];
            if (item && item.mediaId) {
              return {
                type: item.mediaType || watchType,
                id: String(item.mediaId),
                isWatchPage: true,
                season: item.season,
                episode: item.episode
              };
            }
          }
        }

        const continueWatchingRaw = localStorage.getItem("vidbox-continue-watching");
        if (continueWatchingRaw) {
          const cwList = JSON.parse(continueWatchingRaw);
          if (Array.isArray(cwList) && cwList.length > 0) {
            const item = cwList.find((c) => c && (!watchType || c.mediaType === watchType)) || cwList[0];
            if (item && (item.mediaId || item.id)) {
              return {
                type: item.mediaType || watchType,
                id: String(item.mediaId || item.id),
                isWatchPage: true,
                season: item.season,
                episode: item.episode
              };
            }
          }
        }
      } catch (_) {}

      // 2f. Fallback watch page with unknown ID
      return {
        type: watchType,
        id: null,
        isWatchPage: true
      };
    }

    return null;
  }

  /* ── Clean VidBox Title ────────────────────────────────── */
  function cleanTitle(str) {
    if (!str) return "";
    let clean = str.trim();

    // Strip site suffixes: " | Vidbox", " - Vidbox", " · Vidbox", etc.
    clean = clean.replace(/\s*[-–—·|/]\s*Vidbox.*$/i, "").trim();

    // Strip leading "Now Watching:", "Now Watching", "Watch ", or "Watching "
    clean = clean.replace(/^(?:Now\s+Watching:?|Watch(?:ing)?)\s+/i, "").trim();

    // Strip year in parenthesis: "(2024)"
    clean = clean.replace(/\s*\(\d{4}\)$/, "").trim();

    return clean;
  }

  /* ── Extract Title from Document ───────────────────────── */
  function getTitleFromDocument(mediaInfo) {
    // 1. From TMDB cache if available
    if (mediaInfo && mediaInfo.id && metaCache[mediaInfo.id]) {
      return metaCache[mediaInfo.id].title;
    }

    // 2. Primary heading (h1) — on watch page: "Now Watching: Clayface"
    const h1 = document.querySelector("h1");
    if (h1) {
      const cleanedH1 = cleanTitle(h1.textContent || "");
      if (
        cleanedH1 &&
        cleanedH1.toLowerCase() !== "vidbox" &&
        !cleanedH1.toLowerCase().includes("ultimate streaming guide") &&
        !cleanedH1.toLowerCase().includes("episodes")
      ) {
        return cleanedH1.length > 128 ? cleanedH1.slice(0, 125) + "..." : cleanedH1;
      }
    }

    // 3. Cleaned document.title — e.g. "Watch Clayface - Vidbox"
    const cleanedDocTitle = cleanTitle(document.title || "");
    if (
      cleanedDocTitle &&
      cleanedDocTitle.toLowerCase() !== "vidbox" &&
      !cleanedDocTitle.toLowerCase().includes("ultimate streaming guide")
    ) {
      return cleanedDocTitle.length > 128 ? cleanedDocTitle.slice(0, 125) + "..." : cleanedDocTitle;
    }

    // 4. Meta og:title — e.g. "Watch Clayface "
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    if (ogTitle) {
      const cleanedOg = cleanTitle(ogTitle);
      if (cleanedOg && cleanedOg.toLowerCase() !== "vidbox" && !cleanedOg.toLowerCase().includes("ultimate streaming guide")) {
        return cleanedOg.length > 128 ? cleanedOg.slice(0, 125) + "..." : cleanedOg;
      }
    }

    return mediaInfo?.type === "movie" ? "Movie" : (mediaInfo?.type === "tv" ? "TV Show" : "VidBox");
  }

  /* ── Extract Season Number for TV ───────────────────────── */
  function getSeasonNumber(mediaInfo) {
    if (mediaInfo && mediaInfo.season) return mediaInfo.season;

    // 1. Query param: ?season=1 or ?s=1
    const params = new URLSearchParams(document.location.search);
    const seasonParam = params.get("season") || params.get("s");
    if (seasonParam && /^\d+$/.test(seasonParam)) return parseInt(seasonParam, 10);

    // 2. Active season combobox or dropdown button
    const combobox = document.querySelector('button[role="combobox"]');
    if (combobox) {
      const text = combobox.textContent || "";
      const match = text.match(/Season\s*(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }

    // 3. Fallback to Season 1
    return 1;
  }

  /* ── Extract Episode Info for TV ────────────────────────── */
  function getEpisodeInfo(mediaId, seasonNum, mediaInfo) {
    const params = new URLSearchParams(document.location.search);
    let episodeNum = mediaInfo?.episode || params.get("episode") || params.get("ep") || params.get("e");
    let episodeTitle = null;

    // 1. Check DOM for active episode card (highlighted with pulse or gradient)
    const activeCard = document.querySelector(
      '[class*="animate-pulse"], [class*="from-red-600"], [class*="ring-primary"], [class*="active"], [aria-selected="true"]'
    );

    if (activeCard) {
      const h3 = activeCard.querySelector("h3") || activeCard.closest("div")?.querySelector("h3");
      if (h3 && h3.textContent) {
        const text = h3.textContent.trim();
        const epMatch = text.match(/Episode\s*(\d+)(?::\s*(.+))?/i);
        if (epMatch) {
          episodeNum = epMatch[1];
          if (epMatch[2]) episodeTitle = epMatch[2].trim();
        }
      }
    }

    // 2. If no active card found yet, query all episode headers in the DOM
    if (!episodeNum) {
      const h3s = Array.from(document.querySelectorAll("h3")).filter((el) =>
        /Episode\s*\d+/i.test(el.textContent || "")
      );
      if (h3s.length > 0) {
        const firstMatch = h3s[0].textContent.trim().match(/Episode\s*(\d+)(?::\s*(.+))?/i);
        if (firstMatch) {
          episodeNum = firstMatch[1];
          if (firstMatch[2]) episodeTitle = firstMatch[2].trim();
        }
      }
    }

    // 3. Check TMDB Season Cache for episode title
    if (mediaId) {
      const seasonKey = `${mediaId}_s${seasonNum}`;
      if (episodeNum && !episodeTitle && seasonCache[seasonKey]) {
        const epData = seasonCache[seasonKey].find((e) => e.episode_number === parseInt(episodeNum, 10));
        if (epData && epData.name) {
          episodeTitle = epData.name;
        }
      }
    }

    return {
      season: seasonNum,
      episode: episodeNum ? parseInt(episodeNum, 10) : 1,
      title: episodeTitle
    };
  }

  /* ── Fallback TMDB Title Search (When on /watch without ID) ─ */
  async function searchTmdb(title, type) {
    if (!title || title === "Movie" || title === "TV Show" || title === "VidBox") return;
    const cacheKey = `search_${type}_${title.toLowerCase()}`;
    if (pendingFetches.has(cacheKey)) return;
    pendingFetches.add(cacheKey);

    try {
      const endpoint = `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(title)}&language=en-US&api_key=${TMDB_API_KEY}`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data && data.results && data.results.length > 0) {
        const match = data.results[0];
        const resolvedId = String(match.id);
        const resolvedTitle = match.title || match.name || title;
        const posterPath = match.poster_path || match.backdrop_path;
        const year = (match.release_date || match.first_air_date || "").slice(0, 4);

        if (posterPath) {
          posterCache[resolvedId] = `https://image.tmdb.org/t/p/w500${posterPath}`;
        }
        metaCache[resolvedId] = {
          title: resolvedTitle,
          year: year || null,
          overview: match.overview || null
        };

        try {
          sessionStorage.setItem("vidbox:current_media", JSON.stringify({
            type,
            id: resolvedId,
            title: resolvedTitle,
            isWatchPage: true
          }));
        } catch (_) {}

        updatePresence();
      }
    } catch (_) {
      // Fail safely
    } finally {
      pendingFetches.delete(cacheKey);
    }
  }

  /* ── Extract Poster Image ──────────────────────────────── */
  function getPoster(mediaInfo) {
    if (!mediaInfo) return DEFAULT_LOGO;

    // 1. Memory cache
    if (mediaInfo.id && posterCache[mediaInfo.id]) {
      return posterCache[mediaInfo.id];
    }

    // 2. Fetch TMDB details or search by title in background
    if (mediaInfo.id) {
      fetchTmdbDetails(mediaInfo);
    } else {
      const title = getTitleFromDocument(mediaInfo);
      searchTmdb(title, mediaInfo.type);
    }

    // 3. Meta og:image (ignoring generic site previews)
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (ogImage && ogImage.startsWith("http") && !ogImage.includes("og-image.webp")) {
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
          title: title || getTitleFromDocument(mediaInfo),
          year: year || null,
          runtime: data.runtime || null,
          overview: data.overview || null
        };
        updated = true;
      }

      // If TV, also fetch Season 1 episodes
      if (mediaInfo.type === "tv") {
        const seasonNum = getSeasonNumber(mediaInfo);
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
      chrome.runtime.sendMessage({ type: "VIDBOX_CLEAR_PRESENCE" }).catch(() => {});
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
      name: "VidBox",
      type: 3, // ActivityType.Watching
      status_display_type: 2,
      assets: {
        large_image: DEFAULT_LOGO,
        large_text: "VidBox"
      },
      timestamps: {
        start: browsingTimestamp
      }
    };

    /* ── Movie Page ─────────────────────────────────────── */
    if (mediaInfo && mediaInfo.type === "movie") {
      const title = getTitleFromDocument(mediaInfo);
      const poster = getPoster(mediaInfo);
      const cached = mediaInfo.id ? metaCache[mediaInfo.id] : null;
      const year = cached?.year || null;

      activity.name = title;
      activity.details = title;

      if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
        activity.state = year ? `${year} • Watching Movie` : "Watching Movie";
      } else if (activeVideo && activeVideo.paused && activeVideo.duration > 0) {
        activity.state = year ? `${year} • Paused` : "Paused";
      } else if (mediaInfo.isWatchPage) {
        // User clicked Play and is on /watch/movie
        activity.state = year ? `${year} • Watching Movie` : "Watching Movie";
        activity.assets.small_image = PLAY_ICON;
        activity.assets.small_text = "Playing";
      } else {
        if (!settings.browsing) {
          chrome.runtime.sendMessage({ type: "VIDBOX_CLEAR_PRESENCE" }).catch(() => {});
          return;
        }
        activity.state = year ? `${year} • Movie Details` : "Viewing Movie Details";
      }

      if (settings.cover && poster) {
        activity.assets.large_image = poster;
        activity.assets.large_text = title;
      }

      // Video playback icons and timestamps
      if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
        if (settings.timestamps) {
          activity.timestamps = calculateTimestamps(activeVideo.currentTime, activeVideo.duration);
        } else {
          delete activity.timestamps;
        }
        activity.assets.small_image = PLAY_ICON;
        activity.assets.small_text = "Playing";
      } else if (activeVideo && activeVideo.paused && activeVideo.duration > 0) {
        delete activity.timestamps;
        activity.assets.small_image = PAUSE_ICON;
        activity.assets.small_text = "Paused";
      }

      if (settings.buttons) {
        const watchUrl = mediaInfo.id
          ? `https://vidbox.wtf/movie/${mediaInfo.id}`
          : href;
        activity.buttons = [{ label: "Watch on VidBox", url: watchUrl }];
        if (settings.discordUserId && /^\d{17,21}$/.test(settings.discordUserId)) {
          activity.buttons.push({
            label: "Discord Profile",
            url: `https://discord.com/users/${settings.discordUserId}`
          });
        }
      }

    /* ── TV Show Page ───────────────────────────────────── */
    } else if (mediaInfo && mediaInfo.type === "tv") {
      const title = getTitleFromDocument(mediaInfo);
      const poster = getPoster(mediaInfo);
      const seasonNum = getSeasonNumber(mediaInfo);
      const epInfo = getEpisodeInfo(mediaInfo.id, seasonNum, mediaInfo);

      activity.name = title;
      activity.details = title;

      if (epInfo && epInfo.episode) {
        activity.state = epInfo.title
          ? `S${epInfo.season} E${epInfo.episode} - ${epInfo.title}`
          : `Season ${epInfo.season} Episode ${epInfo.episode}`;
      } else {
        activity.state = `Season ${seasonNum}`;
      }

      if (!activeVideo || (activeVideo.paused && activeVideo.duration === 0)) {
        if (!mediaInfo.isWatchPage) {
          if (!settings.browsing) {
            chrome.runtime.sendMessage({ type: "VIDBOX_CLEAR_PRESENCE" }).catch(() => {});
            return;
          }
          if (!epInfo.title && epInfo.episode === 1) {
            activity.state = "Viewing TV Series Details";
          }
        } else {
          activity.assets.small_image = PLAY_ICON;
          activity.assets.small_text = "Playing";
        }
      }

      if (settings.cover && poster) {
        activity.assets.large_image = poster;
        activity.assets.large_text = title;
      }

      // Video playback icons and timestamps
      if (activeVideo && !activeVideo.paused && activeVideo.duration > 0) {
        if (settings.timestamps) {
          activity.timestamps = calculateTimestamps(activeVideo.currentTime, activeVideo.duration);
        } else {
          delete activity.timestamps;
        }
        activity.assets.small_image = PLAY_ICON;
        activity.assets.small_text = "Playing";
      } else if (activeVideo && activeVideo.paused && activeVideo.duration > 0) {
        delete activity.timestamps;
        activity.assets.small_image = PAUSE_ICON;
        activity.assets.small_text = "Paused";
      }

      if (settings.buttons) {
        const watchUrl = mediaInfo.id
          ? `https://vidbox.wtf/tv/${mediaInfo.id}`
          : href;
        activity.buttons = [{ label: "Watch on VidBox", url: watchUrl }];
        if (settings.discordUserId && /^\d{17,21}$/.test(settings.discordUserId)) {
          activity.buttons.push({
            label: "Discord Profile",
            url: `https://discord.com/users/${settings.discordUserId}`
          });
        }
      }

    /* ── Search Page ────────────────────────────────────── */
    } else if (pathname.startsWith("/search") || search.includes("q=")) {
      activity.name = "VidBox";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "VIDBOX_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }

      const params = new URLSearchParams(search);
      const query = params.get("q") || params.get("query");
      activity.details = "Searching Movies & Shows";
      activity.state = query ? `"${query}"` : "Browsing Search";

    /* ── Watchlist Page ─────────────────────────────────── */
    } else if (pathname.startsWith("/watchlist")) {
      activity.name = "VidBox";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "VIDBOX_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }
      activity.details = "Browsing VidBox";
      activity.state = "Watchlist";

    /* ── Settings Page ──────────────────────────────────── */
    } else if (pathname.startsWith("/settings")) {
      activity.name = "VidBox";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "VIDBOX_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }
      activity.details = "Browsing VidBox";
      activity.state = "Settings";

    /* ── General Browsing Pages ─────────────────────────── */
    } else {
      activity.name = "VidBox";
      if (!settings.browsing) {
        chrome.runtime.sendMessage({ type: "VIDBOX_CLEAR_PRESENCE" }).catch(() => {});
        return;
      }

      activity.details = "Browsing VidBox";

      if (pathname === "/" || pathname === "" || pathname === "/home") {
        activity.state = "Home";
      } else {
        activity.state = "Exploring Catalog";
      }
    }

    // Send payload to background.js -> offscreen.js -> Discord IPC Bridge
    if (currentUpdate === updateCounter) {
      chrome.runtime.sendMessage({
        type: "VIDBOX_SET_PRESENCE",
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
      window.dispatchEvent(new Event("vidbox:routechange"));
      return res;
    };
  }

  const originalReplaceState = history.replaceState;
  if (typeof originalReplaceState === "function") {
    history.replaceState = function (...args) {
      const res = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event("vidbox:routechange"));
      return res;
    };
  }

  window.addEventListener("popstate", onLocationChange);
  window.addEventListener("vidbox:routechange", onLocationChange);

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
