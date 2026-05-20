export type ProjectMemoryItem = {
  id?: string;
  projectId: string;
  toolName: string;
  type: string;
  title?: string;
  summary?: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_MEMORY_ITEMS = 8;
const MAX_MEMORY_CHARS = 12000;

function getCloudflareConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    return null;
  }

  return { accountId, databaseId, apiToken };
}

export function isProjectMemoryConfigured() {
  return Boolean(getCloudflareConfig());
}

function makeId(prefix = "mem") {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${randomPart}`;
}

async function queryD1(sql: string, params: unknown[] = []) {
  const config = getCloudflareConfig();
  if (!config) {
    throw new Error("Cloudflare project memory is not configured. Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID or CLOUDFLARE_API_TOKEN.");
  }

  const response = await fetch(
    `${CLOUDFLARE_API_BASE}/accounts/${config.accountId}/d1/database/${config.databaseId}/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({ sql, params }),
    }
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    const message = payload?.errors?.map((e: any) => e.message).join("; ") || response.statusText;
    throw new Error(`Cloudflare D1 query failed: ${message}`);
  }

  return payload.result?.[0]?.results || [];
}

export async function ensureProjectMemorySchema() {
  if (!isProjectMemoryConfigured()) return { configured: false };

  await queryD1(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  await queryD1(`CREATE TABLE IF NOT EXISTS project_memory_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  )`);

  return { configured: true };
}

export async function upsertProject(projectId: string, name?: string) {
  if (!projectId || !isProjectMemoryConfigured()) return null;

  await ensureProjectMemorySchema();
  const now = new Date().toISOString();
  const projectName = name?.trim() || projectId;

  await queryD1(
    `INSERT INTO projects (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(NULLIF(?, ''), name),
       updated_at = ?`,
    [projectId, projectName, now, now, projectName, now]
  );

  return { id: projectId, name: projectName, updatedAt: now };
}

export async function listProjects() {
  if (!isProjectMemoryConfigured()) return [];
  await ensureProjectMemorySchema();

  return await queryD1(
    `SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
     FROM projects
     ORDER BY updated_at DESC
     LIMIT 100`
  );
}

export async function getProjectMemory(projectId: string, limit = MAX_MEMORY_ITEMS) {
  if (!projectId || !isProjectMemoryConfigured()) return [];
  await ensureProjectMemorySchema();

  return await queryD1(
    `SELECT id, project_id AS projectId, tool_name AS toolName, type, title, summary, content, metadata, created_at AS createdAt
     FROM project_memory_items
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [projectId, limit]
  );
}

export async function saveProjectMemoryItem(item: ProjectMemoryItem) {
  if (!item?.projectId || !item?.content || !isProjectMemoryConfigured()) return null;

  await upsertProject(item.projectId);
  const now = item.createdAt || new Date().toISOString();
  const id = item.id || makeId();

  await queryD1(
    `INSERT INTO project_memory_items (id, project_id, tool_name, type, title, summary, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      item.projectId,
      item.toolName || "unknown-tool",
      item.type || "output",
      item.title || null,
      item.summary || null,
      item.content,
      item.metadata ? JSON.stringify(item.metadata) : null,
      now,
    ]
  );

  return { id, createdAt: now };
}

export function buildProjectMemoryContext(items: any[] = []) {
  if (!items.length) return "";

  const sorted = [...items].reverse();
  const chunks = sorted.map((item, index) => {
    const title = item.title ? `Title: ${item.title}` : "Title: Untitled";
    const summary = item.summary ? `Summary: ${item.summary}` : "";
    const content = String(item.summary || item.content || "").slice(0, 1400);

    return [
      `Memory item ${index + 1}`,
      `Tool: ${item.toolName || item.tool_name || "unknown"}`,
      `Type: ${item.type || "output"}`,
      title,
      summary,
      `Content: ${content}`,
    ].filter(Boolean).join("\n");
  });

  const context = chunks.join("\n\n---\n\n");
  return context.length > MAX_MEMORY_CHARS ? context.slice(0, MAX_MEMORY_CHARS) + "\n\n[Project memory truncated]" : context;
}

export function summariseOutputForMemory(text: string, maxLength = 700) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > maxLength ? clean.slice(0, maxLength - 3) + "..." : clean;
}
