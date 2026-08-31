/**
 * XSS-TT-01 — allowlist sanitizer security + safe-HTML regression (Playwright).
 * Benign canaries only. Covers Chromium / Firefox / WebKit (Firefox = no TT).
 */
import { createRequire } from "module";
import path from "path";
import http from "http";
import fs from "fs";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium, firefox, webkit } = require("playwright");

const TT = fs.readFileSync(path.join(ROOT, "assets", "iu-trusted-types-v1.js"), "utf8");

function startServer(withTtMeta) {
  const csp = withTtMeta
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'self'; object-src 'none'; trusted-types iu-default iu-escape iu-tt-parser; require-trusted-types-for 'script';">`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8">${csp}<script>${TT}</script></head><body><div id="sink"></div></body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

async function runBrowser(browserType, name, withTtMeta) {
  const { server, url } = await startServer(withTtMeta);
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage();
  const fails = [];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const ready = await page.evaluate(() => ({
      ready: !!window.__iuTrustedTypesReady,
      model: window.iuTrustedHtml && window.iuTrustedHtml.model,
      tt: !!(window.trustedTypes && window.trustedTypes.createPolicy),
    }));
    if (!ready.ready) fails.push("tt_not_ready");
    if (ready.model !== "dom-allowlist-v1") fails.push("model_marker");

    const cases = await page.evaluate(() => {
      const out = {};
      function run(id, html) {
        window.__IU_XSS_CANARY = null;
        const el = document.getElementById("sink");
        el.innerHTML = "";
        try {
          window.iuTrustedHtml.setInnerHtml(el, html);
          out[id] = {
            ok: true,
            inner: el.innerHTML,
            canary: window.__IU_XSS_CANARY,
            hasScript: !!el.querySelector("script"),
            hasSvg: !!el.querySelector("svg"),
            hasOnerror: !!el.querySelector("[onerror], [onclick], [onload]"),
            href: (el.querySelector("a") && el.querySelector("a").getAttribute("href")) || null,
            imgSrc: (el.querySelector("img") && el.querySelector("img").getAttribute("src")) || null,
          };
        } catch (e) {
          out[id] = { ok: false, error: String(e && e.message ? e.message : e), canary: window.__IU_XSS_CANARY };
        }
      }

      run("script", '<script>window.__IU_XSS_CANARY="EXECUTED"</script>');
      run("img_onerror", '<img src=x onerror="window.__IU_XSS_CANARY=\'EXECUTED\'">');
      run("svg_onload", '<svg onload="window.__IU_XSS_CANARY=\'EXECUTED\'"><circle r="1"></circle></svg>');
      run("js_href", '<a href="javascript:window.__IU_XSS_CANARY=\'EXECUTED\'">x</a>');
      run("entity_js", '<a href="&#106;avascript:window.__IU_XSS_CANARY=\'EXECUTED\'">x</a>');
      run("tab_js", '<a href="java\tscript:window.__IU_XSS_CANARY=\'EXECUTED\'">x</a>');
      run("nl_js", '<a href="java\nscript:window.__IU_XSS_CANARY=\'EXECUTED\'">x</a>');
      run("null_js", '<a href="java\u0000script:window.__IU_XSS_CANARY=\'EXECUTED\'">x</a>');
      run("data_html", '<a href="data:text/html,<script>1</script>">x</a>');
      run("vbscript", '<a href="vbscript:msgbox(1)">x</a>');
      run("srcdoc", '<iframe srcdoc="<script>window.__IU_XSS_CANARY=\'EXECUTED\'</script>"></iframe>');
      run("meta_refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">');
      run("base", '<base href="https://evil.example/">');
      run("math", "<math><mtext>x</mtext></math>");
      run("form_action_js", '<form action="javascript:window.__IU_XSS_CANARY=\'EXECUTED\'"><button>x</button></form>');
      run("clobber", '<form id="x"><input name="getElementById"></form><img name="iuTrustedHtml">');
      run("safe_p", "<p class='ok'>Ahoj světe</p>");
      run("safe_list", "<ul><li><strong>a</strong></li><li><em>b</em></li></ul>");
      run("safe_link", '<a href="https://example.com/path" target="_blank">link</a>');
      run("safe_table", "<table><tr><th>A</th><td>1</td></tr></table>");
    run("safe_button", '<button type="button" data-act="x" class="btn">Go</button>');
    run("safe_style", '<div style="position:fixed;left:8px;top:8px;width:10px;height:10px">x</div>');
    run("evil_style", '<div style="background:url(javascript:alert(1))">x</div>');
    run("safe_svg_icon", '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M1 1h10v10H1z" fill="none" stroke="currentColor"/></svg>');
      run("safe_yt", '<iframe src="https://www.youtube-nocookie.com/embed/abc" title="t" loading="lazy" allowfullscreen></iframe>');
      run("evil_yt_host", '<iframe src="https://evil.example/embed"></iframe>');
      return out;
    });

    function expectNoCanary(id) {
      if (cases[id] && cases[id].canary === "EXECUTED") fails.push("canary_" + id);
    }
    [
      "script",
      "img_onerror",
      "svg_onload",
      "js_href",
      "entity_js",
      "tab_js",
      "nl_js",
      "null_js",
      "data_html",
      "vbscript",
      "srcdoc",
      "meta_refresh",
      "base",
      "math",
      "form_action_js",
      "clobber",
    ].forEach(expectNoCanary);

    if (cases.script && cases.script.hasScript) fails.push("script_remains");
    if (cases.img_onerror && cases.img_onerror.hasOnerror) fails.push("onerror_remains");
    if (cases.js_href && cases.js_href.href && /javascript:/i.test(cases.js_href.href)) fails.push("js_href_remains");
    if (cases.entity_js && cases.entity_js.href && /javascript:/i.test(cases.entity_js.href)) fails.push("entity_js_href_remains");
    if (cases.srcdoc && /srcdoc/i.test(cases.srcdoc.inner || "")) fails.push("srcdoc_remains");
    if (cases.math && /<math/i.test(cases.math.inner || "")) fails.push("math_remains");
    if (cases.base && /<base/i.test(cases.base.inner || "")) fails.push("base_remains");
    if (cases.meta_refresh && /<meta/i.test(cases.meta_refresh.inner || "")) fails.push("meta_remains");

    if (!cases.safe_p || !/Ahoj světe/.test(cases.safe_p.inner || "")) fails.push("safe_p_lost");
    if (!cases.safe_list || !/<strong>a<\/strong>/.test(cases.safe_list.inner || "")) fails.push("safe_list_lost");
    if (!cases.safe_link || !/example\.com/.test(cases.safe_link.href || "")) fails.push("safe_link_lost");
    if (!cases.safe_link || !/noopener/.test(cases.safe_link.inner || "")) fails.push("safe_link_rel");
    if (!cases.safe_table || !/<td>1<\/td>/.test(cases.safe_table.inner || "")) fails.push("safe_table_lost");
    if (!cases.safe_button || !/data-act="x"/.test(cases.safe_button.inner || "")) fails.push("safe_button_lost");
    if (!cases.safe_style || !/position:\s*fixed/i.test(cases.safe_style.inner || "")) fails.push("safe_style_lost");
    if (cases.evil_style && /javascript:/i.test(cases.evil_style.inner || "")) fails.push("evil_style_kept");
    if (!cases.safe_svg_icon || !cases.safe_svg_icon.hasSvg) fails.push("safe_svg_lost");
    if (!cases.safe_yt || !/youtube-nocookie/.test(cases.safe_yt.inner || "")) fails.push("safe_yt_lost");
    if (cases.evil_yt_host && /evil\.example/.test(cases.evil_yt_host.inner || "")) fails.push("evil_iframe_kept");

    // Click entity js if any href left
    if (cases.entity_js && cases.entity_js.href) {
      await page.evaluate(() => {
        window.__IU_XSS_CANARY = null;
      });
      await page.evaluate(() => {
        window.iuTrustedHtml.setInnerHtml(
          document.getElementById("sink"),
          '<a id="p1" href="&#106;avascript:window.__IU_XSS_CANARY=&quot;EXECUTED&quot;">x</a>'
        );
      });
      try {
        await page.click("#p1", { timeout: 500 });
      } catch (_) {}
      const canary = await page.evaluate(() => window.__IU_XSS_CANARY);
      if (canary === "EXECUTED") fails.push("entity_js_executed_on_click");
    }

    console.log(
      "IU_TT_ALLOWLIST_BROWSER=" +
        JSON.stringify({
          browser: name,
          withTtMeta,
          ready,
          failCount: fails.length,
          fails,
          sample: {
            script: cases.script && cases.script.inner,
            entity_js: cases.entity_js && cases.entity_js.href,
            safe_p: cases.safe_p && cases.safe_p.inner,
          },
        })
    );
    if (fails.length) {
      console.error("IU_TT_ALLOWLIST_FAIL_" + name);
      process.exitCode = 1;
    } else {
      console.log("IU_TT_ALLOWLIST_PASS_" + name);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

const browsers = [
  [chromium, "chromium", true],
  [firefox, "firefox", false], // no TT enforcement — sanitizer must stand alone
  [webkit, "webkit", true],
];

for (const [bt, name, withTt] of browsers) {
  try {
    await runBrowser(bt, name, withTt);
  } catch (e) {
    console.error("IU_TT_ALLOWLIST_THROW_" + name + "=" + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  console.error("IU_TT_ALLOWLIST_SANITIZER_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TT_ALLOWLIST_SANITIZER_GUARD_PASS");
