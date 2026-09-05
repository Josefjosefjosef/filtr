# VOP compliance matrix — audit 2026-09-05

| Oblast | Relevantní | Právní základ | Implementováno | Místo ve VOP | Technický guard |
| --- | --- | --- | --- | --- | --- |
| Identita provozovatele | ANO | OZ / GDPR čl. 13 | ANO (shodné s kontaktem) | II.1 + GDPR §1 | `iu-gdpr-vop-legal-layer-guard` |
| Local-first důsledky | ANO | Informační povinnost / OZ | ANO | II.4 | guard + content truth |
| PWA ≠ záloha | ANO | Informační | ANO | II.4 | — |
| Orientační výstupy (Silver, PDF, kalk.) | ANO | OZ (povaha služby) | ANO | II.5 | — |
| Placené Ads | ANO | OZ, ZOZ, 40/1995 | ANO | II.3 + III | Ads categories table |
| Spotřebitel vs B2B | ANO (Ads primárně B2B) | OZ kogentní | ANO (bez obcházení „jsem firma“) | II.9 | — |
| Odstoupení + vzor | ANO pokud spotřebitel | OZ distanční/digitální | ANO (vzor) | II.10 | guard |
| Reklamace | ANO | ZOZ / OZ | ANO e-mail proces | II.10 | guard |
| ADR ČOI | ANO pokud spotřebitel | ZOZ | ANO coi.cz | II.10 | guard |
| Rozhodné právo CZ | ANO | OZ / Řím I | ANO + ochrana spotřebitele | II.11 | — |
| Změny VOP / versionId | ANO | Smluvní + doložitelnost | ANO `2026-09-05-v1` + terms_version Ads | II.12 | version JSON |
| Absolutní vyloučení odpovědnosti | NE (zakázáno) | kogentní | Explicitně vyloučeno | II.8 | guard forbidden claim |
