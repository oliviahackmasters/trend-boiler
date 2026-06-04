import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import { listProjectSectorReports, requireProjectReportScope } from "../lib/projectReports.js";


function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  setCors(req, res);
if (handleOptions(req, res)) return;
if (!requireDemoToken(req, res)) return;

  if (req.method !== "GET") return json(res, 405, { error: "Use GET." });

  try {
    const base = req.headers.host ? `http://${req.headers.host}` : "http://localhost";
    const url = new URL(req.url, base);
    const scope = requireProjectReportScope({
      projectId: url.searchParams.get("projectId"),
      sector: url.searchParams.get("sector")
    });
    console.log(`LIBRARY FETCH project=${scope.projectId} sector=${scope.sector}`);

    const items = await listProjectSectorReports(scope);

    return json(res, 200, { items });
  } catch (e) {
    const details = String(e?.message || e);
    const status = /^Missing (projectId|sector)$/.test(details) ? 400 : 500;
    return json(res, status, {
      error: "LIBRARY FAILED",
      details
    });
  }
}
