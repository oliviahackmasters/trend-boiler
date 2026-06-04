import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import { putObject, publicUrlForKey } from "../lib/r2.js";
import { buildReportObjectKey, makeReportId, normalizeSector, requireProjectReportScope, safeFilename } from "../lib/projectReports.js";
import busboy from "busboy";

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const bb = busboy({ 
      headers: req.headers,
      limits: {
        fileSize: 500 * 1024 * 1024 // 500MB
      }
    });
    let fileBuffer = null;
    let filename = null;
    const fields = {};

    bb.on("file", (name, file, info) => {
      filename = safeFilename(info.filename);
      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("end", () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("finish", async () => {
      try {
        if (!fileBuffer) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        if (!filename || !filename.toLowerCase().endsWith(".pdf")) {
          return res.status(400).json({ error: "Only PDF files are allowed" });
        }

        // Validate file size (limit to 50MB)
        const maxFileSize = 50 * 1024 * 1024; // 50MB
        if (fileBuffer.length > maxFileSize) {
          return res.status(413).json({
            error: "File too large",
            details: `File size ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB exceeds limit of 50MB`
          });
        }

        // ✅ FIX: was hardcoded to private R2 storage URL.
        // Now uses publicUrlForKey() which reads R2_PUBLIC_BASE_URL env var.
        const sector = normalizeSector(fields.sector);
        const reportId = String(fields.reportId || makeReportId()).trim();
        const { projectId } = requireProjectReportScope({
          projectId: fields.projectId,
          sector
        });
        const key = buildReportObjectKey({ projectId, sector, reportId, filename });
        await putObject(key, fileBuffer, "application/pdf");
        const url = publicUrlForKey(key);

        return res.status(200).json({
          success: true,
          key,
          url,
          blobUrl: url,
          publicUrl: url,
          pathname: key,
          reportId,
          projectId,
          sector
        });
      } catch (uploadError) {
        console.error("Upload error:", uploadError);
        const details = String(uploadError?.message || uploadError);
        const status = /^Missing (projectId|sector)$/.test(details) ? 400 : 500;
        return res.status(status).json({
          error: "Upload failed",
          details
        });
      }
    });

    req.pipe(bb);
  } catch (e) {
    console.error("Upload handler failed:", e);
    return res.status(500).json({
      error: "Upload handler failed",
      details: String(e?.message || e)
    });
  }
}

export const config = { api: { bodyParser: false } };
