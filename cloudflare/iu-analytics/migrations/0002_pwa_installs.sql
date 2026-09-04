-- Additive: anonymous aggregate PWA install / first standalone-launch counts.
-- No PII, no device ID, no fingerprint columns.
ALTER TABLE daily_traffic ADD COLUMN pwa_installs INTEGER NOT NULL DEFAULT 0;
