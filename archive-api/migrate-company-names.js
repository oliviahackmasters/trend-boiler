/**
 * api/migrate-company-names.js  (fixed)
 *
 * FIX: Line ~160 referenced `blob.pathname` which is undefined —
 * the variable in scope is `file`, not `blob`. Changed to `file.key`.
 */
import { listObjects, putJson, getJson } from "../lib/r2.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function normalizeCompanyName(company) {
  if (!company) return "";
  const input = String(company || "").trim();
  if (!input) return "";

  const companyMap = {
    deloitte: "Deloitte", deloite: "Deloitte", dltt: "Deloitte", di: "Deloitte",
    mckinsey: "McKinsey & Company", mckinsey_company: "McKinsey & Company", mckinsey_co: "McKinsey & Company", mcg: "McKinsey & Company",
    bcg: "Boston Consulting Group", boston_consulting: "Boston Consulting Group",
    bain: "Bain & Company", bain_company: "Bain & Company",
    pwc: "PwC", pricewaterhousecoopers: "PwC", pricewaterhouse: "PwC", pwcc: "PwC",
    kpmg: "KPMG", kpmgllp: "KPMG",
    ey: "EY", ernst_young: "EY", ernst_and_young: "EY",
    occ: "OC&C Strategy Consultants", occ_strategy: "OC&C Strategy Consultants",
    lek: "L.E.K. Consulting", lek_consulting: "L.E.K. Consulting",
    accenture: "Accenture",
    oliver_wyman: "Oliver Wyman", oliverwyman: "Oliver Wyman",
    capgemini: "Capgemini",
    gartner: "Gartner",
    forrester: "Forrester",
    idc: "IDC",
    eiu: "The Economist Intelligence Unit",
    economist_intelligence: "The Economist Intelligence Unit",
    economist_unit: "The Economist Intelligence Unit",
  };

  const normalized = input.toLowerCase().replace(/[&.,\-\s]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (companyMap[normalized]) return companyMap[normalized];
  for (const [key, canonical] of Object.entries(companyMap)) {
    if (normalized.includes(key) || key.includes(normalized)) return canonical;
  }
  return input.split(/[\s\-&]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  if (req.method !== "POST" && req.method !== "GET") {
    return json(res, 405, { error: "Use GET or POST." });
  }

  try {
    const metaFiles = await listObjects("trend-library/meta/");
    let updated = 0;
    let unchanged = 0;
    const changes = [];
    const errors = [];

    for (const file of metaFiles) {
      if (!file.key.endsWith(".json")) continue;

      try {
        const meta = await getJson(file.key);
        const oldCompany = meta.tags?.company || "";
        const newCompany = normalizeCompanyName(oldCompany);

        if (oldCompany && oldCompany !== newCompany) {
          meta.tags = meta.tags || {};
          meta.tags.company = newCompany;
          await putJson(file.key, meta);
          changes.push({ file: file.key, old: oldCompany, new: newCompany, sector: meta.sector || "unknown" });
          updated++;
        } else {
          unchanged++;
        }
      } catch (fileErr) {
        // ✅ FIX: was `blob.pathname` (undefined) — corrected to `file.key`
        errors.push({ file: file.key, error: fileErr.message });
      }
    }

    const bySector = {};
    changes.forEach(c => {
      if (!bySector[c.sector]) bySector[c.sector] = [];
      bySector[c.sector].push(c);
    });

    const summary = {};
    for (const [sector, items] of Object.entries(bySector)) {
      const byOld = {};
      items.forEach(item => {
        if (!byOld[item.old]) byOld[item.old] = { count: 0, newName: item.new };
        byOld[item.old].count++;
      });
      summary[sector] = byOld;
    }

    return json(res, 200, {
      success: true,
      status: "Migration complete",
      stats: { totalFiles: metaFiles.filter(f => f.key.endsWith(".json")).length, updated, unchanged, errors: errors.length },
      summary,
      changes: changes.slice(0, 50),
      errors: errors.slice(0, 10),
      note: changes.length > 50 ? `Showing first 50 of ${changes.length} changes` : undefined
    });
  } catch (err) {
    return json(res, 500, { error: "MIGRATION FAILED", details: err.message });
  }
}
