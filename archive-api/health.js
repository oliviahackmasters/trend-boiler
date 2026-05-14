import { setCors } from "../lib/cors.js";
import { configureBucketCors } from "../lib/r2.js";

export default async function handler(req, res) {
  setCors(req, res);

  // Configure R2 bucket CORS on health check
  await configureBucketCors();

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
