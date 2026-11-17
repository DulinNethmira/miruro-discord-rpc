/**
 * Miruro, VidBox & Cinejoy Discord Rich Presence — Popup Controller
 * Manages tri-service tabs (Miruro / VidBox / Cinejoy), previews, preferences, and custom Discord IDs.
 */

const DEFAULT_APP_ID = "1563994278965813358";

document.addEventListener("DOMContentLoaded", async () => {
  // Tab Elements
  const tabBtnMiruro = document.getElementById("tabBtnMiruro");
  const tabBtnVidbox = document.getElementById("tabBtnVidbox");
  const tabBtnCinejoy = document.getElementById("tabBtnCinejoy");
  const panelMiruro = document.getElementById("panelMiruro");
  const panelVidbox = document.getElementById("panelVidbox");
  const panelCinejoy = document.getElementById("panelCinejoy");

  // Connection Status Elements
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  // Miruro Panel Elements
  const miruroPreviewPoster = document.getElementById("miruroPreviewPoster");
  const miruroPreviewTitle = document.getElementById("miruroPreviewTitle");
  const miruroPreviewDesc = document.getElementById("miruroPreviewDesc");
  const miruroPreviewBadge = document.getElementById("miruroPreviewBadge");
  const miruroMasterSwitch = document.getElementById("miruroMasterSwitch");
  const miruroOptBrowsing = document.getElementById("miruroOptBrowsing");
  const miruroOptTimestamps = document.getElementById("miruroOptTimestamps");
  const miruroOptCover = document.getElementById("miruroOptCover");
  const miruroOptButtons = document.getElementById("miruroOptButtons");

  // VidBox Panel Elements
  const vidboxPreviewPoster = document.getElementById("vidboxPreviewPoster");
  const vidboxPreviewTitle = document.getElementById("vidboxPreviewTitle");
  const vidboxPreviewDesc = document.getElementById("vidboxPreviewDesc");
  const vidboxPreviewBadge = document.getElementById("vidboxPreviewBadge");
  const vidboxMasterSwitch = document.getElementById("vidboxMasterSwitch");
  const vidboxOptBrowsing = document.getElementById("vidboxOptBrowsing");
  const vidboxOptTimestamps = document.getElementById("vidboxOptTimestamps");
  const vidboxOptCover = document.getElementById("vidboxOptCover");
  const vidboxOptButtons = document.getElementById("vidboxOptButtons");

  // Cinejoy Panel Elements
  const cinejoyPreviewPoster = document.getElementById("cinejoyPreviewPoster");
  const cinejoyPreviewTitle = document.getElementById("cinejoyPreviewTitle");
  const cinejoyPreviewDesc = document.getElementById("cinejoyPreviewDesc");
  const cinejoyPreviewBadge = document.getElementById("cinejoyPreviewBadge");
  const cinejoyMasterSwitch = document.getElementById("cinejoyMasterSwitch");
  const cinejoyOptBrowsing = document.getElementById("cinejoyOptBrowsing");
  const cinejoyOptTimestamps = document.getElementById("cinejoyOptTimestamps");
  const cinejoyOptCover = document.getElementById("cinejoyOptCover");
  const cinejoyOptButtons = document.getElementById("cinejoyOptButtons");

  // Discord Configuration Elements
  const inputUserId = document.getElementById("inputUserId");
  const inputAppId = document.getElementById("inputAppId");
  const btnSaveConfig = document.getElementById("btnSaveConfig");
  const btnResetConfig = document.getElementById("btnResetConfig");
  const saveFeedback = document.getElementById("saveFeedback");

  // Load preferences and state from storage
  const data = await chrome.storage.local.get([
    "activeTab",
    // Miruro
    "miruro_enabled",
    "miruro_browsing",
    "miruro_timestamps",
    "miruro_cover",
    "miruro_buttons",
    "miruro_lastPresence",
    // VidBox
    "vidbox_enabled",
    "vidbox_browsing",
    "vidbox_timestamps",
    "vidbox_cover",
    "vidbox_buttons",
    "vidbox_lastPresence",
    // Cinejoy
    "cinejoy_enabled",
    "cinejoy_browsing",
    "cinejoy_timestamps",
    "cinejoy_cover",
    "cinejoy_buttons",
    "cinejoy_lastPresence",
    // Legacy Miruro fallbacks
    "enabled",
    "browsing",
    "timestamps",
    "cover",
    "buttons",
    "lastPresence",
    // Shared
    "discordUserId",
    "discordAppId",
    "discordConnected",
    "discordPort",
    "discordUser"
  ]);

  // Tab activation
  const activeTab = data.activeTab || "miruro";
  switchTab(activeTab);

  tabBtnMiruro.addEventListener("click", () => switchTab("miruro"));
  tabBtnVidbox.addEventListener("click", () => switchTab("vidbox"));
  tabBtnCinejoy.addEventListener("click", () => switchTab("cinejoy"));

  function switchTab(tab) {
    const isMiruro = tab === "miruro";
    const isVidbox = tab === "vidbox";
    const isCinejoy = tab === "cinejoy";

    tabBtnMiruro.classList.toggle("active", isMiruro);
    tabBtnVidbox.classList.toggle("active", isVidbox);
    tabBtnCinejoy.classList.toggle("active", isCinejoy);

    panelMiruro.classList.toggle("active", isMiruro);
    panelVidbox.classList.toggle("active", isVidbox);
    panelCinejoy.classList.toggle("active", isCinejoy);

    chrome.storage.local.set({ activeTab: tab });
  }

  // Populate Miruro controls
  const miruroEnabled = data.miruro_enabled !== undefined ? data.miruro_enabled : (data.enabled !== false);
  miruroMasterSwitch.checked = miruroEnabled;
  miruroOptBrowsing.checked = data.miruro_browsing !== undefined ? data.miruro_browsing : (data.browsing !== false);
  miruroOptTimestamps.checked = data.miruro_timestamps !== undefined ? data.miruro_timestamps : (data.timestamps !== false);
  miruroOptCover.checked = data.miruro_cover !== undefined ? data.miruro_cover : (data.cover !== false);
  miruroOptButtons.checked = data.miruro_buttons !== undefined ? data.miruro_buttons : (data.buttons !== false);

  // Populate VidBox controls
  const vidboxEnabled = data.vidbox_enabled !== undefined ? data.vidbox_enabled : true;
  vidboxMasterSwitch.checked = vidboxEnabled;
  vidboxOptBrowsing.checked = data.vidbox_browsing !== undefined ? data.vidbox_browsing : true;
  vidboxOptTimestamps.checked = data.vidbox_timestamps !== undefined ? data.vidbox_timestamps : true;
  vidboxOptCover.checked = data.vidbox_cover !== undefined ? data.vidbox_cover : true;
  vidboxOptButtons.checked = data.vidbox_buttons !== undefined ? data.vidbox_buttons : true;

  // Populate Cinejoy controls
  const cinejoyEnabled = data.cinejoy_enabled !== undefined ? data.cinejoy_enabled : true;
  cinejoyMasterSwitch.checked = cinejoyEnabled;
  cinejoyOptBrowsing.checked = data.cinejoy_browsing !== undefined ? data.cinejoy_browsing : true;
  cinejoyOptTimestamps.checked = data.cinejoy_timestamps !== undefined ? data.cinejoy_timestamps : true;
  cinejoyOptCover.checked = data.cinejoy_cover !== undefined ? data.cinejoy_cover : true;
  cinejoyOptButtons.checked = data.cinejoy_buttons !== undefined ? data.cinejoy_buttons : true;

  // Discord Configuration
  inputUserId.value = data.discordUserId || "";
  inputAppId.value = data.discordAppId || "";

  // Initial connection & previews
  updateDiscordStatus(Boolean(data.discordConnected), data.discordUser, !data.discordConnected);
  updateMiruroPreview(data.miruro_lastPresence || (data.lastPresence?.name?.includes("Miruro") ? data.lastPresence : null), miruroEnabled);
  updateVidboxPreview(data.vidbox_lastPresence, vidboxEnabled);
  updateCinejoyPreview(data.cinejoy_lastPresence, cinejoyEnabled);

  // Ping background service worker to ensure offscreen is alive & sync status
  chrome.runtime.sendMessage({ type: "CHECK_DISCORD_STATUS" }, (res) => {
    if (res && res.connected) {
      updateDiscordStatus(true, res.user);
    }
  });

  // ── Miruro Event Listeners ─────────────────────────────────
  miruroMasterSwitch.addEventListener("change", () => {
    const isEnabled = miruroMasterSwitch.checked;
    chrome.storage.local.set({ miruro_enabled: isEnabled, enabled: isEnabled });
    chrome.storage.local.get(["miruro_lastPresence"], (res) => {
      updateMiruroPreview(res.miruro_lastPresence, isEnabled);
    });
  });

  miruroOptBrowsing.addEventListener("change", () => {
    chrome.storage.local.set({ miruro_browsing: miruroOptBrowsing.checked, browsing: miruroOptBrowsing.checked });
  });

  miruroOptTimestamps.addEventListener("change", () => {
    chrome.storage.local.set({ miruro_timestamps: miruroOptTimestamps.checked, timestamps: miruroOptTimestamps.checked });
  });

  miruroOptCover.addEventListener("change", () => {
    chrome.storage.local.set({ miruro_cover: miruroOptCover.checked, cover: miruroOptCover.checked });
  });

  miruroOptButtons.addEventListener("change", () => {
    chrome.storage.local.set({ miruro_buttons: miruroOptButtons.checked, buttons: miruroOptButtons.checked });
  });

  // ── VidBox Event Listeners ─────────────────────────────────
  vidboxMasterSwitch.addEventListener("change", () => {
    const isEnabled = vidboxMasterSwitch.checked;
    chrome.storage.local.set({ vidbox_enabled: isEnabled });
    chrome.storage.local.get(["vidbox_lastPresence"], (res) => {
      updateVidboxPreview(res.vidbox_lastPresence, isEnabled);
    });
  });

  vidboxOptBrowsing.addEventListener("change", () => {
    chrome.storage.local.set({ vidbox_browsing: vidboxOptBrowsing.checked });
  });

  vidboxOptTimestamps.addEventListener("change", () => {
    chrome.storage.local.set({ vidbox_timestamps: vidboxOptTimestamps.checked });
  });

  vidboxOptCover.addEventListener("change", () => {
    chrome.storage.local.set({ vidbox_cover: vidboxOptCover.checked });
  });

  vidboxOptButtons.addEventListener("change", () => {
    chrome.storage.local.set({ vidbox_buttons: vidboxOptButtons.checked });
  });

  // ── Cinejoy Event Listeners ────────────────────────────────
  cinejoyMasterSwitch.addEventListener("change", () => {
    const isEnabled = cinejoyMasterSwitch.checked;
    chrome.storage.local.set({ cinejoy_enabled: isEnabled });
    chrome.storage.local.get(["cinejoy_lastPresence"], (res) => {
      updateCinejoyPreview(res.cinejoy_lastPresence, isEnabled);
    });
  });

  cinejoyOptBrowsing.addEventListener("change", () => {
    chrome.storage.local.set({ cinejoy_browsing: cinejoyOptBrowsing.checked });
  });

  cinejoyOptTimestamps.addEventListener("change", () => {
    chrome.storage.local.set({ cinejoy_timestamps: cinejoyOptTimestamps.checked });
  });

  cinejoyOptCover.addEventListener("change", () => {
    chrome.storage.local.set({ cinejoy_cover: cinejoyOptCover.checked });
  });

  cinejoyOptButtons.addEventListener("change", () => {
    chrome.storage.local.set({ cinejoy_buttons: cinejoyOptButtons.checked });
  });

  // ── Save Custom Discord IDs ────────────────────────────────
  btnSaveConfig.addEventListener("click", () => {
    const userId = inputUserId.value.trim().replace(/\D/g, "");
    const appId = inputAppId.value.trim().replace(/\D/g, "");

    inputUserId.value = userId;
    inputAppId.value = appId;

    chrome.storage.local.set({
      discordUserId: userId,
      discordAppId: appId
    }, () => {
      chrome.runtime.sendMessage({
        type: "UPDATE_CONFIG",
        clientId: appId || DEFAULT_APP_ID,
        userId: userId
      }).catch(() => {});

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

      saveFeedback.textContent = "Reset to default Application ID!";
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
      if (changes.miruro_lastPresence || changes.miruro_enabled) {
        chrome.storage.local.get(["miruro_lastPresence", "miruro_enabled"], (res) => {
          updateMiruroPreview(res.miruro_lastPresence, res.miruro_enabled !== false);
        });
      }
      if (changes.vidbox_lastPresence || changes.vidbox_enabled) {
        chrome.storage.local.get(["vidbox_lastPresence", "vidbox_enabled"], (res) => {
          updateVidboxPreview(res.vidbox_lastPresence, res.vidbox_enabled !== false);
        });
      }
      if (changes.cinejoy_lastPresence || changes.cinejoy_enabled) {
        chrome.storage.local.get(["cinejoy_lastPresence", "cinejoy_enabled"], (res) => {
          updateCinejoyPreview(res.cinejoy_lastPresence, res.cinejoy_enabled !== false);
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

  function updateMiruroPreview(presence, enabled) {
    if (!enabled) {
      miruroPreviewPoster.src = "icons/icon-48.png";
      miruroPreviewTitle.textContent = "Miruro Presence Disabled";
      miruroPreviewDesc.textContent = "Toggle switch above to enable";
      miruroPreviewBadge.className = "preview-badge badge-idle";
      miruroPreviewBadge.textContent = "DISABLED";
      return;
    }

    if (!presence) {
      miruroPreviewPoster.src = "icons/icon-48.png";
      miruroPreviewTitle.textContent = "No Active Anime";
      miruroPreviewDesc.textContent = "Open Miruro to start";
      miruroPreviewBadge.className = "preview-badge badge-idle";
      miruroPreviewBadge.textContent = "IDLE";
      return;
    }

    miruroPreviewPoster.src = presence.assets?.large_image || "icons/icon-48.png";
    miruroPreviewTitle.textContent = presence.details || presence.name || "Miruro";
    miruroPreviewDesc.textContent = presence.state || "Active";

    miruroPreviewBadge.className = "preview-badge";
    const smallText = presence.assets?.small_text?.toLowerCase();

    if (
      presence.state?.toLowerCase().includes("rewatching") ||
      smallText?.includes("rewatching")
    ) {
      miruroPreviewBadge.classList.add("badge-rewatching");
      miruroPreviewBadge.textContent = "REWATCHING";
    } else if (smallText === "playing") {
      miruroPreviewBadge.classList.add("badge-playing");
      miruroPreviewBadge.textContent = "PLAYING";
    } else if (smallText === "paused") {
      miruroPreviewBadge.classList.add("badge-paused");
      miruroPreviewBadge.textContent = "PAUSED";
    } else if (
      presence.details?.toLowerCase().includes("browsing") ||
      presence.details?.toLowerCase().includes("viewing")
    ) {
      miruroPreviewBadge.classList.add("badge-browsing");
      miruroPreviewBadge.textContent = "BROWSING";
    } else {
      miruroPreviewBadge.classList.add("badge-idle");
      miruroPreviewBadge.textContent = "ACTIVE";
    }
  }

  function updateVidboxPreview(presence, enabled) {
    if (!enabled) {
      vidboxPreviewPoster.src = "icons/vidbox-icon.png";
      vidboxPreviewTitle.textContent = "VidBox Presence Disabled";
      vidboxPreviewDesc.textContent = "Toggle switch above to enable";
      vidboxPreviewBadge.className = "preview-badge badge-idle";
      vidboxPreviewBadge.textContent = "DISABLED";
      return;
    }

    if (!presence) {
      vidboxPreviewPoster.src = "icons/vidbox-icon.png";
      vidboxPreviewTitle.textContent = "No Active Movie / TV";
      vidboxPreviewDesc.textContent = "Open VidBox to start";
      vidboxPreviewBadge.className = "preview-badge badge-idle";
      vidboxPreviewBadge.textContent = "IDLE";
      return;
    }

    vidboxPreviewPoster.src = presence.assets?.large_image || "icons/vidbox-icon.png";
    vidboxPreviewTitle.textContent = presence.details || presence.name || "VidBox";
    vidboxPreviewDesc.textContent = presence.state || "Active";

    vidboxPreviewBadge.className = "preview-badge";
    const smallText = presence.assets?.small_text?.toLowerCase();

    if (
      smallText === "playing" ||
      presence.state?.toLowerCase().includes("watching")
    ) {
      vidboxPreviewBadge.classList.add("badge-playing");
      vidboxPreviewBadge.textContent = "PLAYING";
    } else if (smallText === "paused" || presence.state?.toLowerCase().includes("paused")) {
      vidboxPreviewBadge.classList.add("badge-paused");
      vidboxPreviewBadge.textContent = "PAUSED";
    } else if (
      presence.details?.toLowerCase().includes("browsing") ||
      presence.details?.toLowerCase().includes("viewing") ||
      presence.state?.toLowerCase().includes("details")
    ) {
      vidboxPreviewBadge.classList.add("badge-browsing");
      vidboxPreviewBadge.textContent = "BROWSING";
    } else {
      vidboxPreviewBadge.classList.add("badge-idle");
      vidboxPreviewBadge.textContent = "ACTIVE";
    }
  }

  function updateCinejoyPreview(presence, enabled) {
    if (!enabled) {
      cinejoyPreviewPoster.src = "icons/cinejoy-icon.png";
      cinejoyPreviewTitle.textContent = "Cinejoy Presence Disabled";
      cinejoyPreviewDesc.textContent = "Toggle switch above to enable";
      cinejoyPreviewBadge.className = "preview-badge badge-idle";
      cinejoyPreviewBadge.textContent = "DISABLED";
      return;
    }

    if (!presence) {
      cinejoyPreviewPoster.src = "icons/cinejoy-icon.png";
      cinejoyPreviewTitle.textContent = "No Active Movie / TV";
      cinejoyPreviewDesc.textContent = "Open Cinejoy to start";
      cinejoyPreviewBadge.className = "preview-badge badge-idle";
      cinejoyPreviewBadge.textContent = "IDLE";
      return;
    }

    cinejoyPreviewPoster.src = presence.assets?.large_image || "icons/cinejoy-icon.png";
    cinejoyPreviewTitle.textContent = presence.details || presence.name || "Cinejoy";
    cinejoyPreviewDesc.textContent = presence.state || "Active";

    cinejoyPreviewBadge.className = "preview-badge";
    const smallText = presence.assets?.small_text?.toLowerCase();

    if (
      smallText === "playing" ||
      presence.state?.toLowerCase().includes("watching")
    ) {
      cinejoyPreviewBadge.classList.add("badge-playing");
      cinejoyPreviewBadge.textContent = "PLAYING";
    } else if (smallText === "paused" || presence.state?.toLowerCase().includes("paused")) {
      cinejoyPreviewBadge.classList.add("badge-paused");
      cinejoyPreviewBadge.textContent = "PAUSED";
    } else if (
      presence.details?.toLowerCase().includes("browsing") ||
      presence.details?.toLowerCase().includes("viewing") ||
      presence.state?.toLowerCase().includes("details")
    ) {
      cinejoyPreviewBadge.classList.add("badge-browsing");
      cinejoyPreviewBadge.textContent = "BROWSING";
    } else {
      cinejoyPreviewBadge.classList.add("badge-idle");
      cinejoyPreviewBadge.textContent = "ACTIVE";
    }
  }
});
