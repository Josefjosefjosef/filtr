# NIS2 Scope Review — InfoUzel (orientační, ne právní stanovisko)

## Verdict: **LIKELY_OUT_OF_SCOPE**

*(s doporučením NEEDS_LEGAL_REVIEW při změně rozsahu služby)*

## Context

| Factor | Assessment |
|--------|------------|
| Provozovatel | Media Uzel s.r.o. (CZ SME) |
| Typ služby | Veřejný informační portál + client-side osobní nástroje (PWA) |
| Registrace / účty | Ne — data primárně v prohlížeči |
| Kritická infrastruktura | Ne — neposkytuje energie, dopravu, zdravotnictví, bankovnictví |
| Citlivá data ve velkém rozsahu | Ne — žádná centrální DB osobních údajů uživatelů |
| Dostupnost jako „kritická služba“ | Nízká — orientační obsah, offline-capable PWA |

## NIS2 Relevant Areas (prakticky)

1. **Kybernetická bezpečnost webu** — CSP, headers, secret hygiene (Phase 1 addressed).
2. **Supply chain** — GitHub Actions, npm deps (existing guards).
3. **Incident response** — **NEEDS REVIEW** — formal IR plan not in repo.

## Triggers That Would Change Assessment

- Central user accounts with server-side storage of notes/calendar.
- API služby s vysokou dostupností (VIN worker production scale-up).
- Zpracování zvláštních kategorií údajů (health, biometrics) on-server.
- Poskytovatel „managed service“ pro třetí strany (B2B SaaS).

## Recommendation

1. **LIKELY_OUT_OF_SCOPE** for typical NIS2 essential/important entity lists — web is public info + local tools.
2. Consult legal counsel if Media Uzel expands into regulated sectors or exceeds SME NIS2 thresholds under CZ transposition.
3. Maintain security baseline (Phase 1) and document operator contact + privacy transparency.

## Disclaimer

Tento dokument není právní radou. Finální NIS2 klasifikace vyžaduje právní posouzení velikosti podniku, sektoru a provozovaných služeb.
