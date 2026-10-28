/**
 * Miruro & VidBox Discord Rich Presence — Offscreen WebSocket Engine
 * Connects to the local IPC bridge at ws://127.0.0.1:19890
 * Features robust auto-reconnection with zero silent hangs.
 */

const BRIDGE_PORT = 19890;
let socket = null;
let isReady = false;
let pendingActivity = null;
let reconnectTimer = null;
let isConnecting = false;
let activeDiscordUser = null;

function setConnectionState(connected, port = null, user = null) {
  isReady = connected;
  activeDiscordUser = user;

  try {
    chrome.runtime.sendMessage({
      type: "DISCORD_STATUS_UPDATE",
      connected: Boolean(connected),
      port: port,
      user: user
    }).catch(() => {});
  } catch (_) {}
}

function connectToBridge() {
  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    } catch (_) {}
    socket = null;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  isReady = false;
  isConnecting = true;
  setConnectionState(false, null, null);

  const wsUrl = `ws://127.0.0.1:${BRIDGE_PORT}`;
  console.log(`[Stream RPC Offscreen] Connecting to IPC Bridge on ${wsUrl}...`);

  try {
    const ws = new WebSocket(wsUrl);
    socket = ws;

    ws.onopen = () => {
      isConnecting = false;
      console.log("[Stream RPC Offscreen] Connected to local IPC bridge!");

      // Sync custom Client ID if user configured one
      try {
        chrome.storage.local.get(["discordAppId"], (res) => {
          if (res && res.discordAppId && /^\d{17,21}$/.test(res.discordAppId)) {
            ws.send(JSON.stringify({ cmd: "SET_CONFIG", clientId: res.discordAppId }));
          }
        });
      } catch (_) {}
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("[Stream RPC Offscreen] Message from bridge:", msg.type || msg.cmd);

        if (msg.type === "DISCORD_STATUS") {
          isReady = Boolean(msg.connected);
          activeDiscordUser = msg.user || null;
          setConnectionState(isReady, BRIDGE_PORT, activeDiscordUser);

          if (isReady && pendingActivity) {
            sendSetActivity(pendingActivity);
          }
        }
      } catch (err) {
        console.error("[Stream RPC Offscreen] Message parse error:", err);
      }
    };

    ws.onerror = () => {
      // Let onclose handle reconnect
    };

    ws.onclose = () => {
      console.log("[Stream RPC Offscreen] Bridge connection closed. Reconnecting in 2.5s...");
      if (ws === socket) {
        socket = null;
        isReady = false;
        isConnecting = false;
        setConnectionState(false, null, null);
      }
      scheduleReconnect();
    };
  } catch (err) {
    socket = null;
    isReady = false;
    isConnecting = false;
    setConnectionState(false, null, null);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectToBridge();
  }, 2500);
}

function sendSetActivity(activity) {
  pendingActivity = activity;

  if (!socket || !isReady || socket.readyState !== WebSocket.OPEN) {
    console.log("[Stream RPC Offscreen] Activity queued; waiting for Discord bridge connection.");
    return;
  }

  const payload = {
    cmd: "SET_ACTIVITY",
    args: {
      pid: 1000,
      activity: activity
    },
    nonce: crypto.randomUUID()
  };

  try {
    socket.send(JSON.stringify(payload));
    console.log("[Stream RPC Offscreen] Dispatched SET_ACTIVITY to Bridge:", activity ? (activity.name || activity.details) : "CLEARED");
  } catch (err) {
    console.error("[Stream RPC Offscreen] Failed to send SET_ACTIVITY:", err);
  }
}

// Listen for messages dispatched from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SET_ACTIVITY") {
    sendSetActivity(message.activity);
    sendResponse({ success: true });
  } else if (message.type === "CLEAR_ACTIVITY") {
    sendSetActivity(null);
    sendResponse({ success: true });
  } else if (message.type === "UPDATE_CONFIG") {
    if (socket && socket.readyState === WebSocket.OPEN && message.clientId) {
      socket.send(JSON.stringify({ cmd: "SET_CONFIG", clientId: message.clientId }));
    }
    sendResponse({ success: true });
  } else if (
    message.type === "GET_DISCORD_STATUS" ||
    message.type === "CHECK_DISCORD_STATUS" ||
    message.type === "CHECK_BRIDGE_NOW"
  ) {
    // If not connected and not currently connecting, probe immediately
    if (!isReady && !isConnecting) {
      connectToBridge();
    }
    sendResponse({
      connected: isReady,
      port: BRIDGE_PORT,
      user: activeDiscordUser,
      connecting: isConnecting
    });
  }
  return true;
});

// Start initial bridge connection
connectToBridge();
