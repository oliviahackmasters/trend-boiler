# Trend Boiler — Vercel Environment Variables
# ─────────────────────────────────────────────
# Set ALL of these in: Vercel Dashboard → Your Project → Settings → Environment Variables
# Apply to: Production, Preview, Development

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# ── Vector Stores ─────────────────────────────────────────────────────────────
# The base/default vector store (luxury sector or fallback)
BASE_VECTOR_STORE_ID=vs_...

# Per-sector vector stores
# Pattern: VECTOR_STORE_ID_<SECTOR_UPPERCASE>
VECTOR_STORE_ID_LUXURY=vs_...
VECTOR_STORE_ID_BANKING=vs_...
VECTOR_STORE_ID_RETAIL=vs_...
VECTOR_STORE_ID_GOVERNMENT=vs_...
VECTOR_STORE_ID_OSINT=vs_...
VECTOR_STORE_ID_TRADE=vs_...
VECTOR_STORE_ID_LOGISTICS=vs_...
VECTOR_STORE_ID_HOSPITALITY=vs_...

# ── Cloudflare R2 ─────────────────────────────────────────────────────────────
# Find these in: Cloudflare Dashboard → R2 → Your Bucket → Settings

# Your Cloudflare account ID (from Cloudflare dashboard URL or R2 settings)
R2_ACCOUNT_ID=your_cloudflare_account_id

# R2 bucket name (exactly as created in Cloudflare)
R2_BUCKET_NAME=trendboiler

# R2 API credentials — create in: Cloudflare → R2 → Manage R2 API Tokens
# Give it: Object Read & Write permissions on your bucket
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key

# Public bucket URL — set this up in Cloudflare R2 bucket settings
# Options (use ONE):
#   Option A - Custom domain:   https://files.yourdomain.com
#   Option B - R2.dev subdomain: https://pub-xxxx.r2.dev  (enable in bucket settings)
#   Option C - Direct (private): leave blank and use signed URLs only
R2_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev

# ── Auth ──────────────────────────────────────────────────────────────────────
# Token required in x-demo-token header or Authorization: Bearer <token>
# Set to any random string — share with Saher for the WRC demo
DEMO_TOKEN=your-demo-token-here

# Session signing (used by /api/session)
# Set to any long random string (min 32 chars)
SESSION_SIGNING_SECRET=your-long-random-secret-here

# ── HOW TO CREATE R2 API CREDENTIALS ─────────────────────────────────────────
# 1. Go to https://dash.cloudflare.com
# 2. Click R2 in the left sidebar
# 3. Click "Manage R2 API Tokens" (top right)
# 4. Click "Create API Token"
# 5. Set permissions: Object Read & Write
# 6. Restrict to your specific bucket (recommended)
# 7. Copy the Access Key ID and Secret Access Key — save them NOW
#    (the secret is only shown once)

# ── HOW TO ENABLE PUBLIC ACCESS ON YOUR R2 BUCKET ────────────────────────────
# Option A - Use r2.dev (quickest for demo):
# 1. Go to R2 → Your bucket → Settings
# 2. Under "Public access" → enable "R2.dev subdomain"
# 3. Copy the public URL (looks like https://pub-xxxx.r2.dev)
# 4. Set that as R2_PUBLIC_BASE_URL above

# Option B - Custom domain (production):
# 1. Go to R2 → Your bucket → Settings → Custom Domains
# 2. Add your domain (e.g. files.hackmasters.co.uk)
# 3. Follow Cloudflare DNS steps
# 4. Set https://files.hackmasters.co.uk as R2_PUBLIC_BASE_URL
