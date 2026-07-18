# Migrace a rollback

## Migrace

1. Nasadit `projects/data/info_events/*` + UI assets.
2. Cutover default ON (`html.iu-info-system-cutover`).
3. Stará article pipeline může běžet (Data Bot) — UI Přehledu dne ji nečte.
4. Po stabilizaci zastavit zobrazování komerčních HomeCards (už skryto cutoverem).

## Rollback

- Okamžitý: `?iuInfoSystem=off`
- Git: revert merge / checkout `pre-aggregator-stable-20260717` (`5647bb3f…`)
- Pre-stabilization emergency: `1e47ac46…`

Auditní historie articles/source_registry zůstává.
