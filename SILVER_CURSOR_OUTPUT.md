# silver-cursor-agent-adapter
autonomous_run_id=d440f52cb36a4e2a9116fa7440d334c1
autonomous_run_start_utc=2026-05-18T00:40:12.1791898Z
autonomous_cycle=49
adapter_output_state=INVALIDATED_AWAITING_CYCLE
process_start_utc=
task_digest=
exit_code=
elapsed_ms=

# stdout

## Cursor audit snapshot (infoUzel.cz / Silver)

- **Větev**: `chore/silver-audit-cycle-7`
- **Git stav před závěrem auditu**: necommitované lokální změny ve čtyřech souborech `SILVER_CURSOR_OUTPUT.md`, `SILVER_NEXT_ACTION.md`, `SILVER_RUN_REPORT.md`, `SILVER_PROGRESS_LOG.md` (staging/commit probíhá v kroků 5–6).
- **Diff stat na čtyřech souborech (proti `HEAD`)**: doplněný audit checklist v `SILVER_NEXT_ACTION.md`, rozšířený blok cyklu 48 v `SILVER_PROGRESS_LOG.md`, úpravy metadat autopilota v tomto výstupu a v `SILVER_RUN_REPORT.md`, celkově řádově ~55 řádků (`git diff --stat` na zmíněných cestách).
- **`MaxCycles` v `SILVER*.md`**: v kořeni repozitáře se `MaxCycles` objevuje mimo jiné v `SILVER_NEXT_ACTION.md` (text úlohy vč. příkazu `grep`) a v dokumentaci `SILVER_AUTOPILOT_README.md` / `SILVER_PR_ORCHESTRATOR_README.md`; pro úplný `grep -rn … .` mohou vizitovat i kopie pod `.silver-runtime/`.
- **Run report**: v `SILVER_RUN_REPORT.md` je `status=PASS` a všechny položky v `safety_counters` mají hodnoty `*_count=0` (stav z posledního `--status`/zápisu).
- **Pozor na `git show --name-only -1`**: ukáže jen seznam souborů v **posledním** commitu; čísla `safety_counters` a `status=PASS` je potřeba číst přímo v `SILVER_RUN_REPORT.md`.

# stderr
