/* IU notes overlay — extracted from app.js (perf stage-5). Loaded via dynamic import. */
import {
  ensureLocalDataProtectionBeforeSave,
  isLocalDataProtectionNoticeAccepted,
} from "./iu-local-data-protection.js";

function iuFoldCsShared(value) {
  try {
    if (typeof window !== "undefined" && typeof window.__iuFoldCsSharedImpl === "function") {
      return window.__iuFoldCsSharedImpl(value);
    }
  } catch (_) {}
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

var __iuNotesModuleBootPromise = null;

export function initIuNotesOverlay() {
  try {
    if (
      typeof window !== "undefined" &&
      window.__iuNotesOverlayInited &&
      window.iuNotesService &&
      !window.iuNotesService.__iuNotesLazyStub &&
      window.iuNotesStorage &&
      typeof window.iuNotesStorage.noteMergeLegacyToBody === "function"
    ) {
      return Promise.resolve();
    }
  } catch (_) {}
  if (__iuNotesModuleBootPromise) return __iuNotesModuleBootPromise;
  try {
    window.__iuNotesOverlayBooting = 1;
  } catch (_) {}
  __iuNotesModuleBootPromise = (function () {
// === Notes overlay module (local-first, Silver-ready storage contract) ===
(function(){
  "use strict";

  const NOTES_NS = "iu.notes";

  const SCHEMA_VERSION = 1;
  const STORE_KEY = NOTES_NS + ".store.v1";
  const VAULT_ENC_PREFIX = "iu:vault:enc:v1:";
  const FOCUSABLE_SELECTOR = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const MAX_TITLE = 140;
  const MAX_CONTENT = 50000;
  const NOTES_OVERLAY_DOM_VERSION = "4";

  const state = {
    inited: false,
    trapAttached: false,
    overlayMounted: false,
    bound: false,
    returnFocusEl: null,
    data: { schemaVersion: SCHEMA_VERSION, notes: [] },
    selectedId: "",
    searchQuery: "",
    searchTimer: null,
    listView: "main",
    autosaveTimer: null,
    lastSavedAt: 0,
    prevBodyPadRight: "",
    mobileDetailOpen: false,
    confirmOpen: false,
    confirmMessage: "",
    confirmAction: null,
    overlayEventsBound: false,
    draftNewNote: null,
    prevSelectedIdBeforeDraft: "",
    draftCommitInFlight: false
  };

  function uid(prefix){ return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m])); }
  function foldCs(s){
    return iuFoldCsShared(s);
  }
  function fmtDate(ts){
    try{
      const d = new Date(Number(ts) || 0);
      if (!d || !Number.isFinite(d.getTime())) return "";
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return day + "." + m + "." + y + " " + hh + ":" + mm;
    }catch{ return ""; }
  }

  /** Local calendar day (aligned with calendar overlay day keys). */
  function isNoteUpdatedToday(ts){
    try{
      const d = new Date(Number(ts) || 0);
      if (!d || !Number.isFinite(d.getTime())) return false;
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }catch{ return false; }
  }

  /** First non-empty line index + trimmed line text. */
  function noteFirstNonEmptyLine(body){
    const lines = String(body ?? "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++){
      const tr = String(lines[i]).trim();
      if (tr) return { line: tr, index: i };
    }
    return { line: "", index: -1 };
  }

  /** Merge legacy title+content into one editable body (cases A–E). */
  function noteMergeLegacyToBody(title, content){
    const tRaw = String(title ?? "");
    const cRaw = String(content ?? "");
    const tTrim = tRaw.trim();
    const cTrim = cRaw.trim();
    if (!tTrim && cTrim) return cRaw;
    if (!tTrim && !cTrim) return "";
    if (!cTrim) return tRaw;
    if (tTrim === cTrim) return tTrim;
    const cFirstLine = cRaw.split(/\r?\n/)[0] || "";
    if (cFirstLine.trim() === tTrim) return cRaw;
    return tTrim + "\n\n" + cRaw;
  }

  function noteBodyFromNote(note){
    if (!note) return "";
    return noteMergeLegacyToBody(note.title, note.content);
  }

  /** Split unified body into storage fields: content = full text, title = first non-empty line. */
  function noteSplitUnifiedBody(rawBody){
    const body = String(rawBody ?? "").slice(0, MAX_CONTENT);
    const hit = noteFirstNonEmptyLine(body);
    if (hit.index < 0) return { ok: false, reason: "empty" };
    return { ok: true, title: hit.line.slice(0, MAX_TITLE), content: body };
  }

  function applyUnifiedBodyToNote(note, rawBody){
    const split = noteSplitUnifiedBody(rawBody);
    if (!split.ok) return split;
    note.title = split.title;
    note.content = split.content;
    return split;
  }

  /** Card heading + preview (no duplicate first line in preview). */
  function noteCardHeadingAndPreview(note){
    const body = noteBodyFromNote(note);
    const hit = noteFirstNonEmptyLine(body);
    if (hit.index < 0) return { heading: "Bez názvu", preview: "" };
    const rest = body.split(/\r?\n/).slice(hit.index + 1);
    const previewParts = rest.map((x) => String(x).trim()).filter(Boolean);
    return { heading: hit.line, preview: previewParts.join(" ") };
  }

  function readUnifiedBodyFromDom(){
    const bodyEl = document.getElementById("iuNoteBody");
    return bodyEl ? String(bodyEl.value ?? "") : "";
  }

  /** Reinforce mobile/tablet layout (scroll split, no detail scroll, 16px inputs, close position) — survives cascade issues. Desktop: no-op. */
  function applyNotesMobileUiGuards(){
    if (!isNotesNarrowViewport()) return;
    const ov = getOverlay();
    if (!ov) return;
    try{
      const se = document.getElementById("iuNotesSearch");
      if (se){
        se.style.setProperty("font-size", "16px", "important");
        se.style.setProperty("line-height", "1.35", "important");
      }
      const ds = document.getElementById("iuNotesDetail");
      if (ds){
        ds.style.setProperty("overflow", "visible", "important");
        ds.style.setProperty("overflow-y", "visible", "important");
        ds.style.setProperty("overflow-x", "visible", "important");
        ds.style.setProperty("max-height", "none", "important");
        ds.style.setProperty("height", "auto", "important");
      }
      const closeBtn = ov.querySelector(".iu-notesOverlay__close");
      if (closeBtn){
        closeBtn.style.removeProperty("position");
        closeBtn.style.removeProperty("top");
        closeBtn.style.removeProperty("right");
        closeBtn.style.removeProperty("margin-left");
        closeBtn.style.removeProperty("z-index");
      }
      const tb = document.getElementById("iuNoteBody");
      const ttag = document.getElementById("iuNoteTagInput");
      if (tb){ tb.style.setProperty("font-size", "16px", "important"); tb.style.setProperty("line-height", "1.35", "important"); }
      if (ttag){ ttag.style.setProperty("font-size", "16px", "important"); ttag.style.setProperty("line-height", "1.35", "important"); }
    }catch{}
  }

  function ensureStyles(){
    /* Overlay layout + theme: /assets/iu-notes-premium.css (linked from projects/index.html). */
  }

  function sanitizeNote(n){
    if (!n || typeof n !== "object") return null;
    const id = String(n.id || "").trim();
    if (!id) return null;
    const createdAt = Number.isFinite(Number(n.createdAt)) ? Number(n.createdAt) : Date.now();
    const updatedAt = Number.isFinite(Number(n.updatedAt)) ? Number(n.updatedAt) : createdAt;
    const title = String(n.title || "").trim().slice(0, MAX_TITLE);
    const content = String(n.content || "").slice(0, MAX_CONTENT);
    const safe = {
      id,
      title,
      content,
      createdAt,
      updatedAt
    };
    safe.pinned = !!n.pinned;
    safe.tags = Array.isArray(n.tags) ? n.tags.map((t)=>String(t || "").trim()).filter(Boolean).slice(0, 24) : [];
    safe.deleted = !!n.deleted;
    return safe;
  }

  function sortNotesInPlace(list){
    try{
      list.sort((a,b)=>{
        const ap = a && a.pinned ? 1 : 0;
        const bp = b && b.pinned ? 1 : 0;
        if (bp !== ap) return bp - ap;
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      });
    }catch{}
  }

  function normalizeStore(parsed){
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.notes)) return null;
    const clean = parsed.notes.map(sanitizeNote).filter(Boolean);
    sortNotesInPlace(clean);
    return { schemaVersion: SCHEMA_VERSION, notes: clean };
  }

  function hasVaultEncBlob(key) {
    try {
      if (localStorage.getItem(VAULT_ENC_PREFIX + key)) return true;
    } catch (_) {}
    try {
      if (window.iuVault && typeof window.iuVault.isPersistBlocked === "function" && window.iuVault.isPersistBlocked(key)) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function isNotesReadOpaque() {
    try {
      if (window.__iuVaultBootLockDecisionPending) return true;
      if (window.__iuVaultHydrationPending) return true;
    } catch (_) {}
    try {
      if (window.iuVault && typeof window.iuVault.isPersistBlocked === "function" && window.iuVault.isPersistBlocked(STORE_KEY)) {
        return true;
      }
    } catch (_) {}
    try {
      if (window.iuVault && typeof window.iuVault.isHydrationComplete === "function" && !window.iuVault.isHydrationComplete()) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function loadNotes(){
    let raw = "";
    try{ raw = String(localStorage.getItem(STORE_KEY) || ""); }catch{}
    let parsed = null;
    try{ parsed = raw ? JSON.parse(raw) : null; }catch{}
    const norm = normalizeStore(parsed);
    if (!norm){
      if (hasVaultEncBlob(STORE_KEY) || isNotesReadOpaque()) {
        if (!state.data || !Array.isArray(state.data.notes)) {
          state.data = { schemaVersion: SCHEMA_VERSION, notes: [] };
        }
        return state.data;
      }
      const empty = { schemaVersion: SCHEMA_VERSION, notes: [] };
      try{ localStorage.setItem(STORE_KEY, JSON.stringify(empty)); }catch{}
      state.data = empty;
      return empty;
    }
    state.data = norm;
    return norm;
  }

  function mapNotesSaveError(err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg === "VAULT_LOCKED") return "vault_locked";
    if (msg === "PERSIST_BLOCKED") return "persist_blocked";
    return msg || "write_failed";
  }

  function saveNotesStatusMessage(reason) {
    if (reason === "vault_locked") return "Uložení blokováno — odemkněte trezor.";
    if (reason === "persist_blocked") return "Uložení dočasně blokováno — zkuste znovu.";
    if (reason === "ldp_declined") return "Uložení vyžaduje souhlas s ochranou lokálních dat.";
    return "Nepodařilo se uložit poznámku.";
  }

  async function persistNotesWrite(norm) {
    if (window.iuVault && typeof window.iuVault.isPersistBlocked === "function" && window.iuVault.isPersistBlocked(STORE_KEY)) {
      throw new Error("PERSIST_BLOCKED");
    }
    const ret = localStorage.setItem(STORE_KEY, JSON.stringify(norm));
    if (ret && typeof ret.then === "function") {
      await ret;
    }
    if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
      await window.iuVault.flushPendingWrites();
    }
    if (window.iuVault && typeof window.iuVault.isPersistBlocked === "function" && window.iuVault.isPersistBlocked(STORE_KEY)) {
      throw new Error("PERSIST_BLOCKED");
    }
  }

  async function saveNotes(data){
    const norm = normalizeStore(data) || { schemaVersion: SCHEMA_VERSION, notes: [] };
    state.data = norm;
    function emitNotesChanged(){
      try{ window.dispatchEvent(new CustomEvent("iu-local-store-changed", { detail: { key: STORE_KEY } })); }catch{}
    }
    function fail(reason) {
      return { ok: false, reason: reason, data: norm };
    }
    if (!isLocalDataProtectionNoticeAccepted()) {
      const ldpOk = await ensureLocalDataProtectionBeforeSave();
      if (!ldpOk) return fail("ldp_declined");
    }
    try {
      await persistNotesWrite(norm);
      state.lastSavedAt = Date.now();
      emitNotesChanged();
      return { ok: true, data: norm };
    } catch (err) {
      return fail(mapNotesSaveError(err));
    }
  }

  function createEmptyNote(){
    const now = Date.now();
    return {
      id: uid("note"),
      title: "",
      content: "",
      createdAt: now,
      updatedAt: now,
      pinned: false,
      tags: [],
      deleted: false
    };
  }

  function getNoteById(id){
    const key = String(id || "").trim();
    if (!key) return null;
    const list = state.data && Array.isArray(state.data.notes) ? state.data.notes : [];
    return list.find((n)=>String(n.id) === key) || null;
  }

  function isDraftNewNoteActive(){
    return !!(state.draftNewNote && String(state.selectedId) === String(state.draftNewNote.id));
  }

  function getActiveNote(){
    if (isDraftNewNoteActive()) return state.draftNewNote;
    return getNoteById(state.selectedId);
  }

  function syncDraftFromDom(){
    if (!state.draftNewNote) return null;
    applyUnifiedBodyToNote(state.draftNewNote, readUnifiedBodyFromDom());
    state.draftNewNote.updatedAt = Date.now();
    return state.draftNewNote;
  }

  function discardDraftNewNote(){
    state.draftNewNote = null;
    state.prevSelectedIdBeforeDraft = "";
  }

  function commitDraftNewNote(){
    if (!isDraftNewNoteActive()) return;
    if (state.draftCommitInFlight) return;
    state.draftCommitInFlight = true;
    void (async function () {
      try{
        if (state.autosaveTimer){
          try{ clearTimeout(state.autosaveTimer); }catch{}
          state.autosaveTimer = null;
        }
        syncDraftFromDom();
        const split = noteSplitUnifiedBody(noteBodyFromNote(state.draftNewNote));
        if (!split.ok){
          renderStatus("Zadejte text poznámky.");
          return;
        }
        const n = sanitizeNote(state.draftNewNote);
        if (!n) return;
        const draftId = n.id;
        state.data.notes.unshift(n);
        state.selectedId = n.id;
        discardDraftNewNote();
        sortNotesInPlace(state.data.notes);
        const saveRes = await saveNotes(state.data);
        if (!saveRes.ok) {
          state.data.notes = state.data.notes.filter((x) => String(x.id) !== String(draftId));
          if (state.selectedId === draftId) {
            const first = searchNotes(state.searchQuery)[0];
            state.selectedId = first ? first.id : "";
          }
          renderStatus(saveNotesStatusMessage(saveRes.reason));
          render();
          return;
        }
        renderStatus("Uloženo " + fmtDate(state.lastSavedAt));
        render();
      }finally{
        state.draftCommitInFlight = false;
      }
    })();
  }

  function cancelDraftNewNote(){
    if (!state.draftNewNote) return;
    if (state.autosaveTimer){
      try{ clearTimeout(state.autosaveTimer); }catch{}
      state.autosaveTimer = null;
    }
    const prev = String(state.prevSelectedIdBeforeDraft || "").trim();
    discardDraftNewNote();
    if (prev && getNoteById(prev)) state.selectedId = prev;
    else {
      const first = searchNotes(state.searchQuery)[0];
      state.selectedId = first ? first.id : "";
    }
    if (isNotesNarrowViewport()) setMobileMode(state.selectedId ? "detail" : "list");
    render();
  }

  function searchNotes(query){
    const q = foldCs(String(query || "")).trim();
    const list = state.data && Array.isArray(state.data.notes) ? state.data.notes : [];
    const inTrash = state.listView === "trash";
    const scoped = list.filter((n)=>!!n.deleted === inTrash);
    const filtered = !q ? scoped.slice() : scoped.filter((n)=>{
      const body = foldCs(noteBodyFromNote(n));
      const tags = Array.isArray(n.tags) ? n.tags.map((x)=>foldCs(String(x || ""))).join(" ") : "";
      return body.includes(q) || tags.includes(q);
    });
    sortNotesInPlace(filtered);
    return filtered;
  }

  function isMobileDetail(){
    try{
      return !!(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
    }catch{
      return (window.innerWidth || 0) <= 768;
    }
  }

  /** True for mobile + tablet layout (≤900px). Aligns with @media (max-width:900px) in notes CSS. */
  function isNotesNarrowViewport(){
    try{
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) return true;
      const iw = Number(window.innerWidth || document.documentElement.clientWidth || 0);
      return iw <= 900;
    }catch{
      return (window.innerWidth || 0) <= 900;
    }
  }

  /** Mobile/tablet: do not programmatically focus search on open (avoids auto keyboard). Desktop unchanged. */
  function shouldSkipNotesOpenInputFocus(){
    return isNotesNarrowViewport();
  }

  function setMobileMode(mode){
    const ov = getOverlay();
    if (!ov) return;
    const m = String(mode || "");
    if (m === "detail") {
      state.mobileDetailOpen = true;
      ov.setAttribute("data-iu-notes-mode", "detail");
    } else {
      state.mobileDetailOpen = false;
      ov.setAttribute("data-iu-notes-mode", "list");
    }
  }

  function getOverlay(){ return document.getElementById("iuNotesOverlay"); }

  function ensureOverlayDomFresh(){
    const ov = getOverlay();
    if (!ov) return;
    if (String(ov.getAttribute("data-iu-notes-dom-version") || "") === NOTES_OVERLAY_DOM_VERSION) return;
    try{ ov.remove(); }catch{}
    state.overlayMounted = false;
    state.overlayEventsBound = false;
    mountOverlay();
  }

  function attachOverlayEventHandlers(ov){
    if (!ov || state.overlayEventsBound) return;
    state.overlayEventsBound = true;
    ov.addEventListener("click", onNotesOverlayClick, true);
    ov.addEventListener("pointerdown", onNotesOverlayPointerDown, true);
  }

  function onNotesOverlayPointerDown(e){
    const ov = getOverlay();
    if (!ov || ov.hidden) return;
    const t = e.target;
    const quickDel = t && t.closest ? t.closest("[data-iu-note-quick-delete]") : null;
    if (quickDel){
      e.preventDefault();
      e.stopPropagation();
      const idQuick = String(quickDel.getAttribute("data-iu-note-quick-delete") || "");
      requestMoveNoteToTrash(idQuick);
      return;
    }
    const emptyTrash = t && t.closest ? t.closest("[data-iu-notes-empty-trash]") : null;
    if (emptyTrash && !emptyTrash.hidden){
      e.preventDefault();
      e.stopPropagation();
      requestPurgeTrash();
    }
  }

  function onNotesOverlayClick(e){
    const ov = getOverlay();
    if (!ov || ov.hidden) return;
    const t = e.target;

    const close = t && t.closest ? t.closest("[data-iu-notes-close]") : null;
    if (close){ e.preventDefault(); closeOverlay(); return; }

    const confirmBackdrop = t && t.closest ? t.closest("[data-iu-notes-confirm-backdrop]") : null;
    if (confirmBackdrop){ e.preventDefault(); hideNotesConfirm(); return; }

    const confirmNo = t && t.closest ? t.closest(".iu-notesOverlay__confirmActions [data-iu-notes-confirm-no]") : null;
    if (confirmNo){ e.preventDefault(); hideNotesConfirm(); return; }

    const confirmYes = t && t.closest ? t.closest("[data-iu-notes-confirm-yes]") : null;
    if (confirmYes){ e.preventDefault(); runNotesConfirmYes(); return; }

    const emptyTrash = t && t.closest ? t.closest("[data-iu-notes-empty-trash]") : null;
    if (emptyTrash && !emptyTrash.hidden){ e.preventDefault(); requestPurgeTrash(); return; }

    const quickDel = t && t.closest ? t.closest("[data-iu-note-quick-delete]") : null;
    if (quickDel){
      e.preventDefault();
      e.stopPropagation();
      const idQuick = String(quickDel.getAttribute("data-iu-note-quick-delete") || "");
      requestMoveNoteToTrash(idQuick);
      return;
    }

    const back = t && t.closest ? t.closest("[data-iu-notes-back]") : null;
    if (back){
      e.preventDefault();
      if (isDraftNewNoteActive()){
        cancelDraftNewNote();
        return;
      }
      if (isNotesNarrowViewport() && state.mobileDetailOpen) flushNotesDetailToStoreSync();
      setMobileMode("list");
      if (isNotesNarrowViewport()) state.selectedId = "";
      render();
      if (!isNotesNarrowViewport()){
        const searchEl = document.getElementById("iuNotesSearch");
        if (searchEl) try{ searchEl.focus({ preventScroll: true }); }catch{}
      }
      return;
    }

    const newBtn = t && t.closest ? t.closest("[data-iu-notes-new]") : null;
    if (newBtn){ e.preventDefault(); createNewAndSelect(); return; }

    const draftSave = t && t.closest ? t.closest("[data-iu-notes-draft-save]") : null;
    if (draftSave){ e.preventDefault(); commitDraftNewNote(); return; }

    const draftCancel = t && t.closest ? t.closest("[data-iu-notes-draft-cancel]") : null;
    if (draftCancel){ e.preventDefault(); cancelDraftNewNote(); return; }

    const viewBtn = t && t.closest ? t.closest("[data-iu-notes-view]") : null;
    if (viewBtn){
      e.preventDefault();
      if (isDraftNewNoteActive()) cancelDraftNewNote();
      state.listView = String(viewBtn.getAttribute("data-iu-notes-view") || "main");
      const first = searchNotes(state.searchQuery)[0];
      if (isNotesNarrowViewport()){
        state.selectedId = "";
        setMobileMode("list");
      } else {
        state.selectedId = first ? first.id : "";
      }
      render();
      return;
    }

    const pin = t && t.closest ? t.closest("[data-iu-note-pin]") : null;
    if (pin){
      e.preventDefault();
      e.stopPropagation();
      const idPin = String(pin.getAttribute("data-iu-note-pin") || "");
      togglePin(idPin);
      return;
    }

    const pick = t && t.closest ? t.closest("[data-iu-note-id]") : null;
    if (pick){
      e.preventDefault();
      if (isDraftNewNoteActive()) discardDraftNewNote();
      const id = String(pick.getAttribute("data-iu-note-id") || "");
      state.selectedId = id;
      setMobileMode("detail");
      render();
      return;
    }

    const del = t && t.closest ? t.closest("[data-iu-note-delete]") : null;
    if (del){
      e.preventDefault();
      const id = String(del.getAttribute("data-iu-note-delete") || "");
      requestMoveNoteToTrash(id);
      return;
    }

    const restore = t && t.closest ? t.closest("[data-iu-note-restore]") : null;
    if (restore){
      e.preventDefault();
      const id = String(restore.getAttribute("data-iu-note-restore") || "");
      const note = getNoteById(id);
      if (!note) return;
      note.deleted = false;
      note.updatedAt = Date.now();
      void saveNotes(state.data).then(function (saveRes) {
        if (!saveRes.ok) {
          note.deleted = true;
          renderStatus(saveNotesStatusMessage(saveRes.reason));
          render();
          return;
        }
        const first = searchNotes(state.searchQuery)[0];
        state.selectedId = first ? first.id : "";
        if (isNotesNarrowViewport()) setMobileMode("list");
        render();
      });
    }
  }

  function mountOverlay(){
    if (state.overlayMounted){
      ensureOverlayDomFresh();
      return;
    }
    state.overlayMounted = true;
    const ov = document.createElement("div");
    ov.id = "iuNotesOverlay";
    ov.className = "iu-notesOverlay iuNotesRoot iu-notesPremiumScope iu-tools-overlay-fullscreen-desktop";
    ov.hidden = true;
    ov.setAttribute("aria-hidden", "true");
    ov.setAttribute("data-iu-notes-dom-version", NOTES_OVERLAY_DOM_VERSION);
    ov.innerHTML =
      '<div class="iu-notesOverlay__backdrop" data-iu-notes-close="1" aria-hidden="true"></div>' +
      '<div class="iu-notesOverlay__dialog" role="dialog" aria-modal="true" aria-labelledby="iuNotesTitle">' +
        '<div class="iu-notesOverlay__header">' +
          '<div class="iu-notesOverlay__titleWrap">' +
            '<h2 class="iu-notesOverlay__title" id="iuNotesTitle">Poznámky</h2>' +
          "</div>" +
          '<div class="iu-notesOverlay__actions">' +
            '<button type="button" class="iu-notesOverlay__back" data-iu-notes-back="1" aria-label="Zpět">Zpět</button>' +
            '<button type="button" class="iu-notesOverlay__btn" data-iu-notes-new="1">Nová poznámka</button>' +
            '<button type="button" class="iu-notesOverlay__close" data-iu-notes-close="1" aria-label="Zavřít poznámky">×</button>' +
          "</div>" +
        "</div>" +
        '<div class="iu-notesOverlay__body">' +
          '<aside class="iu-notesOverlay__list" aria-label="Seznam poznámek">' +
            '<div class="iu-notesOverlay__listHeader">' +
              '<div class="iu-notesOverlay__listHeaderRow">' +
                '<div class="iu-notesOverlay__listHeaderLeft">' +
                  '<button type="button" class="iu-notesOverlay__btn" data-iu-notes-view="main">Poznámky</button>' +
                "</div>" +
                '<div class="iu-notesOverlay__listHeaderRight">' +
                  '<button type="button" class="iu-notesOverlay__btn" data-iu-notes-view="trash">Koš</button>' +
                  '<button type="button" class="iu-notesOverlay__btn iu-notesOverlay__btn--danger" data-iu-notes-empty-trash="1" hidden>Vysypat koš</button>' +
                "</div>" +
              "</div>" +
              '<input class="iu-notesOverlay__search" id="iuNotesSearch" type="search" autocomplete="off" placeholder="Hledat v poznámkách…" aria-label="Hledat v poznámkách" />' +
            "</div>" +
            '<div class="iu-notesOverlay__listScroll">' +
              '<ul class="iu-notesOverlay__items" id="iuNotesList"></ul>' +
            "</div>" +
          "</aside>" +
          '<section class="iu-notesOverlay__detail" aria-label="Detail poznámky">' +
            '<div class="iu-notesOverlay__detailScroll" id="iuNotesDetail"></div>' +
          "</section>" +
        "</div>" +
      "</div>" +
      '<div class="iu-notesOverlay__confirm" id="iuNotesConfirm" hidden role="alertdialog" aria-modal="true" aria-labelledby="iuNotesConfirmText">' +
        '<div class="iu-notesOverlay__confirmBackdrop" data-iu-notes-confirm-backdrop="1" aria-hidden="true"></div>' +
        '<div class="iu-notesOverlay__confirmBox">' +
          '<p class="iu-notesOverlay__confirmText" id="iuNotesConfirmText"></p>' +
          '<div class="iu-notesOverlay__confirmActions">' +
            '<button type="button" class="iu-notesOverlay__btn" data-iu-notes-confirm-yes="1">OK</button>' +
            '<button type="button" class="iu-notesOverlay__btn" data-iu-notes-confirm-no="1">Zrušit</button>' +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(ov);
    attachOverlayEventHandlers(ov);
  }

  function openOverlay(originEl){
    mountOverlay(); /* lazy mount on first open (covers DOM-version refresh too) */
    const ov = getOverlay();
    if (!ov) return;
    try {
      if (window.iuAnalytics && typeof window.iuAnalytics.privateToolsOpen === "function") {
        window.iuAnalytics.privateToolsOpen();
      }
    } catch (_) {}
    state.returnFocusEl = originEl || document.activeElement;
    setMobileMode("list");
    if (isNotesNarrowViewport()){
      state.selectedId = "";
    } else {
      if (!state.selectedId){
        const first = searchNotes(state.searchQuery)[0];
        if (first) state.selectedId = first.id;
      }
    }
    ov.hidden = false;
    ov.setAttribute("aria-hidden", "false");
    document.body.classList.add("iu-notesOverlay-open");
    try{
      const sw = Math.max(0, (window.innerWidth || 0) - (document.documentElement && document.documentElement.clientWidth ? document.documentElement.clientWidth : 0));
      state.prevBodyPadRight = String(document.body.style.paddingRight || "");
      if (sw > 0) document.body.style.paddingRight = sw + "px";
    }catch{}
    render();
    attachFocusTrap();
    if (!shouldSkipNotesOpenInputFocus()){
      const searchEl = document.getElementById("iuNotesSearch");
      if (searchEl) {
        try{ searchEl.focus({ preventScroll: true }); }catch{ try{ searchEl.focus(); }catch{} }
      } else {
        const first = ov.querySelector(FOCUSABLE_SELECTOR);
        if (first) try{ first.focus({ preventScroll: true }); }catch{}
      }
    } else {
      try{
        const searchEl = document.getElementById("iuNotesSearch");
        if (searchEl){
          searchEl.setAttribute("tabindex", "-1");
          const restoreTab = function(){
            try{ searchEl.removeAttribute("tabindex"); }catch{}
            try{ searchEl.removeEventListener("pointerdown", restoreTab, true); }catch{}
          };
          searchEl.addEventListener("pointerdown", restoreTab, true);
        }
        try{
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              try{
                const ae = document.activeElement;
                if (ae && ov.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")){
                  ae.blur();
                }
              }catch{}
            });
          });
        }catch{}
      }catch{}
    }
    applyNotesMobileUiGuards();
    try{
      if (isNotesNarrowViewport()){
        const se = document.getElementById("iuNotesSearch");
        if (se && document.activeElement === se){
          try{ se.blur(); }catch{}
        }
        const fb =
          ov.querySelector('.iu-notesOverlay__btn[data-iu-notes-view="main"]') ||
          ov.querySelector("[data-iu-notes-new]");
        if (fb && typeof fb.focus === "function"){
          try{ fb.focus({ preventScroll: true }); }catch{ try{ fb.focus(); }catch{} }
        }
      }
    }catch{}
  }

  function closeOverlay(){
    const ov = getOverlay();
    if (!ov) return;
    hideNotesConfirm();
    if (state.draftNewNote) discardDraftNewNote();
    setMobileMode("list");
    ov.hidden = true;
    ov.setAttribute("aria-hidden", "true");
    document.body.classList.remove("iu-notesOverlay-open");
    try{ document.body.style.paddingRight = state.prevBodyPadRight || ""; }catch{}
    detachFocusTrap();
    if (state.returnFocusEl && typeof state.returnFocusEl.focus === "function"){
      const el = state.returnFocusEl;
      try{ el.focus({ preventScroll: true }); }catch{ try{ el.focus(); }catch{} }
      try{ setTimeout(() => { try{ el.focus({ preventScroll: true }); }catch{ try{ el.focus(); }catch{} } }, 0); }catch{}
    }
  }

  function attachFocusTrap(){
    if (state.trapAttached) return;
    state.trapAttached = true;
    document.addEventListener("keydown", onGlobalKeyDown, true);
  }
  function detachFocusTrap(){
    if (!state.trapAttached) return;
    state.trapAttached = false;
    document.removeEventListener("keydown", onGlobalKeyDown, true);
  }

  function onGlobalKeyDown(e){
    const ov = getOverlay();
    if (!ov || ov.hidden) return;
    if (e.key === "Escape"){
      e.preventDefault();
      if (state.confirmOpen){
        hideNotesConfirm();
        return;
      }
      if (isDraftNewNoteActive()){
        cancelDraftNewNote();
        return;
      }
      if (isNotesNarrowViewport() && state.mobileDetailOpen){
        flushNotesDetailToStoreSync();
        state.selectedId = "";
        setMobileMode("list");
        render();
        return;
      }
      closeOverlay();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = Array.from(ov.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el)=>!el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey){
      if (active === first || active === ov){ e.preventDefault(); try{ last.focus(); }catch{} }
    } else {
      if (active === last){ e.preventDefault(); try{ first.focus(); }catch{} }
    }
  }

  function scheduleAutosave(){
    if (state.autosaveTimer) {
      try{ clearTimeout(state.autosaveTimer); }catch{}
      state.autosaveTimer = null;
    }
    state.autosaveTimer = setTimeout(() => {
      state.autosaveTimer = null;
      void (async () => {
        try{
          sortNotesInPlace(state.data.notes);
          const saveRes = await saveNotes(state.data);
          if (saveRes.ok) {
            renderStatus("Uloženo " + fmtDate(state.lastSavedAt));
            renderList();
          } else {
            renderStatus(saveNotesStatusMessage(saveRes.reason));
          }
        }catch{}
      })();
    }, 450);
    renderStatus("Ukládám…");
  }

  function renderStatus(text){
    const el = document.getElementById("iuNotesStatus");
    if (el) el.textContent = text || "";
  }

  function showNotesConfirm(message, onYes){
    state.confirmOpen = true;
    state.confirmMessage = String(message || "");
    state.confirmAction = typeof onYes === "function" ? onYes : null;
    const box = document.getElementById("iuNotesConfirm");
    const textEl = document.getElementById("iuNotesConfirmText");
    if (textEl) textEl.textContent = state.confirmMessage;
    if (box){
      box.hidden = false;
      const yesBtn = box.querySelector("[data-iu-notes-confirm-yes]");
      if (yesBtn && typeof yesBtn.focus === "function"){
        try{ yesBtn.focus({ preventScroll: true }); }catch{ try{ yesBtn.focus(); }catch{} }
      }
    }
  }

  function hideNotesConfirm(){
    state.confirmOpen = false;
    state.confirmMessage = "";
    state.confirmAction = null;
    const box = document.getElementById("iuNotesConfirm");
    if (box) box.hidden = true;
  }

  function runNotesConfirmYes(){
    const fn = state.confirmAction;
    hideNotesConfirm();
    if (typeof fn === "function"){
      try{ fn(); }catch{}
    }
  }

  function moveNoteToTrash(id){
    const note = getNoteById(id);
    if (!note || note.deleted) return;
    note.deleted = true;
    note.updatedAt = Date.now();
    void saveNotes(state.data).then(function (saveRes) {
      if (!saveRes.ok) {
        note.deleted = false;
        renderStatus(saveNotesStatusMessage(saveRes.reason));
        render();
        return;
      }
      const first = searchNotes(state.searchQuery)[0];
      state.selectedId = first ? first.id : "";
      if (isNotesNarrowViewport()) setMobileMode("list");
      render();
    });
  }

  function requestMoveNoteToTrash(id){
    const key = String(id || "").trim();
    if (!key) return;
    showNotesConfirm("Opravdu chcete tuto poznámku přesunout do koše?", function(){
      moveNoteToTrash(key);
    });
  }

  function purgeTrashNotes(){
    const list = state.data && Array.isArray(state.data.notes) ? state.data.notes : [];
    const kept = list.filter((n)=>!n.deleted);
    state.data.notes = kept;
    void saveNotes(state.data).then(function (saveRes) {
      if (!saveRes.ok) {
        renderStatus(saveNotesStatusMessage(saveRes.reason));
        render();
        return;
      }
      state.selectedId = "";
      if (isNotesNarrowViewport()) setMobileMode("list");
      render();
    });
  }

  function requestPurgeTrash(){
    const hasTrash = (state.data && Array.isArray(state.data.notes) ? state.data.notes : []).some((n)=>!!n.deleted);
    if (!hasTrash) return;
    showNotesConfirm("Opravdu chcete trvale odstranit všechny poznámky v koši?", function(){
      purgeTrashNotes();
    });
  }

  function renderListHeaderChrome(){
    const ov = getOverlay();
    const emptyTrashBtn = ov ? ov.querySelector("[data-iu-notes-empty-trash]") : null;
    if (!emptyTrashBtn) return;
    const hasTrash = (state.data && Array.isArray(state.data.notes) ? state.data.notes : []).some((n)=>!!n.deleted);
    emptyTrashBtn.hidden = !(state.listView === "trash" && hasTrash);
  }

  function patchActiveListItemInDom(){
    const id = String(state.selectedId || "").trim();
    if (!id) return;
    const note = getNoteById(id);
    if (!note) return;
    const listEl = document.getElementById("iuNotesList");
    if (!listEl) return;
    const btn = listEl.querySelector('[data-iu-note-id="' + id + '"]');
    if (!btn) return;
    const card = noteCardHeadingAndPreview(note);
    const title = card.heading;
    const prevLine = card.preview;
    const titleEl = btn.querySelector(".iu-notesOverlay__itemTitle");
    if (titleEl) titleEl.textContent = title;
    let previewEl = btn.querySelector("[data-iu-note-preview]");
    if (prevLine){
      if (!previewEl){
        previewEl = document.createElement("div");
        previewEl.className = "iu-notesOverlay__itemPreview";
        previewEl.setAttribute("data-iu-note-preview", "1");
        const metaEl = btn.querySelector(".iu-notesOverlay__itemMeta");
        if (metaEl) btn.insertBefore(previewEl, metaEl);
        else btn.appendChild(previewEl);
      }
      previewEl.textContent = prevLine;
    } else if (previewEl){
      try{ previewEl.remove(); }catch{}
    }
  }

  function renderList(){
    const listEl = document.getElementById("iuNotesList");
    if (!listEl) return;
    const items = searchNotes(state.searchQuery);
    if (!items.length){
      listEl.innerHTML = '<li><div class="iu-notesOverlay__empty iuNotesState--empty">' + (state.listView === "trash" ? "Koš je prázdný." : "Zatím nemáš žádné poznámky.<br><strong>Vytvořit první poznámku</strong>") + "</div></li>";
      return;
    }
    listEl.innerHTML = items.map((n)=>{
      const active = String(n.id) === String(state.selectedId);
      const card = noteCardHeadingAndPreview(n);
      const title = card.heading;
      const prevLine = card.preview;
      const meta = (n.updatedAt ? ("Upraveno: " + fmtDate(n.updatedAt)) : "");
      const pinned = !!n.pinned;
      const todayU = isNoteUpdatedToday(n.updatedAt);
      let stateCls = "";
      if (active) stateCls += " iuNotesState--selected";
      if (pinned) stateCls += " iuNotesState--active";
      if (todayU) stateCls += " iuNotesState--recent";
      else if (Number(n.updatedAt)) stateCls += " iuNotesState--older";
      return (
        '<li>' +
          '<div class="iu-notesOverlay__itemRow">' +
            '<button type="button" class="iu-notesOverlay__itemBtn' + (active ? " is-active" : "") + stateCls + '" data-iu-note-id="' + esc(n.id) + '">' +
              '<div class="iu-notesOverlay__itemTitle">' + esc(title) + "</div>" +
              (prevLine ? ('<div class="iu-notesOverlay__itemPreview" data-iu-note-preview="1">' + esc(prevLine) + "</div>") : "") +
              '<div class="iu-notesOverlay__itemMeta">' + esc(meta) + "</div>" +
            "</button>" +
            '<div class="iu-notesOverlay__itemActions">' +
              '<button type="button" class="iu-notesOverlay__actionBtn iu-notesOverlay__pin' + (pinned ? " is-on" : "") + '" data-iu-note-pin="' + esc(n.id) + '" aria-label="' + (pinned ? "Odepnout" : "Připnout") + '">' + (pinned ? "★" : "☆") + "</button>" +
              (state.listView === "main"
                ? ('<button type="button" class="iu-notesOverlay__actionBtn iu-notesOverlay__itemTrash" data-iu-note-quick-delete="' + esc(n.id) + '" aria-label="Přesunout do koše"><span class="iu-notesOverlay__itemTrashIcon" aria-hidden="true">🗑️</span></button>')
                : "") +
            "</div>" +
          "</div>" +
        "</li>"
      );
    }).join("");
  }

  function renderDetail(){
    const root = document.getElementById("iuNotesDetail");
    if (!root) return;
    if (isNotesNarrowViewport() && !state.mobileDetailOpen){
      root.innerHTML = "";
      return;
    }
    const note = getActiveNote();
    if (!note){
      root.innerHTML = '<div class="iu-notesOverlay__empty iuNotesState--empty">Vyber poznámku vlevo, nebo vytvoř novou.</div>';
      return;
    }
    const draftMode = isDraftNewNoteActive();
    let actionsHtml = "";
    if (draftMode){
      actionsHtml =
        '<div class="iu-notesOverlay__draftActions">' +
          '<button type="button" class="iu-notesOverlay__btn" data-iu-notes-draft-save="1">Uložit</button>' +
          '<button type="button" class="iu-notesOverlay__btn" data-iu-notes-draft-cancel="1">Zrušit</button>' +
        "</div>";
    } else if (state.listView === "trash"){
      actionsHtml = '<button type="button" class="iu-notesOverlay__btn" data-iu-note-restore="' + esc(note.id) + '">Obnovit z koše</button>';
    } else {
      actionsHtml = '<button type="button" class="iu-notesOverlay__btn" data-iu-note-delete="' + esc(note.id) + '">Přesunout do koše</button>';
    }
    const unifiedBody = esc(noteBodyFromNote(note));
    root.innerHTML =
      '<div class="iu-notesOverlay__form">' +
        '<div class="iu-notesOverlay__status" id="iuNotesStatus"></div>' +
        '<label class="iu-notesOverlay__label">Poznámka' +
          '<textarea class="iu-notesOverlay__textarea" id="iuNoteBody" rows="8" maxlength="' + MAX_CONTENT + '" placeholder="Napište poznámku…">' + unifiedBody + "</textarea>" +
        "</label>" +
        '<label class="iu-notesOverlay__label">Tagy' +
          '<input class="iu-notesOverlay__input" id="iuNoteTagInput" type="text" autocomplete="off" placeholder="#práce" />' +
        "</label>" +
        '<div class="iu-notesOverlay__itemMeta">' + (Array.isArray(note.tags) && note.tags.length ? esc(note.tags.join(" ")) : "Bez tagů") + "</div>" +
        '<div class="iu-notesOverlay__actions">' + actionsHtml + "</div>" +
      "</div>";
    renderStatus(draftMode ? "Nová poznámka — potvrďte Uložit nebo Zrušit" : (state.lastSavedAt ? ("Uloženo " + fmtDate(state.lastSavedAt)) : ""));
  }

  function render(){
    try{
      const ov = getOverlay();
      if (ov){
        ov.setAttribute("data-iu-notes-list-tab", state.listView === "trash" ? "trash" : "main");
        ov.setAttribute("data-iu-notes-draft-new", isDraftNewNoteActive() ? "1" : "0");
      }
    }catch{}
    renderList();
    renderDetail();
    renderListHeaderChrome();
    applyNotesMobileUiGuards();
  }

  function createNewAndSelect(){
    if (state.autosaveTimer){
      try{ clearTimeout(state.autosaveTimer); }catch{}
      state.autosaveTimer = null;
    }
    state.prevSelectedIdBeforeDraft = String(state.selectedId || "");
    const n = createEmptyNote();
    state.draftNewNote = sanitizeNote(n);
    state.selectedId = n.id;
    setMobileMode("detail");
    render();
    const bodyEl = document.getElementById("iuNoteBody");
    if (bodyEl) {
      try{ bodyEl.focus({ preventScroll: true }); bodyEl.select(); }catch{}
    }
  }

  function onInputChanged(){
    const note = getActiveNote();
    if (!note) return;
    const split = applyUnifiedBodyToNote(note, readUnifiedBodyFromDom());
    if (!split.ok && !isDraftNewNoteActive()) return;
    note.updatedAt = Date.now();
    if (isDraftNewNoteActive()){
      renderStatus("Nová poznámka — potvrďte Uložit nebo Zrušit");
      return;
    }
    scheduleAutosave();
    patchActiveListItemInDom();
  }

  /** Flush title/content from DOM into store immediately (avoids losing last keystrokes when leaving detail on narrow). */
  function flushNotesDetailToStoreSync(){
    try{
      if (isDraftNewNoteActive()) return;
      if (state.autosaveTimer){
        try{ clearTimeout(state.autosaveTimer); }catch{}
        state.autosaveTimer = null;
      }
      const note = getNoteById(state.selectedId);
      if (!note) return;
      const bodyEl = document.getElementById("iuNoteBody");
      if (!bodyEl) return;
      const split = applyUnifiedBodyToNote(note, bodyEl.value);
      if (!split.ok) return;
      note.updatedAt = Date.now();
      sortNotesInPlace(state.data.notes);
      void saveNotes(state.data);
    }catch{}
  }

  function normalizeTag(raw){
    const t = String(raw || "").trim();
    if (!t) return "";
    const base = t.startsWith("#") ? t : ("#" + t);
    return base.replace(/\s+/g, "");
  }

  function addTagToSelected(raw){
    const note = getActiveNote();
    if (!note) return;
    const next = normalizeTag(raw);
    if (!next) return;
    const list = Array.isArray(note.tags) ? note.tags.slice() : [];
    const has = list.some((x)=>foldCs(String(x || "")) === foldCs(next));
    if (!has) list.push(next);
    note.tags = list;
    note.updatedAt = Date.now();
    if (isDraftNewNoteActive()){
      renderDetail();
      return;
    }
    sortNotesInPlace(state.data.notes);
    void saveNotes(state.data).then(function (saveRes) {
      if (!saveRes.ok) {
        note.tags = note.tags.filter((x) => foldCs(String(x || "")) !== foldCs(next));
        renderStatus(saveNotesStatusMessage(saveRes.reason));
      }
      render();
    });
  }

  function togglePin(id){
    const note = getNoteById(id);
    if (!note) return;
    note.pinned = !note.pinned;
    note.updatedAt = Date.now();
    sortNotesInPlace(state.data.notes);
    void saveNotes(state.data).then(function (saveRes) {
      if (!saveRes.ok) {
        note.pinned = !note.pinned;
        renderStatus(saveNotesStatusMessage(saveRes.reason));
      }
      renderList();
    });
  }

  function bindUi(){
    if (state.bound) return;
    state.bound = true;

    document.addEventListener("click", (e)=>{
      const t = e.target;
      const mmNotesTrigger = t && t.closest ? t.closest(".iu-mmTopTool--notes") : null;
      const trigger = t && t.closest ? t.closest("[data-iu-notes-trigger]") : null;
      if (mmNotesTrigger || trigger){
        e.preventDefault();
        openOverlay(mmNotesTrigger || trigger);
      }
    });

    document.addEventListener("input", (e)=>{
      const t = e.target;
      if (!t || !t.id) return;
      const ov = getOverlay();
      if (!ov || ov.hidden) return;
      if (t.id === "iuNoteBody"){
        onInputChanged();
        return;
      }
      if (t.id === "iuNotesSearch"){
        const next = String(t.value || "");
        if (state.searchTimer) { try{ clearTimeout(state.searchTimer); }catch{} state.searchTimer = null; }
        state.searchTimer = setTimeout(() => {
          state.searchTimer = null;
          state.searchQuery = next;
          renderList();
        }, 200);
        return;
      }

      if (t.id === "iuNoteTagInput"){
        const val = String(t.value || "");
        if (/[,\n]/.test(val) || /\s$/.test(val)){
          addTagToSelected(val.replace(/[,\n]/g, "").trim());
          t.value = "";
        }
        return;
      }
    });

    document.addEventListener("keydown", (e)=>{
      const t = e.target;
      if (!t || t.id !== "iuNoteTagInput") return;
      const ov = getOverlay();
      if (!ov || ov.hidden) return;
      if (e.key === "Enter"){
        e.preventDefault();
        addTagToSelected(t.value);
        t.value = "";
      }
    });
  }

  function init(){
    if (state.inited) return;
    state.inited = true;
    ensureStyles();
    /* P1 perf (overlay cluster lazy mount): overlay DOM is built on first
       openOverlay() — not at startup. All UI handlers are document-delegated
       and overlay-scoped handlers attach inside mountOverlay(). */
    loadNotes();
    sortNotesInPlace(state.data.notes);
    if (!state.selectedId){
      const first = searchNotes(state.searchQuery)[0];
      if (first && !isNotesNarrowViewport()) state.selectedId = first.id;
    }
    bindUi();

    try {
      window.addEventListener("iu-local-store-changed", function (ev) {
        try {
          if (!ev || !ev.detail || ev.detail.key !== STORE_KEY) return;
          loadNotes();
          if (state.overlayMounted) render();
        } catch (_) {}
      });
    } catch (_) {}

    try {
      window.addEventListener("iu-vault-hydrated", function () {
        try {
          loadNotes();
          if (state.overlayMounted) render();
        } catch (_) {}
      });
    } catch (_) {}

    try {
      queueMicrotask(function () {
        try {
          loadNotes();
          if (state.overlayMounted) render();
        } catch (_) {}
      });
    } catch (_) {}

    window.iuNotesStorage = {
      storeKey: STORE_KEY,
      schemaVersion: SCHEMA_VERSION,
      loadNotes: function(){ return loadNotes(); },
      saveNotes: function(data){ return saveNotes(data); },
      createEmptyNote: function(){ return createEmptyNote(); },
      getNoteById: function(id){ return getNoteById(id); },
      searchNotes: function(q){ return searchNotes(q); },
      noteMergeLegacyToBody: noteMergeLegacyToBody,
      noteSplitUnifiedBody: noteSplitUnifiedBody,
      noteCardHeadingAndPreview: noteCardHeadingAndPreview,
      noteBodyFromNote: noteBodyFromNote
    };
    window.iuNotesService = {
      openOverlay: function(originEl){ openOverlay(originEl || document.activeElement); },
      closeOverlay: function(){ closeOverlay(); },
      notesGetSnapshot: function(){ return (state.data && Array.isArray(state.data.notes)) ? state.data.notes.slice() : []; },
      notesSearch: function(q){ return searchNotes(q); },
      notesSaveSilverDraft: async function(opts){
        try{
          loadNotes();
          const o = opts && typeof opts === "object" ? opts : {};
          const text = String(o.text ?? "");
          const split = noteSplitUnifiedBody(text);
          if (!split.ok) return { ok: false, reason: "empty" };
          const n = createEmptyNote();
          n.title = split.title;
          n.content = split.content;
          if (Number.isFinite(Number(o.createdTs))) n.createdAt = Number(o.createdTs);
          if (Number.isFinite(Number(o.createdTs))) n.updatedAt = Number(o.createdTs);
          const noteId = n.id;
          state.data.notes.unshift(sanitizeNote(n));
          sortNotesInPlace(state.data.notes);
          const saveRes = await saveNotes(state.data);
          if (!saveRes.ok) {
            state.data.notes = state.data.notes.filter((x) => String(x.id) !== String(noteId));
            return { ok: false, reason: saveRes.reason };
          }
          try {
            loadNotes();
            if (state.overlayMounted) render();
          } catch (_) {}
          return { ok: true, note: n };
        }catch(err){
          return { ok: false, reason: String(err && err.message ? err.message : err) };
        }
      },
      notesCreateFromSilver: async function(payload){
        try{
          loadNotes();
          const o = payload && typeof payload === "object" ? payload : {};
          let title = String(o.title || "").trim().slice(0, MAX_TITLE);
          const lines = [];
          if (o.date) lines.push("Datum: " + String(o.date));
          if (o.time) lines.push("Čas: " + String(o.time));
          if (o.note) lines.push(String(o.note));
          if (o.location) lines.push("Místo: " + String(o.location));
          let contentPart = lines.join("\n").trim().slice(0, MAX_CONTENT);
          if (!contentPart && o.rawInput) contentPart = String(o.rawInput).trim().slice(0, MAX_CONTENT);
          let unified = "";
          if (!title && contentPart) unified = contentPart;
          else if (!title && !contentPart) title = "Poznámka";
          if (!unified) unified = noteMergeLegacyToBody(title, contentPart);
          const split = noteSplitUnifiedBody(unified);
          if (!split.ok) return { ok: false, reason: "empty" };
          const n = createEmptyNote();
          n.title = split.title;
          n.content = split.content;
          const tagList = Array.isArray(n.tags) ? n.tags.slice() : [];
          if (!tagList.some((x)=>String(x || "").toLowerCase() === "#silver")) tagList.push("#silver");
          n.tags = tagList;
          const noteId = n.id;
          state.data.notes.unshift(sanitizeNote(n));
          sortNotesInPlace(state.data.notes);
          const saveRes = await saveNotes(state.data);
          if (!saveRes.ok) {
            state.data.notes = state.data.notes.filter((x) => String(x.id) !== String(noteId));
            return { ok: false, reason: saveRes.reason };
          }
          try {
            loadNotes();
            if (state.overlayMounted) render();
          } catch (_) {}
          return { ok: true, note: n };
        }catch(err){
          return { ok: false, reason: String(err && err.message ? err.message : err) };
        }
      }
    };
  }

  function bootNotesOverlay() {
    return Promise.resolve().then(function () {
      init();
      try { window.__iuNotesOverlayInited = 1; } catch (_) {}
      try { window.__iuNotesOverlayBooting = 0; } catch (_) {}
    });
  }
  var bootPromise =
    document.readyState === "loading"
      ? new Promise(function (resolve, reject) {
          document.addEventListener("DOMContentLoaded", function () {
            bootNotesOverlay().then(resolve, reject);
          });
        })
      : bootNotesOverlay();
  try { window.__iuNotesOverlayBootPromise = bootPromise; } catch (_) {}
})();
    return window.__iuNotesOverlayBootPromise || Promise.resolve();
  })().catch(function (err) {
    __iuNotesModuleBootPromise = null;
    throw err;
  });
  return __iuNotesModuleBootPromise;
}
