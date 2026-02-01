# Maintenance playbook

## 1. Verify data endpoints manually

1. Open `https://<deploy>/projects/data/articles.json` and `.../videos.json` in a browser or `curl`.  
2. Confirm each responds with HTTP 200, contains `generatedAt`, and exposes `articles`/`videos` arrays (can be empty).  
3. If there is a cached version, force a reload (`Ctrl+F5` or disable cache in DevTools) to ensure you are seeing the latest `?v=` build.  
4. Use the debug view (`?debug=1` + `iuDebugBox`) to confirm `assets/app.js` logs `[LOAD]` and `[FILTER]` lines during the fetch cycle.

## 2. Troubleshooting "Obsah se teď nenačetl"

- Open the JSON endpoints again to rule out backend fail (200 + valid JSON).  
- Disable the service worker (use `?nosw=1` if needed) or run the crash shield loader to unregister old workers.  
- Clear caches: run the debug report and call `nukeCachesAndSwOnBuildChange()` via the console (or refresh with `Ctrl+F5`).  
- Check `iuDebugBox`/console for `[ERR]` logs, then fix the underlying data/workflow issue before reloading.

## 3. Checking GitHub Actions

1. Visit the `update-articles` workflow run in GitHub (Authentication > Actions > `update-articles`).  
2. Confirm the job completes without errors and no `projects/data/*.json` files are empty/zero length.  
3. When guarding dependencies, trigger `repo-guard` and verify that it returns `OK`. It enforces duplicate detection, data validation, and cache bust on every push/PR.

## 4. Detecting a new build/deploy

- Any change to `/assets/app.js` or `/assets/app.css` must be matched with a new `?v=` suffix in `projects/index.html`.  
- A new `generatedAt` timestamp in `/projects/data/*.json` indicates fresh data.  
- The debug log `iu:lastBuildSeen` (see `localStorage`) also signals a new build.  
- The `repo-guard` workflow run is the final gate of every change and appears under `Actions > repo-guard`.

## 5. Safe change sequence

1. Make your JS/CSS/data change locally.  
2. Bump the `?v=` parameters in `projects/index.html` for both `/assets/app.css` and `/assets/app.js`.  
3. Run `scripts/repo_guard.py` to confirm duplicity/data/cache consistency.  
4. Push the change; `repo-guard` will run automatically on push/PR.
