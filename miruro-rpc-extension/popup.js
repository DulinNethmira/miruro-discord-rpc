/**
 * Miruro Discord Rich Presence — Popup Controller
 * Manages live Discord connection status, activity preview, preferences, and custom Discord IDs.
 */

const DEFAULT_APP_ID = "1563994278965813358";

document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const previewPoster = document.getElementById("previewPoster");
  const previewTitle = document.getElementById("previewTitle");
  const previewDesc = document.getElementById("previewDesc");
  const previewBadge = document.getElementById("previewBadge");

  const masterSwitch = document.getElementById("masterSwitch");
  const optBrowsing = document.getElementById("optBrowsing");
  const optTimestamps = document.getElementById("optTimestamps");
  const optCover = document.getElementById("optCover");
  const optButtons = document.getElementById("optButtons");

  const inputUserId = document.getElementById("inputUserId");
  const inputAppId = document.getElementById("inputAppId");
  const btnSaveConfig = document.getElementById("btnSaveConfig");
  const btnResetConfig = document.getElementById("btnResetConfig");
  const saveFeedback = document.getElementById("saveFeedback");

  // Load preferences and state from storage
  const data = await chrome.storage.local.get([
    "enabled",
    "browsing",
    "timestamps",
    "cover",
    "buttons",
    "discordUserId",
    "discordAppId",
    "discordConnected",
    "discordPort",
    "discordUser",
    "lastPresence"
  ]);

  masterSwitch.checked = data.enabled !== false;
  optBrowsing.checked = data.browsing !== false;
  optTimestamps.checked = data.timestamps !== false;
  optCover.checked = data.cover !== false;
  optButtons.checked = data.buttons !== false;

  inputUserId.value = data.discordUserId || "";
  inputAppId.value = data.discordAppId || "";

  // Show connecting state initially if not connected yet
  updateDiscordStatus(Boolean(data.discordConnected), data.discordUser, !data.discordConnected);
  updatePreview(data.lastPresence, data.enabled !== false);

  // Ping background service worker to ensure offscreen document is alive & get status
  chrome.runtime.sendMessage({ type: "CHECK_DISCORD_STATUS" }, (res) => {
    if (res && res.connected) {
      updateDiscordStatus(true, res.user);
    }
  });

  // Settings change handlers (auto-save toggles)
  masterSwitch.addEventListener("change", () => {
    const isEnabled = masterSwitch.checked;
    chrome.storage.local.set({ enabled: isEnabled });
    chrome.storage.local.get(["lastPresence"], (res) => {
      updatePreview(res.lastPresence, isEnabled);
    });
  });

  optBrowsing.addEventListener("change", () => {
    chrome.storage.local.set({ browsing: optBrowsing.checked });
  });

  optTimestamps.addEventListener("change", () => {
    chrome.storage.local.set({ timestamps: optTimestamps.checked });
  });

  optCover.addEventListener("change", () => {
    chrome.storage.local.set({ cover: optCover.checked });
  });

  optButtons.addEventListener("change", () => {
    chrome.storage.local.set({ buttons: optButtons.checked });
  });

  // Save Custom Discord IDs
  btnSaveConfig.addEventListener("click", () => {
    const userId = inputUserId.value.trim().replace(/\D/g, "");
    const appId = inputAppId.value.trim().replace(/\D/g, "");

    inputUserId.value = userId;
    inputAppId.value = appId;

    chrome.storage.local.set({
      discordUserId: userId,
      discordAppId: appId
    }, () => {
      // Notify background / bridge of updated Application ID
      chrome.runtime.sendMessage({
        type: "UPDATE_CONFIG",
        clientId: appId || DEFAULT_APP_ID,
        userId: userId
      }).catch(() => {});

      // Request tabs to resync presence with new button configuration
      chrome.runtime.sendMessage({ type: "FORCE_PRESENCE_SYNC" }).catch(() => {});

      saveFeedback.textContent = "Settings saved!";
      saveFeedback.style.display = "block";
      setTimeout(() => {
        saveFeedback.style.display = "none";
      }, 2500);
    });
  });

  // Reset to default configuration
  btnResetConfig.addEventListener("click", () => {
    inputUserId.value = "";
    inputAppId.value = "";

    chrome.storage.local.set({
      discordUserId: "",
      discordAppId: ""
    }, () => {
      chrome.runtime.sendMessage({
        type: "UPDATE_CONFIG",
        clientId: DEFAULT_APP_ID,
        userId: ""
      }).catch(() => {});

      chrome.runtime.sendMessage({ type: "FORCE_PRESENCE_SYNC" }).catch(() => {});

      saveFeedback.textContent = "Reset to default Miruro App ID!";
      saveFeedback.style.display = "block";
      setTimeout(() => {
        saveFeedback.style.display = "none";
      }, 2500);
    });
  });

  // Watch for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.discordConnected || changes.discordUser) {
        chrome.storage.local.get(["discordConnected", "discordUser"], (res) => {
          updateDiscordStatus(Boolean(res.discordConnected), res.discordUser);
        });
      }
      if (changes.lastPresence) {
        chrome.storage.local.get(["enabled"], (res) => {
          updatePreview(changes.lastPresence.newValue, res.enabled !== false);
        });
      }
    }
  });

  // Direct status message receiver
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "DISCORD_STATUS_UPDATE") {
      updateDiscordStatus(Boolean(msg.connected), msg.user ? msg.user.username : null);
    }
  });

  function updateDiscordStatus(connected, username, connecting = false) {
    statusDot.className = "status-dot";
    if (connected) {
      statusDot.classList.add("connected");
      statusText.textContent = username ? `Connected to Discord (@${username})` : "Connected to Discord (Bridge Online)";
      statusText.style.color = "#4ade80";
    } else if (connecting) {
      statusText.textContent = "Connecting to Bridge...";
      statusText.style.color = "#fcd34d";
    } else {
      statusDot.classList.add("disconnected");
      statusText.textContent = "Bridge Offline — Run setup-bridge.bat";
      statusText.style.color = "#f87171";
    }
  }

  function updatePreview(presence, enabled) {
    if (!enabled) {
      previewPoster.src = "icons/icon-48.png";
      previewTitle.textContent = "Extension Disabled";
      previewDesc.textContent = "Toggle switch above to enable";
      previewBadge.className = "preview-badge badge-idle";
      previewBadge.textContent = "DISABLED";
      return;
    }

    if (!presence) {
      previewPoster.src = "icons/icon-48.png";
      previewTitle.textContent = "No Active Media";
      previewDesc.textContent = "Open Miruro to start";
      previewBadge.className = "preview-badge badge-idle";
      previewBadge.textContent = "IDLE";
      return;
    }

    previewPoster.src = presence.assets?.large_image || "icons/icon-48.png";
    previewTitle.textContent = presence.details || presence.name || "Miruro";
    previewDesc.textContent = presence.state || "Active";

    previewBadge.className = "preview-badge";
    const smallText = presence.assets?.small_text?.toLowerCase();

    if (smallText === "playing") {
      previewBadge.classList.add("badge-playing");
      previewBadge.textContent = "PLAYING";
    } else if (smallText === "paused") {
      previewBadge.classList.add("badge-paused");
      previewBadge.textContent = "PAUSED";
    } else if (
      presence.details?.toLowerCase().includes("browsing") ||
      presence.details?.toLowerCase().includes("viewing")
    ) {
      previewBadge.classList.add("badge-browsing");
      previewBadge.textContent = "BROWSING";
    } else {
      previewBadge.classList.add("badge-idle");
      previewBadge.textContent = "ACTIVE";
    }
  }
});
