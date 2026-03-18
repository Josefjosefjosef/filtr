# Force deploy — steep-term-ba60 (live)

## Wrong script on live (verified)

Responses **`{"error":"Not found"}`** and **`{"error":"Invalid VIN"}`** = **not** this repo’s Worker (`success` / `ok` keys).  
**525** on real VIN = upstream passthrough / bad URL. Redeploy **this** project and fix secrets.

## 1) Target

| Item | Value |
|------|--------|
| Public URL | `https://steep-term-ba60.josef-zmrhal.workers.dev` |
| `wrangler.toml` `name` | `steep-term-ba60` |
| Entry | `src/index.mjs` |

## 2) Account

```bash
cd cloudflare/vin-worker
npx wrangler whoami
```

Must be the Cloudflare account that owns subdomain **`josef-zmrhal.workers.dev`**.  
If wrong account, set `account_id` in `wrangler.toml` (from dashboard) or switch login.

## 3) Secrets (names only; no keys in repo)

```bash
npx wrangler secret list
```

- `VIN_UPSTREAM_KEY` — required.
- If `VIN_UPSTREAM_URL` exists and points at orange-cloud / broken TLS origin → **`npx wrangler secret delete VIN_UPSTREAM_URL`** so default `api.dataovozidlech.cz` is used.

## 4) Deploy

```bash
# non-interactive CI:
set CLOUDFLARE_API_TOKEN=...   # Windows: set, then deploy
npx wrangler deploy
```

Save deploy output (worker name + URL printed).

## 5) Live curl (must match)

```bash
curl -sS "https://steep-term-ba60.josef-zmrhal.workers.dev/health"
curl -sS "https://steep-term-ba60.josef-zmrhal.workers.dev/vin?vin=123"
curl -sS "https://steep-term-ba60.josef-zmrhal.workers.dev/vin?vin=WBADT43452G123456"
```

PASS: health → `{"ok":true,"worker":"up"}`; invalid VIN → 400 + `success`; real VIN → JSON, **not** 525.

## 6) R2 upload (`POST /upload-image`)

1. Create bucket: `npx wrangler r2 bucket create infouzel-ads-images` (once).
2. Enable public access on bucket (R2 dashboard) or custom domain → set **`R2_PUBLIC_BASE_URL`** (Worker var).
3. Secret: `npx wrangler secret put IMAGE_UPLOAD_SECRET` (Bearer for uploads; never embed in static frontend — use server-side or future short-lived token).
4. Upload: `curl -X POST -H "Authorization: Bearer $IMAGE_UPLOAD_SECRET" -F "file=@photo.jpg" https://…/upload-image`

## STOP-SHIP

If `/health` is not 200 with `ok:true`, or real VIN still 525 → wrong deploy account, wrong worker name, or bad `VIN_UPSTREAM_URL` still set.
