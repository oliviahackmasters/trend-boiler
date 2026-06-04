import { createUploadUrl, publicUrlForKey } from "../lib/r2.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import { buildReportObjectKey, makeReportId, requireProjectReportScope, safeFilename } from "../lib/projectReports.js";

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    // Validate environment variables
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
      console.error("Missing R2 environment variables");
      return res.status(500).json({
        error: "Server configuration error",
        details: "R2 environment variables not configured"
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { projectId, sector } = requireProjectReportScope({
      projectId: body.projectId,
      sector: body.sector
    });
    const reportId = String(body.reportId || makeReportId()).trim();
    const filename = safeFilename(body.pathname || body.filename || "report.pdf");
    const contentType = body.contentType || "application/pdf";

    if (contentType !== "application/pdf") {
      return res.status(400).json({ error: "Only PDFs are allowed." });
    }

    const key = buildReportObjectKey({ projectId, sector, reportId, filename });

    console.log("Generating upload URL for key:", key);
    const uploadUrl = await createUploadUrl({ key, contentType });
    const publicUrl = publicUrlForKey(key);

    return res.status(200).json({
      uploadUrl,
      publicUrl,
      blobUrl: publicUrl,
      reportId,
      projectId,
      sector,
      key,
      pathname: key
    });
  } catch (e) {
    console.error("Upload URL generation failed:", e);
    const details = String(e?.message || e);
    const status = /^Missing (projectId|sector)$/.test(details) ? 400 : 500;
    return res.status(status).json({
      error: "Failed to generate upload URL",
      details
    });
  }
}
