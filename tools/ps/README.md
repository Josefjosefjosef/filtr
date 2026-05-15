# PowerShell gate helpers (anti-stuck)

For Cursor gate tasks, always import `tools/ps/iu-gate-helpers.ps1` and use the helpers below.

- Use `Iu-AbortMergeRebase` instead of writing your own `Test-Path ... -or ...` checks.
- Use `Iu-MoveGateArtifacts` to move `gate-*.png` and `gate-weather-stuck-transcript.txt` out of the repo.

