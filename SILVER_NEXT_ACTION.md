<!-- SILVER_NEXT_ACTION: planner-cap-diagnostic-product-handoff; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver — PRODUCT HANDOFF (CAP diagnostic) — NO ENGINE CHANGE unless explicit below

### PRODUCT_HANDOFF_CONTRACT

target_cluster=self_correction_update_task:11
source_audit=Self-Correction
observed_accuracy=99.92
observed_fail_count=11
diagnostic_result=TRUE_ENGINE_FAIL=NO;harness_or_gold_alignment
recommended_scope=scripts-only_harness_gold_alignment
expected_outcome=HARNESS_ALIGNMENT_TASK_READY
engine_change_allowed=NO
assets_app_change_allowed=NO
safety_counters=dangerous_write_count=0;false_write_count=0;query_created_write_count=0;write_when_negated_count=0
metric_delta_required=YES
no_broad_refactor=YES

### Kontext (automaticky)

- **Aktuální main commit:** `530720c09cd3f446d174b584343b534355536689`
- **Zdroj clusteru:** 
- **Audit report:** `silver-self-correction-audit-report.json`
- **Diagnostic report:** `silver-self-correction-safety-diagnostic-report.json`

### Produktový úkol (cluster-specific)

- **selector_cluster:** `self_correction_update_task:11`
- **TRUE_ENGINE_FAIL:** NO
- **Registry expected (informative):** HARNESS_ALIGNMENT_TASK_READY

#### Analýza (povinné)

- Ověř `TRUE_ENGINE_FAIL` vs harness/gold z diagnostic JSON (`true_engine_fail_count`, `harness_problem_count`).
- Drž scope: scripts-only pokud `TRUE_ENGINE_FAIL=NO`.
- Spusť existující harness příkazy níže; nevymýšlej nové cesty.

#### Harness / diagnostika (existující skripty)

1) `node scripts/silver-rhc3-cluster-classifier-v1.cjs`

### Kroky

1) `Set-Location C:\\projects\\filtr`
2) `git status --short` — pouze reporting `SILVER_*.md` dirty je povoleno.
3) `node scripts/silver-autopilot.cjs --status`
4) Zaměř se na cluster **self_correction_update_task:11**: spusť harness příkazy výše; **NE** generic git push / gh auth / verify-pr.
5) **HARNESS_ALIGNMENT_TASK_READY:** uprav pouze skripty/harness/gold v `scripts/`; engine/assets zakázány.
6) `npm run smoke` po smysluplné změně skriptů.

### Povinný výstup

```text
=== SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===
main_commit=530720c09cd3f446d174b584343b534355536689
top_cluster=self_correction_update_task:11
target_cluster=self_correction_update_task:11
source_audit=Self-Correction
diagnostic_result=TRUE_ENGINE_FAIL=NO;harness_or_gold_alignment
recommended_scope=scripts-only_harness_gold_alignment
expected_outcome=HARNESS_ALIGNMENT_TASK_READY
TRUE_ENGINE_FAIL=NO
engine_touched=NO
assets_app_touched=NO
harness_next_command=(vyplň přesný příkaz)
PASS_FAIL=(PASS|FAIL)
=== END_SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===
```

### FINISH

```powershell
[console]::beep(880, 200)
```

=== CAP10_SAFE_AUTONOMOUS_ORCHESTRATOR_HANDOFF ===
target_cluster=self_correction_update_task:11
current_cluster_fail_count=11
dominant_root_cause=harness_or_ambiguous
ready_for_fix=YES
expected_outcome=HARNESS_ALIGNMENT_TASK_READY
diagnostic_commands=node scripts/silver-self-correction-audit.cjs
autonomous_continue=YES
fresh_tier_a_proof=REQUIRED
prior_tier_a_reused=NO
=== END_CAP10_SAFE_AUTONOMOUS_ORCHESTRATOR_HANDOFF ===
