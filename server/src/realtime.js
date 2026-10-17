import { WebSocketServer } from "ws";
import cookieParser from "cookie-parser";
import { COOKIE, userFromToken } from "./auth.js";

const sockets = new Map(); // userId -> Set<WebSocket>

export function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true });
  const parseCookies = cookieParser();

  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/ws")) return socket.destroy();
    parseCookies(req, {}, async () => {
      const user = await userFromToken(req.cookies?.[COOKIE]).catch(() => null);
      if (!user) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy(); }
      wss.handleUpgrade(req, socket, head, ws => {
        ws.userId = user.id;
        ws.alive = true;
        if (!sockets.has(user.id)) sockets.set(user.id, new Set());
        sockets.get(user.id).add(ws);
        ws.on("pong", () => { ws.alive = true; });
        ws.on("close", () => {
          const set = sockets.get(user.id);
          set?.delete(ws);
          if (set && !set.size) sockets.delete(user.id);
        });
      });
    });
  });

  // Cierra conexiones muertas (móviles que pierden cobertura, pestañas dormidas).
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 30000);
  wss.on("close", () => clearInterval(timer));
  return wss;
}

export function push(userId, payload) {
  const set = sockets.get(userId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) if (ws.readyState === 1) ws.send(msg);
}

export const isOnline = userId => (sockets.get(userId)?.size || 0) > 0;
