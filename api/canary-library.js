import { listObjects, getJson, putJson } from "../lib/r2.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";
import {
  projectReportMetaPrefix,
  requireProjectReportScope,
  normalizeSector
} from "../lib/projectReports.js";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function getStateKeyForScope(scope) {
  const prefix = projectReportMetaPrefix(scope);
  return `${prefix}library-state.json`;
}

async function readState(scope) {
  try {
    const stateKey = getStateKeyForScope(scope);
    const state = await getJson(stateKey);
    return {
      selectedById: state.selectedById || {},
      deletedById: state.deletedById || {}
    };
  } catch {
    return {
      selectedById: {},
      deletedById: {}
    };
  }
}

async function writeState(scope, state) {
  const stateKey = getStateKeyForScope(scope);
  await putJson(stateKey, state);
}

async function buildLibrary(scope) {
  const state = await readState(scope);
  const metaPrefix = projectReportMetaPrefix(scope);
  const stateKey = getStateKeyForScope(scope);
  const objects = await listObjects(metaPrefix);

  const metaObjects = objects
    .filter((object) => object.key)
    .filter((object) => object.key !== stateKey)
    .filter((object) => !state.deletedById[object.key]);

  const items = await Promise.all(
    metaObjects.map(async (object) => {
      let meta = {};

      try {
        meta = await getJson(object.key);
      } catch {
        meta = {};
      }

      const name =
        meta.filename ||
        meta.name ||
        meta.title ||
        meta.originalFilename ||
        object.key.split("/").pop();

      return {
        id: object.key,
        key: object.key,
        name,
        selected: state.selectedById[object.key] !== false,
        addedAt: meta.addedAt
          ? new Date(meta.addedAt).toLocaleString()
          : object.uploadedAt
            ? new Date(object.uploadedAt).toLocaleString()
            : "",
        size: meta.size || object.size || 0,
        url: meta.blobUrl || meta.url || meta.publicUrl || object.url,
        hash: meta.hash || ""
      };
    })
  );

  return {
    items: items.sort((a, b) => {
      const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0;
      const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0;
      return bTime - aTime;
    }),
    state
  };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (!requireDemoToken(req, res)) return;

  try {
    let scope;
    
    if (req.method === "GET") {
      const base = req.headers.host ? `http://${req.headers.host}` : "http://localhost";
      const url = new URL(req.url, base);
      scope = requireProjectReportScope({
        projectId: url.searchParams.get("projectId"),
        sector: url.searchParams.get("sector") || "canary"
      });
      
      const { items } = await buildLibrary(scope);
      return json(res, 200, { items });
    }

    if (req.method !== "POST") {
      return json(res, 405, { error: "Use GET or POST." });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    scope = requireProjectReportScope({
      projectId: body.projectId,
      sector: body.sector || "canary"
    });

    const action = String(body.action || "");
    const id = String(body.id || "");

    const { state } = await buildLibrary(scope);

    if (action === "toggle") {
      if (!id) return json(res, 400, { error: "Missing id." });

      state.selectedById[id] = state.selectedById[id] === false;
      await writeState(scope, state);

      const { items } = await buildLibrary(scope);
      return json(res, 200, { items });
    }

    if (action === "delete") {
      if (!id) return json(res, 400, { error: "Missing id." });

      state.deletedById[id] = true;
      await writeState(scope, state);

      const { items } = await buildLibrary(scope);
      return json(res, 200, { items });
    }

    if (action === "add") {
      const item = body.item || {};
      const idFromItem = String(item.key || item.id || "");

      if (idFromItem) {
        state.selectedById[idFromItem] = item.selected !== false;
        delete state.deletedById[idFromItem];
        await writeState(scope, state);
      }

      const { items } = await buildLibrary(scope);
      return json(res, 200, { items });
    }

    return json(res, 400, { error: "Unknown action." });
  } catch (err) {
    const details = String(err?.message || err);
    const status = /^Missing (projectId|sector)$/.test(details) ? 400 : 500;
    return json(res, status, {
      error: "CANARY_LIBRARY_FAILED",
      details
    });
  }
}