/**
 * Miruro & VidBox Discord Rich Presence — Background Service Worker
 * Coordinates content scripts, tab lifecycles, dual-service arbitration, settings, and offscreen Discord bridge.
 */

const MIRURO_URL_PATTERNS = [
  "*://*.miruro.tv/*",
  "*://*.miruro.cx/*",
  "*://*.miruro.online/*"
];

const VIDBOX_URL_PATTERNS = [
  "*://*.vidbox.wtf/*",
  "*://*.vidbox.to/*",
  "*://*.vidbox.cc/*",
  "*://*.vidbox.ag/*",
  "*://*.vidbox.me/*"
];

// In-memory state tracking
const activePresences = {
  miruro: null,
  vidbox: null
};

const activePlayback = {
  miruro: false,
  vidbox: false
};

let lastActiveService = "miruro";

// Ensure Origin header bypass rules are active for local Discord WebSocket probe
async function ensureOriginRules() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1001, 1002],
      addRules: [
        {
          id: 1001,
          priority: 10,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://discord.com" }
            ]
          },
          condition: {
            urlFilter: "||127.0.0.1",
            resourceTypes: ["websocket", "xmlhttprequest", "other"]
          }
        },
        {
          id: 1002,
          priority: 10,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://discord.com" }
            ]
          },
          condition: {
            urlFilter: "127.0.0.1",
            resourceTypes: ["websocket", "xmlhttprequest", "other"]
          }
        }
      ]
    });
    console.log("[ServiceWorker] Dynamic declarativeNetRequest rules registered.");
  } catch (err) {
    console.warn("[ServiceWorker] Rule registration warning:", err);
  }
}

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    "miruro_enabled",
    "miruro_browsing",
    "miruro_timestamps",
    "miruro_cover",
    "miruro_buttons",
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
    "discordAppId",
    "activeTab"
  ]);

  const defaults = {
    // Miruro settings (preserving legacy 'enabled' if previously set)
    miruro_enabled: data.miruro_enabled !== undefined ? data.miruro_enabled : (data.enabled !== false),
    miruro_browsing: data.miruro_browsing !== undefined ? data.miruro_browsing : (data.browsing !== false),
    miruro_timestamps: data.miruro_timestamps !== undefined ? data.miruro_timestamps : (data.timestamps !== false),
    miruro_cover: data.miruro_cover !== undefined ? data.miruro_cover : (data.cover !== false),
    miruro_buttons: data.miruro_buttons !== undefined ? data.miruro_buttons : (data.buttons !== false),

    // VidBox settings
    vidbox_enabled: data.vidbox_enabled !== undefined ? data.vidbox_enabled : true,
    vidbox_browsing: data.vidbox_browsing !== undefined ? data.vidbox_browsing : true,
    vidbox_timestamps: data.vidbox_timestamps !== undefined ? data.vidbox_timestamps : true,
    vidbox_cover: data.vidbox_cover !== undefined ? data.vidbox_cover : true,
    vidbox_buttons: data.vidbox_buttons !== undefined ? data.vidbox_buttons : true,

    // Shared Discord Settings
    discordUserId: data.discordUserId || "",
    discordAppId: data.discordAppId || "",
    activeTab: data.activeTab || "miruro",

    miruro_lastPresence: null,
    vidbox_lastPresence: null,
    lastPresence: null,
    discordConnected: false,
    discordPort: null
  };

  await chrome.storage.local.set(defaults);
  await ensureOriginRules();
  await ensureOffscreenDocument();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureOriginRules();
  await ensureOffscreenDocument();
});

/**
 * Ensure the offscreen document is open and running the Discord WebSocket engine
 */
async function ensureOffscreenDocument() {
  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) {
      return;
    }
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"]
      });
      if (contexts && contexts.length > 0) return;
    }

    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.WEB_RTC || "WEB_RTC"],
      justification: "Maintain live WebSocket connection to local Discord RPC client"
    });
    console.log("[ServiceWorker] Offscreen document launched.");
  } catch (err) {
    console.warn("[ServiceWorker] ensureOffscreenDocument:", err.message);
  }
}

/**
 * Core Presence Arbitration Engine:
 * Selects between Miruro and VidBox presence based on video playback and active tab focus.
 */
async function syncDiscordActivity() {
  const settings = await chrome.storage.local.get([
    "miruro_enabled",
    "vidbox_enabled",
    "enabled"
  ]);

  const miruroEnabled = settings.miruro_enabled !== undefined ? settings.miruro_enabled : (settings.enabled !== false);
  const vidboxEnabled = settings.vidbox_enabled !== undefined ? settings.vidbox_enabled : true;

  let chosenActivity = null;

  // Rule 1: Active video playback takes absolute priority
  if (activePlayback.vidbox && activePresences.vidbox && vidboxEnabled) {
    chosenActivity = activePresences.vidbox;
  } else if (activePlayback.miruro && activePresences.miruro && miruroEnabled) {
    chosenActivity = activePresences.miruro;
  } else {
    // Rule 2: Most recently updated or active service tab
    if (lastActiveService === "vidbox" && activePresences.vidbox && vidboxEnabled) {
      chosenActivity = activePresences.vidbox;
    } else if (lastActiveService === "miruro" && activePresences.miruro && miruroEnabled) {
      chosenActivity = activePresences.miruro;
    } else if (activePresences.miruro && miruroEnabled) {
      chosenActivity = activePresences.miruro;
    } else if (activePresences.vidbox && vidboxEnabled) {
      chosenActivity = activePresences.vidbox;
    }
  }

  if (chosenActivity) {
    await chrome.storage.local.set({ lastPresence: chosenActivity });
    chrome.runtime.sendMessage({
      type: "SET_ACTIVITY",
      activity: chosenActivity
    }).catch(() => {});
  } else {
    await chrome.storage.local.set({ lastPresence: null });
    chrome.runtime.sendMessage({ type: "CLEAR_ACTIVITY" }).catch(() => {});
  }
}

/**
 * Check if active tabs remain open for Miruro and VidBox.
 */
async function checkAllTabs() {
  try {
    const miruroTabs = await chrome.tabs.query({ url: MIRURO_URL_PATTERNS });
    if (!miruroTabs || miruroTabs.length === 0) {
      activePresences.miruro = null;
      activePlayback.miruro = false;
      await chrome.storage.local.set({ miruro_lastPresence: null });
    }

    const vidboxTabs = await chrome.tabs.query({ url: VIDBOX_URL_PATTERNS });
    if (!vidboxTabs || vidboxTabs.length === 0) {
      activePresences.vidbox = null;
      activePlayback.vidbox = false;
      await chrome.storage.local.set({ vidbox_lastPresence: null });
    }

    await syncDiscordActivity();
  } catch (err) {
    console.warn("[ServiceWorker] checkAllTabs error:", err);
  }
}

chrome.tabs.onRemoved.addListener(() => {
  checkAllTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    checkAllTabs();
  }
});

// Detect tab switching to automatically surface active service
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab || !tab.url) return;

    if (
      tab.url.includes("miruro.tv") ||
      tab.url.includes("miruro.cx") ||
      tab.url.includes("miruro.online")
    ) {
      lastActiveService = "miruro";
      syncDiscordActivity();
    } else if (
      tab.url.includes("vidbox.wtf") ||
      tab.url.includes("vidbox.to") ||
      tab.url.includes("vidbox.cc") ||
      tab.url.includes("vidbox.ag") ||
      tab.url.includes("vidbox.me")
    ) {
      lastActiveService = "vidbox";
      syncDiscordActivity();
    }
  } catch (_) {}
});

// React to user changes in popup toggles
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.miruro_enabled || changes.vidbox_enabled || changes.enabled) {
      syncDiscordActivity();
      requestTabsPresenceUpdate();
    }
  }
});

async function requestTabsPresenceUpdate() {
  const miruroTabs = await chrome.tabs.query({ url: MIRURO_URL_PATTERNS });
  for (const tab of miruroTabs) {
    chrome.tabs.sendMessage(tab.id, { type: "FORCE_PRESENCE_SYNC" }, { frameId: 0 }).catch(() => {});
  }

  const vidboxTabs = await chrome.tabs.query({ url: VIDBOX_URL_PATTERNS });
  for (const tab of vidboxTabs) {
    chrome.tabs.sendMessage(tab.id, { type: "FORCE_PRESENCE_SYNC" }, { frameId: 0 }).catch(() => {});
  }
}

// Message routing center
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ensureOffscreenDocument();

  // 1. Relay iframe video playback event to top-level content script of the sender tab
  if (message.type === "VIDEO_STATE" || message.type === "MIRURO_VIDEO_STATE") {
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: "VIDEO_STATE", data: message.data },
        { frameId: 0 }
      ).catch(() => {});
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: "MIRURO_VIDEO_STATE", data: message.data },
        { frameId: 0 }
      ).catch(() => {});
    }
    sendResponse({ received: true });
    return true;
  }

  // 2. Miruro Presence update
  if (message.type === "MIRURO_SET_PRESENCE") {
    activePresences.miruro = message.data;
    activePlayback.miruro = message.data?.assets?.small_text?.toLowerCase() === "playing";
    lastActiveService = "miruro";

    chrome.storage.local.set({ miruro_lastPresence: message.data }).catch(() => {});
    syncDiscordActivity();
    sendResponse({ received: true });
    return true;
  }

  // 3. VidBox Presence update
  if (message.type === "VIDBOX_SET_PRESENCE") {
    activePresences.vidbox = message.data;
    activePlayback.vidbox = message.data?.assets?.small_text?.toLowerCase() === "playing";
    lastActiveService = "vidbox";

    chrome.storage.local.set({ vidbox_lastPresence: message.data }).catch(() => {});
    syncDiscordActivity();
    sendResponse({ received: true });
    return true;
  }

  // 4. Miruro Clear Presence
  if (message.type === "MIRURO_CLEAR_PRESENCE") {
    activePresences.miruro = null;
    activePlayback.miruro = false;
    chrome.storage.local.set({ miruro_lastPresence: null }).catch(() => {});
    syncDiscordActivity();
    sendResponse({ received: true });
    return true;
  }

  // 5. VidBox Clear Presence
  if (message.type === "VIDBOX_CLEAR_PRESENCE") {
    activePresences.vidbox = null;
    activePlayback.vidbox = false;
    chrome.storage.local.set({ vidbox_lastPresence: null }).catch(() => {});
    syncDiscordActivity();
    sendResponse({ received: true });
    return true;
  }

  // 6. Update Discord connection status from offscreen document
  if (message.type === "DISCORD_STATUS_UPDATE") {
    chrome.storage.local.set({
      discordConnected: Boolean(message.connected),
      discordPort: message.port || null,
      discordUser: message.user ? message.user.username : null
    }).catch(() => {});
    sendResponse({ received: true });
    return true;
  }

  // 7. Query Discord connection status from popup
  if (message.type === "GET_DISCORD_STATUS" || message.type === "CHECK_DISCORD_STATUS") {
    ensureOffscreenDocument();
    chrome.storage.local.get(["discordConnected", "discordPort", "discordUser"], (res) => {
      sendResponse({
        connected: Boolean(res.discordConnected),
        port: res.discordPort || null,
        user: res.discordUser || null
      });
    });
    return true;
  }

  // 8. Update Bridge Client ID Configuration
  if (message.type === "UPDATE_CONFIG") {
    ensureOffscreenDocument();
    chrome.runtime.sendMessage({
      type: "UPDATE_CONFIG",
      clientId: message.clientId
    }).catch(() => {});
    sendResponse({ received: true });
    return true;
  }

  // 9. Force all service tabs to sync presence
  if (message.type === "FORCE_PRESENCE_SYNC") {
    requestTabsPresenceUpdate();
    sendResponse({ received: true });
    return true;
  }

  return false;
});
