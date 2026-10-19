# CJ Phase 2 — retention and storage separation (v1)

## Storage classes

1. **archive_evidence** — D1 `affiliate_ad_archive_*` + embedded JSON evidence (iu-ads). Not auto-deleted when offer ends.
2. **published_history** — version rows in `affiliate_ad_archive_versions`.
3. **import_staging** — `%TEMP%/iu-cj-affiliate` JSON and CJ ingest D1 lifecycle (cleanable when not referenced by archive).
4. **cache** — landing batch probes, wrangler local state (ephemeral).
5. **technical_logs** — ingest runs, audit log (existing iu-ads / worker tables).

## Legal hold

`affiliate_ad_archive_records.legal_hold = 1` blocks retention sweeps for that record (implementation flag; statutory periods **require legal review** — not asserted here).

## No new R2 / Queues

Affiliate archive v1 stores evidence inline in D1 JSON. Export generates PDF on demand only.
