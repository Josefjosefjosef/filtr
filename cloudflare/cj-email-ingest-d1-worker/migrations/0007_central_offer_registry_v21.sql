-- Central offer registry v21 — optimistic concurrency revision (local/staging).

ALTER TABLE central_offers ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
