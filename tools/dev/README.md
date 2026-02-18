# Dev — Cursor OOM prevention

This folder contains small helpers to keep local work stable on large repos (Cursor + browser + git/search).

## What we change (safe)

- VSCode/Cursor settings that exclude large folders from file watchers and search.
- A cleanup script that stops common dev processes and moves `gate-*.png` screenshots out of the repo root.

## Cleanup

Run after finishing a task (or when Cursor starts getting slow):

```powershell
.\tools\dev\cleanup.ps1
```

## Notes

- If your machine is low on RAM, close Edge/Chrome before working in Cursor.
- Always scope greps/search to specific folders (`projects`, `assets`, `scripts`, etc.).

