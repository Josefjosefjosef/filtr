# Data isolation — InfoUzel Ads

## Databáze

| Store | Binding | Obsah | Zakázáno |
|-------|---------|-------|----------|
| D1 `iu-analytics` | Analytics Worker `DB` | Anonymní agregáty | PII, ceny, smlouvy, kódy, dokumenty |
| D1 `iu-ads` | Ads Worker `DB` | Obchod, auth, dokumenty meta, kampaně | Nesmí sloužit jako veřejný Analytics mirror |
| R2 `iu-ads-creatives` | `CREATIVES` | Schválené veřejné kreativy | Soukromé smlouvy/faktury |
| R2 `iu-ads-documents` | `DOCUMENTS` | Soukromé dokumenty | Veřejné trvalé URL |
| HTTP Cache | — | Krátké cache Public Delivery / public stats | Source of truth |

## Field visibility (kap. 39)

Každé relevantní pole: `internal_only` | `client_visible` | `public`.

Výchozí citlivá obchodní data = `internal_only`.  
Vynucení **pouze serverovým API** (ne frontend).

## Izolační invarianty (testované v Etapě 0)

1. `iu-ads` migrace nevytváří tabulky analytických agregátů (`daily_*`).
2. Analytics schema se v reklamním PR nemění (Etapa 0) — pozdější Etapa 6 max. allowlist rozšíření bez PII.
3. Public Ad Delivery response allowlist neobsahuje `price`, `email`, `phone`, `client_code`, `internal_note`.
4. Client Report response stripuje `internal_*` pole.
5. Žádný plaintext password / client code sloupec — pouze hash + metadata.

## Rozhodnutí: samostatná D1

Zvoleno kvůli: least privilege, blast radius, nezávislé migrace/zálohy, Cloudflare limity, dlouhodobá údržba. Společná D1 by vyžadovala složitější row-level izolaci a vyšší riziko kontaminace.
