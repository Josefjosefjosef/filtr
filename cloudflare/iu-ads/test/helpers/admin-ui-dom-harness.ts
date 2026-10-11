import { ADMIN_UI_SCRIPT } from "../../src/admin-ui-script";

type DomEl = {
  id: string;
  innerHTML: string;
  hidden: boolean;
  className: string;
  value: string;
  style: Record<string, string>;
  classList: {
    contains: (c: string) => boolean;
    add: (...c: string[]) => void;
    remove: (...c: string[]) => void;
  };
  onclick: null | (() => void);
  addEventListener: (type: string, fn: () => void) => void;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  removeAttribute: (k: string) => void;
  hasAttribute: (k: string) => boolean;
  dataset: Record<string, string>;
  checked: boolean;
  files: FileList | null;
};

function makeEl(id: string): DomEl {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const listeners: Array<{ type: string; fn: () => void }> = [];
  return {
    id,
    innerHTML: "",
    hidden: true,
    className: "",
    value: "",
    style: {},
    classList: {
      contains: (c) => classes.has(c),
      add: (...c) => {
        c.forEach((x) => classes.add(x));
      },
      remove: (...c) => {
        c.forEach((x) => classes.delete(x));
      },
    },
    onclick: null,
    addEventListener: (type, fn) => {
      listeners.push({ type, fn });
    },
    setAttribute: (k, v) => {
      attrs.set(k, v);
    },
    getAttribute: (k) => attrs.get(k) ?? null,
    removeAttribute: (k) => {
      attrs.delete(k);
    },
    hasAttribute: (k) => attrs.has(k),
    dataset: {},
    checked: false,
    files: null,
  };
}

export type AdminUiHarness = {
  getPanelHtml: () => string;
  renderView: (view: string) => Promise<void>;
};

/** Run admin SPA script in a minimal DOM; exposes render() for panel integration tests. */
export function createAdminUiHarness(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  scriptSource: string = ADMIN_UI_SCRIPT
): AdminUiHarness {
  const nodes = new Map<string, DomEl>();
  const ensure = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, makeEl(id));
    return nodes.get(id)!;
  };

  for (const id of [
    "panel",
    "nav",
    "login-view",
    "app-view",
    "header-actions",
    "gate-banner",
    "login-form",
    "login-err",
    "email",
    "password",
    "reset-form",
    "reset-email",
    "reset-msg",
    "btn-nav-toggle",
    "nav-backdrop",
    "activate-card",
    "activate-form",
    "activate-token",
    "activate-pass",
    "activate-pass2",
    "activate-err",
    "activate-ok",
  ]) {
    ensure(id);
  }

  const bodyEl = makeEl("body");
  const docEl = makeEl("documentElement");

  const g = globalThis as typeof globalThis & {
    document?: Document;
    window?: Window & typeof globalThis;
    fetch?: typeof fetch;
  };

  const prev = {
    document: g.document,
    window: g.window,
    fetch: g.fetch,
  };

  g.document = {
    getElementById: (id: string) => ensure(id),
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
    body: bodyEl as unknown as HTMLBodyElement,
    documentElement: docEl as unknown as HTMLElement,
    addEventListener: () => undefined,
  } as unknown as Document;

  g.window = g as unknown as Window & typeof globalThis;
  g.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : String(input);
    return apiFetch(path, init);
  };

  const hook =
    "window.__IU_ADS_ADMIN_TEST__={render:render,state:state,setLoggedIn:setLoggedIn,loadNav:loadNav};";
  const scriptBody = scriptSource.replace("  bootstrap();\n})();", hook + "\n})();");

  // eslint-disable-next-line no-eval
  eval(scriptBody);

  const testApi = (g.window as unknown as { __IU_ADS_ADMIN_TEST__?: {
    render: () => Promise<void>;
    state: { view: string; me: unknown; roles: string[] };
    setLoggedIn: (on: boolean) => void;
    loadNav: () => Promise<void>;
  } }).__IU_ADS_ADMIN_TEST__;

  if (!testApi) {
    g.document = prev.document;
    g.window = prev.window;
    g.fetch = prev.fetch;
    throw new Error("admin_ui_test_hook_missing");
  }

  testApi.state.me = { user_id: "adm_main", email: "admin@test.local", roles: ["main_admin"] };
  testApi.state.roles = ["main_admin"];
  testApi.setLoggedIn(true);

  return {
    getPanelHtml: () => ensure("panel").innerHTML,
    renderView: async (view: string) => {
      testApi.state.view = view;
      await testApi.render();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}
