-- Central offer registry v24 (local/staging). Immutable history — no schema rewrite of events.

CREATE INDEX IF NOT EXISTS idx_central_registry_events_partner_created ON central_registry_events(partner_key, created_at);
