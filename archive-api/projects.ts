

function makeProjectId(name: string) {
  const slug = String(name || "project")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug}-${suffix}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (!isProjectMemoryConfigured()) {
    return res.status(503).json({
      error: "Project memory is not configured",
      configured: false,
      requiredEnv: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_D1_DATABASE_ID", "CLOUDFLARE_API_TOKEN"],
    });
  }

  try {
    if (req.method === "GET") {
      const projectId = req.query?.projectId?.toString?.().trim();

      if (projectId) {
        const memory = await getProjectMemory(projectId, 50);
        return res.status(200).json({ configured: true, projectId, memory });
      }

      const projects = await listProjects();
      return res.status(200).json({ configured: true, projects });
    }

    if (req.method === "POST") {
      const name = req.body?.name?.toString?.().trim();
      const suppliedId = req.body?.projectId?.toString?.().trim();

      if (!name && !suppliedId) {
        return res.status(400).json({ error: "Missing project name or projectId" });
      }

      const projectId = suppliedId || makeProjectId(name);
      const project = await upsertProject(projectId, name || projectId);
      return res.status(200).json({ configured: true, project });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("projects handler failed:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
}
