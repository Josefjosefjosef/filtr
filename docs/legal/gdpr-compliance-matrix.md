# GDPR compliance matrix (InfoUzel) — audit 2026-09-05

Interní auditní tabulka. Nejde o právní certifikát. Text veřejného dokumentu: `/gdpr-a-vop/` · iCentrum sekce `gdpr-vop`.

| Proces | Data | Účel | Právní základ | Příjemce | Retence | Transfer | Consent | UI | GDPR sekce |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Provoz webu (GitHub Pages + CF edge) | IP/UA/URL na úrovni infrastruktury | Dostupnost, bezpečnost | 6(1)(f) | GitHub, Cloudflare | Dle poskytovatele | Možné mimo EHP (poskytovatel) | N/A (nezbytné) | — | §6, §13 |
| InfoUzel Analytics | Event type, device category, vol. section/ad id; **ne** IP/plný UA | Agregované statistiky | 6(1)(a) | CF Worker + D1 | Denní agregáty bez auto-delete | CF (EU/edge) | localStorage consent | Nastavení soukromí / Statistiky | §9 |
| Počasí Open-Meteo | Souřadnice / město | Předpověď | 6(1)(a)/(b) kontext | api.open-meteo.com | U IU bez historie | Dle Open-Meteo | Browser geo permission | Moje město / poloha | §8 |
| ČHMÚ / NDIC snapshoty | Veřejná data | Přehled dne | Není OU uživatele | Same-origin | Snapshot TTL | — | — | Info panel | §5 |
| Ads public delivery | Device/section kontext | Zobrazení reklamy | 6(1)(f)/(b) vůči inzerentovi | ads.infouzel.cz | Bez visitor ad-ID | CF | Bez personalizace | Reklamní plochy | §11 |
| Ads klientský portál | Firma, kontakt, kampaně, hash kódu, relace | Smlouva, fakturace, účet | 6(1)(b)(c)(f) | CF D1/R2 iu-ads | Smlouva + zákonné účetní lhůty | CF | Účetní vztah | ads.infouzel.cz/client | §11 |
| E-mail komunikace | E-mail, obsah | Podpora / GDPR / Ads | 6(1)(f)/(b)/(c) | Mail systém provozovatele | Vyřízení + oprávněná archivace | Dle mail hostitele | — | Kontakt | §2, §15 |
| Local-first (notes/tasks/cal/vault/…) | Obsah uživatele | Osobní nástroje | Zpracování u správce standardně nevzniká | Zařízení | Do smazání uživatelem | Ne (standard) | — | Silver / MindMenu | §4, §7, §14 |

**DPO:** Nejmenován (čl. 37 — povinnost auditem nevznikla).  
**DPIA:** Ke dni účinnosti nevzniká jen z local-first Silvera / kontextové reklamy.  
**Čl. 22:** Neprovádí se.
