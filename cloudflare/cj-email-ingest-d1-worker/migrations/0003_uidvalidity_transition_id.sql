-- Bind completed_uids purge to a specific successful UIDVALIDITY transition (offline / staging only).
ALTER TABLE sync_checkpoint ADD COLUMN uidvalidity_transition_id TEXT;
