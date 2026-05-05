import { listObjects } from "../lib/r2.js";
import { openai } from "../lib/openaiClient.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import { getVectorStoreIdForSector } from "../lib/vs.js";


function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function routeUserQuery(question) {
  if (wantsDrivers(question)) {
    return { outputFormat: "drivers" };
  }

  return {
    outputFormat: wantsScenarioMatrix(question) ? "scenario" : "default"
  };
}

function wantsDrivers(question) {
  return /\b(generate|create|make|build|give|identify|list|map|show)?\s*(future\s+)?drivers?\b|\bdrivers?\s+for\b|\b(primary|secondary|wildcard)\s+drivers?\b/i.test(String(question || ""));
}

function wantsScenarioMatrix(question) {
  return /\b(scenarios?|scenario\s+matrix|matrix|2\s*x\s*2|2x2|four\s+futures|quadrants?|axes|axis|uncertaint(?:y|ies)|probabilit(?:y|ies))\b/i.test(String(question || ""));
}

function scenarioSystemInstructions() {
  return [
    "",
    "SCENARIO MATRIX MODE:",
    "The user is asking for scenario planning. Produce a clean 2x2 scenario matrix grounded in the uploaded documents.",
    "First identify the key drivers and uncertainties that matter for the user's topic.",
    "Choose one X-axis driver and one Y-axis driver. They must be high-impact, uncertain, independent from each other, and easy to express as opposite poles.",
    "Describe all four quadrants briefly and make each scenario distinct, plausible, and useful for strategic discussion.",
    "",
    "Use this exact structure:",
    "**Scenario Matrix**",
    "**Evidence signals**",
    "- 3-5 short signals from the documents. If evidence is thin, say NOT IN DOCUMENTS and state the assumption.",
    "**Key drivers**",
    "- 4-6 drivers with a short note on why each matters.",
    "**Axes**",
    "- X-axis: [low/weak pole] <-> [high/strong pole]",
    "- Y-axis: [low/weak pole] <-> [high/strong pole]",
    "**2x2 matrix**",
    "| | X-axis low/weak pole | X-axis high/strong pole |",
    "|---|---|---|",
    "| Y-axis high/strong pole | **Scenario name:** ...; **World:** ...; **Implication:** ... | **Scenario name:** ...; **World:** ...; **Implication:** ... |",
    "| Y-axis low/weak pole | **Scenario name:** ...; **World:** ...; **Implication:** ... | **Scenario name:** ...; **World:** ...; **Implication:** ... |",
    "**How to use it**",
    "- 2-3 concise strategy prompts or watch-outs.",
    "",
    "Rules:",
    "- Do not use generic axes like optimistic/pessimistic or high/low adoption unless those are clearly the strongest uncertainties.",
    "- Keep each quadrant concise enough to read in a table cell.",
    "- Use British English."
  ].join("\n");
}

function driverSystemInstructions() {
  return [
    "",
    "DRIVERS MODE:",
    "The user is asking for future/trend drivers.",
    "Return STRICT JSON only with this exact shape:",
    `{"topic":"...","primary":["..."],"secondary":["..."],"wildcard":["..."]}`,
    "Do not include markdown, commentary, source annotations, or code fences outside the JSON.",
    "Primary drivers: 3-5 items that are highly likely and high impact.",
    "Secondary drivers: 3-5 items that are less likely than primary drivers but still relatively high impact.",
    "Wildcard drivers: 2-3 low-probability, high-impact events such as regulatory shocks, technology breakthroughs, geopolitical events, supply-chain disruption, pandemic-like events or sudden cultural shifts.",
    "Use a short clean topic label, removing phrases like 'generate drivers for'.",
    "Be specific and concise.",
    "Ground the drivers in the uploaded documents and saved web sources when possible; if evidence is thin, make plausible assumptions without saying NOT IN DOCUMENTS for every item.",
    "Use British English."
  ].join("\n");
}

function augmentScenarioPrompt(question) {
  return [
    "Build a scenario matrix for this request:",
    question,
    "",
    "Follow the scenario matrix structure from the system instructions exactly."
  ].join("\n");
}

function augmentDriversPrompt(question) {
  return [
    "Generate drivers for this request:",
    question,
    "",
    "Return only the strict JSON requested in Drivers Mode."
  ].join("\n");
}

function cleanDriverTopic(question, fallback = "Future Trends") {
  const raw = String(fallback || question || "Future Trends").trim();
  const cleaned = raw
    .replace(/^generate\s+(future\s+)?drivers\s+(for|about|on)\s+/i, "")
    .replace(/^generate\s+(future\s+)?drivers\s*:?\s*/i, "")
    .replace(/^(future\s+)?drivers\s+(for|about|on)\s+/i, "")
    .trim();
  return cleaned || "Future Trends";
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
    topic: root?.topic || data?.topic || "",
    primary: normaliseDriverItems(root?.primary),
    secondary: normaliseDriverItems(root?.secondary),
    wildcard: normaliseDriverItems(root?.wildcard)
  };

  return Object.values({ primary: parsed.primary, secondary: parsed.secondary, wildcard: parsed.wildcard }).some(items => items.length)
    ? parsed
    : null;
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
    .map(item => String(item).trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[m]));
}

function renderDriverColumn(title, description, items) {
  const list = items.length
    ? `<ul class="hm-driver-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p class="hm-driver-empty">No drivers generated.</p>`;

  return [
    `<div class="hm-driver-col">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<p class="hm-driver-desc">${escapeHtml(description)}</p>`,
    list,
    `</div>`
  ].join("");
}

function renderDriversHtml(question, responseText) {
  const parsed = parseDriversJson(responseText) || { primary: [], secondary: [], wildcard: [], topic: "" };
  const topic = cleanDriverTopic(question, parsed.topic || question);

  return [
    `<div class="hm-drivers">`,
    `<div class="hm-drivers-title">DRIVERS FOR: ${escapeHtml(topic.toUpperCase())}</div>`,
    `<div class="hm-drivers-grid">`,
    renderDriverColumn("Primary Drivers", "Highly likely, big impact", parsed.primary),
    renderDriverColumn("Secondary Drivers", "Less likely, relatively big impact", parsed.secondary),
    renderDriverColumn("Wildcard Drivers", "Unlikely, but if it happens it would be a big deal", parsed.wildcard),
    `</div>`,
    `</div>`
  ].join("");
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
    const sector = String(body.sector || "luxury").trim().toLowerCase();
    const vsid = getVectorStoreIdForSector(sector);
    if (!vsid) {
      return json(res, 500, { error: `Missing vector store ID for sector: ${sector}` });
    }

    const question = String(body.question || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];

    if (!question) {
      return json(res, 400, { error: "Missing question." });
    }

    // Log for debugging + confirm sector + corpus size
    let docCount = 0;
    try {
      const prefixes = sector === "luxury"
        ? ["trend-library/meta/luxury/", "trend-library/meta/"]
        : [`trend-library/meta/${sector}/`];

      for (const prefix of prefixes) {
        const metas = await listObjects(prefix);
        docCount += metas.length;
      }
    } catch (e) {
      // best-effort logging; ignore failures
    }

    console.log(`ASK sector=${sector} vsid=${vsid} docs=${docCount} question=${question.slice(0,200)}`);

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const route = routeUserQuery(question);

    const systemParts = [
      "You are a trends research assistant.",
      `Answer using ONLY the uploaded documents and saved web sources in the "${sector}" sector when possible.`,
      "If the answer is not in the library, say: NOT IN DOCUMENTS, then suggest what to upload or add by URL.",
      "Provide sources or evidence from the library when possible (e.g. 'A report from 2025 by EY says...' or 'The saved article says...').",
      "Keep answers structured and concise.",
      "Use british english spelling and grammar.",
      "Explore non-sustainability related themes and/or trends unless specifically prompted to do so."
    ];

    if (route.outputFormat === "scenario") {
      systemParts.push(scenarioSystemInstructions());
    }

    if (route.outputFormat === "drivers") {
      systemParts.push(driverSystemInstructions());
    }

    const system = systemParts.join("\n");
    const userPrompt = route.outputFormat === "scenario"
      ? augmentScenarioPrompt(question)
      : route.outputFormat === "drivers"
        ? augmentDriversPrompt(question)
        : question;

    const input = [
      { role: "system", content: system },
      ...history.slice(-8),
      { role: "user", content: userPrompt }
    ];

    const resp = await openai.responses.create({
      model,
      input,
      tools: [{ type: "file_search", vector_store_ids: [vsid] }],
      max_output_tokens: route.outputFormat === "scenario" ? 2200 : route.outputFormat === "drivers" ? 1800 : 1500
    });

    const answer = route.outputFormat === "drivers"
      ? renderDriversHtml(question, resp.output_text || "")
      : resp.output_text || "";

    console.log(`ASK RESULT sector=${sector} format=${route.outputFormat} vsid=${vsid} answerTokens=${(resp?.output_tokens || 0)}`);

    return json(res, 200, { answer, outputFormat: route.outputFormat });
  } catch (err) {
    return json(res, 500, { error: "ASK FAILED", details: String(err?.message || err) });
  }
}
