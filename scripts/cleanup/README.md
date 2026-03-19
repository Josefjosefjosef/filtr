# Cleanup engine — final forensic readiness lock

## True guard map 1–20

- Guards 11 and 12 are distinct: 11 = redo_block_candidate_level, 12 = checkpoint_consistency_pre_commit.
- Guards 17 and 18: 17 = redo_block_iteration_level, 18 = checkpoint_consistency_post_commit.
- All 20 slots have exact_guard_name, exact_purpose, exact_fail_condition, exact_machine_action_on_fail, code_entrypoint, active.

## Forensic backlog truth

- Old state (safe_now=0) vs new state (safe_now=12): root cause documented in forensic-backlog-explanation.json (different_commit_or_branch or same_commit_different_analyzer).
- Main and target branch proof are separate; each has branch_name, commit_sha, analyzer_version, remaining_safe_now, exact_verdict.

## Start cleanup only when raw data allows

- CONTINUOUS_CLEANUP_START_VERDICT = READY only if engine READY, target safe_now > 0, claim vs evidence PASS, repo clean, chain isolated.
- First real cleanup iteration runs at most once when start is READY; on failure reverts and returns FAIL_REVERTED.
