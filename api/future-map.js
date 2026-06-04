//future map.js
import { openai } from "../lib/openaiClient.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import { getVectorStoreIdForSector } from "../lib/vs.js";
import {
  buildSourcePack,
  getStoredProjectVectorStoreId,
  isTrendReportSector,
  listProjectSectorReports,
  normalizeSector,
  requireProjectReportScope
} from "../lib/projectReports.js";
import {
  buildProjectContext,
  saveProjectMemory,
  summariseOutputForMemory,
} from "../lib/projectMemoryClient.js";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  if (req.method !== "POST") return json(res, 405, { error: "Use POST." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const sector = normalizeSector(body.sector || "luxury");
    let projectId = body.projectId?.toString?.().trim();
    let reports = [];
    let sourcePack = "";
    let vsid = "";

    if (isTrendReportSector(sector)) {
      const scope = requireProjectReportScope({ projectId, sector });
      projectId = scope.projectId;
      reports = await listProjectSectorReports(scope);
      if (!reports.length) {
        return json(res, 400, { error: `No reports found for project ${scope.projectId} / sector ${scope.sector}` });
      }
      vsid = await getStoredProjectVectorStoreId(scope);
      if (!vsid) {
        return json(res, 500, { error: `Missing vector store ID for project ${scope.projectId} / sector ${scope.sector}` });
      }
      sourcePack = buildSourcePack(reports, scope);
    } else {
      vsid = getVectorStoreIdForSector(sector);
    }
    if (!vsid) return json(res, 500, { error: `Missing vector store ID for sector: ${sector}` });

    const theme = String(body.theme || "").trim();

    if (!theme) return json(res, 400, { error: "Missing theme" });

const useProjectMemory = body.useProjectMemory !== false;
const saveToProjectMemory = body.saveToProjectMemory !== false;

let projectContext = {
  contextBlock: "",
  memoryItemsUsed: 0,
  contextItemsUsed: 0,
  methodologyItemsUsed: 0,
};
let projectContextBlock = "";
let memorySaved = false;
let memorySaveError = null;
let projectContextError = null;

if (projectId && useProjectMemory) {
  try {
    projectContext = await buildProjectContext({
      projectId,
      toolName: "trend-boiler",
      task: `Build Future Map for: ${theme}`,
      methodologyTags: ["future-map", "drivers", "signals", "trends", "hackmasters-methodology"],
      includeMethodology: true,
      maxChars: 10000,
    });

    projectContextBlock = projectContext.contextBlock || "";
  } catch (err) {
    projectContextError = err?.message || String(err);
    console.error("Failed to load project context for future map:", err);
  }
}

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // IMPORTANT: keep strict JSON so the frontend can render the map directly.
    // The values remain arrays of strings for backwards compatibility with the SVG renderer.
const prompt = `
You are a senior trends strategist. ${isTrendReportSector(sector) ? `Use ONLY reports, documents, and saved web sources for project "${projectId}" in the "${sector}" sector as source evidence.` : "Use ONLY the reports, documents, and saved web sources in the vector store as source evidence."}

${sourcePack ? `${sourcePack}\n` : ""}

${projectContextBlock ? `SHARED PROJECT CONTEXT
Use this for continuity, client/project background and Hackmasters methodology. Do not treat project memory as document evidence unless it explicitly contains cited evidence.

${projectContextBlock}

END SHARED PROJECT CONTEXT
` : ""}

Task: Build a "Future Map" for the theme: "${theme}".

What the Future Map should do:
- Summarise the most important PRIMARY DRIVERS found across the reports.
- Prioritise UNIVERSAL THEMES: drivers that appear across multiple reports/sources (e.g. several KPMG, Deloitte, EY, McKinsey-style reports all pointing to the same force).
- Include UNIQUE THEMES only when they are especially sharp or strategically useful, and label them as "Unique:".
- Present drivers as TENSIONS, not generic trends.
- A tension should show two opposing forces, trade-offs, or directions of travel, using forms like:
  - "Personalisation + convenience vs data anxiety"
  - "Eco-friendly intent vs convenience expectations"
  - "More automation vs less human trust"
  - "Premium experience + speed vs rising cost pressure"
  - "Centralised control vs local adaptation"

Return STRICT JSON only (no markdown, no commentary) with this exact shape:

{
  "theme": "...",
  "lenses": {
    "people_attitudes_behaviours": ["...", "...", "..."],
    "politics_regulation": ["...", "...", "..."],
    "prosperity_economic_factors": ["...", "...", "..."],
    "planet_sustainability": ["...", "...", "..."],
    "places_channels": ["...", "...", "..."],
    "potential_capability": ["...", "...", "..."],
    "profit_models": ["...", "...", "..."]
  }
}

Rules:
- 3-5 bullets per lens.
- Each bullet must be a short tension, max ~120 characters.
- Each bullet should read as an either/or, more/less, +/- or "X vs Y" tension.
- Avoid single-sided summaries like "AI will improve efficiency"; rewrite as a tension like "More AI efficiency vs less human trust".
- Start broadly supported cross-report themes with "Universal:" where it fits naturally.
- Use "Unique:" only for a distinctive driver that appears to come from one report/source and is still strategically useful.
- Mainly include Universal themes; Unique themes should be rare.
- If evidence is weak for a lens, write one bullet starting with "NOT ENOUGH EVIDENCE:" and make the remaining bullets cautious tensions.
- Use British English.
`.trim();

    const resp = await openai.responses.create({
      model,
      input: [{ role: "user", content: prompt }],
      tools: [{ type: "file_search", vector_store_ids: [vsid] }],
      max_output_tokens: 1200
    });

    const text = (resp.output_text || "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // If the model ever returns extra text, salvage the first {...} block.
      const m = text.match(/\{[\s\S]*\}$/);
      if (!m) throw new Error("Model did not return valid JSON");
      parsed = JSON.parse(m[0]);
    }

    if (projectId && saveToProjectMemory) {
  try {
    await saveProjectMemory({
      projectId,
      toolName: "trend-boiler",
      type: "future-map",
      methodologyTags: ["future-map", "drivers", "signals", "trends", "scenario-planning", "hackmasters-methodology"],
      title: `Future Map: ${theme}`.slice(0, 120),
      summary: summariseOutputForMemory(JSON.stringify(parsed)),
      content: JSON.stringify(parsed, null, 2),
      metadata: {
        sector,
        theme,
        outputFormat: "future-map",
        docCount: reports.length,
        timestamp: new Date().toISOString(),
      },
    });

    memorySaved = true;
  } catch (err) {
    memorySaveError = err?.message || String(err);
    console.error("Failed to save future map project memory:", err);
  }
}

    return json(res, 200, {
  ...parsed,
  projectMemory: {
    enabled: Boolean(projectId),
    configured: true,
    projectId: projectId || null,
    memoryItemsLoaded: projectContext.memoryItemsUsed || 0,
    contextItemsLoaded: projectContext.contextItemsUsed || 0,
    methodologyItemsLoaded: projectContext.methodologyItemsUsed || 0,
    saved: memorySaved,
    contextError: projectContextError,
    saveError: memorySaveError,
  },
});
  } catch (e) {
    const details = String(e?.message || e);
    const status = /^Missing (projectId|sector)$/.test(details) ? 400 : 500;
    return json(res, status, { error: "FUTURE MAP FAILED", details });
  }
}
