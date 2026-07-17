# Ochrana společných komponent

| Komponenta | Primární soubory | Guard / důkaz |
|------------|------------------|---------------|
| App shell + SW register | `projects/index.html`, `assets/app.js`, `sw.js` | freeze + PWA offline guard |
| Network / offline banner | `assets/iu-network-connectivity-v1.js` | freeze + PWA |
| Article chunk loader | `assets/iu-article-chunk-loader.js` | article-entrypoint-parity |
| Quicktools / custom buttons | CSS + overlay JS | `iu-quicktools-*`, `iu-custom-buttons-*` |
| MindMenu / home premium | `assets/iu-desktop-home-premium.css` | mindmenu / pc-compat guards |
| Tasks overlay | `assets/iu-tasks-premium.css` | tasks mobile/pc guards |
| Local-first backup | `iu-user-data-backup-*.js`, `iu-local-data-protection.js` | user-data-backup + local-data-protection |
| Info panel | info-panel assets + guards | desktop info-panel guards |
| Consent / storage notice | `iu-consent.js`, `iu-storage-notice.js` | local-data-protection |

## NO-GO při agregátor rebuild

- Neměnit localStorage klíče (`iu.notes.store.v1`, `iu.tasks.mvp.v1`, `iu.calendar.store.v1`, …).
- Neměnit durable SW cache názvy bez migračního plánu.
- Nemazat export/import cesty v backup core.
