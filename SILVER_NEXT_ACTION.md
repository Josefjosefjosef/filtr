<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

1. Verify the output of the last Cursor execution by checking the contents of `SILVER_CURSOR_OUTPUT.md` for any anomalies or errors.
   - Command: `cat C:\projects\filtr\SILVER_CURSOR_OUTPUT.md`

2. Run the diagnostic script to assess the current state of the Silver engine and identify any potential issues.
   - Command: `node scripts/silver-diagnostic.js`

3. Review the results of the diagnostic script for any indications of engine failure or misalignment.
   - Command: `cat C:\projects\filtr\SILVER_RUN_REPORT.md`

4. If the diagnostic indicates a `TRUE_ENGINE_FAIL`, document the findings and prepare for a focused fix. If no issues are found, proceed to the next step.

5. If applicable, run the smoke test for MaxCycles 1 again to confirm the previous results.
   - Command: `node scripts/silver-smoke-test-maxcycles-1.js` 

6. Document the results of the smoke test and ensure all outputs are captured in the appropriate report files.
