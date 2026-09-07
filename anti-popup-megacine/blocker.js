// Anti-Popup — parte ISOLATED world (v1.1.0).
//
// Este script TEM acesso às chrome.* APIs e ao DOM compartilhado, mas NÃO
// enxerga o mesmo `window` dos scripts da página. Por isso ele cuida só de:
//   1. Defesa de DOM (o DOM é compartilhado entre os worlds): interceptar
//      cliques em links externos, remover overlays/iframes de anúncio, CSS.
//   2. Receber os avisos do blocker-main.js (world MAIN) via postMessage e
//      repassar ao background para contagem/badge.
//   3. Informar ao background os gestos de SAÍDA de verdade (para ele saber
//      distinguir "usuário clicou num link" de "site sequestrou o clique").
//
// Os patches de JS (window.open, addEventListener, submit, location etc.)
// ficam no blocker-main.js — no isolated world eles NÃO afetariam a página.
(function () {
  "use strict";

  // console.log (não debug): no Chrome, console.debug cai no nível Verbose,
  // que fica oculto por padrão — os bloqueios precisam ser visíveis.
  const LOG = (...a) => console.log("%c[AntiPopup]", "color:#0af", ...a);

  // Anti anti-devtools (neutraliza console.clear; o patch que vale para a
  // página está no MAIN world, este protege o nosso próprio contexto).
  try {
    Object.defineProperty(console, "clear", {
      configurable: false,
      writable: false,
      value: function () {},
    });
  } catch (e) {}

  let blocked = 0;
  const bump = (what) => {
    blocked++;
    try {
      chrome.runtime.sendMessage({ type: "blocked", what });
    } catch (e) {}
    LOG("bloqueado:", what);
  };

  /* ---------------- Relay MAIN -> background ---------------- */
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__ap !== "blocked") return;
    bump(typeof d.what === "string" ? d.what : "main");
  });

  /* ---------------- Gestos de SAÍDA de verdade ----------------
   * Só contam como "o usuário quis sair da página":
   *   - auxclick (botão do meio) confiável em qualquer lugar;
   *   - Enter/Espaço no teclado;
   *   - clique confiável em <a href="..."> que não seja "#"/javascript:/vazio.
   *
   * Cliques genéricos (ex.: botão Play, que é div/button) NÃO contam — senão
   * o site sequestra o clique do Play para redirecionar e o background
   * deixaria passar achando que foi intenção do usuário. Era uma brecha real.
   */
  const notifyGesture = () => {
    try {
      chrome.runtime.sendMessage({ type: "gesture" });
    } catch (e) {}
  };
  window.addEventListener(
    "auxclick",
    (e) => {
      if (e.isTrusted) notifyGesture();
    },
    true
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.isTrusted && (e.key === "Enter" || e.key === " ")) notifyGesture();
    },
    true
  );
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted) return;
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = (a.getAttribute("href") || "").trim();
      if (!href || /^(#|javascript:)/i.test(href)) return;
      notifyGesture();
    },
    true
  );

  // Interação recente qualquer (só para o backup anti-submit abaixo).
  let lastRealClick = 0;
  ["click", "auxclick", "mousedown", "pointerdown", "keydown"].forEach((ev) =>
    window.addEventListener(
      ev,
      (e) => {
        if (e.isTrusted) lastRealClick = Date.now();
      },
      true
    )
  );
  const userJustActed = () => Date.now() - lastRealClick < 1200;

  const sameOrigin = (url) => {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  };

  /* ---------------- Neutraliza <a target=_blank> e links externos -------- */
  // Funciona no isolated world porque o DOM e a propagação de eventos são
  // compartilhados. Pega cliques reais E sintéticos (a.click() forjado).
  document.addEventListener(
    "click",
    function (e) {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";

      // Botão "Baixar Vídeo" do player usa <a download> + click() sintético:
      // é download legítimo, nunca popup (popunder não usa `download`).
      try {
        if (a.hasAttribute && a.hasAttribute("download")) return;
      } catch (_) {}

      // Links de anúncio / redirect externos
      if (href && !sameOrigin(href) && !/^(#|javascript:)/i.test(href)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        bump("link externo " + href);
        return;
      }
      if (a.target === "_blank") a.removeAttribute("target");
    },
    true
  );

  /* ---------------- Backup: submit p/ _blank sem gesto ------------------ */
  // O patch de HTMLFormElement.prototype.submit está no MAIN world (é lá que
  // ele funciona). Este listener é uma segunda barreira para submits que
  // disparam o evento 'submit'.
  document.addEventListener(
    "submit",
    function (e) {
      const f = e.target;
      if (f && f.target === "_blank" && !userJustActed()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        bump("form submit _blank");
      }
    },
    true
  );

  /* ---------------- Remove overlays e iframes de anúncio ----------------- */
  const AD_IFRAME_SEL = [
    "iframe[src*='ads']",
    "iframe[src*='popads']",
    "iframe[src*='propeller']",
    "iframe[src*='exoclick']",
    "iframe[src*='juicyads']",
    "iframe[src*='adsterra']",
    "iframe[src*='hilltop']",
    "iframe[src*='doubleclick']",
    "iframe[src*='banner']",
    "iframe[src*='urnstallols']",
    "iframe[src*='taylorbrining']",
    "iframe[src*='unwrynarcein']",
    "iframe[src*='grewiabromus']",
    "iframe[src*='dearthsongman']",
    "iframe[src*='a8king']",
    "iframe[width='300'][height='250']",
  ].join(",");

  // Analisa um único elemento (e seus descendentes fixed/absolute) e remove
  // overlays de clickjacking / iframes de anúncio. Evita varrer o DOM
  // inteiro a cada mutação — só inspeciona o que acabou de ser inserido.
  const PLAYER_RE = /player|jwplayer|\bjw[-_]|vjs[-_]|plyr|video-js|html5-video|media-player|play-overlay/i;
  const ADMARK_RE = /adserver|advert|(\b|-)ad(-|\b)|ads-|popup|banner|sponsor/i;
  const clsStr = (el) => {
    try {
      return String((el && el.id) || "") + " " + String((el && el.className) || "");
    } catch (_) {
      return "";
    }
  };
  // Descrição forense p/ o log: tag#id.classe tamanho z-index posição.
  const describeEl = (el) => {
    try {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      let cls = "";
      if (typeof el.className === "string" && el.className.trim()) {
        cls = "." + el.className.trim().split(/\s+/).slice(0, 3).join(".");
      }
      return (
        "<" + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls + "> " +
        Math.round(r.width) + "x" + Math.round(r.height) +
        " z=" + st.zIndex + " pos=" + st.position
      ).slice(0, 160);
    } catch (_) {
      return "(?)";
    }
  };
  const inspect = (root) => {
    if (!(root instanceof Element)) return;

    const vw = innerWidth,
      vh = innerHeight;
    const check = (el) => {
      // Proteção ABSOLUTA do container do player (v1.2.2): o viewplayer usa
      // #play.play-banner (absolute, z 99999, fullscreen) como container do
      // episódio — contém #player + chooser. Removê-lo apaga o player inteiro
      // (foi exatamente o que a forense flagrou). Vale para o elemento E
      // descendentes, e vence até a marcação de anúncio. Overlays de anúncio
      // reais são injetados no nível do body — continuam sendo removidos.
      try {
        if (el.closest && el.closest("#play, #player")) return;
      } catch (_) {}
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
      // Guardas anti-quebra do player (v1.1.1): nunca remove chrome do player
      // (ex.: overlay .jw-display do JWPlayer: absolute, 100% do player,
      // transparente, sem texto — indistinguível de clickjacking sem isso).
      const selfAndParent = clsStr(el) + " " + clsStr(el.parentNode);
      // Marcação explícita de anúncio vence: "video-ad" etc. NÃO é protegido.
      const adMarked = ADMARK_RE.test(selfAndParent);
      const inPlayerTree =
        !adMarked &&
        (PLAYER_RE.test(selfAndParent) ||
          (el.closest &&
            el.closest(
              "#player, #player-jwplayer, #player-preroll, .jwplayer, .video-js, .plyr"
            )));
      let parentHasVideo = false;
      if (!adMarked) {
        try {
          const par = el.parentElement;
          parentHasVideo = !!(par && par.querySelector && par.querySelector("video"));
        } catch (_) {}
      }
      if (inPlayerTree || parentHasVideo) return;
      // z-index alto continua sendo sinal forte de overlay de anúncio; sem
      // ele, exigimos MAIS confiança (cobrir quase 100% da tela, não só 85%)
      // pra reduzir falso positivo contra o próprio player.
      const reallyHuge = r.width >= vw * 0.97 && r.height >= vh * 0.97;
      const confident = z > 500 ? huge : reallyHuge;
      if (confident && (transparent || !el.textContent.trim()) && !isVideo) {
        const desc = describeEl(el);
        el.remove();
        bump("overlay clickjacking " + desc);
      }
    };

    check(root);
    root.querySelectorAll("*").forEach(check);

    // Card "Security alert" de scripts anti-devtools que pedem pra fechar o
    // navegador e não usar F12. Atrapalha exatamente a depuração do site.
    if (
      /security alert/i.test(root.textContent || "") &&
      /developer tools|f12/i.test(root.textContent || "")
    ) {
      root.remove();
      bump("aviso anti-devtools");
      return;
    }

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

  /* ---------------- CSS anti-anúncio ---------------- */
  const css = `
    a[href*="//ad."], a[href*="popads"], a[href*="propeller"],
    iframe[src*="urnstallols"], iframe[src*="taylorbrining"],
    iframe[src*="unwrynarcein"], iframe[src*="grewiabromus"],
    iframe[src*="dearthsongman"], iframe[src*="a8king"],
    .ads, .ad-container, .adsbygoogle, [id^="ad_"], [class*="banner-ad"],
    div[style*="z-index: 2147483647"]:not([id*="player"]):not([class*="player"]):not([class*="jw"]):not([id*="jw"]):not([class*="vjs"]):not([class*="plyr"]) { display: none !important; }
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
