import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRequest } from "../src/app.js";

/**
 * Vercel catch-all serverless entrypoint.
 *
 * All /api/* requests are routed here (see vercel.json). The shared router in
 * src/app.ts handles the request exactly like the local dev server does.
 *
 * Note: the Chrome Extension WebSocket bridge is NOT attached here — Vercel
 * functions cannot host long-lived WebSocket servers. Production uses the
 * HTTP-polling bridge instead.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleRequest(req, res);
}
