-- Central offer registry v25 — event detail fingerprint for collision safety (append-only).

ALTER TABLE central_registry_events ADD COLUMN detail_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_central_registry_events_detail_fp ON central_registry_events(event_id, detail_fingerprint);
