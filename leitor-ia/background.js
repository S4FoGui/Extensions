// ============================================================
// Leitor IA — service worker (Manifest V3)
// Lê a página ativa e faz streaming das respostas dos modelos.
// ============================================================
// PROVIDERS e EFFORTS inlined from config.js (importScripts não funciona em SW MV3)
const PROVIDERS = [
  {
    id: "openai",
    name: "ChatGPT",
    consoleUrl: "https://platform.openai.com/api-keys",
    baseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-…",
    effortHint: "Controla o reasoning_effort (Extra/Máx equivalem a high na OpenAI).",
    webUrl: "https://chatgpt.com/",
    web: {
      composer: [
        'form[data-type="unified-composer"] #prompt-textarea[contenteditable="true"]',
        '#prompt-textarea.ProseMirror[contenteditable="true"]',
        '#prompt-textarea',
        '[data-testid="prompt-textarea"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"]'
      ],
      send: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send prompt"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="Enviar"]'
      ],
      answer: [
        'section[data-turn="assistant"] [data-message-author-role="assistant"]',
        '[data-message-author-role="assistant"]',
        '.markdown.prose',
        '.agent-turn',
        "main article"
      ],
      stop: [
        'button[data-testid="stop-button"]',
        'button[aria-label*="Stop"]',
        'button[aria-label*="Parar"]'
      ],
      generating: [
        '.result-streaming[aria-busy="true"]',
        '[data-testid*="thinking"]',
        '[data-testid*="reasoning"]'
      ],
      login: [
        'a[href*="login"]', 'a[href*="auth/login"]',
        'input[type="password"]',
        "#challenge-stage", ".cf-browser-verification", ".cloudflare-challenge"
      ]
    },
    models: [
      { id: "gpt-5.2", label: "GPT-5.2", effort: true, vision: true },
      { id: "gpt-5.2-pro", label: "GPT-5.2 Pro", effort: true, vision: true },
      { id: "gpt-5.1", label: "GPT-5.1", effort: true, vision: true },
      { id: "gpt-5-mini", label: "GPT-5 Mini", effort: true, vision: true },
      { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", effort: true, vision: true },
      { id: "o3", label: "o3 (raciocínio)", effort: true, vision: true },
      { id: "gpt-4.1", label: "GPT-4.1 (rápido)", effort: false, vision: true }
    ]
  },
  {
    id: "anthropic",
    name: "Claude",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    baseUrl: "https://api.anthropic.com/v1",
    keyPlaceholder: "sk-ant-…",
    effortHint: "Mesmos níveis de esforço do Claude web (low…max) via output_config.effort.",
    webUrl: "https://claude.ai/new",
    web: {
      composer: [
        '[data-testid="chat-input"]',
        'div.ProseMirror[contenteditable="true"]',
        'div.ProseMirror',
        '[data-placeholder][contenteditable]',
        '[aria-label="Message Claude"][contenteditable]',
        'div[role="textbox"][contenteditable]',
        'div[contenteditable="true"]'
      ],
      send: [
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="Send"]',
        'button[data-testid="send-button"]',
        'button[aria-label*="Enviar"]'
      ],
      answer: [
        '.font-claude-response',
        '[data-is-streaming]',
        '[data-testid="user-message"] ~ div',
        'div[class*="message"][class*="assistant"]',
        "main article"
      ],
      stop: [
        'button[aria-label*="Stop"]',
        'button[aria-label*="Stop generating"]',
        'button[aria-label*="Parar"]'
      ],
      generating: [
        '[data-is-streaming="true"]'
      ],
      login: [
        'a[href*="login"]', 'input[type="password"]',
        "#challenge-stage", ".cf-browser-verification"
      ]
    },
    models: [
      { id: "claude-sonnet-5", label: "Sonnet 5", effort: true, adaptive: true, vision: true },
      { id: "claude-opus-5", label: "Opus 5", effort: true, adaptive: true, vision: true },
      { id: "claude-fable-5-1", label: "Fable 5.1", effort: true, adaptive: true, vision: true },
      { id: "claude-haiku-4-5", label: "Haiku 4.5", effort: true, vision: true },
      { id: "claude-sonnet-4-5", label: "Sonnet 4.5 (legado)", effort: true, vision: true }
    ]
  },
  {
    id: "google",
    name: "Gemini",
    consoleUrl: "https://aistudio.google.com/apikey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyPlaceholder: "AIza…",
    effortHint: "Gemini 3: thinkingLevel · Gemini 2.5: thinkingBudget (Extra/Máx = high).",
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      scope: "https://www.googleapis.com/auth/generative-language"
    },
    webUrl: "https://gemini.google.com/app",
    web: {
      composer: [
        '.ql-editor',
        'rich-textarea [contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        '[aria-label*="message"][contenteditable]',
        'div[role="textbox"][contenteditable]',
        'div[contenteditable="true"]'
      ],
      send: [
        'button[aria-label="Send message"]',
        'button.send-button',
        'button[aria-label*="Send"]',
        'button[aria-label*="Enviar"]',
        'button[data-testid="send-button"]'
      ],
      answer: [
        'message-content',
        '.message-content',
        '.response-content',
        'model-response',
        '.model-response-text',
        '[data-message-author="assistant"]',
        '[data-response-index]'
      ],
      generating: [
        '.model-response-loading',
        'img[src*="sparkle"][class*="anim"]',
        '.pending-response'
      ],
      stop: [
        'button[aria-label*="Stop"]',
        '.stop-button',
        'button[aria-label*="Parar"]'
      ],
      login: [
        'input[type="email"]', 'a[href*="signin"]',
        "#challenge-stage", ".cf-browser-verification"
      ],
      modelSelectors: {
        trigger: '[data-test-id="bard-mode-menu-button"], bard-mode-switcher button, .model-picker-container button',
        items: {
          "gemini-3.1-pro": '[data-test-id="bard-mode-option-pro"], [data-model-id*="pro"]',
          "gemini-3.6-flash": '[data-test-id="bard-mode-option-fast"], [data-model-id*="flash"]',
          "gemini-3.5-flash-lite": '[data-test-id="bard-mode-option-flash-lite"], [data-model-id*="flash-lite"]',
          "gemini-2.5-flash": '[data-test-id="bard-mode-option-fast"]'
        }
      }
    },
    models: [
      { id: "gemini-3.1-pro", label: "3.1 Pro", effort: true, vision: true },
      { id: "gemini-3.6-flash", label: "3.6 Flash", effort: true, vision: true },
      { id: "gemini-3.5-flash-lite", label: "3.5 Flash Lite", effort: true, vision: true },
      { id: "gemini-2.5-flash", label: "2.5 Flash (legado)", effort: true, vision: true }
    ]
  },
  {
    id: "kimi",
    name: "Kimi",
    consoleUrl: "https://platform.moonshot.ai",
    baseUrl: "https://api.moonshot.ai/v1",
    keyPlaceholder: "sk-…",
    effortHint: "Como no Kimi web: o esforço liga (≥ Médio) ou desliga (Baixo) o raciocínio do K3.",
    webUrl: "https://kimi.ai/",
    web: {
      composer: ['div[contenteditable="true"][data-testid*="composer"]', 'div.ProseMirror', 'div[contenteditable="true"]', 'textarea[placeholder*="Mensagem"], textarea[placeholder*="Message"]'],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="Enviar"]', 'button[data-testid="send-button"]', 'button[type="submit"]', '.send-button'],
      answer: [
        'div[data-testid*="message"][data-testid*="assistant"]',
        'div[class*="message"][class*="assistant"]',
        '[data-message-author="assistant"]',
        '[data-role="assistant"]',
        'div.assistant-message',
        '.message-content'
      ],
      stop: ['button[aria-label*="Stop"]', 'button[aria-label*="Parar"]'],
      login: ['a[href*="login"]', 'input[type="password"]', "#challenge-stage", ".cf-browser-verification"]
    },
    models: [
      { id: "kimi-k3", label: "K3", effort: true, vision: true },
      { id: "kimi-k2.6", label: "Kimi K2.6", effort: false, vision: true },
      { id: "moonshot-v1-32k", label: "Moonshot v1 32k", effort: false, vision: false }
    ]
  },
  {
    id: "zai",
    name: "Z.AI (GLM)",
    consoleUrl: "https://z.ai/manage-apikey/api-keys",
    baseUrl: "https://api.z.ai/api/paas/v4",
    keyPlaceholder: "chave Z.AI…",
    effortHint: "Como o Deep Think do Z.ai: Baixo desliga; Médio+ liga o modo thinking.",
    webUrl: "https://chat.z.ai/",
    web: {
      composer: ['textarea#chat-input', 'textarea[placeholder*="build"]', 'div[contenteditable="true"][data-testid*="composer"]', 'div[contenteditable="true"]', 'textarea'],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="Enviar"]', 'button[data-testid="send-button"]', 'button[type="submit"]', '.send-button'],
      answer: [
        'div.assistant-message',
        '.message-content',
        'div[data-testid*="message"][data-testid*="assistant"]',
        'div[class*="message"][class*="assistant"]',
        '[data-message-author="assistant"]',
        '[data-role="assistant"]'
      ],
      stop: ['button[aria-label*="Stop"]', 'button[aria-label*="Parar"]'],
      login: ['a[href*="login"]', 'input[type="password"]', "#challenge-stage", ".cf-browser-verification"]
    },
    models: [
      { id: "glm-5.3", label: "GLM-5.3", effort: true, vision: true },
      { id: "glm-5.3-flash", label: "GLM-5.3-Flash", effort: true, vision: false },
      { id: "glm-5.2", label: "GLM-5.2", effort: true, vision: true }
    ]
  }
];

const EFFORTS = [
  { id: "low", label: "Baixo" },
  { id: "medium", label: "Médio" },
  { id: "high", label: "Alto" },
  { id: "xhigh", label: "Extra" },
  { id: "max", label: "Máx" }
];

// Abre o painel SEMPRE dentro do navegador (nunca abre app separado):
//  inpage    → gaveta dentro da própria aba (padrão; funciona em qualquer navegador)
//  sidepanel → painel nativo; se o navegador não tiver, cai para inpage
//  right/left→ janela encaixada — SÓ quando o usuário escolheu explicitamente
chrome.action.onClicked.addListener(async (tab) => {
  const s = await chrome.storage.local.get("prefs");
  const mode = (s.prefs && s.prefs.panelMode) || "inpage";
  if (mode === "left" || mode === "right") {
    await openDocked(mode).catch((e) => console.error("[Leitor IA]", e));
    return;
  }
  if (mode === "sidepanel") {
    try {
      await chrome.sidePanel.open(tab && tab.windowId ? { windowId: tab.windowId } : {});
      return;
    } catch (e) {
      console.error("[Leitor IA] sidePanel.open falhou; abrindo painel na página:", e);
    }
  }
  if (await toggleInPage(tab)) return;
  // Página restrita (chrome://, loja de extensões…) — avisa sem abrir nada.
  warnBadge();
});

// Avisa no ícone quando o painel não pôde abrir na aba atual.
function warnBadge() {
  try {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#141414" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), 6000);
  } catch (_) {}
}

// Abre/fecha a gaveta dentro da aba ativa. Se o content script ainda não
// estiver injetado (página aberta antes da instalação), injeta na hora.
async function toggleInPage(tab) {
  try {
    let target = tab;
    if (!target || !target.id) {
      const win = await chrome.windows
        .getLastFocused({ windowTypes: ["normal"] })
        .catch(() => null);
      [target] = await chrome.tabs.query(
        win ? { windowId: win.id, active: true } : { active: true, currentWindow: true }
      );
    }
    if (!target || !target.id) return false;
    try {
      await chrome.tabs.sendMessage(target.id, { type: "leitor-ia-toggle" });
    } catch (_) {
      await chrome.scripting.executeScript({
        target: { tabId: target.id },
        files: ["config.js", "content.js"]
      });
      await chrome.tabs.sendMessage(target.id, { type: "leitor-ia-toggle" });
    }
    return true;
  } catch (_) {
    return false; // aba interna/restrita — não dá para injetar
  }
}

// Retângulo da janela encaixada (puro, testável).
function computeDockRect(screen, side, panelWidth) {
  const w = Math.min(panelWidth || 430, screen.width || 1280);
  return {
    left: side === "left" ? (screen.left || 0) : Math.max(0, (screen.left || 0) + (screen.width || 0) - w),
    top: screen.top || 0,
    width: w,
    height: screen.height || 800
  };
}

async function openDocked(side) {
  const main = await chrome.windows
    .getLastFocused({ windowTypes: ["normal"] })
    .catch(() => null);
  const rect = computeDockRect(
    main || { left: 0, top: 0, width: 1280, height: 800 },
    side,
    430
  );
  const st = await chrome.storage.session.get("dockedWindow");
  if (st.dockedWindow) {
    try {
      await chrome.windows.update(st.dockedWindow, Object.assign({ focused: true }, rect));
      return;
    } catch (_) {}
  }
  const w = await chrome.windows.create(
    Object.assign({ url: chrome.runtime.getURL("panel.html"), type: "popup" }, rect)
  );
  chrome.storage.session.set({ dockedWindow: w.id });
}

chrome.windows.onRemoved.addListener((id) => {
  chrome.storage.session.get("dockedWindow").then((st) => {
    if (st.dockedWindow === id) chrome.storage.session.remove("dockedWindow");
  });
});

// Menu de contexto: enviar o texto selecionado para o painel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "leitor-ia-selection",
    title: "Perguntar ao Leitor IA",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "leitor-ia-selection" || !tab || !tab.id) return;
  chrome.storage.session.set({
    pendingSelection: String(info.selectionText || "").slice(0, 4000)
  });
  // Sempre dentro do navegador: painel nativo ou, se indisponível, na página.
  chrome.sidePanel.open({ tabId: tab.id }).catch((e) => {
    console.error("[Leitor IA] sidePanel.open falhou; abrindo painel na página:", e);
    toggleInPage(tab).then((ok) => {
      if (!ok) warnBadge();
    });
  });
});

// ------------------------------------------------------------
// Mensagens vindas do painel
// ------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "get-context") {
    getPageContext()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: friendlyError(e) }));
    return true; // resposta assíncrona
  }
  if (msg && msg.type === "oauth" || (msg && msg.type === "oauth-google")) {
    oauthProvider(msg.provider || "google")
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: friendlyError(e) }));
    return true;
  }
  if (msg && msg.type === "web-bridge") {
    webBridge(msg.provider, msg.text, msg.model)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: friendlyError(e) }));
    return true;
  }
  if (msg && msg.type === "web-ask") {
    webAsk(msg.provider, msg.text, msg.reqId, msg.model, msg.images || [])
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: friendlyError(e) }));
    return true;
  }
  if (msg && msg.type === "get-screenshot") {
    captureActiveTabScreenshot()
      .then((d) => sendResponse({ ok: true, dataUrl: d }))
      .catch((e) => sendResponse({ ok: false, error: friendlyError(e) }));
    return true;
  }
  if (msg && msg.type === "web-login") {
    (async () => {
      const s = await chrome.storage.session.get("webSession");
      const tabId = msg.tabId || ((s.webSession || {}).tabId);
      if (tabId) await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      return { ok: !!tabId };
    })().then(sendResponse);
    return true;
  }
  if (msg && msg.type === "web-resume") {
    (async () => {
      const s = await chrome.storage.session.get("webSession");
      const sess = s.webSession;
      if (!sess || !sess.tabId) return { ok: false };
      try {
        const snap = await chrome.tabs.sendMessage(sess.tabId, { type: "leitor-ia-snapshot" });
        return { ok: true, snapshot: snap, provider: sess.provider };
      } catch (_) {
        return { ok: false };
      }
    })().then(sendResponse);
    return true;
  }
  // Web grátis: o content script já usa chrome.runtime.sendMessage, que
  // chega DIRETO ao painel (é uma página da extensão). Reencaminhar aqui
  // duplicava cada delta/done. Apenas ignoramos.
  if (msg && (msg.type === "leitor-ia-web-delta" || msg.type === "leitor-ia-web-done")) {
    return false;
  }
  if (msg && msg.type === "web-reset") {
    // "+" novo chat no modo web: recarrega a aba oculta na URL limpa.
    (async () => {
      const s = await chrome.storage.session.get("webSession");
      const sess = s.webSession;
      if (!sess || !sess.tabId) return { ok: false };
      const provider = PROVIDERS.find((p) => p.id === sess.provider);
      if (!provider || !provider.webUrl) return { ok: false };
      await chrome.tabs.update(sess.tabId, { url: provider.webUrl }).catch(() => {});
      return { ok: true };
    })().then(sendResponse);
    return true;
  }
});

// ------------------------------------------------------------
// Ponte Web: usa a versão web OFICIAL do provedor (plano
// gratuito + login com Google) dentro de uma ABA do navegador
// — nunca cria janela/app separado. A extensão abre (ou foca)
// a aba do site e entrega o texto ao content script, que o
// insere na caixa de conversa do site e envia.
// ------------------------------------------------------------
// Injeta config.js/content.js só quando a aba ainda não responde.
// Injetar por cima do content script do manifest duplicava listeners
// (pergunta enviada várias vezes) e quebrava o config.js.
async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "leitor-ia-ping" });
    if (pong && pong.ok) return true;
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["config.js", "content.js"]
    });
    return true;
  } catch (e) {
    console.log("[Leitor IA BG] falha ao injetar content script:", e && e.message);
    return false;
  }
}

async function webBridge(providerId, text, modelId) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider || !provider.webUrl) {
    return { ok: false, error: "Este provedor não tem versão web." };
  }
  const origin = new URL(provider.webUrl).origin + "/";
  const open = await chrome.tabs.query({});
  let tab = (open || []).find((t) => t.url && t.url.indexOf(origin) === 0);
  if (!tab) {
    tab = await chrome.tabs.create({ url: provider.webUrl, active: false });
    await waitForTabLoad(tab.id, 12000);
  }
  await ensureContentScript(tab.id);
  
  // A aba pode estar carregando: tenta entregar por até ~6s.
  let delivered = false;
  for (let i = 0; i < 12 && !delivered; i++) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "leitor-ia-ask", text, modelId });
      delivered = true;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return { ok: delivered, tabId: tab.id, url: provider.webUrl };
}

// Web grátis SEM redirecionar o usuário: mantém uma aba no site do
// provedor (login com Google feito uma única vez); o content script dessa aba
// digita a pergunta, envia e devolve a resposta ao painel por mensagens.
// A aba é aberta ativa brevemente para evitar congelamento do Brave/Chromium,
// depois o foco volta para a aba do usuário.
// Captura a aba visível (visão multimodal) em JPEG/base64.
// Sempre captura a janela "normal" do navegador, mesmo quando
// o painel está numa janela popup/docked separada.
async function captureActiveTabScreenshot() {
  // Tenta janela focada primeiro
  try {
    const result = await chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 75 });
    if (result) return result;
  } catch (_) {}
  // Fallback: busca a janela "normal" (não popup do painel)
  try {
    const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
    for (const w of wins) {
      try {
        const r = await chrome.tabs.captureVisibleTab(w.id, { format: "jpeg", quality: 75 });
        if (r) return r;
      } catch (_) {}
    }
  } catch (_) {}
  throw new Error("Não consegui capturar a tela. Verifique se a aba está visível.");
}

// Aguarda a aba terminar de carregar (SPA pode demorar)
async function waitForTabLoad(tabId, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 10000);
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch (_) { return; }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function webAsk(providerId, text, reqId, modelId, images = []) {
  console.log("[Leitor IA BG] webAsk called", { providerId, reqId, modelId });
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider || !provider.webUrl) {
    return { ok: false, error: "Este provedor não tem versão web." };
  }
  const origin = new URL(provider.webUrl).origin + "/";
  const open = await chrome.tabs.query({});
  let tab = (open || []).find((t) => t.url && t.url.indexOf(origin) === 0);
  if (!tab) {
    console.log("[Leitor IA BG] Creating new tab for", provider.webUrl);
    tab = await chrome.tabs.create({ url: provider.webUrl, active: false });
    await waitForTabLoad(tab.id, 15000);
  } else {
    console.log("[Leitor IA BG] Found existing tab", tab.id, "for", origin);
  }
  // Injeta só se ainda não houver content script vivo nessa aba.
  await ensureContentScript(tab.id);
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  
  const askLoop = async () => {
    for (let i = 0; i < 12; i++) {
      try {
        console.log("[Leitor IA BG] askLoop attempt", i + 1, "sending leitor-ia-ask to tab", tab.id);
        const rr = await chrome.tabs.sendMessage(tab.id, {
          type: "leitor-ia-ask",
          text,
          reqId,
          modelId,
          images
        });
        console.log("[Leitor IA BG] askLoop response:", rr);
        if (rr && (rr.ok || rr.needLogin)) return rr;
      } catch (e) {
        console.log("[Leitor IA BG] askLoop error:", e.message);
      }
      await new Promise((res) => setTimeout(res, 500));
    }
    return null;
  };
  let r = await askLoop();
  if (r && r.ok) {
    await chrome.storage.session.set({
      webSession: { reqId: reqId, provider: providerId, tabId: tab.id }
    });
    return { ok: true, tabId: tab.id };
  }
  if (r && r.needLogin) {
    // Não ativa a aba sozinho: o painel mostra o botão "Fazer login".
    await chrome.storage.session.set({
      webSession: { reqId: reqId, provider: providerId, tabId: tab.id }
    });
    return { ok: false, needLogin: true, reason: r.reason || "login", tabId: tab.id };
  }
  return {
    ok: false,
    error: "Não consegui falar com o site do " + provider.name + ". Abra a aba dele e entre com sua conta."
  };
}

// ------------------------------------------------------------
// OAuth genérico: funciona para qualquer provedor que exponha
// OAuth público para uso dos modelos (hoje: Google/Gemini).
// ------------------------------------------------------------
function buildOAuthUrl(provider, clientId, redirectUri) {
  const oauth = provider && provider.oauth;
  const u = new URL((oauth && oauth.authUrl) || "https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "token");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", (oauth && oauth.scope) || "");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

// Compatibilidade: URL OAuth do Google.
function buildGoogleAuthUrl(clientId, redirectUri) {
  return buildOAuthUrl(PROVIDERS.find((p) => p.id === "google"), clientId, redirectUri);
}

function parseOAuthRedirect(url) {
  const frag = String(url || "").split("#")[1] || "";
  const params = new URLSearchParams(frag);
  const token = params.get("access_token");
  if (!token) {
    return { ok: false, error: params.get("error") || "Resposta OAuth sem access_token." };
  }
  return {
    ok: true,
    token: token,
    expiresIn: parseInt(params.get("expires_in") || "3600", 10)
  };
}

async function oauthProvider(providerId) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider || !provider.oauth) {
    return {
      ok: false,
      error:
        "O " +
        (provider ? provider.name : providerId) +
        " não oferece OAuth público para uso dos modelos — use chave de API."
    };
  }
  const s = await chrome.storage.local.get("oauth");
  const store = s.oauth || {};
  const clientId = String(((store.clientIds || {})[providerId] || "")).trim();
  if (!clientId) {
    return { ok: false, error: "Cole o Client ID OAuth nos Ajustes primeiro." };
  }
  const redirectUri = "https://" + chrome.runtime.id + ".chromiumapp.org/";
  const authUrl = buildOAuthUrl(provider, clientId, redirectUri);
  const redirect = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  });
  const r = parseOAuthRedirect(redirect);
  if (!r.ok) return r;
  const tokens = Object.assign({}, store.tokens, {
    [providerId]: { accessToken: r.token, expiresAt: Date.now() + r.expiresIn * 1000 }
  });
  await chrome.storage.local.set({
    oauth: Object.assign({}, store, { tokens: tokens })
  });
  return { ok: true };
}

async function getPageContext() {
  // Aba ativa da janela focada (spec) — e fallback pela última janela
  // "normal" (funciona mesmo com o painel em janela encaixada).
  let [tab] = await chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .catch(() => []);
  if (!tab) {
    const win = await chrome.windows
      .getLastFocused({ windowTypes: ["normal"] })
      .catch(() => null);
    [tab] = await chrome.tabs.query(
      win ? { windowId: win.id, active: true } : { active: true, currentWindow: true }
    );
  }
  if (!tab) throw new Error("Nenhuma aba ativa encontrada.");
  const url = tab.url || "";
  if (!/^https?:/i.test(url)) {
    throw new Error(
      "Só consigo ler páginas http/https (esta aba parece ser interna do navegador)."
    );
  }
  // 1) Pelo content script: ele já está dentro da página e SEMPRE tem
  //    acesso ao DOM — funciona mesmo quando o navegador (Brave etc.)
  //    restringe scripting/permissões de host da extensão.
  try {
    const via = await chrome.tabs.sendMessage(tab.id, { type: "leitor-ia-getpage" });
    if (via && via.ok) return via;
  } catch (_) {}
  // 2) Injeção direta pelo service worker.
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage
    });
    const r = results && results[0] && results[0].result;
    if (r && r.ok) return r;
  } catch (_) {}
  // 3) Injeta o content script agora e pergunta de novo.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["config.js", "content.js"] });
    const via2 = await chrome.tabs.sendMessage(tab.id, { type: "leitor-ia-getpage" });
    if (via2 && via2.ok) return via2;
  } catch (_) {}
  throw new Error(
    "Não consegui ler esta página. Em brave://extensions → Leitor IA, deixe o acesso como “Em todos os sites” e recarregue a página."
  );
}

// Função injetada na página (precisa ser autocontida).
function extractPage() {
  try {
    const selection = String(window.getSelection() || "").slice(0, 4000);
    let text = "";
    if (document.body) {
      const clone = document.body.cloneNode(true);
      // Só lixo visual: NUNCA remover form/input/button — senão telas de
      // login (como EADs) perdem os campos de CPF/senha na leitura.
      const drop = "script,style,noscript,template,svg,canvas,iframe,object,embed,video,audio";
      clone.querySelectorAll(drop).forEach((n) => n.remove());
      // Serializa controles de formulário p/ IA entender o formulário.
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
    const metaDesc =
      (document.querySelector('meta[name="description"]') || {}).content || "";
    return {
      ok: true,
      url: location.href,
      title: document.title || location.hostname,
      description: String(metaDesc || ""),
      text: text.slice(0, 80000),
      selection: selection
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ------------------------------------------------------------
// Chat com streaming via porta
// ------------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keepalive") {
    // Porta aberta = Service Worker vivo durante o streaming da web.
    port.onMessage.addListener(() => {});
    return;
  }
  if (port.name !== "chat") return;  let controller = null;
  const safePost = (msg) => {
    try {
      port.postMessage(msg);
    } catch (_) {}
  };

  port.onMessage.addListener((msg) => {
    if (msg && msg.type === "start") {
      controller = new AbortController();
      // Fail-safe: idleta >2min encerra com erro — raciocínio max pode
      // ficar tempo significativo sem emitir nada.
      let activity = Date.now();
      let finished = false;
      const IDLE_LIMIT_MS = 120000;
      const livePost = (m) => {
        activity = Date.now();
        safePost(m);
      };
      const guard = setInterval(() => {
        if (finished) return clearInterval(guard);
        if (Date.now() - activity > IDLE_LIMIT_MS) {
          finished = true;
          clearInterval(guard);
          safePost({
            type: "error",
            message:
              "Tempo limite esgotado ou modelo aguardando interação. Verifique a aba ou suas chaves."
          });
          safePost({ type: "done" });
          if (controller) controller.abort();
        }
      }, 4000);
      runChat(msg.req, livePost, controller.signal)
        .then(() => {
          finished = true;
          clearInterval(guard);
          safePost({ type: "done" });
        })
        .catch((e) => {
          finished = true;
          clearInterval(guard);
          if (e && e.name === "AbortError") {
            safePost({ type: "done", aborted: true });
          } else {
            safePost({ type: "error", message: friendlyError(e) });
          }
        });
    } else if (msg && msg.type === "stop") {
      if (controller) controller.abort();
    }
  });

  port.onDisconnect.addListener(() => {
    if (controller) controller.abort();
  });
});

async function runChat(req, post, signal) {
  const provider = PROVIDERS.find((p) => p.id === req.provider);
  if (!provider) throw new Error("Provedor desconhecido: " + req.provider);
  if (!req.apiKey && !req.accessToken) {
    throw new Error(
      "Falta a chave de API do " +
        provider.name +
        " (ou uma conta conectada via OAuth). Adicione nos Ajustes da extensão."
    );
  }
  const base = String(req.baseUrl || provider.baseUrl).replace(/\/+$/, "");

  if (provider.id === "anthropic") return runAnthropic(req, post, signal, base);
  if (provider.id === "google") return runGemini(req, post, signal, base);
  return runOpenAICompat(req, post, signal, base, provider); // openai, kimi, zai
}

// ---------- Multimodal (visão) ----------
// dataUrl "data:image/jpeg;base64,XXX" → { mime, data }
function splitImageDataUrl(dataUrl) {
  const s = String(dataUrl || "");
  const i = s.indexOf(",");
  if (i < 0) return null;
  const mime = s.slice(5, i).split(";")[0] || "image/jpeg";
  return { mime: mime, data: s.slice(i + 1) };
}

// OpenAI-compat: image_url no último user.
function visionMessagesOpenAI(messages, image) {
  if (!image) return messages;
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      out[i] = Object.assign({}, out[i], {
        content: [
          { type: "text", text: String(out[i].content) },
          { type: "image_url", image_url: { url: image } }
        ]
      });
      break;
    }
  }
  return out;
}

// ---------- OpenAI, Kimi e Z.AI (compatível com OpenAI) ----------
async function runOpenAICompat(req, post, signal, base, provider) {
  const body = {
    model: req.model,
    stream: true,
    messages: visionMessagesOpenAI(req.messages, req.image)
  };
  if (req.effort && req.modelSupportsEffort) {
    if (provider.id === "openai") {
      // OpenAI aceita low | medium | high
      body.reasoning_effort = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" }[req.effort] || "medium";
    } else if (provider.id === "zai" && /^glm-[45]/.test(req.model)) {
      body.thinking = { type: req.effort === "low" ? "disabled" : "enabled" };
    } else if (provider.id === "kimi" && /^kimi-k3/.test(req.model)) {
      body.thinking = { type: req.effort === "low" ? "disabled" : "enabled" };
    }
  }
  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + (req.accessToken || req.apiKey)
    },
    body: JSON.stringify(body),
    signal: signal
  });
  await ensureOk(resp);
  await readSSE(resp, (data) => {
    if (data === "[DONE]") return;
    let obj;
    try {
      obj = JSON.parse(data);
    } catch (_) {
      return;
    }
    if (obj.error && obj.error.message) throw new Error(obj.error.message);
    const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
    if (delta && delta.content) post({ type: "delta", text: delta.content });
  });
}

// ---------- Anthropic (Claude) ----------
async function runAnthropic(req, post, signal, base) {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  // Visão (Anthropic): bloco image base64 no último user.
  if (req.image) {
    const img = splitImageDataUrl(req.image);
    if (img) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          messages[i] = {
            role: "user",
            content: [
              { type: "text", text: String(messages[i].content) },
              { type: "image", source: { type: "base64", media_type: img.mime, data: img.data } }
            ]
          };
          break;
        }
      }
    }
  }

  const body = { model: req.model, stream: true, max_tokens: 8192, messages: messages };
  if (system) body.system = system;
  if (req.effort && req.modelSupportsEffort) {
    if (req.modelAdaptive) {
      // Modelos com thinking adaptativo (Sonnet 5, Opus 5, Fable 5.1…):
      // o esforço vai via output_config.effort, igual ao Claude web.
      body.thinking = { type: "adaptive" };
      body.output_config = { effort: req.effort }; // low|medium|high|xhigh|max
    } else {
      const budget =
        { low: 1024, medium: 8000, high: 16000, xhigh: 24000, max: 32000 }[req.effort] || 8000;
      body.thinking = { type: "enabled", budget_tokens: budget };
      body.max_tokens = budget + 8192;
    }
  }
  const resp = await fetch(base + "/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": req.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body),
    signal: signal
  });
  await ensureOk(resp);

  const blockTypes = [];
  await readSSE(resp, (data) => {
    let ev;
    try {
      ev = JSON.parse(data);
    } catch (_) {
      return;
    }
    if (ev.type === "error") {
      throw new Error((ev.error && ev.error.message) || "Erro no stream do Claude.");
    }
    if (ev.type === "content_block_start") {
      blockTypes[ev.index] = ev.content_block && ev.content_block.type;
      // Bloco de thinking: avisa o painel ("Pensando…") uma vez por bloco.
      if (blockTypes[ev.index] === "thinking") post({ type: "status", text: "Pensando…" });
    }
    if (
      ev.type === "content_block_delta" &&
      ev.delta &&
      ev.delta.type === "text_delta" &&
      blockTypes[ev.index] === "text"
    ) {
      post({ type: "delta", text: ev.delta.text });
    }
  });
}

// ---------- Google (Gemini) ----------
async function runGemini(req, post, signal, base) {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
  // Visão (Gemini): inlineData no último user.
  if (req.image) {
    const img = splitImageDataUrl(req.image);
    if (img) {
      for (let i = contents.length - 1; i >= 0; i--) {
        if (contents[i].role === "user") {
          contents[i].parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
          break;
        }
      }
    }
  }

  const body = { contents: contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (req.effort && req.modelSupportsEffort) {
    if (/^gemini-3/.test(req.model)) {
      // Série Gemini 3: níveis low | medium | high
      const level =
        { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" }[req.effort] ||
        "medium";
      body.generationConfig = { thinkingConfig: { thinkingLevel: level } };
    } else {
      // Série 2.5: orçamento de tokens de pensamento
      const budget =
        { low: 1024, medium: 8192, high: 24576, xhigh: 32768, max: 32768 }[req.effort] || 8192;
      body.generationConfig = { thinkingConfig: { thinkingBudget: budget } };
    }
  }
  const url =
    base + "/models/" + encodeURIComponent(req.model) + ":streamGenerateContent?alt=sse";
  // OAuth (conta Google, tier gratuito) usa Bearer; senão, chave de API.
  const headers = { "content-type": "application/json" };
  if (req.accessToken) headers.authorization = "Bearer " + req.accessToken;
  else headers["x-goog-api-key"] = req.apiKey;
  const resp = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
    signal: signal
  });
  await ensureOk(resp);
  await readSSE(resp, (data) => {
    let obj;
    try {
      obj = JSON.parse(data);
    } catch (_) {
      return;
    }
    if (obj.promptFeedback && obj.promptFeedback.blockReason) {
      throw new Error("O Gemini bloqueou a solicitação: " + obj.promptFeedback.blockReason);
    }
    const parts =
      (obj.candidates &&
        obj.candidates[0] &&
        obj.candidates[0].content &&
        obj.candidates[0].content.parts) ||
      [];
    for (const p of parts) {
      if (p.text) post({ type: "delta", text: p.text });
    }
  });
}

// ------------------------------------------------------------
// Utilitários
// ------------------------------------------------------------
async function ensureOk(resp) {
  if (resp.ok) return;
  let detail = "";
  try {
    const t = await resp.text();
    try {
      detail = (JSON.parse(t).error && JSON.parse(t).error.message) || t;
    } catch (_) {
      detail = t;
    }
  } catch (_) {}
  throw new Error(("HTTP " + resp.status + ": " + (detail || resp.statusText)).slice(0, 700));
}

async function readSSE(resp, onData) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trim());
    }
  }
  const rest = buf.trim();
  if (rest.startsWith("data:")) onData(rest.slice(5).trim());
}

function friendlyError(e) {
  const msg = String((e && e.message) || e || "Erro desconhecido");
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return msg + " — verifique sua conexão (ou a chave de API nos Ajustes).";
  }
  return msg;
}
