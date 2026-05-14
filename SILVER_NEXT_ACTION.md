<!-- SILVER_NEXT_ACTION: maintained by Silver Autopilot --ask-model or by hand; never auto-applied -->

# Next action

1. Merge or review PR `fix/silver-note-write-warranty-object-diagnostic` (scripts-only diagnostic + report JSON).
2. `node scripts/silver-autopilot.cjs --status`
3. For `note_write_warranty_object||intent_fail`: prefer **harness / gold relaxation** (accept safe clarification vs strict `note.create` gold for the canonical “Ulož poznámku: …” warranty family) before any engine routing work — `ready_for_engine_fix=NO` from `node scripts/silver-note-write-warranty-object-diagnostic.cjs`.
4. Re-run full mobile audit when ready: `node scripts/audit_silver_realistic_mobile_corpus.cjs` (restores live `scripts/silver-realistic-mobile-corpus-report.json` metrics).

## Template (generic)

1. Ensure a clean git tree for merge-sensitive commands (`git status`).
2. Run `node scripts/silver-autopilot.cjs --status`.
3. For an open PR: `node scripts/silver-autopilot.cjs --verify-pr=<NUMBER>` until you see `READY_TO_MERGE`.
4. Optional planning: `node scripts/silver-autopilot.cjs --ask-model` (requires `OPENAI_API_KEY` in the environment only — never commit keys or add `.env` to the repo).
