# Morning verify (post-push)

Generated: 2026-02-10

## PRs #8–#14

- **#8** https://github.com/Josefjosefjosef/filtr/pull/8  
  state: MERGED  
  mergedAt: 2026-02-10T09:52:01Z  
  checks: PASS (guard) — https://github.com/Josefjosefjosef/filtr/actions/runs/21849169807/job/63051726311

- **#9** https://github.com/Josefjosefjosef/filtr/pull/9  
  state: OPEN  
  mergedAt: null  
  checks: PASS (guard) — https://github.com/Josefjosefjosef/filtr/actions/runs/21849109813/job/63051546250

- **#10** https://github.com/Josefjosefjosef/filtr/pull/10  
  state: MERGED  
  mergedAt: 2026-02-10T09:52:25Z  
  checks: PASS (guard) — https://github.com/Josefjosefjosef/filtr/actions/runs/21849561978/job/63052892926

- **#11** https://github.com/Josefjosefjosef/filtr/pull/11  
  state: OPEN  
  mergedAt: null  
  checks: PASS (guard) — https://github.com/Josefjosefjosef/filtr/actions/runs/21849591702/job/63052980842

- **#12** https://github.com/Josefjosefjosef/filtr/pull/12  
  state: MERGED  
  mergedAt: 2026-02-10T09:52:48Z  
  checks: PASS (guard) — https://github.com/Josefjosefjosef/filtr/actions/runs/21849622276/job/63053070641

- **#13** https://github.com/Josefjosefjosef/filtr/pull/13  
  state: OPEN  
  mergedAt: null  
  checks: PASS (guard) — https://github.com/Josefjosefjosef/filtr/actions/runs/21860413139/job/63087770180

- **#14** https://github.com/Josefjosefjosef/filtr/pull/14  
  state: OPEN  
  mergedAt: null  
  checks: PASS (guard) — https://github.com/Josefjosefjosef/filtr/actions/runs/21860468734/job/63087967561

## Deploy / GitHub Actions

Latest Pages deploy run:
- **Deploy to GitHub Pages** run `21856784035` status: success (2026-02-10T08:09:10Z)

Latest repo guard runs (main merges):
- Merge `fix/ui-background-unify` run `21860028832` success (2026-02-10T09:52:49Z)
- Merge `fix/cls-feed-no-flicker-3` run `21860016344` success (2026-02-10T09:52:26Z)
- Merge `fix/cls-daily-weather-lock` run `21860003493` success (2026-02-10T09:52:03Z)

## Co ověřit ráno v prohlížeči

1) Otevři web.
2) Ctrl+F5 (cold reload).
3) Sleduj: feed nesmí zmizet ani na moment.
4) Sleduj: pravý sloupec nesmí poskočit.
5) Udělej 3× reload.
6) Mobilní šířka (DevTools ~390px) reload – bez bílých děr.

## Pokud stále CLS → přesný sběr důkazů (debug=1)

1) Otevři web s `?debug=1`.
2) Udělej cold reload (Ctrl+F5).
3) Zapiš do ticketu / sem:
   - timestamp řádku z debug logu (nebo přibližný čas po loadu)
   - selector/element, který debug hlásí jako zdroj skoku
   - co bylo viditelně vidět (feed / right column / header)

