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
