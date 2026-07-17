# Rollback postup (ověřený kontrakt)

## Pre-stabilization anchor

```
git checkout 1e47ac46d93147035730314716641f71b330fffd
```

Toto je **poslední známý dobrý produkční stav před stabilizačním PR** (PWA v4).

## Post-stabilization

Po merge stabilizačního PR a tagu `pre-aggregator-stable-YYYYMMDD`:

1. **Preferovaný rollback:** revert merge commit stabilizačního PR (zachová historii).
2. **Emergency Pages:** redeploy / force workflow na předchozí SHA (Pages path-based `app.<sha8>.js`).
3. **SW:** uživatelé mohou potřebovat hard reload; durable feed/img cache zůstává — neočekávat ztrátu last-good feed.
4. **Local-first data:** rollback aplikace **nesmí** mazat localStorage/IDB; export/import zůstává.

## Data Bot

Pokud byl Data Bot dočasně zastaven při merge/deploy:
- zaznamenat `STOPPED_AT` / `RESUMED_AT`
- ověřit běh `update-articles` / `update-articles-fast-pool`

## Checklist rollback drill (dokumentační)

- [ ] Známý pre SHA `1e47ac46…`
- [ ] Známý post SHA (po merge)
- [ ] Tag na ověřeném post SHA
- [ ] Pages run ID před/po
- [ ] `app.<sha8>.js` na produkci odpovídá očekávání
