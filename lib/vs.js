export const VECTOR_STORE_SECTORS = [
  "luxury",
  "banking",
  "retail",
  "government",
  "osint",
  "trade",
  "logistics",
  "hospitality",

  // Additional sector stores
  "technology",
  "manufacturing",
  "finance",
  "sales"
];

export const SECTOR_LABELS = {
  luxury: "Luxury",
  banking: "Banking",
  retail: "Retail",
  government: "Government",
  osint: "OSINT",
  trade: "Trade",
  logistics: "Logistics",
  hospitality: "Hospitality",
  technology: "Technology & Digital",
  manufacturing: "Manufacturing & Production",
  finance: "Finance, Investment & Corporate Strategy",
  sales: "Sales, Distribution & CEX"
};

export const VECTOR_STORE_ENV_KEYS = VECTOR_STORE_SECTORS.reduce((acc, sector) => {
  const normalized = sector.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  acc[sector] = `VECTOR_STORE_ID_${normalized}`;
  return acc;
}, {});

export function getVectorStores(openai) {
  return openai.vectorStores || openai.vector_stores;
}

export function normalizeVectorStoreSector(sector) {
  const raw = String(sector || "").trim().toLowerCase();

  const aliases = {
    "technology-digital": "technology",
    "technology_and_digital": "technology",
    "tech": "technology",
    "digital": "technology",

    "manufacturing-production": "manufacturing",
    "manufacturing_and_production": "manufacturing",
    "production": "manufacturing",

    "finance-investment-corporate-strategy": "finance",
    "finance_investment_corporate_strategy": "finance",
    "investment": "finance",
    "corporate-strategy": "finance",
    "corporate_strategy": "finance",

    "sales-distribution-cex": "sales",
    "sales_distribution_cex": "sales",
    "distribution": "sales",
    "cex": "sales",
    "customer-experience": "sales",
    "customer_experience": "sales"
  };

  return aliases[raw] || raw;
}

export function getVectorStoreIdForSector(sector) {
  const base = process.env.BASE_VECTOR_STORE_ID;
  const normalizedSector = normalizeVectorStoreSector(sector);

  if (!normalizedSector) return base;

  const normalized = normalizedSector
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");

  if (!normalized) return base;

  const envKey = `VECTOR_STORE_ID_${normalized}`;
  return process.env[envKey] || base;
}