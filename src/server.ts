import "dotenv/config";
import http from "node:http";
import { handleRequest } from "./app.js";
import { setupExtensionWebSocket } from "./extensionBridge.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const server = http.createServer(handleRequest);
setupExtensionWebSocket(server);

server.listen(config.port, () => {
  console.log(`x-search-api listening on http://localhost:${config.port}`);
  console.log(`WebSocket server ready on ws://localhost:${config.port}/ws`);
});

// Also bind secondary port 3001 if config.port is 3000 to seamlessly serve Vite & curl requests
if (config.port !== 3001) {
  try {
    const server3001 = http.createServer(handleRequest);
    setupExtensionWebSocket(server3001);
    server3001.listen(3001, () => {
      console.log(`x-search-api secondary listener ready on http://localhost:3001`);
    }).on("error", (err: any) => {
      if (err.code !== "EADDRINUSE") {
        console.warn(`Could not bind secondary port 3001: ${err.message}`);
      }
    });
  } catch {}
}
