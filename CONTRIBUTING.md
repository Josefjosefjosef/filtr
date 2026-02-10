# Contributing

## One-shot runner standard (minimize RUN)

For multi-step operations, do **not** run a long sequence of terminal commands. Update `tools/agent-run.ps1` and run a single command:

`powershell -ExecutionPolicy Bypass -File .\tools\agent-run.ps1 -Task ensure-gh-pr`

