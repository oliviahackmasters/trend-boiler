import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  if (req.method !== "POST") return json(res, 405, { error: "Use POST." });

  // Reset now just means "start fresh chat" on the client side.
  // We DO NOT delete the baseline library.
  return json(res, 200, { ok: true });
}
