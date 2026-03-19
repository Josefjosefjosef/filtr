# Safe-now purge and first true pass semantics

## False-safe purge

- A candidate is **safe_now** only when it has passed guard chain, hard proof, no revert, and produced a valid isolated cleanup commit.
- Candidates that fail in a real cleanup iteration must be **reclassified** (downgrade to risk_now or forensic_only); they must not remain in safe_now without new evidence.
- **Purge**: After forensic review of the first N safe_now candidates, any with `prior_real_iteration_result: FAIL_REVERTED` are downgraded; remaining_safe_now is recalculated. If remaining_safe_now becomes 0, CONTINUOUS_CLEANUP_START_VERDICT is set to NOT READY TO CONTINUE CLEANUP LOOP and no further real iteration may run (THIRD_REAL_CLEANUP_ITERATION_VERDICT: NOT_RUN).

## First true pass

- The first real PASS iteration is only run when raw data allows: at least one proven safe candidate after purge, full candidate packet, single candidate single commit. On pass: commit and stop; on fail: revert and stop.
