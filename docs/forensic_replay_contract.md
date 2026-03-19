# Forensic replay contract and crash-safe journal

## Rule

No future PASS verdict may exist without persisted raw evidence. If any required evidence file is missing or incomplete, the verdict must be downgraded to NOT_PROVEN.

## Required evidence (per iteration)

- iteration_forensic_record → `final_forensic_record.json`
- candidate_packet → `candidate_packet.json`
- guard_chain_results → `guard_chain.json`
- hard_proof_raw → `hard_proof_raw.json`
- closure_record → `closure.json`
- redo_block_record → `redo_block.json`
- checkpoint_journal_entry → `checkpoint.json`

All under `%TEMP%\filtr_readiness\reports\cleanup-engine\session-<id>\iteration-NNN\`.

## Write order (atomic)

1. Session manifest open
2. candidate_packet write
3. pre_check write
4. diff_isolation write
5. proof_scope write
6. guard_chain write
7. hard_proof_raw write
8. metric_delta write
9. closure write
10. redo_block write
11. checkpoint write
12. final_forensic_record write
13. journal append committed

Each step: write to .tmp, fsync, rename to final (or unlink final then rename on Windows). Append to `journal.ndjson` after iteration committed.

## Crash / resume

Scan journal for last committed iteration. If checkpoint.json exists for iteration N, iteration N is committed. Otherwise treat iteration incomplete; do not overwrite existing final_forensic_record.

## Claim-vs-evidence

PASS allowed only if all required files exist and required fields are present. Validator: `evidence_validator.validate_evidence_for_iteration(session_id, iteration_number)`. If incomplete, `pass_gate_formula` returns False and verdict must be NOT_PROVEN.
