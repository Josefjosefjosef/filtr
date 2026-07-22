# InfoUzel Ads System — Architecture (Etapa 0)

## Princip

Profesionální reklamní, obchodní, evidenční, dokumentační a reportovací platforma navázaná na **existující** InfoUzel Analytics. Analytics zůstává anonymní aggregate-only zdrojem pravdy pro metriky. Obchodní a osobní údaje žijí výhradně v oddělené vrstvě `iu-ads`.

## Vrstvy (povinné oddělení)

```
┌─────────────────────────────────────────────────────────────┐
│ Veřejný web (GitHub Pages / infouzel.cz)                    │
│  - dynamický engine: komponenta jen při aktivní kampani     │
│  - žádné prázdné boxy                                        │
└───────────────┬─────────────────────────────┬───────────────┘
                │ Public Ad Delivery API      │ Analytics ingest
                ▼                             ▼
┌──────────────────────────┐    ┌─────────────────────────────┐
│ Worker: infouzel-ads     │    │ Worker: infouzel-analytics  │
│ D1: iu-ads (business)    │    │ D1: iu-analytics (anonymous)│
│ R2: creatives + docs     │    │ (NEPŘEPISOVAT)              │
└──────────┬───────────────┘    └─────────────────────────────┘
           │
     ┌─────┴──────┬────────────────┐
     ▼            ▼                ▼
 Admin API   Client Report API   Audit / Backup
 (sessions)  (code→RO session)   (no secrets)
```

## Vazba na Analytics

Jediný bezpečný spoj: řetězcové ID `campaign_id`, `placement_id`, `section_id`, `slot_type`, `device_category`, `day`.

- Obchodní tabulky v `iu-ads` vlastní kanonická ID.
- Analytics `daily_ads` agreguje pouze allowlistovaná pole.
- Žádné klientské kódy, ceny, kontakty, dokumenty do Analytics D1.
- Test kampaně `test_*` zůstávají vyloučené z obchodních reportů (stávající ads-policy).

## Feature flags (fail-closed)

| Flag | Default | Význam |
|------|---------|--------|
| `ADS_PUBLIC_DELIVERY_ENABLED` | `false` | Veřejné doručení reklam |
| `ADS_ADMIN_API_ENABLED` | `false` do Etapy 2+ | Admin mutace |
| `ADS_CLIENT_API_ENABLED` | `false` do Etapy 7 | Client Report |
| `ADS_SAFE_MODE` | `true` | Blokuje produkční aktivaci bez checklistu |

Dokud není autentizace, role, audit, schvalování kreativ/URL/kolizí ověřeno, veřejná reklama zůstává vypnutá.

## Admin UI

Cíl: `https://admin.infouzel.cz` (vyžaduje DNS + Pages/Worker routing — manuální krok).  
Dočasně bezpečný neindexovaný origin pod stávající infrastrukturou je přípustný **pouze** se stejnými auth/role/audit požadavky; nesmí spoléhat na utajení URL.

## Public engine (kap. 9)

Aktivní kampaň → období → zařízení → sekce → region → umístění → kolize → kreativa → komponenta → anonymní měření.

Při nesplnění podmínky: **nic nevložit**.

## Odchylky od preferované varianty

Zaznamenány v `00-baseline-audit.md` (samostatná D1, GitHub Pages realita). Všechny požadované vlastnosti zachovány nebo posíleny.
