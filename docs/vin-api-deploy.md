# VIN decode API (`/projects/api/vin-decode`)

## Chování

- `GET /projects/api/vin-decode?vin=XXXXXXXXXXXXXXX`
- JSON: `{ success, vin, data, error, cached, source }`
- Validace VIN (17 znaků, bez I/O/Q), rate limit ~27/min/IP (konfigurovatelné), cache per VIN (TTL default 24 h).
- Upstream výchozí: **NHTSA VPIC** (`decodevinvalues`) — bez API klíče.
- Volitelně: `VIN_UPSTREAM_URL` (šablona `{vin}`) + `VIN_UPSTREAM_KEY` (Bearer) — pouze v prostředí serveru, nikdy ve frontendu.

## Spuštění (Node)

```bash
node server/vin-decode-http.mjs
```

`PORT` default 8787. Za nginx / Cloudflare směřujte prefix `/projects/api/vin-decode` na tento proces.

## Produkce (infouzel.cz)

GitHub Pages obsluhuje jen statiku. Endpoint musí běžet jako samostatná služba nebo Worker na stejné doméně (reverse proxy).
