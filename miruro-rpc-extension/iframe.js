/**
 * Miruro Discord Rich Presence — Video iFrame Bridge
 * Injected into embedded player frames (<all_urls>, all_frames: true)
 * Immediately transmits <video> playback events to content.js and background.js.
 */

(function () {
  // Only execute inside child iframe contexts
  if (window === window.top) return;

  let boundVideo = null;
  let syncInterval = null;

  function sendVideoData() {
    const video = document.querySelector("video");
    if (!video) return;

    const data = {
      currentTime: Number(video.currentTime) || 0,
      duration: Number(video.duration) || 0,
      paused: Boolean(video.paused)
    };

    // Manage 1-second live playback position sync interval
    if (!video.paused && !syncInterval) {
      syncInterval = setInterval(sendVideoData, 1000);
    } else if (video.paused && syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }

    // 1. Send to background.js
    try {
      chrome.runtime.sendMessage({
        type: "MIRURO_VIDEO_STATE",
        data: data
      }).catch(() => {});
    } catch (_) {}

    // 2. Direct postMessage to parent frame
    try {
      window.parent.postMessage({
        type: "MIRURO_VIDEO_STATE",
        data: data
      }, "*");
    } catch (_) {}
  }

  function bindVideoEvents(video) {
    if (!video || boundVideo === video) return;

    if (boundVideo) {
      try {
        boundVideo.removeEventListener("play", sendVideoData);
        boundVideo.removeEventListener("pause", sendVideoData);
        boundVideo.removeEventListener("seeked", sendVideoData);
        boundVideo.removeEventListener("loadedmetadata", sendVideoData);
        boundVideo.removeEventListener("ratechange", sendVideoData);
      } catch (_) {}
    }

    boundVideo = video;
    video.addEventListener("play", sendVideoData);
    video.addEventListener("pause", sendVideoData);
    video.addEventListener("seeked", sendVideoData);
    video.addEventListener("loadedmetadata", sendVideoData);
    video.addEventListener("ratechange", sendVideoData);

    sendVideoData();
  }

  function checkAndBind() {
    const video = document.querySelector("video");
    if (video) {
      bindVideoEvents(video);
    }
  }

  // Initial check
  checkAndBind();

  // Watch for dynamically mounted video players
  const target = document.body || document.documentElement;
  if (target) {
    const observer = new MutationObserver(() => {
      const video = document.querySelector("video");
      if (video && video !== boundVideo) {
        bindVideoEvents(video);
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true
    });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      checkAndBind();
      if (document.body) {
        const observer = new MutationObserver(() => {
          const video = document.querySelector("video");
          if (video && video !== boundVideo) {
            bindVideoEvents(video);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  }
})();
