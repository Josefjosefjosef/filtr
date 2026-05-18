# silver-cursor-agent-adapter
autonomous_run_id=de105f7f334b4445bf2ffc9abaab26fa
autonomous_run_start_utc=2026-05-18T03:31:13.7456429Z
autonomous_cycle=1
adapter_output_state=INVALIDATED_AWAITING_CYCLE
process_start_utc=
task_digest=
exit_code=
elapsed_ms=

# stdout

## Cursor audit snapshot (infoUzel.cz / Silver)

- **Větev**: `chore/silver-audit-repo-state` (založena z `main` pro auditní commit).
- **Změny oproti `HEAD` před commitem**: pouze `SILVER_CURSOR_OUTPUT.md` a `SILVER_RUN_REPORT.md`; `SILVER_NEXT_ACTION.md` a `SILVER_PROGRESS_LOG.md` beze změny.
- **`git diff --stat` na čtyřech whitelist souborech**: diff jen ve dvou souborech (viz výše), celkem řádově +8 / −18 řádků v tomto diffu.
- **`MaxCycles` v `SILVER*.md`**: v kořeni repa výskyty v `SILVER_NEXT_ACTION.md` (návod vč. řádku s příkazem `grep`), `SILVER_AUTOPILOT_README.md`, `SILVER_PR_ORCHESTRATOR_README.md`; další řádky pod `.silver-runtime/` (timeout archivy).
- **`SILVER_RUN_REPORT.md`**: `status=PASS`, `safety_counters=dangerous_write_count=0;false_write_count=0;query_created_write_count=0;write_when_negated_count=0`, `commit=53132070b9fdc2c8489287684ea38090801ba8b3` (aktuální `HEAD` v době auditu).
- **`git show --name-only -1`**: uvádí také `scripts/silver-autopilot-loop.ps1`; ověření `PASS` a číselných counterů je vždy přímo v `SILVER_RUN_REPORT.md`.

# stderr
