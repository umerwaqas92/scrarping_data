import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

/**
 * Chrome Extension WebSocket bridge (local development only).
 *
 * On Vercel there is no long-lived WebSocket server, so this module is only
 * wired up by the local dev server (src/server.ts). The serverless entrypoint
 * (api/[...path].ts) does not attach it. The HTTP-polling rework replaces this
 * for production.
 */

export const extensionClients = new Set<WebSocket>();
const pendingRequests = new Map<
  string,
  { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }
>();

export function isExtensionConnected(): boolean {
  return extensionClients.size > 0;
}

/**
 * Execute LinkedIn search via connected Chrome Extension
 */
export function searchLinkedInViaExtension(query: string, count = 15, timeoutMs = 20000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const activeWs = [...extensionClients].find((s) => s.readyState === WebSocket.OPEN);
    if (!activeWs) {
      return reject(new Error("No Chrome Extension connected. Please enable the MultiFeed extension in Chrome."));
    }

    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Extension search request timed out"));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timer });

    activeWs.send(
      JSON.stringify({
        id,
        type: "SEARCH_LINKEDIN",
        query,
        count,
      }),
    );
  });
}

/**
 * Execute Facebook search via connected Chrome Extension
 */
export function searchFacebookViaExtension(query: string, count = 15, timeoutMs = 20000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const activeWs = [...extensionClients].find((s) => s.readyState === WebSocket.OPEN);
    if (!activeWs) {
      return reject(new Error("No Chrome Extension connected. Please enable the MultiFeed extension in Chrome."));
    }

    const id = `req_fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Extension Facebook search timed out"));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timer });

    activeWs.send(
      JSON.stringify({
        id,
        type: "SEARCH_FACEBOOK",
        query,
        count,
      }),
    );
  });
}

/**
 * Attach the WebSocket upgrade handler to a Node HTTP server.
 */
export function setupExtensionWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/ws" || url.pathname === "/ws/") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    console.log("🔗 Chrome Extension connected to /ws");
    extensionClients.add(ws);

    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === "PING") {
          ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
          return;
        }
        if (data.id && pendingRequests.has(data.id)) {
          const { resolve, reject, timer } = pendingRequests.get(data.id)!;
          clearTimeout(timer);
          pendingRequests.delete(data.id);

          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.items || []);
          }
        }
      } catch (err) {
        console.error("Failed to parse extension message:", err);
      }
    });

    ws.on("close", () => {
      console.log("❌ Chrome Extension disconnected from /ws");
      extensionClients.delete(ws);
    });

    ws.on("error", (err) => {
      console.error("Extension WebSocket error:", err);
      extensionClients.delete(ws);
    });
  });
}
