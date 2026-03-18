# VIN API — `/projects/api/vin-decode`

## Produkční ENV (nikdy v repu)

| Proměnná | Význam |
|----------|--------|
| `VIN_UPSTREAM_KEY` | Klíč pro api.dataovozidlech.cz (povinný pro CZ data) |
| `VIN_UPSTREAM_URL` | Volitelně; výchozí `https://api.dataovozidlech.cz/api/vehicletechnicaldata/v2/{vin}` |
| `VIN_UPSTREAM_AUTH_STYLE` | `bearer` (výchozí), `x-api-key`, `apikey-query` |
| `VIN_UPSTREAM_MAX_PER_MIN` | Globální strop volání upstreamu / min (výchozí 27) |
| `VIN_IP_RATE_MAX` | Limit požadavků / min / IP (výchozí 60) |
| `VIN_CACHE_TTL_MS` | Cache úspěšné odpovědi (výchozí 24 h) |
| `PORT` | Port Node procesu (např. 8787) |
| `VIN_USE_NHTSA_FALLBACK=1` | Pouze dev/test bez CZ klíče — **nepoužívat v produkci** |

## Ochrana limitu 27/min

- Neplatný VIN → 400 JSON, **žádný** upstream.
- Globální fronta + posuvné okno max 27 upstream volání / minutu (jeden klíč).
- Stejný VIN: cache + in-flight deduplikace (jedno paralelní volání).
- Přetížení → 503 JSON nebo fronta s timeoutem.
- Text „maximální počet požadavků“ od upstreamu → 429 JSON.

## Spuštění

```bash
node server/vin-decode-http.mjs
```

## systemd (příklad)

`/etc/systemd/system/infouzel-vin.service`:

```ini
[Unit]
Description=infoUzel VIN decode API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/filtr
Environment=VIN_UPSTREAM_KEY=*** 
Environment=PORT=8787
ExecStart=/usr/bin/node server/vin-decode-http.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## nginx (příklad)

```nginx
location /projects/api/vin-decode {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Statika `/projects/` zůstává na GitHub Pages nebo jiném rootu.

## Cloudflare Worker (`cloudflare/vin-worker`)

Worker volá **přímo** `https://api.dataovozidlech.cz/api/vehicletechnicaldata/v2/{vin}` (Bearer z secretu).  
Nepoužívejte jako `VIN_UPSTREAM_URL` doménu za Cloudflare orange-cloud s neplatným certifikátem na originu — prohlížeč nebo `return fetch(váš_proxy)` může končit **525 SSL handshake failed**.

| Route | Chování |
|-------|---------|
| `GET /health` | `{ "ok": true, "worker": "up" }` — bez upstreamu |
| `GET /vin?vin=` | Stejný JSON model jako Node API; neplatný VIN → 400; chybí secret → 500; síť/TLS upstream → `upstream_fetch_failed`; HTTP upstream → `upstream_http_error` |

```bash
cd cloudflare/vin-worker
npx wrangler secret put VIN_UPSTREAM_KEY
# Volitelně smažte/nea nastavujte VIN_UPSTREAM_URL = použije se výchozí dataovozidlech API
npx wrangler deploy
```
