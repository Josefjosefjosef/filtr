<!-- SILVER_NEXT_ACTION: maintained by Silver Autopilot --ask-model or by hand; never auto-applied -->

# Next action (template)

1. Ensure a clean git tree for merge-sensitive commands (`git status`).
2. Run `node scripts/silver-autopilot.cjs --status`.
3. For an open PR: `node scripts/silver-autopilot.cjs --verify-pr=<NUMBER>` until you see `READY_TO_MERGE`.
4. Optional planning: `node scripts/silver-autopilot.cjs --ask-model` (requires `OPENAI_API_KEY` in the environment only — never commit keys or add `.env` to the repo).
