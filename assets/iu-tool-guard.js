/**
 * infoUzel.cz — lokální souhlas, právní potvrzení a potvrzovací dialogy (browser-only).
 */

import {
  ensureLocalDataProtectionBeforeSave,
  ensureLocalStorageConsent,
  isLocalDataProtectionNoticeAccepted,
  isLocalStorageConsentGranted,
  canUseLocalStorage,
} from "./iu-local-data-protection.js";

export {
  ensureLocalDataProtectionBeforeSave,
  ensureLocalStorageConsent,
  isLocalDataProtectionNoticeAccepted,
  isLocalStorageConsentGranted,
  canUseLocalStorage,
  hasLocalStorageConsentDecision,
} from "./iu-local-data-protection.js";

const LS_CONSENT_KEY = "iu:tool-local-storage-consent:v1";
const LEGAL_CONFIRM_CONTRACT_KEY = "iu:legal-confirm:contracts:v1";
const LEGAL_CONFIRM_INVOICE_KEY = "iu:legal-confirm:invoice:v1";

const LEGAL_SCOPE_KEYS = {
  contract: LEGAL_CONFIRM_CONTRACT_KEY,
  invoice: LEGAL_CONFIRM_INVOICE_KEY,
};

export const LEGAL_DIALOG_BODY = {
  contract:
    "Beru na vědomí, že vzory smluv, plných mocí a ostatních dokumentů jsou poskytovány pouze jako obecné informativní vzory a nepředstavují právní poradenství, právní službu ani právní stanovisko.\n\n" +
    "Dokument může obsahovat chyby, nepřesnosti, neaktuální ustanovení nebo nemusí odpovídat mé konkrétní situaci.\n\n" +
    "Jsem povinen dokument před použitím zkontrolovat a v případě potřeby konzultovat jeho obsah s advokátem nebo jiným kvalifikovaným odborníkem.\n\n" +
    "Za správnost údajů, použití dokumentu, právní účinky, platnost dokumentu a případné následky odpovídám výhradně já.\n\n" +
    "Provozovatel webu nenese odpovědnost za jakoukoli škodu, náklady, ztráty, neplatnost dokumentu ani jiné následky související s použitím dokumentu.",
  invoice:
    "Beru na vědomí, že generátor faktur je pouze pomocný technický nástroj a nepředstavuje účetní, daňové ani právní poradenství.\n\n" +
    "Výsledná faktura může obsahovat chyby způsobené nesprávně zadanými údaji, technickou chybou nebo jinými okolnostmi.\n\n" +
    "Před použitím jsem povinen zkontrolovat všechny údaje, zejména:\n\n" +
    "• identifikační údaje,\n• datumy,\n• položky,\n• sazby DPH,\n• částky bez DPH,\n• částky včetně DPH,\n• výši DPH,\n• celkovou částku k úhradě.\n\n" +
    "Výpočty si musím ověřit vlastní kontrolou.\n\n" +
    "Za správnost dokladu odpovídám výhradně já.\n\n" +
    "Provozovatel webu nenese odpovědnost za účetní, daňové, právní ani finanční důsledky použití faktury.",
};

let stylesInjected = false;

function injectDialogStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const css =
    ".iu-tool-guard-backdrop{position:fixed;inset:0;z-index:10150;background:rgba(15,23,42,.52);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}" +
    ".iu-tool-guard-dialog{width:min(520px,100%);max-height:min(88vh,720px);overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 48px rgba(0,0,0,.22);border:1px solid rgba(15,23,42,.1)}" +
    ".iu-tool-guard-dialog__body{padding:22px 22px 8px;font-size:14px;line-height:1.55;color:#0f172a;white-space:pre-wrap}" +
    ".iu-tool-guard-dialog__footerHint{padding:0 22px 12px;font-size:12px;line-height:1.45;color:#64748b}" +
    ".iu-tool-guard-dialog__termsLink{display:inline-block;margin-top:6px;padding:0;border:0;background:none;color:#16964E;font-size:13px;font-family:inherit;font-weight:650;cursor:pointer;text-decoration:underline}" +
    ".iu-tool-guard-dialog__actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:14px 18px 18px;border-top:1px solid rgba(15,23,42,.08)}" +
    ".iu-tool-guard-btn{padding:10px 16px;font-size:14px;font-family:inherit;border-radius:10px;border:1px solid rgba(15,23,42,.14);cursor:pointer;background:#f8fafc;color:#0f172a}" +
    ".iu-tool-guard-btn--primary{background:#881337;border-color:#881337;color:#fff;font-weight:650}" +
    ".iu-tool-guard-btn--green{background:#16964E;border-color:#16964E;color:#fff;font-weight:650}" +
    ".iu-tool-guard-btn--danger{background:#b91c1c;border-color:#b91c1c;color:#fff;font-weight:650}" +
    ".iu-tool-guard-termsOverlay{position:fixed;inset:0;z-index:10160;background:rgba(15,23,42,.56);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}" +
    ".iu-tool-guard-termsPanel{width:min(560px,100%);max-height:min(90vh,760px);overflow:auto;background:#fff;border-radius:14px;border:1px solid rgba(15,23,42,.1);box-shadow:0 20px 40px rgba(0,0,0,.2)}" +
    ".iu-tool-guard-termsPanel__head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(15,23,42,.08)}" +
    ".iu-tool-guard-termsPanel__title{margin:0;font-size:15px;font-weight:700;color:#0f172a}" +
    ".iu-tool-guard-termsPanel__body{padding:18px;font-size:14px;line-height:1.55;color:#0f172a;white-space:pre-wrap}" +
    ".iu-tool-guard-termsPanel__actions{padding:0 18px 16px;display:flex;justify-content:flex-end;gap:8px}" +
    "@media (max-width:1024px){" +
    ".iu-tool-guard-backdrop{z-index:10250!important;padding:max(12px,env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px))}" +
    ".iu-tool-guard-termsOverlay{z-index:10260!important;padding:max(12px,env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px))}" +
    "}";
  const el = document.createElement("style");
  el.setAttribute("data-iu-tool-guard", "1");
  el.textContent = css;
  document.head.appendChild(el);
}

export function getLegalTermsText(scope) {
  return LEGAL_DIALOG_BODY[scope] || "";
}

function readPersistFlag(key) {
  try {
    const v = localStorage.getItem(key);
    if (v != null && v !== "") return v;
  } catch (_) {}
  try {
    const v = sessionStorage.getItem(key);
    if (v != null && v !== "") return v;
  } catch (_) {}
  return null;
}

function writePersistFlag(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {}
  try {
    sessionStorage.setItem(key, value);
  } catch (_) {}
}

export function isLegalConfirmValid(scope) {
  const key = LEGAL_SCOPE_KEYS[scope];
  if (!key) return false;
  return readPersistFlag(key) === "accepted";
}

export function saveLegalConfirm(scope) {
  const key = LEGAL_SCOPE_KEYS[scope];
  if (!key) return;
  writePersistFlag(key, "accepted");
}

export function isLocalStorageConsentDenied() {
  return readPersistFlag(LS_CONSENT_KEY) === "denied" && !isLocalDataProtectionNoticeAccepted();
}

function saveLocalStorageConsentChoice(granted) {
  writePersistFlag(LS_CONSENT_KEY, granted ? "granted" : "denied");
}

function showDialog(options) {
  injectDialogStyles();
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "iu-tool-guard-backdrop";
    backdrop.setAttribute("role", "presentation");

    const dialog = document.createElement("div");
    dialog.className = "iu-tool-guard-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const body = document.createElement("div");
    body.className = "iu-tool-guard-dialog__body";
    body.textContent = options.body || "";

    const actions = document.createElement("div");
    actions.className = "iu-tool-guard-dialog__actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "iu-tool-guard-btn";
    cancelBtn.textContent = options.cancelLabel || "Zrušit";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    let confirmClass = "iu-tool-guard-btn iu-tool-guard-btn--primary";
    if (options.confirmStyle === "green") confirmClass = "iu-tool-guard-btn iu-tool-guard-btn--green";
    else if (options.confirmStyle === "danger") confirmClass = "iu-tool-guard-btn iu-tool-guard-btn--danger";
    confirmBtn.className = confirmClass;
    confirmBtn.textContent = options.confirmLabel || "OK";

    function cleanup(result) {
      try {
        backdrop.remove();
      } catch (_) {}
      resolve(result);
    }

    cancelBtn.addEventListener("click", () => cleanup(false));
    confirmBtn.addEventListener("click", () => cleanup(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup(false);
    });

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    try {
      confirmBtn.focus();
    } catch (_) {}
  });
}

export function showLegalTermsOverlay(scope) {
  injectDialogStyles();
  const fullText = getLegalTermsText(scope);
  const overlay = document.createElement("div");
  overlay.className = "iu-tool-guard-termsOverlay";
  overlay.setAttribute("role", "presentation");

  const panel = document.createElement("div");
  panel.className = "iu-tool-guard-termsPanel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "iuToolGuardTermsTitle");

  const head = document.createElement("div");
  head.className = "iu-tool-guard-termsPanel__head";
  const title = document.createElement("h3");
  title.id = "iuToolGuardTermsTitle";
  title.className = "iu-tool-guard-termsPanel__title";
  title.textContent = "Podmínky použití";
  const closeHead = document.createElement("button");
  closeHead.type = "button";
  closeHead.className = "iu-tool-guard-btn";
  closeHead.textContent = "Zavřít";
  head.appendChild(title);
  head.appendChild(closeHead);

  const body = document.createElement("div");
  body.className = "iu-tool-guard-termsPanel__body";
  body.textContent = fullText;

  const actions = document.createElement("div");
  actions.className = "iu-tool-guard-termsPanel__actions";
  const printBtn = document.createElement("button");
  printBtn.type = "button";
  printBtn.className = "iu-tool-guard-btn";
  printBtn.textContent = "Vytisknout";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "iu-tool-guard-btn iu-tool-guard-btn--primary";
  closeBtn.textContent = "Zavřít";

  function removeOverlay() {
    try {
      overlay.remove();
    } catch (_) {}
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      removeOverlay();
    }
  }

  closeHead.addEventListener("click", removeOverlay);
  closeBtn.addEventListener("click", removeOverlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) removeOverlay();
  });
  printBtn.addEventListener("click", () => {
    try {
      const w = window.open("", "_blank");
      if (w) {
        w.document.write("<pre style=\"font-family:system-ui,sans-serif;font-size:14px;line-height:1.55;padding:24px;white-space:pre-wrap\">" + fullText.replace(/</g, "&lt;") + "</pre>");
        w.document.close();
        w.focus();
        w.print();
      }
    } catch (_) {}
  });

  actions.appendChild(printBtn);
  actions.appendChild(closeBtn);
  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey);
  try {
    closeBtn.focus();
  } catch (_) {}
}

export function showLegalConfirmDialog(scope) {
  injectDialogStyles();
  const bodyText = getLegalTermsText(scope);
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "iu-tool-guard-backdrop";
    backdrop.setAttribute("role", "presentation");

    const dialog = document.createElement("div");
    dialog.className = "iu-tool-guard-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const body = document.createElement("div");
    body.className = "iu-tool-guard-dialog__body";
    body.textContent = bodyText;

    const footerHint = document.createElement("div");
    footerHint.className = "iu-tool-guard-dialog__footerHint";
    footerHint.appendChild(document.createTextNode("Podmínky si můžete uložit nebo vytisknout pro vlastní potřebu."));
    const termsBtn = document.createElement("button");
    termsBtn.type = "button";
    termsBtn.className = "iu-tool-guard-dialog__termsLink";
    termsBtn.textContent = "Zobrazit podmínky";
    termsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showLegalTermsOverlay(scope);
    });
    footerHint.appendChild(document.createElement("br"));
    footerHint.appendChild(termsBtn);

    const actions = document.createElement("div");
    actions.className = "iu-tool-guard-dialog__actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "iu-tool-guard-btn";
    cancelBtn.textContent = "Zrušit";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "iu-tool-guard-btn iu-tool-guard-btn--primary";
    confirmBtn.textContent = "Beru na vědomí a pokračovat";

    function cleanup(result) {
      try {
        backdrop.remove();
      } catch (_) {}
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }

    cancelBtn.addEventListener("click", () => cleanup(false));
    confirmBtn.addEventListener("click", () => cleanup(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup(false);
    });

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
      }
    }
    document.addEventListener("keydown", onKey);

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(body);
    dialog.appendChild(footerHint);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    try {
      confirmBtn.focus();
    } catch (_) {}
  });
}

export function confirmClearForm() {
  return showDialog({
    body:
      "Opravdu chcete vymazat všechny údaje z tohoto formuláře?\n\n" +
      "Tato akce odstraní všechny neuložené údaje z formuláře.\n\n" +
      "Pokud jste si údaje neuložili jinam, může dojít k jejich ztrátě.\n\n" +
      "Tato akce je nevratná.",
    cancelLabel: "Zrušit",
    confirmLabel: "Vymazat vše",
    confirmStyle: "danger",
  });
}

export async function guardProtectedAction(scope, actionFn) {
  const ldpOk = await ensureLocalStorageConsent();
  if (!ldpOk) return;
  if (!isLegalConfirmValid(scope)) {
    const ok = await showLegalConfirmDialog(scope);
    if (!ok) return;
    saveLegalConfirm(scope);
  }
  if (typeof actionFn === "function") {
    await actionFn();
  }
}

/** Exportní akce nesmí být blokována odmítnutím lokálního ukládání formulářových dat. */
export async function guardExportAction(scope, actionFn) {
  return guardProtectedAction(scope, actionFn);
}

export const IU_CONTRACT_STATIC_NOTICE =
  "Upozornění: Poskytované dokumenty slouží pouze jako orientační vzory. Nejedná se o právní poradenství, právní službu ani právní stanovisko. Dokument může obsahovat chyby, nepřesnosti nebo nemusí odpovídat Vaší konkrétní situaci. Před použitím vždy zkontrolujte celý obsah dokumentu a správnost všech údajů. V důležitých případech doporučujeme konzultaci s advokátem nebo jiným kvalifikovaným odborníkem. Za použití dokumentu odpovídá výhradně uživatel.";

export const IU_INVOICE_STATIC_NOTICE =
  "Upozornění: Generátor faktur je pouze pomocný technický nástroj. Nejedná se o účetní, daňové ani právní poradenství. Před použitím vždy zkontrolujte správnost všech údajů, položek, sazeb DPH, částek bez DPH, částek včetně DPH, výše DPH a celkové částky k úhradě. Výpočty si vždy ověřte i vlastní kontrolou. Za správnost vystaveného dokladu odpovídá výhradně uživatel.";
