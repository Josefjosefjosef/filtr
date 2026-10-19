-- UIDVALIDITY batch verify: CHECK insert aborts when purge incomplete (offline / staging only).

CREATE TABLE IF NOT EXISTS d1_batch_invariant_abort (

  must_be_one INTEGER NOT NULL CHECK (must_be_one = 1)

);

