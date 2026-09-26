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
