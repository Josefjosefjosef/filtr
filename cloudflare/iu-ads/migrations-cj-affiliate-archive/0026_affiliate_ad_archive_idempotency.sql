-- Idempotency + version metadata for CJ affiliate ad archive (0025 extension).

ALTER TABLE affiliate_ad_archive_records ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_ad_archive_idempotency
  ON affiliate_ad_archive_records(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE affiliate_ad_archive_versions ADD COLUMN publish_event_type TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE affiliate_ad_archive_versions ADD COLUMN change_fields_json TEXT NOT NULL DEFAULT '[]';
