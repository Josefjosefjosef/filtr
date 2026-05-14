# WSL taskfile regression probe (infra; bash file redirect, not argv)

Tento text je záměrně „nebezpečný“ pro shell: diakritika (řádek, přehlásky), závorky ( ), odrážky a backticky.

- řádek s odrážkou
- další položka

Inline `backtick` a blok:

```
Set-Location C:\projects\filtr
Get-Content .\SILVER_RUN_REPORT.md -Raw
```

Tyto řádky jsou jen **markdown / text** — nesmí je interpretovat žádný mezilehlý bash jako příkazy.

Sentinel (kontrola logů): `SILVER_WSL_STDIN_PROBE_SENTINEL_9f2b`

1. Vyhodnoť poslední výstupy (povinné).

## Odpověď (povinné)

Vypiš přesně jeden řádek obsahující token `SILVER_WSL_TASKFILE_STDIN_PROBE_OK` a nic jiného na tom řádku kromě volitelných mezer.
