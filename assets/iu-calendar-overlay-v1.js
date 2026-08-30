/* IU calendar overlay — extracted from app.js (perf stage-4). Loaded via dynamic import. */
import { ensureLocalDataProtectionBeforeSave } from "./iu-local-data-protection.js";

var __iuCalendarModuleBootPromise = null;

export function initIuCalendarOverlay() {
  try {
    if (
      typeof window !== "undefined" &&
      window.__iuCalendarOverlayInited &&
      window.iuCalendarService &&
      !window.iuCalendarService.__iuCalendarLazyStub
    ) {
      return Promise.resolve();
    }
  } catch (_) {}
  if (__iuCalendarModuleBootPromise) return __iuCalendarModuleBootPromise;
  try {
    window.__iuCalendarOverlayBooting = 1;
  } catch (_) {}
  __iuCalendarModuleBootPromise = (function () {
// === Calendar overlay module (isolated, local-first, Silver API) ===
(function(){
  "use strict";

  const CAL_NS = "iu.calendar";
  const CAL_STYLE_ID = "iu-calendar-overlay-styles";
  const CAL_MOBILE_BOTTOM_CLEAR_ID = "iu-calendar-overlay-mobile-bottom-clearance";
  const CAL_MONTH_FAB_STYLE_ID = "iu-calendar-month-fab-p0";
  const CAL_MONTH_FAB_CSS =
    "#iuCalendarOverlay .iu-calendarOverlay__toolbar{flex:0 0 auto}#iuCalendarOverlay .iu-calendarOverlay__viewRoot{flex:1 1 auto;min-height:0;min-width:0;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box}#iuCalendarOverlay .iu-calendarOverlay__viewRoot.iu-calendarOverlay__viewRoot--monthFabPad{padding-bottom:72px}#iuCalMonthActionBar.iu-calMonthActionBar{display:flex;flex:0 0 auto;align-self:stretch;gap:10px;margin:0 12px calc(10px + env(safe-area-inset-bottom,0px)) 12px;max-width:calc(100% - 24px);box-sizing:border-box;z-index:3}#iuCalMonthActionBar.iu-calMonthActionBar--yearOnly{justify-content:flex-end}#iuCalMonthActionBar .iu-calMonthFab,#iuCalMonthActionBar .iu-calSearchFab{flex:1 1 0;min-width:0;margin:0;padding:11px 14px;max-width:none;box-sizing:border-box;border-radius:999px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;touch-action:manipulation;min-height:44px;line-height:1.2}#iuCalMonthActionBar .iu-calSearchFab{border:1px solid rgba(30,58,92,.22);background:linear-gradient(180deg,#f8fafc,#eef2f7);color:#1e3a5c;box-shadow:0 2px 10px rgba(15,23,42,.08)}#iuCalMonthActionBar .iu-calSearchFab:hover{filter:brightness(1.02)}#iuCalMonthActionBar .iu-calMonthFab{border:1px solid #15803d;background:linear-gradient(180deg,#16a34a,#15803d);color:#fff;box-shadow:0 2px 10px rgba(22,163,74,.28)}#iuCalMonthActionBar .iu-calMonthFab:hover{filter:brightness(1.03)}#iuCalMonthQuickAddBtn.iu-calMonthFab{flex:0 0 auto;align-self:flex-end;margin:0 14px calc(10px + env(safe-area-inset-bottom,0px)) 0;padding:10px 16px;max-width:calc(100% - 28px);box-sizing:border-box;border-radius:999px;border:1px solid #15803d;background:linear-gradient(180deg,#16a34a,#15803d);color:#fff;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer;box-shadow:0 2px 10px rgba(22,163,74,.28);z-index:3;white-space:nowrap;-webkit-tap-highlight-color:transparent;touch-action:manipulation}#iuCalMonthQuickAddBtn.iu-calMonthFab:hover{filter:brightness(1.03)}#iuCalMonthQuickAddBtn.iu-calMonthFab:focus-visible{outline:2px solid #15803d;outline-offset:2px}@media(max-width:380px){#iuCalMonthActionBar .iu-calMonthFab .iu-calMonthFab__text,#iuCalMonthActionBar .iu-calSearchFab .iu-calSearchFab__text{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}#iuCalMonthQuickAddBtn.iu-calMonthFab .iu-calMonthFab__text{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}#iuCalMonthQuickAddBtn.iu-calMonthFab{min-width:48px;padding:10px 14px}}#iuCalendarOverlay .iu-calMonthStack{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0}#iuCalendarOverlay .iu-calMonthInline{flex:0 0 auto;padding:12px 14px 16px;border-top:1px solid #d6dfec;background:#fff;box-sizing:border-box}#iuCalendarOverlay .iu-calInline__dateRow{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin:0 0 10px;max-width:100%;box-sizing:border-box}#iuCalendarOverlay .iu-calInline__dateRow .iu-calInline__dateInput{flex:0 1 auto;min-width:0;max-width:100%}#iuCalendarOverlay .iu-calInline__weekday{font-weight:600;font-size:15px;color:#1e293b;flex:1 1 auto;min-width:0}@media(max-width:1024px){#iuCalendarOverlay.iu-calendarOverlay--premiumMob .iu-calendarOverlay__main{overflow:hidden!important;display:flex!important;flex-direction:column!important}}#iuCalendarOverlay .iu-calendarOverlay__main{position:relative;min-height:0;overflow:hidden;box-sizing:border-box}";
  const CAL_PREMIUM_UPDATE_STYLE_ID = "iu-calendar-premium-update-v1";
  const CAL_PREMIUM_UPDATE_CSS =
    ".iu-calAllDayToggleRow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;padding:10px 12px;border-radius:12px;background:rgba(236,253,245,.65);border:1px solid rgba(21,128,61,.18);box-sizing:border-box}" +
    ".iu-calAllDayToggleRow__label{font-size:14px;font-weight:600;color:#14532d;flex:1 1 auto;min-width:0}" +
    ".iu-calAllDaySwitch{position:relative;width:48px;height:28px;flex:0 0 auto;border:none;padding:0;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
    ".iu-calAllDaySwitch__track{display:block;width:48px;height:28px;border-radius:999px;background:#cbd5e1;transition:background .22s ease,box-shadow .22s ease;box-shadow:inset 0 1px 2px rgba(15,23,42,.12)}" +
    ".iu-calAllDaySwitch__thumb{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(15,23,42,.18);transition:transform .22s ease}" +
    ".iu-calAllDaySwitch.is-on .iu-calAllDaySwitch__track{background:linear-gradient(180deg,#22c55e,#16a34a);box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}" +
    ".iu-calAllDaySwitch.is-on .iu-calAllDaySwitch__thumb{transform:translateX(20px)}" +
    ".iu-calAllDaySwitch:focus-visible{outline:2px solid #16a34a;outline-offset:2px;border-radius:999px}" +
    ".iu-calAllDaySection{margin:0 0 10px;padding:0;box-sizing:border-box}" +
    ".iu-calAllDayDraft{margin:0 0 10px;padding:0;box-sizing:border-box}" +
    ".iu-calAllDaySection__head{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:rgba(20,83,45,.72);margin:0 0 6px;padding:0 4px}" +
    ".iu-calAllDaySection__list{display:grid;gap:6px}" +
    ".iu-calAllDayChip{display:flex;align-items:flex-start;gap:8px;width:100%;margin:0;padding:10px 12px;border-radius:12px;border:1px solid rgba(21,128,61,.2);background:linear-gradient(180deg,rgba(236,253,245,.95),#fff);color:#0f172a;text-align:left;cursor:pointer;box-sizing:border-box;box-shadow:0 2px 8px rgba(21,128,61,.08);-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
    ".iu-calAllDayChip__title{font-size:14px;font-weight:700;line-height:1.3;word-break:break-word;overflow-wrap:anywhere}" +
    ".iu-calDayPinnedBlock{flex:0 0 auto;box-sizing:border-box}" +
    ".iu-calInline__notice{margin:0 0 8px;padding:10px 12px;border-radius:12px;background:rgba(254,226,226,.95);border:1px solid rgba(185,28,28,.35);color:#991b1b;font-size:14px;font-weight:700;line-height:1.35;word-break:break-word;overflow-wrap:anywhere}" +
    ".iu-calAllDayChip:active{transform:translateY(1px)}" +
    ".iu-calBottomSheet{position:fixed;inset:0;z-index:10150;display:flex;flex-direction:column;justify-content:flex-end;pointer-events:none}" +
    ".iu-calBottomSheet:not([hidden]){pointer-events:auto}" +
    ".iu-calBottomSheet__scrim{position:absolute;inset:0;background:rgba(8,14,22,.42);opacity:0;transition:opacity .24s ease}" +
    ".iu-calBottomSheet:not([hidden]) .iu-calBottomSheet__scrim{opacity:1}" +
    ".iu-calBottomSheet__panel{position:relative;z-index:1;width:100%;max-height:min(88vh,720px);max-height:min(88dvh,720px);margin:0;padding:0 0 calc(12px + env(safe-area-inset-bottom,0px));border-radius:18px 18px 0 0;background:linear-gradient(180deg,#f8fafc 0%,#fff 28%);box-shadow:0 -8px 32px rgba(15,23,42,.18);transform:translateY(105%);transition:transform .28s cubic-bezier(.22,1,.36,1);display:flex;flex-direction:column;min-height:0;box-sizing:border-box}" +
    ".iu-calBottomSheet:not([hidden]) .iu-calBottomSheet__panel{transform:translateY(0)}" +
    ".iu-calBottomSheet__handle{width:40px;height:4px;border-radius:999px;background:rgba(15,23,42,.16);margin:8px auto 4px;flex:0 0 auto}" +
    ".iu-calBottomSheet__head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 14px 8px;flex:0 0 auto}" +
    ".iu-calBottomSheet__title{margin:0;font-size:16px;font-weight:800;color:#0f172a;letter-spacing:-.02em}" +
    ".iu-calBottomSheet__close{width:38px;height:38px;border:0;border-radius:10px;background:#eef2f7;color:#0f172a;font-size:24px;line-height:1;cursor:pointer;flex:0 0 auto;touch-action:manipulation}" +
    ".iu-calBottomSheet__scroll{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 14px 8px;box-sizing:border-box}" +
    ".iu-calSearchOverlay{position:fixed;inset:0;z-index:10160;display:flex;align-items:stretch;justify-content:center;background:rgba(248,250,252,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}" +
    ".iu-calSearchOverlay[hidden]{display:none!important}" +
    ".iu-calSearchOverlay__panel{width:100%;max-width:960px;height:100%;display:flex;flex-direction:column;min-height:0;box-sizing:border-box;padding:calc(12px + env(safe-area-inset-top,0px)) 12px calc(12px + env(safe-area-inset-bottom,0px))}" +
    ".iu-calSearchOverlay__head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex:0 0 auto;margin-bottom:10px}" +
    ".iu-calSearchOverlay__title{margin:0;font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-.02em}" +
    ".iu-calSearchOverlay__form{display:flex;gap:8px;flex:0 0 auto;margin-bottom:8px;flex-wrap:wrap}" +
    ".iu-calSearchOverlay__input{flex:1 1 180px;min-width:0;border:1px solid #cbd5e1;border-radius:12px;padding:12px 14px;font-size:16px;background:#fff;box-sizing:border-box}" +
    ".iu-calSearchOverlay__submit{flex:0 0 auto;border:0;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:700;color:#fff;background:linear-gradient(180deg,#15803d,#166534);cursor:pointer;touch-action:manipulation;min-height:48px}" +
    ".iu-calSearchOverlay__count{flex:0 0 auto;font-size:13px;font-weight:600;color:rgba(15,23,42,.65);margin:0 0 8px}" +
    ".iu-calSearchOverlay__empty{margin:12px 0;padding:16px;border-radius:12px;background:#fff;border:1px dashed #cbd5e1;color:rgba(15,23,42,.55);text-align:center;font-size:14px}" +
    ".iu-calSearchOverlay__resultsWrap{flex:1 1 auto;min-height:0;overflow:hidden;border:1px solid #e2e8f0;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.06);display:flex;flex-direction:column}" +
    ".iu-calSearchOverlay__tableScroll{flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}" +
    ".iu-calSearchTable{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}" +
    ".iu-calSearchTable thead th{position:sticky;top:0;z-index:2;background:linear-gradient(180deg,#f1f5f9,#e2e8f0);color:#1e293b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:10px 8px;border-bottom:1px solid #cbd5e1;text-align:left}" +
    ".iu-calSearchTable tbody td{padding:10px 8px;border-bottom:1px solid #eef2f7;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;line-height:1.35;color:#0f172a}" +
    ".iu-calSearchTable tbody tr{cursor:pointer;transition:background .12s ease}" +
    ".iu-calSearchTable tbody tr:hover,.iu-calSearchTable tbody tr:active{background:rgba(236,253,245,.75)}" +
    ".iu-calSearchTable .col-num{width:36px;text-align:center;font-weight:700;color:rgba(15,23,42,.55)}" +
    ".iu-calSearchTable .col-date{width:88px}.iu-calSearchTable .col-day{width:36px}.iu-calSearchTable .col-time{width:72px}.iu-calSearchTable .col-event{width:auto}" +
    "#iuCalendarOverlay .iu-calendarOverlay__viewRoot[data-view=year],#iuCalendarDayOverlay .iu-calendar-day-content{overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;min-height:0!important}" +
    "#iuCalendarOverlay .iu-calendarOverlay__viewRoot[data-view=year] .iu-calYear{min-height:min(100%,720px);padding-bottom:16px}" +
    ".iu-calInline__timeBtn.is-hidden{display:none!important}";
  const CAL_PREMIUM_FIX_V2_STYLE_ID = "iu-calendar-premium-fix-v2";
  const CAL_PREMIUM_FIX_V2_CSS =
    "#iuCalendarDayOverlay.iu-calendar-day-overlay{touch-action:none;overscroll-behavior:none}" +
    "#iuCalendarDayOverlay .iu-calendar-day-content{touch-action:pan-y!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important}" +
    ".iu-calInline.iu-calInline--premiumV2{display:flex;flex-direction:column;gap:14px;padding:14px 16px 18px;border-radius:16px;border:1px solid rgba(21,128,61,.16);background:#fff;box-shadow:0 4px 18px rgba(15,23,42,.06);box-sizing:border-box;max-width:100%}" +
    ".iu-calInline--premiumV2 .iu-calInline__field{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box}" +
    ".iu-calInline--premiumV2 .iu-calInline__field.is-hidden{display:none!important}" +
    ".iu-calInline--premiumV2 .iu-calInline__label{font-size:13px;font-weight:700;color:rgba(15,23,42,.62);letter-spacing:.02em;text-transform:uppercase}" +
    ".iu-calInline--premiumV2 .iu-calInline__inp,.iu-calInline--premiumV2 .iu-calInline__txt,.iu-calInline--premiumV2 .iu-calInline__dateInput,.iu-calInline--premiumV2 .iu-calInline__timeBtn{width:100%;max-width:100%;box-sizing:border-box;font-size:16px!important;line-height:1.35;-webkit-text-size-adjust:100%}" +
    ".iu-calInline--premiumV2 .iu-calInline__inp,.iu-calInline--premiumV2 .iu-calInline__dateInput{min-height:52px;padding:14px 16px;border-radius:14px;border:1px solid rgba(21,128,61,.22);background:#fff;color:#0f172a;box-shadow:0 1px 0 rgba(255,255,255,.8) inset}" +
    ".iu-calInline--premiumV2 .iu-calInline__txt{min-height:128px;padding:14px 16px;border-radius:14px;border:1px solid rgba(21,128,61,.22);background:#fff;color:#0f172a;resize:vertical;font-family:inherit}" +
    ".iu-calInline--premiumV2 .iu-calInline__timeBtn{min-height:52px;padding:14px 16px;border-radius:14px;border:1px solid rgba(21,128,61,.28);background:linear-gradient(180deg,#ecfdf5,#f0fdf4);color:#14532d;font-weight:800;text-align:left;cursor:pointer;touch-action:manipulation}" +
    ".iu-calInline--premiumV2 .iu-calAllDayToggleRow{margin:0;padding:12px 14px;border-radius:14px}" +
    ".iu-calAllDayToggleRow__label{display:flex;flex-direction:column;gap:1px;line-height:1.2}" +
    ".iu-calAllDayToggleRow__line{display:block;font-size:14px;font-weight:700;color:#14532d}" +
    ".iu-calInline--premiumV2 .iu-calInline__actions{display:flex;flex-direction:column;gap:10px;margin-top:4px;width:100%}" +
    ".iu-calInline--premiumV2 .iu-calInline__btn{width:100%;min-height:52px;padding:14px 18px;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;touch-action:manipulation;box-sizing:border-box;letter-spacing:.01em}" +
    ".iu-calInline--premiumV2 .iu-calInline__btn--save{border:1px solid #14532d;background:linear-gradient(180deg,#15803d,#166534);color:#fff;box-shadow:0 4px 14px rgba(22,101,52,.22)}" +
    ".iu-calInline--premiumV2 .iu-calInline__btn--cancel{border:1px solid rgba(100,116,139,.45);background:#f8fafc;color:#334155}" +
    ".iu-calInline--premiumV2 .iu-calInline__btn--delete{border:1px solid rgba(185,28,28,.35);background:#fff;color:#b91c1c}" +
    /* P0 PC: must sit above #iuCalendarOverlay under body.iu-myinfouzel-open (z-index 12100). */
    ".iu-calDeleteConfirm{position:fixed;inset:0;z-index:12350;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:rgba(8,14,22,.45);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}" +
    ".iu-calDeleteConfirm[hidden]{display:none!important}" +
    "body.iu-myinfouzel-open #iuCalDeleteConfirm:not([hidden]),body.iu-calendarOverlay-open #iuCalDeleteConfirm:not([hidden]){z-index:12350!important}" +
    ".iu-calDeleteConfirm__panel{width:100%;max-width:400px;padding:22px 20px;border-radius:18px;background:#fff;box-shadow:0 16px 48px rgba(15,23,42,.18);box-sizing:border-box;display:flex;flex-direction:column;gap:16px}" +
    ".iu-calDeleteConfirm__text{margin:0;font-size:17px;font-weight:700;line-height:1.4;color:#0f172a;text-align:center}" +
    ".iu-calDeleteConfirm__actions{display:flex;flex-direction:column;gap:10px;width:100%}" +
    ".iu-calDeleteConfirm__btn{width:100%;min-height:52px;padding:14px 18px;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;touch-action:manipulation;box-sizing:border-box}" +
    ".iu-calDeleteConfirm__btn--yes{border:1px solid #991b1b;background:linear-gradient(180deg,#dc2626,#b91c1c);color:#fff}" +
    ".iu-calDeleteConfirm__btn--cancel{border:1px solid rgba(100,116,139,.45);background:#f8fafc;color:#334155}" +
    "#iuCalEventBottomSheet .iu-calBottomSheet__scroll{padding:0 16px 12px}" +
    "#iuCalendarOverlay .iu-calendarOverlay__form input,#iuCalendarOverlay .iu-calendarOverlay__form textarea,#iuCalendarOverlay .iu-calendarOverlay__form select{font-size:16px!important;min-height:44px}" +
    ".iuSilverDraftAllDayLine{display:block;line-height:1.25;font-size:14px;font-weight:700;color:#1f3a5f}";
  const CAL_PREMIUM_FIX_V4_STYLE_ID = "iu-calendar-premium-fix-v4";
  const CAL_PREMIUM_FIX_V4_CSS =
    "#iuCalEventBottomSheet .iu-calBottomSheet__handle{margin:6px auto 2px}" +
    "#iuCalEventBottomSheet .iu-calBottomSheet__head{padding:2px 12px 4px}" +
    "#iuCalEventBottomSheet .iu-calBottomSheet__scroll{padding:0 12px 6px}" +
    "#iuCalEventBottomSheet .iu-calInline.iu-calInline--premiumV2{display:flex;flex-direction:column;gap:7px;padding:8px 10px 10px;border-radius:14px;box-shadow:0 2px 12px rgba(15,23,42,.05)}" +
    "#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calInline__field{gap:3px}" +
    "#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calInline__label{font-size:11px;line-height:1.2;letter-spacing:.03em}" +
    "#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calInline__inp,#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calInline__dateInput{min-height:44px;padding:10px 12px;border-radius:12px}" +
    "#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calInline__txt{min-height:56px;padding:10px 12px;border-radius:12px;line-height:1.35}" +
    "#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calInline__timeBtn{min-height:44px;padding:10px 12px;border-radius:12px}" +
    "#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calAllDayToggleRow{padding:8px 10px;border-radius:12px;margin:0}" +
    "#iuCalEventBottomSheet .iu-calAllDayToggleRow__line{font-size:13px;line-height:1.15}" +
    "#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calInline__actions{gap:6px;margin-top:0}" +
    "#iuCalEventBottomSheet .iu-calInline--premiumV2 .iu-calInline__btn{min-height:44px;padding:11px 14px;border-radius:12px;font-size:15px}";
  const CAL_PREMIUM_FIX_V6_STYLE_ID = "iu-calendar-premium-fix-v6";
  const CAL_PREMIUM_FIX_V6_CSS =
    "@media (max-width:1024px){" +
    "#iuCalEventBottomSheet:not([hidden]) .iu-calBottomSheet__panel{" +
    "height:auto!important;" +
    "max-height:calc(100dvh - var(--bottom-nav-height, calc(56px + env(safe-area-inset-bottom,0px) + 48px)) - var(--iu-calendar-action-bar-nav-gap,10px) - env(safe-area-inset-top,0px) - 8px)!important;" +
    "margin-bottom:calc(var(--bottom-nav-height, calc(56px + env(safe-area-inset-bottom,0px) + 48px)) + var(--iu-calendar-action-bar-nav-gap,10px))!important;" +
    "padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))!important;" +
    "flex:0 0 auto!important;" +
    "}" +
    "#iuCalEventBottomSheet:not([hidden]) .iu-calBottomSheet__scroll{" +
    "flex:0 1 auto!important;" +
    "min-height:0!important;" +
    "max-height:calc(100dvh - var(--bottom-nav-height, calc(56px + env(safe-area-inset-bottom,0px) + 48px)) - var(--iu-calendar-action-bar-nav-gap,10px) - env(safe-area-inset-top,0px) - 52px)!important;" +
    "overflow-x:hidden!important;" +
    "overflow-y:auto!important;" +
    "-webkit-overflow-scrolling:touch;" +
    "overscroll-behavior-y:contain;" +
    "padding-bottom:6px!important;" +
    "scroll-padding-bottom:0!important;" +
    "}" +
    /* P0 value-column contract: Datum/Čas share Název/Adresa/Poznámka right edge.
       Native date/time keep a large intrinsic min-size; clamp control + WebKit edit parts
       and force the field to minmax(0,1fr) so used width cannot exceed the value column. */
    ".iu-calInline--premiumV2{" +
    "min-width:0!important;" +
    "max-width:100%!important;" +
    "width:100%!important;" +
    "box-sizing:border-box!important;" +
    "}" +
    ".iu-calInline--premiumV2 .iu-calInline__field{" +
    "display:grid!important;" +
    "grid-template-columns:minmax(0,1fr)!important;" +
    "justify-items:stretch!important;" +
    "min-width:0!important;" +
    "max-width:100%!important;" +
    "width:100%!important;" +
    "box-sizing:border-box!important;" +
    "}" +
    ".iu-calInline--premiumV2 .iu-calInline__inp," +
    ".iu-calInline--premiumV2 .iu-calInline__txt," +
    ".iu-calInline--premiumV2 .iu-calInline__dateInput," +
    ".iu-calInline--premiumV2 input[type='date']," +
    ".iu-calInline--premiumV2 input[type='time']," +
    ".iu-calInline--premiumV2 .iu-calInline__timeBtn{" +
    "display:block!important;" +
    "width:100%!important;" +
    "max-width:100%!important;" +
    "min-width:0!important;" +
    "min-inline-size:0!important;" +
    "max-inline-size:100%!important;" +
    "justify-self:stretch!important;" +
    "box-sizing:border-box!important;" +
    "}" +
    ".iu-calInline--premiumV2 .iu-calInline__dateInput::-webkit-datetime-edit," +
    ".iu-calInline--premiumV2 input[type='date']::-webkit-datetime-edit," +
    ".iu-calInline--premiumV2 input[type='time']::-webkit-datetime-edit," +
    ".iu-calInline--premiumV2 .iu-calInline__dateInput::-webkit-datetime-edit-fields-wrapper," +
    ".iu-calInline--premiumV2 input[type='date']::-webkit-datetime-edit-fields-wrapper," +
    ".iu-calInline--premiumV2 input[type='time']::-webkit-datetime-edit-fields-wrapper," +
    ".iu-calInline--premiumV2 .iu-calInline__dateInput::-webkit-date-and-time-value," +
    ".iu-calInline--premiumV2 input[type='date']::-webkit-date-and-time-value," +
    ".iu-calInline--premiumV2 input[type='time']::-webkit-date-and-time-value{" +
    "min-width:0!important;" +
    "max-width:100%!important;" +
    "}" +
    ".iu-calInline--premiumV2 .iu-calInline__dateInput::-webkit-calendar-picker-indicator," +
    ".iu-calInline--premiumV2 input[type='date']::-webkit-calendar-picker-indicator," +
    ".iu-calInline--premiumV2 input[type='time']::-webkit-calendar-picker-indicator{" +
    "flex-shrink:0;" +
    "}" +
    "}"
    ;
  const calScrollLock = {
    saved: false,
    bodyOverflow: "",
    htmlOverflow: "",
    bodyTouchAction: "",
    htmlTouchAction: ""
  };
  const CAL_STYLE_TEXT = ".iu-calendarOverlay{position:fixed;inset:0;z-index:10035;display:none;align-items:center;justify-content:center}.iu-calendarOverlay:not([hidden]){display:flex}.iu-calendarOverlay__backdrop{position:absolute;inset:0;background:rgba(8,14,22,.78)}.iu-calendarOverlay__dialog{position:relative;z-index:1;width:calc(100vw - 28px);max-width:none;height:min(88vh,860px);overflow:hidden;border-radius:12px;background:#f7f9fc;box-shadow:0 20px 52px rgba(7,12,19,.35);display:grid;grid-template-rows:auto 1fr}.iu-calendarOverlay__header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #d7dfeb;background:#fff;min-width:0}.iu-calendarOverlay__headerRight{display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto}.iu-calendarOverlay__controls{display:flex;align-items:center;gap:8px;min-width:0}.iu-calendarOverlay__toolbar,.iu-calendarOverlay__formActions{display:flex;align-items:center;gap:8px}.iu-calendarOverlay__viewBtn,.iu-calendarOverlay__close,.iu-calendarOverlay__eventBtn{border:1px solid #c6d2e5;border-radius:8px;background:#eef3fb;color:#203a59;padding:8px 10px;font-size:13px}.iu-calendarOverlay__close{width:38px;height:38px;border:0;font-size:24px;line-height:1;background:#e8eef7;padding:0;touch-action:manipulation;flex-shrink:0}.iu-calendarOverlay__viewBtn.is-active{background:#203a59;color:#fff;border-color:#203a59}.iu-calendarOverlay__body{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0;height:100%}.iu-calendarOverlay__main,.iu-calendarOverlay__side{min-height:0;padding:12px}.iu-calendarOverlay__main{display:flex;flex-direction:column;gap:10px}.iu-calendarOverlay__side{border-left:1px solid #d7dfeb;background:#fff;overflow:auto}.iu-calendarOverlay__toolbar{margin-bottom:0;flex-wrap:wrap}.iu-calendarOverlay__toolbar strong{flex:1}.iu-calendarOverlay__viewRoot{border:1px solid #d2dcea;border-radius:10px;background:#fff;min-height:320px;height:calc(100% - 42px);overflow:auto}.iu-calendarOverlay__form{display:grid;gap:10px}.iu-calendarOverlay__form label{display:grid;gap:4px;font-size:13px;color:#234064}.iu-calendarOverlay__form input,.iu-calendarOverlay__form textarea,.iu-calendarOverlay__form select{width:100%;border:1px solid #c9d7ea;border-radius:8px;padding:10px;font-size:14px}.iu-calendarOverlay__formActions{flex-wrap:wrap}.iu-calendarOverlay__formActions button{flex:1 1 0;min-height:44px;touch-action:manipulation}.iu-calendarOverlay__msg{min-height:16px;font-size:12px;color:#2a4568}.iu-calendarOverlay__eventList{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px}.iu-calendarOverlay__eventBtn{width:100%;text-align:left;background:#f4f7fc;border-color:#d0daea;padding:10px}.iu-calGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;padding:8px}.iu-calDayCell{border:1px solid #d6dfec;border-radius:8px;min-height:88px;padding:6px;background:#fff;font-size:12px;display:block;text-align:left}.iu-calDayCell.is-out{opacity:.45}.iu-calDayCell.is-weekend{background:#f7fbff}.iu-calDayCell.is-today{border-color:#2f9cf4;box-shadow:0 0 0 1px #2f9cf4 inset}.iu-calDayCell.is-selected{border-color:#1f3a5f;box-shadow:0 0 0 2px rgba(31,58,95,.26) inset;background:#eef4ff}.iu-calDayCell.is-holiday{background:#fff8f0}.iu-calDayCell__events{margin-top:6px;display:grid;gap:3px}.iu-calEventDot{border-radius:6px;background:#e7eef9;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.iu-calYear{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:8px}.iu-calYearMonth,.iu-calTimelineItem{border:1px solid #d6dfec;border-radius:8px;padding:10px;background:#fff}.iu-calTimeline{padding:8px;display:grid;gap:8px}.iu-calTimelineItem{display:grid;gap:8px}@media (min-width:1024px){.iu-calendarOverlay__dialog{width:calc(100vw - 28px);max-width:none}.iu-calendarOverlay__main{min-width:0}.iu-calendarOverlay__viewRoot{width:100%}.iu-calGrid{width:100%;box-sizing:border-box}}body.iu-calendarOverlay-open{overflow:hidden!important}@media (max-width:900px){.iu-calendarOverlay{align-items:stretch;justify-content:stretch;overflow-y:auto;-webkit-overflow-scrolling:touch;background:#f7f9fc}.iu-calendarOverlay__backdrop{position:fixed;inset:0;background:rgba(8,14,22,.85)}.iu-calendarOverlay__dialog{width:100vw;min-height:100dvh;height:auto;max-height:none;border-radius:0;overflow:visible;display:flex;flex-direction:column;box-shadow:none;background:#f7f9fc}.iu-calendarOverlay__header{position:relative;top:auto;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:4px;flex-wrap:nowrap}.iu-calendarOverlay__header h2{margin:0;font-size:15px;line-height:1;white-space:nowrap;flex:0 0 auto;display:flex;align-items:center;min-height:34px}.iu-calendarOverlay__headerRight{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:4px}.iu-calendarOverlay__controls{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:4px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.iu-calendarOverlay__controls::-webkit-scrollbar{display:none}.iu-calendarOverlay__viewBtn{min-height:34px;padding:6px 6px;font-size:11px;line-height:1;white-space:nowrap;flex:0 0 auto}.iu-calendarOverlay__close{flex-shrink:0;min-width:34px;min-height:34px;width:34px;height:34px;flex:0 0 auto}.iu-calendarOverlay__body{display:flex;flex-direction:column;height:auto;min-height:0;overflow:visible!important;flex:1 1 auto;background:#fff}.iu-calendarOverlay__main,.iu-calendarOverlay__side,.iu-calendarOverlay__viewRoot{height:auto!important;max-height:none!important;overflow:visible!important}.iu-calendarOverlay__main{padding:10px 10px 8px;flex:0 0 auto!important;background:#fff;display:flex;flex-direction:column}.iu-calendarOverlay__side{border-left:0;border-top:1px solid #d7dfeb;padding:12px 10px 16px;flex:0 0 auto!important;background:#fff}.iu-calendarOverlay__viewRoot{display:block;width:100%;min-height:320px!important}.iu-calendarOverlay__viewRoot[data-view='week'],.iu-calendarOverlay__viewRoot[data-view='year']{min-height:auto!important;height:auto!important;max-height:none!important;overflow:visible!important}.iu-calendarOverlay__viewRoot[data-view='week'] .iu-calTimeline,.iu-calendarOverlay__viewRoot[data-view='year'] .iu-calYear{margin-bottom:0;padding-bottom:0}.iu-calendarOverlay__form{order:1}.iu-calendarOverlay__formActions{gap:10px;position:relative}.iu-calendarOverlay__formActions button{min-height:48px;font-size:15px;position:relative}.iu-calendarOverlay__listWrap{order:2}.iu-calTimeline{padding:6px}.iu-calGrid{padding:6px;gap:6px}.iu-calDayCell{min-height:84px}.iu-calYear{grid-template-columns:repeat(2,minmax(0,1fr));padding:6px}}@media (max-width:640px){.iu-calendarOverlay__header h2{font-size:14px;min-height:32px}.iu-calendarOverlay__viewBtn{min-height:32px;padding:6px 5px;font-size:10px}.iu-calendarOverlay__close{min-width:32px;min-height:32px;width:32px;height:32px}.iu-calendarOverlay__toolbar button{min-height:42px}.iu-calendarOverlay__formActions button{flex:1 1 100%}.iu-calYear{grid-template-columns:1fr}.iu-calDayCell{min-height:72px;font-size:11px}}";
  const CAL_VISUAL_STYLE_ID = "iu-calendar-visual-state-layer";
  const CAL_VISUAL_LAYER_TEXT = "#iuCalendarOverlay{--iu-cal-accent:var(--iu-calendar-accent);--iu-cal-accent-soft:rgba(21,128,61,.12);--iu-cal-muted:rgba(15,23,42,.45);--iu-cal-surface:#ffffff;--iu-cal-border:#d6dfec}#iuCalendarOverlay .iu-calendarOverlay__viewBtn.is-active{background:linear-gradient(180deg,#1e3a5c 0%,#152a42 100%);color:#fff;border-color:#152a42;box-shadow:0 1px 0 rgba(255,255,255,.12) inset}#iuCalendarOverlay .iu-calendarOverlay__viewBtn:not(.is-active){background:#f8fafc;color:#334155;border-color:#cbd5e1}#iuCalendarOverlay .iu-calendarOverlay__viewBtn:not(.is-active):hover{background:#f1f5f9}#iuCalendarOverlay .iu-calendarOverlay__viewBtn:focus-visible{outline:2px solid var(--iu-cal-accent);outline-offset:2px}#iuCalendarOverlay .iu-calendarOverlay__toolbar>button{background:#f8fafc;border:1px solid #cbd5e1;color:#1e293b}#iuCalendarOverlay .iu-calendarOverlay__toolbar>button:hover{background:#f1f5f9}#iuCalendarOverlay .iu-calendarOverlay__toolbar>button:focus-visible{outline:2px solid var(--iu-cal-accent);outline-offset:2px}#iuCalendarOverlay .iu-calendarOverlay__close{background:#eef2f7;color:#0f172a}#iuCalendarOverlay .iu-calendarOverlay__close:hover{background:#e2e8f0}#iuCalendarOverlay .iu-calendarOverlay__close:focus-visible{outline:2px solid var(--iu-cal-accent);outline-offset:2px}#iuCalendarOverlay .iu-calTimelineItem.is-past{opacity:.72;background:#f8fafc;border-color:#e2e8f0}#iuCalendarOverlay .iu-calTimelineItem.is-future{background:#fff}#iuCalendarOverlay .iu-calTimelineItem.is-today{background:rgba(236,253,245,.85);border-color:rgba(21,128,61,.35);box-shadow:0 0 0 1px rgba(21,128,61,.2) inset}#iuCalendarOverlay .iu-calTimelineItem.is-empty:not(.is-today){color:var(--iu-cal-muted)}#iuCalendarOverlay .iu-calTimelineItem.has-events:not(.is-today){border-color:#cbd5e1}#iuCalendarOverlay .iu-calendarOverlay__eventBtn.is-past-event{opacity:.68;background:#f1f5f9;border-color:#e2e8f0;color:#475569}#iuCalendarOverlay .iu-calendarOverlay__eventBtn.is-nearest-upcoming{background:linear-gradient(180deg,rgba(236,253,245,.95),#ecfdf5);border-color:rgba(21,128,61,.45);color:#0f172a;box-shadow:0 0 0 1px rgba(21,128,61,.2) inset;font-weight:600}#iuCalendarOverlay .iu-calDayCell.is-past:not(.is-today){opacity:.68;background:#f8fafc}#iuCalendarOverlay .iu-calDayCell.is-future:not(.is-today){background:#fff}#iuCalendarOverlay .iu-calDayCell.is-today{border-color:rgba(21,128,61,.5);box-shadow:0 0 0 1px rgba(21,128,61,.35) inset;background:rgba(236,253,245,.75)}#iuCalendarOverlay .iu-calDayCell.is-selected:not(.is-today){border-color:#1e3a5c;box-shadow:0 0 0 2px rgba(30,58,92,.22) inset;background:#eef4ff}#iuCalendarOverlay .iu-calDayCell.is-today.is-selected{border-color:#1e3a5c;box-shadow:0 0 0 2px rgba(30,58,92,.25) inset,0 0 0 1px rgba(21,128,61,.25) inset;background:linear-gradient(145deg,rgba(236,253,245,.9),rgba(238,244,255,.95))}#iuCalendarOverlay .iu-calDayCell.has-events:not(.is-today):not(.is-selected){border-color:rgba(21,128,61,.28)}#iuCalendarOverlay .iu-calDayCell.has-events .iu-calEventDot{background:rgba(236,253,245,.9);border:1px solid rgba(21,128,61,.15)}#iuCalendarOverlay .iu-calYearMonth.is-current-month{border-color:rgba(21,128,61,.35);background:rgba(236,253,245,.5)}#iuCalendarOverlay .iu-calYearMonth.has-events:not(.is-current-month){border-color:#cbd5e1}#iuCalendarOverlay .iu-calYearMonth.is-empty:not(.is-current-month){opacity:.78;background:#fafafa}#iuCalendarOverlay .iu-calendarOverlay__form input:focus-visible,#iuCalendarOverlay .iu-calendarOverlay__form select:focus-visible,#iuCalendarOverlay .iu-calendarOverlay__form textarea:focus-visible{outline:2px solid var(--iu-cal-accent);outline-offset:0;border-color:rgba(21,128,61,.45)}#iuCalendarOverlay .iu-calendarOverlay__formActions button[type=submit]{background:linear-gradient(180deg,#1e3a5c,#152a42);color:#fff;border-color:#152a42;font-weight:600}#iuCalendarOverlay .iu-calendarOverlay__formActions button[type=submit]:hover{filter:brightness(1.03)}#iuCalendarOverlay .iu-calendarOverlay__formActions button[data-iu-cal-delete],#iuCalendarOverlay .iu-calendarOverlay__formActions button[data-iu-cal-reset]{background:#f8fafc;color:#334155;border-color:#cbd5e1}#iuCalendarOverlay .iu-calendarOverlay__listWrap{margin-top:4px;padding-top:10px;border-top:1px solid #e2e8f0}#iuCalendarOverlay .iu-calendarOverlay__listWrap h3{font-size:14px;color:#1e293b;margin:0 0 8px}";
  const SCHEMA_VERSION = 1;
  const STORE_KEY = CAL_NS + ".store.v1";
  const VAULT_ENC_PREFIX = "iu:vault:enc:v1:";
  const MAX_ATTACHMENTS = 4;
  const MAX_IMAGE_EDGE = 1600;
  const MAX_IMAGE_BYTES = 420000;
  const CAL_ALL_DAY_MAX_PER_DATE = 3;
  const CAL_ALL_DAY_LIMIT_MSG = "Pro jeden den lze uložit maximálně 3 celodenní události.";
  const ALLOWED_VIEWS = new Set(["month", "year"]);
  const FOCUSABLE_SELECTOR = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  /* Skip same-tab reload after our own writeStore (rapid creates were racing readStore). */
  let iuCalStoreWriteEpoch = 0;
  let iuCalWriteInFlight = 0;
  let iuCalWriteChain = Promise.resolve();

  const CZ_FIXED_HOLIDAYS = new Set([
    "01-01","05-01","05-08","07-05","07-06","09-28","10-28","11-17","12-24","12-25","12-26"
  ]);

  const state = {
    inited: false,
    dbReady: false,
    db: null,
    data: { schemaVersion: SCHEMA_VERSION, events: [] },
    selectedDate: toDateOnly(new Date()),
    view: "month",
    cursorDate: toDateOnly(new Date()),
    returnFocusEl: null,
    currentEditId: "",
    trapAttached: false,
    prevBodyPadRight: "",
    dayOpen: false,
    mobileDayOverlayOpen: false,
    inline: null,
    bottomSheetOpen: false,
    searchOpen: false,
    searchScope: "month",
    searchQuery: "",
    searchResults: [],
    premiumUiBound: false,
    sidePanelSearchBound: false,
    calInlineNotice: ""
  };

  function uid(prefix){ return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function ensureStyles(){
    try{
      if (!document.getElementById(CAL_STYLE_ID)){
        const st = document.createElement("style");
        st.id = CAL_STYLE_ID;
        st.textContent = CAL_STYLE_TEXT;
        document.head.appendChild(st);
      }
      if (!document.getElementById(CAL_VISUAL_STYLE_ID)){
        const st2 = document.createElement("style");
        st2.id = CAL_VISUAL_STYLE_ID;
        st2.textContent = CAL_VISUAL_LAYER_TEXT;
        document.head.appendChild(st2);
      }
      if (!document.getElementById(CAL_MOBILE_BOTTOM_CLEAR_ID)){
        const st3 = document.createElement("style");
        st3.id = CAL_MOBILE_BOTTOM_CLEAR_ID;
        /* iu-calendar-bottom-nav-restore-v1: same stacking as Úkoly/Poznámky (#iuMobileBottomNav z-index 10025). */
        st3.textContent =
          "@media(max-width:1024px){" +
          "#iuCalendarOverlay.iu-calendarOverlay:not([hidden]){z-index:10024!important;align-items:stretch!important;justify-content:flex-start!important;padding:0!important}" +
          "#iuCalendarOverlay .iu-calendarOverlay__backdrop{position:fixed!important;inset:0!important}" +
          "#iuCalendarOverlay .iu-calendarOverlay__dialog{position:fixed!important;left:0!important;right:0!important;top:0!important;" +
          "bottom:var(--bottom-nav-height,calc(56px + env(safe-area-inset-bottom,0px) + 48px))!important;" +
          "width:100vw!important;max-width:100vw!important;min-height:0!important;height:auto!important;" +
          "max-height:calc(100vh - var(--bottom-nav-height,calc(56px + env(safe-area-inset-bottom,0px) + 48px)))!important;" +
          "max-height:calc(100dvh - var(--bottom-nav-height,calc(56px + env(safe-area-inset-bottom,0px) + 48px)))!important;" +
          "margin:0!important;border-radius:0!important;overflow:hidden!important;display:flex!important;" +
          "flex-direction:column!important;box-sizing:border-box!important}" +
          "}";
        document.head.appendChild(st3);
      }
      if (!document.getElementById(CAL_MONTH_FAB_STYLE_ID)){
        const st4 = document.createElement("style");
        st4.id = CAL_MONTH_FAB_STYLE_ID;
        st4.textContent = CAL_MONTH_FAB_CSS;
        document.head.appendChild(st4);
      }
      if (!document.getElementById(CAL_PREMIUM_UPDATE_STYLE_ID)){
        const st5 = document.createElement("style");
        st5.id = CAL_PREMIUM_UPDATE_STYLE_ID;
        st5.textContent = CAL_PREMIUM_UPDATE_CSS;
        document.head.appendChild(st5);
      }
      if (!document.getElementById(CAL_PREMIUM_FIX_V2_STYLE_ID)){
        const st6 = document.createElement("style");
        st6.id = CAL_PREMIUM_FIX_V2_STYLE_ID;
        st6.textContent = CAL_PREMIUM_FIX_V2_CSS;
        document.head.appendChild(st6);
      }
      if (!document.getElementById(CAL_PREMIUM_FIX_V4_STYLE_ID)){
        const st7 = document.createElement("style");
        st7.id = CAL_PREMIUM_FIX_V4_STYLE_ID;
        st7.textContent = CAL_PREMIUM_FIX_V4_CSS;
        document.head.appendChild(st7);
      }
      if (!document.getElementById(CAL_PREMIUM_FIX_V6_STYLE_ID)){
        const st8 = document.createElement("style");
        st8.id = CAL_PREMIUM_FIX_V6_STYLE_ID;
        st8.textContent = CAL_PREMIUM_FIX_V6_CSS;
        document.head.appendChild(st8);
      }
      /* P1 lazy mount: ensureCalPremiumDom() moved to ensureCalendarOverlayMounted()
         — premium overlay DOM is built on first calendar open, not at boot. */
    }catch{}
  }

  function ensureCalPremiumDom(){
    if (!document.getElementById("iuCalEventBottomSheet")){
      const bs = document.createElement("div");
      bs.id = "iuCalEventBottomSheet";
      bs.className = "iu-calBottomSheet";
      bs.hidden = true;
      bs.setAttribute("aria-hidden", "true");
      bs.innerHTML =
        '<div class="iu-calBottomSheet__scrim" data-iu-cal-bs-close="1" aria-hidden="true"></div>' +
        '<div class="iu-calBottomSheet__panel" role="dialog" aria-modal="true" aria-labelledby="iuCalBottomSheetTitle">' +
        '<div class="iu-calBottomSheet__handle" aria-hidden="true"></div>' +
        '<div class="iu-calBottomSheet__head">' +
        '<h3 class="iu-calBottomSheet__title" id="iuCalBottomSheetTitle">Událost</h3>' +
        '<button type="button" class="iu-calBottomSheet__close" data-iu-cal-bs-close="1" aria-label="Zavřít">×</button>' +
        "</div>" +
        '<div class="iu-calBottomSheet__scroll" data-iu-cal-bs-scroll="1"></div>' +
        "</div>";
      document.body.appendChild(bs);
    }
    if (!document.getElementById("iuCalEventSearchOverlay")){
      const so = document.createElement("div");
      so.id = "iuCalEventSearchOverlay";
      so.className = "iu-calSearchOverlay";
      so.hidden = true;
      so.setAttribute("aria-hidden", "true");
      so.innerHTML =
        '<div class="iu-calSearchOverlay__panel" role="dialog" aria-modal="true" aria-labelledby="iuCalSearchTitle">' +
        '<div class="iu-calSearchOverlay__head">' +
        '<h2 class="iu-calSearchOverlay__title" id="iuCalSearchTitle">Vyhledat událost</h2>' +
        '<button type="button" class="iu-calBottomSheet__close iu-calSearchOverlay__close" data-iu-cal-search-close="1" aria-label="Zavřít">×</button>' +
        "</div>" +
        '<form class="iu-calSearchOverlay__form" data-iu-cal-search-form="1">' +
        '<input type="search" class="iu-calSearchOverlay__input" data-iu-cal-search-input="1" placeholder="Název nebo obsah události…" autocomplete="off" maxlength="120" />' +
        '<button type="submit" class="iu-calSearchOverlay__submit">Hledat</button>' +
        "</form>" +
        '<p class="iu-calSearchOverlay__count" data-iu-cal-search-count="1">Nalezeno: 0 událostí</p>' +
        '<div class="iu-calSearchOverlay__resultsWrap">' +
        '<div class="iu-calSearchOverlay__tableScroll" data-iu-cal-search-results="1"></div>' +
        "</div></div>";
      document.body.appendChild(so);
    }
    if (!document.getElementById("iuCalDeleteConfirm")){
      const dc = document.createElement("div");
      dc.id = "iuCalDeleteConfirm";
      dc.className = "iu-calDeleteConfirm";
      dc.hidden = true;
      dc.setAttribute("aria-hidden", "true");
      dc.setAttribute("role", "alertdialog");
      dc.setAttribute("aria-labelledby", "iuCalDeleteConfirmTitle");
      dc.innerHTML =
        '<div class="iu-calDeleteConfirm__panel">' +
        '<p class="iu-calDeleteConfirm__text" id="iuCalDeleteConfirmTitle">Opravdu chcete odstranit tuto událost?</p>' +
        '<div class="iu-calDeleteConfirm__actions">' +
        '<button type="button" class="iu-calDeleteConfirm__btn iu-calDeleteConfirm__btn--yes" data-iu-cal-delete-confirm-yes="1">Ano, odstranit</button>' +
        '<button type="button" class="iu-calDeleteConfirm__btn iu-calDeleteConfirm__btn--cancel" data-iu-cal-delete-confirm-cancel="1">Zrušit</button>' +
        "</div></div>";
      document.body.appendChild(dc);
    }
    if (!document.getElementById("iuCalMonthActionBar")){
      const main = document.querySelector("#iuCalendarOverlay .iu-calendarOverlay__main");
      if (main){
        const bar = document.createElement("div");
        bar.id = "iuCalMonthActionBar";
        bar.className = "iu-calMonthActionBar";
        bar.hidden = true;
        main.appendChild(bar);
      }
    }
  }
  function pad(n){ return String(n).padStart(2, "0"); }
  function toDateOnly(d){ const x = new Date(d); return x.getFullYear() + "-" + pad(x.getMonth()+1) + "-" + pad(x.getDate()); }
  function toTimeOnly(d){ const x = new Date(d); return pad(x.getHours()) + ":" + pad(x.getMinutes()); }
  function parseDateTime(date, time){ return new Date(date + "T" + (time || "00:00") + ":00"); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m])); }
  function compareEvents(a, b){
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const aAll = isEventAllDay(a);
    const bAll = isEventAllDay(b);
    if (aAll && !bAll) return -1;
    if (!aAll && bAll) return 1;
    return (a.date + "T" + (a.time || "00:00")).localeCompare(b.date + "T" + (b.time || "00:00"));
  }
  function addDays(dateStr, days){ const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + days); return toDateOnly(d); }
  function startOfWeek(dateStr){ const d = new Date(dateStr + "T00:00:00"); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return toDateOnly(d); }
  function sameYMD(a, b){ return String(a) === String(b); }

  function isCalMobileLayout(){
    try {
      return window.matchMedia && window.matchMedia("(max-width: 1024px)").matches;
    } catch (_) {
      return (window.innerWidth || 0) <= 1024;
    }
  }

  function shouldUseCalBottomSheet(){
    return isCalMobileLayout() && !!state.inline;
  }

  function isCalDesktopTwoPanel(){
    return !isCalMobileLayout();
  }

  function isCalDesktopSideFormOnly(){
    return !!(
      isCalDesktopTwoPanel() &&
      state.inline &&
      state.inline.showDatePicker &&
      state.inline.mode === "new" &&
      state.inline.formSource === "month" &&
      !state.dayOpen
    );
  }

  function isCalSidePanelOpen(){
    if (!isCalDesktopTwoPanel()) return false;
    if (state.searchOpen) return true;
    if (state.dayOpen) return true;
    if (isCalDesktopSideFormOnly()) return true;
    return false;
  }

  function getCalSearchElements(){
    if (isCalDesktopTwoPanel() && state.searchOpen){
      const scroll = document.getElementById("iuCalendarSidePanelScroll");
      if (!scroll) return {};
      return {
        root: scroll,
        inp: scroll.querySelector("[data-iu-cal-search-input]"),
        countEl: scroll.querySelector("[data-iu-cal-search-count]"),
        resultsEl: scroll.querySelector("[data-iu-cal-search-results]")
      };
    }
    const ov = document.getElementById("iuCalEventSearchOverlay");
    if (!ov) return {};
    return {
      root: ov,
      inp: ov.querySelector("[data-iu-cal-search-input]"),
      countEl: ov.querySelector("[data-iu-cal-search-count]"),
      resultsEl: ov.querySelector("[data-iu-cal-search-results]")
    };
  }

  function buildSidePanelSearchHtml(){
    return (
      '<div class="iu-calSidePanelSearch" data-iu-cal-side-search-root="1">' +
      '<form class="iu-calSearchOverlay__form" data-iu-cal-search-form="1">' +
      '<input type="search" class="iu-calSearchOverlay__input" data-iu-cal-search-input="1" placeholder="Název nebo obsah události…" autocomplete="off" maxlength="120" />' +
      '<button type="submit" class="iu-calSearchOverlay__submit">Hledat</button>' +
      "</form>" +
      '<p class="iu-calSearchOverlay__count" data-iu-cal-search-count="1">Nalezeno: 0 událostí</p>' +
      '<div class="iu-calSearchOverlay__resultsWrap">' +
      '<div class="iu-calSearchOverlay__tableScroll" data-iu-cal-search-results="1"></div>' +
      "</div></div>"
    );
  }

  function updateSidePanelHeader(line1, line2){
    const l1 = document.getElementById("iuCalSidePanelLine1");
    const l2 = document.getElementById("iuCalSidePanelLine2");
    if (l1) l1.textContent = String(line1 || "");
    if (l2) l2.textContent = String(line2 || "");
  }

  function closeDesktopSidePanel(){
    if (!isCalDesktopTwoPanel()) return;
    closeTimeWheel();
    closeCalDeleteConfirm();
    state.dayOpen = false;
    state.searchOpen = false;
    resetEventSearchState();
    state.inline = null;
    state.currentEditId = "";
    state.bottomSheetOpen = false;
    setMessage("");
    render();
    restoreCalendarScrollGuard();
  }

  function renderDesktopSidePanel(){
    if (!isCalDesktopTwoPanel()) return;
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    const pinned = document.getElementById("iuCalendarSidePanelPinned");
    if (!scroll) return;
    if (!isCalSidePanelOpen()){
      scroll.innerHTML = "";
      if (pinned){
        pinned.innerHTML = "";
        pinned.hidden = true;
        pinned.setAttribute("aria-hidden", "true");
      }
      updateSidePanelHeader("", "");
      return;
    }
    if (state.searchOpen){
      if (pinned){
        pinned.innerHTML = "";
        pinned.hidden = true;
        pinned.setAttribute("aria-hidden", "true");
      }
      updateSidePanelHeader("Kalendář", "Vyhledat událost");
      scroll.innerHTML = buildSidePanelSearchHtml();
      const els = getCalSearchElements();
      if (els.inp) els.inp.value = String(state.searchQuery || "");
      const n = state.searchResults.length;
      if (els.countEl) els.countEl.textContent = "Nalezeno: " + n + " událostí";
      if (els.resultsEl) els.resultsEl.innerHTML = n ? renderSearchResultsTable(state.searchResults) : "";
      if (els.resultsEl){
        els.resultsEl.querySelectorAll("[data-iu-cal-search-row]").forEach((row)=>{
          row.addEventListener("click", ()=>{
            const id = row.getAttribute("data-iu-cal-search-row") || "";
            closeEventSearch();
            loadEventForEdit(id);
          });
        });
      }
      try{
        if (els.inp && els.inp.focus) els.inp.focus({ preventScroll: true });
      }catch{}
      return;
    }
    if (isCalDesktopSideFormOnly()){
      if (pinned){
        pinned.innerHTML = "";
        pinned.hidden = true;
        pinned.setAttribute("aria-hidden", "true");
      }
      updateSidePanelHeader("Kalendář", "Přidat událost");
      scroll.innerHTML = '<div class="iu-calSidePanelForm">' + buildInlineEditorHtml() + "</div>";
      bindCalendarInlineEditorRoot(scroll, String(state.inline.date || state.selectedDate || "").slice(0, 10));
      focusNewInlineTitleAfterRender();
      return;
    }
    if (state.dayOpen){
      const iso = String(state.selectedDate || "").slice(0, 10);
      const head = formatCalMobileDayHeading(iso);
      updateSidePanelHeader(head.line1, head.line2);
      syncDayViewPinnedAndHours(iso);
    }
  }

  function bindSidePanelSearchUiOnce(){
    if (state.sidePanelSearchBound) return;
    state.sidePanelSearchBound = true;
    document.addEventListener("submit", (ev)=>{
      const form = ev.target && ev.target.closest ? ev.target.closest("[data-iu-cal-side-search-root] [data-iu-cal-search-form]") : null;
      if (!form) return;
      ev.preventDefault();
      runEventSearch();
    }, true);
  }

  function isEventAllDay(ev){
    return !!(ev && ev.allDay);
  }

  function calWeekdayAbbrev(dow){
    const names = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
    return names[dow] || "";
  }

  function formatEventTimeLabel(ev){
    if (isEventAllDay(ev)) return "Celý den";
    const t = String(ev && ev.time || "").trim();
    return t || "—";
  }

  function formatEventDateCs(dateStr){
    const p = String(dateStr || "").split("-");
    if (p.length < 3) return String(dateStr || "");
    return pad(Number(p[2])) + "." + pad(Number(p[1])) + "." + p[0];
  }

  function getAllDayEventsForDate(date){
    return getEventsForDate(date).filter(isEventAllDay).sort(compareEvents);
  }

  function countAllDayEventsForDate(date, excludeId){
    const ex = String(excludeId || "").trim();
    return getAllDayEventsForDate(date).filter((ev)=> !ex || ev.id !== ex).length;
  }

  function canAddAllDayForDate(date, excludeId){
    return countAllDayEventsForDate(date, excludeId) < CAL_ALL_DAY_MAX_PER_DATE;
  }

  function setCalInlineNotice(msg){
    state.calInlineNotice = String(msg || "").trim();
    if (shouldUseCalBottomSheet()) syncCalBottomSheet();
    else if (isCalDesktopSideFormOnly()){
      const scroll = document.getElementById("iuCalendarSidePanelScroll");
      if (scroll){
        scroll.innerHTML = '<div class="iu-calSidePanelForm">' + buildInlineEditorHtml() + "</div>";
        bindCalendarInlineEditorRoot(scroll, String(state.inline && state.inline.date || state.selectedDate || "").slice(0, 10));
      }
    } else if (state.mobileDayOverlayOpen || (state.dayOpen && isCalDesktopTwoPanel())){
      syncDayViewPinnedAndHours(String(state.inline && state.inline.date || state.selectedDate || "").slice(0, 10), { preserveHourScroll: true });
    } else {
      render();
    }
  }

  function clearCalInlineNotice(){
    if (!state.calInlineNotice) return;
    state.calInlineNotice = "";
  }

  function captureCalScrollLockSnapshot(){
    if (calScrollLock.saved) return;
    try{
      const body = document.body;
      const html = document.documentElement;
      calScrollLock.bodyOverflow = body.style.overflow || "";
      calScrollLock.htmlOverflow = html.style.overflow || "";
      calScrollLock.bodyTouchAction = body.style.touchAction || "";
      calScrollLock.htmlTouchAction = html.style.touchAction || "";
      calScrollLock.saved = true;
    }catch{}
  }

  function releaseCalScrollLockSnapshot(){
    if (!calScrollLock.saved) return;
    try{
      const body = document.body;
      const html = document.documentElement;
      body.style.overflow = calScrollLock.bodyOverflow;
      html.style.overflow = calScrollLock.htmlOverflow;
      body.style.touchAction = calScrollLock.bodyTouchAction;
      html.style.touchAction = calScrollLock.htmlTouchAction;
      calScrollLock.saved = false;
    }catch{}
  }

  function syncDayContentScrollSurface(){
    try{
      const dayContent = document.querySelector("#iuCalendarDayOverlay .iu-calendar-day-content");
      if (!dayContent || !state.mobileDayOverlayOpen) return;
      dayContent.style.touchAction = "pan-y";
      dayContent.style.overscrollBehavior = "contain";
    }catch{}
  }

  function restoreCalendarScrollGuard(){
    closeCalDeleteConfirm();
    releaseCalScrollLockSnapshot();
    syncCalendarScrollLocks();
    syncDayContentScrollSurface();
    try{
      requestAnimationFrame(()=>{
        syncCalendarScrollLocks();
        syncDayContentScrollSurface();
      });
    }catch{}
  }

  function syncCalendarScrollLocks(){
    const bs = document.getElementById("iuCalEventBottomSheet");
    const bsOpen = !!(bs && !bs.hidden && state.bottomSheetOpen);
    const searchOv = document.getElementById("iuCalEventSearchOverlay");
    const searchOpen = !!(state.searchOpen && !isCalDesktopTwoPanel() && searchOv && !searchOv.hidden);
    const dc = document.getElementById("iuCalDeleteConfirm");
    const deleteConfirmOpen = !!(dc && !dc.hidden);
    const modalLock = bsOpen || searchOpen || deleteConfirmOpen;
    try{
      if (modalLock){
        captureCalScrollLockSnapshot();
        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";
        document.body.style.touchAction = "none";
      } else {
        releaseCalScrollLockSnapshot();
        if (!document.body.classList.contains("iu-calendarOverlay-open")){
          document.body.style.overflow = "";
          document.documentElement.style.overflow = "";
          document.body.style.touchAction = "";
        }
      }
    }catch{}
    syncDayContentScrollSurface();
  }

  function openCalDeleteConfirm(){
    const dc = document.getElementById("iuCalDeleteConfirm");
    if (!dc) return;
    try{
      /* Keep confirm as a body-level peer so it can sit above #iuCalendarOverlay (MyInfoUzel z-index 12100). */
      if (dc.parentNode !== document.body) document.body.appendChild(dc);
    }catch{}
    dc.hidden = false;
    dc.setAttribute("aria-hidden", "false");
    captureCalScrollLockSnapshot();
    syncCalendarScrollLocks();
    try{
      const yes = dc.querySelector("[data-iu-cal-delete-confirm-yes]");
      if (yes && yes.focus) yes.focus({ preventScroll: true });
    }catch{}
  }

  function closeCalDeleteConfirm(){
    const dc = document.getElementById("iuCalDeleteConfirm");
    if (!dc) return;
    dc.hidden = true;
    dc.setAttribute("aria-hidden", "true");
  }

  function requestDeleteInlineEditor(){
    const inl = state.inline;
    if (!inl || inl.mode !== "edit" || !inl.id) return;
    openCalDeleteConfirm();
  }

  function buildAllDayToggleHtml(checked){
    const on = !!checked;
    return (
      '<div class="iu-calAllDayToggleRow">' +
      '<span class="iu-calAllDayToggleRow__label">' +
      '<span class="iu-calAllDayToggleRow__line">Celodenní</span>' +
      '<span class="iu-calAllDayToggleRow__line">událost</span>' +
      "</span>" +
      '<button type="button" class="iu-calAllDaySwitch' +
      (on ? " is-on" : "") +
      '" data-iu-cal-inline-all-day="1" role="switch" aria-checked="' +
      (on ? "true" : "false") +
      '" aria-label="Celodenní událost">' +
      '<span class="iu-calAllDaySwitch__track" aria-hidden="true"></span>' +
      '<span class="iu-calAllDaySwitch__thumb" aria-hidden="true"></span>' +
      "</button></div>"
    );
  }

  function calMonthGenitiveCs(m0){
    const names = [
      "ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"
    ];
    return names[m0] || "";
  }
  function calWeekdayNameCs(dow){
    const names = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
    return names[dow] || "";
  }
  function formatCalMobileDayHeading(iso){
    const p = String(iso || "").split("-");
    if (p.length < 3) return { line1: "", line2: "" };
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (!Number.isFinite(d.getTime())) return { line1: "", line2: "" };
    const wd = calWeekdayNameCs(d.getDay());
    const head = wd ? wd.charAt(0).toUpperCase() + wd.slice(1) : "";
    const monG = calMonthGenitiveCs(d.getMonth());
    return {
      line1: head,
      line2: d.getDate() + ". " + monG + " " + d.getFullYear()
    };
  }

  function isHoliday(dateStr){
    const d = new Date(dateStr + "T00:00:00");
    const mmdd = pad(d.getMonth()+1) + "-" + pad(d.getDate());
    if (CZ_FIXED_HOLIDAYS.has(mmdd)) return true;
    const year = d.getFullYear();
    const easter = getEasterDate(year);
    const goodFriday = addDays(toDateOnly(easter), -2);
    const easterMonday = addDays(toDateOnly(easter), 1);
    return sameYMD(dateStr, goodFriday) || sameYMD(dateStr, easterMonday);
  }

  function getHolidayNameForDate(dateStr){
    const d = new Date(dateStr + "T00:00:00");
    if (!Number.isFinite(d.getTime())) return "";
    const mmdd = pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    const fixed = {
      "01-01": "Nový rok",
      "05-01": "Svátek práce",
      "05-08": "Den vítězství",
      "07-05": "Den slovanských věrozvětců Cyrila a Metoděje",
      "07-06": "Den upálení mistra Jana Husa",
      "09-28": "Den české státnosti",
      "10-28": "Den vzniku samostatného československého státu",
      "11-17": "Den boje za svobodu a demokracii",
      "12-24": "Štědrý den",
      "12-25": "1. svátek vánoční",
      "12-26": "2. svátek vánoční"
    };
    if (fixed[mmdd]) return fixed[mmdd];
    const year = d.getFullYear();
    const easter = getEasterDate(year);
    const goodFriday = addDays(toDateOnly(easter), -2);
    const easterMonday = addDays(toDateOnly(easter), 1);
    if (sameYMD(dateStr, goodFriday)) return "Velký pátek";
    if (sameYMD(dateStr, easterMonday)) return "Velikonoční pondělí";
    return "";
  }

  function getEasterDate(year){
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function sanitizeEvent(evt){
    if (!evt || typeof evt !== "object") return null;
    const addr = String(evt.address || "").trim().slice(0, 240);
    const rem = String(evt.reminder || "").trim().slice(0, 80);
    const safe = {
      id: String(evt.id || uid("evt")),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(evt.date || "")) ? String(evt.date) : toDateOnly(new Date()),
      time: /^\d{2}:\d{2}$/.test(String(evt.time || "")) ? String(evt.time) : "09:00",
      allDay: !!evt.allDay,
      title: String(evt.title || "").trim().slice(0, 120),
      note: String(evt.note || "").trim().slice(0, 1000),
      address: addr,
      reminder: rem,
      type: ["personal", "work", "health", "other"].includes(String(evt.type || "")) ? String(evt.type) : "personal",
      attachments: Array.isArray(evt.attachments) ? evt.attachments.filter(sanitizeAttachment).slice(0, MAX_ATTACHMENTS) : [],
      createdAt: Number.isFinite(Number(evt.createdAt)) ? Number(evt.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(evt.updatedAt)) ? Number(evt.updatedAt) : Date.now()
    };
    if (!safe.title) return null;
    if (safe.allDay) safe.time = "00:00";
    return safe;
  }

  function sanitizeAttachment(a){
    if (!a || typeof a !== "object") return null;
    if (a.kind !== "image") return null;
    if (typeof a.data !== "string" || !a.data.startsWith("data:image/")) return null;
    const size = Number(a.size) || 0;
    if (size <= 0 || size > MAX_IMAGE_BYTES) return null;
    return {
      id: String(a.id || uid("att")),
      kind: "image",
      mimeType: String(a.mimeType || "image/jpeg"),
      data: a.data,
      width: Math.max(1, Number(a.width) || 1),
      height: Math.max(1, Number(a.height) || 1),
      size,
      createdAt: Number.isFinite(Number(a.createdAt)) ? Number(a.createdAt) : Date.now()
    };
  }

  async function initStorage(){
    try{
      const req = indexedDB.open(CAL_NS + ".idb", 1);
      await new Promise((resolve, reject)=>{
        req.onupgradeneeded = function(){
          const db = req.result;
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        };
        req.onsuccess = ()=>resolve();
        req.onerror = ()=>reject(req.error || new Error("IDB open failed"));
      });
      state.db = req.result;
      state.dbReady = true;
    }catch{
      state.dbReady = false;
    }
  }

  function hasVaultEncBlob(key) {
    try {
      return !!localStorage.getItem(VAULT_ENC_PREFIX + key);
    } catch (_) {
      return false;
    }
  }

  async function readStore(){
    const epochAtStart = iuCalStoreWriteEpoch;
    if (iuCalWriteInFlight > 0) return;
    let raw = "";
    try{ raw = String(localStorage.getItem(STORE_KEY) || ""); }catch{}
    if (!raw && state.dbReady && state.db){
      try{
        raw = await new Promise((resolve, reject)=>{
          const tx = state.db.transaction("meta", "readonly");
          const st = tx.objectStore("meta");
          const rq = st.get(STORE_KEY);
          rq.onsuccess = ()=>resolve(String(rq.result || ""));
          rq.onerror = ()=>reject(rq.error);
        });
      }catch{}
    }
    if (iuCalWriteInFlight > 0 || iuCalStoreWriteEpoch !== epochAtStart) return;
    let parsed = null;
    try{ parsed = raw ? JSON.parse(raw) : null; }catch{}
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.events)){
      if (hasVaultEncBlob(STORE_KEY)) {
        if (iuCalWriteInFlight > 0 || iuCalStoreWriteEpoch !== epochAtStart) return;
        state.data = { schemaVersion: SCHEMA_VERSION, events: [] };
        return;
      }
      if (iuCalWriteInFlight > 0 || iuCalStoreWriteEpoch !== epochAtStart) return;
      /* Do not empty-write while another write owns memory — cold empty only. */
      if (state.data.events && state.data.events.length) return;
      state.data = { schemaVersion: SCHEMA_VERSION, events: [] };
      await writeStore();
      return;
    }
    const clean = parsed.events.map(sanitizeEvent).filter(Boolean).sort(compareEvents);
    if (iuCalWriteInFlight > 0 || iuCalStoreWriteEpoch !== epochAtStart) return;
    state.data = { schemaVersion: SCHEMA_VERSION, events: clean };
  }

  async function writeStore(){
    iuCalWriteInFlight += 1;
    const run = async () => {
      try {
        if (window.iuVault && typeof window.iuVault.isPersistBlocked === "function" && window.iuVault.isPersistBlocked(STORE_KEY)) {
          return false;
        }
      } catch (_) {}
      const ok = await ensureLocalDataProtectionBeforeSave();
      if (!ok) return false;
      try {
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          if (window.__iuVaultKeyPathDurableReady === true) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (_) {}
      const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, events: state.data.events });
      // Canonical vault is authoritative; calendar IDB is non-authoritative legacy mirror only.
      if (window.iuVault && typeof window.iuVault.durableSet === "function") {
        await window.iuVault.durableSet(STORE_KEY, payload);
      } else {
        const ret = localStorage.setItem(STORE_KEY, payload);
        if (ret && typeof ret.then === "function") await ret;
        if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
          await window.iuVault.flushPendingWrites();
        }
      }
      if (state.dbReady && state.db){
        try{
          await new Promise((resolve, reject)=>{
            const tx = state.db.transaction("meta", "readwrite");
            tx.objectStore("meta").put(payload, STORE_KEY);
            tx.oncomplete = ()=>resolve();
            tx.onerror = ()=>reject(tx.error);
          });
        }catch{}
      }
      iuCalStoreWriteEpoch += 1;
      const writeEpoch = iuCalStoreWriteEpoch;
      try{
        window.dispatchEvent(new CustomEvent("iu-local-store-changed", { detail: { key: STORE_KEY, source: "iu-calendar-self", epoch: writeEpoch } }));
      }catch{}
      try{
        queueMicrotask(()=>{
          try{
            if (typeof window.iuSilverCalendarSummaryRefresh === "function") window.iuSilverCalendarSummaryRefresh();
          }catch{}
        });
      }catch{}
      return true;
    };
    const next = iuCalWriteChain.then(run, run).finally(() => {
      iuCalWriteInFlight = Math.max(0, iuCalWriteInFlight - 1);
    });
    iuCalWriteChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  function getEventsForDate(date){ return state.data.events.filter((e)=>e.date === date).sort(compareEvents); }
  function setMessage(msg){ const el = document.getElementById("iuCalendarFormMsg"); if (el) el.textContent = msg || ""; }
  function getOverlay(){ return document.getElementById("iuCalendarOverlay"); }

  /* P1 perf (weather+calendar lazy mount): #iuCalendarOverlay, #iuCalTimeWheelHost
     and #iuCalendarDayOverlay ship inside an inert <template id="iuLazyOverlayTpl-calendar">
     and mount on first open. Premium overlay DOM + direct element bindings follow. */
  function ensureCalendarOverlayMounted(){
    try { ensureStyles(); } catch (_) {}
    if (getOverlay()){
      bindOverlayDirectUiOnce();
      return true;
    }
    const tpl = document.getElementById("iuLazyOverlayTpl-calendar");
    if (!tpl || !tpl.content) return false;
    try{
      tpl.parentNode.insertBefore(tpl.content.cloneNode(true), tpl);
      tpl.parentNode.removeChild(tpl);
    }catch{
      return false;
    }
    bindOverlayDirectUiOnce();
    return !!getOverlay();
  }

  function bindOverlayDirectUiOnce(){
    if (state.overlayDirectUiBound) return;
    if (!getOverlay()) return;
    state.overlayDirectUiBound = true;
    try{ ensureCalPremiumDom(); }catch{}
    const form = document.getElementById("iuCalendarEventForm");
    if (form){ form.addEventListener("submit", (e)=>{ e.preventDefault(); upsertEventFromForm(); }); }
    const photoInput = document.getElementById("iuCalendarPhotoInput");
    if (photoInput){ photoInput.addEventListener("change", ()=>handlePhotoAdd(photoInput.files)); }
    const dayCloseBtn = document.querySelector("#iuCalendarDayOverlay .iu-day-close");
    if (dayCloseBtn){
      dayCloseBtn.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        closeDayOverlay();
      });
    }
    try{ bindCalPremiumUiOnce(); }catch{}
  }

  function openOverlay(originEl){
    try { ensureStyles(); } catch (_) {}
    try{ ensureCalendarOverlayMounted(); }catch{}
    const ov = getOverlay();
    if (!ov) return;
    try {
      if (window.iuAnalytics && typeof window.iuAnalytics.privateToolsOpen === "function") {
        window.iuAnalytics.privateToolsOpen();
      }
    } catch (_) {}
    state.returnFocusEl = originEl || document.activeElement;
    try{
      if (typeof window.__iuSilverCalOverlayOpened === "function"){
        window.__iuSilverCalOverlayOpened(state.returnFocusEl);
      }
    }catch{}
    ov.hidden = false;
    ov.setAttribute("aria-hidden", "false");
    document.body.classList.add("iu-calendarOverlay-open");
    try{
      const sw = Math.max(0, (window.innerWidth || 0) - (document.documentElement && document.documentElement.clientWidth ? document.documentElement.clientWidth : 0));
      state.prevBodyPadRight = String(document.body.style.paddingRight || "");
      if (sw > 0) document.body.style.paddingRight = sw + "px";
    }catch{}
    render();
    attachFocusTrap();
    const first = ov.querySelector(FOCUSABLE_SELECTOR);
    if (first) try{ first.focus({ preventScroll: true }); }catch{}
  }

  function closeOverlay(){
    const ov = getOverlay();
    if (!ov) return;
    state.dayOpen = false;
    state.mobileDayOverlayOpen = false;
    state.inline = null;
    state.bottomSheetOpen = false;
    closeTimeWheel();
    closeEventSearch();
    try{
      if (typeof window.__iuSilverCalOverlayClosed === "function"){
        window.__iuSilverCalOverlayClosed();
      }
    }catch{}
    ov.hidden = true;
    ov.setAttribute("aria-hidden", "true");
    try{
      const dayOv = document.getElementById("iuCalendarDayOverlay");
      if (dayOv){
        dayOv.hidden = true;
        dayOv.setAttribute("aria-hidden", "true");
      }
    }catch{}
    try{ document.body.style.overflow = ""; }catch{}
    document.body.classList.remove("iu-calendarOverlay-open");
    try{ document.body.style.paddingRight = state.prevBodyPadRight || ""; }catch{}
    detachFocusTrap();
    restoreCalendarScrollGuard();
    if (state.returnFocusEl && typeof state.returnFocusEl.focus === "function"){
      const el = state.returnFocusEl;
      try{ el.focus({ preventScroll: true }); }catch{
        try{ el.focus(); }catch{}
      }
      // Some pages restore focus to BODY on Escape; retry on next tick.
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
    const dayOv = document.getElementById("iuCalendarDayOverlay");
    const daySurfaceOpen = !!(dayOv && !dayOv.hidden && isCalMobileLayout());
    const ov = getOverlay();
    if (e.key === "Escape"){
      const delConfirm = document.getElementById("iuCalDeleteConfirm");
      if (delConfirm && !delConfirm.hidden){
        e.preventDefault();
        restoreCalendarScrollGuard();
        return;
      }
      const searchOv = document.getElementById("iuCalEventSearchOverlay");
      if (state.searchOpen && isCalDesktopTwoPanel()){
        e.preventDefault();
        closeEventSearch();
        return;
      }
      if (searchOv && !searchOv.hidden && state.searchOpen){
        e.preventDefault();
        closeEventSearch();
        return;
      }
      const bs = document.getElementById("iuCalEventBottomSheet");
      if (bs && !bs.hidden && state.bottomSheetOpen){
        e.preventDefault();
        const tw = document.getElementById("iuCalTimeWheelHost");
        if (tw && !tw.hidden){ closeTimeWheel(); return; }
        cancelInlineEditor();
        return;
      }
      if (daySurfaceOpen){
        e.preventDefault();
        const tw = document.getElementById("iuCalTimeWheelHost");
        if (tw && !tw.hidden){ closeTimeWheel(); return; }
        if (state.inline){ cancelInlineEditor(); return; }
        closeDayOverlay();
        return;
      }
      if (!ov || ov.hidden) return;
      if (isCalDesktopTwoPanel() && isCalSidePanelOpen()){
        e.preventDefault();
        const twSide = document.getElementById("iuCalTimeWheelHost");
        if (twSide && !twSide.hidden){ closeTimeWheel(); return; }
        if (state.inline){ cancelInlineEditor(); return; }
        closeDesktopSidePanel();
        return;
      }
      e.preventDefault();
      const tw = document.getElementById("iuCalTimeWheelHost");
      if (tw && !tw.hidden){ closeTimeWheel(); return; }
      if (state.inline){ cancelInlineEditor(); return; }
      closeOverlay();
      return;
    }
    if (e.key !== "Tab") return;
    const delConfirmTab = document.getElementById("iuCalDeleteConfirm");
    if (delConfirmTab && !delConfirmTab.hidden){
      const dclist = Array.from(delConfirmTab.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el)=>!el.disabled && el.offsetParent !== null);
      if (dclist.length){
        const first = dclist[0];
        const last = dclist[dclist.length - 1];
        if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
        else if (!dclist.includes(document.activeElement)){ e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (daySurfaceOpen && dayOv){
      const list = Array.from(dayOv.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el)=>!el.disabled && el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      return;
    }
    if (!ov || ov.hidden) return;
    const list2 = Array.from(ov.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el)=>!el.disabled && el.offsetParent !== null);
    if (!list2.length) return;
    const first2 = list2[0];
    const last2 = list2[list2.length - 1];
    if (e.shiftKey && document.activeElement === first2){ e.preventDefault(); last2.focus(); }
    else if (!e.shiftKey && document.activeElement === last2){ e.preventDefault(); first2.focus(); }
  }

  function render(){
    renderViewButtons();
    renderPeriodLabel();
    renderView();
    syncBridgeFormFields();
    syncMobileCalendarChrome();
    syncMobileDayOverlayDom();
    renderDesktopSidePanel();
    syncMonthYearActionBar();
    syncCalBottomSheet();
    syncCalendarScrollLocks();
  }

  function renderViewButtons(){
    document.querySelectorAll("[data-iu-cal-view]").forEach((btn)=>{
      const active = btn.getAttribute("data-iu-cal-view") === state.view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderPeriodLabel(){
    const el = document.getElementById("iuCalendarPeriodLabel");
    if (!el) return;
    if (state.dayOpen && !isCalDesktopTwoPanel()){
      const d0 = new Date(state.selectedDate + "T12:00:00");
      el.textContent = d0.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      return;
    }
    const d = new Date(state.cursorDate + "T00:00:00");
    if (state.view === "month") el.textContent = d.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
    else el.textContent = String(d.getFullYear());
  }

  function eventSlotHour(ev){
    if (isEventAllDay(ev)) return -1;
    const parts = String(ev.time || "09:00").split(":");
    let h = parseInt(parts[0], 10);
    if (!Number.isFinite(h)) h = 9;
    if (h < 1) return 1;
    if (h > 23) return 23;
    return h;
  }

  function getEventsInHourSlot(iso, slotH){
    return getEventsForDate(iso).filter((ev)=> !isEventAllDay(ev) && eventSlotHour(ev) === slotH).sort(compareEvents);
  }

  function nearestFutureEventIdOnDate(iso){
    const items = getEventsForDate(iso);
    const nowMs = Date.now();
    let nearestId = "";
    for (let i = 0; i < items.length; i++){
      const ev = items[i];
      if (parseDateTime(ev.date, ev.time).getTime() >= nowMs){ nearestId = ev.id; break; }
    }
    return nearestId;
  }

  function buildTimelineEventHtml(ev, nearestId){
    const addr = String(ev.address || "").trim();
    const note = String(ev.note || "").trim();
    const timeStr = formatEventTimeLabel(ev);
    const navBtn = addr
      ? '<button type="button" class="iu-calNavBtn" data-iu-cal-pin="' +
        esc(addr) +
        '" aria-label="Spustit navigaci">' +
        '<span class="iu-calNavBtn__icon" aria-hidden="true">📍</span>' +
        '<span class="iu-calNavBtn__label">Spustit navigaci</span></button>'
      : "";
    const actionsHtml = navBtn ? '<div class="iu-cal-event-actions">' + navBtn + "</div>" : "";
    const noteHtml = note ? '<div class="iu-cal-event-note" data-iu-cal-note-body="1">' + esc(note) + "</div>" : "";
    const nextCls = ev.id === nearestId ? " is-next-upcoming" : "";
    return (
      '<div class="iu-cal-row iu-event-row iu-has-event' +
      nextCls +
      '" data-iu-cal-ev-wrap="1">' +
      '<div class="iu-cal-time">' +
      esc(timeStr) +
      "</div>" +
      '<div class="iu-cal-event">' +
      '<button type="button" class="iu-cal-event-cardhit" data-iu-cal-open-event="' +
      esc(ev.id) +
      '" aria-label="' +
      esc(timeStr + " · " + String(ev.title || "")) +
      '">' +
      '<span class="iu-cal-event-title">' +
      esc(ev.title) +
      "</span>" +
      noteHtml +
      "</button>" +
      actionsHtml +
      "</div></div>"
    );
  }

  function defaultDateForMonthQuickAdd(){
    const today = toDateOnly(new Date());
    const cur = new Date(state.cursorDate + "T12:00:00");
    if (!Number.isFinite(cur.getTime())) return today;
    const cy = cur.getFullYear();
    const cm = cur.getMonth();
    const sel = String(state.selectedDate || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(sel)){
      const sd = new Date(sel + "T12:00:00");
      if (Number.isFinite(sd.getTime()) && sd.getFullYear() === cy && sd.getMonth() === cm) return sel;
    }
    return today;
  }

  function openCalendarEventForm(options){
    const opt = options || {};
    const source = opt.source === "month" ? "month" : "day";
    const dateStr = String(opt.date != null ? opt.date : state.selectedDate || toDateOnly(new Date())).slice(0, 10);
    let timeStr = String(opt.time != null ? opt.time : "09:00").trim();
    const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
    if (!tm) timeStr = "09:00";
    else timeStr = pad(Math.min(23, Math.max(0, parseInt(tm[1], 10)))) + ":" + pad(Math.min(59, Math.max(0, parseInt(tm[2], 10))));
    const showDatePicker = !!opt.showDatePicker;
    state.currentEditId = "";
    state.inline = {
      mode: "new",
      date: dateStr,
      slotHour: eventSlotHour({ time: timeStr, date: dateStr }),
      time: timeStr,
      title: "",
      address: "",
      note: "",
      allDay: false,
      showDatePicker,
      formSource: source
    };
    if (isCalMobileLayout()) state.bottomSheetOpen = true;
    if (isCalDesktopTwoPanel()) state.searchOpen = false;
    if (source === "month"){
      state.dayOpen = false;
      state.mobileDayOverlayOpen = false;
    }
    render();
  }

  function syncInlineFormFromDom(root){
    if (!state.inline) return;
    const hosts = [];
    if (root && root.querySelector) hosts.push(root);
    else {
      const side = document.getElementById("iuCalendarSidePanelScroll");
      const main = document.getElementById("iuCalendarViewRoot");
      if (side) hosts.push(side);
      if (main) hosts.push(main);
    }
    for (let hi = 0; hi < hosts.length; hi++){
      const ir = hosts[hi].querySelector("[data-iu-cal-inline-root]");
      if (!ir) continue;
      ir.querySelectorAll("[data-iu-cal-inline-field]").forEach((inp)=>{
        const f = inp.getAttribute("data-iu-cal-inline-field");
        const v = inp.value || "";
        if (f === "title") state.inline.title = v;
        else if (f === "address") state.inline.address = v;
        else if (f === "note") state.inline.note = v;
        else if (f === "date") state.inline.date = String(v).slice(0, 10);
      });
      break;
    }
  }

  function refreshInlineAllDayUi(inlineRoot){
    if (!inlineRoot || !state.inline) return;
    const allDay = !!state.inline.allDay;
    const btn = inlineRoot.querySelector("[data-iu-cal-inline-all-day]");
    if (btn){
      btn.classList.toggle("is-on", allDay);
      btn.setAttribute("aria-checked", allDay ? "true" : "false");
    }
    const timeField = inlineRoot.querySelector(".iu-calInline__field--time");
    if (timeField){
      timeField.classList.toggle("is-hidden", allDay);
      if (allDay){
        timeField.setAttribute("hidden", "");
        timeField.setAttribute("aria-hidden", "true");
      } else {
        timeField.removeAttribute("hidden");
        timeField.removeAttribute("aria-hidden");
      }
    }
    const timeBtn = inlineRoot.querySelector("[data-iu-cal-inline-time-open]");
    if (timeBtn) timeBtn.classList.toggle("is-hidden", allDay);
  }

  function buildInlineEditorHtml(){
    const inl = state.inline;
    if (!inl) return "";
    const delBtn =
      inl.mode === "edit"
        ? '<button type="button" class="iu-calInline__btn iu-calInline__btn--delete" data-iu-cal-inline-delete="1">Odstranit</button>'
        : "";
    const allDay = !!inl.allDay;
    const inSheet = shouldUseCalBottomSheet();
    const inDesktopSideForm = isCalDesktopSideFormOnly();
    const showDate = inSheet || inDesktopSideForm || (inl.showDatePicker && inl.mode === "new" && !isCalDesktopTwoPanel());
    let dateBlock = "";
    if (showDate){
      dateBlock =
        '<div class="iu-calInline__field">' +
        '<span class="iu-calInline__label">Datum</span>' +
        '<input type="date" class="iu-calInline__inp iu-calInline__dateInput" data-iu-cal-inline-field="date" value="' +
        esc(String(inl.date || "").slice(0, 10)) +
        '" />' +
        "</div>";
    }
    const timeHidden = allDay ? " is-hidden" : "";
    const noticeBlock = state.calInlineNotice
      ? '<div class="iu-calInline__notice" role="alert" data-iu-cal-inline-notice="1">' +
        esc(state.calInlineNotice) +
        "</div>"
      : "";
    const timeBlock =
      '<div class="iu-calInline__field iu-calInline__field--time' +
      timeHidden +
      '"' +
      (allDay ? ' hidden aria-hidden="true"' : "") +
      ">" +
      '<span class="iu-calInline__label">Čas</span>' +
      '<button type="button" class="iu-calInline__timeBtn' +
      timeHidden +
      '" data-iu-cal-inline-time-open="1">' +
      esc(inl.time) +
      "</button></div>";
    return (
      '<div class="iu-calInline iu-calInline--premiumV2" data-iu-cal-inline-root="1" tabindex="-1">' +
      dateBlock +
      buildAllDayToggleHtml(allDay) +
      timeBlock +
      '<div class="iu-calInline__field">' +
      '<span class="iu-calInline__label">Název události</span>' +
      '<input class="iu-calInline__inp" data-iu-cal-inline-field="title" placeholder="Název události" maxlength="120" value="' +
      esc(inl.title) +
      '" />' +
      "</div>" +
      '<div class="iu-calInline__field">' +
      '<span class="iu-calInline__label">Adresa</span>' +
      '<input class="iu-calInline__inp" data-iu-cal-inline-field="address" placeholder="Adresa" maxlength="240" value="' +
      esc(inl.address) +
      '" />' +
      "</div>" +
      '<div class="iu-calInline__field">' +
      '<span class="iu-calInline__label">Poznámka</span>' +
      '<textarea class="iu-calInline__txt" data-iu-cal-inline-field="note" placeholder="Poznámka" maxlength="1000">' +
      esc(inl.note) +
      "</textarea></div>" +
      noticeBlock +
      '<div class="iu-calInline__actions iu-calInline__actions--stack">' +
      '<button type="button" class="iu-calInline__btn iu-calInline__btn--save" data-iu-cal-inline-save="1">Uložit</button>' +
      '<button type="button" class="iu-calInline__btn iu-calInline__btn--cancel" data-iu-cal-inline-cancel="1">Zrušit</button>' +
      delBtn +
      "</div></div>"
    );
  }

  function renderAllDaySectionHTML(iso){
    const items = getAllDayEventsForDate(iso);
    if (!items.length) return "";
    let list = "";
    for (let i = 0; i < items.length; i++){
      const ev = items[i];
      list +=
        '<button type="button" class="iu-calAllDayChip" data-iu-cal-open-event="' +
        esc(ev.id) +
        '" aria-label="' +
        esc("Celý den · " + String(ev.title || "")) +
        '"><span class="iu-calAllDayChip__title">' +
        esc(ev.title) +
        "</span></button>";
    }
    return (
      '<section class="iu-calAllDaySection" data-iu-cal-all-day-section="1">' +
      '<h3 class="iu-calAllDaySection__head">Celodenní události</h3>' +
      '<div class="iu-calAllDaySection__list">' +
      list +
      "</div></section>"
    );
  }

  function renderDayHolidayBannerHTML(iso){
    const nm = getHolidayNameForDate(iso);
    if (!nm) return "";
    return '<div class="iu-calDayHolidayBanner" role="status">' + esc(nm) + "</div>";
  }

  function renderDayAllDayDraftHTML(iso){
    const inl0 = state.inline;
    const showAllDayDraft =
      inl0 &&
      inl0.allDay &&
      !shouldUseCalBottomSheet() &&
      !isCalDesktopSideFormOnly();
    if (!showAllDayDraft) return "";
    return '<div class="iu-calAllDayDraft" data-iu-cal-all-day-draft="1">' + buildInlineEditorHtml() + "</div>";
  }

  function renderDayPinnedBlockHTML(iso){
    const skipBannerInsideHours = isCalMobileLayout() && state.dayOpen;
    const holiday = skipBannerInsideHours ? "" : renderDayHolidayBannerHTML(iso);
    const allDayHtml = renderAllDaySectionHTML(iso);
    const draftHtml = renderDayAllDayDraftHTML(iso);
    const combined = holiday + allDayHtml + draftHtml;
    if (!combined.trim()) return "";
    return '<div class="iu-calDayPinnedBlock" data-iu-cal-day-pinned-block="1">' + combined + "</div>";
  }

  function renderDayHoursOnlyHTML(iso){
    const skipBannerInsideHours = isCalMobileLayout() && state.dayOpen;
    const nearestId = nearestFutureEventIdOnDate(iso);
    let html = (skipBannerInsideHours ? renderDayHolidayBannerHTML(iso) : "") + '<div class="iu-calDayHoursRoot">';
    for (let slotH = 1; slotH <= 23; slotH++){
      const label = pad(slotH) + ":00";
      const evsAll = getEventsInHourSlot(iso, slotH);
      const inl = state.inline;
      const editingId = inl && inl.mode === "edit" ? String(inl.id || "") : "";
      const evs = evsAll.filter((ev)=> !editingId || ev.id !== editingId);
      const eventCount = evs.length;
      const showInline = inl && !inl.allDay && inl.slotHour === slotH && !shouldUseCalBottomSheet() && !isCalDesktopSideFormOnly();
      const showHourLabel = eventCount === 0 && !showInline;
      const evHtml = evs.map((ev)=> buildTimelineEventHtml(ev, nearestId)).join("");
      const inlineHtml = showInline ? buildInlineEditorHtml() : "";
      let padHtml = "";
      if (!showInline && eventCount === 0){
        padHtml = '<div class="iu-calSlotEmptyPad" data-iu-cal-slot-empty="' + slotH + '" title="Nová událost"></div>';
      }
      const slotSparse = eventCount === 0 && !showInline ? " iu-calHourSlot--sparse" : "";
      const eventsOnlyCls = eventCount > 0 || showInline ? " iu-calHourSlot--eventsOnly" : "";
      const slotCls = "iu-calHourSlot" + slotSparse + eventsOnlyCls;
      const hourBtn = showHourLabel
        ? '<button type="button" class="iu-calHourSlot__btn" data-iu-cal-hour-label="' +
          slotH +
          '">' +
          esc(label) +
          "</button>"
        : "";
      html +=
        '<div class="' +
        slotCls +
        '" data-iu-cal-hour-anchor="' +
        slotH +
        '">' +
        hourBtn +
        '<div class="iu-calHourSlot__body" data-iu-cal-slot-body="' +
        slotH +
        '">' +
        inlineHtml +
        evHtml +
        padHtml +
        "</div></div>";
    }
    html += "</div>";
    return html;
  }

  function syncDayViewPinnedAndHours(iso, opts){
    const opt = opts || {};
    const pinnedHtml = renderDayPinnedBlockHTML(iso);
    const hoursHtml = renderDayHoursOnlyHTML(iso);
    const mobPinned = document.querySelector("#iuCalendarDayOverlay [data-iu-cal-day-pinned-host]");
    const mobScroll = document.querySelector("#iuCalendarDayOverlay .iu-calendar-day-content");
    const deskPinned = document.getElementById("iuCalendarSidePanelPinned");
    const deskScroll = document.getElementById("iuCalendarSidePanelScroll");
    const hosts = [];
    if (state.mobileDayOverlayOpen && mobPinned && mobScroll){
      hosts.push({ pinned: mobPinned, scroll: mobScroll });
    } else if (state.dayOpen && isCalDesktopTwoPanel() && deskPinned && deskScroll){
      hosts.push({ pinned: deskPinned, scroll: deskScroll });
    }
    for (let hi = 0; hi < hosts.length; hi++){
      const h = hosts[hi];
      if (h.pinned){
        h.pinned.innerHTML = pinnedHtml;
        const hasPinned = !!pinnedHtml.trim();
        h.pinned.hidden = !hasPinned;
        h.pinned.setAttribute("aria-hidden", hasPinned ? "false" : "true");
        if (hasPinned){
          bindDayTimelineUi(h.pinned, iso);
          bindCalendarInlineEditorRoot(h.pinned, iso);
        }
      }
      if (h.scroll){
        const prevScroll = opt.preserveHourScroll ? h.scroll.scrollTop || 0 : 0;
        const prevIso = h.scroll.getAttribute("data-iu-cal-rendered-iso") || "";
        const isoChanged = prevIso !== iso;
        h.scroll.setAttribute("data-iu-cal-rendered-iso", iso);
        h.scroll.innerHTML = hoursHtml;
        bindDayTimelineUi(h.scroll, iso);
        bindCalendarInlineEditorRoot(h.scroll, iso);
        try{
          requestAnimationFrame(()=>{
            requestAnimationFrame(()=>{
              if (!opt.preserveHourScroll && (isoChanged || prevScroll === 0)) scrollCalendarDayToNow();
              else if (opt.preserveHourScroll) h.scroll.scrollTop = prevScroll;
            });
          });
        }catch{}
      }
    }
  }

  function renderDayHourlyTimelineHTML(iso){
    return renderDayPinnedBlockHTML(iso) + renderDayHoursOnlyHTML(iso);
  }

  function closeTimeWheel(){
    const host = document.getElementById("iuCalTimeWheelHost");
    if (host){
      host.innerHTML = "";
      host.hidden = true;
      host.setAttribute("aria-hidden", "true");
    }
  }

  function openTimeWheel(initialTime, onApply){
    const tw = document.getElementById("iuCalTimeWheelHost");
    if (!tw) return;
    const WHEEL_ITEM = 40;
    const HOUR_COUNT = 24;
    const MINUTE_STEPS = 12;
    const parts = String(initialTime || "09:00").split(":");
    let h = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    if (!Number.isFinite(h)) h = 9;
    if (!Number.isFinite(m)) m = 0;
    h = Math.min(23, Math.max(0, h));
    m = Math.min(59, Math.max(0, m));
    m = Math.round(m / 5) * 5;
    if (m === 60){ m = 0; h = Math.min(23, h + 1); }
    const mi = Math.min(MINUTE_STEPS - 1, Math.max(0, Math.round(m / 5)));
    let hourInner = '<div class="iu-calTimeWheel__pad" aria-hidden="true"></div>';
    for (let x = 0; x < HOUR_COUNT; x++) hourInner += '<div class="iu-calTimeWheel__item" role="option">' + pad(x) + "</div>";
    hourInner += '<div class="iu-calTimeWheel__pad" aria-hidden="true"></div>';
    let minInner = '<div class="iu-calTimeWheel__pad" aria-hidden="true"></div>';
    for (let s = 0; s < MINUTE_STEPS; s++) minInner += '<div class="iu-calTimeWheel__item" role="option">' + pad(s * 5) + "</div>";
    minInner += '<div class="iu-calTimeWheel__pad" aria-hidden="true"></div>';
    tw.innerHTML =
      '<div class="iu-calTimeWheel" role="dialog" aria-label="Čas">' +
      '<div class="iu-calTimeWheel__picker">' +
      '<div class="iu-calTimeWheel__highlight" aria-hidden="true"></div>' +
      '<div class="iu-calTimeWheel__col" data-iu-cal-tw-h tabindex="0" role="listbox" aria-label="Hodiny">' +
      hourInner +
      "</div>" +
      '<div class="iu-calTimeWheel__col" data-iu-cal-tw-m tabindex="0" role="listbox" aria-label="Minuty">' +
      minInner +
      "</div>" +
      "</div>" +
      '<div class="iu-calTimeWheel__actions">' +
      '<button type="button" class="iu-calTimeWheel__apply" data-iu-cal-tw-apply="1">OK</button>' +
      '<button type="button" class="iu-calTimeWheel__cancel" data-iu-cal-tw-cancel="1">Zrušit</button>' +
      "</div>" +
      "</div>";
    tw.hidden = false;
    tw.setAttribute("aria-hidden", "false");
    const hCol = tw.querySelector("[data-iu-cal-tw-h]");
    const mCol = tw.querySelector("[data-iu-cal-tw-m]");
    const attachWheelSnap = (scrollEl, itemCount)=>{
      if (!scrollEl) return;
      let t = 0;
      const snap = ()=>{
        const idx = Math.min(itemCount - 1, Math.max(0, Math.round(scrollEl.scrollTop / WHEEL_ITEM)));
        const top = idx * WHEEL_ITEM;
        if (Math.abs(scrollEl.scrollTop - top) > 0.5) scrollEl.scrollTo({ top, behavior: "smooth" });
      };
      scrollEl.addEventListener(
        "scroll",
        ()=>{
          clearTimeout(t);
          t = setTimeout(snap, 100);
        },
        { passive: true }
      );
      scrollEl.addEventListener(
        "pointerup",
        ()=>{
          setTimeout(snap, 48);
        },
        { passive: true }
      );
    };
    if (hCol) hCol.scrollTop = h * WHEEL_ITEM;
    if (mCol) mCol.scrollTop = mi * WHEEL_ITEM;
    attachWheelSnap(hCol, HOUR_COUNT);
    attachWheelSnap(mCol, MINUTE_STEPS);
    const ap = tw.querySelector("[data-iu-cal-tw-apply]");
    if (ap){
      ap.addEventListener("click", ()=>{
        if (!hCol || !mCol) return;
        const hi = Math.min(HOUR_COUNT - 1, Math.max(0, Math.round(hCol.scrollTop / WHEEL_ITEM)));
        const mxi = Math.min(MINUTE_STEPS - 1, Math.max(0, Math.round(mCol.scrollTop / WHEEL_ITEM)));
        const out = pad(hi) + ":" + pad(mxi * 5);
        closeTimeWheel();
        if (typeof onApply === "function") onApply(out);
      });
    }
    const ca = tw.querySelector("[data-iu-cal-tw-cancel]");
    if (ca){
      ca.addEventListener("click", ()=>{
        closeTimeWheel();
      });
    }
  }

  function scrollActiveInlineFormIntoView(host){
    if (shouldUseCalBottomSheet()) return;
    try{
      let searchRoot = host && host.querySelector ? host : null;
      if (!searchRoot){
        const sideScroll = document.getElementById("iuCalendarSidePanelScroll");
        const mainRoot = document.getElementById("iuCalendarViewRoot");
        if (sideScroll && sideScroll.querySelector("[data-iu-cal-inline-root]")) searchRoot = sideScroll;
        else searchRoot = mainRoot;
      }
      const ir = searchRoot ? searchRoot.querySelector("[data-iu-cal-inline-root]") : null;
      if (!ir || !ir.getBoundingClientRect) return;
      const dayContent = document.querySelector("#iuCalendarDayOverlay .iu-calendar-day-content");
      const pinnedHost = document.querySelector("#iuCalendarDayOverlay [data-iu-cal-day-pinned-host]");
      if (pinnedHost && pinnedHost.contains(ir)){
        return;
      }
      if (dayContent && dayContent.contains(ir)){
        ir.scrollIntoView({ block: "nearest", behavior: "auto", inline: "nearest" });
        return;
      }
      const vv = window.visualViewport;
      const kb = vv && (window.innerHeight || 0) > 0 ? Math.max(0, (window.innerHeight || 0) - (vv.height || 0) - (vv.offsetTop || 0)) : 0;
      const blockOpt = kb > 72 ? "center" : "nearest";
      ir.scrollIntoView({ block: blockOpt, behavior: "auto", inline: "nearest" });
    }catch{}
  }

  function scrollCalendarDayToNow(){
    const tryScroll = (host)=>{
      if (!host) return;
      let vis = true;
      try{
        vis = host.offsetParent !== null || (host.getClientRects && host.getClientRects().length > 0);
      }catch{}
      if (!vis) return;
      const now = new Date();
      const ch = Math.min(23, Math.max(1, now.getHours()));
      const el = host.querySelector("[data-iu-cal-hour-anchor=\"" + ch + "\"]");
      if (!el) return;
      try{
        const hr = host.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const target = host.scrollTop + (er.top - hr.top) - Math.max(0, (hr.height - er.height) / 2);
        host.scrollTo({ top: Math.max(0, target), behavior: "auto" });
      }catch{
        try{
          el.scrollIntoView({ block: "center", behavior: "auto" });
        }catch{}
      }
    };
    const mob = isCalMobileLayout();
    if (mob && state.mobileDayOverlayOpen){
      const host = document.querySelector("#iuCalendarDayOverlay .iu-calendar-day-content");
      tryScroll(host);
    } else if (state.dayOpen && isCalDesktopTwoPanel()){
      tryScroll(document.getElementById("iuCalendarSidePanelScroll"));
    } else tryScroll(document.getElementById("iuCalendarViewRoot"));
  }

  function cancelInlineEditor(){
    if (!state.inline) return;
    state.inline = null;
    state.currentEditId = "";
    state.bottomSheetOpen = false;
    clearCalInlineNotice();
    setMessage("");
    render();
    restoreCalendarScrollGuard();
  }

  async function saveInlineEditor(){
    const inl = state.inline;
    if (!inl) return;
    const inlineRoot = document.querySelector("[data-iu-cal-inline-root]");
    let syncRoot = null;
    if (inlineRoot){
      syncRoot = inlineRoot.closest(
        "[data-iu-cal-bs-scroll], #iuCalendarSidePanelScroll, .iu-calendar-day-content, [data-iu-cal-day-pinned-host]"
      );
    }
    if (syncRoot) syncInlineFormFromDom(syncRoot);
    const title = String(inl.title || "").trim();
    if (!title){ setCalInlineNotice("Vyplňte název."); return; }
    const id = inl.mode === "edit" ? String(inl.id || "") : "";
    const prevEv = id ? state.data.events.find((e)=>e.id === id) : null;
    const allDay = !!inl.allDay;
    const dateStr = String(inl.date || state.selectedDate || "").slice(0, 10);
    if (allDay){
      const excludeId = id;
      if (!canAddAllDayForDate(dateStr, excludeId)){
        setCalInlineNotice(CAL_ALL_DAY_LIMIT_MSG);
        return;
      }
    }
    const timeVal = allDay ? "00:00" : String(inl.time || "09:00");
    const base = sanitizeEvent({
      id: id || uid("evt"),
      date: dateStr,
      time: timeVal,
      allDay,
      title,
      note: String(inl.note || "").trim(),
      address: String(inl.address || "").trim(),
      type: prevEv ? prevEv.type : "personal",
      reminder: prevEv ? String(prevEv.reminder || "") : "",
      attachments: prevEv && Array.isArray(prevEv.attachments) ? prevEv.attachments : [],
      createdAt: id && prevEv ? prevEv.createdAt : Date.now(),
      updatedAt: Date.now()
    });
    if (!base){ setCalInlineNotice("Neplatná data."); return; }
    const idx = state.data.events.findIndex((e)=>e.id === base.id);
    if (idx >= 0) state.data.events[idx] = base;
    else state.data.events.push(base);
    state.data.events.sort(compareEvents);
    state.inline = null;
    state.bottomSheetOpen = false;
    state.currentEditId = base.id;
    state.selectedDate = base.date;
    state.cursorDate = base.date;
    clearCalInlineNotice();
    await writeStore();
    setMessage("");
    render();
    restoreCalendarScrollGuard();
  }

  async function deleteInlineEditor(){
    const inl = state.inline;
    if (!inl || inl.mode !== "edit" || !inl.id) return;
    closeCalDeleteConfirm();
    state.data.events = state.data.events.filter((e)=>e.id !== inl.id);
    state.inline = null;
    state.bottomSheetOpen = false;
    state.currentEditId = "";
    await writeStore();
    setMessage("");
    render();
    restoreCalendarScrollGuard();
  }

  function focusNewInlineTitleAfterRender(){
    try{
      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          const hosts = [
            document.getElementById("iuCalendarSidePanelScroll"),
            document.getElementById("iuCalendarViewRoot")
          ];
          for (let hi = 0; hi < hosts.length; hi++){
            const vr = hosts[hi];
            if (!vr) continue;
            const ir = vr.querySelector("[data-iu-cal-inline-root]");
            const ti = ir ? ir.querySelector("[data-iu-cal-inline-field=\"title\"]") : null;
            if (ti && ti.focus){
              ti.focus({ preventScroll: true });
              return;
            }
          }
        });
      });
    }catch{}
  }

  function syncCalBottomSheet(){
    const bs = document.getElementById("iuCalEventBottomSheet");
    if (!bs) return;
    const open = shouldUseCalBottomSheet();
    if (!open){
      bs.hidden = true;
      bs.setAttribute("aria-hidden", "true");
      state.bottomSheetOpen = false;
      syncCalendarScrollLocks();
      return;
    }
    state.bottomSheetOpen = true;
    const titleEl = bs.querySelector("#iuCalBottomSheetTitle");
    if (titleEl){
      titleEl.textContent = state.inline && state.inline.mode === "edit" ? "Upravit událost" : "Nová událost";
    }
    const scroll = bs.querySelector("[data-iu-cal-bs-scroll]");
    if (scroll){
      scroll.innerHTML = buildInlineEditorHtml();
      bindCalendarInlineEditorRoot(scroll, String(state.inline && state.inline.date || state.selectedDate || "").slice(0, 10));
    }
    bs.hidden = false;
    bs.setAttribute("aria-hidden", "false");
    syncCalendarScrollLocks();
    try{
      requestAnimationFrame(()=>{
        const ti = bs.querySelector("[data-iu-cal-inline-field=\"title\"]");
        if (ti && ti.focus) ti.focus({ preventScroll: true });
      });
    }catch{}
  }

  function closeCalBottomSheet(){
    state.bottomSheetOpen = false;
    state.inline = null;
    state.currentEditId = "";
    const bs = document.getElementById("iuCalEventBottomSheet");
    if (bs){
      bs.hidden = true;
      bs.setAttribute("aria-hidden", "true");
    }
    render();
    restoreCalendarScrollGuard();
  }

  function eventsInSearchScope(scope){
    const cur = new Date(state.cursorDate + "T12:00:00");
    const year = cur.getFullYear();
    const month = cur.getMonth();
    return state.data.events.filter((ev)=>{
      const d = new Date(ev.date + "T00:00:00");
      if (!Number.isFinite(d.getTime())) return false;
      if (scope === "year") return d.getFullYear() === year;
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }

  function calEventSearchNormalize(text){
    let s = String(text || "").toLowerCase();
    try{
      s = s.normalize("NFD").replace(/\p{M}/gu, "");
    }catch{
      s = s
        .replace(/[áàäâå]/g, "a")
        .replace(/[čć]/g, "c")
        .replace(/[ďđ]/g, "d")
        .replace(/[éèěëê]/g, "e")
        .replace(/[íìïî]/g, "i")
        .replace(/[ľĺ]/g, "l")
        .replace(/[ňń]/g, "n")
        .replace(/[óòöôő]/g, "o")
        .replace(/[řŕ]/g, "r")
        .replace(/[šś]/g, "s")
        .replace(/[ťţ]/g, "t")
        .replace(/[úùüûű]/g, "u")
        .replace(/[ýÿ]/g, "y")
        .replace(/[žź]/g, "z");
    }
    s = s.replace(/y/g, "i");
    return s.trim();
  }

  function searchCalendarEvents(query, scope){
    const qNorm = calEventSearchNormalize(query);
    const pool = eventsInSearchScope(scope);
    if (!qNorm) return [];
    return pool
      .filter((ev)=>{
        const hay = calEventSearchNormalize([ev.title, ev.note, ev.address].join(" "));
        return hay.indexOf(qNorm) >= 0;
      })
      .sort(compareEvents);
  }

  function renderSearchResultsTable(results){
    if (!results.length){
      return '<div class="iu-calSearchOverlay__empty">Žádná událost nebyla nalezena.</div>';
    }
    let rows = "";
    for (let i = 0; i < results.length; i++){
      const ev = results[i];
      const d = new Date(ev.date + "T12:00:00");
      rows +=
        "<tr data-iu-cal-search-row=\"" +
        esc(ev.id) +
        "\"><td class=\"col-num\">" +
        (i + 1) +
        "</td><td class=\"col-date\">" +
        esc(formatEventDateCs(ev.date)) +
        "</td><td class=\"col-day\">" +
        esc(calWeekdayAbbrev(d.getDay())) +
        "</td><td class=\"col-time\">" +
        esc(formatEventTimeLabel(ev)) +
        "</td><td class=\"col-event\">" +
        esc(ev.title) +
        "</td></tr>";
    }
    return (
      '<table class="iu-calSearchTable" aria-label="Výsledky hledání">' +
      "<thead><tr><th class=\"col-num\">#</th><th class=\"col-date\">Datum</th><th class=\"col-day\">Den</th><th class=\"col-time\">Čas</th><th class=\"col-event\">Událost</th></tr></thead>" +
      "<tbody>" +
      rows +
      "</tbody></table>"
    );
  }

  function resetEventSearchState(){
    state.searchQuery = "";
    state.searchResults = [];
  }

  function openEventSearch(scope){
    state.searchScope = scope === "year" ? "year" : "month";
    resetEventSearchState();
    state.searchOpen = true;
    if (isCalDesktopTwoPanel()){
      state.dayOpen = false;
      state.inline = null;
      state.currentEditId = "";
      render();
      return;
    }
    const ov = document.getElementById("iuCalEventSearchOverlay");
    if (!ov) return;
    const inp = ov.querySelector("[data-iu-cal-search-input]");
    const countEl = ov.querySelector("[data-iu-cal-search-count]");
    const resultsEl = ov.querySelector("[data-iu-cal-search-results]");
    if (inp) inp.value = "";
    if (countEl) countEl.textContent = "Nalezeno: 0 událostí";
    if (resultsEl) resultsEl.innerHTML = "";
    ov.hidden = false;
    ov.setAttribute("aria-hidden", "false");
    syncCalendarScrollLocks();
    try{
      if (inp && inp.focus) inp.focus({ preventScroll: true });
    }catch{}
  }

  function closeEventSearch(){
    state.searchOpen = false;
    resetEventSearchState();
    if (isCalDesktopTwoPanel()){
      render();
      syncCalendarScrollLocks();
      return;
    }
    const ov = document.getElementById("iuCalEventSearchOverlay");
    if (ov){
      ov.hidden = true;
      ov.setAttribute("aria-hidden", "true");
      const inp = ov.querySelector("[data-iu-cal-search-input]");
      const countEl = ov.querySelector("[data-iu-cal-search-count]");
      const resultsEl = ov.querySelector("[data-iu-cal-search-results]");
      if (inp) inp.value = "";
      if (countEl) countEl.textContent = "Nalezeno: 0 událostí";
      if (resultsEl) resultsEl.innerHTML = "";
    }
    syncCalendarScrollLocks();
  }

  function runEventSearch(){
    const els = getCalSearchElements();
    if (!els.resultsEl) return;
    const inp = els.inp;
    const countEl = els.countEl;
    const resultsEl = els.resultsEl;
    const q = inp ? String(inp.value || "") : "";
    state.searchQuery = q;
    state.searchResults = searchCalendarEvents(q, state.searchScope);
    const n = state.searchResults.length;
    if (countEl) countEl.textContent = "Nalezeno: " + n + " událostí";
    if (resultsEl) resultsEl.innerHTML = renderSearchResultsTable(state.searchResults);
    resultsEl.querySelectorAll("[data-iu-cal-search-row]").forEach((row)=>{
      row.addEventListener("click", ()=>{
        const id = row.getAttribute("data-iu-cal-search-row") || "";
        closeEventSearch();
        loadEventForEdit(id);
      });
    });
  }

  function bindCalPremiumUiOnce(){
    if (state.premiumUiBound) return;
    state.premiumUiBound = true;
    bindSidePanelSearchUiOnce();
    const bs = document.getElementById("iuCalEventBottomSheet");
    if (bs){
      bs.addEventListener("click", (ev)=>{
        const close = ev.target && ev.target.closest ? ev.target.closest("[data-iu-cal-bs-close]") : null;
        if (close){
          ev.preventDefault();
          if (state.inline && state.inline.mode === "edit") cancelInlineEditor();
          else closeCalBottomSheet();
        }
      });
    }
    const dc = document.getElementById("iuCalDeleteConfirm");
    if (dc){
      dc.addEventListener("click", (ev)=>{
        const yes = ev.target && ev.target.closest ? ev.target.closest("[data-iu-cal-delete-confirm-yes]") : null;
        const cancel = ev.target && ev.target.closest ? ev.target.closest("[data-iu-cal-delete-confirm-cancel]") : null;
        const panel = ev.target && ev.target.closest ? ev.target.closest(".iu-calDeleteConfirm__panel") : null;
        if (yes){
          ev.preventDefault();
          void deleteInlineEditor();
        } else if (cancel){
          ev.preventDefault();
          restoreCalendarScrollGuard();
        } else if (!panel){
          ev.preventDefault();
          restoreCalendarScrollGuard();
        }
      });
    }
    const so = document.getElementById("iuCalEventSearchOverlay");
    if (so){
      so.addEventListener("click", (ev)=>{
        const close = ev.target && ev.target.closest ? ev.target.closest("[data-iu-cal-search-close]") : null;
        if (close){
          ev.preventDefault();
          closeEventSearch();
        }
      });
      const form = so.querySelector("[data-iu-cal-search-form]");
      if (form){
        form.addEventListener("submit", (ev)=>{
          ev.preventDefault();
          runEventSearch();
        });
      }
    }
  }

  function bindCalendarInlineEditorRoot(root, iso){
    if (!root) return;
    const isoFallback = String(iso || state.selectedDate || "").slice(0, 10);
    const syncDateFromInput = (inp)=>{
      if (!state.inline) return;
      const v = String(inp.value || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      state.inline.date = v;
      state.inline.slotHour = eventSlotHour({ time: state.inline.time, date: v });
    };
    root.querySelectorAll("[data-iu-cal-inline-field=\"date\"]").forEach((inp)=>{
      inp.addEventListener("input", ()=>{ syncDateFromInput(inp); });
      inp.addEventListener("change", ()=>{ syncDateFromInput(inp); });
    });
    const inlineRoot = root.querySelector("[data-iu-cal-inline-root]");
    if (!inlineRoot) return;
    inlineRoot.querySelectorAll("[data-iu-cal-inline-field]").forEach((inp)=>{
      inp.addEventListener("input", ()=>{
        if (!state.inline) return;
        const f = inp.getAttribute("data-iu-cal-inline-field");
        const v = inp.value || "";
        if (f === "title") state.inline.title = v;
        else if (f === "address") state.inline.address = v;
        else if (f === "note") state.inline.note = v;
      });
    });
    const allDayBtn = inlineRoot.querySelector("[data-iu-cal-inline-all-day]");
    if (allDayBtn){
      allDayBtn.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        syncInlineFormFromDom(root);
        if (!state.inline) return;
        const turningOn = !state.inline.allDay;
        if (turningOn){
          const excludeId = state.inline.mode === "edit" ? String(state.inline.id || "") : "";
          const dateStr = String(state.inline.date || state.selectedDate || "").slice(0, 10);
          if (!canAddAllDayForDate(dateStr, excludeId)){
            setCalInlineNotice(CAL_ALL_DAY_LIMIT_MSG);
            return;
          }
        }
        clearCalInlineNotice();
        state.inline.allDay = !state.inline.allDay;
        if (state.inline.allDay){
          state.inline.slotHour = -1;
        } else if (state.inline.slotHour < 1){
          state.inline.slotHour = eventSlotHour({ time: state.inline.time, date: state.inline.date });
        }
        if (shouldUseCalBottomSheet()) syncCalBottomSheet();
        else if (isCalDesktopSideFormOnly()) refreshInlineAllDayUi(inlineRoot);
        else render();
      });
    }
    const tbtn = inlineRoot.querySelector("[data-iu-cal-inline-time-open]");
    if (tbtn) tbtn.addEventListener("click", (ev)=>{
      ev.preventDefault();
      if (!state.inline) return;
      openTimeWheel(state.inline.time, (picked)=>{
        const prev = state.inline.slotHour;
        state.inline.time = picked;
        state.inline.slotHour = eventSlotHour({ time: picked, date: state.inline.date || isoFallback });
        if (state.inline.slotHour === prev){
          const tb = root.querySelector("[data-iu-cal-inline-time-open]");
          if (tb) tb.textContent = picked;
        } else {
          render();
        }
      });
    });
    const saveBtn = inlineRoot.querySelector("[data-iu-cal-inline-save]");
    if (saveBtn) saveBtn.addEventListener("click", (ev)=>{ ev.preventDefault(); void saveInlineEditor(); });
    const cancelBtn = inlineRoot.querySelector("[data-iu-cal-inline-cancel]");
    if (cancelBtn) cancelBtn.addEventListener("click", (ev)=>{ ev.preventDefault(); cancelInlineEditor(); });
    const delBtn = inlineRoot.querySelector("[data-iu-cal-inline-delete]");
    if (delBtn) delBtn.addEventListener("click", (ev)=>{ ev.preventDefault(); requestDeleteInlineEditor(); });
    if (!shouldUseCalBottomSheet()){
      const ti0 = inlineRoot.querySelector("[data-iu-cal-inline-field=\"title\"]");
      if (ti0){
        ti0.addEventListener("focus", ()=>{
          try{
            requestAnimationFrame(()=>{
              requestAnimationFrame(()=>{ scrollActiveInlineFormIntoView(root); });
            });
          }catch{}
        });
      }
      try{
        requestAnimationFrame(()=>{
          requestAnimationFrame(()=>{
            scrollActiveInlineFormIntoView(root);
          });
        });
      }catch{}
    }
  }

  function bindDayTimelineUi(root, iso){
    if (!root) return;
    root.querySelectorAll("[data-iu-cal-open-event]").forEach((el)=>{
      el.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        loadEventForEdit(el.getAttribute("data-iu-cal-open-event") || "");
      });
    });
    root.querySelectorAll("[data-iu-cal-note-icon]").forEach((btn)=>{
      btn.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        const wrap = btn.closest("[data-iu-cal-ev-wrap]");
        const nb = wrap ? wrap.querySelector("[data-iu-cal-note-body]") : null;
        if (nb) nb.classList.toggle("is-open");
      });
    });
    root.querySelectorAll("[data-iu-cal-pin]").forEach((btn)=>{
      btn.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        const q = btn.getAttribute("data-iu-cal-pin") || "";
        if (!q) return;
        try{ window.open("https://mapy.cz/z?q=" + encodeURIComponent(q), "_blank", "noopener,noreferrer"); }catch{}
      });
    });
    root.querySelectorAll("[data-iu-cal-slot-empty]").forEach((emptySlotEl)=>{
      emptySlotEl.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        const sh = parseInt(String(emptySlotEl.getAttribute("data-iu-cal-slot-empty") || ""), 10);
        if (!Number.isFinite(sh) || sh < 1 || sh > 23) return;
        openCalendarEventForm({ source: "day", date: iso, time: pad(sh) + ":00", showDatePicker: false });
        focusNewInlineTitleAfterRender();
      });
    });
    root.querySelectorAll("[data-iu-cal-slot-body]").forEach((slotBody)=>{
      slotBody.addEventListener("click", (ev)=>{
        if (ev.target !== slotBody) return;
        const sh = parseInt(String(slotBody.getAttribute("data-iu-cal-slot-body") || ""), 10);
        if (!Number.isFinite(sh) || sh < 1 || sh > 23) return;
        if (state.inline && state.inline.slotHour === sh) return;
        ev.preventDefault();
        ev.stopPropagation();
        openCalendarEventForm({ source: "day", date: iso, time: pad(sh) + ":00", showDatePicker: false });
        focusNewInlineTitleAfterRender();
      });
    });
    root.querySelectorAll("[data-iu-cal-hour-label]").forEach((btn)=>{
      btn.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        const sh = parseInt(String(btn.getAttribute("data-iu-cal-hour-label") || ""), 10);
        if (!Number.isFinite(sh) || sh < 1 || sh > 23) return;
        const base = pad(sh) + ":00";
        openTimeWheel(state.inline ? state.inline.time : base, (picked)=>{
          const slotH = eventSlotHour({ time: picked, date: iso });
          if (state.inline){
            const prev = state.inline.slotHour;
            state.inline.time = picked;
            state.inline.slotHour = slotH;
            if (prev === slotH){
              const tb = root.querySelector("[data-iu-cal-inline-time-open]");
              if (tb) tb.textContent = picked;
            } else {
              render();
            }
          } else {
            openCalendarEventForm({ source: "day", date: iso, time: picked, showDatePicker: false });
            focusNewInlineTitleAfterRender();
          }
        });
      });
    });
  }

  function renderView(){
    const root = document.getElementById("iuCalendarViewRoot");
    if (!root) return;
    try { root.setAttribute("data-view", state.view); } catch {}
    if (state.view === "month"){
      root.innerHTML = renderMonthGrid(state.cursorDate);
    } else root.innerHTML = renderYearGrid(new Date(state.cursorDate + "T00:00:00").getFullYear());
    root.querySelectorAll("[data-iu-cal-select-date]").forEach((el)=>el.addEventListener("click", ()=>{
      const ds = el.getAttribute("data-iu-cal-select-date") || state.selectedDate;
      state.selectedDate = ds;
      state.cursorDate = ds;
      state.inline = null;
      state.searchOpen = false;
      if (isCalMobileLayout()){
        state.dayOpen = false;
        state.mobileDayOverlayOpen = true;
      } else {
        state.dayOpen = true;
        state.mobileDayOverlayOpen = false;
      }
      render();
    }));
    root.querySelectorAll("[data-iu-cal-year-month]").forEach((el)=>el.addEventListener("click", ()=>{
      const ds = String(el.getAttribute("data-iu-cal-year-month") || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
      state.view = "month";
      state.cursorDate = ds;
      state.selectedDate = ds;
      state.dayOpen = false;
      state.mobileDayOverlayOpen = false;
      state.inline = null;
      render();
    }));
    root.querySelectorAll("[data-iu-cal-open-event]").forEach((el)=>el.addEventListener("click", ()=>loadEventForEdit(el.getAttribute("data-iu-cal-open-event") || "")));
  }

  function renderMonthGrid(dateStr){
    const WK_ABBR = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
    const pivot = new Date(dateStr + "T00:00:00");
    const year = pivot.getFullYear();
    const month = pivot.getMonth();
    const first = new Date(year, month, 1);
    const firstWeekday = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - firstWeekday);
    const todayCmp = toDateOnly(new Date());
    let html = '<div class="iu-calMonthWrap">';
    html += '<div class="iu-calWkRow" aria-hidden="true">';
    for (let w = 0; w < 7; w++) html += '<div class="iu-calWkCell">' + esc(WK_ABBR[w]) + "</div>";
    html += "</div>";
    html += '<div class="iu-calGrid">';
    for (let i = 0; i < 42; i++){
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ds = toDateOnly(d);
      const isOut = d.getMonth() !== month;
      const isToday = ds === todayCmp;
      const isPastDay = !isToday && ds < todayCmp;
      const isFutureDay = !isToday && ds > todayCmp;
      const wk = d.getDay();
      const weekend = wk === 0 || wk === 6;
      const holiday = isHoliday(ds);
      const evsAll = getEventsForDate(ds);
      const evCount = evsAll.length;
      const hasEvents = evCount ? " has-events" : "";
      const isSelected = ds === state.selectedDate;
      const holBadge = holiday ? '<span class="iu-calDayCell__holBadge">Svátek</span>' : "";
      let dots = "";
      if (evCount){
        const n = Math.min(3, evCount);
        dots = '<div class="iu-calDayCell__dots">';
        for (let di = 0; di < n; di++) dots += '<span class="iu-calDayCell__dot"></span>';
        dots += "</div>";
      }
      html +=
        '<button type="button" class="iu-calDayCell' +
        (isOut ? " is-out" : "") +
        (isToday ? " is-today" : "") +
        (isSelected ? " is-selected" : "") +
        (weekend ? " is-weekend" : "") +
        (holiday ? " is-holiday" : "") +
        (isPastDay ? " is-past" : "") +
        (isFutureDay ? " is-future" : "") +
        hasEvents +
        '" data-iu-cal-select-date="' +
        esc(ds) +
        '"><span class="iu-calDayCell__num">' +
        d.getDate() +
        "</span>" +
        holBadge +
        dots +
        "</button>";
    }
    html += "</div></div>";
    return html;
  }

  function renderYearGrid(year){
    const cur = new Date();
    const curY = cur.getFullYear();
    const curM = cur.getMonth();
    let html = '<div class="iu-calYear">';
    for (let m = 0; m < 12; m++){
      const d = new Date(year, m, 1);
      const evc = getEventsForMonth(year, m);
      const isCurMonth = year === curY && m === curM;
      const monthCls = "iu-calYearMonth" + (isCurMonth ? " is-current-month" : "") + (evc ? " has-events" : " is-empty");
      html += `<button type="button" class="${monthCls}" data-iu-cal-year-month="${year}-${pad(m+1)}-01">${esc(d.toLocaleDateString("cs-CZ", { month: "long" }))}<div>${evc} událostí</div></button>`;
    }
    html += "</div>";
    return html;
  }
  function getEventsForMonth(year, month){ return state.data.events.filter((e)=>{ const d = new Date(e.date + "T00:00:00"); return d.getFullYear() === year && d.getMonth() === month; }).length; }

  function fillDayHeader(dateObj){
    const overlay = document.getElementById("iuCalendarDayOverlay");
    if (!overlay || !dateObj) return;
    const iso = toDateOnly(dateObj);
    const head = formatCalMobileDayHeading(iso);
    const nameEl = overlay.querySelector(".iu-day-name");
    const dateEl = overlay.querySelector(".iu-day-date");
    if (nameEl) nameEl.textContent = head.line1;
    if (dateEl) dateEl.textContent = head.line2;
  }

  function renderDayContent(dateObj){
    const overlay = document.getElementById("iuCalendarDayOverlay");
    if (!overlay || !dateObj) return;
    const iso = toDateOnly(dateObj);
    fillDayHeader(dateObj);
    syncDayViewPinnedAndHours(iso);
  }

  function closeDayOverlay(){
    if (!state.mobileDayOverlayOpen) return;
    closeTimeWheel();
    closeCalDeleteConfirm();
    state.mobileDayOverlayOpen = false;
    state.inline = null;
    state.bottomSheetOpen = false;
    state.currentEditId = "";
    const overlay = document.getElementById("iuCalendarDayOverlay");
    if (overlay){
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    render();
    restoreCalendarScrollGuard();
  }

  function syncMobileDayOverlayDom(){
    const overlay = document.getElementById("iuCalendarDayOverlay");
    if (!overlay) return;
    if (!isCalMobileLayout() && state.mobileDayOverlayOpen){
      state.mobileDayOverlayOpen = false;
    }
    if (!isCalMobileLayout() || !state.mobileDayOverlayOpen){
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      try{
        if (!state.mobileDayOverlayOpen) syncCalendarScrollLocks();
      }catch{}
      return;
    }
    const iso = String(state.selectedDate || "").trim() || toDateOnly(new Date());
    const d = new Date(iso + "T12:00:00");
    fillDayHeader(d);
    renderDayContent(d);
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    syncCalendarScrollLocks();
  }

  function syncMonthYearActionBar(){
    const bar = document.getElementById("iuCalMonthActionBar");
    const legacyFab = document.getElementById("iuCalMonthQuickAddBtn");
    const ov = getOverlay();
    if (legacyFab) legacyFab.hidden = true;
    if (!bar) return;
    if (!ov || ov.hidden){
      bar.hidden = true;
      const vr0 = document.getElementById("iuCalendarViewRoot");
      if (vr0) vr0.classList.remove("iu-calendarOverlay__viewRoot--monthFabPad");
      return;
    }
    const month = state.view === "month";
    const year = state.view === "year";
    const mob = isCalMobileLayout();
    const editing = !!(state.inline && state.inline.showDatePicker && state.inline.mode === "new");
    let show;
    if (mob){
      show = (month || year) && !state.dayOpen && !state.mobileDayOverlayOpen && !editing && !state.searchOpen;
    } else {
      show = (month || year) && !state.mobileDayOverlayOpen && !isCalDesktopSideFormOnly();
    }
    bar.hidden = !show;
    bar.classList.toggle("iu-calMonthActionBar--yearOnly", year && !month);
    const vr = document.getElementById("iuCalendarViewRoot");
    if (vr) vr.classList.toggle("iu-calendarOverlay__viewRoot--monthFabPad", show);
    if (!show){
      bar.innerHTML = "";
      return;
    }
    let html = "";
    html +=
      '<button type="button" class="iu-calSearchFab" data-iu-cal-search-open="' +
      (year ? "year" : "month") +
      '" aria-label="Vyhledat událost"><span class="iu-calSearchFab__icon" aria-hidden="true">🔍</span><span class="iu-calSearchFab__text"> Vyhledat událost</span></button>';
    if (month){
      html +=
        '<button type="button" class="iu-calMonthFab" data-iu-cal-month-fab="1" aria-label="Přidat událost"><span class="iu-calMonthFab__icon" aria-hidden="true">+</span><span class="iu-calMonthFab__text"> Přidat událost</span></button>';
    }
    bar.innerHTML = html;
  }

  function syncMonthQuickAddFab(){
    syncMonthYearActionBar();
  }

  function syncMobileCalendarChrome(){
    const ov = getOverlay();
    if (!ov) return;
    const mob = isCalMobileLayout();
    const sideOpen = !mob && isCalSidePanelOpen();
    ov.classList.toggle("iu-calendarOverlay--premiumMob", mob);
    ov.classList.toggle("iu-calendarOverlay--mobileDay", false);
    ov.classList.toggle("iu-calendarOverlay--dayOpenDesktop", !mob && state.dayOpen);
    ov.classList.toggle("iu-calendarOverlay--sidePanelOpen", sideOpen);
    ov.classList.toggle("iu-calendarOverlay--calDayMode", mob && state.dayOpen);
    const side = document.getElementById("iuCalendarBridgeAside");
    if (side){
      if (mob){
        side.classList.remove("iu-calendarOverlay__side--layoutEmpty");
        if (sideOpen){
          side.removeAttribute("hidden");
          side.setAttribute("aria-hidden", "false");
        } else {
          side.setAttribute("hidden", "");
          side.setAttribute("aria-hidden", "true");
        }
      } else {
        side.removeAttribute("hidden");
        side.setAttribute("aria-hidden", sideOpen ? "false" : "true");
        side.classList.toggle("iu-calendarOverlay__side--layoutEmpty", !sideOpen);
      }
    }
  }

  function syncBridgeFormFields(){
    const form = document.getElementById("iuCalendarEventForm");
    if (!form || !form.elements) return;
    const evt = state.currentEditId ? state.data.events.find((e)=>e.id === state.currentEditId) : null;
    try{
      form.elements.id.value = evt ? evt.id : "";
      form.elements.date.value = evt ? evt.date : state.selectedDate;
      form.elements.time.value = evt ? evt.time : "";
      form.elements.title.value = evt ? evt.title : "";
      form.elements.note.value = evt ? evt.note : "";
      if (form.elements.address) form.elements.address.value = evt ? String(evt.address || "") : "";
      form.elements.type.value = evt ? evt.type : "personal";
    }catch{}
  }

  function loadEventForEdit(id){
    const ev = state.data.events.find((e)=>e.id === id);
    if (!ev) return;
    state.currentEditId = id;
    state.selectedDate = ev.date;
    state.cursorDate = ev.date;
    if (isCalMobileLayout()){
      state.dayOpen = false;
      state.mobileDayOverlayOpen = true;
    } else {
      state.dayOpen = true;
      state.mobileDayOverlayOpen = false;
    }
    state.inline = {
      mode: "edit",
      id: ev.id,
      date: ev.date,
      slotHour: isEventAllDay(ev) ? -1 : eventSlotHour(ev),
      time: ev.time,
      title: ev.title,
      address: String(ev.address || ""),
      note: String(ev.note || ""),
      allDay: isEventAllDay(ev)
    };
    if (isCalMobileLayout()) state.bottomSheetOpen = true;
    if (isCalDesktopTwoPanel()) state.searchOpen = false;
    setMessage("");
    render();
  }
  async function removeAttachment(attId){
    if (!state.currentEditId) return;
    const ev = state.data.events.find((e)=>e.id === state.currentEditId);
    if (!ev) return;
    ev.attachments = ev.attachments.filter((a)=>a.id !== attId);
    ev.updatedAt = Date.now();
    await writeStore();
    render();
  }

  async function upsertEventFromForm(){
    const form = document.getElementById("iuCalendarEventForm");
    if (!form) return;
    const id = String(form.elements.id.value || "");
    const prevEv = id ? state.data.events.find((e)=>e.id === id) : null;
    const addrFromForm = form.elements.address ? String(form.elements.address.value || "").trim() : "";
    const base = sanitizeEvent({
      id: id || uid("evt"),
      date: form.elements.date.value,
      time: form.elements.time.value,
      title: form.elements.title.value,
      note: form.elements.note.value,
      type: form.elements.type.value,
      address: addrFromForm || (prevEv && prevEv.address ? String(prevEv.address) : ""),
      reminder: prevEv && prevEv.reminder ? String(prevEv.reminder) : "",
      attachments: id ? (state.data.events.find((e)=>e.id === id)?.attachments || []) : [],
      createdAt: id ? (state.data.events.find((e)=>e.id === id)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    });
    if (!base){ setMessage("Vyplňte název, datum a čas."); return; }
    const idx = state.data.events.findIndex((e)=>e.id === base.id);
    if (idx >= 0) state.data.events[idx] = base;
    else state.data.events.push(base);
    state.data.events.sort(compareEvents);
    state.currentEditId = base.id;
    state.selectedDate = base.date;
    state.cursorDate = base.date;
    await writeStore();
    setMessage("Uloženo.");
    render();
  }

  async function deleteCurrentEvent(){
    if (!state.currentEditId){ setMessage("Vyberte událost."); return; }
    state.data.events = state.data.events.filter((e)=>e.id !== state.currentEditId);
    state.currentEditId = "";
    state.inline = null;
    await writeStore();
    setMessage("Smazáno.");
    render();
  }

  async function handlePhotoAdd(files){
    if (!state.currentEditId){ setMessage("Nejdřív uložte událost, pak přidejte fotky."); return; }
    const ev = state.data.events.find((e)=>e.id === state.currentEditId);
    if (!ev) return;
    const list = Array.from(files || []);
    for (const file of list){
      if (ev.attachments.length >= MAX_ATTACHMENTS){ setMessage("Maximálně " + MAX_ATTACHMENTS + " fotky na událost."); break; }
      try{
        const att = await optimizeImage(file);
        ev.attachments.push(att);
      }catch(err){
        setMessage(String(err && err.message ? err.message : "Fotku se nepodařilo zpracovat."));
      }
    }
    ev.updatedAt = Date.now();
    await writeStore();
    render();
  }

  async function optimizeImage(file){
    if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Povoleny jsou jen obrázky.");
    const img = await fileToImage(file);
    const ratio = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Nelze zpracovat obrázek.");
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.82;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (estimateBase64Bytes(data) > MAX_IMAGE_BYTES && quality > 0.5){
      quality -= 0.08;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    const size = estimateBase64Bytes(data);
    if (size > MAX_IMAGE_BYTES) throw new Error("Optimalizovaná fotka je stále příliš velká.");
    return { id: uid("att"), kind: "image", mimeType: "image/jpeg", data, width: w, height: h, size, createdAt: Date.now() };
  }
  function estimateBase64Bytes(data){ const b64 = String(data.split(",")[1] || ""); return Math.floor((b64.length * 3) / 4); }
  function fileToImage(file){
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onerror = ()=>reject(new Error("Soubor nelze číst."));
      fr.onload = ()=>{
        const img = new Image();
        img.onload = ()=>resolve(img);
        img.onerror = ()=>reject(new Error("Soubor není validní obrázek."));
        img.src = String(fr.result || "");
      };
      fr.readAsDataURL(file);
    });
  }

  function navPeriod(delta){
    state.inline = null;
    if ((state.dayOpen || state.mobileDayOverlayOpen) && !isCalDesktopTwoPanel()){
      const d = new Date(state.selectedDate + "T12:00:00");
      d.setDate(d.getDate() + delta);
      const nd = toDateOnly(d);
      state.selectedDate = nd;
      state.cursorDate = nd;
      render();
      return;
    }
    state.dayOpen = false;
    state.mobileDayOverlayOpen = false;
    const d = new Date(state.cursorDate + "T00:00:00");
    if (state.view === "month") d.setMonth(d.getMonth() + delta, 1);
    else d.setFullYear(d.getFullYear() + delta, 0, 1);
    state.cursorDate = toDateOnly(d);
    render();
  }

  function getTodayEvents(){ return getEventsForDate(toDateOnly(new Date())); }
  function getTomorrowEvents(){ return getEventsForDate(addDays(toDateOnly(new Date()), 1)); }
  function getNextEvent(){
    const now = new Date();
    const sorted = state.data.events.slice().sort(compareEvents);
    return sorted.find((e)=>parseDateTime(e.date, e.time).getTime() >= now.getTime()) || null;
  }

  function bindUi(){
    /* P1 lazy mount: the document-delegated open/close/nav listener must bind
       at boot even when the overlay still sits inside its <template>.
       Direct element bindings live in bindOverlayDirectUiOnce() (first open). */
    document.addEventListener("click", (e)=>{
      const t = e.target;
      const trigger = t && t.closest ? t.closest("[data-iu-calendar-trigger]") : null;
      const mmCalTrigger = t && t.closest ? t.closest(".iu-mmTopTool--cal") : null;
      if (trigger || mmCalTrigger){
        e.preventDefault();
        openOverlay((trigger || mmCalTrigger));
        return;
      }
      const close = t && t.closest ? t.closest("[data-iu-calendar-close]") : null;
      if (close){ e.preventDefault(); closeOverlay(); return; }
      const sideClose = t && t.closest ? t.closest("[data-iu-cal-side-close]") : null;
      if (sideClose){
        e.preventDefault();
        closeDesktopSidePanel();
        return;
      }
      const monthFab = t && t.closest ? t.closest("[data-iu-cal-month-fab]") : null;
      if (monthFab){
        e.preventDefault();
        const ov0 = getOverlay();
        if (!ov0 || ov0.hidden) return;
        if (state.view !== "month" || state.mobileDayOverlayOpen) return;
        if (state.dayOpen && !isCalDesktopTwoPanel()) return;
        const def = defaultDateForMonthQuickAdd();
        openCalendarEventForm({ source: "month", date: def, time: "09:00", showDatePicker: true });
        return;
      }
      const searchBtn = t && t.closest ? t.closest("[data-iu-cal-search-open]") : null;
      if (searchBtn){
        e.preventDefault();
        const scope = String(searchBtn.getAttribute("data-iu-cal-search-open") || "month");
        openEventSearch(scope);
        return;
      }
      const viewBtn = t && t.closest ? t.closest("[data-iu-cal-view]") : null;
      if (viewBtn){
        const v = String(viewBtn.getAttribute("data-iu-cal-view") || "");
        if (ALLOWED_VIEWS.has(v)){
          state.view = v;
          state.dayOpen = false;
          state.mobileDayOverlayOpen = false;
          state.searchOpen = false;
          state.inline = null;
          render();
        }
        return;
      }
      const navBtn = t && t.closest ? t.closest("[data-iu-cal-nav]") : null;
      if (navBtn){ navPeriod(Number(navBtn.getAttribute("data-iu-cal-nav") || 0)); return; }
      if (t && t.closest && t.closest("[data-iu-cal-today]")){
        state.cursorDate = toDateOnly(new Date());
        state.selectedDate = state.cursorDate;
        state.inline = null;
        if (isCalMobileLayout()){
          state.dayOpen = false;
          state.mobileDayOverlayOpen = true;
        } else {
          state.dayOpen = true;
          state.mobileDayOverlayOpen = false;
        }
        render();
        return;
      }
    });
  }

  async function init(){
    if (state.inited) return;
    /* P1 perf: do not inject calendar CSS or render overlay DOM during app.js eval.
       Styles + mount run on first openOverlay / ensureCalendarOverlayMounted. */
    await initStorage();
    await readStore();
    bindUi();
    try {
      window.addEventListener("iu-local-store-changed", function (ev) {
        try {
          if (!ev || !ev.detail || ev.detail.key !== STORE_KEY) return;
          /* Ignore echo from this tab's writeStore — otherwise rapid calendarCreateEvent races. */
          if (ev.detail.source === "iu-calendar-self") return;
          /* Same-tab durableSet/vaultSetItem echo — memory already holds the write; re-read races creates. */
          if (ev.detail.source === "iu-vault") return;
          /* durableSet emits mid-flight; do not clobber in-memory creates. */
          if (iuCalWriteInFlight > 0) return;
          void readStore().then(function () {
            try { render(); } catch (_) {}
          });
        } catch (_) {}
      });
    } catch (_) {}
    try {
      window.addEventListener("iu-vault-hydrated", function () {
        void readStore().then(function () {
          try { render(); } catch (_) {}
        });
      });
    } catch (_) {}
    try{
      if (!window.__iuCalVvInlineScroll && window.visualViewport){
        window.__iuCalVvInlineScroll = 1;
        window.visualViewport.addEventListener(
          "resize",
          ()=>{
            if (!state.inline) return;
            if (shouldUseCalBottomSheet()) return;
            const ir = document.querySelector("[data-iu-cal-inline-root]");
            if (!ir) return;
            try{
              ir.scrollIntoView({ block: "nearest", behavior: "auto", inline: "nearest" });
            }catch{}
          },
          { passive: true }
        );
      }
    }catch{}
    window.iuCalendarService = {
      calendarOpenTodayDayView: function(originEl){
        const today = toDateOnly(new Date());
        state.view = "month";
        state.cursorDate = today;
        state.selectedDate = today;
        state.inline = null;
        state.currentEditId = "";
        if (isCalMobileLayout()){
          state.dayOpen = false;
          state.mobileDayOverlayOpen = true;
        } else {
          state.dayOpen = true;
          state.mobileDayOverlayOpen = false;
        }
        render();
        openOverlay(originEl && typeof originEl.focus === "function" ? originEl : document.activeElement);
      },
      calendarOpenDayFromSilver: function(iso, originEl){
        const d = String(iso || "").trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        state.view = "month";
        state.cursorDate = d;
        state.selectedDate = d;
        state.inline = null;
        state.currentEditId = "";
        if (isCalMobileLayout()){
          state.dayOpen = false;
          state.mobileDayOverlayOpen = true;
        } else {
          state.dayOpen = true;
          state.mobileDayOverlayOpen = false;
        }
        render();
        openOverlay(originEl && typeof originEl.focus === "function" ? originEl : document.activeElement);
      },
      calendarCreateEvent: async function(payload){
        const dateStr = String(payload && payload.date || "").slice(0, 10);
        const allDay = !!(payload && payload.allDay);
        if (allDay && !canAddAllDayForDate(dateStr, "")){
          return { ok: false, reason: "all_day_limit" };
        }
        const ev = sanitizeEvent({
          ...payload,
          id: uid("evt"),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          address: payload && payload.address != null ? String(payload.address) : "",
          reminder: payload && payload.reminder != null ? String(payload.reminder) : "",
          attachments: Array.isArray(payload?.attachments) ? payload.attachments : []
        });
        if (!ev) return { ok: false, reason: "validation_failed" };
        state.data.events.push(ev);
        state.data.events.sort(compareEvents);
        let wrote = false;
        try {
          wrote = await writeStore();
        } catch (_) {
          wrote = false;
        }
        if (!wrote) {
          state.data.events = state.data.events.filter((e) => e && e.id !== ev.id);
          return { ok: false, reason: "persist_failed" };
        }
        render();
        return { ok: true, event: ev };
      },
      calendarGetTodayEvents: function(){ return getTodayEvents(); },
      calendarGetTomorrowEvents: function(){ return getTomorrowEvents(); },
      calendarGetNextEvent: function(){ return getNextEvent(); },
      calendarGetEventsSnapshot: function(){
        return state.data.events.slice().sort(compareEvents);
      },
      parseAndCreateFromText: async function(text){
        try {
          if (typeof window.iuEnsureSilverP0Engine === "function") await window.iuEnsureSilverP0Engine();
        } catch (_) {}
        const eng = window.iuSilverCalendarEngine;
        if (!eng || typeof eng.processUserTurn !== "function") return { ok: false, reason: "iuSilverCalendarEngine_unavailable" };
        const draft = eng.createEmptyDraft();
        const turn = eng.processUserTurn(text, draft, { now: new Date(), expectNoteInput: false });
        if (turn.processingState !== "READY_TO_SAVE"){
          return { ok: false, reason: turn.processingState, missingFields: turn.missingFields, detail: turn };
        }
        const d = turn.draft;
        const noteParts = [];
        if (d.note) noteParts.push(d.note);
        const noteJoined = noteParts.join("\n\n").slice(0, 1000);
        const addrDraft = String(d.address || "").trim() || String(d.location || "").trim();
        const remDraft = String(d.reminder || "").trim();
        return this.calendarCreateEvent({
          date: d.date,
          time: d.time,
          title: d.title,
          note: noteJoined,
          address: addrDraft,
          reminder: remDraft,
          type: "personal",
          attachments: []
        });
      },
      openOverlay: function(){ openOverlay(document.activeElement); },
      closeOverlay: function(){ closeOverlay(); }
    };
    state.inited = true;
    try{ if (typeof window.iuSilverCalendarSummaryRefresh === "function") window.iuSilverCalendarSummaryRefresh(); }catch{}
  }

  function bootCalendarOverlay() {
    return Promise.resolve(init()).then(function () {
      try {
        window.__iuCalendarOverlayInited = 1;
      } catch (_) {}
      try {
        window.__iuCalendarOverlayBooting = 0;
      } catch (_) {}
    });
  }

  var bootPromise =
    document.readyState === "loading"
      ? new Promise(function (resolve, reject) {
          document.addEventListener("DOMContentLoaded", function () {
            bootCalendarOverlay().then(resolve, reject);
          });
        })
      : bootCalendarOverlay();
  try {
    window.__iuCalendarOverlayBootPromise = bootPromise;
  } catch (_) {}
})();
    return window.__iuCalendarOverlayBootPromise || Promise.resolve();
  })().catch(function (err) {
    __iuCalendarModuleBootPromise = null;
    throw err;
  });
  return __iuCalendarModuleBootPromise;
}
