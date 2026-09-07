// Anti-Popup — parte MAIN world (v1.1.0).
//
// Roda NO CONTEXTO DA PÁGINA (world: MAIN, document_start, antes de qualquer
// script do site), então estes patches AFETAM de verdade os scripts de anúncio.
//
// Por que isso existe: content scripts normais rodam num "isolated world" com
// um objeto `window` SEPARADO. Patchar `window.open` lá não muda nada para os
// scripts da página — eles continuam vendo o `window.open` original. Era por
// isso que os popups do megacine/viewplayer passavam direto na v1.0.
//
// IMPORTANTE: aqui NÃO existem chrome.* APIs. Relatórios de bloqueio vão para
// o blocker.js (isolated world) via window.postMessage.
(function () {
  "use strict";

  if (window.__apMainDone) return;
  window.__apMainDone = true;

  const report = (what) => {
    try {
      window.postMessage({ __ap: "blocked", what: String(what) }, "*");
    } catch (e) {}
  };

  // Gestos reais (só para o allowNav oportunista abaixo; o background tem
  // o próprio controle de gestos, mais rigoroso, alimentado pelo blocker.js).
  let lastRealClick = 0;
  const userJustActed = () => Date.now() - lastRealClick < 1200;
  ["click", "auxclick", "mousedown", "pointerdown", "keydown"].forEach((ev) =>
    window.addEventListener(
      ev,
      (e) => {
        if (e.isTrusted) lastRealClick = Date.now();
      },
      true
    )
  );

  /* ---------------- 0. console.clear -> no-op ----------------
   * Sites chamam console.clear() em loop pra esconder o debug. Este patch
   * PRECISA estar no MAIN world para afetar o console da página.
   * (O `debugger;` em loop que alguns soltam junto não dá pra bloquear via
   * JS — use "Deactivate breakpoints" no DevTools, Ctrl+F8 no painel
   * Sources, pra ignorar esses `debugger;`.)
   */
  try {
    Object.defineProperty(console, "clear", {
      configurable: false,
      writable: false,
      value: function () {},
    });
  } catch (e) {}

  /* ---------------- 1. window.open -> objeto falso ---------------- */
  const fakeWindow = new Proxy(
    {},
    {
      get(t, p) {
        if (p === "closed") return true;
        if (p === "document")
          return { write() {}, writeln() {}, close() {}, open() {}, body: null };
        if (p === "location")
          return new Proxy({}, { get: () => () => {}, set: () => true });
        if (typeof p === "string") return () => {};
        return undefined;
      },
      set: () => true,
      apply: () => {},
    }
  );

  // Camuflagem anti-detecção: alguns scripts testam
  // window.open.toString().indexOf("native code"). Captura a string nativa
  // ANTES de patchar e a replica no patch.
  let nativeOpenStr = "function open() { [native code] }";
  try {
    nativeOpenStr = Function.prototype.toString.call(window.open);
  } catch (e) {}

  function patchedOpen() {
    report("window.open " + (arguments[0] || ""));
    return fakeWindow;
  }
  try {
    patchedOpen.toString = () => nativeOpenStr;
  } catch (e) {}

  try {
    Object.defineProperty(window, "open", {
      configurable: false,
      writable: false,
      value: patchedOpen,
    });
  } catch (e) {
    try {
      window.open = patchedOpen;
    } catch (_) {}
  }

  // Bypass via <iframe> oculto (about:blank ou mesmo domínio) só para pegar
  // uma referência "limpa" de contentWindow.open não interceptada. Intercepta
  // o próprio getter de contentWindow/contentDocument e repassa o patch pro
  // window daquele frame, no instante do acesso.
  const patchOpen = (w) => {
    if (!w || w.__apPatched) return;
    try {
      w.__apPatched = true;
      Object.defineProperty(w, "open", {
        configurable: false,
        writable: false,
        value: function () {
          report("iframe window.open " + (arguments[0] || ""));
          return fakeWindow;
        },
      });
    } catch (e) {
      // cross-origin: não dá pra sobrescrever, mas também não é o vetor
      // usado nesse bypass (que depende de mesmo-origem)
    }
  };
  ["contentWindow", "contentDocument"].forEach((prop) => {
    try {
      const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, prop);
      if (!desc || !desc.get) return;
      Object.defineProperty(HTMLIFrameElement.prototype, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () {
          const v = desc.get.call(this);
          try {
            patchOpen(prop === "contentWindow" ? v : v && v.defaultView);
          } catch (_) {}
          return v;
        },
      });
    } catch (e) {}
  });

  /* ---------------- 2. Redirecionamentos via location (oportunista) ------
   * `location`, `location.href`, `assign` e `replace` são [LegacyUnforgeable]
   * — propriedades próprias com configurable:false. O patch abaixo é
   * oportunista e a DEFESA REAL contra redirect forçado está no background.js,
   * que observa webNavigation e desfaz navegações externas sem gesto de saída.
   */
  const sameOrigin = (url) => {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  };
  const allowNav = (url) => sameOrigin(url) || userJustActed();

  const locTargets = [];
  try {
    if (window.Location && window.Location.prototype) locTargets.push(window.Location.prototype);
  } catch (e) {}
  try {
    locTargets.push(window.location);
  } catch (e) {}

  locTargets.forEach((target) => {
    ["assign", "replace"].forEach((m) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(target, m);
        if (!desc || typeof desc.value !== "function") return;
        if (desc.configurable === false && desc.writable === false) return;
        const native = desc.value;
        Object.defineProperty(target, m, {
          configurable: true,
          writable: true,
          enumerable: desc.enumerable,
          value: function (u) {
            if (allowNav(u)) return native.call(this, u);
            report("location." + m + " " + u);
          },
        });
      } catch (e) {}
    });

    try {
      const hd = Object.getOwnPropertyDescriptor(target, "href");
      if (hd && hd.set && hd.configurable !== false) {
        Object.defineProperty(target, "href", {
          configurable: true,
          enumerable: hd.enumerable,
          get: hd.get,
          set: function (u) {
            if (allowNav(u)) return hd.set.call(this, u);
            report("location.href " + u);
          },
        });
      }
    } catch (e) {}
  });

  [window, document].forEach((obj) => {
    try {
      const d = Object.getOwnPropertyDescriptor(obj, "location");
      if (!d || !d.configurable) return; // Chrome: cai aqui, e tudo bem
      const real = obj.location;
      Object.defineProperty(obj, "location", {
        configurable: true,
        get: () => real,
        set: (u) => {
          if (allowNav(u)) real.href = u;
          else report("location= " + u);
        },
      });
    } catch (e) {}
  });

  /* ---------------- 3. top / parent: NÃO spoofar (v1.1.1) ----------------
   * A v1.0/v1.1 redefinia window.top/parent para o próprio frame dentro de
   * iframes. Isso muda o comportamento de players legítimos (o JWPlayer lê
   * window.top para detectar framing/idioma/host) e é REDUNDANTE: se um
   * iframe navegar o top para fora, o background.js (webNavigation) reverte;
   * se chamar top.open(), o patch de window.open do próprio top bloqueia.
   * Deliberadamente vazio — não mexer em top/parent.
   */

  /* ---------------- 4. beforeunload / unload spam ---------------- */
  try {
    Object.defineProperty(window, "onbeforeunload", {
      get: () => null,
      set: () => report("onbeforeunload"),
    });
  } catch (e) {}

  try {
    const nativeAEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (type === "beforeunload" || type === "unload") {
        report("listener " + type);
        return;
      }
      return nativeAEL.call(this, type, fn, opts);
    };
  } catch (e) {}

  /* ---------------- 4.5. Sequestro de document.onclick ---------------- */
  // Sites de anúncio reatribuem document.onclick/oncontextmenu pra capturar
  // QUALQUER clique na página e abrir popup por trás. Bloqueia a atribuição.
  ["onclick", "oncontextmenu"].forEach((prop) => {
    try {
      Object.defineProperty(document, prop, {
        configurable: false,
        get: () => null,
        set: () => {
          report("document." + prop + " hijack");
        },
      });
    } catch (e) {}
  });

  /* ---------------- 5. form.submit automático p/ _blank ---------------- */
  try {
    const nativeSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      if (!userJustActed() && this.target === "_blank") {
        report("form.submit target=_blank");
        return;
      }
      return nativeSubmit.call(this);
    };
  } catch (e) {}
})();
