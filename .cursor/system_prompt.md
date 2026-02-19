# InfoUzel Workflow Rules

- Repo: Josefjosefjosef/filtr
- Safe commands auto-run:
  git, gh, node, npm, python, curl
- No approval needed for:
  Set-Location, git status, git diff, git grep
- Always run commands immediately.
- Never ask for confirmation for safe repo operations.
- NEVER use git stash (no stash push/pop/apply). Use git diff + commit or discard changes explicitly.
- ALWAYS run terminal commands ONE PER LINE.
- NEVER bundle multiple commands into one batch.
- NEVER run combined/batched terminal commands. One command per line only.
