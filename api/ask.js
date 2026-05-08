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
    "The user is asking for future/trend drivers. Produce drivers in exactly three categories so the frontend can render the required 3-column layout.",
    "Use this exact structure and headings, with no introduction before the title:",
    "**Drivers for: [topic]**",
    "**Primary Drivers**",
    "Highly likely, big impact",
    "- 3-5 drivers that are highly likely to happen and would have a big impact.",
    "**Secondary Drivers**",
    "Less likely, relatively big impact",
    "- 3-5 drivers that are less likely than primary drivers but would still have a relatively big impact.",
    "**Wildcard Drivers**",
    "Unlikely, but if it happens it would be a big deal",
    "- 2-3 low-probability, high-impact drivers, such as regulatory shocks, technology breakthroughs, geopolitical events, supply-chain disruption, pandemic-like events or sudden cultural shifts.",
    "",
    "Rules:",
    "- Keep the three section names exactly: Primary Drivers, Secondary Drivers, Wildcard Drivers.",
    "- Put only bullet items under each section after its short descriptor line.",
    "- Do not use tables, JSON, source annotations, markdown code fences, or numbered lists.",
    "- Each bullet should be one concise sentence and specific to the user's topic.",
    "- Ground the drivers in the uploaded documents and saved web sources when possible; if evidence is thin, make plausible assumptions without saying NOT IN DOCUMENTS for every bullet.",
    "- Use British English."
  ].join("\n");
}

function choirSystemInstructions() {
  return [
    "",
    "CHOIR MODE:",
    "Analyse uploaded interview, meeting, workshop, hack and transcript documents.",
    "Use this exact framework:",
    "- X-axis: Known <-> Unknown",
    "- Y-axis: Agreed <-> Contested",
    "",
    "Output sections:",
    "**Choir Matrix**",
    "**Evidence signals**",
    "- 3-5 short signals from the transcripts. If evidence is thin, say NOT IN TRANSCRIPTS.",
    "**Axes**",
    "- X-axis: Known <-> Unknown",
    "- Y-axis: Agreed <-> Contested",
    "**2x2 matrix**",
    "| | Known | Unknown |",
    "|---|---|---|",
    "| Agreed | - ... | - ... |",
    "| Contested | - ... | - ... |",
    "**Universal themes**",
    "- Simple summary of themes from the bottom half of the matrix.",
    "**Unique themes**",
    "- Simple summary of themes from the top half of the matrix.",
    "",
    "Rules:",
    "- Use concise bullet points.",
    "- Ground findings in transcript evidence.",
    "- Do not invent participant quotes.",
    "- If something is not supported by the transcripts, say so.",
    "- Use British English."
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

function augmentChoirPrompt(question) {
  return [
    "Run Choir transcript analysis for this request:",
    question,
    "",
    "Follow the Choir Mode structure exactly."
  ].join("\n");
}

function augmentDriversPrompt(question) {
  return [
    "Generate drivers for this request:",
    question,
    "",
    "Follow the Drivers Mode structure exactly so the answer can be rendered as three columns: Primary Drivers, Secondary Drivers, and Wildcard Drivers."
  ].join("\n");
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
    const route = body.outputFormat === "choir"
    ? { outputFormat: "choir" }
    : routeUserQuery(question);

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

    if (route.outputFormat === "choir") {
      systemParts.push(choirSystemInstructions());
    }

    const system = systemParts.join("\n");
    const userPrompt = route.outputFormat === "choir"
    ? augmentChoirPrompt(question)
    : route.outputFormat === "scenario"
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
      max_output_tokens:
        route.outputFormat === "scenario" ? 2200 :
        route.outputFormat === "choir" ? 1800 :
        route.outputFormat === "drivers" ? 1800 :
        1500
    });

    console.log(`ASK RESULT sector=${sector} format=${route.outputFormat} vsid=${vsid} answerTokens=${(resp?.output_tokens || 0)}`);

    return json(res, 200, { answer: resp.output_text || "", outputFormat: route.outputFormat });
  } catch (err) {
    return json(res, 500, { error: "ASK FAILED", details: String(err?.message || err) });
  }
}
