/**
 * Miruro Discord Rich Presence — Background Service Worker
 * Coordinates content scripts, tab lifecycles, settings, and offscreen Discord bridge.
 */

const MIRURO_URL_PATTERNS = [
  "*://*.miruro.tv/*",
  "*://*.miruro.cx/*",
  "*://*.miruro.online/*"
];

// Ensure Origin header bypass rules are active
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
    console.log("[Miruro ServiceWorker] Dynamic declarativeNetRequest rules registered.");
  } catch (err) {
    console.warn("[Miruro ServiceWorker] Rule registration warning:", err);
  }
}

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    "enabled",
    "browsing",
    "timestamps",
    "cover",
    "buttons",
    "discordUserId",
    "discordAppId"
  ]);

  const defaults = {
    enabled: data.enabled !== undefined ? data.enabled : true,
    browsing: data.browsing !== undefined ? data.browsing : true,
    timestamps: data.timestamps !== undefined ? data.timestamps : true,
    cover: data.cover !== undefined ? data.cover : true,
    buttons: data.buttons !== undefined ? data.buttons : true,
    discordUserId: data.discordUserId || "",
    discordAppId: data.discordAppId || "",
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
    console.log("[Miruro ServiceWorker] Offscreen document launched.");
  } catch (err) {
    console.warn("[Miruro ServiceWorker] ensureOffscreenDocument:", err.message);
  }
}

/**
 * Check if any Miruro tabs remain open. If none, clear Discord RPC status.
 */
async function checkMiruroTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: MIRURO_URL_PATTERNS });
    if (!tabs || tabs.length === 0) {
      console.log("[Miruro ServiceWorker] No active Miruro tabs remaining. Clearing Discord activity.");
      await chrome.storage.local.set({ lastPresence: null });
      chrome.runtime.sendMessage({ type: "CLEAR_ACTIVITY" }).catch(() => {});
    }
  } catch (err) {
    console.warn("[Miruro ServiceWorker] checkMiruroTabs error:", err);
  }
}

chrome.tabs.onRemoved.addListener(() => {
  checkMiruroTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    checkMiruroTabs();
  }
});

// React to user changes in popup toggles
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) {
    if (!changes.enabled.newValue) {
      console.log("[Miruro ServiceWorker] Extension disabled by user. Clearing Discord activity.");
      chrome.storage.local.set({ lastPresence: null });
      chrome.runtime.sendMessage({ type: "CLEAR_ACTIVITY" }).catch(() => {});
    } else {
      console.log("[Miruro ServiceWorker] Extension enabled by user. Requesting presence sync.");
      requestTabsPresenceUpdate();
    }
  }
});

async function requestTabsPresenceUpdate() {
  const tabs = await chrome.tabs.query({ url: MIRURO_URL_PATTERNS });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: "FORCE_PRESENCE_SYNC" }, { frameId: 0 }).catch(() => {});
  }
}

// Message routing center
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ensureOffscreenDocument();

  // 1. Relay iframe video playback event to top-level content script
  if (message.type === "MIRURO_VIDEO_STATE") {
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: "MIRURO_VIDEO_STATE", data: message.data },
        { frameId: 0 }
      ).catch(() => {});
    }
    sendResponse({ received: true });
    return true;
  }

  // 2. Set activity received from content.js
  if (message.type === "MIRURO_SET_PRESENCE") {
    chrome.storage.local.get(["enabled"], async (res) => {
      if (res.enabled === false) {
        chrome.runtime.sendMessage({ type: "CLEAR_ACTIVITY" }).catch(() => {});
        return;
      }
      await chrome.storage.local.set({ lastPresence: message.data });
      chrome.runtime.sendMessage({
        type: "SET_ACTIVITY",
        activity: message.data
      }).catch(() => {});
    });
    sendResponse({ received: true });
    return true;
  }

  // 3. Clear activity requested
  if (message.type === "MIRURO_CLEAR_PRESENCE") {
    chrome.storage.local.set({ lastPresence: null });
    chrome.runtime.sendMessage({ type: "CLEAR_ACTIVITY" }).catch(() => {});
    sendResponse({ received: true });
    return true;
  }

  // 4. Update Discord connection status from offscreen document
  if (message.type === "DISCORD_STATUS_UPDATE") {
    chrome.storage.local.set({
      discordConnected: Boolean(message.connected),
      discordPort: message.port || null,
      discordUser: message.user ? message.user.username : null
    }).catch(() => {});
    sendResponse({ received: true });
    return true;
  }

  // 5. Query Discord connection status from popup
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

  // 6. Update Bridge Client ID Configuration
  if (message.type === "UPDATE_CONFIG") {
    ensureOffscreenDocument();
    chrome.runtime.sendMessage({
      type: "UPDATE_CONFIG",
      clientId: message.clientId
    }).catch(() => {});
    sendResponse({ received: true });
    return true;
  }

  // 7. Force all Miruro tabs to sync presence
  if (message.type === "FORCE_PRESENCE_SYNC") {
    requestTabsPresenceUpdate();
    sendResponse({ received: true });
    return true;
  }

  return false;
});
