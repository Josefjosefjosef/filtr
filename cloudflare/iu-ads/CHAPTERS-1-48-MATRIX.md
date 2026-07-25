# InfoUzel Ads — matice kapitol 1–48 (stav po closeout PR)

Legenda: **DONE** = implementováno + otestováno unit/integračně; **PROD** = ověřeno na produkci v tomto úkolu; **GATE** = čeká na lidský release; **PARTIAL** = jádro hotové, zbývá rozšíření.

| Kap. | Téma | Stav | Důkaz / poznámka |
|------|------|------|------------------|
| 1 | Oddělený Ads Worker | DONE | `cloudflare/iu-ads`, health `infouzel-ads` |
| 2 | SAFE_MODE / public OFF | DONE+PROD | health: safeMode=true, publicDeliveryEnabled=false |
| 3 | D1 schema + migrations | DONE | schema 0010 |
| 4 | R2 creatives/docs/backups | DONE+PROD | health r2.ready |
| 5 | Admin auth sessions | DONE+PROD | login main_admin ověřen uživatelem |
| 6 | Role / RBAC | DONE | `rbac.ts` + server guards |
| 7 | Audit log | DONE | UI české popisky; citlivé hodnoty ne |
| 8 | Bootstrap main_admin | DONE+PROD | dokončen uživatelem; neopakovat |
| 9 | Klienti CRUD | DONE | API + Admin UI |
| 10 | Poptávky | DONE | API + Admin UI |
| 11 | Objednávky | DONE | API + Admin UI |
| 12 | Smlouvy | DONE | API + Admin UI |
| 13 | Faktury | DONE | API + Admin UI (částky v Kč ve Finance) |
| 14 | **Veřejné doručování reklam** | **GATE** | Lidský release gate — **nezapnuto** |
| 15 | Kampaně | DONE | full create form |
| 16 | Umístění / typy | DONE | seed + `name_cs` v UI |
| 17 | Rezervace / kolize | DONE | `collision.ts` + UI |
| 18 | Kalendář | DONE | uživatelský přehled 30 dní, bez raw JSON |
| 19 | Kreativy | DONE | upload/review API + UI |
| 20 | Statistikistiky (Ads↔Analytics) | DONE | soft empty state; URL+token wiring v Deploy |
| 21 | Klientské kódy | DONE | hash-only, once-show |
| 22 | Client portal | DONE | login vždy viditelný; boot try/catch |
| 23 | Client report / izolace | DONE | scope filters |
| 24 | Dokumenty + signed access | DONE | `signed-access-e2e` tests |
| 25 | Finance | DONE | Kč widgety + filtry |
| 26 | Exporty CSV/JSON | DONE | CSV injection escape |
| 27 | Zálohy | DONE | encrypt when key set; drill endpoint |
| 28 | Restore drill (izolovaný) | PARTIAL | drill API existuje; plný izolovaný D1 restore v CI je provozní runbook |
| 29 | Alerts | DONE | generate/ack/resolve |
| 30 | Dashboard | DONE | čitelné karty CZ |
| 31 | Search | PARTIAL | endpoint + UI; stále techničtější výstup |
| 32 | Users admin | DONE | create + roles guards |
| 33 | Password reset / change | DONE+PROD | aktivace + login ověřeny |
| 34 | Anti-bruteforce | DONE | tests |
| 35 | Public inject fail-soft | DONE+PROD | adNodes=0 when OFF |
| 36 | Privacy (no IP/UA/fp) | DONE+PROD | health claims |
| 37 | Analytics Worker odděleně | DONE+PROD | `infouzel-analytics` health |
| 38 | Veřejné Statistiky page | DONE | odkaz na Bearer admin odstraněn |
| 39 | Info centrum Ads karta | DONE | dlaždice → `/client` |
| 40 | Admin SPA UX | DONE | CZ labels, empty states, mobile nav |
| 41 | Client SPA UX | DONE | iPhone blank fix |
| 42 | Test campaign exclusion | DONE | stats/export filters |
| 43 | CSRF / cookies | DONE | Secure HttpOnly SameSite |
| 44 | Rate limits | DONE | auth + codes |
| 45 | CI / Deploy workflows | DONE | Deploy IU Ads + guards |
| 46 | Docs / secrets contract | DONE | `secrets.contract.md` |
| 47 | E2E Admin/Client prod | PARTIAL | Admin login prod ověřen uživatelem; Client E2E vyžaduje test kód (manuální) |
| 48 | Kap. matice / closeout | DONE | tento dokument |

**Jediný zbývající lidský release gate:** kapitola 14 — veřejné produkční doručování reklam.
