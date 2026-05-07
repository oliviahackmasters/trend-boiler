export const VECTOR_STORE_SECTORS = [
  "luxury",
  "banking",
  "retail",
  "government",
  "osint",
  "trade",
  "logistics",
  "hospitality"
];

export const VECTOR_STORE_ENV_KEYS = VECTOR_STORE_SECTORS.reduce((acc, sector) => {
  const normalized = sector.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  acc[sector] = `VECTOR_STORE_ID_${normalized}`;
  return acc;
}, {});

export function getVectorStores(openai) {
  return openai.vectorStores || openai.vector_stores;
}

export function getVectorStoreIdForSector(sector) {
  const base = process.env.BASE_VECTOR_STORE_ID;
  if (!sector) return base;

  const normalized = String(sector || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  if (!normalized) return base;

  const envKey = `VECTOR_STORE_ID_${normalized}`;
  return process.env[envKey] || base;
}
