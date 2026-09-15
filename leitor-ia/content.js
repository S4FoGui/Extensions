// ============================================================
// Leitor IA — content script (isolated world), 3 papéis:
// 1. Gaveta: painel dentro da própria aba (iframe panel.html),
//    aberto/fechado pelo ícone da extensão (nada desenhado antes).
// 2. Leitura: fornece o DOM da página ao background
//    (leitor-ia-getpage) — funciona até sem scripting permission.
// 3. Web Bridge: automação DOM da interface oficial do provedor
//    (aba oculta): digitação compatível com ProseMirror/Lexical,
//    MutationObserver p/ streaming da resposta, detecção de
//    barreira de login/Cloudflare e snapshot p/ resume.
// config.js é injetado antes (content_scripts) → PROVIDERS/web.
// ============================================================
(() => {
  if (window.top !== window) return; // só no frame principal
  // Guard: executeScript pode injetar este arquivo de novo numa aba que já
  // tem o content script do manifest → sem isso, cada injeção registra mais
  // um onMessage e a pergunta é digitada/enviada 2x, 3x, 4x…
  if (window.__leitorIaContentReady) return;
  window.__leitorIaContentReady = true;

  // ---------- mapa de seletores por host (vem do config.js) ----------
  const WEB = {};
  (typeof PROVIDERS !== "undefined" ? PROVIDERS : []).forEach((p) => {
    if (p.webUrl && p.web) {
      try {
        WEB[new URL(p.webUrl).host.replace(/^www\./, "")] = p.web;
      } catch (_) {}
    }
  });
  const GENERIC_ANSWERS = [
    "main article",
    'main [class*="markdown"]',
    'main [class*="prose"]',
    '[class*="message"] [class*="content"]',
    '[data-testid*="message"]',
    '[role="listitem"] article',
    '[data-message-author="assistant"]',
    '[data-message-author-role="assistant"]'
  ];

  const hostKey = () => location.host.replace(/^www\./, "");

  // ---------- gaveta do painel ----------
  let open = false;

  function ensureUI() {
    if (document.getElementById("leitor-ia-drawer")) return;
    const wrap = document.createElement("div");
    wrap.id = "leitor-ia-drawer";
    wrap.style.cssText =
      "position:fixed;top:0;right:0;height:100vh;width:min(420px,100vw);" +
      "z-index:2147483647;background:#f7f7f7;" +
      "box-shadow:-8px 0 32px rgba(0,0,0,.28);" +
      "transform:translateX(105%);transition:transform .25s ease;";
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("panel.html");
    iframe.title = "Leitor IA";
    iframe.style.cssText = "width:100%;height:100%;border:0;background:#f7f7f7;display:block;";
    wrap.appendChild(iframe);
    (document.documentElement || document.body).appendChild(wrap);
  }

  function toggle(force) {
    ensureUI();
    open = typeof force === "boolean" ? force : !open;
    const drawer = document.getElementById("leitor-ia-drawer");
    if (drawer) drawer.style.transform = open ? "translateX(0)" : "translateX(105%)";
  }

  // ---------- leitura da página (SPA-safe) ----------
  function extractLocalPage() {
    try {
      const selection = String(window.getSelection() || "").slice(0, 4000);
      let text = "";
      if (document.body) {
        const clone = document.body.cloneNode(true);
        const drop = "script,style,noscript,template,svg,canvas,iframe,object,embed,video,audio";
        clone.querySelectorAll(drop).forEach((n) => n.remove());
        clone.querySelectorAll("input,textarea,select,button").forEach((el) => {
          const label =
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.getAttribute("name") ||
            el.getAttribute("type") ||
            (el.tagName === "BUTTON" ? (el.textContent || "").trim() : "");
          const desc =
            "[" +
            el.tagName.toLowerCase() +
            (label ? ": " + String(label).replace(/\s+/g, " ").slice(0, 60) : "") +
            "]";
          el.replaceWith(document.createTextNode(" " + desc + " "));
        });
        text = (clone.innerText || clone.textContent || "")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
      const meta =
        (document.querySelector('meta[name="description"]') || {}).content ||
        (document.querySelector('meta[property="og:description"]') || {}).content ||
        "";
      return {
        ok: true,
        url: location.href,
        title: document.title || location.hostname,
        description: String(meta || ""),
        text: text.slice(0, 80000),
        selection: selection
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  // ---------- web bridge ----------
  function findComposer(cfg) {
    console.log("[Leitor IA] findComposer called, selectors:", cfg.composer);
    for (const s of cfg.composer || []) {
      const el = document.querySelector(s);
      console.log("[Leitor IA] Selector:", s, "→", el ? "FOUND" : "not found");
      if (el) return el;
    }
    console.log("[Leitor IA] No composer found!");
    return null;
  }

  // Digitação compatível com ProseMirror/Lexical/React:
  // focus → selectAll → insertText → InputEvent(inputType insertText).
  async function selectModel(cfg, modelId) {
    if (!cfg.modelSelectors || !cfg.modelSelectors.trigger || !modelId) return;
    const itemsMap = cfg.modelSelectors.items;
    if (!itemsMap || !itemsMap[modelId]) return;
    
    // Tenta encontrar o trigger de dropdown
    const trigger = document.querySelector(cfg.modelSelectors.trigger);
    if (!trigger) return;
    
    try {
      trigger.click();
      await new Promise(r => setTimeout(r, 400)); // Aguarda animação de menu
      
      let opt = document.querySelector(itemsMap[modelId]);
      
      // Fallback: se o seletor falhar, procura pelo nome do modelo no texto de itens de menu
      if (!opt) {
        const queryLabel = modelId.replace(/gemini-|claude-/i, "").replace(/-/g, " ");
        const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], mat-option, .mat-mdc-menu-item'));
        opt = items.find(el => el.innerText && el.innerText.toLowerCase().includes(queryLabel.toLowerCase()));
      }
      
      if (opt) {
        opt.click();
        await new Promise(r => setTimeout(r, 300));
      } else {
        trigger.click(); // Fecha o menu se não achou
      }
    } catch (_) {}
  }

  // Retorna Promise que resolve após clicar no botão enviar.
  // Insere arquivo de imagem na UI web (Drag & Drop simulado)
  async function insertImageToWeb(cfg, box, images) {
    if (!images || images.length === 0) return;
    
    const [base64] = images;
    const ext = base64.startsWith("data:image/jpeg") ? "jpg" : base64.startsWith("data:image/png") ? "png" : "jpg";
    const blob = await fetch(base64).then((r) => r.blob());
    const file = new File([blob], `image.${ext}`, { type: blob.type });
    
    // Tenta simular DnD no textarea
    const dt = new DataTransfer();
    dt.items.add(file);
    box.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
    box.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    box.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    box.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));
    
    // Espera alguns ms por upload
    await new Promise((r) => setTimeout(r, 250));
  }

  async function fillAndSend(cfg, box, text, modelId, images = []) {
    console.log("[Leitor IA] fillAndSend called, box:", box.tagName, box.className);
    await insertImageToWeb(cfg, box, images);
    await selectModel(cfg, modelId);
    return new Promise((resolve) => {
      box.focus();
      // Limpa conteúdo anterior
      let ok = false;
      try {
        document.execCommand("selectAll", false, null);
        ok = document.execCommand("insertText", false, text);
      } catch (_) {}
      if (!ok) {
        // Fallback: atribui diretamente
        if (box.tagName === "TEXTAREA" || box.tagName === "INPUT") {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, "value"
          ) || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          );
          if (nativeSetter && nativeSetter.set) {
            nativeSetter.set.call(box, text);
          } else {
            box.value = text;
          }
        } else {
          box.textContent = text;
        }
      }
      // Dispara eventos pra React/ProseMirror/Lexical detectar a mudança
      try {
        box.dispatchEvent(
          new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text })
        );
      } catch (_) {
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
      box.dispatchEvent(new Event("change", { bubbles: true }));

      // Espera o framework processar o texto, depois tenta enviar
      // com polling pra achar o botão habilitado (React pode demorar)
      const tryClick = (attempt) => {
        if (attempt > 8) {
          // Último recurso: Enter
          ["keydown", "keypress", "keyup"].forEach((t) =>
            box.dispatchEvent(
              new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
            )
          );
          setTimeout(resolve, 300);
          return;
        }
        let btn = null;
        for (const s of cfg.send || []) {
          btn = document.querySelector(s);
          if (btn && !btn.disabled) break;
          btn = null;
        }
        if (btn) {
          btn.click();
          setTimeout(resolve, 300);
        } else {
          setTimeout(() => tryClick(attempt + 1), 300);
        }
      };
      setTimeout(() => tryClick(0), 600);
    });
  }

  function loginBarrier(cfg) {
    if (/\/(login|signin|auth|challenge)/i.test(location.pathname + location.search)) return true;
    return (cfg.login || []).some((s) => !!document.querySelector(s));
  }

  function isUiLine(s) {
    const t = (s || "").trim();
    if (!t) return true;
    if (t.length > 120) return false;
    return (
      /^(copy|copied|retry|try again|share|edit|delete|stop|👍|how was|response options|new chat|regenerate|rename|font|tokens?|words?|chars?)/i.test(
        t
      ) || t.length <= 8
    );
  }

  function cleanTail(raw) {
    const lines = String(raw || "").split("\n");
    while (lines.length && isUiLine(lines[lines.length - 1])) lines.pop();
    while (lines.length && isUiLine(lines[0])) lines.shift();
    return lines.join("\n").trim();
  }

  // Encontra a ÚLTIMA mensagem do assistente (ignora thinking/collapse)
  function findLastAssistantAnswer(cfg, qSnippet) {
    const sels = (cfg.answer || []).concat(GENERIC_ANSWERS);
    for (const s of sels) {
      const all = document.querySelectorAll(s);
      if (all.length) {
        // Pega o último elemento que pareça ser do assistente
        for (let i = all.length - 1; i >= 0; i--) {
          const el = all[i];
          if (el.classList.contains("leitor-ia-old")) continue;
          
          let t = "";
          try {
            const c = el.cloneNode(true);
            // Remove blocos de thinking, details, copy buttons, UI elements, scripts e estilos
            c.querySelectorAll(
              'script,style,noscript,template,'
              + 'details,[class*="thinking"],[data-testid*="thinking"],[data-testid*="reasoning"],'
              + '[class*="thought"],[class*="reasoning"],.thinking,.tools,.plugin,[class*="plugin-"],'
              + '[class*="copy"],button,[role="group"],'
              + '[aria-label*="copy"],[aria-label*="Copy"],[aria-label*="Copiar"],'
              + '[aria-label*="Message actions"],[aria-label*="Reply"],'
              + 'svg,.sr-only,[class*="toolbar"],[class*="action"]'
            ).forEach((n) => n.remove());
            
            // Injeta marcação básica Markdown para não perder formatação no innerText
            c.querySelectorAll('pre').forEach(pre => { pre.prepend('```\n'); pre.append('\n```\n'); });
            c.querySelectorAll('code').forEach(cd => { 
              if(cd.parentNode && cd.parentNode.tagName !== 'PRE') { cd.prepend('`'); cd.append('`'); }
            });
            c.querySelectorAll('b, strong').forEach(b => { b.prepend('**'); b.append('**'); });
            c.querySelectorAll('i, em').forEach(i => { i.prepend('*'); i.append('*'); });
            c.querySelectorAll('li').forEach(li => { li.prepend('- '); });
            c.querySelectorAll('div, p, br, h1, h2, h3, h4, h5, h6').forEach(d => { d.append('\n'); });

            t = (c.innerText || "").trim();
          } catch (_) {
            t = (el.innerText || "").trim();
          }
          t = cleanTail(t);
          // Ignora a nossa própria pergunta
          if (t && !(qSnippet && t.includes(qSnippet))) return t;
        }
      }
    }
    return "";
  }

  // Fallback: pega tudo depois da pergunta no texto da página, sem lixo oculto
  function answerText(cfg, qSnippet) {
    const viaSel = findLastAssistantAnswer(cfg, qSnippet);
    if (viaSel) return viaSel;
    let bodyText = "";
    if (document.body) {
      try {
        const c = document.body.cloneNode(true);
        c.querySelectorAll(
          'script,style,noscript,template,'
          + 'details,[class*="thinking"],[data-testid*="thinking"],[data-testid*="reasoning"],'
          + '[class*="thought"],[class*="reasoning"],.thinking,.tools,.plugin,[class*="plugin-"],'
          + '[class*="copy"],button,[role="group"],'
          + '[aria-label*="copy"],[aria-label*="Copy"],[aria-label*="Copiar"],'
          + '[aria-label*="Message actions"],[aria-label*="Reply"],'
          + 'svg,.sr-only,[class*="toolbar"],[class*="action"]'
        ).forEach((n) => n.remove());
        
        c.querySelectorAll('pre').forEach(pre => { pre.prepend('```\n'); pre.append('\n```\n'); });
        c.querySelectorAll('code').forEach(cd => { 
          if(cd.parentNode && cd.parentNode.tagName !== 'PRE') { cd.prepend('`'); cd.append('`'); }
        });
        c.querySelectorAll('b, strong').forEach(b => { b.prepend('**'); b.append('**'); });
        c.querySelectorAll('i, em').forEach(i => { i.prepend('*'); i.append('*'); });
        c.querySelectorAll('li').forEach(li => { li.prepend('- '); });
        c.querySelectorAll('div, p, br').forEach(d => { d.append('\n'); });

        bodyText = c.innerText || "";
      } catch (_) {
        bodyText = document.body.innerText || "";
      }
    }
    if (qSnippet && bodyText.includes(qSnippet)) {
      return cleanTail(bodyText.slice(bodyText.lastIndexOf(qSnippet) + qSnippet.length));
    }
    return "";
  }

  function isGenerating(cfg) {
    // Checa seletores de stop (botão "Parar")
    if ((cfg.stop || []).some((s) => !!document.querySelector(s))) return true;
    // Checa seletores de generating/streaming (ex: .result-streaming)
    if ((cfg.generating || []).some((s) => !!document.querySelector(s))) return true;
    // Fallback: busca qualquer botão com label "stop" visível
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase().trim();
      if (/^(stop|stopping|parar)/.test(label) && !b.disabled && b.offsetParent !== null) return true;
    }
    return false;
  }

  // Indicadores de resposta COMPLETA (botão de copiar sob a bolha).
  const COPY_SELECTORS = [
    'button[aria-label*="Copy"]',
    'button[aria-label*="copy"]',
    'button[aria-label*="Copiar"]',
    '[data-testid*="copy"]',
    ".copy-button",
    'button[title*="Copy"]',
    'button[title*="copy"]',
    'button[title*="Copiar"]'
  ];
  function copyPresent() {
    return COPY_SELECTORS.some((s) => !!document.querySelector(s));
  }

  const post = (m) => {
    try {
      chrome.runtime.sendMessage(m);
    } catch (_) {}
  };

  // Estado p/ snapshot/resume (painel recarregado retoma o stream).
  const state = { reqId: null, text: "", done: false };

  // Watcher: MutationObserver + interval de 1s p/ conclusão/timeout (aba oculta).
  function watchAnswer(cfg, qSnippet, reqId) {
    state.reqId = reqId || state.reqId;
    state.text = "";
    state.done = false;
    let mo = null;
    let safety = null;
    let stable = 0;
    let ticks = 0;
    let lastEval = 0;
    let lastTextLength = 0;

    const finish = (t, error) => {
      console.log("[Leitor IA] watchAnswer finish called, text length:", t ? t.length : 0, "error:", error);
      if (state.done) return;
      state.done = true;
      state.text = t || state.text;
      if (mo) mo.disconnect();
      if (safety) clearInterval(safety);
      post({ type: "leitor-ia-web-done", reqId: state.reqId, text: state.text, error: error || null });
    };

    const evaluate = (force) => {
      const now = Date.now();
      if (!force && now - lastEval < 250) return;
      lastEval = now;
      ticks++;
      const t = answerText(cfg, qSnippet);
      console.log("[Leitor IA] evaluate tick:", ticks, "text found:", t ? "yes (" + t.length + " chars)" : "no", "isGenerating:", isGenerating(cfg), "copyPresent:", copyPresent(), "stable:", stable);
      if (t && t !== state.text) {
        // Detecta se o texto está crescendo (streaming) ou estabilizou
        const growing = t.length > lastTextLength;
        lastTextLength = t.length;
        
        if (growing) {
          stable = 0;
        } else {
          stable++;
        }
        
        state.text = t;
        post({ type: "leitor-ia-web-delta", reqId: state.reqId, text: t });
      } else if (t) {
        stable++;
      }
      
      // Fim da resposta: sem indicador "gerando" E (
      //   botão copiar presente OU
      //   silêncio prolongado (texto não cresce) OU
      //   resposta curta estabilizou
      // )
      // Enquanto o site mostra "gerando" (Stop visível), NUNCA conclui
      if (t && !isGenerating(cfg)) {
        if (copyPresent()) return finish(t);
        // Mais tolerância pra respostas longas (pode ser streaming lento)
        const stableThreshold = t.length < 100 ? 15 : t.length < 500 ? 12 : 10;
        if (stable >= stableThreshold) return finish(t);
      }
      // Timeout absoluto: 300s (5min) sem conclusão
      if (t && ticks > 300) return finish(t);
      // Fail-safe: 40s sem nenhum delta = erro claro
      if (!t && ticks > 40) {
        return finish(
          "",
          "Tempo limite esgotado ou modelo aguardando interação. Verifique a aba ou suas chaves."
        );
      }
    };

    try {
      mo = new MutationObserver(() => evaluate(false));
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (_) {
      mo = null;
    }
    safety = setInterval(() => evaluate(true), 1000);
  }

  // ---------- mensagens ----------
  async function handleAsk(m) {
    const cfg = WEB[hostKey()];
    if (!cfg) return { ok: false, error: "Esta aba não é um site de modelo." };
    const box = findComposer(cfg);
    if (!box) {
      return { ok: false, needLogin: true, reason: loginBarrier(cfg) ? "login" : "nocomposer" };
    }
    // Marca as bolhas antigas do assistente para não serem capturadas pela nova resposta
    const sels = (cfg.answer || []).concat([
      ".message-content", ".response-content", "model-response", ".model-response-text",
      '[data-message-author="assistant"]', 'div[class*="message"][class*="assistant"]'
    ]);
    for (const s of sels) {
      document.querySelectorAll(s).forEach((el) => el.classList.add("leitor-ia-old"));
    }
    // Registra já aqui: fillAndSend demora e o background pode reenviar.
    state.reqId = m.reqId || state.reqId;
    state.text = "";
    state.done = false;
    await fillAndSend(cfg, box, m.text || "", m.modelId, m.images || []);
    // qSnippet usa o final do texto para evitar corte no meio do prompt no fallback
    const qSnippet = (m.text || "").trim().slice(-80);
    watchAnswer(cfg, qSnippet, m.reqId);
    return { ok: true };
  }

  // IMPORTANTE: o listener NÃO pode ser async. No Chrome só `return true`
  // mantém o canal aberto para um sendResponse assíncrono; devolver uma
  // Promise fecha o canal na hora e o background nunca recebe a resposta
  // (era isso que fazia o webAsk tentar 12x e reenviar o prompt).
  chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
    if (!m) return false;
    if (m.type === "leitor-ia-ping") {
      sendResponse({ ok: true });
      return false;
    }
    if (m.type === "leitor-ia-toggle") {
      toggle();
      sendResponse({ ok: true });
      return false;
    }
    if (m.type === "leitor-ia-getpage") {
      sendResponse(extractLocalPage());
      return false;
    }
    if (m.type === "leitor-ia-snapshot") {
      sendResponse({ reqId: state.reqId, text: state.text, done: state.done });
      return false;
    }
    if (m.type === "leitor-ia-ask") {
      // Ignora reenvio do mesmo reqId (retry do background em corrida).
      if (m.reqId && m.reqId === state.reqId && !state.done) {
        sendResponse({ ok: true });
        return false;
      }
      handleAsk(m)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true; // resposta assíncrona
    }
    return false;
  });

  // Sem botão flutuante: o painel abre/fecha pelo ícone da extensão.
})();