import { listObjects } from "../lib/r2.js";
import { openai } from "../lib/openaiClient.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import { getVectorStoreIdForSector } from "../lib/vs.js";
import { buildProjectMemoryContext, getProjectMemory, isProjectMemoryConfigured, saveProjectMemoryItem, summariseOutputForMemory, upsertProject } from "../lib/projectMemory.js";

function json(res, status, payload) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(payload)); }
function routeUserQuery(question) { if (wantsDrivers(question)) return { outputFormat: "drivers" }; return { outputFormat: wantsScenarioMatrix(question) ? "scenario" : "default" }; }
function wantsDrivers(question) { return /\b(generate|create|make|build|give|identify|list|map|show)?\s*(future\s+)?drivers?\b|\bdrivers?\s+for\b|\b(primary|secondary|wildcard)\s+drivers?\b/i.test(String(question || "")); }
function wantsScenarioMatrix(question) { return /\b(scenarios?|scenario\s+matrix|matrix|2\s*x\s*2|2x2|four\s+futures|quadrants?|axes|axis|uncertaint(?:y|ies)|probabilit(?:y|ies))\b/i.test(String(question || "")); }
function scenarioSystemInstructions() { return ["", "SCENARIO MATRIX MODE:", "The user is asking for scenario planning. Produce a clean 2x2 scenario matrix grounded in the uploaded documents.", "First identify the key drivers and uncertainties that matter for the user's topic.", "Choose one X-axis driver and one Y-axis driver. They must be high-impact, uncertain, independent from each other, and easy to express as opposite poles.", "Describe all four quadrants briefly and make each scenario distinct, plausible, and useful for strategic discussion.", "", "Use this exact structure:", "**Scenario Matrix**", "**Evidence signals**", "- 3-5 short signals from the documents. If evidence is thin, say NOT IN DOCUMENTS and state the assumption.", "**Key drivers**", "- 4-6 drivers with a short note on why each matters.", "**Axes**", "- X-axis: [low/weak pole] <-> [high/strong pole]", "- Y-axis: [low/weak pole] <-> [high/strong pole]", "**2x2 matrix**", "| | Known | Unknown |", "|---|---|---|", "| Agreed | - Shared known theme one<br>- Shared known theme two | - Shared unknown theme one<br>- Shared unknown theme two |", "| Contested | - Contested known theme one<br>- Contested known theme two | - Contested unknown theme one<br>- Contested unknown theme two |", "**How to use it**", "- 2-3 concise strategy prompts or watch-outs.", "", "Rules:", "- Keep each quadrant concise enough to read in a table cell.", "- Use British English.", "- Each matrix cell must contain 2-4 bullet points.", "- Use <br> between bullet points inside table cells.", "- Do not use scenario names."].join("\n"); }
function driverSystemInstructions() { return ["", "DRIVERS MODE:", "The user is asking for future/trend drivers. Produce drivers in exactly three categories so the frontend can render the required 3-column layout.", "Use this exact structure and headings, with no introduction before the title:", "**Drivers for: [topic]**", "**Primary Drivers**", "Highly likely, big impact", "- 3-5 drivers that are highly likely to happen and would have a big impact.", "**Secondary Drivers**", "Less likely, relatively big impact", "- 3-5 drivers that are less likely than primary drivers but would still have a relatively big impact.", "**Wildcard Drivers**", "Unlikely, but if it happens it would be a big deal", "- 2-3 low-probability, high-impact drivers.", "", "Rules:", "- Keep the three section names exactly: Primary Drivers, Secondary Drivers, Wildcard Drivers.", "- Do not use tables, JSON, source annotations, markdown code fences, or numbered lists.", "- Use British English."].join("\n"); }
function canarySystemInstructions() { return ["", "canary MODE:", "Analyse uploaded interview, meeting, workshop, hack and transcript documents.", "Output two 2x2 matrices in bullet points.", "Matrix 1 X-axis: Known <-> Unknown.", "Matrix 1 Y-axis: Agreed <-> Contested.", "Matrix 2 X-axis: Certain <-> Uncertain.", "Matrix 2 Y-axis: Internal <-> External.", "", "Output sections:", "**Canary Matrix**", "**Evidence signals**", "- 4-6 short signals from the transcripts.", "**Axes**", "- Matrix 1 X-axis: Known <-> Unknown", "- Matrix 1 Y-axis: Agreed <-> Contested", "- Matrix 2 X-axis: Certain <-> Uncertain", "- Matrix 2 Y-axis: Internal <-> External", "**2x2 matrix 1: Known / Unknown x Agreed / Contested**", "| - | Known | Unknown |", "|---|---|---|", "| Agreed | - 3-4 concise bullets.<br>- Each bullet should be specific. | - 3-4 concise bullets.<br>- Each bullet should be specific. |", "| Contested | - 3-4 concise bullets.<br>- Each bullet should be specific. | - 3-4 concise bullets.<br>- Each bullet should be specific. |", "**2x2 matrix 2: Certain / Uncertain x Internal / External**", "| - | Certain | Uncertain |", "|---|---|---|", "| Internal | - 3-4 concise bullets.<br>- Each bullet should be specific. | - 3-4 concise bullets.<br>- Each bullet should be specific. |", "| External | - 3-4 concise bullets.<br>- Each bullet should be specific. | - 3-4 concise bullets.<br>- Each bullet should be specific. |", "**Universal themes**", "- 3 concise bullets only.", "**Unique themes**", "- 3 concise bullets only.", "", "Rules:", "- Do not invent participant quotes.", "- If something is not supported by the transcripts, say so.", "- Use British English.", "- Always produce both 2x2 matrices."].join("\n"); }
function augmentScenarioPrompt(question) { return ["Build a scenario matrix for this request:", question, "", "Follow the scenario matrix structure from the system instructions exactly."].join("\n"); }
function augmentcanaryPrompt(question) { return ["Run canary transcript analysis for this request:", question, "", "Follow the canary Mode structure exactly."].join("\n"); }
function augmentDriversPrompt(question) { return ["Generate drivers for this request:", question, "", "Follow the Drivers Mode structure exactly so the answer can be rendered as three columns: Primary Drivers, Secondary Drivers, and Wildcard Drivers."].join("\n"); }

export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  setCors(req, res); if (handleOptions(req, res)) return; if (!requireDemoToken(req, res)) return;
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const sector = String(body.sector || "luxury").trim().toLowerCase();
    const vsid = getVectorStoreIdForSector(sector);
    if (!vsid) return json(res, 500, { error: `Missing vector store ID for sector: ${sector}` });
    const question = String(body.question || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!question) return json(res, 400, { error: "Missing question." });

    const projectId = body.projectId?.toString?.().trim();
    const projectName = body.projectName?.toString?.().trim();
    const useProjectMemory = body.useProjectMemory !== false;
    const saveToProjectMemory = body.saveToProjectMemory !== false;
    let projectMemoryItems = [];
    let projectMemoryContext = "";
    let memorySaved = false;
    let memorySaveError = null;
    if (projectId && useProjectMemory && isProjectMemoryConfigured()) {
      await upsertProject(projectId, projectName);
      projectMemoryItems = await getProjectMemory(projectId);
      projectMemoryContext = buildProjectMemoryContext(projectMemoryItems);
    }

    let docCount = 0;
    try { const prefixes = sector === "luxury" ? ["trend-library/meta/luxury/", "trend-library/meta/"] : [`trend-library/meta/${sector}/`]; for (const prefix of prefixes) docCount += (await listObjects(prefix)).length; } catch {}
    console.log(`ASK sector=${sector} vsid=${vsid} docs=${docCount} question=${question.slice(0,200)}`);

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const route = body.outputFormat === "canary" ? { outputFormat: "canary" } : routeUserQuery(question);
    const toolName = route.outputFormat === "canary" || sector === "canary" ? "canary" : "trend-boiler";
    const systemParts = ["You are a trends research assistant.", `Answer using ONLY the uploaded documents and saved web sources in the "${sector}" sector when possible.`, "If the answer is not in the library, say: NOT IN DOCUMENTS, then suggest what to upload or add by URL.", "Provide sources or evidence from the library when possible.", "Keep answers structured and concise.", "Use british english spelling and grammar.", "Explore non-sustainability related themes and/or trends unless specifically prompted to do so."];
    if (projectMemoryContext) systemParts.push(["", "PROJECT MEMORY:", "Use the following saved project memory for continuity and context. Do not treat it as document evidence and do not cite it as a source.", projectMemoryContext, "END PROJECT MEMORY"].join("\n"));
    if (route.outputFormat === "scenario") systemParts.push(scenarioSystemInstructions());
    if (route.outputFormat === "drivers") systemParts.push(driverSystemInstructions());
    if (route.outputFormat === "canary") systemParts.push(canarySystemInstructions());
    const system = systemParts.join("\n");
    const userPrompt = route.outputFormat === "canary" ? augmentcanaryPrompt(question) : route.outputFormat === "scenario" ? augmentScenarioPrompt(question) : route.outputFormat === "drivers" ? augmentDriversPrompt(question) : question;
    const input = [{ role: "system", content: system }, ...history.slice(-8), { role: "user", content: userPrompt }];
    const resp = await openai.responses.create({ model, input, tools: [{ type: "file_search", vector_store_ids: [vsid] }], max_output_tokens: route.outputFormat === "scenario" ? 2200 : route.outputFormat === "canary" ? 1800 : route.outputFormat === "drivers" ? 1800 : 1500 });
    const answer = resp.output_text || "";

    if (projectId && saveToProjectMemory && isProjectMemoryConfigured()) {
      try {
        await saveProjectMemoryItem({ projectId, toolName, type: route.outputFormat === "canary" ? "transcript-analysis" : route.outputFormat === "scenario" ? "scenario-output" : route.outputFormat === "drivers" ? "drivers" : "chat-output", title: question.slice(0, 120), summary: summariseOutputForMemory(answer), content: [`QUESTION:\n${question}`, `ANSWER:\n${answer}`].join("\n\n"), metadata: { sector, outputFormat: route.outputFormat, docCount, timestamp: new Date().toISOString() } });
        memorySaved = true;
      } catch (err) { memorySaveError = err?.message || String(err); console.error("Failed to save ask project memory:", err); }
    }

    console.log(`ASK RESULT sector=${sector} format=${route.outputFormat} vsid=${vsid} answerTokens=${(resp?.output_tokens || 0)}`);
    return json(res, 200, { answer, outputFormat: route.outputFormat, projectMemory: { enabled: Boolean(projectId), configured: isProjectMemoryConfigured(), projectId: projectId || null, memoryItemsLoaded: projectMemoryItems.length, saved: memorySaved, saveError: memorySaveError } });
  } catch (err) { return json(res, 500, { error: "ASK FAILED", details: String(err?.message || err) }); }
}
