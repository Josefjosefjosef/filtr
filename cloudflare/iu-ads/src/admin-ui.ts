/**
 * Production admin SPA (Worker-served HTML + script). No secrets/hardcoded credentials.
 * API remains fail-closed behind ADS_ADMIN_API_ENABLED; shell is always GET-able.
 */
import { ADMIN_UI_SCRIPT } from "./admin-ui-script";

export const ADMIN_SHELL_HTML = `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>InfoUzel Ads — Admin</title>
  <style>
    :root{--bg:#f4f1ea;--ink:#1a221e;--muted:#5c675f;--accent:#0f6b5c;--line:#d6d0c4;--card:#fffdf9;--danger:#9b2c2c;--ok:#1b6b3a}
    *{box-sizing:border-box}
    body{margin:0;font:15px/1.45 "Segoe UI",system-ui,sans-serif;background:linear-gradient(165deg,#ebe4d8,#f7f5f1 42%,#e4efe9);color:var(--ink);min-height:100vh}
    a{color:var(--accent)}
    header{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.72);backdrop-filter:blur(6px);position:sticky;top:0;z-index:5}
    header h1{font-size:1.15rem;margin:0;letter-spacing:-.02em}
    .layout{display:grid;grid-template-columns:220px 1fr;gap:0;min-height:calc(100vh - 64px)}
    nav{padding:1rem .75rem;border-right:1px solid var(--line);background:rgba(255,255,255,.4);max-height:calc(100vh - 64px);overflow:auto}
    nav button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:.55rem .7rem;border-radius:8px;cursor:pointer;color:var(--ink);font:inherit}
    nav button:hover,nav button.active{background:rgba(15,107,92,.12);color:var(--accent)}
    main{padding:1.25rem;max-width:1100px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin:0 0 1rem}
    .muted{color:var(--muted)} .err{color:var(--danger);margin:.5rem 0} .ok{color:var(--ok)}
    .banner{border-left:4px solid var(--accent);padding:.65rem .9rem;background:rgba(255,255,255,.65);margin-bottom:1rem}
    .banner.warn{border-left-color:var(--danger)} .banner.ok{border-left-color:var(--ok)}
    label{display:block;font-size:.85rem;margin:.55rem 0 .2rem;color:var(--muted)}
    input,select,textarea{width:100%;max-width:100%;padding:.55rem .65rem;border:1px solid var(--line);border-radius:8px;font:inherit;background:#fff}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:.65rem 1rem}
    .row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.75rem}
    button.btn,a.btn{appearance:none;border:0;background:var(--accent);color:#fff;padding:.55rem .9rem;border-radius:8px;cursor:pointer;font:inherit;text-decoration:none;display:inline-block}
    button.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}
    button.linkish{border:0;background:transparent;color:var(--accent);cursor:pointer;font:inherit;padding:0;text-decoration:underline}
    .table-wrap{overflow:auto}
    table{width:100%;border-collapse:collapse;font-size:.92rem}
    th,td{text-align:left;padding:.45rem .35rem;border-bottom:1px solid var(--line);vertical-align:top}
    pre.json{white-space:pre-wrap;word-break:break-word;font:12px/1.4 ui-monospace,Consolas,monospace;background:#f7f4ee;padding:.75rem;border-radius:8px;max-height:420px;overflow:auto}
    .widgets{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.75rem}
    .widget{border:1px solid var(--line);border-radius:10px;padding:.75rem;background:#fff}
    .widget-k{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
    .widget-v{font-size:1.05rem;margin-top:.25rem;word-break:break-word}
    .empty{padding:.5rem 0}
    #login-view,#app-view{display:none}
    #login-view.show,#app-view.show{display:block}
    @media (max-width:860px){
      .layout{grid-template-columns:1fr}
      nav{border-right:0;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:.25rem;max-height:none}
      nav button{width:auto}
      .grid2{grid-template-columns:1fr}
    }
  </style>
</head>
<body>
<header>
  <h1>InfoUzel Ads — Admin</h1>
  <div class="row" id="header-actions"></div>
</header>
<div id="gate-banner" class="banner warn" hidden></div>
<section id="login-view">
  <main>
    <div class="card" id="activate-card" hidden>
      <h3>Aktivace hlavního administrátora</h3>
      <p class="muted">Jednorázový odkaz. Nastavte vlastní silné heslo (min. 12 znaků). Token se po použití zneplatní.</p>
      <form id="activate-form">
        <input type="hidden" id="activate-token"/>
        <label for="activate-pass">Nové heslo</label>
        <input id="activate-pass" type="password" autocomplete="new-password" required minlength="12"/>
        <label for="activate-pass2">Potvrzení hesla</label>
        <input id="activate-pass2" type="password" autocomplete="new-password" required minlength="12"/>
        <div class="row"><button class="btn" type="submit">Nastavit heslo a aktivovat</button></div>
        <p id="activate-err" class="err" hidden></p>
        <p id="activate-ok" class="ok" hidden></p>
      </form>
    </div>
    <div class="card">
      <h2>Přihlášení</h2>
      <p class="muted">Session cookie (HttpOnly, Secure, SameSite=Strict). Hesla se nelogují.</p>
      <form id="login-form">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="username" required/>
        <label for="password">Heslo</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required/>
        <div class="row"><button class="btn" type="submit">Přihlásit</button></div>
        <p id="login-err" class="err" hidden></p>
      </form>
    </div>
    <div class="card">
      <h3>Reset hesla (žádost)</h3>
      <p class="muted">API neenumeruje účty a nevrací token v odpovědi.</p>
      <form id="reset-form">
        <label for="reset-email">E-mail</label>
        <input id="reset-email" type="email" required/>
        <div class="row"><button class="btn secondary" type="submit">Požádat o reset</button></div>
        <p id="reset-msg" class="ok" hidden></p>
      </form>
    </div>
  </main>
</section>
<section id="app-view">
  <div class="layout">
    <nav id="nav" aria-label="Admin menu"></nav>
    <main id="panel"></main>
  </div>
</section>
<script>
${ADMIN_UI_SCRIPT}
</script>
</body>
</html>`;
