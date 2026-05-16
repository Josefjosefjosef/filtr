ÚKOL PRO CURSOR — Silver — FIX WSL ADAPTER READY GATE — SCRIPTS ONLY

CÍL:
Opravit scripts/silver-cursor-agent-adapter.ps1 a související orchestration gating tak,
aby WSL agent PASS lane nastavoval adapter_ready=YES i pro hlavní adapter flow.

AKTUÁLNÍ STAV:
WSL probe:
- marker_probe_pass=YES
- adapter_ready=YES
- safe_for_maxcycles_1=YES

ALE:
root diagnostic stále vrací:
adapter_ready=NO
adapter_ready_reason=no_headless_marker_stdout_exit0_and_no_input_output

DŮLEŽITÉ:
Nejde o WSL failure.
Jde o stale / incorrect top-level gating logic.

SCOPE:
Pouze:
- scripts/silver-cursor-agent-adapter.ps1
- scripts/silver-cursor-agent-adapter-diagnostic.ps1
- případně související report JSON

ZAKÁZÁNO:
- assets/app.js
- Silver engine
- routing
- UI/CSS/backend
- broad refactor

POVINNÉ:
- zachovat všechny safety guardy
- MaxCycles0 musí zůstat BLOCKED
- adapter_ready musí být YES pokud:
  - WSL marker probe PASS
  - stdout marker exact YES
  - exit code 0
  - timeout guard YES
  - repo dirty unexpected NO
- zachovat STOP při reálném selhání adapteru
- žádné fake PASS

OVĚŘ:
powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter-diagnostic.ps1

powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120

git status --short

PR vytvoř, ale nemerguj.

RESULT BLOCK:
=== SILVER_WSL_ADAPTER_GATE_FIX_RESULT ===
engine_changed=NO
assets_app_changed=NO
adapter_ready_root=YES/NO
wsl_probe_pass=YES/NO
safe_for_maxcycles_1=YES/NO
safe_for_maxcycles_0=YES/NO
safety_guards_preserved=YES/NO
git_status_clean=YES/NO
pr_created=YES/NO
pr_url=...
ready_for_merge=YES/NO
=== END_SILVER_WSL_ADAPTER_GATE_FIX_RESULT ===

FINAL BEEP
