-- Central offer registry v29 — dedicated CAS batch abort (local only).



CREATE TABLE IF NOT EXISTS d1_claim_cas_invariant_abort (

  must_be_one INTEGER NOT NULL CHECK (must_be_one = 1)

);


