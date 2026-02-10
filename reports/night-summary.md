# Night summary (autopilot)

Date: 2026-02-10

## Open PRs

- **#8** (CLS weather lock): https://github.com/Josefjosefjosef/filtr/pull/8  
  Checks: guard pass — https://github.com/Josefjosefjosef/filtr/actions/runs/21849169807/job/63051726311

- **#9** (sectionsBar no flicker): https://github.com/Josefjosefjosef/filtr/pull/9  
  Checks: guard pass — https://github.com/Josefjosefjosef/filtr/actions/runs/21849109813/job/63051546250

- **#10** (feed no flicker 3): https://github.com/Josefjosefjosef/filtr/pull/10  
  Checks: guard pass — https://github.com/Josefjosefjosef/filtr/actions/runs/21849561978/job/63052892926

- **#11** (right column stability): https://github.com/Josefjosefjosef/filtr/pull/11  
  Checks: guard pass — https://github.com/Josefjosefjosef/filtr/actions/runs/21849591702/job/63052980842

- **#12** (background unify): https://github.com/Josefjosefjosef/filtr/pull/12  
  Checks: guard pass — https://github.com/Josefjosefjosef/filtr/actions/runs/21849622276/job/63053070641

## What changed (high-level)

### PR #10
- Remove remaining `innerHTML=""` clear in `renderEmpty()` and use atomic `replaceChildren()`.
- Avoid `feed.innerHTML=""` on hard load failure; atomically replace with error node (+ keep `#sectionsBar` when present).

### PR #11
- Add conservative `min-height` reservation for `.mindMenu` to reduce right-column CLS on cold load.

### PR #12
- Set `--iu-bg` to `var(--iu-page-bg)` so sticky header background matches app background (reduce flash).

## Manual morning verification (browser)

1) Cold reload home (no cache) and compare before/after:
   - no “empty flash” of feed / sections bar
   - right column doesn’t jump when modules initialize
2) Open with `?debug=1` and capture CLS sources from console (PerformanceObserver).
3) Compare visual background consistency across:
   - sticky header
   - feed column wrapper
   - right column wrapper

