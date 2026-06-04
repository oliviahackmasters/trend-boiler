// drivers.js
import { listObjects } from "../lib/r2.js";
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

function parseDriversResponse(text) {
  const parsedJson = parseDriversJson(text);
  if (parsedJson) return parsedJson;

  const sections = {
    primary: [],
    secondary: [],
    wildcard: []
  };

  // Split by headers (case-insensitive)
  const lines = text.split('\n');
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed
      .replace(/^#{1,6}\s*/, '')
      .replace(/^\*\*/, '')
      .replace(/\*\*$/, '')
      .replace(/:$/, '')
      .trim();
    
    if (/^primary\b/i.test(heading)) {
      currentSection = 'primary';
    } else if (/^secondary\b/i.test(heading)) {
      currentSection = 'secondary';
    } else if (/^wildcard\b/i.test(heading)) {
      currentSection = 'wildcard';
    } else if (trimmed && currentSection && !trimmed.startsWith('---') && !trimmed.startsWith('```') && trimmed.length > 3) {
      // Add non-empty lines that aren't markdown symbols
      const cleaned = trimmed
        .replace(/^[-•*]\s*/, '') // Remove bullet points
        .replace(/^[-*\u2022]\s*/, '') // Remove bullet points
        .replace(/^\d+[.)]\s*/, '') // Remove numbering
        .trim();
      
      if (cleaned && !/^(primary|secondary|wildcard)\b/i.test(cleaned)) {
        sections[currentSection].push(cleaned);
      }
    }
  }

  return sections;
}

function parseDriversJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "");

  let data = null;
  try {
    data = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      data = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  const root = data?.drivers || data;
  const parsed = {
    primary: normaliseDriverItems(root?.primary),
    secondary: normaliseDriverItems(root?.secondary),
    wildcard: normaliseDriverItems(root?.wildcard)
  };

  return Object.values(parsed).some(items => items.length) ? parsed : null;
}

function normaliseDriverItems(value) {
  const items = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : [];

  return items
    .map(item => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return item.driver || item.title || item.text || item.name || "";
      }
      return "";
    })
    .map(item => String(item).trim())
    .filter(Boolean);
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Use POST." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const sector = normalizeSector(body.sector || "luxury");
    const topic = String(body.topic || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];

    let projectId = body.projectId?.toString?.().trim();
const useProjectMemory = body.useProjectMemory !== false;
const saveToProjectMemory = body.saveToProjectMemory !== false;
    let reports = [];
    let sourcePack = "";
    let scopedVectorStoreId = "";

    if (isTrendReportSector(sector)) {
      const scope = requireProjectReportScope({ projectId, sector });
      projectId = scope.projectId;
      reports = await listProjectSectorReports(scope);
      if (!reports.length) {
        return json(res, 400, { error: `No reports found for project ${scope.projectId} / sector ${scope.sector}` });
      }
      scopedVectorStoreId = await getStoredProjectVectorStoreId(scope);
      if (!scopedVectorStoreId) {
        return json(res, 500, { error: `Missing vector store ID for project ${scope.projectId} / sector ${scope.sector}` });
      }
      sourcePack = buildSourcePack(reports, scope);
    }


    

    if (!topic) {
      return json(res, 400, { error: "Missing topic parameter. Use 'generate drivers for X'" });
    }

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
      task: `Generate drivers for: ${topic}`,
      methodologyTags: ["drivers", "trend-boiler", "signals", "scenario-planning", "hackmasters-methodology"],
      includeMethodology: true,
      maxChars: 10000,
    });

    projectContextBlock = projectContext.contextBlock || "";
  } catch (err) {
    projectContextError = err?.message || String(err);
    console.error("Failed to load project context for drivers:", err);
  }
}

    const vsid = isTrendReportSector(sector)
      ? scopedVectorStoreId
      : getVectorStoreIdForSector(sector);
    if (!vsid) {
      return json(res, 500, { error: `Missing vector store ID for sector: ${sector}` });
    }

    // Log for debugging
    let docCount = reports.length;
    if (!isTrendReportSector(sector)) {
      try {
        docCount += (await listObjects(`trend-library/meta/${sector}/`)).length;
      } catch (e) {
        // best-effort logging; ignore failures
      }
    }

    console.log(`DRIVERS project=${projectId || "none"} sector=${sector} topic=${topic.slice(0,100)}`);

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const system = [
      "You are a strategic foresight specialist generating drivers for trend analysis.",
      isTrendReportSector(sector)
        ? `Using ONLY documents and saved web sources for project "${projectId}" in the "${sector}" sector, generate three categories of drivers for: ${topic}`
        : `Using documents and saved web sources from the "${sector}" sector, generate three categories of drivers for: ${topic}`,
      ...(sourcePack ? [sourcePack] : []),
  ...(projectContextBlock
    ? [
        "",
        "SHARED PROJECT CONTEXT:",
        "Use this for continuity, client/project background and Hackmasters methodology. Do not treat project memory as document evidence unless it explicitly contains cited evidence.",
        projectContextBlock,
        "END SHARED PROJECT CONTEXT",
        "",
      ]
    : []),
      "",
      "PRIMARY DRIVERS (Highly likely, big impact):",
      "- List 3-5 drivers that are very likely to happen and would significantly impact the trend",
      "",
      "SECONDARY DRIVERS (Less likely, relatively big impact):",
      "- List 3-5 drivers that are somewhat less likely but would still have considerable impact if they occur",
      "",
      "WILDCARD DRIVERS (Unlikely, but massive if happens):",
      "- List 2-3 low-probability but high-impact events (e.g., regulatory shock, technology breakthrough, geopolitical event, pandemic-like disruption)",
      "",
      "Return STRICT JSON only with this exact shape:",
      `{"primary":["..."],"secondary":["..."],"wildcard":["..."]}`,
      "Do not include markdown, commentary, or source annotations outside the JSON.",
      "Use British English.",
      "Be specific and actionable.",
      "Reference the uploaded documents and saved web sources when possible."
    ].join("\n");

    const input = [
      { role: "system", content: system },
      ...history.slice(-8),
      { role: "user", content: `Generate drivers for: ${topic}` }
    ];

    const resp = await openai.responses.create({
      model,
      input,
      tools: [{ type: "file_search", vector_store_ids: [vsid] }],
      max_output_tokens: 2000
    });

    const responseText = resp.output_text || "";
    const parsed = parseDriversResponse(responseText);

    let responsePayload = {
  topic,
  drivers: {
    primary: {
      label: "Primary Drivers",
      description: "Highly likely, big impact",
      items: parsed.primary
    },
    secondary: {
      label: "Secondary Drivers",
      description: "Less likely, relatively big impact",
      items: parsed.secondary
    },
    wildcard: {
      label: "Wildcard Drivers",
      description: "Unlikely, but if it happens it would be a big deal",
      items: parsed.wildcard
    }
  },
  raw_response: responseText
};

if (projectId && saveToProjectMemory) {
  try {
    await saveProjectMemory({
      projectId,
      toolName: "trend-boiler",
      type: "drivers",
      title: `Drivers: ${topic}`.slice(0, 120),
      summary: summariseOutputForMemory(responseText),
      content: JSON.stringify(responsePayload, null, 2),
      metadata: {
        sector,
        topic,
        outputFormat: "drivers",
        docCount,
        timestamp: new Date().toISOString(),
      },
    });

    memorySaved = true;
  } catch (err) {
    memorySaveError = err?.message || String(err);
    console.error("Failed to save drivers project memory:", err);
  }
}

responsePayload.projectMemory = {
  enabled: Boolean(projectId),
  configured: true,
  projectId: projectId || null,
  memoryItemsLoaded: projectContext.memoryItemsUsed || 0,
  contextItemsLoaded: projectContext.contextItemsUsed || 0,
  methodologyItemsLoaded: projectContext.methodologyItemsUsed || 0,
  saved: memorySaved,
  contextError: projectContextError,
  saveError: memorySaveError,
};

console.log(
  `DRIVERS RESULT sector=${sector} primary=${parsed.primary.length} secondary=${parsed.secondary.length} wildcard=${parsed.wildcard.length}`
);

return json(res, 200, responsePayload);

   
  } catch (err) {
    const details = String(err?.message || err);
    const status = /^Missing (projectId|sector)$/.test(details) ? 400 : 500;
    return json(res, status, { error: "DRIVERS FAILED", details });
  }
}
