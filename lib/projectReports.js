import crypto from "crypto";
import { getJson, listObjects, putJson } from "./r2.js";
import { VECTOR_STORE_SECTORS, getVectorStores } from "./vs.js";

const PROJECT_META_ROOT = "trend-library/meta/projects";
const PROJECT_VECTOR_STORE_ROOT = "trend-library/vector-stores/projects";

export function normalizeSector(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeProjectId(value) {
  return String(value || "").trim();
}

export function requireProjectReportScope({ projectId, sector }) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedSector = normalizeSector(sector);

  if (!normalizedProjectId) {
    throw new Error("Missing projectId");
  }

  if (!normalizedSector) {
    throw new Error("Missing sector");
  }

  return { projectId: normalizedProjectId, sector: normalizedSector };
}

export function isTrendReportSector(sector) {
  return VECTOR_STORE_SECTORS.includes(normalizeSector(sector));
}

export function safeFilename(name) {
  return String(name || "report.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120) || "report.pdf";
}

export function makeReportId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function pathSegment(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) return fallback;
  return encodeURIComponent(raw);
}

export function buildReportObjectKey({ projectId, sector, reportId, filename }) {
  const scope = requireProjectReportScope({ projectId, sector });
  const id = String(reportId || makeReportId()).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return [
    "projects",
    pathSegment(scope.projectId, "unknown-project"),
    "sectors",
    pathSegment(scope.sector, "unknown-sector"),
    `${id || makeReportId()}-${safeFilename(filename)}`
  ].join("/");
}

export function projectReportMetaPrefix({ projectId, sector }) {
  const scope = requireProjectReportScope({ projectId, sector });
  return `${PROJECT_META_ROOT}/${pathSegment(scope.projectId)}/sectors/${pathSegment(scope.sector)}/`;
}

export function projectReportMetaKey({ projectId, sector, hash }) {
  const scope = requireProjectReportScope({ projectId, sector });
  const normalizedHash = String(hash || "").trim().toLowerCase();
  if (!normalizedHash) throw new Error("Missing hash");
  return `${projectReportMetaPrefix(scope)}${normalizedHash}.json`;
}

export function projectVectorStoreMetaKey({ projectId, sector }) {
  const scope = requireProjectReportScope({ projectId, sector });
  return `${PROJECT_VECTOR_STORE_ROOT}/${pathSegment(scope.projectId)}/sectors/${pathSegment(scope.sector)}.json`;
}

export async function listProjectSectorReports({ projectId, sector }) {
  const scope = requireProjectReportScope({ projectId, sector });
  const objects = await listObjects(projectReportMetaPrefix(scope));
  const items = [];

  for (const object of objects) {
    const meta = await getJson(object.key).catch(() => null);
    if (!meta) continue;

    const itemProjectId = normalizeProjectId(meta.projectId);
    const itemSector = normalizeSector(meta.sector);

    if (itemProjectId === scope.projectId && itemSector === scope.sector) {
      items.push({ ...meta, metaKey: meta.metaKey || object.key });
    }
  }

  items.sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
  return items;
}

export async function getProjectReportByHash({ projectId, sector, hash }) {
  const scope = requireProjectReportScope({ projectId, sector });
  const metaKey = projectReportMetaKey({ ...scope, hash });
  const meta = await getJson(metaKey).catch(() => null);

  if (
    !meta ||
    normalizeProjectId(meta.projectId) !== scope.projectId ||
    normalizeSector(meta.sector) !== scope.sector
  ) {
    return null;
  }

  return { meta, metaKey };
}

export async function getStoredProjectVectorStoreId({ projectId, sector }) {
  const scope = requireProjectReportScope({ projectId, sector });
  const stored = await getJson(projectVectorStoreMetaKey(scope)).catch(() => null);
  if (
    stored?.vectorStoreId &&
    normalizeProjectId(stored.projectId) === scope.projectId &&
    normalizeSector(stored.sector) === scope.sector
  ) {
    return stored.vectorStoreId;
  }
  return null;
}

export async function getOrCreateProjectVectorStore({ openai, projectId, sector }) {
  const scope = requireProjectReportScope({ projectId, sector });
  const existing = await getStoredProjectVectorStoreId(scope);
  if (existing) return existing;

  const vectorStores = getVectorStores(openai);
  if (!vectorStores?.create) {
    throw new Error("Vector store creation is not available");
  }

  const name = `Trend Boiler ${scope.projectId} / ${scope.sector}`.slice(0, 240);
  const created = await vectorStores.create({ name });
  const vectorStoreId = created?.id;
  if (!vectorStoreId) throw new Error("Vector store creation did not return an id");

  const now = new Date().toISOString();
  await putJson(projectVectorStoreMetaKey(scope), {
    projectId: scope.projectId,
    sector: scope.sector,
    vectorStoreId,
    createdAt: now,
    updatedAt: now
  });

  return vectorStoreId;
}

export function buildSourcePack(reports, { projectId, sector }) {
  const scope = requireProjectReportScope({ projectId, sector });
  const rows = (Array.isArray(reports) ? reports : []).slice(0, 40).map((report, index) => {
    const tags = [
      report.tags?.company,
      report.tags?.year,
      ...(Array.isArray(report.tags?.topics) ? report.tags.topics.slice(0, 4) : [])
    ].filter(Boolean).join(", ");
    return `${index + 1}. ${report.filename || report.sourceUrl || report.hash}${tags ? ` (${tags})` : ""}`;
  });

  return [
    `PROJECT SOURCE SCOPE: projectId=${scope.projectId}; sector=${scope.sector}`,
    "Use only sources matching both this projectId and sector. Do not use sector-wide, legacy, or other-project sources.",
    rows.length ? "Available scoped sources:" : "No scoped sources are available.",
    ...rows
  ].join("\n");
}
