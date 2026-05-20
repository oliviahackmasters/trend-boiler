const PROJECT_MEMORY_API_BASE = (
  process.env.PROJECT_MEMORY_API_BASE ||
  "https://project-memory-api.olivia-9ef.workers.dev"
).replace(/\/+$/, "");

export function summariseOutputForMemory(text, maxLength = 700) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength - 3) + "..." : clean;
}

export async function buildProjectContext({
  projectId,
  toolName,
  task,
  methodologyTags = [],
  includeMethodology = true,
  maxChars = 12000,
}) {
  if (!projectId) {
    return {
      contextBlock: "",
      memoryItemsUsed: 0,
      contextItemsUsed: 0,
      methodologyItemsUsed: 0,
    };
  }

  const response = await fetch(`${PROJECT_MEMORY_API_BASE}/api/context/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      toolName,
      task,
      methodologyTags,
      includeMethodology,
      maxChars,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Project context failed: ${response.status} ${text}`);
  }

  return await response.json();
}

export async function saveProjectMemory({
  projectId,
  toolName,
  type,
  title,
  summary,
  content,
  metadata,
}) {
  if (!projectId || !content) return null;

  const response = await fetch(
    `${PROJECT_MEMORY_API_BASE}/api/projects/${encodeURIComponent(projectId)}/memory`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName,
        type,
        title,
        summary,
        content,
        metadata,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Project memory save failed: ${response.status} ${text}`);
  }

  return await response.json();
}