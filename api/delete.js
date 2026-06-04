import { deleteObject } from "../lib/r2.js";
import { openai } from "../lib/openaiClient.js";
import { getVectorStores } from "../lib/vs.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import { getProjectReportByHash, getStoredProjectVectorStoreId, requireProjectReportScope } from "../lib/projectReports.js";


function json(res, status, payload){
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res){
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  if (req.method !== "POST") return json(res, 405, { error: "Use POST." });

  try{
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const hash = String(body.hash || "").trim();
    if (!hash) return json(res, 400, { error: "Missing hash" });

    const scope = requireProjectReportScope({
      projectId: body.projectId,
      sector: body.sector
    });
    const found = await getProjectReportByHash({ ...scope, hash });
    if (!found) return json(res, 404, { error: "Not found" });

    const { meta, metaKey } = found;
    const vsid = meta.vectorStoreId || await getStoredProjectVectorStoreId(scope);
    if (!vsid) return json(res, 500, { error: `Missing vector store ID for project ${scope.projectId} / sector ${scope.sector}` });

    const vectorStores = getVectorStores(openai);

    // Remove from vector store if we have vsFileId
    if (meta.vsFileId && vectorStores?.files?.del) {
      try { await vectorStores.files.del(vsid, meta.vsFileId); } catch {}
    }

    // (Optional) delete OpenAI file too
    if (meta.openaiFileId) {
      try { await openai.files.del(meta.openaiFileId); } catch {}
    }

    // Delete PDF blob + meta blob
    if (meta.blobUrl) {
      try { await deleteObject(meta.blobUrl); } catch {}
    }
    await deleteObject(metaKey);

    return json(res, 200, { ok: true });
  } catch(e){
    const details = String(e?.message || e);
    const status = /^Missing (projectId|sector)$/.test(details) ? 400 : 500;
    return json(res, status, { error: "DELETE FAILED", details });
  }
}
