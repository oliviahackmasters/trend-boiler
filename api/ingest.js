import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { putJson, listObjects, publicUrlForKey, keyFromPublicUrl } from "../lib/r2.js";
import {
  isTrendReportSector,
  makeReportId,
  normalizeSector,
  projectReportMetaKey,
  requireProjectReportScope,
  getOrCreateProjectVectorStore
} from "../lib/projectReports.js";

import { openai } from "../lib/openaiClient.js";
import { getVectorStores, getVectorStoreIdForSector } from "../lib/vs.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";


function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function guessYear(filename) {
  const m = String(filename || "").match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : "";
}

/**
 * Normalize company names to canonical forms
 * Handles variations like "DELOITTE", "Deloite", "DI" → "Deloitte"
 */
function normalizeCompanyName(company) {
  if (!company) return "";
  
  const input = String(company || "").trim();
  if (!input) return "";

  // Mapping of known variations to canonical names
  const companyMap = {
    // Deloitte
    deloitte: "Deloitte",
    deloite: "Deloitte",
    dltt: "Deloitte",
    di: "Deloitte",

    // McKinsey
    mckinsey: "McKinsey & Company",
    mckinsey_company: "McKinsey & Company",
    mckinsey_co: "McKinsey & Company",
    mcg: "McKinsey & Company",

    // Boston Consulting Group
    bcg: "Boston Consulting Group",
    boston_consulting: "Boston Consulting Group",

    // Bain
    bain: "Bain & Company",
    bain_company: "Bain & Company",

    // PwC
    pwc: "PwC",
    pricewaterhousecoopers: "PwC",
    pricewaterhouse: "PwC",
    pwcc: "PwC",

    // KPMG
    kpmg: "KPMG",
    kpmgllp: "KPMG",

    // EY
    ey: "EY",
    ernst_young: "EY",
    ernst_and_young: "EY",

    // OC&C
    occ: "OC&C Strategy Consultants",
    occ_strategy: "OC&C Strategy Consultants",

    // L.E.K.
    lek: "L.E.K. Consulting",
    lek_consulting: "L.E.K. Consulting",

    // Accenture
    accenture: "Accenture",

    // Oliver Wyman
    oliver_wyman: "Oliver Wyman",
    oliverwyman: "Oliver Wyman",

    // Capgemini
    capgemini: "Capgemini",

    // Gartner
    gartner: "Gartner",

    // Forrester
    forrester: "Forrester",

    // IDC
    idc: "IDC",

    // Economist Intelligence Unit
    eiu: "The Economist Intelligence Unit",
    economist_intelligence: "The Economist Intelligence Unit",
    economist_unit: "The Economist Intelligence Unit",
  };

  // Normalize input: lowercase, replace spaces/hyphens with underscores
  const normalized = input
    .toLowerCase()
    .replace(/[&.,\-\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  // Direct lookup
  if (companyMap[normalized]) {
    return companyMap[normalized];
  }

  // Fuzzy matching: check if key is substring of normalized
  for (const [key, canonical] of Object.entries(companyMap)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return canonical;
    }
  }

  // If no match, return original in title case
  return input.split(/[\s\-&]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/**
 * Heuristic "company/source" guess:
 * - If filename starts with something like "EIU_" or "McKinsey-" etc, use that token
 * - Otherwise blank
 */
function guessCompanyFromFilename(filename) {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  const token = base.split(/[_-]/)[0]?.trim() || "";
  if (/^[A-Za-z]{2,20}$/.test(token)) {
    const rawCompany = token.toUpperCase();
    return normalizeCompanyName(rawCompany); // Apply normalization
  }
  return "";
}

/**
 * Heuristic topic tags from filename keywords
 * (edit freely; keep short + useful)
 */
function guessTopicsFromFilename(filename) {
  const lower = String(filename || "").toLowerCase();

  const map = [
    ["health", "Health"],
    ["wellness", "Health"],
    ["retail", "Retail"],
    ["consumer", "Consumer"],
    ["goods", "Consumer Goods"],
    ["luxury", "Luxury"],
    ["fashion", "Fashion"],
    ["beauty", "Beauty"],
    ["travel", "Travel"],
    ["hospital", "Hospitality"],
    ["finance", "Finance"],
    ["bank", "Banking"],
    ["ai", "AI"],
    ["genai", "AI"],
    ["technology", "Technology"],
    ["tech", "Technology"],
    ["sustain", "Sustainability"],
    ["climate", "Climate"],
    ["energy", "Energy"],
    ["media", "Media"],
    ["culture", "Culture"],
    ["education", "Education"],
    ["work", "Work"],
  ];

  const topics = [];
  for (const [needle, label] of map) {
    if (lower.includes(needle)) topics.push(label);
  }
  return Array.from(new Set(topics));
}

/**
 * Optional LLM refinement.
 * For now: refine tags from filename only (stable + fast + no extra parsing).
 * You can later swap prompt/input to include extracted text snippets.
 */
async function refineTagsWithModel({ filename, year, company, topics }) {
  try {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const prompt = `
You are tagging a trend report for a library.

Return STRICT JSON only, no markdown:
{"year":"", "company":"", "topics":[...]}

Rules:
- year: 4-digit year if clearly implied, else "".
- company: publisher/source if clearly implied from filename, else "".
- topics: 3–8 short topic tags in Title Case, deduplicated.

Filename: ${filename}

Current guesses:
year=${year || ""}
company=${company || ""}
topics=${(topics || []).join(", ")}
`.trim();

    const resp = await openai.responses.create({
      model,
      input: [{ role: "user", content: prompt }],
      max_output_tokens: 200
    });

    const txt = (resp.output_text || "").trim();
    const parsed = JSON.parse(txt);

    // Basic shape validation
    const out = {
      year: typeof parsed.year === "string" ? parsed.year : "",
      company: typeof parsed.company === "string" ? parsed.company : "",
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : []
    };

    // normalize
    out.year = out.year.match(/\b(19\d{2}|20\d{2})\b/) ? out.year : "";
    out.company = normalizeCompanyName(out.company); // Apply company normalization
    out.topics = Array.from(new Set(out.topics.map(t => t.trim()).filter(Boolean))).slice(0, 12);

    return out;
  } catch {
    return null;
  }
}

function mergeTags({ base, refined, manual }) {
  // manual overrides win; refined next; base last
  const year =
    String(manual?.year || refined?.year || base?.year || "").trim().slice(0, 4);

  const rawCompany =
    String(manual?.company || refined?.company || base?.company || "").trim().slice(0, 60);
  
  // Normalize company name to canonical form
  const company = normalizeCompanyName(rawCompany);

  const topicsManual = Array.isArray(manual?.topics) ? manual.topics : [];
  const topicsRefined = Array.isArray(refined?.topics) ? refined.topics : [];
  const topicsBase = Array.isArray(base?.topics) ? base.topics : [];

  const topics = Array.from(
    new Set([...topicsManual, ...topicsRefined, ...topicsBase].map(t => String(t).trim()).filter(Boolean))
  ).slice(0, 12);

  return { year, company, topics };
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  if (req.method !== "POST") return json(res, 405, { error: "Use POST" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const sector = normalizeSector(body.sector);
  if (!sector) return json(res, 400, { error: "Missing sector" });

  let reportScope = null;
  try {
    reportScope = isTrendReportSector(sector)
      ? requireProjectReportScope({ projectId: body.projectId, sector })
      : null;
  } catch (scopeError) {
    return json(res, 400, { error: scopeError.message });
  }
  const blobUrl = body.blobUrl || body.publicUrl || (body.key ? publicUrlForKey(body.key) : "");
  const filename = body.filename || "report.pdf";
  const pathname = body.pathname || body.key || "";
  const r2Key = body.key || pathname || (blobUrl ? keyFromPublicUrl(blobUrl) : "");
  const reportId = String(body.reportId || makeReportId()).trim();
  const size = Number(body.size || 0);
  const tagsIn = body.tags || {};

  if (!blobUrl) {
    console.error("INGEST ERROR: missing blobUrl/publicUrl/key", { body });
    return json(res, 400, { error: "Missing blobUrl", details: "Provide blobUrl, publicUrl, or key in request body." });
  }

  let vsid = "";
  try {
    vsid = reportScope
      ? await getOrCreateProjectVectorStore({ openai, ...reportScope })
      : getVectorStoreIdForSector(sector);
  } catch (scopeError) {
    return json(res, 500, { error: "Vector store setup failed", details: String(scopeError?.message || scopeError) });
  }
  if (!vsid) return json(res, 500, { error: `Missing vector store ID for sector: ${sector}` });

  console.log(`INGEST START project=${reportScope?.projectId || "legacy"} sector=${sector} filename=${filename} size=${size} blobUrl=${blobUrl}`);

  try {
    // Download blob
    const resp = await fetch(blobUrl);
    if (!resp.ok) throw new Error("Could not fetch blob: " + resp.status);

    const buf = Buffer.from(await resp.arrayBuffer());

    // Hash for duplicates (exact byte match)
    const hash = crypto.createHash("sha256").update(buf).digest("hex");

    // Project-scoped reports must only de-dupe within the selected project + sector.
    const sectorMetaKey = reportScope
      ? projectReportMetaKey({ ...reportScope, hash })
      : `trend-library/meta/${sector}/${hash}.json`;
    const legacyMetaKey = `trend-library/meta/${hash}.json`;
    const checkKeys = reportScope
      ? [sectorMetaKey]
      : sector === "luxury"
        ? [legacyMetaKey, sectorMetaKey]
        : [sectorMetaKey];

    for (const key of checkKeys) {
      const existing = await listObjects(key);
      if (existing.length) {
        console.log(`INGEST DUPLICATE sector=${sector} key=${key} hash=${hash}`);
        return json(res, 200, {
          ok: true,
          duplicate: true,
          hash,
          key,
          metaKey: key,
          projectId: reportScope?.projectId || null,
          sector,
          filename
        });
      }
    }

    // Write temp file for OpenAI upload
    const tmpPath = path.join(os.tmpdir(), `ingest-${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, buf);

    // Upload to OpenAI
    const createdFile = await openai.files.create({
      file: fs.createReadStream(tmpPath),
      purpose: "assistants"
    });

    // Attach to vector store
    const vectorStores = getVectorStores(openai);
    const vsFile = await vectorStores.files.create(vsid, { file_id: createdFile.id });

    fs.unlinkSync(tmpPath);

    // -----------------------
    // ✅ AUTO TAGGING
    // -----------------------
    const baseTags = {
      year: guessYear(filename),
      company: guessCompanyFromFilename(filename),
      topics: guessTopicsFromFilename(filename)
    };

    const manualTags = {
      year: String(tagsIn.year || "").trim(),
      company: String(tagsIn.company || "").trim(),
      topics: Array.isArray(tagsIn.topics) ? tagsIn.topics : []
    };

    // Optional refinement (filename-only)
    const refinedTags = await refineTagsWithModel({
      filename,
      year: baseTags.year,
      company: baseTags.company,
      topics: baseTags.topics
    });

    const finalTags = mergeTags({
      base: baseTags,
      refined: refinedTags,
      manual: manualTags
    });

    const addedAt = new Date().toISOString();

    // Persist metadata as a blob JSON (same as you already do)
    const metaKey = sectorMetaKey;
    const meta = {
      hash,
      metaKey,
      ...(reportScope ? { projectId: reportScope.projectId } : {}),
      sector,
      reportId,
      filename,
      pathname: r2Key || pathname,
      r2Key: r2Key || pathname,
      blobUrl,
      size,
      addedAt,
      tags: finalTags,
      openaiFileId: createdFile.id,
      vsFileId: vsFile?.id || null,
      vectorStoreId: reportScope ? vsid : null
    };

    await putJson(metaKey, meta);
    console.log(`INGEST COMPLETE sector=${sector} metaKey=${metaKey} vsFileId=${vsFile?.id}`);

    return json(res, 200, {
      ok: true,
      hash,
      duplicate: false,
      tags: finalTags,
      key: metaKey,
      metaKey,
      projectId: reportScope?.projectId || null,
      sector,
      filename
    });
  } catch (e) {
    console.error("INGEST FAILED", e);
    return json(res, 500, { error: "INGEST FAILED", details: String(e?.message || e) });
  }
}
