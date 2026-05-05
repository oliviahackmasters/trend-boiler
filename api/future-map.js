import { openai } from "../lib/openaiClient.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import { getVectorStoreIdForSector } from "../lib/vs.js";


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
    const sector = String(body.sector || "luxury").trim().toLowerCase();
    const vsid = getVectorStoreIdForSector(sector);
    if (!vsid) return json(res, 500, { error: `Missing vector store ID for sector: ${sector}` });

    const theme = String(body.theme || "").trim();

    if (!theme) return json(res, 400, { error: "Missing theme" });

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // IMPORTANT: we force strict JSON so the frontend can render without hacks
    const prompt = `
You are a trends research assistant. Use ONLY the documents and saved web sources in the vector store.

Task: Build a "Future Map" for the theme: "${theme}".

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
- 3–6 bullets per lens.
- Each bullet should be short (max ~120 chars), concrete, and insight-like (not generic).
- If evidence is weak for a lens, write a bullet starting with "NOT ENOUGH EVIDENCE:".
`.trim();

    const resp = await openai.responses.create({
      model,
      input: [{ role: "user", content: prompt }],
      tools: [{ type: "file_search", vector_store_ids: [vsid] }],
      max_output_tokens: 900
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

    return json(res, 200, parsed);
  } catch (e) {
    return json(res, 500, { error: "FUTURE MAP FAILED", details: String(e?.message || e) });
  }
}
