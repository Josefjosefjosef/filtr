-- Per-record monotonic version sequence (atomic increment before version INSERT).

ALTER TABLE affiliate_ad_archive_records ADD COLUMN version_seq INTEGER NOT NULL DEFAULT 1;

UPDATE affiliate_ad_archive_records
SET version_seq = COALESCE(
  (
    SELECT MAX(v.version_no)
    FROM affiliate_ad_archive_versions v
    WHERE v.record_id = affiliate_ad_archive_records.record_id
  ),
  1
);
