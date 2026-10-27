/* ─────────────────────────────────────────────────────────
 *  Miruro — PreMiD iFrame Bridge
 *
 *  Runs inside the video player iframe context.
 *  Attaches live event listeners directly to <video> to send
 *  instant playback state updates to presence.js.
 * ───────────────────────────────────────────────────────── */

const iframe = new iFrame();

let boundVideo = null;

/**
 * Dispatch current video playback state to presence.js
 */
function sendVideoData() {
  const video = document.querySelector("video");
  if (video) {
    iframe.send({
      currentTime: Number(video.currentTime) || 0,
      duration: Number(video.duration) || 0,
      paused: Boolean(video.paused),
    });
  }
}

/**
 * Attach event listeners directly to the <video> element for instant sync.
 * Fires the exact millisecond the user plays, pauses, seeks, or changes speed.
 */
function bindVideoEvents(video) {
  if (!video || boundVideo === video) return;

  // Detach old listeners if the video element was replaced
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
}

/**
 * Find and bind the active <video> element and send the current state
 */
function checkAndBind() {
  const video = document.querySelector("video");
  if (video) {
    bindVideoEvents(video);
    sendVideoData();
  }
}

// 1. Initial check immediately on script execution
checkAndBind();

// 2. PreMiD standard polling hook
iframe.on("UpdateData", async () => {
  checkAndBind();
});

// 3. MutationObserver: catch dynamically injected or replaced <video> elements
const observerTarget = document.body || document.documentElement;
if (observerTarget) {
  const observer = new MutationObserver(() => {
    const video = document.querySelector("video");
    if (video && video !== boundVideo) {
      bindVideoEvents(video);
      sendVideoData();
    }
  });

  observer.observe(observerTarget, {
    childList: true,
    subtree: true,
  });
} else {
  document.addEventListener("DOMContentLoaded", () => {
    checkAndBind();
    if (document.body) {
      const observer = new MutationObserver(() => {
        const video = document.querySelector("video");
        if (video && video !== boundVideo) {
          bindVideoEvents(video);
          sendVideoData();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });
}
