// Anti-Popup & Anti-Redirect — roda em document_start, antes do JS da página.
(function () {
  "use strict";

  const LOG = (...a) => console.debug("%c[AntiPopup]", "color:#0af", ...a);
  let blocked = 0;
  const bump = (what) => {
    blocked++;
    try {
      chrome.runtime.sendMessage({ type: "blocked", what });
    } catch (e) {}
    LOG("bloqueado:", what);
  };

  // Só permite navegação se o usuário clicou de verdade nos últimos 1200ms
  let lastRealClick = 0;
  const userJustActed = () => Date.now() - lastRealClick < 1200;
  ["click", "auxclick", "keydown"].forEach((ev) =>
    window.addEventListener(
      ev,
      (e) => {
        if (e.isTrusted) lastRealClick = Date.now();
      },
      true
    )
  );

  /* ---------------- 1. window.open ---------------- */
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

  try {
    Object.defineProperty(window, "open", {
      configurable: false,
      writable: false,
      value: function () {
        bump("window.open " + (arguments[0] || ""));
        return fakeWindow;
      },
    });
  } catch (e) {}

  /* ---------------- 2. Redirecionamentos via location ----------------
   * REALIDADE DA PLATAFORMA (verificado por teste):
   * `location`, `location.href`, `assign` e `replace` são [LegacyUnforgeable]
   * na spec do HTML — propriedades próprias com configurable:false e
   * writable:false. Object.defineProperty sobre elas lança TypeError em
   * Chrome, Firefox e jsdom. NÃO existe forma de um content script
   * interceptar `location.href = "..."`.
   *
   * Portanto o patch abaixo é apenas oportunista (ajuda em motores exóticos
   * ou se o site usar um wrapper próprio) e falha silenciosamente no Chrome.
   * A DEFESA REAL contra redirect forçado está no background.js, que observa
   * webNavigation e desfaz navegações externas sem clique do usuário.
   */
  const sameOrigin = (url) => {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  };
  const allowNav = (url) => sameOrigin(url) || userJustActed();

  // (a1) assign / replace / href.
  // Os navegadores divergem em ONDE essas propriedades vivem:
  //   - Chrome/Firefox: em Location.prototype
  //   - jsdom e alguns motores: como propriedades próprias da instância
  // Por isso aplicamos o patch nos dois alvos.
  const locTargets = [];
  try {
    if (window.Location && window.Location.prototype) locTargets.push(window.Location.prototype);
  } catch (e) {}
  try {
    locTargets.push(window.location);
  } catch (e) {}

  locTargets.forEach((target) => {
    // métodos assign / replace
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
            bump("location." + m + " " + u);
          },
        });
      } catch (e) {}
    });

    // setter de href
    try {
      const hd = Object.getOwnPropertyDescriptor(target, "href");
      if (hd && hd.set && hd.configurable !== false) {
        Object.defineProperty(target, "href", {
          configurable: true,
          enumerable: hd.enumerable,
          get: hd.get,
          set: function (u) {
            if (allowNav(u)) return hd.set.call(this, u);
            bump("location.href " + u);
          },
        });
      }
    } catch (e) {}
  });

  // (a3) `window.location = "..."` / `document.location = "..."`.
  // Só é possível em navegadores onde a propriedade seja configurável;
  // se falhar, o background.js cobre o caso. Nunca deixamos lançar.
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
          else bump("location= " + u);
        },
      });
    } catch (e) {}
  });

  // (a4) Informa o background sobre gestos reais do usuário, para que ele
  // saiba distinguir navegação legítima de redirect forçado.
  const notifyGesture = () => {
    try {
      chrome.runtime.sendMessage({ type: "gesture" });
    } catch (e) {}
  };
  ["click", "auxclick", "keydown", "submit"].forEach((ev) =>
    window.addEventListener(ev, (e) => { if (e.isTrusted) notifyGesture(); }, true)
  );

  /* ---------------- 3. top / parent hijack ---------------- */
  // Anúncios em iframe tentam mexer no top. Neutraliza dentro de iframes.
  if (window.top !== window.self) {
    try {
      Object.defineProperty(window, "top", { get: () => window.self });
      Object.defineProperty(window, "parent", { get: () => window.self });
    } catch (e) {}
  }

  /* ---------------- 4. beforeunload / onbeforeunload spam ---------------- */
  try {
    Object.defineProperty(window, "onbeforeunload", {
      get: () => null,
      set: () => bump("onbeforeunload"),
    });
  } catch (e) {}

  /* ---------------- 5. Bloqueia addEventListener abusivo ---------------- */
  const nativeAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === "beforeunload" || type === "unload") {
      bump("listener " + type);
      return;
    }
    return nativeAEL.call(this, type, fn, opts);
  };

  /* ---------------- 6. Neutraliza <a target=_blank> e overlays ---------------- */
  document.addEventListener(
    "click",
    function (e) {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";

      // Links de anúncio / redirect externos
      if (href && !sameOrigin(href) && !/^(#|javascript:)/.test(href)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        bump("link externo " + href);
        return;
      }
      if (a.target === "_blank") a.removeAttribute("target");
    },
    true
  );

  /* ---------------- 7. Remove overlays invisíveis que capturam o 1º clique --------------- */
  const AD_IFRAME_SEL =
    "iframe[src*='ads'],iframe[src*='popads'],iframe[src*='propeller'],iframe[src*='exoclick'],iframe[src*='juicyads'],iframe[src*='adsterra'],iframe[src*='hilltop'],iframe[src*='doubleclick'],iframe[src*='banner'],iframe[width='300'][height='250']";

  // Analisa um único elemento (e seus descendentes fixed/absolute) e remove
  // overlays de clickjacking / iframes de anúncio. Evita varrer o DOM
  // inteiro a cada mutação — só inspeciona o que acabou de ser inserido.
  const inspect = (root) => {
    if (!(root instanceof Element)) return;

    const vw = innerWidth, vh = innerHeight;
    const check = (el) => {
      let s;
      try {
        s = getComputedStyle(el);
      } catch (_) {
        return;
      }
      if (s.position !== "fixed" && s.position !== "absolute") return;
      const r = el.getBoundingClientRect();
      const huge = r.width >= vw * 0.85 && r.height >= vh * 0.85;
      const z = parseInt(s.zIndex, 10) || 0;
      const transparent =
        s.backgroundColor === "rgba(0, 0, 0, 0)" || parseFloat(s.opacity) < 0.05;
      const isVideo = el.querySelector("video, iframe[src*='player']");
      if (huge && z > 500 && (transparent || !el.textContent.trim()) && !isVideo) {
        el.remove();
        bump("overlay clickjacking");
      }
    };

    check(root);
    root.querySelectorAll("*").forEach(check);

    if (root.matches(AD_IFRAME_SEL)) {
      root.remove();
      bump("iframe de anúncio");
      return;
    }
    root.querySelectorAll(AD_IFRAME_SEL).forEach((f) => {
      f.remove();
      bump("iframe de anúncio");
    });
  };

  const start = () => {
    inspect(document.body || document.documentElement);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach(inspect);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();

  /* ---------------- 8. Bloqueia form.submit automático ---------------- */
  const nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (!userJustActed() && this.target === "_blank") {
      bump("form.submit target=_blank");
      return;
    }
    return nativeSubmit.call(this);
  };

  /* ---------------- 9. CSS anti-anúncio ---------------- */
  const css = `
    a[href*="//ad."], a[href*="popads"], a[href*="propeller"],
    .ads, .ad-container, .adsbygoogle, [id^="ad_"], [class*="banner-ad"],
    div[style*="z-index: 2147483647"] { display: none !important; }
    html, body { overflow: auto !important; }
  `;
  const inject = () => {
    const st = document.createElement("style");
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  };
  document.documentElement ? inject() : addEventListener("DOMContentLoaded", inject);

  LOG("proteção ativa em", location.href);
})();
