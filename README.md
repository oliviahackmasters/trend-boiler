# Trend Boiler — Emergency Fix Guide
## For Olivia / WRC Demo — Berlin 9:30am deadline

---

## DIAGNOSIS: What's Actually Wrong

After reading every file in the codebase, here are the exact problems:

### Problem 1 — `upload.js` has a HARDCODED private R2 URL (🔴 Critical)
**File:** `api/upload.js` line 58

```js
// ❌ BROKEN — hardcoded private storage URL, will fail for anyone else
url: `https://trendboiler.9efb638d4bce36925d6fa1dba2176c8c.r2.cloudflarestorage.com/${key}`
```

This URL is the **private R2 endpoint** — it's not publicly accessible and bypasses
the `R2_PUBLIC_BASE_URL` env var entirely. Every upload returns a URL that nobody
can actually read from. This is likely why the tool appears to "fail immediately."

**Fix:** Use `publicUrlForKey(key)` from `lib/r2.js` (which reads `R2_PUBLIC_BASE_URL`).
The fixed file is in this package: `api/upload.js`

---

### Problem 2 — `migrate-company-names.js` has a `blob.pathname` reference (🟡 Bug)
**File:** `api/migrate-company-names.js` line ~160

```js
// ❌ BROKEN — `blob` is not defined here, the variable is `file`
errors.push({ file: blob.pathname, error: fileErr.message });
```

This will throw `ReferenceError: blob is not defined` in any error path during
migration runs. Fixed in the package: `api/migrate-company-names.js`

---

### Problem 3 — R2 env vars may not be set correctly in Vercel (🔴 Critical)
The `lib/r2.js` client reads 4 env vars at module load time:
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BASE_URL`

If **any** of these are missing or wrong in Vercel → every API call fails immediately.
The `blob-upload-url.js` even has an explicit check for this and returns a 500.

---

## STEP-BY-STEP FIX (do in this order)

### Step 1 — Verify R2 bucket has public access enabled

In Cloudflare dashboard:
1. Go to R2 → your bucket (trendboiler)
2. Click **Settings**
3. Under **Public access** → enable **R2.dev subdomain** (quickest option)
4. Copy the URL — looks like `https://pub-xxxx.r2.dev`

Without this, uploaded files are stored but nobody can read them back.

---

### Step 2 — Set all Vercel env vars

Go to: **Vercel Dashboard → trend-boiler project → Settings → Environment Variables**

Make sure ALL of these are set (see `VERCEL_ENV_VARS.md` for the full reference):

```
R2_ACCOUNT_ID          ← your Cloudflare account ID
R2_BUCKET_NAME         ← trendboiler (or whatever you named it)
R2_ACCESS_KEY_ID       ← from R2 API token
R2_SECRET_ACCESS_KEY   ← from R2 API token (only shown once when created)
R2_PUBLIC_BASE_URL     ← https://pub-xxxx.r2.dev  (from Step 1)
OPENAI_API_KEY         ← your OpenAI key
BASE_VECTOR_STORE_ID   ← your vector store ID
DEMO_TOKEN             ← any string you share with Saher
```

After setting env vars → **Vercel auto-redeploys**. Wait for it to finish.

---

### Step 3 — Replace the two broken files

Copy from this fix package into your repo:

```
api/upload.js                 → replaces api/upload.js
api/migrate-company-names.js  → replaces api/migrate-company-names.js
```

Commit and push → Vercel will redeploy.

---

### Step 4 — Test the health endpoint

Once deployed, hit:
```
GET https://your-vercel-url.vercel.app/api/health
```

Expected response: `{"ok": true}`

If you get an error here, the R2 CORS config failed — check the env vars again.

---

### Step 5 — Test an upload end-to-end

Using curl or Postman:
```bash
curl -X POST https://your-vercel-url.vercel.app/api/blob-upload-url \
  -H "Content-Type: application/json" \
  -H "x-demo-token: YOUR_DEMO_TOKEN" \
  -d '{"filename": "test.pdf", "contentType": "application/pdf"}'
```

Expected: returns `{ uploadUrl, publicUrl, key }` where `publicUrl` starts with
your `R2_PUBLIC_BASE_URL` (e.g. `https://pub-xxxx.r2.dev/uploads/...`)

If `publicUrl` starts with `r2.cloudflarestorage.com` → the old file is still deployed.
Make sure the new `upload.js` is committed and Vercel has redeployed.

---

## What the Vercel Blob Problem Was

When you hit the 1GB Vercel Blob limit:
- The `BLOB_READ_WRITE_TOKEN` becomes locked at the storage layer
- **Every request that imports `@vercel/blob` fails immediately** at module load
- This looks like the site is completely broken

The R2 migration in this codebase is **already structurally complete** —
`lib/r2.js` is solid, all API routes import from it correctly. The only
actual bug was the hardcoded private URL in `upload.js`.

The old Vercel Blob token (`BLOB_READ_WRITE_TOKEN`) is not referenced anywhere
in this codebase — so once you've set the R2 env vars correctly and deployed,
the Vercel Blob lock is irrelevant.

---

## For the WRC Demo — Quick Checklist

- [ ] R2 bucket public access enabled (r2.dev subdomain)
- [ ] All env vars set in Vercel (especially `R2_PUBLIC_BASE_URL`)
- [ ] `api/upload.js` replaced with fixed version and deployed
- [ ] `/api/health` returns `{"ok": true}`
- [ ] Upload test returns a `publicUrl` starting with your r2.dev URL
- [ ] Library loads correctly
- [ ] PDF ingestion and Q&A working end-to-end
- [ ] Saher has the `DEMO_TOKEN` value
