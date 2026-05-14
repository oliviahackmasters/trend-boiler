import { listObjects } from "../lib/r2.js";
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

  try {
    if (req.method !== "GET") {
      return json(res, 405, { error: "Use GET." });
    }

    const objects = await listObjects("trend-library/meta/canary/");

    const items = objects
      .filter((object) => object.Key && object.Key.endsWith(".json"))
      .filter((object) => !object.Key.endsWith("/library.json"))
      .map((object) => {
        const key = object.Key;
        const filename = key.split("/").pop().replace(/\.json$/, "");

        return {
          id: key,
          name: filename,
          selected: true,
          addedAt: object.LastModified
            ? new Date(object.LastModified).toLocaleString()
            : "",
          key
        };
      })
      .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));

    return json(res, 200, { items });
  } catch (err) {
    return json(res, 500, {
      error: "CANARY_LIBRARY_FAILED",
      details: String(err?.message || err)
    });
  }
}