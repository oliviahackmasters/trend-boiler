import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import net from "net";
import { lookup } from "dns/promises";
import { listObjects, putJson, putObject } from "../lib/r2.js";
import {
  buildReportObjectKey,
  getOrCreateProjectVectorStore,
  isTrendReportSector,
  makeReportId,
  normalizeSector,
  projectReportMetaKey,
  requireProjectReportScope
} from "../lib/projectReports.js";
import { openai } from "../lib/openaiClient.js";
import { getVectorStores, getVectorStoreIdForSector } from "../lib/vs.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function safeFilename(name) {
  return String(name || "web-report")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100) || "web-report";
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    );
  }

  if (net.isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }

  return false;
}

async function validatePublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("Enter a valid URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not supported.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || isPrivateIp(host)) {
    throw new Error("Local or private network URLs are not supported.");
  }

  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (addresses.some(entry => isPrivateIp(entry.address))) {
    throw new Error("Local or private network URLs are not supported.");
  }

  return parsed;
}

function decodeHtmlEntities(text) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };

  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key[0] === "#") {
      const code = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] || match;
  });
}

function extractMeta(html, property) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  return decodeHtmlEntities(html.match(pattern)?.[1] || "").trim();
}

function extractTitle(html, url) {
  return (
    extractMeta(html, "og:title") ||
    decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim() ||
    url.hostname
  );
}

function htmlToText(html) {
  const withoutNoise = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const withBreaks = withoutNoise
    .replace(/<\/(p|div|section|article|header|footer|main|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function guessYear(text) {
  const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : "";
}

function guessTopics(text) {
  const lower = String(text || "").toLowerCase();
  const map = [
    ["health", "Health"],
    ["wellness", "Health"],
    ["retail", "Retail"],
    ["consumer", "Consumer"],
    ["luxury", "Luxury"],
    ["fashion", "Fashion"],
    ["beauty", "Beauty"],
    ["finance", "Finance"],
    ["bank", "Banking"],
    ["ai", "AI"],
    ["technology", "Technology"],
    ["sustain", "Sustainability"],
    ["climate", "Climate"],
    ["energy", "Energy"],
    ["media", "Media"],
    ["culture", "Culture"],
    ["government", "Government"],
    ["security", "Security"]
  ];

  return [...new Set(map.filter(([needle]) => lower.includes(needle)).map(([, label]) => label))].slice(0, 12);
}

function mergeTags({ base, manual }) {
  const manualTopics = Array.isArray(manual?.topics) ? manual.topics : [];
  return {
    year: String(manual?.year || base.year || "").trim().slice(0, 4),
    company: String(manual?.company || base.company || "").trim().slice(0, 80),
    topics: [...new Set([...manualTopics, ...(base.topics || [])].map(t => String(t).trim()).filter(Boolean))].slice(0, 12)
  };
}

function buildWebText({ url, title, description, text }) {
  return [
    `Title: ${title}`,
    `URL: ${url}`,
    description ? `Description: ${description}` : "",
    "",
    text
  ].filter(Boolean).join("\n");
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  if (req.method !== "POST") return json(res, 405, { error: "Use POST." });

  let tmpPath = "";

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const parsedUrl = await validatePublicUrl(body.url);
    const sourceUrl = parsedUrl.toString();
    const sector = normalizeSector(body.sector);
    if (!sector) return json(res, 400, { error: "Missing sector" });
    const reportScope = isTrendReportSector(sector)
      ? requireProjectReportScope({ projectId: body.projectId, sector })
      : null;
    const tagsIn = body.tags || {};

    const vsid = reportScope
      ? await getOrCreateProjectVectorStore({ openai, ...reportScope })
      : getVectorStoreIdForSector(sector);
    if (!vsid) return json(res, 500, { error: `Missing vector store ID for sector: ${sector}` });

    const resp = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "TrendBoiler/1.0 (+https://trend-report-platform.vercel.app)",
        "Accept": "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25000)
    });

    if (!resp.ok) throw new Error(`Could not fetch URL: ${resp.status}`);

    const contentType = (resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buf = Buffer.from(await resp.arrayBuffer());
    const maxBytes = contentType === "application/pdf" ? 30 * 1024 * 1024 : 8 * 1024 * 1024;
    if (buf.length > maxBytes) throw new Error("URL content is too large to ingest.");

    let uploadBuffer = buf;
    let uploadContentType = contentType || "text/plain";
    let extension = ".txt";
    let title = parsedUrl.hostname;
    let description = "";
    let articleText = "";

    if (contentType === "application/pdf" || parsedUrl.pathname.toLowerCase().endsWith(".pdf")) {
      extension = ".pdf";
      uploadContentType = "application/pdf";
      title = safeFilename(path.basename(parsedUrl.pathname) || parsedUrl.hostname).replace(/\.pdf$/i, "");
    } else {
      const html = buf.toString("utf8");
      title = extractTitle(html, parsedUrl);
      description = extractMeta(html, "description") || extractMeta(html, "og:description");
      articleText = contentType === "text/plain" ? html.trim() : htmlToText(html);

      if (articleText.length < 400) {
        throw new Error("Could not extract enough readable text from this URL.");
      }

      const textForUpload = buildWebText({ url: sourceUrl, title, description, text: articleText });
      uploadBuffer = Buffer.from(textForUpload, "utf8");
      uploadContentType = "text/plain; charset=utf-8";
    }

    const hash = crypto.createHash("sha256").update(uploadBuffer).digest("hex");
    const sectorMetaKey = reportScope
      ? projectReportMetaKey({ ...reportScope, hash })
      : `trend-library/meta/${sector}/${hash}.json`;
    const existing = await listObjects(sectorMetaKey);
    if (existing.length) {
      return json(res, 200, {
        ok: true,
        duplicate: true,
        hash,
        projectId: reportScope?.projectId || null,
        sector
      });
    }

    const baseName = safeFilename(title || parsedUrl.hostname);
    const reportId = String(body.reportId || makeReportId()).trim();
    const objectKey = reportScope
      ? buildReportObjectKey({ ...reportScope, reportId, filename: `${baseName}${extension}` })
      : `uploads/url-${hash.slice(0, 16)}-${baseName}${extension}`;
    const stored = await putObject(objectKey, uploadBuffer, uploadContentType);

    tmpPath = path.join(os.tmpdir(), `ingest-url-${Date.now()}${extension}`);
    fs.writeFileSync(tmpPath, uploadBuffer);

    const createdFile = await openai.files.create({
      file: fs.createReadStream(tmpPath),
      purpose: "assistants"
    });

    const vectorStores = getVectorStores(openai);
    const vsFile = await vectorStores.files.create(vsid, { file_id: createdFile.id });

    const finalTags = mergeTags({
      base: {
        year: guessYear(`${title} ${articleText}`),
        company: parsedUrl.hostname.replace(/^www\./, ""),
        topics: guessTopics(`${title} ${description} ${articleText}`)
      },
      manual: tagsIn
    });

    const meta = {
      hash,
      metaKey: sectorMetaKey,
      ...(reportScope ? { projectId: reportScope.projectId } : {}),
      sector,
      reportId,
      filename: `${title}${extension}`,
      pathname: objectKey,
      r2Key: objectKey,
      blobUrl: stored.url,
      sourceUrl,
      sourceType: contentType === "application/pdf" ? "pdf-url" : "url",
      size: uploadBuffer.length,
      addedAt: new Date().toISOString(),
      tags: finalTags,
      openaiFileId: createdFile.id,
      vsFileId: vsFile?.id || null,
      vectorStoreId: reportScope ? vsid : null
    };

    await putJson(sectorMetaKey, meta);

    return json(res, 200, {
      ok: true,
      duplicate: false,
      hash,
      title,
      filename: meta.filename,
      sourceUrl,
      projectId: reportScope?.projectId || null,
      sector,
      tags: finalTags
    });
  } catch (e) {
    const details = String(e?.message || e);
    const status = /^Missing (projectId|sector)$/.test(details) ? 400 : 500;
    return json(res, status, { error: "URL INGEST FAILED", details });
  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}
