# Security & threat model — InfoUzel Ads

## Právní / privacy režim (kap. 33)

```
PERSONALIZED_ADS=NO
RETARGETING=NO
PROFILING=NO
AD_TRACKING_COOKIES=NO
CONTEXTUAL_ADS_ONLY=YES
```

Kontextové cílení pouze: aktuální sekce, zvolený region, obecná kategorie zařízení, období, typ obsahu.

Měření: konzervativní režim Analytics + Consent Guard, dokud není samostatné právní potvrzení jinak.

## Threat actors

| Actor | Cíl | Mitigace |
|-------|-----|----------|
| Anonymní útočník | Brute-force klientských kódů / admin hesel | Rate limit, uniform errors, lockout |
| Cizí klient | Cizí kampaně / dokumenty | Hash kódů, server visibility, izolace session |
| Interní uživatel mimo roli | Eskalace | Server RBAC, audit |
| Compromised ADMIN_TOKEN (legacy analytics) | Analytics admin leak | Oddělené secrets; ads admin ≠ analytics token |
| Supply chain / malicious creative | XSS, malware | MIME/content checks, zákaz JS HTML, R2 private |
| SSRF / dangerous URL | javascript:, data: | URL allowlist validace + audit změn |

## Secrets (nikdy v gitu / logu / URL / JS)

| Secret | Účel | Etapa |
|--------|------|-------|
| `ADS_SESSION_SECRET` | Podpis admin session cookie | 2 |
| `ADS_CLIENT_SESSION_SECRET` | Podpis client RO session | 7 |
| `ADS_PASSWORD_PEPPER` | Pepper k heslovým hashům | 2 |
| `ADS_R2_SIGNING_SECRET` | Krátkodobé signed URLs dokumentů | 1/3 |
| `ADS_BACKUP_ENCRYPTION_KEY` | Šifrování záloh | 9 |
| Deploy tokens | CI | 1 |

Legacy `ADMIN_TOKEN` Analytics zůstává **pouze** pro Analytics admin/report — neplatí na Ads Admin API.

## Audit rules

Ukládat: actor, time, op, object type/id, before/after (safe), result.  
Nikdy: password, plaintext client code, full token, keys, sensitive headers.

## Cross-API token rejection (povinný test)

- Client code / client session → Admin API = 401/403
- Admin session → Client Report jako client = 401/403
- Public Delivery nesmí vracet ceny, kontakty, dokumenty, kódy

Evidence: `test/client-portal.test.ts` (E7-T7).

## Kap. 14 — go-live / security checklist (docs + automated guards)

**Status:** checklist **PASS** for Worker/automated evidence. **Production ads remain OFF** until an explicit human operator flips flags out-of-band (not part of Etapa 9 merge).

| # | Control | Evidence | Result |
|---|---------|----------|--------|
| 1 | Admin auth: PBKDF2+pepper, session HMAC, lockout | `test/auth-crypto.test.ts`, `test/session.test.ts`, `test/bruteforce.test.ts` | PASS |
| 2 | RBAC server-side | `test/rbac.test.ts` | PASS |
| 3 | Audit redaction (no password/token/code) | `test/audit.test.ts`, client portal audit | PASS |
| 4 | URL safety (`javascript:`/`data:` reject) | `test/url-safety.test.ts` | PASS |
| 5 | Creative/document MIME / no JS HTML | `test/creatives.test.ts`, `test/documents.test.ts`, `test/r2-security.test.ts` | PASS |
| 6 | Cross-token reject (admin ≠ client ≠ analytics) | `test/client-portal.test.ts` E7-T7 | PASS |
| 7 | Privacy flags contextual-only | `0001` seed + `test/backup-security.test.ts` + `/health` fields | PASS |
| 8 | Emergency pause fail-closed | `test/delivery-engine.test.ts`, `test/public-delivery-route.test.ts` | PASS |
| 9 | Rights confirmation before `active` | `test/campaigns.test.ts`, `test/scheduler.test.ts` | PASS |
| 10 | Auto start/end scheduler | `test/scheduler.test.ts` | PASS |
| 11 | Test campaign exclusion from stats | `test/admin-stats.test.ts` E6-T6 | PASS |
| 12 | Public delivery allowlist / no forbidden keys | `test/isolation.test.ts`, `test/delivery-engine.test.ts` | PASS |
| 13 | Backup redaction + restore drill | `test/backup-security.test.ts`, `test/backup-security-admin.test.ts` | PASS |
| 14 | Committed defaults fail-closed (safeMode ON, delivery/admin/client OFF) | `wrangler.toml` + feature-flag tests | PASS |

### Explicitly NOT done by this checklist

- Flipping `ADS_SAFE_MODE=false` or `ADS_PUBLIC_DELIVERY_ENABLED=true` in production
- Enabling Admin/Client API in committed defaults
- Public-site frontend inject (E5 gap)
- Client portal HTML UI (E7 gap)
- Full InfoUzel public-site admin UI (E8 gap)
- Declaring “production ads ON”
