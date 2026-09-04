# Third-party matrix — InfoUzel — audit 2026-09-05

| Poskytovatel | Funkce | Data | Role | Lokalita | Transfer mechanism | Retence | Právní dokument |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub Pages | Hosting statického webu | Request metadata (IP/UA…) | Zpracovatel / infrastruktura | Global / US možné | Podmínky GitHub / SCC dle poskytovatele | Dle GitHub | GDPR §12–13; `/gdpr-a-vop/` |
| Cloudflare | Workers, D1, R2, edge | Request metadata; Ads/Analytics DB | Zpracovatel | Edge + D1 region config | Podmínky Cloudflare | Dle služby + provozní politika agregátů | GDPR §12 |
| Open-Meteo | Počasí API | Lat/lon nebo město | Samostatný správce/API | Dle Open-Meteo | Jejich podmínky | U IU bez historie | GDPR §8 |
| YouTube / Google | Embed / přehrání | Dle Google při přehrání | Samostatný správce | Global | Google mechanismy | Dle Google | GDPR §13; Cookies sekce |
| Dopravci zásilek | Tracking po kliknutí | Uživatel opouští IU | Externí služba | Dle dopravce | N/A (redirect) | Dle dopravce | VOP II.6 |
| ČHMÚ / NDIC (veřejná data) | Snapshoty | Veřejná data | Zdroj dat | CZ | Same-origin mirror | Snapshot | Zdroje a licence |

**Není third-party analytics cookie vendor** (GA/FB pixel atd.) v produkčním modelu.
