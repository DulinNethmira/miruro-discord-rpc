process.on("uncaughtException", (err) => console.error("[Uncaught Exception]", err));
process.on("unhandledRejection", (reason) => console.error("[Unhandled Rejection]", reason));
process.on("exit", (code) => console.log("[Bridge Exit] with code:", code));
/**
 * Miruro Discord Rich Presence — Local IPC Bridge
 * Pipes Chrome Extension RPC payloads directly into Discord's Windows Named Pipe (\.\pipe\discord-ipc-0).
 * Zero external npm dependencies required.
 * Bound strictly to localhost loopback (127.0.0.1).
 */

const net = require("net");
const http = require("http");
const crypto = require("crypto");

const DEFAULT_CLIENT_ID = "1563994278965813358";
const WS_PORT = 19890;
const MAX_FRAME_SIZE = 65536; // 64KB max packet limit

let activeClientId = DEFAULT_CLIENT_ID;
let discordSocket = null;
let discordUser = null;
let currentActivity = null;
let wsClients = new Set();
let reconnectTimer = null;
let isConnecting = false;

// ==========================================
// 1. DISCORD IPC NAMED PIPE IMPLEMENTATION
// ==========================================

function encodeIpcFrame(op, payload) {
  const json = JSON.stringify(payload);
  const len = Buffer.byteLength(json);
  const buf = Buffer.alloc(8 + len);
  buf.writeUInt32LE(op, 0);
  buf.writeUInt32LE(len, 4);
  buf.write(json, 8, len, "utf8");
  return buf;
}

function connectToDiscordIpc() {
  if (discordSocket) {
    try { discordSocket.destroy(); } catch (_) {}
    discordSocket = null;
  }
  discordUser = null;
  isConnecting = true;
  tryConnectPipe(0);
}

function tryConnectPipe(index) {
  if (index >= 10) {
    console.log("[Discord IPC] Discord desktop not found on pipes 0-9. Retrying in 3s...");
    isConnecting = false;
    scheduleDiscordReconnect();
    return;
  }

  const pipeName = `\\\\.\\pipe\\discord-ipc-${index}`;
  let isHandshakeSent = false;
  let socket = null;

  try {
    socket = net.createConnection(pipeName);
  } catch (err) {
    tryConnectPipe(index + 1);
    return;
  }

  socket.on("connect", () => {
    isHandshakeSent = true;
    isConnecting = false;
    discordSocket = socket;
    console.log(`[Discord IPC] Connected to ${pipeName}`);
    console.log(`[Discord IPC] Handshaking with Client ID: ${activeClientId}...`);
    socket.write(encodeIpcFrame(0, { v: 1, client_id: activeClientId }));
  });

  let rxBuffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);

    while (rxBuffer.length >= 8) {
      const op = rxBuffer.readUInt32LE(0);
      const len = rxBuffer.readUInt32LE(4);

      if (len > 5242880) { // Safety limit: 5MB
        console.error("[Discord IPC] Incoming frame exceeded maximum size");
        socket.destroy();
        return;
      }

      if (rxBuffer.length < 8 + len) break;

      const jsonStr = rxBuffer.slice(8, 8 + len).toString("utf8");
      rxBuffer = rxBuffer.slice(8 + len);

      try {
        const frame = JSON.parse(jsonStr);

        if (frame.evt === "READY" && frame.data && frame.data.user) {
          discordUser = frame.data.user;
          console.log(`[Discord IPC] Authenticated as @${discordUser.username} (User ID: ${discordUser.id})`);
          broadcastToExtension({
            type: "DISCORD_STATUS",
            connected: true,
            user: discordUser,
            clientId: activeClientId
          });

          // Re-apply active presence immediately upon reconnect
          if (currentActivity) {
            sendActivityToDiscord(currentActivity);
          }
        }
      } catch (err) {
        console.error("[Discord IPC] Frame parse error:", err.message);
      }
    }
  });

  socket.on("error", () => {
    if (!isHandshakeSent) {
      tryConnectPipe(index + 1);
    }
  });

  socket.on("close", () => {
    if (socket === discordSocket) {
      console.log("[Discord IPC] Discord connection closed. Reconnecting in 3s...");
      discordSocket = null;
      discordUser = null;
      broadcastToExtension({
        type: "DISCORD_STATUS",
        connected: false,
        clientId: activeClientId
      });
      scheduleDiscordReconnect();
    }
  });
}

function scheduleDiscordReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectToDiscordIpc();
  }, 3000);
}

function sendActivityToDiscord(activity) {
  currentActivity = activity;

  if (!discordSocket || !discordUser) {
    console.log("[Discord IPC] Activity queued (Discord not ready yet)");
    return;
  }

  try {
    const payload = {
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity: activity
      },
      nonce: crypto.randomUUID()
    };
    discordSocket.write(encodeIpcFrame(1, payload));
    console.log(`[Discord IPC] SET_ACTIVITY -> ${activity ? (activity.name || activity.details || "Active") : "CLEARED"}`);
  } catch (err) {
    console.error("[Discord IPC] Failed to write activity:", err.message);
  }
}

// ==========================================
// 2. SECURE ZERO-DEPENDENCY WEBSOCKET SERVER
// ==========================================

const server = http.createServer((req, res) => {
  // Only accept local loopback requests
  const remoteIp = req.socket.remoteAddress;
  if (remoteIp !== "127.0.0.1" && remoteIp !== "::1" && remoteIp !== "::ffff:127.0.0.1") {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify({
    service: "Miruro Discord RPC Bridge",
    status: discordUser ? "connected" : "waiting_for_discord",
    user: discordUser ? discordUser.username : null,
    clientId: activeClientId,
    port: WS_PORT
  }));
});

// Single-instance guard
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[Bridge] Port ${WS_PORT} is already in use — Miruro Bridge is already active!`);
    process.exit(0);
  } else {
    console.error("[Bridge] Server error:", err);
  }
});

server.on("upgrade", (req, socket, head) => {
  // Restrict to local loopback
  const remoteIp = socket.remoteAddress;
  if (remoteIp !== "127.0.0.1" && remoteIp !== "::1" && remoteIp !== "::ffff:127.0.0.1") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );

  function sendWs(data) {
    try {
      const payload = Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
      const len = payload.length;
      let header;

      if (len < 126) {
        header = Buffer.from([0x81, len]);
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      socket.write(Buffer.concat([header, payload]));
    } catch (_) {}
  }

  wsClients.add(sendWs);
  console.log(`[Bridge] Client connected (${wsClients.size} active client)`);

  // Send initial Discord status immediately
  sendWs({
    type: "DISCORD_STATUS",
    connected: Boolean(discordUser),
    user: discordUser,
    clientId: activeClientId
  });

  let wsBuffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    wsBuffer = Buffer.concat([wsBuffer, chunk]);

    if (wsBuffer.length > MAX_FRAME_SIZE) {
      console.warn("[Bridge] Payload size exceeded limit; closing socket.");
      socket.destroy();
      return;
    }

    while (wsBuffer.length >= 2) {
      const firstByte = wsBuffer[0];
      const opcode = firstByte & 0x0f;
      const secondByte = wsBuffer[1];
      const isMasked = (secondByte & 0x80) !== 0;
      let len = secondByte & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (wsBuffer.length < 4) break;
        len = wsBuffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (wsBuffer.length < 10) break;
        len = Number(wsBuffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      if (wsBuffer.length < offset + maskLen + len) break;

      let payload = wsBuffer.slice(offset + maskLen, offset + maskLen + len);
      if (isMasked) {
        const mask = wsBuffer.slice(offset, offset + 4);
        const unmasked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      wsBuffer = wsBuffer.slice(offset + maskLen + len);

      if (opcode === 8) { // CLOSE
        socket.end();
        return;
      } else if (opcode === 9) { // PING
        socket.write(Buffer.from([0x8a, 0x00])); // PONG
      } else if (opcode === 1) { // TEXT
        try {
          const msg = JSON.parse(payload.toString("utf8"));

          // Handle client configuration updates (custom Client ID)
          if (msg.cmd === "SET_CONFIG" && msg.clientId) {
            const trimmed = String(msg.clientId).trim();
            if (/^\d{17,21}$/.test(trimmed) && trimmed !== activeClientId) {
              console.log(`[Bridge] Switching to custom Application Client ID: ${trimmed}`);
              activeClientId = trimmed;
              connectToDiscordIpc();
            }
            sendWs({ cmd: "SET_CONFIG", success: true, clientId: activeClientId });
          } else if (msg.cmd === "SET_ACTIVITY" && msg.args) {
            sendActivityToDiscord(msg.args.activity);
            sendWs({ cmd: "SET_ACTIVITY", success: true });
          } else if (msg.cmd === "CLEAR_ACTIVITY") {
            sendActivityToDiscord(null);
            sendWs({ cmd: "CLEAR_ACTIVITY", success: true });
          }
        } catch (e) {
          console.error("[Bridge] Malformed message:", e.message);
        }
      }
    }
  });

  socket.on("close", () => {
    wsClients.delete(sendWs);
    console.log(`[Bridge] Client disconnected (${wsClients.size} remaining)`);
  });

  socket.on("error", () => {
    wsClients.delete(sendWs);
  });
});

function broadcastToExtension(msg) {
  for (const sendWs of wsClients) {
    try {
      sendWs(msg);
    } catch (_) {}
  }
}

// Bind strictly to local loopback (127.0.0.1)
server.listen(WS_PORT, "127.0.0.1", () => {
  console.log("==================================================");
  console.log("  Miruro Discord Rich Presence — IPC Bridge       ");
  console.log(`  Listening on: ws://127.0.0.1:${WS_PORT} (Localhost) `);
  console.log(`  Application ID: ${activeClientId}      `);
  console.log("==================================================");
  connectToDiscordIpc();
});
