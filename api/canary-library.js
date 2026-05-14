import { listObjects, getJson, putJson } from "../lib/r2.js";
import { setCors, handleOptions, requireDemoToken } from "../lib/cors.js";

const META_PREFIX = "trend-library/meta/canary/";
const STATE_KEY = "trend-library/meta/canary/library-state.json";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readState() {
  try {
    const state = await getJson(STATE_KEY);
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

async function writeState(state) {
  await putJson(STATE_KEY, state);
}

function filenameFromKey(key) {
  return key
    .split("/")
    .pop()
    .replace(/\.json$/, "");
}

async function buildLibrary() {
  const state = await readState();
  const objects = await listObjects(META_PREFIX);

  const metaObjects = objects
    .filter((object) => object.key)
    .filter((object) => object.key !== STATE_KEY)
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
    if (req.method === "GET") {
      const { items } = await buildLibrary();
      return json(res, 200, { items });
    }

    if (req.method !== "POST") {
      return json(res, 405, { error: "Use GET or POST." });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const action = String(body.action || "");
    const id = String(body.id || "");

    const { state } = await buildLibrary();

    if (action === "toggle") {
      if (!id) return json(res, 400, { error: "Missing id." });

      state.selectedById[id] = state.selectedById[id] === false;
      await writeState(state);

      const { items } = await buildLibrary();
      return json(res, 200, { items });
    }

    if (action === "delete") {
      if (!id) return json(res, 400, { error: "Missing id." });

      state.deletedById[id] = true;
      await writeState(state);

      const { items } = await buildLibrary();
      return json(res, 200, { items });
    }

if (action === "add") {
  const item = body.item || {};
  const idFromItem = String(item.key || item.id || "");

  if (idFromItem) {
    state.selectedById[idFromItem] = item.selected !== false;
    delete state.deletedById[idFromItem];
    await writeState(state);
  }

  const { items } = await buildLibrary();
  return json(res, 200, { items });
}

    return json(res, 400, { error: "Unknown action." });
  } catch (err) {
    return json(res, 500, {
      error: "CANARY_LIBRARY_FAILED",
      details: String(err?.message || err)
    });
  }
}