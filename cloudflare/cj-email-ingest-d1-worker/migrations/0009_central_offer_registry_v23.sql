-- Central offer registry v23 (local/staging). Non-destructive; supports evidence queries.
-- Does not rewrite identity_key or historical offers.

CREATE INDEX IF NOT EXISTS idx_central_registry_events_kind ON central_registry_events(kind, created_at);
